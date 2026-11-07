import { Router } from 'express';
import { prisma } from '../db.js';
import { audienceInput, audienceMembers, DAILY_LIMIT, messageInput, sendMessage, sentInLastDay } from '../messages.js';
import { ownedStore } from './owned.js';

// Portal side of shop messages (mounted under /api/portal, owners only).
export const portalMessagesRouter = Router();

/** How many customers a message would reach, before sending it. */
portalMessagesRouter.post('/stores/:id/messages/audience', async (req, res) => {
  const store = await ownedStore(res, String(req.params.id));
  const { audience, days } = audienceInput.parse(req.body);
  const members = await audienceMembers(store.id, audience, days);
  res.json({ count: members.length, inWallet: members.filter((m) => m.googleObjectId).length });
});

portalMessagesRouter.get('/stores/:id/messages', async (req, res) => {
  const store = await ownedStore(res, String(req.params.id));
  const [messages, sentToday, optedOut] = await Promise.all([
    prisma.message.findMany({ where: { storeId: store.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    sentInLastDay(store.id),
    prisma.membership.count({ where: { storeId: store.id, messagesOff: true } }),
  ]);
  const reads = await prisma.messageDelivery.groupBy({
    by: ['messageId'],
    where: { messageId: { in: messages.map((m) => m.id) }, readAt: { not: null } },
    _count: { _all: true },
  });
  const readBy = new Map(reads.map((r) => [r.messageId, r._count._all]));
  res.json({
    remainingToday: Math.max(0, DAILY_LIMIT - sentToday),
    dailyLimit: DAILY_LIMIT,
    optedOut,
    messages: messages.map((m) => ({ ...m, read: readBy.get(m.id) ?? 0 })),
  });
});

portalMessagesRouter.post('/stores/:id/messages', async (req, res) => {
  const store = await ownedStore(res, String(req.params.id));
  const message = await sendMessage(store, messageInput.parse(req.body));
  res.status(201).json({ message: { ...message, read: 0 } });
});
