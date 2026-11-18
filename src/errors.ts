import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  /** `detail` is shown to the user next to the error, e.g. why an upload failed. */
  constructor(public status: number, public code: string, public detail?: string) {
    super(code);
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code, ...(err.detail && { detail: err.detail }) });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'invalid_input', issues: err.issues });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'server_error' });
}
