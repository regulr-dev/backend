import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError } from '../errors.js';
import { adjustStamps } from '../loyalty.js';
import { ownedStore } from './owned.js';

// Store dashboard: stats over a period, the customer list, one customer's history,
// and manual stamp adjustments. Mounted under /api/portal (owners only).
export const insightsRouter = Router();

const DAY_MS = 86_400_000;
const num = (v: unknown) => Number(v ?? 0);

/** A valid IANA timezone from the browser, so days and hours match the owner's clock. */
function timezone(raw: unknown) {
  const tz = typeof raw === 'string' && raw.length <= 64 ? raw : 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** "jane.doe@gmail.com" → "ja•••@gmail.com": enough to tell customers apart, not to copy. */
function maskEmail(email: string) {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}•••@${domain}`;
}

const customerName = (u: { name: string | null; email: string }) => u.name || u.email.split('@')[0];

insightsRouter.get('/stores/:id/stats', async (req, res) => {
  const store = await ownedStore(res, String(req.params.id));
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const tz = timezone(req.query.tz);
  const now = Date.now();
  const since = new Date(now - days * DAY_MS);
  const prevSince = new Date(now - 2 * days * DAY_MS);
  // Prisma stores UTC timestamps without a zone; shift them into the owner's timezone.
  const local = Prisma.sql`(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})`;

  const [totals, returning, daily, joinedDaily, hours, members, topRewards] = await Promise.all([
    prisma.$queryRaw<Record<string, bigint>[]>`
      SELECT
        COUNT(*) FILTER (WHERE kind = 'tap' AND "createdAt" >= ${since}) AS visits,
        COUNT(*) FILTER (WHERE kind = 'tap' AND "createdAt" >= ${prevSince} AND "createdAt" < ${since}) AS "prevVisits",
        COUNT(*) FILTER (WHERE kind = 'redeem' AND "createdAt" >= ${since}) AS redemptions,
        COUNT(*) FILTER (WHERE kind = 'redeem' AND "createdAt" >= ${prevSince} AND "createdAt" < ${since}) AS "prevRedemptions",
        COALESCE(SUM(delta) FILTER (WHERE delta > 0 AND "createdAt" >= ${since}), 0) AS "stampsGiven"
      FROM "StampEvent" WHERE "storeId" = ${store.id} AND "createdAt" >= ${prevSince}`,
    prisma.$queryRaw<Record<string, bigint>[]>`
      SELECT COUNT(*) AS active, COUNT(*) FILTER (WHERE n >= 2) AS returning
      FROM (SELECT "membershipId", COUNT(*) AS n FROM "StampEvent"
            WHERE "storeId" = ${store.id} AND kind = 'tap' AND "createdAt" >= ${since}
            GROUP BY "membershipId") AS visits`,
    prisma.$queryRaw<{ day: string; visits: bigint; redemptions: bigint }[]>`
      SELECT to_char(${local}, 'YYYY-MM-DD') AS day,
        COUNT(*) FILTER (WHERE kind = 'tap') AS visits,
        COUNT(*) FILTER (WHERE kind = 'redeem') AS redemptions
      FROM "StampEvent" WHERE "storeId" = ${store.id} AND "createdAt" >= ${since}
      GROUP BY 1`,
    prisma.$queryRaw<{ day: string; joined: bigint }[]>`
      SELECT to_char(${local}, 'YYYY-MM-DD') AS day, COUNT(*) AS joined
      FROM "Membership" WHERE "storeId" = ${store.id} AND "createdAt" >= ${since}
      GROUP BY 1`,
    prisma.$queryRaw<{ hour: number; visits: bigint }[]>`
      SELECT EXTRACT(HOUR FROM ${local})::int AS hour, COUNT(*) AS visits
      FROM "StampEvent" WHERE "storeId" = ${store.id} AND kind = 'tap' AND "createdAt" >= ${since}
      GROUP BY 1`,
    prisma.$queryRaw<Record<string, bigint>[]>`
      SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE "createdAt" >= ${since}) AS "new",
        COUNT(*) FILTER (WHERE "createdAt" >= ${prevSince} AND "createdAt" < ${since}) AS "prevNew",
        COUNT(*) FILTER (WHERE "googleObjectId" IS NOT NULL) AS "inWallet",
        COALESCE(SUM(balance), 0) AS outstanding
      FROM "Membership" WHERE "storeId" = ${store.id}`,
    prisma.stampEvent.groupBy({
      by: ['rewardName'],
      where: { storeId: store.id, kind: 'redeem', createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { rewardName: 'desc' } },
      take: 5,
    }),
  ]);

  // One row per day, including days without any activity, so the chart has no gaps.
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const joinedByDay = new Map(joinedDaily.map((d) => [d.day, num(d.joined)]));
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const series = Array.from({ length: days }, (_, i) => {
    const day = dayKey.format(new Date(now - (days - 1 - i) * DAY_MS));
    return { day, visits: num(byDay.get(day)?.visits), redemptions: num(byDay.get(day)?.redemptions), joined: joinedByDay.get(day) ?? 0 };
  });
  const byHour = new Map(hours.map((h) => [h.hour, num(h.visits)]));

  const t = totals[0];
  const m = members[0];
  res.json({
    days,
    totals: {
      visits: num(t.visits),
      prevVisits: num(t.prevVisits),
      redemptions: num(t.redemptions),
      prevRedemptions: num(t.prevRedemptions),
      stampsGiven: num(t.stampsGiven),
      activeCustomers: num(returning[0].active),
      returningCustomers: num(returning[0].returning),
      newMembers: num(m.new),
      prevNewMembers: num(m.prevNew),
      members: num(m.total),
      inWallet: num(m.inWallet),
      outstandingStamps: num(m.outstanding),
    },
    daily: series,
    hours: Array.from({ length: 24 }, (_, h) => byHour.get(h) ?? 0),
    topRewards: topRewards.map((r) => ({ name: r.rewardName ?? 'Reward', count: r._count._all })),
  });
});

// Whitelisted sort orders (ORDER BY can't take query parameters).
const SORTS = {
  recent: Prisma.sql`m."lastStampAt" DESC NULLS LAST`,
  stamps: Prisma.sql`m.balance DESC`,
  visits: Prisma.sql`visits DESC`,
  new: Prisma.sql`m."createdAt" DESC`,
} as const;
const PAGE = 50;

insightsRouter.get('/stores/:id/customers', async (req, res) => {
  const store = await ownedStore(res, String(req.params.id));
  const sort = (Object.keys(SORTS) as (keyof typeof SORTS)[]).find((k) => k === req.query.sort) ?? 'recent';
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
  const offset = Math.max(0, Math.min(10_000, Number(req.query.offset) || 0));
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const search = q ? Prisma.sql`AND (u.name ILIKE ${pattern} OR u.email ILIKE ${pattern})` : Prisma.empty;

  const [rows, count] = await Promise.all([
    prisma.$queryRaw<
      { id: string; name: string | null; email: string; balance: number; lifetimeStamps: number; createdAt: Date; lastStampAt: Date | null; inWallet: boolean; visits: bigint; redemptions: bigint }[]
    >`
      SELECT m.id, u.name, u.email, m.balance, m."lifetimeStamps", m."createdAt", m."lastStampAt",
        m."googleObjectId" IS NOT NULL AS "inWallet",
        (SELECT COUNT(*) FROM "StampEvent" e WHERE e."membershipId" = m.id AND e.kind = 'tap') AS visits,
        (SELECT COUNT(*) FROM "StampEvent" e WHERE e."membershipId" = m.id AND e.kind = 'redeem') AS redemptions
      FROM "Membership" m JOIN "User" u ON u.id = m."userId"
      WHERE m."storeId" = ${store.id} ${search}
      ORDER BY ${SORTS[sort]}, m.id
      LIMIT ${PAGE} OFFSET ${offset}`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM "Membership" m JOIN "User" u ON u.id = m."userId"
      WHERE m."storeId" = ${store.id} ${search}`,
  ]);

  res.json({
    total: num(count[0].n),
    nextOffset: rows.length === PAGE ? offset + PAGE : null,
    customers: rows.map((r) => ({
      id: r.id,
      name: customerName(r),
      email: maskEmail(r.email),
      balance: r.balance,
      lifetimeStamps: r.lifetimeStamps,
      visits: num(r.visits),
      redemptions: num(r.redemptions),
      inWallet: r.inWallet,
      joinedAt: r.createdAt,
      lastVisitAt: r.lastStampAt,
    })),
  });
});

