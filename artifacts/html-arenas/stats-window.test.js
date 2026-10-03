const test = require('node:test');
const assert = require('node:assert/strict');
const { statsWindow, statsWeeks, statsTotals, statsComparison } = require('./stats-window');
const { keyToEpochDays } = require('./tzdate');
const tz = 'America/Los_Angeles';
test('API defaults to 12w and rejects every unsupported period before reading data', async () => {
  const { load } = require('./scripts/lib/goal-data-proof.cjs');
  const p = load({ from() { throw Error('unexpected read'); } }, '2026-10-03T20:00:00Z');
  for (const period of ['month','year','bogus','', '24w']) {
    await assert.rejects(p.invoke('/api/profile/stats', { id:'test' }, { period }), /invalid_period/);
  }
});
for (const [instant, expected] of [
  ['2026-03-09T06:30:00Z', ['2026-01-26', '2025-12-15', '2025-10-01', '2025-04-01', '2026-03-09']],
  ['2026-04-01T06:30:00Z', ['2026-02-23', '2026-01-12', '2025-10-01', '2025-04-01', '2026-04-01']]
]) {
  for (const [i, period] of ['6w', '12w', '6m', '1y'].entries()) test(`${period} account bounds ${instant}`, () => {
    const w = statsWindow([], period, tz, new Date(instant));
    assert.equal(w.start, expected[i]); assert.equal(w.end, expected[4]);
    assert.equal(w.previous.end, w.start);
    assert.equal(keyToEpochDays(w.previous.end) - keyToEpochDays(w.previous.start), w.days);
    const { weeklyChart } = statsWeeks([], w, period, tz, new Date(instant));
    if (period.endsWith('w')) assert.equal(weeklyChart.length, parseInt(period));
    assert.equal(weeklyChart.at(-1).end, w.end);
    assert.equal(weeklyChart.at(-1).isPartial, true);
  });
}
test('All preserves full-history totals while weekly series caps at 104', () => {
  const acts = [{ date: '2020-01-01T12:00:00Z', sport: 'running', duration: '01:00:00', distance: '1 km' }];
  const now = new Date('2026-10-03T20:00:00Z'), w = statsWindow(acts, 'all', tz, now);
  assert.equal(w.previous, null); assert.equal(statsTotals(acts).activities, 1);
  const result = statsWeeks(acts, w, 'all', tz, now);
  assert.deepEqual(result.weeklyCoverage, { buckets: 104, capped: true });
  assert.equal(result.weeklyChart.reduce((n, w) => n + w.sessions, 0), 0);
});
test('previousEmpty and zero denominator are explicit, all has no comparison', () => {
  assert.deepEqual(statsComparison({ activities: 1, totalKm: 1, totalHours: 1 }, { activities: 0, totalKm: 0, totalHours: 0 }),
    { activitiesPct: null, kmPct: null, hoursPct: null, previousEmpty: true });
  assert.equal(statsComparison({}, null), null);
  assert.equal(statsComparison({ activities: 1, totalKm: 0, totalHours: 2 }, { activities: 2, totalKm: 0, totalHours: 1 }).activitiesPct, -50);
});
test('multi-metric totals reconcile and zero-hour session sports survive', () => {
  const acts = ['running','cycling','swimming'].map(sport => ({ sport, date:'2026-10-03T12:00:00Z', distance:'0.16 km', duration:'00:10:00' }));
  acts.push({ sport:'golf', date:'2026-10-03T12:00:00Z', distance:'', duration:'' });
  const now = new Date('2026-10-03T20:00:00Z');
  const w = statsWeeks(acts, statsWindow(acts, '6w', tz, now), '6w', tz, now).weeklyChart.at(-1);
  assert.equal(w.sessions, 4); assert.equal(w.bySport.length, 4);
  for (const key of ['hours','km']) assert.equal(Math.round(w.bySport.reduce((n,s)=>n+s[key],0)*10), Math.round(w[key]*10));
});