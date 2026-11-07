// Vercel serverless function. Every API call, NFC tap link and Wallet picture is routed
// here (see the rewrites in vercel.json); everything else is the static React app.
// src/app.ts is bundled into server-dist/ by `npm run build:api` during the Vercel build.
export { default } from '../server-dist/app.mjs';
