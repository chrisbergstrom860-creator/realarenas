const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { buildCalendarMonthStats, calendarActivityDetails } = require('./calendar-stats');
const { extractFunction } = require('./scripts/verify-calendar-stats-readonly');
const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const parsers = vm.createContext({});
for (const name of ['parseDurationHours', 'parseDistanceKmUnitAware']) {
  vm.runInContext(extractFunction(source, name), parsers);
}
const zone = 'America/Los_Angeles';
const now = new Date('2026-09-15T20:00:00Z');
const row = (date, distance = '5mi', duration = '1h 42m') => ({ date, distance, duration });
const stats = (rows, month = '2026-09', at = now) => buildCalendarMonthStats(rows, month, zone, at, parsers);

test('current month observes through account-local today, including empty days', () => {
  assert.deepEqual(stats([]), { sessions: 0, hours: 0, distanceKm: 0, activeDays: 0, observedDays: 15, restDays: 15 });
});
test('past leap and non-leap February observe the full month', () => {
  assert.equal(stats([], '2024-02').observedDays, 29);
  assert.equal(stats([], '2025-02').observedDays, 28);
});
test('future month is entirely zero even if future activities exist', () => {
  assert.deepEqual(stats([row('2026-10-02T12:00:00Z')], '2026-10'), {
    sessions: 0, hours: 0, distanceKm: 0, activeDays: 0, observedDays: 0, restDays: 0
  });
});
test('current month excludes future day logs but includes all of today', () => {
  assert.equal(stats([row('2026-09-16T06:59:00Z'), row('2026-09-16T07:00:00Z')]).sessions, 1);
});
test('month membership follows Pacific not UTC boundaries', () => {
  const result = stats([row('2026-09-01T06:59:00Z'), row('2026-09-01T07:00:00Z')]);
  assert.equal(result.sessions, 1);
  assert.equal(result.activeDays, 1);
});
test('multiple sessions on one day count one active day', () => {
  const result = stats([row('2026-09-10T12:00:00Z'), row('2026-09-10T18:00:00Z')]);
  assert.equal(result.sessions, 2);
  assert.equal(result.activeDays, 1);
  assert.equal(result.restDays, 14);
});
test('mixed units use canonical parser and round only after summing', () => {
  const result = stats([row('2026-09-10T12:00:00Z', '5mi'), row('2026-09-11T12:00:00Z', '2,000m'), row('2026-09-12T12:00:00Z', '0.04km')]);
  assert.equal(result.distanceKm, 10.1);
  assert.equal(result.hours, 5.1);
});
test('activity enrichment preserves notes/feeling and rounds distance to one decimal', () => {
  const result = calendarActivityDetails({ ...row('2026-09-10'), notes: 'Good day', feeling: 'strong' }, parsers);
  assert.equal(result.distanceKm, 8);
  assert.equal(result.durationMinutes, 102);
  assert.equal(result.notes, 'Good day');
  assert.equal(result.feeling, 'strong');
});
test('missing or unparseable distance is null and missing duration is zero', () => {
  for (const distance of [null, '', 'unknown', '0 km']) {
    const result = calendarActivityDetails({ distance, duration: null }, parsers);
    assert.equal(result.distanceKm, null);
    assert.equal(result.durationMinutes, 0);
  }
});
test('duration enrichment follows canonical colon and text parsing', () => {
  for (const [duration, minutes] of [['45:00', 45], ['1:30', 90], ['45m', 45], ['1h 42m', 102]]) {
    assert.equal(calendarActivityDetails({ duration }, parsers).durationMinutes, minutes);
  }
});
test('account-local today differs from UTC today at month transition', () => {
  assert.equal(stats([], '2026-09', new Date('2026-10-01T06:30:00Z')).observedDays, 30);
  assert.equal(stats([], '2026-10', new Date('2026-10-01T06:30:00Z')).observedDays, 0);
});
test('DST days count calendar days rather than elapsed 24-hour spans', () => {
  assert.equal(stats([], '2026-03').observedDays, 31);
  assert.equal(stats([], '2026-11', new Date('2026-12-01T12:00:00Z')).observedDays, 30);
});