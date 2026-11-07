import { Router } from 'express';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { verifyTap } from '../nfc/verify.js';

export const tapRouter = Router();

// The URL written on the cashier's NFC card. Verifies the tap, then hands off to
// the customer web app, which turns it into a stamp once it knows who the customer is.
tapRouter.get('/t/:slug', async (req, res) => {
  const store = await prisma.store.findUnique({ where: { slug: req.params.slug } });
  if (!store) {
    res.status(404).send('Unknown store');
    return;
  }

  const tag = await verifyTap(store.id, req.query);
  if (!tag) {
    res.redirect(`/s/${store.slug}?tap_error=1`);
    return;
  }

  const tap = await prisma.tapSession.create({
    data: { storeId: store.id, tagId: tag.id, expiresAt: new Date(Date.now() + config.tapSessionMinutes * 60_000) },
  });
  res.redirect(`/s/${store.slug}?tap=${tap.id}`);
});