async function customerOf(storeId: string, membershipId: string) {
  const m = await prisma.membership.findUnique({ where: { id: membershipId }, include: { user: { select: { name: true, email: true } } } });
  if (!m || m.storeId !== storeId) throw new HttpError(404, 'customer_not_found');
  return m;
}

insightsRouter.get('/stores/:id/customers/:membershipId', async (req, res) => {
  const store = await ownedStore(res, String(req.params.id));
  const m = await customerOf(store.id, String(req.params.membershipId));
  const events = await prisma.stampEvent.findMany({
    where: { membershipId: m.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, kind: true, delta: true, rewardName: true, note: true, createdAt: true },
  });
  res.json({
    customer: {
      id: m.id,
      name: customerName(m.user),
      email: maskEmail(m.user.email),
      balance: m.balance,
      lifetimeStamps: m.lifetimeStamps,
      inWallet: Boolean(m.googleObjectId),
      joinedAt: m.createdAt,
      lastVisitAt: m.lastStampAt,
    },
    events,
  });
});

insightsRouter.post('/stores/:id/customers/:membershipId/adjust', async (req, res) => {
  const store = await ownedStore(res, String(req.params.id));
  const body = z
    .object({
      delta: z.number().int().min(-100).max(100).refine((d) => d !== 0, 'Must not be 0'),
      note: z.string().trim().max(120).nullable().optional(),
    })
    .parse(req.body);
  const m = await adjustStamps(store.id, String(req.params.membershipId), body.delta, body.note || null);
  res.json({ balance: m.balance });
});
