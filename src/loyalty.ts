import type { Membership } from '@prisma/client';
import { prisma } from './db.js';
import { HttpError } from './errors.js';
import { activeHappyHour, birthdayYearNear, localTime } from '../shared/promotions.js';
import { liveRewardWhere } from './rewards.js';
import { syncBalance } from './wallet/index.js';

/** Get the customer's card at a store, creating it (with welcome stamps) on first visit. */
export async function joinStore(userId: string, storeId: string): Promise<{ membership: Membership; joined: boolean }> {
  const existing = await prisma.membership.findUnique({ where: { userId_storeId: { userId, storeId } } });
  if (existing) return { membership: existing, joined: false };

  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  try {
    const membership = await prisma.$transaction(async (tx) => {
      const m = await tx.membership.create({
        // Counting the welcome stamp as this visit's stamp stops a first-time tap from adding another.
        data: {
          userId,
          storeId,
          balance: store.welcomeStamps,
          lifetimeStamps: store.welcomeStamps,
          lastStampAt: store.welcomeStamps > 0 ? new Date() : null,
        },
      });
      if (store.welcomeStamps > 0) {
        await tx.stampEvent.create({ data: { storeId, membershipId: m.id, kind: 'welcome', delta: store.welcomeStamps } });
      }
      return m;
    });
    return { membership, joined: true };
  } catch (err) {
    // Two requests raced to create the same card: use the one that won.
    const raced = await prisma.membership.findUnique({ where: { userId_storeId: { userId, storeId } } });
    if (raced) return { membership: raced, joined: false };
    throw err;
  }
}

export type ClaimResult = {
  stamped: boolean;
  /** Stamps this tap gave: the card's value × any happy hour, plus a birthday bonus. */
  added?: number;
  happyHour?: { name: string; multiplier: number } | null;
  birthdayBonus?: number;
  reason?: 'cooldown' | 'already_claimed';
  nextStampAt?: Date;
  membership: Membership;
  tapExpiresAt: Date;
};

/** Turn a verified tap into a stamp for this customer (once per tap, respecting the store cooldown). */
export async function claimTap(userId: string, tapId: string): Promise<ClaimResult> {
  const tap = await prisma.tapSession.findUnique({ where: { id: tapId }, include: { store: true, tag: true } });
  if (!tap || tap.expiresAt < new Date()) throw new HttpError(410, 'tap_expired');
  if (tap.userId && tap.userId !== userId) throw new HttpError(409, 'tap_used');

  let { membership } = await joinStore(userId, tap.storeId);
  const base = { membership, tapExpiresAt: tap.expiresAt };

  // Bind the tap to this customer so nobody else can use it to redeem.
  const bound = await prisma.tapSession.updateMany({
    where: { id: tap.id, OR: [{ userId: null }, { userId }] },
    data: { userId },
  });
  if (bound.count === 0) throw new HttpError(409, 'tap_used');
  if (tap.stampApplied) return { ...base, stamped: false, reason: 'already_claimed' };

  const cooldownMs = tap.store.stampCooldownMinutes * 60_000;
  if (membership.lastStampAt && Date.now() - membership.lastStampAt.getTime() < cooldownMs) {
    return { ...base, stamped: false, reason: 'cooldown', nextStampAt: new Date(membership.lastStampAt.getTime() + cooldownMs) };
  }

  // How many stamps: the card's value, multiplied during a happy hour (shop-local time).
  const now = new Date();
  const tz = tap.store.timezone;
  const promotions = await prisma.promotion.findMany({ where: { storeId: tap.storeId, active: true } });
  const happyHour = activeHappyHour(promotions, now, tz);
  const stamps = tap.tag.stamps * (happyHour?.multiplier ?? 1);

  // Birthday bonus: once per birthday, on a visit within 3 days of it.
  let birthday: { year: number; bonus: number } | null = null;
  if (tap.store.birthdayStamps > 0) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { birthMonth: true, birthDay: true } });
    const year = user.birthMonth && user.birthDay ? birthdayYearNear(user.birthMonth, user.birthDay, localTime(now, tz)) : null;
    if (year !== null && membership.birthdayYear !== year) birthday = { year, bonus: tap.store.birthdayStamps };
  }
  const total = stamps + (birthday?.bonus ?? 0);

  const stamped = await prisma.$transaction(async (tx) => {
    const marked = await tx.tapSession.updateMany({ where: { id: tap.id, stampApplied: false }, data: { stampApplied: true } });
    if (marked.count === 0) return null;
    const m = await tx.membership.update({
      where: { id: membership.id },
      data: {
        balance: { increment: total },
        lifetimeStamps: { increment: total },
        lastStampAt: now,
        ...(birthday && { birthdayYear: birthday.year }),
      },
    });
    await tx.stampEvent.create({
      data: {
        storeId: tap.storeId,
        membershipId: m.id,
        kind: 'tap',
        delta: stamps,
        tagId: tap.tagId,
        note: happyHour ? `${happyHour.name} ×${happyHour.multiplier}` : null,
      },
    });
    if (birthday) {
      await tx.stampEvent.create({ data: { storeId: tap.storeId, membershipId: m.id, kind: 'birthday', delta: birthday.bonus } });
    }
    return m;
  });
  if (!stamped) return { ...base, stamped: false, reason: 'already_claimed' };

  membership = stamped;
  const hh = happyHour && { name: happyHour.name, multiplier: happyHour.multiplier };
  syncBalance(membership.id, { kind: 'stamp', added: total, happyHour: hh, birthdayBonus: birthday?.bonus ?? 0 });
  return { ...base, membership, stamped: true, added: total, happyHour: hh, birthdayBonus: birthday?.bonus ?? 0 };
}

