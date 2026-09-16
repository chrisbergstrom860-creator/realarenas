// The AI Insights service deliberately has no Express dependency.  The web
// server and short-lived jobs bind the application's established data helpers
// below, so both paths use the same privacy-filtered context projection.
const {
  FALLBACK_COPY,
  validateInsightResponse,
  parseModelJson,
  buildWeeklyRecapRequest,
  validateWeeklyRecapCompleteness,
  resolveAnthropicProvider,
  buildAiInsightsRequest
} = require('./ai-insights');
const { ACTIVITY_FEELING_LABELS } = require('./html/arenas-activity-card.js');
const { createAiInsightsRuntime } = require('./ai-insights-runtime');

function round1(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function buildAiPersonalRecords(acts, tz, deps) {
  const { parseDistanceKmUnitAware, parseDurationHours, dayKey } = deps;
  const km = (a) => parseDistanceKmUnitAware(a.distance);
  const records = [];
  const preferRecord = (winner, row, value) => {
    const difference = value(row) - value(winner);
    if (difference !== 0) return difference > 0 ? row : winner;
    const dateOrder = String(row.date).localeCompare(String(winner.date));
    if (dateOrder !== 0) return dateOrder < 0 ? row : winner;
    return String(row.sport || 'other').localeCompare(String(winner.sport || 'other')) < 0 ? row : winner;
  };
  const addDistanceRecord = (type, sport, rows) => {
    if (!rows.length) return;
    const best = rows.reduce((winner, row) => preferRecord(winner, row, km));
    records.push({ type, sport, value: round1(km(best)), unit: 'km', date: dayKey(best.date, tz) });
  };
  addDistanceRecord('longest_run', 'running', acts.filter((a) => a.sport === 'running' && km(a) > 0));
  addDistanceRecord('longest_ride', 'cycling', acts.filter((a) => a.sport === 'cycling' && km(a) > 0));
  const timed = acts.filter((a) => parseDurationHours(a.duration) > 0);
  if (timed.length) {
    const best = timed.reduce((winner, row) => preferRecord(winner, row, (activity) => parseDurationHours(activity.duration)));
    records.push({
      type: 'longest_activity',
      sport: best.sport || 'other',
      value: round1(parseDurationHours(best.duration)),
      unit: 'hours',
      date: dayKey(best.date, tz)
    });
  }
  return records;
}

/**
 * Bind the service to the existing Arenas data-access and privacy helpers.
 * Dependencies are injected rather than importing server.js, which keeps this
 * module safe to use from a one-shot job process.
 */
function createAiInsightsService(deps) {
  const {
    supabaseAdmin, getAuthUser, getUserTimezone, dayKey, keyToEpochDays,
    addDaysToKey, weekStartKey, monthKey, computeStreaks,
    parseDurationHours, parseDistanceKmUnitAware, calculatePoints,
    fetchAllRows, visibleEventsFilter, prefsFromMeta, listAllAuthUsers,
    fetchActivitiesForUsers, bucketActivities, buildUserProfileMap,
    buildClubPointsLeaderboard, getCurrentClubMembership, enrichGoalRows,
    goalNaturalUnit, createAnthropicClient
  } = deps;

  async function buildContextForAuthenticatedUser(user, asOf = new Date()) {
    if (!user || !user.id) throw new Error('AI Insights context requires a user');
    if (!supabaseAdmin) throw new Error('AI Insights service requires Supabase');
    const now = new Date(asOf);
    if (!Number.isFinite(now.getTime())) throw new Error('AI Insights context requires a valid asOf date');
    const feelingKeys = Object.keys(ACTIVITY_FEELING_LABELS);
    const tz = getUserTimezone(user);
    const today = dayKey(now, tz);
    const windowStart = weekStartKey(now, tz, 11);
    const windowEnd = addDaysToKey(today, 1);
    const { data: activityRows, error: activityError } = await supabaseAdmin
      .from('activities').select('id, sport, distance, duration, date, feeling')
      .eq('user_id', user.id).order('date', { ascending: true }).order('id', { ascending: true });
    if (activityError) throw activityError;
    const acts = (activityRows || []).filter((row) => dayKey(row.date, tz) <= today);
    const detailedActs = acts.filter((a) => {
      const key = dayKey(a.date, tz);
      return key >= windowStart && key < windowEnd;
    });
    const rawTotals = (rows) => ({
      durationHours: rows.reduce((sum, row) => sum + parseDurationHours(row.duration), 0),
      distanceKm: rows.reduce((sum, row) => sum + parseDistanceKmUnitAware(row.distance), 0)
    });
    const summarize = (rows) => {
      const raw = rawTotals(rows);
      return {
        activityCount: rows.length,
        durationHours: round1(raw.durationHours),
        distanceKm: round1(raw.distanceKm),
        points: calculatePoints(rows)
      };
    };
    const summarizeFeelings = (rows) => Object.fromEntries(feelingKeys.map((key) => [
      key, rows.reduce((count, row) => count + (row.feeling === key ? 1 : 0), 0)
    ]));
    const inclusiveDays = (start, end) => Math.max(0, keyToEpochDays(end) - keyToEpochDays(start) + 1);
    const withAverages = (rows, observedDays) => {
      const totals = summarize(rows);
      const raw = rawTotals(rows);
      const observedWeeks = observedDays > 0 ? observedDays / 7 : 0;
      return {
        ...totals,
        averageSessionDurationHours: rows.length ? round1(raw.durationHours / rows.length) : 0,
        averageHoursPerWeek: observedWeeks ? round1(raw.durationHours / observedWeeks) : 0,
        averageSessionsPerWeek: observedWeeks ? round1(rows.length / observedWeeks) : 0,
        averageDistanceKmPerActivity: rows.length ? round1(raw.distanceKm / rows.length) : 0
      };
    };
    const summarizeSports = (rows, observedDays) => {
      const sportMap = {};
      for (const row of rows) {
        const sport = row.sport || 'other';
        if (!sportMap[sport]) sportMap[sport] = [];
        sportMap[sport].push(row);
      }
      return Object.entries(sportMap).map(([sport, sportRows]) => {
        const totals = withAverages(sportRows, observedDays);
        return {
          sport, sessions: sportRows.length, durationHours: totals.durationHours, distanceKm: totals.distanceKm,
          percentSessions: rows.length ? Math.round((sportRows.length / rows.length) * 100) : 0,
          averageSessionDurationHours: totals.averageSessionDurationHours,
          averageHoursPerWeek: totals.averageHoursPerWeek,
          averageSessionsPerWeek: totals.averageSessionsPerWeek,
          averageDistanceKmPerActivity: totals.averageDistanceKmPerActivity
        };
      }).sort((a, b) => b.sessions - a.sessions || a.sport.localeCompare(b.sport));
    };
    const allTimeStart = acts.length ? dayKey(acts[0].date, tz) : today;
    const allTimeObservedDays = inclusiveDays(allTimeStart, today);
    const detailedObservedDays = inclusiveDays(windowStart, today);
    const sports = summarizeSports(acts, allTimeObservedDays);
    const dailyMap = {};
    for (const row of detailedActs) {
      const date = dayKey(row.date, tz);
      const item = dailyMap[date] || { date, sessions: 0, durationHours: 0, distanceKm: 0, sports: [] };
      item.sessions += 1;
      item.durationHours += parseDurationHours(row.duration);
      item.distanceKm += parseDistanceKmUnitAware(row.distance);
      if (!item.sports.includes(row.sport || 'other')) item.sports.push(row.sport || 'other');
      dailyMap[date] = item;
    }
    const daily = Object.values(dailyMap).map((item) => ({
      ...item, durationHours: round1(item.durationHours), distanceKm: round1(item.distanceKm)
    })).sort((a, b) => a.date.localeCompare(b.date));
    const weekly = [];
    const feelings = [];
    for (let i = 11; i >= 0; i--) {
      const start = weekStartKey(now, tz, i);
      const end = addDaysToKey(start, 7);
      const rows = detailedActs.filter((a) => {
        const key = dayKey(a.date, tz);
        return key >= start && key < end;
      });
      const bySportMap = {};
      for (const row of rows) {
        const sport = row.sport || 'other';
        const item = bySportMap[sport] || { sport, sessions: 0, durationHours: 0, distanceKm: 0 };
        item.sessions += 1;
        item.durationHours += parseDurationHours(row.duration);
        item.distanceKm += parseDistanceKmUnitAware(row.distance);
        bySportMap[sport] = item;
      }
      const relative = i === 0 ? 'this_week' : i === 1 ? 'last_week' : `${i}_weeks_ago`;
      weekly.push({
        weekStart: start, relative, ...summarize(rows),
        sports: Object.values(bySportMap).sort((a, b) => a.sport.localeCompare(b.sport)).map((item) => ({
          sport: item.sport, sessions: item.sessions,
          durationHours: round1(item.durationHours), distanceKm: round1(item.distanceKm)
        }))
      });
      feelings.push({ weekStart: start, relative, ...summarizeFeelings(rows) });
    }
    const activeWeeks = weekly.filter((week) => week.activityCount > 0).length;
    const { currentStreak, longestStreak } = computeStreaks(acts, tz, now.getTime());
    const shiftMonthKey = (key, offset) => {
      const [year, month] = key.split('-').map(Number);
      const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
      return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
    };
    const currentMonth = monthKey(now, tz);
    const last12Months = [];
    for (let offset = -11; offset <= 0; offset++) {
      const monthsAgo = Math.abs(offset);
      const month = shiftMonthKey(currentMonth, offset);
      const monthStart = month + '-01';
      const monthEnd = month === currentMonth ? today : addDaysToKey(shiftMonthKey(month, 1) + '-01', -1);
      const observedDays = inclusiveDays(monthStart, monthEnd);
      const rows = acts.filter((row) => monthKey(row.date, tz) === month);
      const totals = withAverages(rows, observedDays);
      const activeDays = new Set(rows.map((row) => dayKey(row.date, tz))).size;
      last12Months.push({
        month, relative: monthsAgo === 0 ? 'this_month' : monthsAgo === 1 ? 'last_month' : `${monthsAgo}_months_ago`,
        sessions: rows.length, durationHours: totals.durationHours, distanceKm: totals.distanceKm,
        activeDays, restDays: Math.max(0, observedDays - activeDays), observedDays,
        averageSessionDurationHours: totals.averageSessionDurationHours,
        averageHoursPerWeek: totals.averageHoursPerWeek,
        averageSessionsPerWeek: totals.averageSessionsPerWeek,
        averageDistanceKmPerActivity: totals.averageDistanceKmPerActivity,
        sports: summarizeSports(rows, observedDays)
      });
    }
    const context = {
      schemaVersion: 8, asOfDate: today, timezone: tz,
      coverage: {
        firstActivityDate: acts.length ? dayKey(acts[0].date, tz) : null,
        lastActivityDate: acts.length ? dayKey(acts[acts.length - 1].date, tz) : null,
        allTimeActivityCount: acts.length,
        detailedWindow: { startDate: windowStart, endDate: today, weeks: 12 }
      },
      allTime: {
        ...withAverages(acts, allTimeObservedDays), sports,
        streaks: { currentDays: currentStreak, longestDays: longestStreak },
        personalRecords: buildAiPersonalRecords(acts, tz, deps)
      },
      last12Weeks: {
        ...withAverages(detailedActs, detailedObservedDays), activeWeeks,
        sports: summarizeSports(detailedActs, detailedObservedDays), daily, weekly, feelings,
        feelingsTotal: summarizeFeelings(detailedActs)
      },
      last12Months,
      dataQuality: {
        activityCount: acts.length, activeWeeksInDetailedWindow: activeWeeks,
        trendMinimumActivities: 8, trendMinimumActiveWeeks: 4,
        trendEligible: acts.length >= 8 && activeWeeks >= 4
      }
    };
    const planMonthStart = shiftMonthKey(currentMonth, -11) + '-01';
    const [futurePlanRows, adherenceRows, membershipRows, ownRsvpRows, activeGoalsRes] = await Promise.all([
      fetchAllRows('planned_sessions', (query) => query.eq('user_id', user.id).gte('date', today)
        .order('date', { ascending: true }).order('id', { ascending: true }), 'id, date, sport, title, planned_duration, status'),
      fetchAllRows('planned_sessions', (query) => query.eq('user_id', user.id).gte('date', planMonthStart).lt('date', today), 'date, status'),
      fetchAllRows('memberships', (query) => query.eq('user_id', user.id), 'club_id'),
      fetchAllRows('event_rsvps', (query) => query.eq('user_id', user.id).in('status', ['going', 'interested']), 'event_id, status'),
      supabaseAdmin.from('goals').select('*', { count: 'exact' }).eq('user_id', user.id).eq('status', 'active')
        .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(5)
    ]);
    if (activeGoalsRes.error) throw activeGoalsRes.error;
    const includedFuturePlanRows = futurePlanRows.slice(0, 100);
    const futurePlans = includedFuturePlanRows.map((row) => ({
      date: row.date, sport: row.sport, title: row.title || null,
      plannedDuration: row.planned_duration || null, status: row.status
    }));
    const adherence = last12Months.map((monthRow) => {
      const rows = adherenceRows.filter((row) => String(row.date).slice(0, 7) === monthRow.month);
      return {
        month: monthRow.month, relative: monthRow.relative,
        done: rows.filter((row) => row.status === 'done').length,
        skipped: rows.filter((row) => row.status === 'skipped').length,
        stillPlanned: rows.filter((row) => row.status === 'planned').length
      };
    });
    const memberClubIds = [...new Set(membershipRows.map((row) => row.club_id).filter(Boolean))];
    const ownRsvpMap = new Map(ownRsvpRows.map((row) => [row.event_id, row.status]));
    const ownRsvpEventIds = [...ownRsvpMap.keys()];
    const eventSelect = 'id, date, title, sport, event_type, visibility, club_id, created_by';
    const eventQueries = [];
    const EVENT_FILTER_CHUNK = 200;
    for (let i = 0; i < memberClubIds.length; i += EVENT_FILTER_CHUNK) {
      const ids = memberClubIds.slice(i, i + EVENT_FILTER_CHUNK);
      eventQueries.push(fetchAllRows('events', (query) => query.in('club_id', ids).gte('date', now.toISOString())
        .order('date', { ascending: true }).order('id', { ascending: true }), eventSelect));
    }
    for (let i = 0; i < ownRsvpEventIds.length; i += EVENT_FILTER_CHUNK) {
      const ids = ownRsvpEventIds.slice(i, i + EVENT_FILTER_CHUNK);
      eventQueries.push(fetchAllRows('events', (query) => query.in('id', ids).gte('date', now.toISOString())
        .order('date', { ascending: true }).order('id', { ascending: true }), eventSelect));
    }
    const eventMap = new Map();
    for (const rows of await Promise.all(eventQueries)) for (const event of rows) eventMap.set(event.id, event);
    const visibleEligibleEvents = (await visibleEventsFilter(user.id, [...eventMap.values()]))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
    const includedEvents = visibleEligibleEvents.slice(0, 50);
    const eventClubIds = [...new Set(includedEvents.map((event) => event.club_id).filter(Boolean))];
    let clubNameMap = new Map();
    if (eventClubIds.length) {
      const { data: clubs, error: clubsError } = await supabaseAdmin.from('clubs').select('id, name').in('id', eventClubIds);
      if (clubsError) throw clubsError;
      clubNameMap = new Map((clubs || []).map((club) => [club.id, club.name]));
    }
    const calendarEvents = includedEvents.map((event) => ({
      date: event.date, title: event.title, sport: event.sport || null, type: event.event_type || null,
      clubName: event.club_id ? clubNameMap.get(event.club_id) || null : null, ownRsvp: ownRsvpMap.get(event.id) || null
    }));
    const plannedByMonthMap = new Map();
    const lastPlanMonth = futurePlanRows.reduce((latest, row) => {
      const month = String(row.date).slice(0, 7);
      return month > latest ? month : latest;
    }, currentMonth);
    const plannedMonthEnd = [shiftMonthKey(currentMonth, 1), lastPlanMonth].sort((a, b) => a.localeCompare(b)).at(-1);
    for (let month = currentMonth; month <= plannedMonthEnd; month = shiftMonthKey(month, 1)) {
      plannedByMonthMap.set(month, { month, plannedCount: 0, totalPlannedMinutes: 0, included: 0, truncated: false });
    }
    for (const row of futurePlanRows) {
      const month = String(row.date).slice(0, 7);
      if (row.status === 'planned') {
        const bucket = plannedByMonthMap.get(month);
        bucket.plannedCount++;
        bucket.totalPlannedMinutes += Math.round(parseDurationHours(row.planned_duration) * 60);
      }
    }
    for (const row of includedFuturePlanRows) {
      if (row.status === 'planned') plannedByMonthMap.get(String(row.date).slice(0, 7)).included++;
    }
    const plannedByMonth = [...plannedByMonthMap.values()].sort((a, b) => a.month.localeCompare(b.month));
    for (const bucket of plannedByMonth) bucket.truncated = bucket.plannedCount > bucket.included;
    const eventByMonthMap = new Map();
    const lastEventMonth = visibleEligibleEvents.reduce((latest, event) => {
      const month = monthKey(event.date, tz);
      return month > latest ? month : latest;
    }, currentMonth);
    const eventMonthEnd = [shiftMonthKey(currentMonth, 1), lastEventMonth].sort((a, b) => a.localeCompare(b)).at(-1);
    for (let month = currentMonth; month <= eventMonthEnd; month = shiftMonthKey(month, 1)) {
      eventByMonthMap.set(month, { month, count: 0, included: 0, truncated: false });
    }
    for (const event of visibleEligibleEvents) eventByMonthMap.get(monthKey(event.date, tz)).count++;
    for (const event of includedEvents) eventByMonthMap.get(monthKey(event.date, tz)).included++;
    const eventsByMonth = [...eventByMonthMap.values()].sort((a, b) => a.month.localeCompare(b.month));
    for (const bucket of eventsByMonth) bucket.truncated = bucket.count > bucket.included;
    context.calendar = {
      plannedSessions: { items: futurePlans, included: futurePlans.length, total: futurePlanRows.length, truncated: futurePlanRows.length > futurePlans.length, byMonth: plannedByMonth },
      events: { items: calendarEvents, included: calendarEvents.length, total: visibleEligibleEvents.length, truncated: visibleEligibleEvents.length > calendarEvents.length, byMonth: eventsByMonth },
      pastPlanAdherence: adherence,
      limitations: { futurePlansOnly: true, futureEventsOnly: true, eventEligibility: 'own_rsvp_or_club_membership', planHistory: 'monthly_status_counts_last_12_months' }
    };
    const enrichedGoals = await enrichGoalRows(user.id, activeGoalsRes.data || [], tz, { includeRecentHistory: true, now });
    const goalItems = enrichedGoals.map((goal) => ({
      type: goal.type, sport: goal.sport, target: { value: goal.target, unit: goalNaturalUnit(goal) },
      period: goal.period, progress: { value: goal.progress, unit: goalNaturalUnit(goal), percent: goal.pct },
      onTrack: goal.onTrack, isComplete: goal.isComplete, windowStart: goal.windowStart, windowEnd: goal.windowEnd,
      ...(goal.previousPeriodRange ? { previousPeriodRange: goal.previousPeriodRange } : {}),
      ...(goal.previousPeriods ? { previousPeriods: goal.previousPeriods } : {}),
      ...(goal.previousPeriodUnavailableReason ? { previousPeriodUnavailableReason: goal.previousPeriodUnavailableReason } : {})
    }));
    context.goals = {
      active: { items: goalItems, included: goalItems.length, total: activeGoalsRes.count || 0, truncated: (activeGoalsRes.count || 0) > goalItems.length },
      limitations: { activeOnly: true, projection: 'server_computed_linear_pace', historicalGoalsIncluded: false, crossGoalComparisonSupported: false, catchUpProjectionSupported: false }
    };
    if (prefsFromMeta(user.user_metadata).show_on_leaderboards) {
      const platformUsers = (await listAllAuthUsers()).filter((candidate) => prefsFromMeta(candidate.user_metadata).show_on_leaderboards);
      const platformIds = platformUsers.map((candidate) => candidate.id);
      const platformByUser = bucketActivities(await fetchActivitiesForUsers(platformIds, 'month', 'all', tz, { capAtNow: true, now }));
      const ranked = platformUsers.map((candidate) => ({
        id: candidate.id, points: calculatePoints(platformByUser[candidate.id] || []),
        activityCount: (platformByUser[candidate.id] || []).length
      })).filter((row) => row.activityCount > 0).sort((a, b) => b.points - a.points || b.activityCount - a.activityCount || a.id.localeCompare(b.id));
      let previousPoints = null;
      let sharedRank = 0;
      ranked.forEach((row, index) => {
        if (index === 0 || row.points !== previousPoints) sharedRank = index + 1;
        previousPoints = row.points;
        row.rank = sharedRank;
      });
      const mine = ranked.find((row) => row.id === user.id);
      if (mine) context.standings = { platform: { month: { rank: mine.rank, totalRanked: ranked.length, points: mine.points, activityCount: mine.activityCount } }, clubs: [] };
      const { data: ownMemberships, error: membershipsError } = await supabaseAdmin.from('memberships')
        .select('club_id, role, clubs:club_id (name)').eq('user_id', user.id).order('club_id', { ascending: true });
      if (membershipsError) throw membershipsError;
      for (const membership of (ownMemberships || [])) {
        const { data: memberRows, error: memberError } = await supabaseAdmin.from('memberships').select('user_id, created_at')
          .eq('club_id', membership.club_id).order('created_at', { ascending: true }).order('user_id', { ascending: true });
        if (memberError) throw memberError;
        const profileMap = await buildUserProfileMap((memberRows || []).map((row) => row.user_id));
        const safeRows = (memberRows || []).filter((row) => profileMap[row.user_id] && profileMap[row.user_id].prefs.show_on_leaderboards);
        const board = await buildClubPointsLeaderboard(safeRows, profileMap, 'month', user, { now });
        if (!await getCurrentClubMembership(user.id, membership.club_id)) throw new Error('Club membership changed');
        if (board.viewer) {
          if (!context.standings) context.standings = { clubs: [] };
          if (!context.standings.clubs) context.standings.clubs = [];
          const club = Array.isArray(membership.clubs) ? membership.clubs[0] : membership.clubs;
          context.standings.clubs.push({
            clubName: (club && club.name) || 'Club', role: membership.role,
            month: { rank: board.viewer.rank, totalRanked: board.viewer.total, points: board.viewer.points, activityCount: board.viewer.activityCount }
          });
        }
      }
    }
    return context;
  }

  async function buildContextForUser(userId, asOf = new Date()) {
    if (typeof getAuthUser !== 'function') throw new Error('AI Insights service cannot load users');
    const user = await getAuthUser(userId);
    if (!user) throw new Error('AI Insights user was not found');
    return buildContextForAuthenticatedUser(user, asOf);
  }

  async function runValidatedRequest(context, mode = 'ask', opts = {}) {
    const providerConfig = opts.providerConfig || resolveAnthropicProvider(process.env);
    if (typeof createAnthropicClient !== 'function') throw new Error('AI Insights service cannot create an Anthropic client');
    let request;
    if (mode === 'recap') {
      // Recaps use the contract's fixed synthetic question and intentionally
      // have no browser-supplied history. They do not consume ask quota here.
      request = buildWeeklyRecapRequest(context);
    } else if (mode === 'ask') {
      const question = opts.question;
      const history = Array.isArray(opts.history) ? opts.history : [];
      if (typeof question !== 'string' || !question.trim()) throw new Error('AI Insights request requires a question');
      request = buildAiInsightsRequest(context, question, history);
    } else {
      throw new Error(`Unknown AI Insights request mode: ${mode}`);
    }
    const response = await createAnthropicClient(providerConfig).messages.create(
      request
    );
    const text = (response.content || []).filter((block) => block.type === 'text').map((block) => block.text).join('');
    const ordinary = validateInsightResponse(text, context);
    const validated = mode === 'recap'
      ? validateWeeklyRecapCompleteness(text, context, ordinary)
      : ordinary;
    const parsed = parseModelJson(text);
    const findings = validated.ok && parsed && Array.isArray(parsed.findings) ? parsed.findings : null;
    return {
      response,
      text,
      validated,
      findings,
      answer: validated.answer || FALLBACK_COPY,
      usage: response.usage || null
    };
  }

  // Existing renderer is intentionally validation-coupled: arbitrary prose is
  // never trusted. Callers pass the original context and typed findings.
  function renderProse(findings, context, limitations = []) {
    const validated = validateInsightResponse(JSON.stringify({ findings, limitations }), context);
    return { ok: validated.ok, prose: validated.answer || FALLBACK_COPY, validated };
  }

  return { buildContextForUser, buildContextForAuthenticatedUser, runValidatedRequest, renderProse };
}

let configuredService = null;

function configureAiInsightsService(deps) {
  configuredService = createAiInsightsService(deps);
  return configuredService;
}

function requiredConfiguredService() {
  // The HTTP server configures this with its one existing admin client.  The
  // short-lived recap command deliberately has no Express import, so it gets
  // this same dependency contract from the standalone runtime instead.
  if (!configuredService) configuredService = createAiInsightsService(createAiInsightsRuntime());
  return configuredService;
}

// These public functions make the service API uniform for the web server and
// the future one-shot recap runner. A runtime must first call configure...()
// with its established data/privacy helpers.
function buildContextForUser(userId, asOf) {
  return requiredConfiguredService().buildContextForUser(userId, asOf);
}

function runValidatedRequest(context, mode, opts) {
  return requiredConfiguredService().runValidatedRequest(context, mode, opts);
}

function renderProse(findings, context, limitations) {
  return requiredConfiguredService().renderProse(findings, context, limitations);
}

module.exports = {
  createAiInsightsService,
  configureAiInsightsService,
  buildContextForUser,
  runValidatedRequest,
  renderProse,
  round1
};