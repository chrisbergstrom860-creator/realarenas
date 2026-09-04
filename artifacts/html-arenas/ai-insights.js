const crypto = require('crypto');

const FALLBACK_COPY = "I couldn’t produce an answer supported by your recorded data. Try asking about your activity count, volume, sports, streaks, personal records, standings, upcoming schedule, events, or active goals.";
const REFUSAL_COPY = "I can describe your recorded training, but I can’t prescribe workouts or comment on diet, weight, body composition, or whether you are under-training. Try asking what changed in your volume, consistency, sports, personal records, or standings.";
const MODEL = 'claude-haiku-4-5';
const MAX_HISTORY_TURNS = 3;
const MAX_CALENDAR_LIST_ITEMS = 10;
const HISTORY_TTL_MS = 12 * 60 * 60 * 1000;
const POLICY_REFUSAL_REASONS = new Set([
  'prescriptive',
  'diet_weight_body',
  'medical',
  'athlete_characterization'
]);
const NOT_ANSWERABLE_COPY = {
  missing_injury_date: "Your recorded data does not include when your injury occurred, so I can’t answer questions about activity before or after it.",
  missing_medical_leave_dates: "Your recorded data does not include the start and end dates of your medical leave, so I can’t answer questions about activity during it.",
  missing_event_date: "Your recorded data does not include the date of the event needed to answer that question.",
  period_outside_coverage: "Detailed calendar totals are available for the last 12 months, so the requested period is outside the available coverage.",
  unsupported_metric: "Your recorded data does not include the measurement needed to answer that question.",
  goal_history_unavailable: "AI Insights includes active goals only, so goal history is unavailable.",
  goal_comparison_unsupported: "AI Insights can describe active goals individually, but it does not support comparisons between goals.",
  goal_projection_unsupported: "AI Insights includes the server-computed on-track status, but it cannot calculate a catch-up projection.",
  calendar_results_truncated: "Calendar results were capped, so AI Insights cannot answer a question that requires the omitted results."
};

class AiProviderConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiProviderConfigurationError';
    this.code = 'ai_insights_not_configured';
  }
}

function resolveAnthropicProvider(env = {}) {
  const replitKey = String(env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || '').trim();
  const replitBaseURL = String(env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL || '').trim();
  const directKey = String(env.ANTHROPIC_API_KEY || '').trim();
  const isRailway = Boolean(env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID || env.RAILWAY_SERVICE_ID);

  if (isRailway) {
    if (!directKey) {
      throw new AiProviderConfigurationError('ANTHROPIC_API_KEY is required on Railway');
    }
    return { provider: 'anthropic-direct', apiKey: directKey };
  }
  if (replitKey && replitBaseURL) {
    return { provider: 'replit-ai-integrations', apiKey: replitKey, baseURL: replitBaseURL };
  }
  if (replitKey || replitBaseURL) {
    throw new AiProviderConfigurationError('Both Replit Anthropic integration variables are required');
  }
  if (directKey) {
    return { provider: 'anthropic-direct', apiKey: directKey };
  }
  throw new AiProviderConfigurationError('No Anthropic provider credentials are configured');
}

function stableTurnPayload(userId, turn) {
  return JSON.stringify({
    userId,
    question: turn.question,
    answer: turn.answer,
    createdAt: turn.createdAt
  });
}

function signHistoryTurn(secret, userId, turn) {
  return crypto.createHmac('sha256', secret)
    .update(stableTurnPayload(userId, turn))
    .digest('base64url');
}

function makeSignedHistoryTurn(secret, userId, question, answer, now = new Date()) {
  const turn = {
    question: String(question || '').slice(0, 500),
    answer: String(answer || '').slice(0, 3000),
    createdAt: now.toISOString()
  };
  return { ...turn, signature: signHistoryTurn(secret, userId, turn) };
}

