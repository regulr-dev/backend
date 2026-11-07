import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampArtSvg, stampProgress } from '../shared/stampArt.js';
import { notificationFor } from '../src/wallet/index.js';

const menu = [
  { name: 'Espresso', cost: 5 },
  { name: 'Croissant', cost: 10 },
];

test('a stamp that unlocks a reward says it is ready', () => {
  assert.deepEqual(notificationFor('Bean There', menu, 5, { kind: 'stamp', added: 1 }), {
    header: 'Espresso is ready!',
    body: 'Show your Bean There card at the counter to claim it.',
  });
});

test('an ordinary stamp says how far the next reward is', () => {
  assert.deepEqual(notificationFor('Bean There', menu, 7, { kind: 'stamp', added: 1 }), {
    header: '+1 stamp at Bean There',
    body: 'Espresso ready · 3 more for Croissant.',
  });
});

test('a claimed reward says what is left', () => {
  assert.deepEqual(notificationFor('Bean There', menu, 2, { kind: 'redeem', rewardName: 'Croissant', cost: 10 }), {
    header: 'Enjoy your Croissant!',
    body: 'You used 10 stamps at Bean There. 2 left.',
  });
});

test('progress points at the next reward the customer cannot afford yet', () => {
  assert.equal(stampProgress(menu, 7)?.goal.name, 'Croissant');
  assert.equal(stampProgress(menu, 7)?.ready?.name, 'Espresso');
  assert.equal(stampProgress(menu, 12)?.toGo, 0);
  assert.equal(stampProgress([], 3), null);
});

test('the card picture escapes the photo URL', () => {
  const svg = stampArtSvg({ bg: '#000000', fg: '#ffffff', balance: 1, rewards: menu, photo: '/x.jpg"><script>' });
  assert.ok(!svg.includes('<script>'));
});

test('a stamp added by the shop shows its reason', () => {
  assert.deepEqual(notificationFor('Bean There', menu, 3, { kind: 'adjust', added: 2, note: 'Birthday treat' }), {
    header: '+2 stamps from Bean There',
    body: 'Birthday treat',
  });
});

test('stamps removed by the shop say what is left', () => {
  assert.deepEqual(notificationFor('Bean There', menu, 4, { kind: 'adjust', added: -1, note: 'Tapped twice by mistake' }), {
    header: 'Bean There updated your card',
    body: '1 stamp removed: Tapped twice by mistake. 4 left.',
  });
});
