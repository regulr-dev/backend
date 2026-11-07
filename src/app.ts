import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { authRouter } from './auth.js';
import { errorHandler } from './errors.js';
import { customerRouter } from './routes/customer.js';
import { portalRouter } from './routes/portal.js';
import { tapRouter } from './routes/tap.js';
import { UPLOADS_DIR } from './uploads.js';
import { artRouter } from './wallet/art.js';

export const app = express();
app.set('trust proxy', 1);

const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        origin.endsWith('.vercel.app') ||
        allowedOrigins.includes(origin) ||
        process.env.NODE_ENV !== 'production'
      ) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.use(tapRouter);
app.use(artRouter);
app.use('/api', authRouter);
app.use('/api', customerRouter);
app.use('/api/portal', portalRouter);
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// Only used without Vercel Blob (local development): uploads are on disk.
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));
app.use(errorHandler);

export default app;