function verifyHistoryTurns(secret, userId, history, now = new Date()) {
  if (!Array.isArray(history)) return [];
  return history.slice(-MAX_HISTORY_TURNS).filter((turn) => {
    if (!turn || typeof turn !== 'object') return false;
    if (typeof turn.question !== 'string' || typeof turn.answer !== 'string' ||
        typeof turn.createdAt !== 'string' || typeof turn.signature !== 'string') return false;
    if (turn.question.length > 500 || turn.answer.length > 3000) return false;
    const age = now.getTime() - Date.parse(turn.createdAt);
    if (!Number.isFinite(age) || age < -60000 || age > HISTORY_TTL_MS) return false;
    const expected = signHistoryTurn(secret, userId, turn);
    const a = Buffer.from(expected);
    const b = Buffer.from(turn.signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }).map(({ question, answer, createdAt }) => ({ question, answer, createdAt }));
}

function tokenizePath(path) {
  if (typeof path !== 'string' || !path || path.length > 240) return null;
  if (!/^[A-Za-z0-9_.\[\]-]+$/.test(path)) return null;
  const normalized = path.replace(/\[(\d+)\]/g, '.$1');
  const tokens = normalized.split('.').filter(Boolean);
  return tokens.length && tokens.every((t) => /^(?:[A-Za-z][A-Za-z0-9_-]*|\d+)$/.test(t)) ? tokens : null;
}

function normalizePath(path) {
  const tokens = tokenizePath(path);
  return tokens ? tokens.join('.') : null;
}

function valueAtPath(root, path) {
  const tokens = tokenizePath(path);
  if (!tokens) return { found: false };
  let value = root;
  for (const token of tokens) {
    if (value == null || !Object.prototype.hasOwnProperty.call(Object(value), token)) return { found: false };
    value = value[token];
  }
  return { found: true, value };
}

function safeDiagnosticPath(path) {
  const tokens = tokenizePath(path);
  if (!tokens || !['allTime', 'last12Weeks', 'last12Months', 'coverage', 'standings', 'dataQuality', 'calendar', 'goals'].includes(tokens[0])) return null;
  const allowed = new Set([
    'allTime', 'last12Weeks', 'last12Months', 'coverage', 'standings', 'dataQuality',
    'activityCount', 'sessions', 'durationHours', 'distanceKm', 'points', 'sports',
    'percentSessions', 'activeDays', 'restDays', 'observedDays', 'activeWeeks',
    'averageSessionDurationHours', 'averageHoursPerWeek', 'averageSessionsPerWeek',
    'averageDistanceKmPerActivity', 'streaks', 'currentDays', 'longestDays',
    'personalRecords', 'firstActivityDate', 'lastActivityDate', 'daily', 'weekly',
    'date', 'weekStart', 'platform', 'clubs', 'month', 'rank', 'totalRanked',
    'activeWeeksInDetailedWindow', 'trendMinimumActivities', 'trendMinimumActiveWeeks',
    'trendEligible', 'calendar', 'goals', 'plannedSessions', 'events', 'pastPlanAdherence',
    'items', 'included', 'total', 'truncated', 'stillPlanned', 'done', 'skipped',
    'plannedDuration', 'status', 'title', 'type', 'clubName', 'ownRsvp', 'active',
    'target', 'progress', 'value', 'unit', 'period', 'percent', 'onTrack',
    'isComplete', 'windowStart', 'windowEnd', 'limitations', 'byMonth',
    'plannedCount', 'totalPlannedMinutes', 'count'
  ]);
  return tokens.every((token) => /^\d+$/.test(token) || allowed.has(token)) ? tokens.join('.') : null;
}

const STRICT_NUMERIC_STRING = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function comparableEvidenceValue(actual, claimed) {
  if (typeof actual === 'number' && typeof claimed === 'string' && STRICT_NUMERIC_STRING.test(claimed)) {
    const numeric = Number(claimed);
    if (Number.isFinite(numeric)) return numeric;
  }
  return claimed;
}

function equalEvidenceValue(actual, claimed) {
  if (typeof actual === 'number' && typeof claimed === 'number') {
    return Number.isFinite(actual) && Number.isFinite(claimed) && Math.abs(actual - claimed) < 1e-9;
  }
  const comparable = comparableEvidenceValue(actual, claimed);
  if (typeof actual === 'number' && typeof comparable === 'number') {
    return Number.isFinite(actual) && Number.isFinite(comparable) && Math.abs(actual - comparable) < 1e-9;
  }
  return JSON.stringify(actual) === JSON.stringify(comparable);
}

function safeMismatchDetails(actual, claimed) {
  if (typeof actual !== 'number' || !Number.isFinite(actual)) return null;
  const receivedType = Array.isArray(claimed) ? 'array' : claimed === null ? 'null' : typeof claimed;
  const safeReceived = (
    (typeof claimed === 'number' && Number.isFinite(claimed)) ||
    (typeof claimed === 'string' && STRICT_NUMERIC_STRING.test(claimed) && Number.isFinite(Number(claimed)))
  ) ? claimed : null;
  return {
    expectedValue: actual,
    receivedValue: safeReceived,
    expectedType: 'number',
    receivedType
  };
}

function parseModelJson(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch (err) { return null; }
}

function formatMetricValue(path, value) {
  if (/(?:durationHours|DurationHours|HoursPerWeek)$/.test(path)) return value + ' hours';
  if (/totalPlannedMinutes$/.test(path)) return value + (value === 1 ? ' minute' : ' minutes');
  if (/(?:distanceKm|DistanceKmPerActivity)$/.test(path)) return value + ' km';
  if (/percentSessions$/.test(path)) return value + '%';
  if (/averageSessionsPerWeek$/.test(path)) return value + ' sessions per week';
  if (/Days$/.test(path)) return value + (value === 1 ? ' day' : ' days');
  return String(value);
}

function metricDescription(context, path) {
  const tokens = tokenizePath(path);
  if (!tokens) return null;
  const fixed = {
    'allTime.activityCount': 'Your all-time activity count',
    'allTime.durationHours': 'Your all-time recorded duration',
    'allTime.distanceKm': 'Your all-time recorded distance',
    'allTime.points': 'Your all-time points',
    'allTime.streaks.currentDays': 'Your current streak',
    'allTime.streaks.longestDays': 'Your longest streak',
    'last12Weeks.activityCount': 'Your activity count in the last 12 weeks',
    'last12Weeks.durationHours': 'Your recorded duration in the last 12 weeks',
    'last12Weeks.distanceKm': 'Your recorded distance in the last 12 weeks',
    'last12Weeks.points': 'Your points in the last 12 weeks',
    'last12Weeks.activeWeeks': 'Your active weeks in the last 12 weeks',
    'last12Weeks.averageSessionsPerWeek': 'Your 12-week average',
    'last12Weeks.averageHoursPerWeek': 'Your average weekly recorded duration in the last 12 weeks',
    'last12Weeks.averageSessionDurationHours': 'Your average recorded session duration in the last 12 weeks',
    'last12Weeks.averageDistanceKmPerActivity': 'Your average recorded distance per activity in the last 12 weeks',
    'allTime.averageSessionsPerWeek': 'Your all-time average weekly session count',
    'allTime.averageHoursPerWeek': 'Your all-time average weekly recorded duration',
    'allTime.averageSessionDurationHours': 'Your all-time average recorded session duration',
    'allTime.averageDistanceKmPerActivity': 'Your all-time average recorded distance per activity',
    'coverage.firstActivityDate': 'Your first logged activity date',
    'coverage.lastActivityDate': 'Your latest logged activity date',
    'calendar.plannedSessions.total': 'Your future plan-record count across all statuses',
    'calendar.plannedSessions.included': 'Your future plan records included in AI Insights across all statuses',
    'calendar.events.total': 'Your total future eligible-event count',
    'calendar.events.included': 'Your future eligible events included in AI Insights'
  };
  if (fixed[path]) return fixed[path];
  let match = path.match(/^allTime\.sports\.(\d+)\.(sessions|durationHours|distanceKm|percentSessions|averageSessionDurationHours|averageHoursPerWeek|averageSessionsPerWeek|averageDistanceKmPerActivity)$/);
  if (match) {
    const row = context.allTime && context.allTime.sports && context.allTime.sports[Number(match[1])];
    if (!row || !row.sport) return null;
    const labels = {
      sessions: 'session count',
      durationHours: 'recorded duration',
      distanceKm: 'recorded distance',
      percentSessions: 'share of sessions',
      averageSessionDurationHours: 'average recorded session duration',
      averageHoursPerWeek: 'average weekly recorded duration',
      averageSessionsPerWeek: 'average weekly session count',
      averageDistanceKmPerActivity: 'average recorded distance per activity'
    };
    return `Your all-time ${row.sport} ${labels[match[2]]}`;
  }
  match = path.match(/^last12Weeks\.daily\.(\d+)\.(sessions|durationHours|distanceKm)$/);
  if (match) {
    const row = context.last12Weeks && context.last12Weeks.daily && context.last12Weeks.daily[Number(match[1])];
    if (!row || !row.date) return null;
    return `Your ${match[2] === 'sessions' ? 'session count' : match[2] === 'durationHours' ? 'recorded duration' : 'recorded distance'} on ${row.date}`;
  }
  match = path.match(/^last12Weeks\.weekly\.(\d+)\.(activityCount|durationHours|distanceKm|points)$/);
  if (match) {
    const row = context.last12Weeks && context.last12Weeks.weekly && context.last12Weeks.weekly[Number(match[1])];
    if (!row || !row.weekStart) return null;
    const label = match[2] === 'activityCount' ? 'activity count' : match[2] === 'durationHours' ? 'recorded duration' : match[2] === 'distanceKm' ? 'recorded distance' : 'points';
    return `Your ${label} in the week starting ${row.weekStart}`;
  }
  match = path.match(/^last12Weeks\.weekly\.(\d+)\.sports\.(\d+)\.(sessions|durationHours|distanceKm)$/);
  if (match) {
    const week = context.last12Weeks && context.last12Weeks.weekly && context.last12Weeks.weekly[Number(match[1])];
    const row = week && week.sports && week.sports[Number(match[2])];
    if (!week || !row || !row.sport) return null;
    const label = match[3] === 'sessions' ? 'session count' : match[3] === 'durationHours' ? 'recorded duration' : 'recorded distance';
    return `Your ${row.sport} ${label} in the week starting ${week.weekStart}`;
  }
  match = path.match(/^last12Weeks\.sports\.(\d+)\.(sessions|durationHours|distanceKm|percentSessions|averageSessionDurationHours|averageHoursPerWeek|averageSessionsPerWeek|averageDistanceKmPerActivity)$/);
  if (match) {
    const row = context.last12Weeks && context.last12Weeks.sports && context.last12Weeks.sports[Number(match[1])];
    if (!row || !row.sport) return null;
    const labels = {
      sessions: 'session count',
      durationHours: 'recorded duration',
      distanceKm: 'recorded distance',
      percentSessions: 'share of sessions',
      averageSessionDurationHours: 'average recorded session duration',
      averageHoursPerWeek: 'average weekly recorded duration',
      averageSessionsPerWeek: 'average weekly session count',
      averageDistanceKmPerActivity: 'average recorded distance per activity'
    };
    return `Your ${row.sport} ${labels[match[2]]} in the last 12 weeks`;
  }
  match = path.match(/^last12Months\.(\d+)\.(sessions|durationHours|distanceKm|activeDays|restDays|observedDays|averageSessionDurationHours|averageHoursPerWeek|averageSessionsPerWeek|averageDistanceKmPerActivity)$/);
  if (match) {
    const row = context.last12Months && context.last12Months[Number(match[1])];
    if (!row || !row.month) return null;
    const monthLabel = new Date(row.month + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const labels = {
      sessions: 'session count',
      durationHours: 'recorded duration',
      distanceKm: 'recorded distance',
      activeDays: 'active-day count',
      restDays: 'rest-day count',
      observedDays: 'observed calendar-day count',
      averageSessionDurationHours: 'average recorded session duration',
      averageHoursPerWeek: 'average weekly recorded duration',
      averageSessionsPerWeek: 'average weekly session count',
      averageDistanceKmPerActivity: 'average recorded distance per activity'
    };
    return `Your ${labels[match[2]]} in ${monthLabel}`;
  }
  match = path.match(/^last12Months\.(\d+)\.sports\.(\d+)\.(sessions|durationHours|distanceKm|percentSessions|averageSessionDurationHours|averageHoursPerWeek|averageSessionsPerWeek|averageDistanceKmPerActivity)$/);
  if (match) {
    const month = context.last12Months && context.last12Months[Number(match[1])];
    const row = month && month.sports && month.sports[Number(match[2])];
    if (!month || !row || !row.sport) return null;
    const monthLabel = new Date(month.month + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const labels = {
      sessions: 'session count',
      durationHours: 'recorded duration',
      distanceKm: 'recorded distance',
      percentSessions: 'share of sessions',
      averageSessionDurationHours: 'average recorded session duration',
      averageHoursPerWeek: 'average weekly recorded duration',
      averageSessionsPerWeek: 'average weekly session count',
      averageDistanceKmPerActivity: 'average recorded distance per activity'
    };
    return `Your ${row.sport} ${labels[match[3]]} in ${monthLabel}`;
  }
  match = path.match(/^calendar\.plannedSessions\.byMonth\.(\d+)\.(plannedCount|totalPlannedMinutes|included)$/);
  if (match) {
    const row = context.calendar && context.calendar.plannedSessions &&
      context.calendar.plannedSessions.byMonth && context.calendar.plannedSessions.byMonth[Number(match[1])];
    if (!row || !row.month) return null;
    const label = humanMonthLabel(row.month);
    const descriptions = {
      plannedCount: 'planned sessions left',
      totalPlannedMinutes: 'total planned duration',
      included: 'planned sessions included in AI Insights'
    };
    return `Your ${descriptions[match[2]]} in ${label}`;
  }
  match = path.match(/^calendar\.events\.byMonth\.(\d+)\.(count|included)$/);
  if (match) {
    const row = context.calendar && context.calendar.events &&
      context.calendar.events.byMonth && context.calendar.events.byMonth[Number(match[1])];
    if (!row || !row.month) return null;
    const description = match[2] === 'count' ? 'eligible-event count' : 'eligible events included in AI Insights';
    return `Your ${description} in ${humanMonthLabel(row.month)}`;
  }
  return null;
}

function evidenceItem(path, value) {
  return { path, value };
}

function validTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return value;
  } catch (err) {
    return 'UTC';
  }
}

function dateKeyForValue(value, timeZone) {
  const raw = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: validTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function humanMonthLabel(month) {
  return new Date(month + '-01T12:00:00Z').toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

function humanCalendarWhen(value, context, includeTime) {
  const timeZone = validTimeZone(context && context.timezone);
  const dateKey = dateKeyForValue(value, timeZone);
  if (!dateKey) return String(value || '');
  const asOfDate = /^\d{4}-\d{2}-\d{2}$/.test(context && context.asOfDate)
    ? context.asOfDate : dateKeyForValue(new Date(), timeZone);
  const epochDay = (key) => Math.floor(Date.parse(key + 'T12:00:00Z') / 86400000);
  const difference = epochDay(dateKey) - epochDay(asOfDate);
  let label;
  if (difference === 0) label = 'today';
  else if (difference === 1) label = 'tomorrow';
  else if (difference >= 2 && difference <= 6) {
    label = 'on ' + new Date(dateKey + 'T12:00:00Z').toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: 'UTC'
    });
  } else {
    const includeYear = dateKey.slice(0, 4) !== asOfDate.slice(0, 4);
    label = 'on ' + new Date(dateKey + 'T12:00:00Z').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(includeYear ? { year: 'numeric' } : {}),
      timeZone: 'UTC'
    });
  }
  const raw = String(value || '');
  if (includeTime && raw.includes('T')) {
    const date = new Date(raw);
    if (Number.isFinite(date.getTime())) {
      label += ' at ' + date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone
      });
    }
  }
  return label;
}

