const test = require('node:test');
const assert = require('node:assert/strict');
const { computeStreaks } = require('./tzdate');
const { load } = require('./scripts/lib/goal-data-proof.cjs');
const { createAiInsightsRuntime } = require('./ai-insights-runtime');
const now = '2026-10-07T15:00:00Z';
const tz = 'America/Los_Angeles';
const user = { id: 'fixture', user_metadata: { timezone: tz } };
const row = date => ({ id: date, sport: 'running', distance: '2 km', duration: '01:00:00', date });
const today = row('2026-10-08T06:30:00Z'); // 23:30 today, after the frozen instant
const tomorrow = row('2026-10-08T07:30:00Z');
function db(rows) {
  return { from() {
    const q = { select() { return q; }, eq() { return q; }, order() { return q; }, range() { return q; },
      then(resolve) { return Promise.resolve({ data: rows }).then(resolve); } };
    return q;
  } };
}
test('future days neither create nor extend streaks; later-today counts', () => {
  assert.deepEqual(computeStreaks([tomorrow], tz, Date.parse(now)), { currentStreak: 0, longestStreak: 0 });
  assert.deepEqual(computeStreaks([today, tomorrow], tz, Date.parse(now)), { currentStreak: 1, longestStreak: 1 });
  const past = row('2026-10-06T19:00:00Z');
  assert.deepEqual(computeStreaks([past, today, tomorrow], tz, Date.parse(now)), { currentStreak: 2, longestStreak: 2 });
});
test('Stats excludes future days from every aggregate and strip, not later today', async () => {
  const after = await load(db([today, tomorrow]), now).invoke('/api/profile/stats', user);
  const expected = await load(db([today]), now).invoke('/api/profile/stats', user);
  assert.deepEqual(after, expected);
  assert.equal(after.hero.activities, 1);
  assert.equal(after.hero.totalKm, 2);
  assert.equal(after.hero.totalHours, 1);
  assert.equal(after.weekStrip.filter(d => d.active).length, 1);
});
test('web goal enrichment excludes future days for every type, any/specific sport', async () => {
  for (const type of ['frequency', 'duration', 'distance', 'streak']) {
    for (const sport of [null, 'running']) {
      const goal = { id: type, type, sport, target_value: 10, period: 'monthly', unit: type === 'distance' ? 'km' : null };
      const a = await load(db([today, tomorrow]), now).ctx.enrichGoalRows(user.id, [goal], tz, { now: new Date(now) });
      const b = await load(db([today]), now).ctx.enrichGoalRows(user.id, [goal], tz, { now: new Date(now) });
      assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), type + '/' + sport);
      assert.equal(a[0].progress, type === 'distance' ? 2 : 1);
    }
  }
});
test('standalone Insights goal runtime excludes future days for every type', async () => {
  const goals = ['frequency', 'duration', 'distance', 'streak'].map(type =>
    ({ id: type, type, sport: 'running', target_value: 10, period: 'monthly', unit: type === 'distance' ? 'km' : null }));
  const a = createAiInsightsRuntime({ supabaseAdmin: db([today, tomorrow]) });
  const b = createAiInsightsRuntime({ supabaseAdmin: db([today]) });
  assert.deepEqual(
    await a.enrichGoalRows(user.id, goals, tz, { now: new Date(now) }),
    await b.enrichGoalRows(user.id, goals, tz, { now: new Date(now) })
  );
});