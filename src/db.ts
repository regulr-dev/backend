import { PrismaClient } from '@prisma/client';

// The schema names a direct connection for migrations; the app itself only uses the
// pooled DATABASE_URL, so fall back to it rather than fail when the direct one is unset.
process.env.DATABASE_URL_UNPOOLED ||= process.env.DATABASE_URL?.replace('-pooler.', '.');

export const prisma = new PrismaClient();
