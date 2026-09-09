'use strict';

function dedupeUsersById(users) {
  const seen = new Set();
  return (users || []).filter((user) => {
    if (!user || !user.id || seen.has(user.id)) return false;
    seen.add(user.id);
    return true;
  });
}

function mostLoggedSportByUser(activities, sports) {
  const known = new Map((sports || []).map((sport, index) => [sport.id, { ...sport, index }]));
  const counts = new Map();
  for (const activity of activities || []) {
    if (!activity || !activity.user_id || !known.has(activity.sport)) continue;
    if (!counts.has(activity.user_id)) counts.set(activity.user_id, new Map());
    const userCounts = counts.get(activity.user_id);
    userCounts.set(activity.sport, (userCounts.get(activity.sport) || 0) + 1);
  }
  const result = {};
  for (const [userId, userCounts] of counts) {
    const winner = [...userCounts.entries()].sort((a, b) =>
      b[1] - a[1] || known.get(a[0]).index - known.get(b[0]).index
    )[0];
    if (winner) result[userId] = known.get(winner[0]).label;
  }
  return result;
}

module.exports = { dedupeUsersById, mostLoggedSportByUser };