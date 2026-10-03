const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./scripts/lib/goal-data-proof.cjs');
const now = '2026-10-07T19:00:00Z'; // Wednesday noon in Los Angeles
const user = { id: 'fixture', user_metadata: { timezone: 'America/Los_Angeles' } };
function fixture(n = 2001) {
  const acts = Array.from({ length: n }, (_, i) => ({ id: String(i), sport: 'running', title: '', distance: '1 km', duration: '01:00:00', date: '2026-10-06T19:00:00Z' }));
  const calls = [];
  const db = { from(table) {
    let from = 0, to = 999;
    const orders = [];
    const q = { select() { return q; }, eq() { return q; }, order(k) { orders.push(k); return q; },
      range(a, b) { from = a; to = b; return q; }, then(resolve) {
        calls.push({ table, from, orders }); return Promise.resolve({ data: acts.slice(from, to + 1) }).then(resolve);
      } };
    return q;
  } };
  return { db, acts, calls };
}
test('Stats paginates 2001 rows and emits exact account-zone Monday–Sunday strip', async () => {
  const f = fixture(), p = load(f.db, now);
  const r = await p.invoke('/api/profile/stats', user);
  assert.equal(r.hero.activities, 2001);
  assert.equal(r.hero.totalHours, 2001);
  assert.equal(r.hero.totalKm, 2001);
  assert.deepEqual(f.calls.map(c => c.from), [0, 1000, 2000]);
  assert.ok(f.calls.every(c => c.orders.join(',') === 'date,id'));
  assert.equal(r.weekStrip.length, 7);
  assert.equal(r.weekStrip[0].date, '2026-10-05');
  assert.equal(r.weekStrip[1].active, true);
  assert.equal(r.weekStrip[2].isToday, true);
  assert.equal(r.weekStrip[3].isFuture, true);
  assert.equal(r.streaks.current, 1);
});
test('goal reads paginate 2001 rows, retain comparisons and add expected/km values', async () => {
  const f = fixture(), p = load(f.db, now);
  const row = { id: 'g', type: 'distance', sport: 'running', unit: 'mi', target_value: 20, period: 'weekly', status: 'active' };
  const [g] = await p.ctx.enrichGoalRows(user.id, [row], 'America/Los_Angeles', { now: new Date(now) });
  assert.equal(g.progress, Math.round(2001 / 1.609 * 100) / 100);
  assert.equal(g.expectedProgress, 5.71);
  assert.equal(g.targetKm, 20 * 1.609);
  assert.equal(g.progressKm, g.progress * 1.609);
  assert.equal(g.expectedKm, g.expectedProgress * 1.609);
  assert.deepEqual(f.calls.map(c => c.from), [0, 1000, 2000]);
});
test('expectations are day-stable, zero at start and capped at custom window end', () => {
  const p = load(fixture(0).db, now);
  const row = { type: 'frequency', target_value: 7, period: 'weekly', status: 'active' };
  for (const instant of ['2026-10-05T07:00:00Z', '2026-10-06T06:59:00Z']) {
    const g = p.ctx.enrichGoal(row, [], { currentStreak: 0 }, 'America/Los_Angeles', { now: new Date(instant) });
    assert.equal(g.expectedProgress, 0);
    assert.equal(g.onTrack, true);
    assert.equal(g.targetKm, undefined);
  }
  const custom = p.ctx.enrichGoal({ ...row, period: 'custom', start_date: '2026-10-01', end_date: '2026-10-02' },
    [], { currentStreak: 0 }, 'America/Los_Angeles', { now: new Date(now) });
  assert.equal(custom.expectedProgress, 7);
});
test('same weekday in another week does not activate a strip cell', async () => {
  const f = fixture(1);
  f.acts[0].date = '2026-09-29T19:00:00Z';
  const r = await load(f.db, now).invoke('/api/profile/stats', user);
  assert.ok(r.weekStrip.every(d => !d.active));
});