// Pins the streak day-deduplication rule investigated on 2026-08-05: multiple
// activities on the same local day — different sports, different timestamps,
// noon-anchored /log dates or raw "now" ISO strings — count as ONE streak day.
// (The reported "streak of 2 from two same-day activities" turned out to be a
// correct streak spanning two consecutive days; every consumer routes through
// this shared helper, so this test is the single place the rule is asserted.)
const test = require('node:test');
const assert = require('node:assert');
const { computeStreaks } = require('./tzdate.js');

// Fixed "now" so the assertions never rot: 2026-08-05 20:00Z.
const NOW = Date.parse('2026-08-05T20:00:00Z');

test('two same-day activities in different sports count as one streak day', () => {
  const acts = [
    { sport: 'cycling', date: '2026-08-05T12:00:00.000Z' },
    { sport: 'weightlifting', date: '2026-08-05T12:00:00.000Z' }
  ];
  assert.deepStrictEqual(computeStreaks(acts, 'UTC', NOW), { currentStreak: 1, longestStreak: 1 });
  assert.deepStrictEqual(computeStreaks(acts, 'Europe/London', NOW), { currentStreak: 1, longestStreak: 1 });
});

test('mixed noon-anchor and raw-now timestamps on the same local day dedupe', () => {
  const acts = [
    { sport: 'cycling', date: '2026-08-05T11:00:00.000Z' },   // noon London (BST)
    { sport: 'weightlifting', date: '2026-08-05T19:30:00.000Z' } // 20:30 London same day
  ];
  assert.strictEqual(computeStreaks(acts, 'Europe/London', NOW).currentStreak, 1);
});

test('same-day dedupe holds for sub-second-different timestamps', () => {
  const acts = [
    { sport: 'cycling', date: '2026-08-05T12:00:00.000Z' },
    { sport: 'weightlifting', date: '2026-08-05T12:00:00.001Z' }
  ];
  assert.strictEqual(computeStreaks(acts, 'UTC', NOW).currentStreak, 1);
});

test('two same-day activities plus the previous day = streak 2 (the observed, correct case)', () => {
  const acts = [
    { sport: 'cycling', date: '2026-08-04T19:00:00+00:00' },  // noon Pacific Aug 4
    { sport: 'weightlifting', date: '2026-08-04T19:00:00+00:00' },
    { sport: 'cycling', date: '2026-08-03T19:00:00+00:00' }   // noon Pacific Aug 3
  ];
  const r = computeStreaks(acts, 'America/Los_Angeles', Date.parse('2026-08-05T02:00:00Z')); // Aug 4 evening Pacific
  assert.deepStrictEqual(r, { currentStreak: 2, longestStreak: 2 });
});
