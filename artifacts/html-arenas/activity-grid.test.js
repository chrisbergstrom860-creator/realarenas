const test = require('node:test');
const assert = require('node:assert');
const { buildFourWeekActivityGrid } = require('./activity-grid');

const NOW = Date.parse('2026-08-19T20:00:00Z'); // Wed Aug 19, 13:00 Pacific.

test('builds four Monday-Sunday rows ending in the current partial week', () => {
  const grid = buildFourWeekActivityGrid([], 'America/Los_Angeles', NOW);
  assert.strictEqual(grid.startKey, '2026-07-27');
  assert.strictEqual(grid.todayKey, '2026-08-19');
  assert.strictEqual(grid.weeks.length, 4);
  assert.ok(grid.weeks.every((week) => week.days.length === 7));
  assert.strictEqual(grid.weeks[0].days[0].dateKey, '2026-07-27');
  assert.strictEqual(grid.weeks[3].days[6].dateKey, '2026-08-23');
  assert.deepStrictEqual(
    grid.weeks[3].days.map((day) => day.state),
    ['inactive', 'inactive', 'inactive', 'future', 'future', 'future', 'future']
  );
});

test('counts activities but marks activity presence once per athlete-local day', () => {
  const grid = buildFourWeekActivityGrid([
    { date: '2026-07-27T06:30:00Z' }, // Jul 26 Pacific: outside the window.
    { date: '2026-07-27T07:30:00Z' }, // Jul 27 Pacific.
    { date: '2026-08-19T06:30:00Z' }, // Aug 18 Pacific.
    { date: '2026-08-19T06:45:00Z' }, // Same Aug 18 day: count 2, one dot.
    { date: '2026-08-19T07:30:00Z' }, // Aug 19 Pacific.
    { date: '2026-08-20T07:30:00Z' }  // Future day: excluded.
  ], 'America/Los_Angeles', NOW);

  assert.strictEqual(grid.activityCount, 4);
  const cells = grid.weeks.flatMap((week) => week.days);
  assert.strictEqual(cells.filter((day) => day.state === 'active').length, 3);
  assert.strictEqual(cells.find((day) => day.dateKey === '2026-08-18').state, 'active');
  assert.strictEqual(cells.find((day) => day.dateKey === '2026-08-19').state, 'active');
  assert.strictEqual(cells.find((day) => day.dateKey === '2026-08-20').state, 'future');
});