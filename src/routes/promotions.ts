import { Router } from 'express';
import { z } from 'zod';
import { toMinutes } from '../../shared/promotions.js';
import { prisma } from '../db.js';
import { HttpError } from '../errors.js';
import { syncStoreCard } from '../wallet/index.js';
import { ownedStore } from './owned.js';

// Happy hours (mounted under /api/portal, owners only).
export const promotionsRouter = Router();

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const promotionInput = z
  .object({
    name: z.string().trim().min(1).max(40),
    multiplier: z.union([z.literal(2), z.literal(3)]),
    days: z.string().regex(/^[1-7]{1,7}$/, 'Pick at least one day'),
    startTime: time,
    endTime: time,
    startsOn: localDate.nullable(),
    endsOn: localDate.nullable(),
    active: z.boolean(),
  })
  .partial();

/** Normalises days ("531" → "135") and checks the times and dates make sense. */
function validated(input: z.infer<typeof promotionInput>, current?: { startTime: string; endTime: string; startsOn: string | null; endsOn: string | null }) {
  const days = input.days && [...new Set(input.days)].sort().join('');
  const start = input.startTime ?? current?.startTime;
  const end = input.endTime ?? current?.endTime;
  if (start && end && toMinutes(end) <= toMinutes(start)) throw new HttpError(400, 'ends_before_it_starts');
  const from = input.startsOn !== undefined ? input.startsOn : current?.startsOn;
  const to = input.endsOn !== undefined ? input.endsOn : current?.endsOn;
  if (from && to && to < from) throw new HttpError(400, 'ends_before_it_starts');
  return { ...input, ...(days && { days }) };
}

promotionsRouter.get('/stores/:id/promotions', async (req, res) => {
  const store = await ownedStore(res, String(req.params.id));
  const promotions = await prisma.promotion.findMany({ where: { storeId: store.id }, orderBy: { createdAt: 'asc' } });
  res.json({ promotions, timezone: store.timezone, birthdayStamps: store.birthdayStamps });
});

promotionsRouter.post('/stores/:id/promotions', async (req, res) => {
  const store = await ownedStore(res, String(req.params.id));
  const input = promotionInput.required({ name: true, multiplier: true, days: true, startTime: true, endTime: true }).parse(req.body);
  if ((await prisma.promotion.count({ where: { storeId: store.id } })) >= 20) throw new HttpError(400, 'too_many_promotions');
  const promotion = await prisma.promotion.create({
    data: { ...validated(input), name: input.name, multiplier: input.multiplier, startTime: input.startTime, endTime: input.endTime, days: [...new Set(input.days)].sort().join(''), storeId: store.id },
  });
  syncStoreCard(store); // the pass lists happy hours
  res.status(201).json({ promotion });
});

promotionsRouter.patch('/stores/:id/promotions/:promotionId', async (req, res) => {
  const store = await ownedStore(res, String(req.params.id));
  const current = await prisma.promotion.findFirst({ where: { id: String(req.params.promotionId), storeId: store.id } });
  if (!current) throw new HttpError(404, 'promotion_not_found');
  const promotion = await prisma.promotion.update({ where: { id: current.id }, data: validated(promotionInput.parse(req.body), current) });
  syncStoreCard(store);
  res.json({ promotion });
});

promotionsRouter.delete('/stores/:id/promotions/:promotionId', async (req, res) => {
  const store = await ownedStore(res, String(req.params.id));
  const deleted = await prisma.promotion.deleteMany({ where: { id: String(req.params.promotionId), storeId: store.id } });
  if (deleted.count === 0) throw new HttpError(404, 'promotion_not_found');
  syncStoreCard(store);
  res.json({ ok: true });
});
