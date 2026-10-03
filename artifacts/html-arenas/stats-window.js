'use strict';
const { dayKey, weekStartKey, monthKey, addDaysToKey, keyToEpochDays, keyToUtcDate } = require('./tzdate');
const { parseDurationHours, parseDistanceKmUnitAware } = require('./html/arenas-parse');
const PERIODS = ['6w', '12w', '6m', '1y', 'all'];
const round = n => Math.round(n * 10) / 10;
function statsWindow(acts, period, tz, now) {
  const today = dayKey(now, tz), end = addDaysToKey(today, 1);
  let start;
  if (period === '6w' || period === '12w') start = weekStartKey(now, tz, period === '6w' ? 5 : 11);
  else if (period === '6m' || period === '1y') {
    const [y, m] = monthKey(now, tz).split('-').map(Number);
    const d = new Date(Date.UTC(y, m - (period === '6m' ? 6 : 12), 1));
    start = d.toISOString().slice(0, 10);
  } else start = acts.length ? acts.reduce((a, r) => {
    const k = dayKey(r.date, tz); return k < a ? k : a;
  }, today) : today;
  const days = keyToEpochDays(end) - keyToEpochDays(start);
  const previous = period === 'all' ? null : { start: addDaysToKey(start, -days), end: start };
  return { start, end, days, previous };
}
function statsTotals(rows) {
  return { activities: rows.length,
    totalKm: round(rows.reduce((n, a) => n + parseDistanceKmUnitAware(a.distance), 0)),
    totalHours: round(rows.reduce((n, a) => n + parseDurationHours(a.duration), 0)) };
}
function statsComparison(current, previous) {
  if (!previous) return null;
  const pct = key => previous[key] > 0 ? round((current[key] - previous[key]) / previous[key] * 100) : null;
  return { activitiesPct: pct('activities'), kmPct: pct('totalKm'), hoursPct: pct('totalHours'),
    previousEmpty: previous.activities === 0 };
}
// Largest-remainder tenths: preserve every session-bearing sport even when
// its rounded distance or time is zero; each metric sums to its displayed total.
function reconcile(rows, metric) {
  const total = Math.round(rows.reduce((n, r) => n + r[metric], 0) * 10);
  const entries = rows.map((r, i) => ({ i, exact: r[metric] * 10, value: Math.floor(r[metric] * 10) }));
  let left = total - entries.reduce((n, r) => n + r.value, 0);
  entries.slice().sort((a, b) => (b.exact - b.value) - (a.exact - a.value) || a.i - b.i)
    .forEach(e => { if (left-- > 0) e.value++; });
  entries.forEach(e => { rows[e.i][metric] = e.value / 10; });
  return total / 10;
}
function statsWeeks(acts, window, period, tz, now) {
  // Key dates are interpreted in UTC ONLY for calendar arithmetic.
  let monday = weekStartKey(keyToUtcDate(window.start), 'UTC');
  const last = weekStartKey(now, tz);
  const count = Math.round((keyToEpochDays(last) - keyToEpochDays(monday)) / 7) + 1;
  const capped = period === 'all' && count > 104;
  if (capped) monday = addDaysToKey(last, -103 * 7);
  const buckets = new Map();
  for (let k = monday; k <= last; k = addDaysToKey(k, 7)) buckets.set(k, new Map());
  for (const a of acts) {
    const date = dayKey(a.date, tz);
    if (date < window.start || date >= window.end) continue;
    const bucket = buckets.get(weekStartKey(a.date, tz));
    if (!bucket) continue;
    const sport = a.sport || 'other';
    const row = bucket.get(sport) || { sport, hours: 0, km: 0, sessions: 0 };
    row.sessions++; row.hours += parseDurationHours(a.duration); row.km += parseDistanceKmUnitAware(a.distance);
    bucket.set(sport, row);
  }
  const weeklyChart = [...buckets].map(([start, map]) => {
    const bySport = [...map.values()];
    const hours = reconcile(bySport, 'hours'), km = reconcile(bySport, 'km');
    const end = addDaysToKey(start, 7);
    return { start: start < window.start ? window.start : start, end: end > window.end ? window.end : end,
      label: keyToUtcDate(start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(' ', ''),
      isPartial: start === last, hours, km, sessions: bySport.reduce((n, a) => n + a.sessions, 0),
      bySport: bySport.sort((a, b) => b.hours - a.hours || a.sport.localeCompare(b.sport)) };
  });
  return { weeklyChart, weeklyCoverage: { buckets: weeklyChart.length, capped } };
}
module.exports = { PERIODS, statsWindow, statsTotals, statsComparison, statsWeeks };