function durationMinutes(value) {
  if (!value) return null;
  const text = String(value).trim().toLowerCase();
  let hours = 0;
  if (text.includes(':')) {
    const [first, second] = text.split(':').map((part) => parseFloat(part) || 0);
    hours = first > 12 ? first / 60 + second / 3600 : first + second / 60;
  } else {
    const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*h/);
    const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*m/);
    if (hourMatch || minuteMatch) {
      hours = (parseFloat(hourMatch && hourMatch[1]) || 0) +
        (parseFloat(minuteMatch && minuteMatch[1]) || 0) / 60;
    } else {
      const number = parseFloat(text.replace(/[^0-9.]/g, ''));
      if (!Number.isFinite(number)) return null;
      hours = number > 12 ? number / 60 : number;
    }
  }
  const minutes = Math.round(hours * 60);
  return minutes > 0 ? minutes : null;
}

function humanDuration(value) {
  const minutes = durationMinutes(value);
  if (!minutes) return null;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const parts = [];
  if (hours) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (remainder) parts.push(`${remainder} ${remainder === 1 ? 'minute' : 'minutes'}`);
  return parts.join(' ');
}

function renderPlanItem(item, context, compact = false) {
  const name = item.title || item.sport || 'Session';
  const when = humanCalendarWhen(item.date, context, false);
  const duration = humanDuration(item.plannedDuration);
  if (compact) {
    return `${name} ${when}${duration ? ` for ${duration}` : ''}${item.status && item.status !== 'planned' ? ` (${item.status})` : ''}`;
  }
  return `Your planned session is ${name} ${when}${duration ? ` for ${duration}` : ''}${item.status && item.status !== 'planned' ? ` and is marked ${item.status}` : ''}.`;
}

