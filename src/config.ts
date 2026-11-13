import 'dotenv/config';
import { readFileSync } from 'node:fs';

const isProd = process.env.NODE_ENV === 'production';

function hexKey(name: string): Buffer | null {
  const value = process.env[name]?.trim();
  if (!value) return null;
  if (!/^[0-9a-fA-F]{32}$/.test(value)) throw new Error(`${name} must be 32 hex characters (AES-128 key)`);
  return Buffer.from(value, 'hex');
}

/**
 * The service account key comes from GOOGLE_WALLET_KEY_JSON (the file's contents, plain or
 * base64; used on Vercel, which has no secrets folder) or GOOGLE_WALLET_KEY_FILE (a path).
 */
function googleWalletConfig() {
  const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID?.trim();
  const keyJson = process.env.GOOGLE_WALLET_KEY_JSON?.trim();
  const keyFile = process.env.GOOGLE_WALLET_KEY_FILE?.trim();
  if (!issuerId || (!keyJson && !keyFile)) return null;
  try {
    const raw = keyJson
      ? keyJson.startsWith('{')
        ? keyJson
        : Buffer.from(keyJson, 'base64').toString('utf8')
      : readFileSync(keyFile!, 'utf8');
    const key = JSON.parse(raw) as { client_email: string; private_key: string };
    return { issuerId, clientEmail: key.client_email, privateKey: key.private_key };
  } catch (err) {
    console.error('Failed to parse Google Wallet config:', err);
    return null;
  }
}

// On Vercel, fall back to the project's production domain when PUBLIC_URL isn't set.
const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null;

const sessionSecret = process.env.SESSION_SECRET || (isProd ? '' : 'dev-only-session-secret');
if (!sessionSecret) throw new Error('SESSION_SECRET is required in production');

const devLogin = process.env.DEV_LOGIN === 'true';
if (devLogin && isProd) throw new Error('DEV_LOGIN must not be enabled in production');

export const config = {
  port: Number(process.env.PORT ?? 3001),
  publicUrl: (process.env.PUBLIC_URL || vercelUrl || 'http://localhost:3001').replace(/\/$/, ''),
  frontendUrl: (process.env.FRONTEND_URL || (isProd ? 'https://frontend-three-blush-64.vercel.app' : 'http://localhost:3000')).replace(/\/$/, ''),
  isProd,
  sessionSecret,
  devLogin,
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() ?? '',
  googleWallet: googleWalletConfig(),
  sun: { metaKey: hexKey('SUN_META_KEY'), masterKey: hexKey('SUN_MASTER_KEY') },
  // How long a tap keeps the reward menu unlocked.
  tapSessionMinutes: 5,
};
