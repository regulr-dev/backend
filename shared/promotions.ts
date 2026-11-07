// Shop-local time and happy hours, shared by the server (stamping) and the app (banners).
// Everything runs in the shop's own IANA timezone: the server's clock is UTC on Vercel.

export type HappyHour = {
  name: string;
  multiplier: number;
  /** ISO weekdays, Monday = 1: "12345" is Monday to Friday. */
  days: string;
  startTime: string;
  endTime: string;
  /** Optional inclusive date range, shop-local YYYY-MM-DD. */
  startsOn: string | null;
  endsOn: string | null;
  active?: boolean;
};

export type LocalTime = { year: number; month: number; day: number; date: string; minutes: number; weekday: number };

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const formatters = new Map<string, Intl.DateTimeFormat>();

/** The wall-clock date and time in a timezone. */
export function localTime(date: Date, tz: string): LocalTime {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  const parts = f.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
    weekday: WEEKDAYS.indexOf(get('weekday')) + 1,
  };
}

/** The moment a shop-local date starts (midnight in that timezone). */
export function startOfLocalDate(date: string, tz: string) {
  const [y, m, d] = date.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d);
  let t = target;
  // Two passes settle the timezone offset, including on daylight-saving days.
  for (let i = 0; i < 2; i++) {
    const l = localTime(new Date(t), tz);
    t += target - Date.UTC(l.year, l.month - 1, l.day, Math.floor(l.minutes / 60), l.minutes % 60);
  }
  return new Date(t);
}

export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function runsOn(p: HappyHour, now: LocalTime) {
  return p.active !== false && p.days.includes(String(now.weekday)) && (!p.startsOn || now.date >= p.startsOn) && (!p.endsOn || now.date <= p.endsOn);
}

/** The happy hour running right now (the biggest multiplier if several overlap). */
export function activeHappyHour<T extends HappyHour>(promos: T[], now: Date, tz: string): T | null {
  const local = localTime(now, tz);
  const running = promos.filter((p) => runsOn(p, local) && local.minutes >= toMinutes(p.startTime) && local.minutes < toMinutes(p.endTime));
  return running.sort((a, b) => b.multiplier - a.multiplier)[0] ?? null;
}

/** Today's happy hours that haven't ended yet, earliest first. */
export function upcomingToday<T extends HappyHour>(promos: T[], now: Date, tz: string): T[] {
  const local = localTime(now, tz);
  return promos.filter((p) => runsOn(p, local) && local.minutes < toMinutes(p.endTime)).sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
}

/** "Mon–Fri", "Sat, Sun", "Every day" for a days string. */
export function describeDays(days: string) {
  if (days.length === 7) return 'Every day';
  const nums = [...days].map(Number).sort();
  const consecutive = nums.length > 2 && nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  return consecutive ? `${WEEKDAYS[nums[0] - 1]}–${WEEKDAYS[nums[nums.length - 1] - 1]}` : nums.map((n) => WEEKDAYS[n - 1]).join(', ');
}

/**
 * If `now` is within `window` days of the birthday, the year of that birthday (so the
 * bonus is given once per birthday, even across New Year). Otherwise null.
 */
export function birthdayYearNear(month: number, day: number, now: LocalTime, window = 3): number | null {
  const today = Date.UTC(now.year, now.month - 1, now.day);
  for (const year of [now.year - 1, now.year, now.year + 1]) {
    const birthday = Date.UTC(year, month - 1, day);
    if (Math.abs(today - birthday) <= window * 86_400_000) return year;
  }
  return null;
}