function renderEventItem(item, context, compact = false) {
  const name = item.title || item.type || 'Event';
  const when = humanCalendarWhen(item.date, context, true);
  if (compact) {
    return `${name} ${when}${item.clubName ? ` with ${item.clubName}` : ''}${item.ownRsvp ? ` (RSVP: ${item.ownRsvp})` : ''}`;
  }
  return `${name} is ${when}${item.clubName ? ` with ${item.clubName}` : ''}${item.ownRsvp ? `; your RSVP is ${item.ownRsvp}` : ''}.`;
}

function renderCalendarList(finding, context) {
  const isPlan = finding.type === 'calendar_plan_list';
  const expectedPath = isPlan ? 'calendar.plannedSessions.items' : 'calendar.events.items';
  const path = normalizePath(finding.path);
  const filterPresent = Object.prototype.hasOwnProperty.call(finding, 'filter');
  const filterShapeValid = !!(
    finding.filter &&
    typeof finding.filter === 'object' &&
    !Array.isArray(finding.filter) &&
    JSON.stringify(Object.keys(finding.filter)) === JSON.stringify(['month']) &&
    typeof finding.filter.month === 'string' &&
    /^\d{4}-\d{2}$/.test(finding.filter.month)
  );
  const parentPath = isPlan ? 'calendar.plannedSessions' : 'calendar.events';
  const parentForFilter = valueAtPath(context, parentPath);
  const filterValid = !!(
    filterShapeValid &&
    parentForFilter.found &&
    Array.isArray(parentForFilter.value.byMonth) &&
    parentForFilter.value.byMonth.some((row) => row && row.month === finding.filter.month)
  );
  const findingKeys = Object.keys(finding).sort();
  const canonicalKeys = ['filter', 'path', 'type'];
  const capturedProviderKeys = ['filter', 'path', 'type', 'value'];
  if (JSON.stringify(findingKeys) !== JSON.stringify(canonicalKeys) &&
      JSON.stringify(findingKeys) !== JSON.stringify(capturedProviderKeys)) {
    return { error: 'invalid_finding', offendingPath: path, filterPresent, filterValid };
  }
  if (path !== expectedPath) {
    return { error: 'unsupported_path', offendingPath: path, filterPresent, filterValid };
  }
  if (!filterShapeValid) {
    return { error: 'invalid_filter', offendingPath: path, filterPresent, filterValid: false };
  }
  const collection = valueAtPath(context, path);
  const parent = valueAtPath(context, parentPath);
  if (!collection.found || !Array.isArray(collection.value) || !parent.found ||
      !Array.isArray(parent.value.byMonth)) {
    return { error: 'missing_path', offendingPath: path, filterPresent, filterValid: false };
  }
  const monthIndex = parent.value.byMonth.findIndex((row) => row && row.month === finding.filter.month);
  if (monthIndex < 0) {
    return { error: 'missing_path', offendingPath: path, filterPresent, filterValid: false };
  }
  const summary = parent.value.byMonth[monthIndex];
  const indexed = collection.value.map((item, index) => ({ item, index })).filter(({ item }) => {
    const itemDate = dateKeyForValue(item.date, context.timezone);
    const sameMonth = itemDate && itemDate.slice(0, 7) === finding.filter.month;
    return sameMonth && (!isPlan || item.status === 'planned');
  });
  if (Object.prototype.hasOwnProperty.call(finding, 'value') &&
      !equalEvidenceValue(indexed.map(({ item }) => item), finding.value)) {
    return { error: 'mismatched_value', offendingPath: path, filterPresent, filterValid: true };
  }
  const shown = indexed.slice(0, MAX_CALENDAR_LIST_ITEMS);
  const total = isPlan ? summary.plannedCount : summary.count;
  const noun = isPlan ? 'planned session' : 'event';
  const monthLabel = humanMonthLabel(finding.filter.month);
  let text;
  if (!total) {
    text = `You have no ${isPlan ? 'planned sessions left' : 'events'} in ${monthLabel}.`;
  } else {
    const lead = total === shown.length
      ? `You have ${total} ${noun}${total === 1 ? '' : 's'}${isPlan ? ' left' : ''} in ${monthLabel}:`
      : `You have ${total} ${noun}${total === 1 ? '' : 's'}${isPlan ? ' left' : ''} in ${monthLabel}; here are the first ${shown.length}:`;
    const renderedItems = shown.map(({ item }) => isPlan
      ? renderPlanItem(item, context, true)
      : renderEventItem(item, context, true));
    text = `${lead} ${renderedItems.join('; ')}.`;
  }
  const summaryPath = `${isPlan ? 'calendar.plannedSessions' : 'calendar.events'}.byMonth.${monthIndex}`;
  return {
    text,
    requiresCalendarTruncationDisclosure: summary.truncated === true,
    evidence: [
      evidenceItem(summaryPath, summary),
      ...shown.map(({ item, index }) => evidenceItem(`${path}.${index}`, item))
    ]
  };
}

