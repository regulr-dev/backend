import { Router, type NextFunction, type Request, type Response } from 'express';
import type { User } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { config } from './config.js';
import { prisma } from './db.js';
import { HttpError } from './errors.js';

const COOKIE = 'regulr_session';
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const googleClient = new OAuth2Client();

// Long-lived cookie so a returning customer is recognised the moment the cashier taps.
function setSession(res: Response, userId: string) {
  const token = jwt.sign({ sub: userId }, config.sessionSecret, { expiresIn: '365d' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: ONE_YEAR_MS });
}

export function clearSession(res: Response) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: config.isProd });
}

export async function getUser(req: Request): Promise<User | null> {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    const { sub } = jwt.verify(token, config.sessionSecret) as jwt.JwtPayload;
    return sub ? await prisma.user.findUnique({ where: { id: sub } }) : null;
  } catch {
    return null;
  }
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const user = await getUser(req);
  if (!user) throw new HttpError(401, 'not_signed_in');
  res.locals.user = user;
  next();
}

export function currentUser(res: Response): User {
  return res.locals.user as User;
}

export const authRouter = Router();

authRouter.get('/me', async (req, res) => {
  const user = await getUser(req);
  res.json({ user: user && { id: user.id, email: user.email, name: user.name, birthMonth: user.birthMonth, birthDay: user.birthDay } });
});

authRouter.post('/auth/google', async (req, res) => {
  if (!config.googleClientId) throw new HttpError(400, 'google_signin_not_configured');
  const { credential } = z.object({ credential: z.string() }).parse(req.body);
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: config.googleClientId });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified) throw new HttpError(401, 'google_email_not_verified');

  const email = payload.email.toLowerCase();
  const user = await prisma.user.upsert({
    where: { email },
    update: { googleSub: payload.sub, name: payload.name ?? undefined },
    create: { email, googleSub: payload.sub, name: payload.name },
  });
  setSession(res, user.id);
  res.json({ user: { id: user.id, email: user.email, name: user.name } });
});

authRouter.post('/auth/dev', async (req, res) => {
  if (!config.devLogin) throw new HttpError(404, 'not_found');
  const body = z.object({ email: z.string().email(), name: z.string().max(80).optional() }).parse(req.body);
  const email = body.email.toLowerCase();
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: body.name || email.split('@')[0] },
  });
  setSession(res, user.id);
  res.json({ user: { id: user.id, email: user.email, name: user.name } });
});

authRouter.post('/auth/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});
