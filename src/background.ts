import { waitUntil } from '@vercel/functions';

/**
 * Runs work after the response is sent (Wallet updates, notifications), so customers
 * never wait on Google. On Vercel the function would otherwise be frozen as soon as the
 * response is out, so waitUntil keeps it alive until the work finishes. Elsewhere the
 * long-lived server simply carries on.
 */
export function background(label: string, task: () => Promise<unknown>) {
  const done = task().catch((err) => console.error(`[${label}]`, err));
  try {
    waitUntil(done);
  } catch {
    // Not running on Vercel: nothing to extend.
  }
}
