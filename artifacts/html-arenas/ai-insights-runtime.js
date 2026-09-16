'use strict';

// The non-HTTP dependency boundary for AI Insights.  These are the same
// data-access helpers the server supplies to ai-insights-service; keeping the
// closure here lets the one-shot recap process build the exact same private
// context without requiring server.js (which would create an Express listener).
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const { SPORT_POINTS, DISTANCE_SPORTS } = require('./sports');
const { COUNTRY_NAMES, US_STATE_NAMES } = require('./countries');
const {
  isValidTimezone, getUserTimezone, dateParts, dayKey, keyToEpochDays, addDaysToKey,
  weekStartKey, monthKey, zoneMidnightUtc, computeStreaks
} = require('./tzdate');

const PREF_KEYS = [
  'show_on_leaderboards', 'activity_feed_visible',
  'club_training_analytics_visible', 'notify_kudos', 'notify_comments',
  'notify_followers', 'notify_challenges', 'notify_events', 'weekly_recap'
];
const PREF_DEFAULTS = { weekly_recap: false };

function displayFromUser(user) {
  const meta = (user && user.user_metadata) || {};
  const emailLocal = user && user.email ? user.email.split('@')[0] : null;
  return {
    name: meta.name || emailLocal || 'Athlete',
    handle: meta.handle || emailLocal || 'athlete',
    avatar_url: meta.avatar_url || null,
    location: meta.location || null,
    country: meta.country || null,
    countryName: COUNTRY_NAMES[meta.country] || null,
    state: meta.state || null,
    stateName: US_STATE_NAMES[meta.state] || null,
    profilePublic: !(meta.prefs && meta.prefs.show_on_leaderboards === false)
  };
}

function prefsFromMeta(meta) {
  const stored = (meta && meta.prefs) || {};
  const out = {};
  PREF_KEYS.forEach((key) => {
    out[key] = typeof stored[key] === 'boolean' ? stored[key] : (PREF_DEFAULTS[key] !== false);
  });
  return out;
}

// Canonical parser copied from the server's shared scoring path.  Do not
// introduce a unit-blind alternative: miles and swim metres must stay correct.
function parseDistanceKmUnitAware(distance) {
  if (distance == null) return 0;
  const raw = String(distance).toLowerCase().replace(/,/g, '');
  const n = parseFloat(raw.replace(/[^0-9.]/g, ''));
  if (isNaN(n) || n <= 0) return 0;
  if (raw.includes('km')) return n;
  if (raw.includes('mi')) return n * 1.609;
  if (raw.includes('m')) return n / 1000;
  return n;
}

function parseDurationHours(duration) {
  if (!duration) return 0;
  const str = String(duration).toLowerCase().trim();
  if (str.includes(':')) {
    const parts = str.split(':');
    const a = parseFloat(parts[0]) || 0;
    const b = parseFloat(parts[1]) || 0;
    return a > 12 ? a / 60 + b / 3600 : a + b / 60;
  }
  const hMatch = str.match(/(\d+(?:\.\d+)?)\s*h/);
  const mMatch = str.match(/(\d+(?:\.\d+)?)\s*m/);
  if (hMatch || mMatch) {
    return (parseFloat(hMatch && hMatch[1]) || 0) + (parseFloat(mMatch && mMatch[1]) || 0) / 60;
  }
  const num = parseFloat(str.replace(/[^0-9.]/g, ''));
  if (isNaN(num)) return 0;
  return num > 12 ? num / 60 : num;
}

function calculatePoints(activities) {
  let total = 0;
  (activities || []).forEach((activity) => {
    const cfg = SPORT_POINTS[activity.sport];
    if (!cfg) { total += 20; return; }
    if (cfg.per === 'km') {
      const distance = parseDistanceKmUnitAware(activity.distance);
      total += distance > 0 ? distance * cfg.rate : cfg.rate * 2;
    } else {
      total += cfg.rate;
    }
  });
  return Math.round(total);
}

