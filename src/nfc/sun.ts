// NTAG 424 DNA "Secure Unique NFC" (SUN) message verification, per NXP AN12196.
// Each tap the chip mirrors an encrypted PICC block (UID + tap counter) and a
// truncated CMAC into the URL, so a copied URL can't be replayed.
import { createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';

const ZERO_BLOCK = Buffer.alloc(16);

function aesEncryptBlock(key: Buffer, block: Buffer) {
  const cipher = createCipheriv('aes-128-ecb', key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
}

function shiftLeft(buf: Buffer) {
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = ((buf[i] << 1) | (i + 1 < buf.length ? buf[i + 1] >> 7 : 0)) & 0xff;
  }
  return out;
}

function xor(a: Buffer, b: Buffer) {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

/** AES-128 CMAC (RFC 4493). */
export function aesCmac(key: Buffer, message: Buffer): Buffer {
  const l = aesEncryptBlock(key, ZERO_BLOCK);
  const k1 = shiftLeft(l);
  if (l[0] & 0x80) k1[15] ^= 0x87;
  const k2 = shiftLeft(k1);
  if (k1[0] & 0x80) k2[15] ^= 0x87;

  const blocks = Math.max(1, Math.ceil(message.length / 16));
  const complete = message.length > 0 && message.length % 16 === 0;
  let last: Buffer;
  if (complete) {
    last = xor(message.subarray((blocks - 1) * 16), k1);
  } else {
    const padded = Buffer.alloc(16);
    const tail = message.subarray((blocks - 1) * 16);
    tail.copy(padded);
    padded[tail.length] = 0x80;
    last = xor(padded, k2);
  }

  let x: Buffer = ZERO_BLOCK;
  for (let i = 0; i < blocks - 1; i++) {
    x = aesEncryptBlock(key, xor(x, message.subarray(i * 16, i * 16 + 16)));
  }
  return aesEncryptBlock(key, xor(x, last));
}

export type PiccData = { uid: string; counter: number };

/** Decrypt the encrypted PICC data (32 hex chars) with the SDM meta read key. */
export function decryptPicc(metaKey: Buffer, piccHex: string): PiccData | null {
  if (!/^[0-9a-fA-F]{32}$/.test(piccHex)) return null;
  const decipher = createDecipheriv('aes-128-cbc', metaKey, ZERO_BLOCK);
  decipher.setAutoPadding(false);
  const data = Buffer.concat([decipher.update(Buffer.from(piccHex, 'hex')), decipher.final()]);
  // 0xC7 = UID mirrored + counter mirrored + 7-byte UID. Anything else means a wrong key.
  if (data[0] !== 0xc7) return null;
  return { uid: data.subarray(1, 8).toString('hex').toUpperCase(), counter: data.readUIntLE(8, 3) };
}

/** Check the 8-byte truncated SDM MAC (16 hex chars) using the tag's file read key. */
export function verifySunMac(fileKey: Buffer, picc: PiccData, macHex: string): boolean {
  if (!/^[0-9a-fA-F]{16}$/.test(macHex)) return false;
  const counter = Buffer.alloc(3);
  counter.writeUIntLE(picc.counter, 0, 3);
  const sv2 = Buffer.concat([Buffer.from([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80]), Buffer.from(picc.uid, 'hex'), counter]);
  const sessionKey = aesCmac(fileKey, sv2);
  const full = aesCmac(sessionKey, Buffer.alloc(0));
  const truncated = Buffer.from([1, 3, 5, 7, 9, 11, 13, 15].map((i) => full[i]));
  return timingSafeEqual(truncated, Buffer.from(macHex, 'hex'));
}

/** Per-card file key, derived from the master key so no per-card secret is stored. */
export function deriveFileKey(masterKey: Buffer, uidHex: string): Buffer {
  return aesCmac(masterKey, Buffer.concat([Buffer.from([0x01]), Buffer.from(uidHex, 'hex')]));
}
