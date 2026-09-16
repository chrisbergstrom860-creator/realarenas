'use strict';

// This is deliberately a pure, offline drift guard.  It does not evaluate the
// historical source (or load server.js); b247435 is read only as the pinned
// original-helper reference and the assertions exercise the canonical runtime.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const {
  prefsFromMeta,
  parseDurationHours,
  parseDistanceKmUnitAware,
  calculatePoints,
  goalWindow,
  goalProgressInWindow,
  priorClosedGoalWindows,
  recentGoalHistory
} = require('./ai-insights-runtime');
const { computeStreaks } = require('./tzdate');

function originalServerSource() {
  return execFileSync('git', ['show', 'b247435:artifacts/html-arenas/server.js'], {
    cwd: __dirname,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
}

test('canonical runtime preserves b247435 parsing and scoring edge behavior', () => {
  const original = originalServerSource();
  for (const helper of ['parseDistanceKmUnitAware', 'parseDurationHours', 'calculatePoints']) {
    assert.match(original, new RegExp(`function ${helper}\\(`), `pinned baseline includes ${helper}`);
  }

  // Expected values are the b247435 helper contracts, including unit handling,
  // bare duration semantics, and the one-round-at-total points rule.
  assert.equal(parseDistanceKmUnitAware('2,000m'), 2);
  assert.equal(parseDistanceKmUnitAware('10 mi'), 16.09);
  assert.equal(parseDistanceKmUnitAware('8'), 8);
  assert.equal(parseDurationHours('1:30'), 1.5);
  assert.equal(parseDurationHours('45:00'), 0.75);
  assert.equal(parseDurationHours('45'), 0.75);
  assert.equal(parseDurationHours('1h 30m'), 1.5);
  assert.equal(calculatePoints([
    { sport: 'running', distance: '10 mi' },
    { sport: 'swimming', distance: '2,000m' },
    { sport: 'unknown' }
  ]), 221);
});

test('canonical runtime preserves b247435 goal boundaries and history eligibility', () => {
  const original = originalServerSource();
  for (const helper of ['goalWindow', 'goalProgressInWindow', 'priorClosedGoalWindows', 'recentGoalHistory']) {
    assert.match(original, new RegExp(`function ${helper}\\(`), `pinned baseline includes ${helper}`);
  }
  const now = new Date('2026-03-18T12:00:00.000Z');
  const goal = {
    type: 'distance', sport: null, target_value: 10, unit: 'mi',
    period: 'weekly', start_date: '2025-01-01', created_at: '2025-01-01T00:00:00.000Z'
  };
  const window = goalWindow(goal, 'UTC', now);
  assert.deepEqual({ start: window.startKey, end: window.endKeyExcl }, { start: '2026-03-16', end: '2026-03-23' });
  const activities = [
    { sport: 'running', distance: '10 mi', date: '2026-03-17T10:00:00.000Z' },
    { sport: 'yoga', distance: '999km', date: '2026-03-17T11:00:00.000Z' },
    { sport: 'cycling', distance: '5km', date: '2026-03-23T00:00:00.000Z' }
  ];
  const result = goalProgressInWindow(goal, activities, computeStreaks(activities, 'UTC', now.getTime()), 'UTC', window, now.getTime());
  assert.equal(result.targetCmp, 16.09);
  assert.equal(result.progress, 10);
  assert.equal(result.isComplete, true);
  assert.deepEqual(priorClosedGoalWindows(goal, 'UTC', now).map((item) => item.startKey), ['2026-03-09', '2026-03-02', '2026-02-23']);
  assert.equal(recentGoalHistory({ ...goal, updated_at: '2026-03-17T00:00:00.000Z' }, activities, {}, 'UTC', now).previousPeriodUnavailableReason, 'goal_changed_after_period');
});

test('preferences retain existing default-on behavior while weekly recaps remain opt-in', () => {
  assert.equal(prefsFromMeta({}).show_on_leaderboards, true);
  assert.equal(prefsFromMeta({}).notify_events, true);
  assert.equal(prefsFromMeta({}).weekly_recap, false);
  assert.equal(prefsFromMeta({ prefs: { weekly_recap: true, notify_events: false } }).weekly_recap, true);
  assert.equal(prefsFromMeta({ prefs: { weekly_recap: true, notify_events: false } }).notify_events, false);
});