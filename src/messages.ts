import type { Membership, Prisma, Store } from '@prisma/client';
import { z } from 'zod';
import { background } from './background.js';
import { prisma } from './db.js';
import { HttpError } from './errors.js';
import { liveRewardWhere } from './rewards.js';
import { googleWallet } from './wallet/index.js';

// Messages a shop sends to a group of its customers: a Google Wallet notification for
// cards saved in Wallet, and a copy in every recipient's inbox in the web app.

export const AUDIENCES = ['all', 'lapsed', 'close', 'ready', 'new'] as const;
export type Audience = (typeof AUDIENCES)[number];

/** Messages one shop may send per 24 hours, so customers don't get spammed. */
export const DAILY_LIMIT = 3;
/** "Close to a reward" means at most this many stamps away. */
const CLOSE_STAMPS = 2;
const NEW_DAYS = 7;
const DAY_MS = 86_400_000;

export const messageInput = z.object({
  title: z.string().trim().min(1).max(40),
  body: z.string().trim().min(1).max(200),
  audience: z.enum(AUDIENCES),
  days: z.union([z.literal(14), z.literal(30), z.literal(60)]).optional(),
});
export const audienceInput = messageInput.pick({ audience: true, days: true });

/** Customers in the audience who haven't turned messages off. */
export async function audienceMembers(storeId: string, audience: Audience, days = 30): Promise<Membership[]> {
  const now = Date.now();
  const where: Prisma.MembershipWhereInput = { storeId, messagesOff: false };
  if (audience === 'lapsed') {
    const cutoff = new Date(now - days * DAY_MS);
    where.OR = [{ lastStampAt: { lt: cutoff } }, { lastStampAt: null, createdAt: { lt: cutoff } }];
  }
  if (audience === 'new') where.createdAt = { gte: new Date(now - NEW_DAYS * DAY_MS) };
  const members = await prisma.membership.findMany({ where });
  if (audience !== 'ready' && audience !== 'close') return members;

  const costs = (await prisma.reward.findMany({ where: { storeId, ...liveRewardWhere() }, select: { cost: true } })).map((r) => r.cost);
  if (!costs.length) return [];
  return members.filter((m) => {
    if (audience === 'ready') return costs.some((c) => c <= m.balance);
    const next = Math.min(...costs.filter((c) => c > m.balance));
    return Number.isFinite(next) && next - m.balance <= CLOSE_STAMPS;
  });
}

export async function sentInLastDay(storeId: string) {
  return prisma.message.count({ where: { storeId, createdAt: { gte: new Date(Date.now() - DAY_MS) } } });
}

/** Saves the message with one inbox copy per recipient, then notifies Wallet cards in the background. */
export async function sendMessage(store: Store, input: z.infer<typeof messageInput>) {
  if ((await sentInLastDay(store.id)) >= DAILY_LIMIT) throw new HttpError(429, 'daily_limit');
  const members = await audienceMembers(store.id, input.audience, input.days);
  if (!members.length) throw new HttpError(400, 'no_recipients');

  const message = await prisma.message.create({
    data: {
      storeId: store.id,
      title: input.title,
      body: input.body,
      audience: input.audience,
      audienceDays: input.audience === 'lapsed' ? (input.days ?? 30) : null,
      recipients: members.length,
      deliveries: { createMany: { data: members.map((m) => ({ membershipId: m.id })) } },
    },
  });

  const inWallet = members.filter((m) => m.googleObjectId);
  if (googleWallet && inWallet.length) {
    const wallet = googleWallet;
    background('message wallet delivery', async () => {
      let sent = 0;
      // A few at a time: fast for small shops, gentle on Google's API for big ones.
      for (let i = 0; i < inWallet.length; i += 5) {
        const results = await Promise.allSettled(inWallet.slice(i, i + 5).map((m) => wallet.notify(m, input.title, input.body)));
        sent += results.filter((r) => r.status === 'fulfilled').length;
        for (const r of results) if (r.status === 'rejected') console.error('[messages] wallet notify failed', r.reason);
      }
      await prisma.message.update({ where: { id: message.id }, data: { walletSent: sent } });
    });
  }
  return message;
}
