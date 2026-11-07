import { Router } from 'express';
import type { Membership } from '@prisma/client';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { HttpError } from '../errors.js';
import { clearSession, currentUser, getUser, requireUser } from '../auth.js';
import { claimTap, joinStore, redeem } from '../loyalty.js';
import { happyHourStatus, liveRewardWhere, publicRewardSelect as rewardSelect } from '../rewards.js';
import { publicStore } from '../stores.js';
import { googleWallet, removeCards } from '../wallet/index.js';

export const customerRouter = Router();


async function storeBySlug(slug: string) {
  const store = await prisma.store.findUnique({ where: { slug } });
  if (!store) throw new HttpError(404, 'store_not_found');
  return store;
}

function publicConfig() {
  return { googleClientId: config.googleClientId, devLogin: config.devLogin, googleWallet: Boolean(googleWallet) };
}

function publicMembership(m: Membership) {
  return { balance: m.balance, inWallet: Boolean(m.googleObjectId), messagesOff: m.messagesOff };
}

customerRouter.get('/config', (_req, res) => {
  res.json(publicConfig());
});

// Stores for the discover map: only those whose owner has placed them on the map.
customerRouter.get('/stores', async (req, res) => {
  const [stores, user] = await Promise.all([
    prisma.store.findMany({
      where: { latitude: { not: null }, longitude: { not: null } },
      include: {
        rewards: { where: liveRewardWhere(), orderBy: { cost: 'asc' }, select: rewardSelect },
        promotions: { where: { active: true } },
      },
      orderBy: { name: 'asc' },
    }),
    getUser(req),
  ]);
  const balances = new Map<string, number>();
  if (user) {
    const memberships = await prisma.membership.findMany({ where: { userId: user.id }, select: { storeId: true, balance: true } });
    for (const m of memberships) balances.set(m.storeId, m.balance);
  }
  res.json({
    stores: stores.map((s) => ({
      ...publicStore(s, s.rewards),
      member: balances.has(s.id),
      balance: balances.get(s.id) ?? null,
      happyHourNow: happyHourStatus(s.promotions, s.timezone).now,
    })),
  });
});

// Everything the card page needs in one round trip: store, who's signed in, their card,
// and (after an NFC tap) the stamp result. Taps happen at a busy counter, so speed matters.
customerRouter.post('/stores/:slug/open', async (req, res) => {
  const { tapId } = z.object({ tapId: z.string().optional() }).parse(req.body ?? {});
  const store = await storeBySlug(String(req.params.slug));
  const [rewards, user, promotions] = await Promise.all([
    prisma.reward.findMany({ where: { storeId: store.id, ...liveRewardWhere() }, orderBy: { cost: 'asc' }, select: rewardSelect }),
    getUser(req),
    prisma.promotion.findMany({ where: { storeId: store.id, active: true } }),
  ]);
  const base = { config: publicConfig(), store: publicStore(store, rewards), happyHours: happyHourStatus(promotions, store.timezone) };
  if (!user) {
    res.json({ ...base, user: null });
    return;
  }

  let { membership, joined } = await joinStore(user.id, store.id);
  let tap = null;
  if (tapId) {
    try {
      const result = await claimTap(user.id, tapId);
      membership = result.membership;
      tap = {
        stamped: result.stamped,
        added: result.added,
        happyHour: result.happyHour,
        birthdayBonus: result.birthdayBonus,
        reason: result.reason,
        nextStampAt: result.nextStampAt,
        expiresAt: result.tapExpiresAt,
      };
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      tap = { error: err.code };
    }
  }
  // How often this customer already claimed each reward that has a per-customer limit.
  const limited = rewards.filter((r) => r.perCustomerLimit !== null).map((r) => r.id);
  const claims = limited.length
    ? await prisma.stampEvent.groupBy({ by: ['rewardId'], where: { membershipId: membership.id, kind: 'redeem', rewardId: { in: limited } }, _count: { _all: true } })
    : [];
  res.json({
    ...base,
    user: { name: user.name, email: user.email },
    joined,
    tap,
    membership: publicMembership(membership),
    claims: Object.fromEntries(claims.map((c) => [c.rewardId, c._count._all])),
  });
});

customerRouter.get('/stores/:slug/history', requireUser, async (req, res) => {
  const store = await storeBySlug(String(req.params.slug));
  const membership = await prisma.membership.findUnique({
    where: { userId_storeId: { userId: currentUser(res).id, storeId: store.id } },
  });
  if (!membership) {
    res.json({ events: [] });
    return;
  }
  const events = await prisma.stampEvent.findMany({
    where: { membershipId: membership.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, kind: true, delta: true, rewardName: true, note: true, createdAt: true },
  });
  res.json({ events });
});

customerRouter.post('/stores/:slug/redeem', requireUser, async (req, res) => {
  const store = await storeBySlug(String(req.params.slug));
  const body = z.object({ rewardId: z.string(), tapId: z.string() }).parse(req.body);
  const result = await redeem(currentUser(res).id, store.id, body.rewardId, body.tapId);
  res.json({
    membership: publicMembership(result.membership),
    reward: { name: result.reward.name, cost: result.reward.cost },
    redeemedAt: result.redeemedAt,
  });
});

