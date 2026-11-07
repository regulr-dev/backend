import type { Response } from 'express';
import { currentUser } from '../auth.js';
import { prisma } from '../db.js';
import { HttpError } from '../errors.js';

/** The store, if the signed-in user owns it. Anyone else gets a 404, so store ids can't be probed. */
export async function ownedStore(res: Response, storeId: string) {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store || store.ownerId !== currentUser(res).id) throw new HttpError(404, 'store_not_found');
  return store;
}