function getDateRange(period, timezone, now = new Date()) {
  const zone = isValidTimezone(timezone) ? timezone : 'UTC';
  if (period === 'week') {
    return { start: zoneMidnightUtc(weekStartKey(now, zone), zone).toISOString(), end: now.toISOString() };
  }
  if (period === 'month') {
    return { start: zoneMidnightUtc(monthKey(now, zone) + '-01', zone).toISOString(), end: now.toISOString() };
  }
  if (period === 'rolling7') {
    return { start: new Date(now.getTime() - 7 * 86400000).toISOString(), end: now.toISOString() };
  }
  return { start: null, end: now.toISOString() };
}

const GOAL_TYPES = ['distance', 'frequency', 'duration', 'streak'];
const GOAL_PERIODS = ['weekly', 'monthly', 'custom'];
const GOAL_UNITS = ['km', 'mi'];
const MI_TO_KM = 1.609;

function parseLocalDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function goalWindow(goal, tz, now = new Date()) {
  let startKey, endKeyExcl;
  if (goal.period === 'weekly') {
    startKey = weekStartKey(now, tz);
    endKeyExcl = addDaysToKey(startKey, 7);
  } else if (goal.period === 'monthly') {
    const p = dateParts(now, tz);
    startKey = `${p.y}-${String(p.m).padStart(2, '0')}-01`;
    endKeyExcl = p.m === 12
      ? `${p.y + 1}-01-01`
      : `${p.y}-${String(p.m + 1).padStart(2, '0')}-01`;
  } else {
    startKey = String(goal.start_date);
    endKeyExcl = addDaysToKey(goal.end_date || goal.start_date, 1);
  }
  return {
    startKey,
    endKeyExcl,
    start: zoneMidnightUtc(startKey, tz),
    end: zoneMidnightUtc(endKeyExcl, tz)
  };
}

function goalNaturalUnit(goal) {
  if (goal.type === 'frequency') return 'sessions';
  if (goal.type === 'duration') return 'hours';
  if (goal.type === 'streak') return 'days';
  return goal.unit || 'km';
}

function goalProgressInWindow(goal, activities, streaks, tz, window, nowMs) {
  const target = Number(goal.target_value) || 0;
  const targetCmp = goal.type === 'distance' && goal.unit === 'mi' ? target * MI_TO_KM : target;
  let progressCmp = 0;
  if (goal.type === 'streak') {
    progressCmp = goal.sport
      ? computeStreaks(activities.filter((a) => a.sport === goal.sport), tz, nowMs).currentStreak
      : streaks.currentStreak;
  } else {
    const matches = activities.filter((a) => {
      const key = dayKey(a.date, tz);
      if (key < window.startKey || key >= window.endKeyExcl) return false;
      if (goal.sport) return a.sport === goal.sport;
      if (goal.type === 'distance') return DISTANCE_SPORTS.includes(a.sport);
      return true;
    });
    if (goal.type === 'distance') {
      progressCmp = matches.reduce((sum, activity) =>
        sum + parseDistanceKmUnitAware(activity.distance), 0);
    } else if (goal.type === 'frequency') {
      progressCmp = matches.length;
    } else if (goal.type === 'duration') {
      progressCmp = matches.reduce((sum, activity) =>
        sum + parseDurationHours(activity.duration), 0);
    }
  }
  const progress = goal.type === 'distance' && goal.unit === 'mi'
    ? Math.round((progressCmp / MI_TO_KM) * 100) / 100
    : Math.round(progressCmp * 100) / 100;
  return {
    target,
    targetCmp,
    progress,
    progressCmp,
    pct: targetCmp > 0 ? Math.min(100, Math.round((progressCmp / targetCmp) * 100)) : 0,
    isComplete: targetCmp > 0 && progressCmp >= targetCmp
  };
}

