'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { previewSyntheticEmail, readOnlyFetchFor } = require('./preview-synthetic-recap-email');

function context() {
  const weekly = Array.from({ length: 12 }, (_, index) => ({
    weekStart: new Date(Date.UTC(2026, 5, 29 + index * 7)).toISOString().slice(0, 10),
    relative: index === 10 ? 'last_week' : index === 11 ? 'this_week' : `${11 - index}_weeks_ago`,
    activityCount: 2, durationHours: 1.9, points: 10, distanceKm: 5,
    sports: [
      { sport: 'running', sessions: 1, durationHours: 1.4, distanceKm: 5 },
      { sport: 'yoga', sessions: 1, durationHours: 0.5, distanceKm: 0 }
    ]
  }));
  return {
    schemaVersion: 8, timezone: 'UTC', asOfDate: '2026-09-14',
    dataQuality: { trendEligible: false },
    last12Weeks: { weekly, feelingsTotal: {} }
  };
}

test('synthetic email uses validated context without model, writes, sends or signed capabilities', async () => {
  const result = await previewSyntheticEmail(context(), {
    id: '00000000-0000-4000-8000-000000000001', email: 'preview@example.test'
  }, new Date('2026-09-14T08:00:00Z'));
  assert.equal(result.status, 'dry_run');
  assert.equal(result.attempted, false);
  assert.equal(result.row.contract_version, 3);
  assert.equal(result.row.chart.extras.hoursBySport.totals.length, 12);
  assert.match(result.text, /1\.9 hours/);
  assert.match(result.text, /REDACTED_UNSUBSCRIBE_CAPABILITY/);
  assert.match(result.text, /Yoga — 1 session, 0\.5 h(?:\n|$)/);
  assert.doesNotMatch(result.text, /Yoga —[^\n]* km/);
  assert.doesNotMatch(result.html, /<img\b/i);
  assert.equal(result.row.prose.includes('Sep 7'), true);
});

test('read-only transport blocks writes, provider hosts and redirects', async () => {
  const calls = [];
  const transport = readOnlyFetchFor('https://database.example.test', async (url, init) => {
    calls.push({ url, init }); return { ok: true };
  });
  await assert.rejects(transport('https://database.example.test/rest/v1/weekly_recaps', { method: 'POST' }), /refused/);
  await assert.rejects(transport('https://api.anthropic.com/v1/messages'), /refused/);
  await transport('https://database.example.test/rest/v1/activities');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, 'error');
});