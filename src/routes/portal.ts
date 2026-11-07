import { randomBytes } from 'node:crypto';
import express, { Router } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { HttpError } from '../errors.js';
import { currentUser, requireUser } from '../auth.js';
import { deriveFileKey } from '../nfc/sun.js';
import { hoursSchema, ownerStore } from '../stores.js';
import { saveUpload } from '../uploads.js';
import { REWARD_ICONS } from '../../shared/stampArt.js';
import { startOfLocalDate } from '../../shared/promotions.js';
import { ownerReward } from '../rewards.js';
import { promotionsRouter } from './promotions.js';
import { syncStoreCard } from '../wallet/index.js';
import { insightsRouter } from './insights.js';
import { portalMessagesRouter } from './messages.js';
import { ownedStore } from './owned.js';

export const portalRouter = Router();
portalRouter.use(requireUser);
// Dashboard stats, the customer list and messages to customers.
portalRouter.use(insightsRouter);
portalRouter.use(portalMessagesRouter);
portalRouter.use(promotionsRouter);

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const timezone = z.string().max(64).refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Unknown timezone');

function tagUrl(slug: string, tag: { id: string; mode: string; secret: string | null }) {
  return tag.mode === 'static'
    ? `${config.publicUrl}/t/${slug}?tag=${tag.id}&k=${tag.secret}`
    : `${config.publicUrl}/t/${slug}?picc=00000000000000000000000000000000&cmac=0000000000000000`;
}

portalRouter.get('/stores', async (_req, res) => {
  const stores = await prisma.store.findMany({ where: { ownerId: currentUser(res).id }, orderBy: { createdAt: 'asc' } });
  res.json({ stores: stores.map(ownerStore) });
});

portalRouter.post('/stores', async (req, res) => {
  const body = z
    .object({
      name: z.string().trim().min(1).max(60),
      slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,40}$/, 'Use 3-40 lowercase letters, numbers or dashes'),
      // The owner's browser timezone, so happy hours and birthdays use the shop's clock.
      timezone: timezone.optional(),
    })
    .parse(req.body);
  if (await prisma.store.findUnique({ where: { slug: body.slug } })) throw new HttpError(409, 'slug_taken');
  const store = await prisma.store.create({ data: { ...body, ownerId: currentUser(res).id } });
  res.status(201).json({ store: ownerStore(store) });
});

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => v || null);

portalRouter.patch('/stores/:id', async (req, res) => {
  await ownedStore(res, req.params.id);
  const { hours, ...body } = z
    .object({
      name: z.string().trim().min(1).max(60),
      logoUrl: z.union([z.string().url().startsWith('https://'), z.string().regex(/^\/uploads\/logos\/[\w.-]+$/)]).nullable(),
      bgColor: hexColor,
      textColor: hexColor,
      welcomeStamps: z.number().int().min(0).max(10),
      stampCooldownMinutes: z.number().int().min(0).max(24 * 60),
      timezone,
      birthdayStamps: z.number().int().min(0).max(20),
      description: optionalText(300),
      address: optionalText(160),
      phone: optionalText(30),
      latitude: z.number().min(-90).max(90).nullable(),
      longitude: z.number().min(-180).max(180).nullable(),
      hours: hoursSchema.nullable(),
    })
    .partial()
    .parse(req.body);
  const store = await prisma.store.update({
    where: { id: req.params.id },
    data: { ...body, ...(hours !== undefined && { hours: hours ? JSON.stringify(hours) : null }) },
  });
  syncStoreCard(store);
  res.json({ store: ownerStore(store) });
});

// Logo and cover photo uploads: the raw image is the request body (no multipart needed).
const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg' };
const IMAGE_KINDS = {
  logo: { field: 'logoUrl', folder: 'logos', limit: '2mb' },
  cover: { field: 'coverUrl', folder: 'covers', limit: '3mb' },
} as const;

for (const [kind, spec] of Object.entries(IMAGE_KINDS)) {
  portalRouter.put(`/stores/:id/${kind}`, express.raw({ type: Object.keys(IMAGE_TYPES), limit: spec.limit }), async (req, res) => {
    await ownedStore(res, req.params.id);
    const ext = IMAGE_TYPES[req.get('content-type') ?? ''];
    if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, `${kind}_must_be_png_or_jpg`);
    const file = `${req.params.id}-${randomBytes(4).toString('hex')}.${ext}`;
    const url = await saveUpload(spec.folder, file, req.body, req.get('content-type')!);
    const store = await prisma.store.update({ where: { id: req.params.id }, data: { [spec.field]: url } });
    syncStoreCard(store);
    res.json({ store: ownerStore(store) });
  });
}

portalRouter.delete('/stores/:id/cover', async (req, res) => {
  await ownedStore(res, req.params.id);
  const store = await prisma.store.update({ where: { id: req.params.id }, data: { coverUrl: null } });
  res.json({ store: ownerStore(store) });
});

// --- Reward menu ---

portalRouter.get('/stores/:id/rewards', async (req, res) => {
  await ownedStore(res, req.params.id);
  const store = await ownedStore(res, req.params.id);
  const rewards = await prisma.reward.findMany({ where: { storeId: store.id }, orderBy: { cost: 'asc' } });
  res.json({ rewards: rewards.map((r) => ownerReward(r, store.timezone)) });
});

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const rewardInput = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(140).nullable().optional(),
  cost: z.number().int().min(1).max(500),
  icon: z.enum(REWARD_ICONS).optional(),
  active: z.boolean().optional(),
  // Limited-time window as the shop's local dates (end date included).
  startsOn: localDate.nullable().optional(),
  endsOn: localDate.nullable().optional(),
  perCustomerLimit: z.number().int().min(1).max(50).nullable().optional(),
});