function priorClosedGoalWindows(goal, tz, now = new Date()) {
  if (!['weekly', 'monthly'].includes(goal.period)) return [];
  const windows = [];
  if (goal.period === 'weekly') {
    const currentStart = weekStartKey(now, tz);
    for (let offset = 1; offset <= 3; offset++) {
      const startKey = addDaysToKey(currentStart, -7 * offset);
      const endKeyExcl = addDaysToKey(startKey, 7);
      windows.push({ startKey, endKeyExcl, start: zoneMidnightUtc(startKey, tz), end: zoneMidnightUtc(endKeyExcl, tz) });
    }
    return windows;
  }
  const current = dateParts(now, tz);
  for (let offset = 1; offset <= 3; offset++) {
    const startMonth = new Date(Date.UTC(current.y, current.m - 1 - offset, 1));
    const endMonth = new Date(Date.UTC(current.y, current.m - offset, 1));
    const startKey = `${startMonth.getUTCFullYear()}-${String(startMonth.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const endKeyExcl = `${endMonth.getUTCFullYear()}-${String(endMonth.getUTCMonth() + 1).padStart(2, '0')}-01`;
    windows.push({ startKey, endKeyExcl, start: zoneMidnightUtc(startKey, tz), end: zoneMidnightUtc(endKeyExcl, tz) });
  }
  return windows;
}

function recentGoalHistory(goal, activities, streaks, tz, now = new Date()) {
  if (goal.type === 'streak' || goal.period === 'custom') return { previousPeriodUnavailableReason: 'goal_type_requires_saved_history' };
  const windows = priorClosedGoalWindows(goal, tz, now);
  if (!windows.length) return {};
  const previousPeriods = [];
  let previousPeriodUnavailableReason = null;
  for (const window of windows) {
    const existedAtStart = !!goal.start_date && String(goal.start_date) <= window.startKey &&
      Number.isFinite(Date.parse(goal.created_at)) && Date.parse(goal.created_at) <= window.start.getTime();
    const unchangedAfterClose = !goal.updated_at ||
      (Number.isFinite(Date.parse(goal.updated_at)) && Date.parse(goal.updated_at) <= window.end.getTime());
    if (!existedAtStart) { previousPeriodUnavailableReason = previousPeriodUnavailableReason || 'goal_did_not_exist'; continue; }
    if (!unchangedAfterClose) { previousPeriodUnavailableReason = previousPeriodUnavailableReason || 'goal_changed_after_period'; continue; }
    const result = goalProgressInWindow(goal, activities, streaks, tz, window, now.getTime());
    const unit = goalNaturalUnit(goal);
    previousPeriods.push({
      windowStart: window.startKey, windowEnd: window.endKeyExcl,
      target: { value: result.target, unit },
      progress: { value: result.progress, unit, percent: result.pct },
      achieved: result.isComplete
    });
  }
  return {
    previousPeriodRange: { windowStart: windows.at(-1).startKey, windowEnd: windows[0].endKeyExcl },
    ...(previousPeriods.length ? { previousPeriods } : {}),
    ...(previousPeriodUnavailableReason ? { previousPeriodUnavailableReason } : {})
  };
}

function enrichGoal(goal, activities, streaks, tz, { now = new Date(), dayStablePace = true } = {}) {
  const window = goalWindow(goal, tz, now);
  const { start, end } = window;
  const result = goalProgressInWindow(goal, activities, streaks, tz, window, now.getTime());
  const { target, targetCmp, progress, progressCmp, pct, isComplete } = result;
  const expired = !isComplete && now >= end;
  const daysRemaining = Math.max(0, Math.ceil((end - now) / 86400000));
  const elapsedFrac = dayStablePace
    ? Math.min(1, Math.max(0, (keyToEpochDays(dayKey(now, tz)) - keyToEpochDays(window.startKey)) /
      (keyToEpochDays(window.endKeyExcl) - keyToEpochDays(window.startKey) || 1)))
    : Math.min(1, Math.max(0, (now - start) / (end - start || 1)));
  const progressFrac = targetCmp > 0 ? progressCmp / targetCmp : 0;
  const onTrack = isComplete || (!expired && progressFrac >= elapsedFrac);
  return {
    id: goal.id, type: goal.type, sport: goal.sport || null, unit: goal.unit || null,
    period: goal.period, startDate: goal.start_date, endDate: goal.end_date || null,
    status: goal.status, createdAt: goal.created_at, target, progress, pct, isComplete,
    windowStart: start.toISOString(), windowEnd: end.toISOString(), daysRemaining, onTrack,
    projection: 'linear', state: isComplete ? 'completed' : expired ? 'expired' : 'active'
  };
}

function createAiInsightsRuntime(options = {}) {
  const admin = options.supabaseAdmin || (process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
      })
    : null);
  let anthropicClient = null;

  async function listAllAuthUsers() {
    const all = [];
    if (!admin) return all;
    const perPage = 1000;
    for (let page = 1; page <= 50; page++) {
      try {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
        if (error) break;
        const users = (data && data.users) || [];
        all.push(...users);
        if (users.length < perPage) break;
      } catch (err) {
        console.log('listUsers error:', err.message);
        break;
      }
    }
    return all;
  }

  async function fetchAllRows(table, applyFilters, columns) {
    const PAGE = 1000;
    const out = [];
    for (let from = 0; ; from += PAGE) {
      let query = admin.from(table).select(columns || '*').range(from, from + PAGE - 1);
      query = applyFilters(query);
      const { data, error } = await query;
      if (error) throw new Error(table + ': ' + error.message);
      out.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    return out;
  }

  async function getAuthUser(userId) {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error) throw error;
    return data && data.user;
  }

  async function fetchActivitiesForUsers(userIds, period, sport, timezone, optionsForQuery) {
    if (!admin || !userIds.length) return [];
    const { start, end } = getDateRange(period, timezone, optionsForQuery?.now);
    let query = admin.from('activities').select('user_id, sport, distance, date').in('user_id', userIds);
    if (start) query = query.gte('date', start);
    if (optionsForQuery && optionsForQuery.capAtNow && end) query = query.lte('date', end);
    if (sport && sport !== 'all') query = query.eq('sport', sport);
    const { data, error } = await query;
    if (error) return [];
    return data || [];
  }

  function bucketActivities(activities) {
    const byUser = {};
    (activities || []).forEach((activity) => {
      (byUser[activity.user_id] = byUser[activity.user_id] || []).push(activity);
    });
    return byUser;
  }

  async function buildUserProfileMap(ids, identityMemo) {
    const map = {};
    if (!admin) return map;
    const unique = [...new Set((ids || []).filter(Boolean))];
    await Promise.all(unique.map(async (id) => {
      try {
        const user = identityMemo ? await identityMemo.get(id) : (await admin.auth.admin.getUserById(id)).data?.user;
        if (user) {
          const metadata = user.user_metadata || {};
          const display = displayFromUser(user);
          map[id] = {
            name: display.name, handle: display.handle, avatar_url: display.avatar_url || null,
            sports: Array.isArray(metadata.sports) ? metadata.sports : [], location: metadata.location || null,
            timezone: metadata.timezone || null, prefs: prefsFromMeta(metadata),
            profilePublic: prefsFromMeta(metadata).show_on_leaderboards !== false
          };
        }
      } catch (err) {}
    }));
    return map;
  }

  async function getCurrentClubMembership(userId, clubId) {
    const { data, error } = await admin.from('memberships').select('role').eq('user_id', userId).eq('club_id', clubId).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function buildClubPointsLeaderboard(memberRows, profileMap, period, viewer, optionsForBoard = {}) {
    const orderedMemberIds = [...new Set((memberRows || []).map((member) => member.user_id).filter(Boolean))];
    const orderIndex = new Map(orderedMemberIds.map((id, index) => [id, index]));
    const rankedMemberIds = orderedMemberIds.filter((id) => !(profileMap[id] && profileMap[id].prefs && !profileMap[id].prefs.show_on_leaderboards));
    const byUser = bucketActivities(await fetchActivitiesForUsers(rankedMemberIds, period, 'all', getUserTimezone(viewer), { capAtNow: true, now: optionsForBoard.now }));
    const leaderboard = rankedMemberIds.map((id) => {
      const profile = profileMap[id] || { name: 'Member', handle: 'member', sports: [], location: null };
      const activities = byUser[id] || [];
      return {
        userId: id, name: profile.name, handle: profile.handle, avatar_url: profile.avatar_url || null,
        sports: profile.sports, location: profile.location, profilePublic: profile.profilePublic !== false,
        points: calculatePoints(activities), activityCount: activities.length, isMe: id === viewer.id
      };
    }).sort((a, b) => b.points - a.points || orderIndex.get(a.userId) - orderIndex.get(b.userId))
      .map((row, index) => ({ ...row, rank: index + 1 }));
    const mine = leaderboard.find((row) => row.userId === viewer.id);
    return { leaderboard, viewer: mine ? { rank: mine.rank, total: leaderboard.length, points: mine.points, activityCount: mine.activityCount } : null };
  }

  function canUserSeeEvent(userId, event, context) {
    if (!event || !userId) return false;
    if (event.created_by === userId) return true;
    if (event.visibility === 'public') return true;
    if (event.club_id) return context.memberClubs.has(event.club_id);
    if (event.visibility === 'private') return context.invitedEvents.has(event.id);
    return false;
  }

  async function visibleEventsFilter(userId, events) {
    const list = (events || []).filter(Boolean);
    if (!list.length) return [];
    const context = { memberClubs: new Set(), invitedEvents: new Set() };
    const clubIds = [...new Set(list.map((event) => event.club_id).filter(Boolean))];
    const privateIds = list.filter((event) => event.visibility === 'private' && !event.club_id && event.created_by !== userId).map((event) => event.id);
    const [memberships, invites] = await Promise.all([
      clubIds.length ? admin.from('memberships').select('club_id').eq('user_id', userId).in('club_id', clubIds) : Promise.resolve({ data: [] }),
      privateIds.length ? admin.from('event_invites').select('event_id').eq('invitee_id', userId).in('event_id', privateIds) : Promise.resolve({ data: [] })
    ]);
    (memberships.data || []).forEach((row) => context.memberClubs.add(row.club_id));
    (invites.data || []).forEach((row) => context.invitedEvents.add(row.event_id));
    return list.filter((event) => canUserSeeEvent(userId, event, context));
  }

  async function enrichGoalRows(userId, rows, timezone, { includeRecentHistory = false, now = new Date(), dayStablePace = true } = {}) {
    let activityQuery = admin.from('activities')
      .select(includeRecentHistory ? 'id, sport, distance, duration, date' : 'sport, distance, duration, date')
      .eq('user_id', userId);
    if (includeRecentHistory) activityQuery = activityQuery.order('date', { ascending: true }).order('id', { ascending: true });
    const { data: activitiesRows } = await activityQuery;
    const activities = activitiesRows || [];
    const streaks = computeStreaks(activities, timezone, now.getTime());
    return rows.map((goal) => ({
      ...enrichGoal(goal, activities, streaks, timezone, { now, dayStablePace }),
      ...(includeRecentHistory ? recentGoalHistory(goal, activities, streaks, timezone, now) : {})
    }));
  }

  function createAnthropicClient(providerConfig) {
    if (anthropicClient) return anthropicClient;
    const optionsForClient = { apiKey: providerConfig.apiKey };
    if (providerConfig.provider === 'replit-ai-integrations') optionsForClient.baseURL = providerConfig.baseURL;
    anthropicClient = new Anthropic(optionsForClient);
    return anthropicClient;
  }

  return {
    supabaseAdmin: admin, getAuthUser, getUserTimezone, dayKey, keyToEpochDays,
    addDaysToKey, weekStartKey, monthKey, computeStreaks, parseDurationHours,
    parseDistanceKmUnitAware, calculatePoints, fetchAllRows, visibleEventsFilter,
    prefsFromMeta, listAllAuthUsers, fetchActivitiesForUsers, bucketActivities,
    buildUserProfileMap, buildClubPointsLeaderboard, getCurrentClubMembership,
    enrichGoalRows, goalNaturalUnit, createAnthropicClient
  };
}

module.exports = {
  createAiInsightsRuntime,
  prefsFromMeta,
  parseDurationHours,
  parseDistanceKmUnitAware,
  calculatePoints,
  goalNaturalUnit,
  goalWindow,
  goalProgressInWindow,
  priorClosedGoalWindows,
  recentGoalHistory,
  enrichGoal
};