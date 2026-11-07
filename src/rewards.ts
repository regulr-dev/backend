import type { Prisma, Promotion, Reward } from '@prisma/client';
import { activeHappyHour, localTime, upcomingToday } from '../shared/promotions.js';

/** Rewards customers can see and claim now: shown, and inside their date window if they have one. */
export function liveRewardWhere(now = new Date()): Prisma.RewardWhereInput {
  return {
    active: true,
    AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
  };
}

export const publicRewardSelect = { id: true, name: true, description: true, cost: true, icon: true, endsAt: true, perCustomerLimit: true } as const;

/** For the portal: the reward with its date window as shop-local dates (end date inclusive). */
export function ownerReward(r: Reward, tz: string) {
  return {
    ...r,
    startsOn: r.startsAt ? localTime(r.startsAt, tz).date : null,
    endsOn: r.endsAt ? localTime(new Date(r.endsAt.getTime() - 1), tz).date : null,
  };
}

const publicHappyHour = (p: Promotion) => ({ name: p.name, multiplier: p.multiplier, startTime: p.startTime, endTime: p.endTime });

/** What customers see about a shop's happy hours: the one running now and the rest of today's. */
export function happyHourStatus(promos: Promotion[], tz: string, now = new Date()) {
  const active = activeHappyHour(promos, now, tz);
  return {
    now: active && publicHappyHour(active),
    today: upcomingToday(promos, now, tz).map(publicHappyHour),
  };
}
