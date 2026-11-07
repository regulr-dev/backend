import { timingSafeEqual } from 'node:crypto';
import type { NfcTag } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { decryptPicc, deriveFileKey, verifySunMac } from './sun.js';

type TapQuery = Record<string, unknown>;

function sameSecret(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Returns the tag that produced this tap, or null if the tap is not genuine. */
export async function verifyTap(storeId: string, query: TapQuery): Promise<NfcTag | null> {
  // NTAG 424 DNA: /t/<slug>?picc=<32 hex>&cmac=<16 hex>
  if (typeof query.picc === 'string' && typeof query.cmac === 'string') {
    const { metaKey, masterKey } = config.sun;
    if (!metaKey || !masterKey) return null;
    const picc = decryptPicc(metaKey, query.picc);
    if (!picc) return null;
    const tag = await prisma.nfcTag.findUnique({ where: { uid: picc.uid } });
    if (!tag || tag.storeId !== storeId || !tag.active || tag.mode !== 'sun') return null;
    if (!verifySunMac(deriveFileKey(masterKey, picc.uid), picc, query.cmac)) return null;
    // The counter must go up on every tap; a repeat means a replayed URL.
    const advanced = await prisma.nfcTag.updateMany({
      where: { id: tag.id, lastCounter: { lt: picc.counter } },
      data: { lastCounter: picc.counter },
    });
    return advanced.count === 1 ? tag : null;
  }

  // Static prototype tag: /t/<slug>?tag=<id>&k=<secret>
  if (typeof query.tag === 'string' && typeof query.k === 'string') {
    const tag = await prisma.nfcTag.findUnique({ where: { id: query.tag } });
    if (!tag || tag.storeId !== storeId || !tag.active || tag.mode !== 'static' || !tag.secret) return null;
    return sameSecret(tag.secret, query.k) ? tag : null;
  }

  return null;
}