function renderTypedFinding(finding, context) {
  if (!finding || typeof finding !== 'object' || typeof finding.type !== 'string') {
    return { error: 'invalid_finding' };
  }
  if (finding.type === 'metric') {
    const path = normalizePath(finding.path);
    if (JSON.stringify(Object.keys(finding).sort()) !== JSON.stringify(['path', 'type', 'value'])) return { error: 'invalid_finding', offendingPath: path };
    const actual = valueAtPath(context, path);
    const description = metricDescription(context, path);
    if (!actual.found) return { error: 'missing_path', offendingPath: path };
    if (!description || !['number', 'string'].includes(typeof actual.value)) return { error: 'unsupported_path', offendingPath: path };
    if (!equalEvidenceValue(actual.value, finding.value)) return {
      error: 'mismatched_value',
      offendingPath: path,
      mismatchDetails: safeMismatchDetails(actual.value, finding.value)
    };
    return {
      text: `${description} was ${formatMetricValue(path, actual.value)}.`,
      evidence: [evidenceItem(path, actual.value)]
    };
  }
  if (finding.type === 'comparison') {
    const expectedKeys = ['leftPath', 'leftValue', 'rightPath', 'rightValue', 'type'];
    const leftPath = normalizePath(finding.leftPath);
    const rightPath = normalizePath(finding.rightPath);
    if (JSON.stringify(Object.keys(finding).sort()) !== JSON.stringify(expectedKeys)) return { error: 'invalid_finding', offendingPath: leftPath || rightPath };
    if (!(context.dataQuality && context.dataQuality.trendEligible)) return { error: 'unsupported_trend' };
    const left = valueAtPath(context, leftPath);
    const right = valueAtPath(context, rightPath);
    const leftLabel = metricDescription(context, leftPath);
    const rightLabel = metricDescription(context, rightPath);
    if (!left.found || !right.found) return { error: 'missing_path', offendingPath: !left.found ? leftPath : rightPath };
    if (!leftLabel || !rightLabel || typeof left.value !== 'number' || typeof right.value !== 'number') return { error: 'unsupported_path', offendingPath: !leftLabel ? leftPath : rightPath };
    if (leftPath.split('.').at(-1) !== rightPath.split('.').at(-1)) return { error: 'incomparable_paths' };
    const leftMatches = equalEvidenceValue(left.value, finding.leftValue);
    const rightMatches = equalEvidenceValue(right.value, finding.rightValue);
    if (!leftMatches || !rightMatches) {
      const expected = leftMatches ? right.value : left.value;
      const received = leftMatches ? finding.rightValue : finding.leftValue;
      return {
        error: 'mismatched_value',
        offendingPath: leftMatches ? rightPath : leftPath,
        mismatchDetails: safeMismatchDetails(expected, received)
      };
    }
    const difference = Math.round((left.value - right.value) * 10) / 10;
    return {
      text: `${leftLabel} was ${formatMetricValue(leftPath, left.value)}; ${rightLabel.toLowerCase()} was ${formatMetricValue(rightPath, right.value)}. The recorded difference was ${formatMetricValue(leftPath, Math.abs(difference))} ${difference === 0 ? '(no difference)' : difference > 0 ? 'higher' : 'lower'}.`,
      evidence: [evidenceItem(leftPath, left.value), evidenceItem(rightPath, right.value)]
    };
  }
  if (finding.type === 'standing') {
    if (JSON.stringify(Object.keys(finding).sort()) !== JSON.stringify(['path', 'type', 'value'])) return { error: 'invalid_finding' };
    const path = normalizePath(finding.path);
    if (!/^standings\.(?:platform\.month|clubs\.\d+\.month)$/.test(path)) return { error: 'unsupported_path' };
    const actual = valueAtPath(context, path);
    if (!actual.found || !actual.value || typeof actual.value !== 'object') return { error: 'missing_path' };
    if (!equalEvidenceValue(actual.value, finding.value)) return { error: 'mismatched_value' };
    const clubMatch = path.match(/^standings\.clubs\.(\d+)\.month$/);
    const scope = clubMatch ? (context.standings.clubs[Number(clubMatch[1])].clubName + ' club') : 'platform';
    return {
      text: `Your ${scope} rank this month was ${actual.value.rank} of ${actual.value.totalRanked}, with ${actual.value.points} points from ${actual.value.activityCount} activities.`,
      evidence: [evidenceItem(path, actual.value)]
    };
  }
  if (finding.type === 'personal_record') {
    if (JSON.stringify(Object.keys(finding).sort()) !== JSON.stringify(['path', 'type', 'value'])) return { error: 'invalid_finding' };
    const path = normalizePath(finding.path);
    if (!/^allTime\.personalRecords\.\d+$/.test(path)) return { error: 'unsupported_path' };
    const actual = valueAtPath(context, path);
    if (!actual.found || !actual.value || typeof actual.value !== 'object') return { error: 'missing_path' };
    if (!equalEvidenceValue(actual.value, finding.value)) return { error: 'mismatched_value' };
    const label = String(actual.value.type || 'personal record').replace(/_/g, ' ');
    return {
      text: `Your ${label} was ${actual.value.value} ${actual.value.unit} in ${actual.value.sport} on ${actual.value.date}.`,
      evidence: [evidenceItem(path, actual.value)]
    };
  }
  if (finding.type === 'calendar_plan' || finding.type === 'calendar_event' ||
      finding.type === 'plan_adherence' || finding.type === 'goal_projection') {
    if (JSON.stringify(Object.keys(finding).sort()) !== JSON.stringify(['path', 'type', 'value'])) return { error: 'invalid_finding' };
    const path = normalizePath(finding.path);
    const patterns = {
      calendar_plan: /^calendar\.plannedSessions\.items\.\d+$/,
      calendar_event: /^calendar\.events\.items\.\d+$/,
      plan_adherence: /^calendar\.pastPlanAdherence\.\d+$/,
      goal_projection: /^goals\.active\.items\.\d+$/
    };
    if (!patterns[finding.type].test(path)) return { error: 'unsupported_path', offendingPath: path };
    const actual = valueAtPath(context, path);
    if (!actual.found || !actual.value || typeof actual.value !== 'object') return { error: 'missing_path', offendingPath: path };
    if (!equalEvidenceValue(actual.value, finding.value)) return { error: 'mismatched_value', offendingPath: path };
    let text;
    if (finding.type === 'calendar_plan') {
      text = renderPlanItem(actual.value, context);
    } else if (finding.type === 'calendar_event') {
      text = renderEventItem(actual.value, context);
    } else if (finding.type === 'plan_adherence') {
      text = `In ${actual.value.month}, your plans were ${actual.value.done} done, ${actual.value.skipped} skipped, and ${actual.value.stillPlanned} still planned.`;
    } else {
      const goal = actual.value;
      text = `Your active ${goal.sport || 'all-sport'} ${goal.type} goal is ${goal.progress.value} of ${goal.target.value}${goal.target.unit ? ` ${goal.target.unit}` : ''} for the ${goal.period} period, and is ${goal.isComplete ? 'complete' : goal.onTrack ? 'on track' : 'not on track'}.`;
    }
    const parent = finding.type === 'calendar_plan'
      ? context.calendar && context.calendar.plannedSessions
      : finding.type === 'calendar_event'
        ? context.calendar && context.calendar.events
        : null;
    return {
      text,
      requiresCalendarTruncationDisclosure: !!(parent && parent.truncated),
      evidence: [evidenceItem(path, actual.value)]
    };
  }
  if (finding.type === 'calendar_plan_list' || finding.type === 'calendar_event_list') {
    return renderCalendarList(finding, context);
  }
  if (finding.type === 'insufficient_trend_data') {
    if (Object.keys(finding).length !== 1) return { error: 'invalid_finding' };
    if (context.dataQuality && context.dataQuality.trendEligible) return { error: 'invalid_limitation' };
    return {
      text: `You have ${context.dataQuality.activityCount} logged activities across ${context.dataQuality.activeWeeksInDetailedWindow} active weeks. There is not enough history to establish a reliable trend or usual training pattern yet.`,
      evidence: [
        evidenceItem('dataQuality.activityCount', context.dataQuality.activityCount),
        evidenceItem('dataQuality.activeWeeksInDetailedWindow', context.dataQuality.activeWeeksInDetailedWindow)
      ]
    };
  }
  return { error: 'unsupported_finding_type' };
}