customerRouter.get('/stores/:slug/wallet/google', requireUser, async (req, res) => {
  if (!googleWallet) throw new HttpError(404, 'google_wallet_not_configured');
  const store = await storeBySlug(String(req.params.slug));
  const user = currentUser(res);
  const { membership } = await joinStore(user.id, store.id);
  res.json({ url: await googleWallet.getSaveUrl(store, membership, user) });
});

// Pushes the current balance to the customer's Wallet card and reports whether the card
// is actually saved, so the page can say "Wallet updated" or offer to add it.
customerRouter.post('/stores/:slug/wallet/sync', requireUser, async (req, res) => {
  const store = await storeBySlug(String(req.params.slug));
  const membership = await prisma.membership.findUnique({
    where: { userId_storeId: { userId: currentUser(res).id, storeId: store.id } },
  });
  if (!googleWallet || !membership?.googleObjectId) {
    res.json({ updated: false, saved: false });
    return;
  }
  try {
    const saved = await googleWallet.updateBalance(store, membership);
    res.json({ updated: saved, saved });
  } catch (err) {
    console.error('[google-wallet] sync failed', err);
    res.json({ updated: false, saved: false });
  }
});

// --- The signed-in customer's own data ---

/** The customer's birthday (month and day only), for shops' birthday bonus. */
customerRouter.patch('/me', requireUser, async (req, res) => {
  const body = z
    .object({ birthMonth: z.number().int().min(1).max(12).nullable(), birthDay: z.number().int().min(1).max(31).nullable() })
    .refine((b) => (b.birthMonth === null) === (b.birthDay === null), 'Give both month and day, or neither')
    .refine((b) => b.birthMonth === null || b.birthDay! <= new Date(Date.UTC(2024, b.birthMonth, 0)).getUTCDate(), 'Not a real date')
    .parse(req.body);
  await prisma.user.update({ where: { id: currentUser(res).id }, data: body });
  res.json({ ok: true });
});

// --- Inbox: messages from the shops the customer has joined ---

customerRouter.get('/me/messages', requireUser, async (_req, res) => {
  const deliveries = await prisma.messageDelivery.findMany({
    where: { membership: { userId: currentUser(res).id } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      message: { select: { title: true, body: true } },
      membership: { select: { store: { select: { name: true, slug: true, logoUrl: true, bgColor: true, textColor: true } } } },
    },
  });
  res.json({
    unread: deliveries.filter((d) => !d.readAt).length,
    messages: deliveries.map((d) => ({
      id: d.id,
      title: d.message.title,
      body: d.message.body,
      createdAt: d.createdAt,
      read: Boolean(d.readAt),
      store: d.membership.store,
    })),
  });
});

customerRouter.post('/me/messages/read', requireUser, async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.string()).max(100) }).parse(req.body);
  await prisma.messageDelivery.updateMany({
    where: { id: { in: ids }, readAt: null, membership: { userId: currentUser(res).id } },
    data: { readAt: new Date() },
  });
  res.json({ ok: true });
});

/** The customer turns messages from one shop on or off. */
customerRouter.patch('/stores/:slug/messages', requireUser, async (req, res) => {
  const { off } = z.object({ off: z.boolean() }).parse(req.body);
  const store = await storeBySlug(String(req.params.slug));
  const updated = await prisma.membership.updateMany({ where: { userId: currentUser(res).id, storeId: store.id }, data: { messagesOff: off } });
  if (updated.count === 0) throw new HttpError(404, 'not_a_member');
  res.json({ messagesOff: off });
});

customerRouter.get('/me/cards', requireUser, async (_req, res) => {
  const memberships = await prisma.membership.findMany({
    where: { userId: currentUser(res).id },
    include: { store: { include: { rewards: { where: liveRewardWhere(), orderBy: { cost: 'asc' }, select: rewardSelect } } } },
    orderBy: [{ lastStampAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
  });
  res.json({
    cards: memberships.map((m) => ({
      balance: m.balance,
      lifetimeStamps: m.lifetimeStamps,
      lastStampAt: m.lastStampAt,
      store: publicStore(m.store, m.store.rewards),
    })),
  });
});

// Right to erasure: removes the customer's cards, stamp history and account.
customerRouter.delete('/me', requireUser, async (_req, res) => {
  const user = currentUser(res);
  if (await prisma.store.count({ where: { ownerId: user.id } })) throw new HttpError(409, 'owns_stores');
  const memberships = await prisma.membership.findMany({ where: { userId: user.id } });
  await removeCards(memberships);
  await prisma.$transaction([
    prisma.tapSession.updateMany({ where: { userId: user.id }, data: { userId: null } }),
    prisma.membership.deleteMany({ where: { userId: user.id } }),
    prisma.user.delete({ where: { id: user.id } }),
  ]);
  clearSession(res);
  res.json({ ok: true });
});
