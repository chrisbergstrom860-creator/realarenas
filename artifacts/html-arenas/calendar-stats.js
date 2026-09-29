const { dayKey, monthKey, keyToEpochDays } = require('./tzdate');

// Insights monthly semantics: sum unrounded canonical values, count distinct
// account-local days, and observe only days through today (not future logs).
function buildCalendarMonthStats(activities, month, tz, now, parsers) {
  const today = dayKey(now, tz);
  const currentMonth = monthKey(now, tz);
  const zero = { sessions: 0, hours: 0, distanceKm: 0, activeDays: 0, observedDays: 0, restDays: 0 };
  if (month > currentMonth) return zero;
  const [year, monthNumber] = month.split('-').map(Number);
  const observedDays = month === currentMonth
    ? keyToEpochDays(today) - keyToEpochDays(month + '-01') + 1
    : new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const rows = activities.filter(a => monthKey(a.date, tz) === month && dayKey(a.date, tz) <= today);
  const activeDays = new Set(rows.map(a => dayKey(a.date, tz))).size;
  return {
    sessions: rows.length,
    hours: Math.round(rows.reduce((sum, a) => sum + parsers.parseDurationHours(a.duration), 0) * 10) / 10,
    distanceKm: Math.round(rows.reduce((sum, a) => sum + parsers.parseDistanceKmUnitAware(a.distance), 0) * 10) / 10,
    activeDays,
    observedDays,
    restDays: Math.max(0, observedDays - activeDays)
  };
}

function calendarActivityDetails(activity, parsers) {
  const distance = parsers.parseDistanceKmUnitAware(activity.distance);
  return {
    ...activity,
    distanceKm: distance > 0 ? Math.round(distance * 10) / 10 : null,
    durationMinutes: Math.round(parsers.parseDurationHours(activity.duration) * 60)
  };
}

module.exports = { buildCalendarMonthStats, calendarActivityDetails };