const DIAGNOSTIC_FINDING_TYPES = new Set([
  'metric', 'comparison', 'standing', 'personal_record', 'calendar_plan',
  'calendar_event', 'calendar_plan_list', 'calendar_event_list', 'plan_adherence',
  'goal_projection', 'insufficient_trend_data', 'not_answerable', 'policy_refusal'
]);

function safeFindingDiagnostics(raw) {
  const parsed = parseModelJson(raw);
  const findings = parsed && Array.isArray(parsed.findings) ? parsed.findings : [];
  return {
    findingCount: findings.length,
    findings: findings.slice(0, 8).map((finding) => {
      const safeType = finding && DIAGNOSTIC_FINDING_TYPES.has(finding.type) ? finding.type : 'unknown';
      const candidates = safeType === 'comparison'
        ? [finding.leftPath, finding.rightPath]
        : [finding && finding.path];
      return {
        type: safeType,
        paths: candidates.map(safeDiagnosticPath).filter(Boolean)
      };
    })
  };
}

function validateInsightResponse(raw, context) {
  const parsed = parseModelJson(raw);
  if (!parsed || JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(['findings', 'limitations']) ||
      !Array.isArray(parsed.findings) || !Array.isArray(parsed.limitations)) {
    return { ok: false, answer: FALLBACK_COPY, reason: 'invalid_shape' };
  }
  if (!parsed.findings.length || parsed.findings.length > 8 || parsed.limitations.length > 8) {
    return { ok: false, answer: FALLBACK_COPY, reason: 'bounds' };
  }
  const policyFindings = parsed.findings.filter((finding) => finding && finding.type === 'policy_refusal');
  if (policyFindings.length) {
    const finding = policyFindings[0];
    if (parsed.findings.length !== 1 || parsed.limitations.length !== 0 ||
        JSON.stringify(Object.keys(finding).sort()) !== JSON.stringify(['reason', 'type']) ||
        !POLICY_REFUSAL_REASONS.has(finding.reason)) {
      return { ok: false, answer: FALLBACK_COPY, reason: 'invalid_policy_refusal' };
    }
    return {
      ok: true,
      policyRefusal: true,
      policyReason: finding.reason,
      answer: REFUSAL_COPY,
      evidence: [],
      limitations: []
    };
  }
  const notAnswerableFindings = parsed.findings.filter((finding) => finding && finding.type === 'not_answerable');
  if (notAnswerableFindings.length) {
    const finding = notAnswerableFindings[0];
    if (parsed.findings.length !== 1 || parsed.limitations.length !== 0 ||
        JSON.stringify(Object.keys(finding).sort()) !== JSON.stringify(['reason', 'type']) ||
        !Object.prototype.hasOwnProperty.call(NOT_ANSWERABLE_COPY, finding.reason)) {
      return { ok: false, answer: FALLBACK_COPY, reason: 'invalid_not_answerable' };
    }
    return {
      ok: true,
      notAnswerable: true,
      notAnswerableReason: finding.reason,
      answer: NOT_ANSWERABLE_COPY[finding.reason],
      evidence: [],
      limitations: []
    };
  }
  const allEvidence = [];
  const rendered = [];
  let requiresCalendarTruncationDisclosure = false;
  for (const finding of parsed.findings) {
    const result = renderTypedFinding(finding, context);
    if (result.error) {
      const offendingPath = safeDiagnosticPath(result.offendingPath);
      return {
        ok: false,
        answer: FALLBACK_COPY,
        reason: result.error,
        offendingPath,
        filterPresent: result.filterPresent === true,
        filterValid: result.filterValid === true,
        mismatchDetails: offendingPath ? result.mismatchDetails || null : null
      };
    }
    rendered.push(result.text);
    if (result.requiresCalendarTruncationDisclosure) requiresCalendarTruncationDisclosure = true;
    allEvidence.push(...result.evidence);
  }
  const allowedLimitations = {
    INSUFFICIENT_TREND_DATA: 'There is not enough logged history to establish a reliable trend or usual training pattern.',
    DETAILED_WINDOW_12_WEEKS: 'Day-by-day and week-by-week detail is limited to the last 12 weeks.',
    STANDINGS_UNAVAILABLE: 'Standings are unavailable because leaderboard visibility is off or no eligible rank exists.',
    CAUSE_NOT_AVAILABLE: 'The logged data can describe what changed, but it cannot establish why it changed.',
    CALENDAR_RESULTS_TRUNCATED: 'Calendar results were capped, so additional matching plans or events are not included.',
  };
  const limitations = [];
  for (const code of parsed.limitations) {
    if (typeof code !== 'string' || !Object.prototype.hasOwnProperty.call(allowedLimitations, code)) {
      return { ok: false, answer: FALLBACK_COPY, reason: 'invalid_limitation' };
    }
    if (code !== 'CALENDAR_RESULTS_TRUNCATED' &&
        !limitations.includes(allowedLimitations[code])) {
      limitations.push(allowedLimitations[code]);
    }
  }
  if (requiresCalendarTruncationDisclosure &&
      !limitations.includes(allowedLimitations.CALENDAR_RESULTS_TRUNCATED)) {
    limitations.push(allowedLimitations.CALENDAR_RESULTS_TRUNCATED);
  }
  return {
    ok: true,
    answer: rendered.join(' '),
    evidence: allEvidence,
    limitations
  };
}

