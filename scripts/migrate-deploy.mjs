// Applies database migrations during the Vercel build (`npm run vercel-build`).
// Migrations need Neon's direct connection (DATABASE_URL_UNPOOLED). If only the pooled
// DATABASE_URL is set, the direct one is the same address without "-pooler".
import { execSync } from 'node:child_process';

const env = { ...process.env };
if (!env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it in Vercel → Settings → Environment Variables, then redeploy.');
  process.exit(1);
}
if (!env.DATABASE_URL_UNPOOLED) {
  env.DATABASE_URL_UNPOOLED = env.DATABASE_URL.replace('-pooler.', '.');
  console.log('DATABASE_URL_UNPOOLED is not set: using DATABASE_URL without the pooler for migrations.');
}
execSync('npx prisma migrate deploy', { stdio: 'inherit', env });