/** Spend stamps on a reward. Needs a fresh tap from the same customer, which proves they're at the counter. */
export async function redeem(userId: string, storeId: string, rewardId: string, tapId: string) {
  const tap = await prisma.tapSession.findUnique({ where: { id: tapId } });
  if (!tap || tap.storeId !== storeId || tap.userId !== userId || tap.expiresAt < new Date()) {
    throw new HttpError(403, 'tap_required');
  }
  if (tap.redeemedAt) throw new HttpError(409, 'tap_already_used_for_reward');

  const reward = await prisma.reward.findFirst({ where: { id: rewardId, storeId } });
  if (!reward || !reward.active) throw new HttpError(404, 'reward_not_found');
  // Limited-time rewards can only be claimed inside their window.
  if (!(await prisma.reward.count({ where: { id: reward.id, ...liveRewardWhere() } }))) throw new HttpError(400, 'reward_not_available');

  const result = await prisma.$transaction(async (tx) => {
    const usedTap = await tx.tapSession.updateMany({ where: { id: tap.id, redeemedAt: null }, data: { redeemedAt: new Date() } });
    if (usedTap.count === 0) throw new HttpError(409, 'tap_already_used_for_reward');

    const spent = await tx.membership.updateMany({
      where: { userId, storeId, balance: { gte: reward.cost } },
      data: { balance: { decrement: reward.cost } },
    });
    if (spent.count === 0) throw new HttpError(400, 'not_enough_stamps');

    const membership = await tx.membership.findUniqueOrThrow({ where: { userId_storeId: { userId, storeId } } });
    if (reward.perCustomerLimit !== null) {
      const claimed = await tx.stampEvent.count({ where: { membershipId: membership.id, kind: 'redeem', rewardId: reward.id } });
      if (claimed >= reward.perCustomerLimit) throw new HttpError(409, 'reward_limit_reached');
    }
    const event = await tx.stampEvent.create({
      data: { storeId, membershipId: membership.id, kind: 'redeem', delta: -reward.cost, rewardName: reward.name, rewardId: reward.id, tagId: tap.tagId },
    });
    return { membership, redeemedAt: event.createdAt };
  });

  syncBalance(result.membership.id, { kind: 'redeem', rewardName: reward.name, cost: reward.cost });
  return { ...result, reward };
}

/** The shop adds or removes stamps by hand, e.g. a forgotten tap or a mistake. Never goes below zero. */
export async function adjustStamps(storeId: string, membershipId: string, delta: number, note: string | null) {
  const membership = await prisma.$transaction(async (tx) => {
    const current = await tx.membership.findUnique({ where: { id: membershipId } });
    if (!current || current.storeId !== storeId) throw new HttpError(404, 'customer_not_found');
    const changed = await tx.membership.updateMany({
      where: { id: membershipId, balance: { gte: -delta } },
      data: { balance: { increment: delta }, ...(delta > 0 && { lifetimeStamps: { increment: delta } }) },
    });
    if (changed.count === 0) throw new HttpError(400, 'balance_below_zero');
    await tx.stampEvent.create({ data: { storeId, membershipId, kind: 'adjust', delta, note } });
    return tx.membership.findUniqueOrThrow({ where: { id: membershipId } });
  });
  syncBalance(membership.id, { kind: 'adjust', added: delta, note });
  return membership;
}
