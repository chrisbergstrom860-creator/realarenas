// Canonical four-calendar-week activity window. Day assignment deliberately
// reuses tzdate.js — the same bucketing used by computeStreaks — so the grid
// beside DAY STREAK cannot disagree at timezone boundaries.
const { addDaysToKey, dayKey, weekStartKey } = require('./tzdate');

function buildFourWeekActivityGrid(activities, tz, nowMs) {
  const now = nowMs == null ? new Date() : new Date(nowMs);
  const todayKey = dayKey(now, tz);
  const startKey = weekStartKey(now, tz, 3);
  const activeKeys = new Set();
  let activityCount = 0;

  for (const activity of activities || []) {
    const key = dayKey(activity && activity.date, tz);
    if (key < startKey || key > todayKey) continue;
    activeKeys.add(key);
    activityCount++;
  }

  const weeks = [];
  for (let weekIndex = 0; weekIndex < 4; weekIndex++) {
    const weekStart = addDaysToKey(startKey, weekIndex * 7);
    const days = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const dateKey = addDaysToKey(weekStart, dayIndex);
      days.push({
        dateKey,
        state: dateKey > todayKey ? 'future' : activeKeys.has(dateKey) ? 'active' : 'inactive'
      });
    }
    weeks.push({ startKey: weekStart, days });
  }

  return { activityCount, startKey, todayKey, weeks };
}

module.exports = { buildFourWeekActivityGrid };