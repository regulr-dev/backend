import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeHappyHour, birthdayYearNear, describeDays, localTime, startOfLocalDate, upcomingToday } from '../shared/promotions.js';

const TZ = 'Europe/Budapest';
const weekdayLunch = { name: 'Lunch rush', multiplier: 2, days: '12345', startTime: '14:00', endTime: '16:00', startsOn: null, endsOn: null };

test('local time follows the shop timezone, not UTC', () => {
  // 2026-11-03 13:30 UTC is 14:30 on a Tuesday in Budapest (CET, UTC+1).
  const t = localTime(new Date('2026-11-03T13:30:00Z'), TZ);
  assert.deepEqual([t.date, t.minutes, t.weekday], ['2026-11-03', 14 * 60 + 30, 2]);
});

test('happy hour runs inside its window on its days only', () => {
  assert.equal(activeHappyHour([weekdayLunch], new Date('2026-11-03T13:30:00Z'), TZ)?.name, 'Lunch rush'); // Tue 14:30
  assert.equal(activeHappyHour([weekdayLunch], new Date('2026-11-03T15:00:00Z'), TZ), null); // Tue 16:00, end is exclusive
  assert.equal(activeHappyHour([weekdayLunch], new Date('2026-11-07T13:30:00Z'), TZ), null); // Saturday
});

test('the biggest multiplier wins when happy hours overlap', () => {
  const triple = { ...weekdayLunch, name: 'Triple', multiplier: 3, startTime: '15:00', endTime: '15:30' };
  assert.equal(activeHappyHour([weekdayLunch, triple], new Date('2026-11-03T14:10:00Z'), TZ)?.name, 'Triple');
});

test('date ranges and switched-off happy hours are respected', () => {
  const at = new Date('2026-11-03T13:30:00Z');
  assert.equal(activeHappyHour([{ ...weekdayLunch, startsOn: '2026-11-04' }], at, TZ), null);
  assert.equal(activeHappyHour([{ ...weekdayLunch, endsOn: '2026-11-03' }], at, TZ)?.name, 'Lunch rush');
  assert.equal(activeHappyHour([{ ...weekdayLunch, active: false }], at, TZ), null);
});

test("today's list drops happy hours that already ended", () => {
  assert.equal(upcomingToday([weekdayLunch], new Date('2026-11-03T10:00:00Z'), TZ).length, 1);
  assert.equal(upcomingToday([weekdayLunch], new Date('2026-11-03T16:00:00Z'), TZ).length, 0);
});

test('a shop-local date starts at local midnight, across daylight saving', () => {
  assert.equal(startOfLocalDate('2026-11-01', TZ).toISOString(), '2026-10-31T23:00:00.000Z'); // winter, UTC+1
  assert.equal(startOfLocalDate('2026-07-01', TZ).toISOString(), '2026-06-30T22:00:00.000Z'); // summer, UTC+2
});

test('birthday bonus window works across New Year', () => {
  const jan2 = localTime(new Date('2027-01-02T10:00:00Z'), TZ);
  assert.equal(birthdayYearNear(12, 31, jan2), 2026);
  assert.equal(birthdayYearNear(1, 10, jan2), null);
  assert.equal(birthdayYearNear(1, 4, jan2), 2027);
});

test('days read naturally', () => {
  assert.equal(describeDays('12345'), 'Mon–Fri');
  assert.equal(describeDays('67'), 'Sat, Sun');
  assert.equal(describeDays('1234567'), 'Every day');
});
