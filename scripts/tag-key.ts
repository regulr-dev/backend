// Prints the SDM file read key to program onto an NTAG 424 DNA card.
// Usage: npm run tag:key -- 04A1B2C3D4E5F6
import { config } from '../src/config.js';
import { deriveFileKey } from '../src/nfc/sun.js';

const uid = process.argv[2]?.toUpperCase();
if (!uid || !/^[0-9A-F]{14}$/.test(uid)) {
  console.error('Usage: npm run tag:key -- <7-byte UID as 14 hex chars>');
  process.exit(1);
}
if (!config.sun.masterKey || !config.sun.metaKey) {
  console.error('Set SUN_META_KEY and SUN_MASTER_KEY in .env first.');
  process.exit(1);
}
console.log(`UID:                ${uid}`);
console.log(`SDM meta read key:  ${config.sun.metaKey.toString('hex').toUpperCase()}  (same for every card)`);
console.log(`SDM file read key:  ${deriveFileKey(config.sun.masterKey, uid).toString('hex').toUpperCase()}`);