function buildSystemPrompt() {
  return [
    'You are Arenas AI Insights, a descriptive training-data analyst.',
    'DATA_JSON is the sole factual authority. HISTORY_JSON is conversational context only and is never evidence.',
    'Never write answer prose. Select only typed findings whose referenced paths and copied values exist exactly in DATA_JSON.',
    'Allowed finding forms:',
    '{"type":"metric","path":"last12Months.10.durationHours","value":16.4}',
    '{"type":"comparison","leftPath":"numeric-leaf","leftValue":0,"rightPath":"same-metric numeric-leaf","rightValue":0}',
    '{"type":"standing","path":"standings.platform.month or standings.clubs.N.month","value":"exact copied object"}',
    '{"type":"personal_record","path":"allTime.personalRecords.N","value":"exact copied object"}',
    '{"type":"calendar_plan","path":"calendar.plannedSessions.items.N","value":"exact copied object"}',
    '{"type":"calendar_event","path":"calendar.events.items.N","value":"exact copied object"}',
    '{"type":"calendar_plan_list","path":"calendar.plannedSessions.items","filter":{"month":"2026-09"}} is the literal list-finding format for planned-status sessions in September 2026. Replace only the month with an exact month present in plannedSessions.byMonth.',
    '{"type":"calendar_event_list","path":"calendar.events.items","filter":{"month":"2026-09"}} is the literal list-finding format for eligible events in September 2026. Replace only the month with an exact month present in events.byMonth.',
    '{"type":"plan_adherence","path":"calendar.pastPlanAdherence.N","value":"exact copied object"}',
    '{"type":"goal_projection","path":"goals.active.items.N","value":"exact copied object"}',
    '{"type":"insufficient_trend_data"} only when DATA_JSON.dataQuality.trendEligible is false.',
    '{"type":"not_answerable","reason":"missing_injury_date|missing_medical_leave_dates|missing_event_date|period_outside_coverage|unsupported_metric|goal_history_unavailable|goal_comparison_unsupported|goal_projection_unsupported|calendar_results_truncated"} must be the only finding, with no limitations, when DATA_JSON lacks the information needed to answer honestly.',
    'Use missing_injury_date for before/after injury questions without an injury date; missing_medical_leave_dates for medical-leave-window questions without its dates; missing_event_date for another absent event boundary; period_outside_coverage for calendar detail older than last12Months; unsupported_metric when the requested measurement is not present.',
    'last12Months contains 12 athlete-timezone calendar buckets, oldest first, including zero months. Each month has totals, activeDays, restDays, observedDays, common averages, and active-sport summaries.',
    'last12Weeks.sports contains aggregate sport summaries for the detailed 12-week window. Use these direct paths instead of calculating from weekly or daily rows.',
    'calendar contains only the athlete’s own future plans, visible eligible future events, and 12 monthly plan-status counts. plannedSessions.total/included cover all future plan records across planned, done, and skipped statuses. plannedSessions.byMonth and events.byMonth contain exact athlete-timezone future month totals computed before the item caps. Use byMonth.plannedCount for sessions left, and use direct byMonth paths for month counts and planned minutes; never derive a month count from items or use the all-future total for one month.',
    'Use calendar_plan_list or calendar_event_list when the user asks what the month’s matching items are. Canonical list findings contain exactly type, path, and filter; omit value and every other key. The server applies the month filter and renders at most 10 items. If the relevant month bucket is truncated, include CALENDAR_RESULTS_TRUNCATED.',
    'goals contains at most five active goals with server-computed progress and on-track status. Goal history, cross-goal comparison, and catch-up projections are unsupported; use their specific not_answerable reasons.',
    '{"type":"policy_refusal","reason":"prescriptive|diet_weight_body|medical|athlete_characterization"} must be the only finding, with no limitations, when the user asks for advice or prescriptions; asks what they should do, eat, increase, decrease, or change; asks for diet, weight, body composition, or medical commentary; or asks you to characterize them as under-training, over-training, lazy, fit, healthy, or similar.',
    'Do not policy-refuse a descriptive question merely because it mentions workouts, training, rest days, routines, weight training, rides, injuries, medical leave, diet, nutrition, calories, or weight in a historical or recorded-data context.',
    'For policy refusals, return only the typed policy_refusal finding. Never write refusal or advice prose.',
    'For not-answerable results, return only the typed not_answerable finding. Never substitute an unrelated metric.',
    'Do not use comparison when dataQuality.trendEligible is false.',
    'Limitations may contain only: INSUFFICIENT_TREND_DATA, DETAILED_WINDOW_12_WEEKS, STANDINGS_UNAVAILABLE, CAUSE_NOT_AVAILABLE, CALENDAR_RESULTS_TRUNCATED.',
    'Return JSON only: {"findings":[...],"limitations":["CODE"]}.'
  ].join('\n');
}

module.exports = {
  FALLBACK_COPY,
  REFUSAL_COPY,
  NOT_ANSWERABLE_COPY,
  MODEL,
  MAX_HISTORY_TURNS,
  MAX_CALENDAR_LIST_ITEMS,
  AiProviderConfigurationError,
  resolveAnthropicProvider,
  makeSignedHistoryTurn,
  verifyHistoryTurns,
  validateInsightResponse,
  safeFindingDiagnostics,
  buildSystemPrompt,
  valueAtPath
};