import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aesCmac, decryptPicc, verifySunMac } from '../src/nfc/sun.js';

test('AES-CMAC matches RFC 4493 vectors', () => {
  const key = Buffer.from('2b7e151628aed2a6abf7158809cf4f3c', 'hex');
  assert.equal(aesCmac(key, Buffer.alloc(0)).toString('hex'), 'bb1d6929e95937287fa37d129b756746');
  assert.equal(
    aesCmac(key, Buffer.from('6bc1bee22e409f96e93d7e117393172a', 'hex')).toString('hex'),
    '070a16b46b4d4144f79bdd9dd04a287c',
  );
});

// Example SUN message from NXP AN12196 (all-zero keys).
const zeroKey = Buffer.alloc(16);
const picc = 'EF963FF7828658A599F3041510671E88';
const cmac = '94EED9EE65337086';

test('decrypts the PICC data from the NXP example', () => {
  assert.deepEqual(decryptPicc(zeroKey, picc), { uid: '04DE5F1EACC040', counter: 61 });
});

test('accepts the genuine MAC and rejects a tampered one', () => {
  const data = decryptPicc(zeroKey, picc)!;
  assert.equal(verifySunMac(zeroKey, data, cmac), true);
  assert.equal(verifySunMac(zeroKey, data, '94EED9EE65337087'), false);
  assert.equal(verifySunMac(zeroKey, { ...data, counter: 62 }, cmac), false);
});

test('rejects PICC data decrypted with the wrong key', () => {
  assert.equal(decryptPicc(Buffer.alloc(16, 1), picc), null);
});
