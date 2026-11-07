import type { Promotion, Reward, Store } from '@prisma/client';
import { describeDays, localTime } from '../../shared/promotions.js';
import { config } from '../config.js';
import { parseHours } from '../stores.js';

// The text on the back of a shop's Wallet pass (Google calls them "details"): reward menu,
// happy hours, opening hours, how it works, and links. Shared by every customer's pass, so it
// lives on the pass class and is refreshed whenever the shop changes any of it.

type Module = { id: string; header: string; body: string };

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function rewardLine(r: Pick<Reward, 'name' | 'cost' | 'endsAt' | 'perCustomerLimit'>, tz: string) {
  const extras = [
    r.perCustomerLimit === 1 ? 'once per customer' : r.perCustomerLimit ? `${r.perCustomerLimit}× per customer` : null,
    r.endsAt ? `until ${new Date(r.endsAt.getTime() - 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: tz })}` : null,
  ].filter(Boolean);
  return `${r.cost} ⭑  ${r.name}${extras.length ? ` (${extras.join(', ')})` : ''}`;
}

export function passDetails(store: Store, rewards: Pick<Reward, 'name' | 'cost' | 'endsAt' | 'perCustomerLimit'>[], promotions: Promotion[]): Module[] {
  const modules: Module[] = [];
  if (rewards.length) {
    modules.push({
      id: 'rewards',
      header: 'Reward menu',
      body: [...rewards].sort((a, b) => a.cost - b.cost).map((r) => rewardLine(r, store.timezone)).join('\n'),
    });
  }
  const today = localTime(new Date(), store.timezone).date;
  const running = promotions.filter((p) => p.active && (!p.endsOn || p.endsOn >= today));
  if (running.length) {
    modules.push({
      id: 'happy',
      header: 'Happy hours',
      body: running
        .map((p) => {
          const dates = p.startsOn || p.endsOn ? ` (${p.startsOn ?? ''}–${p.endsOn ?? ''})` : '';
          return `${describeDays(p.days)} ${p.startTime}–${p.endTime}: ${p.multiplier === 2 ? 'double' : 'triple'} stamps${dates}`;
        })
        .join('\n'),
    });
  }
  if (store.birthdayStamps > 0) {
    modules.push({
      id: 'birthday',
      header: 'Birthday treat 🎂',
      body: `Add your birthday in the Regulr app and get ${store.birthdayStamps} bonus stamps on a visit around it.`,
    });
  }
  const hours = parseHours(store.hours);
  if (hours) {
    modules.push({
      id: 'hours',
      header: 'Opening hours',
      body: hours.map((d, i) => `${DAY_NAMES[i]}  ${d.closed ? 'closed' : `${d.open}–${d.close}`}`).join('\n'),
    });
  }
  modules.push({
    id: 'how',
    header: 'How it works',
    body: "Ask the cashier to tap their card on your phone to collect stamps. Spend them on anything on the reward menu, and your stamps never reset.",
  });
  return modules;
}

/** Links on the back of the pass: directions and calling the shop (the card link is per customer). */
export function passLinks(store: Store) {
  const uris: { id: string; uri: string; description: string }[] = [];
  if (store.latitude !== null && store.longitude !== null) {
    uris.push({ id: 'directions', uri: `https://www.google.com/maps/dir/?api=1&destination=${store.latitude},${store.longitude}`, description: 'Directions' });
  }
  if (store.phone) uris.push({ id: 'call', uri: `tel:${store.phone.replace(/[^\d+]/g, '')}`, description: `Call ${store.name}` });
  return uris;
}

/** The customer's own web card: claim rewards, see history and messages. */
export const cardUrl = (store: Store) => `${config.frontendUrl}/s/${store.slug}`;