/** Turns the portal's local dates into the stored start and end moments. */
function rewardData(input: Partial<z.infer<typeof rewardInput>>, tz: string) {
  const { startsOn, endsOn, ...rest } = input;
  if (startsOn && endsOn && endsOn < startsOn) throw new HttpError(400, 'ends_before_it_starts');
  const nextDay = (d: string) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + 1)).toISOString().slice(0, 10);
  return {
    ...rest,
    ...(startsOn !== undefined && { startsAt: startsOn ? startOfLocalDate(startsOn, tz) : null }),
    ...(endsOn !== undefined && { endsAt: endsOn ? startOfLocalDate(nextDay(endsOn), tz) : null }),
  };
}

portalRouter.post('/stores/:id/rewards', async (req, res) => {
  const store = await ownedStore(res, req.params.id);
  const input = rewardInput.parse(req.body);
  const reward = await prisma.reward.create({ data: { ...rewardData(input, store.timezone), name: input.name, cost: input.cost, storeId: store.id } });
  syncStoreCard(store);
  res.status(201).json({ reward: ownerReward(reward, store.timezone) });
});

portalRouter.patch('/stores/:id/rewards/:rewardId', async (req, res) => {
  const store = await ownedStore(res, req.params.id);
  const updated = await prisma.reward.updateMany({
    where: { id: req.params.rewardId, storeId: store.id },
    data: rewardData(rewardInput.partial().parse(req.body), store.timezone),
  });
  if (updated.count === 0) throw new HttpError(404, 'reward_not_found');
  syncStoreCard(store);
  res.json({ ok: true });
});

// --- NFC cashier cards ---

portalRouter.get('/stores/:id/tags', async (req, res) => {
  const store = await ownedStore(res, req.params.id);
  const tags = await prisma.nfcTag.findMany({ where: { storeId: store.id }, orderBy: { createdAt: 'asc' } });
  res.json({
    tags: tags.map((t) => ({ id: t.id, label: t.label, mode: t.mode, uid: t.uid, active: t.active, stamps: t.stamps, url: tagUrl(store.slug, t) })),
  });
});

portalRouter.post('/stores/:id/tags', async (req, res) => {
  const store = await ownedStore(res, req.params.id);
  const body = z
    .discriminatedUnion('mode', [
      z.object({ mode: z.literal('static'), label: z.string().trim().min(1).max(40) }),
      z.object({
        mode: z.literal('sun'),
        label: z.string().trim().min(1).max(40),
        uid: z.string().trim().toUpperCase().regex(/^[0-9A-F]{14}$/, 'UID is 7 bytes = 14 hex characters'),
      }),
    ])
    .parse(req.body);

  if (body.mode === 'static') {
    const tag = await prisma.nfcTag.create({
      data: { storeId: store.id, label: body.label, mode: 'static', secret: randomBytes(12).toString('base64url') },
    });
    res.status(201).json({ tag: { id: tag.id, label: tag.label, mode: tag.mode, url: tagUrl(store.slug, tag) } });
    return;
  }

  const { masterKey, metaKey } = config.sun;
  if (!masterKey || !metaKey) throw new HttpError(400, 'sun_keys_not_configured');
  const tag = await prisma.nfcTag.create({ data: { storeId: store.id, label: body.label, mode: 'sun', uid: body.uid } });
  res.status(201).json({
    tag: { id: tag.id, label: tag.label, mode: tag.mode, uid: tag.uid, url: tagUrl(store.slug, tag) },
    // Shown once so it can be written onto the card as its SDM file read key.
    fileKey: deriveFileKey(masterKey, body.uid).toString('hex').toUpperCase(),
  });
});

portalRouter.patch('/stores/:id/tags/:tagId', async (req, res) => {
  await ownedStore(res, req.params.id);
  const body = z.object({ active: z.boolean(), stamps: z.number().int().min(1).max(5) }).partial().parse(req.body);
  const updated = await prisma.nfcTag.updateMany({ where: { id: req.params.tagId, storeId: req.params.id }, data: body });
  if (updated.count === 0) throw new HttpError(404, 'tag_not_found');
  res.json({ ok: true });
});

// --- Counter QR stand + live feed ---

portalRouter.get('/stores/:id/qr.svg', async (req, res) => {
  const store = await ownedStore(res, req.params.id);
  const svg = await QRCode.toString(`${config.publicUrl}/s/${store.slug}`, { type: 'svg', margin: 1, width: 512 });
  res.type('image/svg+xml').send(svg);
});

portalRouter.get('/stores/:id/activity', async (req, res) => {
  const store = await ownedStore(res, req.params.id);
  const [events, members] = await Promise.all([
    prisma.stampEvent.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { membership: { include: { user: { select: { name: true, email: true } } } } },
    }),
    prisma.membership.count({ where: { storeId: store.id } }),
  ]);
  const tags = await prisma.nfcTag.findMany({ where: { storeId: store.id }, select: { id: true, label: true } });
  const tagLabels = new Map(tags.map((t) => [t.id, t.label]));
  res.json({
    members,
    events: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      delta: e.delta,
      rewardName: e.rewardName,
      tag: e.tagId ? tagLabels.get(e.tagId) ?? null : null,
      customer: e.membership.user.name || e.membership.user.email,
      createdAt: e.createdAt,
    })),
  });
});
