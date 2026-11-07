import type { Reward, Store } from '@prisma/client';
import { z } from 'zod';
import { config } from './config.js';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

// Monday first, one entry per day.
export const hoursSchema = z
  .array(z.object({ closed: z.boolean(), open: time, close: time }))
  .length(7);
export type Hours = z.infer<typeof hoursSchema>;

export function parseHours(raw: string | null): Hours | null {
  if (!raw) return null;
  const parsed = hoursSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

/** Logos are either a pasted https URL or a file we host under /uploads. */
export function absoluteLogoUrl(logoUrl: string | null) {
  if (!logoUrl) return null;
  return logoUrl.startsWith('/') ? `${config.publicUrl}${logoUrl}` : logoUrl;
}

type PublicReward = Pick<Reward, 'id' | 'name' | 'description' | 'cost' | 'icon'>;

/** What anyone can see about a store: branding, profile, reward menu. */
export function publicStore(store: Store, rewards: PublicReward[]) {
  return {
    name: store.name,
    slug: store.slug,
    logoUrl: store.logoUrl,
    coverUrl: store.coverUrl,
    bgColor: store.bgColor,
    textColor: store.textColor,
    welcomeStamps: store.welcomeStamps,
    description: store.description,
    address: store.address,
    phone: store.phone,
    latitude: store.latitude,
    longitude: store.longitude,
    hours: parseHours(store.hours),
    rewards,
  };
}

/** Everything the owner edits in the portal. */
export function ownerStore(store: Store) {
  return { ...store, hours: parseHours(store.hours) };
}
