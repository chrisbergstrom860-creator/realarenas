const crypto = require('crypto');

const FALLBACK_COPY = "I couldn’t produce an answer supported by your recorded data. Try asking about your activity count, volume, sports, streaks, personal records, or standings.";
const REFUSAL_COPY = "I can describe your recorded training, but I can’t prescribe workouts or comment on diet, weight, body composition, or whether you are under-training. Try asking what changed in your volume, consistency, sports, personal records, or standings.";
const MODEL = 'claude-haiku-4-5';
const MAX_HISTORY_TURNS = 3;
const HISTORY_TTL_MS = 12 * 60 * 60 * 1000;
const POLICY_REFUSAL_REASONS = new Set([
  'prescriptive',
  'diet_weight_body',
  'medical',
  'athlete_characterization'
]);

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

function equalEvidenceValue(actual, claimed) {
  if (typeof actual === 'number' && typeof claimed === 'number') {
    return Number.isFinite(actual) && Number.isFinite(claimed) && Math.abs(actual - claimed) < 1e-9;
  }
  return JSON.stringify(actual) === JSON.stringify(claimed);
}

function parseModelJson(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch (err) { return null; }
}

function formatMetricValue(path, value) {
  if (/durationHours$/.test(path)) return value + ' hours';
  if (/distanceKm$/.test(path)) return value + ' km';
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
    'coverage.firstActivityDate': 'Your first logged activity date',
    'coverage.lastActivityDate': 'Your latest logged activity date'
  };
  if (fixed[path]) return fixed[path];
  let match = path.match(/^allTime\.sports\.(\d+)\.(sessions|durationHours|distanceKm|percentSessions)$/);
  if (match) {
    const row = context.allTime && context.allTime.sports && context.allTime.sports[Number(match[1])];
    if (!row || !row.sport) return null;
    return `Your all-time ${row.sport} ${match[2] === 'sessions' ? 'session count' : match[2] === 'durationHours' ? 'recorded duration' : match[2] === 'distanceKm' ? 'recorded distance' : 'share of sessions'}`;
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
  return null;
}

function evidenceItem(path, value) {
  return { path, value };
}

function renderTypedFinding(finding, context) {
  if (!finding || typeof finding !== 'object' || typeof finding.type !== 'string') {
    return { error: 'invalid_finding' };
  }
  if (finding.type === 'metric') {
    if (JSON.stringify(Object.keys(finding).sort()) !== JSON.stringify(['path', 'type', 'value'])) return { error: 'invalid_finding' };
    const actual = valueAtPath(context, finding.path);
    const description = metricDescription(context, finding.path);
    if (!actual.found) return { error: 'missing_path' };
    if (!description || !['number', 'string'].includes(typeof actual.value)) return { error: 'unsupported_path' };
    if (!equalEvidenceValue(actual.value, finding.value)) return { error: 'mismatched_value' };
    return {
      text: `${description} was ${formatMetricValue(finding.path, actual.value)}.`,
      evidence: [evidenceItem(finding.path, actual.value)]
    };
  }
  if (finding.type === 'comparison') {
    const expectedKeys = ['leftPath', 'leftValue', 'rightPath', 'rightValue', 'type'];
    if (JSON.stringify(Object.keys(finding).sort()) !== JSON.stringify(expectedKeys)) return { error: 'invalid_finding' };
    if (!(context.dataQuality && context.dataQuality.trendEligible)) return { error: 'unsupported_trend' };
    const left = valueAtPath(context, finding.leftPath);
    const right = valueAtPath(context, finding.rightPath);
    const leftLabel = metricDescription(context, finding.leftPath);
    const rightLabel = metricDescription(context, finding.rightPath);
    if (!left.found || !right.found) return { error: 'missing_path' };
    if (!leftLabel || !rightLabel || typeof left.value !== 'number' || typeof right.value !== 'number') return { error: 'unsupported_path' };
    if (finding.leftPath.split('.').at(-1) !== finding.rightPath.split('.').at(-1)) return { error: 'incomparable_paths' };
    if (!equalEvidenceValue(left.value, finding.leftValue) || !equalEvidenceValue(right.value, finding.rightValue)) return { error: 'mismatched_value' };
    const difference = Math.round((left.value - right.value) * 10) / 10;
    return {
      text: `${leftLabel} was ${formatMetricValue(finding.leftPath, left.value)}; ${rightLabel.toLowerCase()} was ${formatMetricValue(finding.rightPath, right.value)}. The recorded difference was ${formatMetricValue(finding.leftPath, Math.abs(difference))} ${difference === 0 ? '(no difference)' : difference > 0 ? 'higher' : 'lower'}.`,
      evidence: [evidenceItem(finding.leftPath, left.value), evidenceItem(finding.rightPath, right.value)]
    };
  }
  if (finding.type === 'standing') {
    if (JSON.stringify(Object.keys(finding).sort()) !== JSON.stringify(['path', 'type', 'value'])) return { error: 'invalid_finding' };
    if (!/^standings\.(?:platform\.month|clubs\.\d+\.month)$/.test(finding.path)) return { error: 'unsupported_path' };
    const actual = valueAtPath(context, finding.path);
    if (!actual.found || !actual.value || typeof actual.value !== 'object') return { error: 'missing_path' };
    if (!equalEvidenceValue(actual.value, finding.value)) return { error: 'mismatched_value' };
    const clubMatch = finding.path.match(/^standings\.clubs\.(\d+)\.month$/);
    const scope = clubMatch ? (context.standings.clubs[Number(clubMatch[1])].clubName + ' club') : 'platform';
    return {
      text: `Your ${scope} rank this month was ${actual.value.rank} of ${actual.value.totalRanked}, with ${actual.value.points} points from ${actual.value.activityCount} activities.`,
      evidence: [evidenceItem(finding.path, actual.value)]
    };
  }
  if (finding.type === 'personal_record') {
    if (JSON.stringify(Object.keys(finding).sort()) !== JSON.stringify(['path', 'type', 'value'])) return { error: 'invalid_finding' };
    if (!/^allTime\.personalRecords\.\d+$/.test(finding.path)) return { error: 'unsupported_path' };
    const actual = valueAtPath(context, finding.path);
    if (!actual.found || !actual.value || typeof actual.value !== 'object') return { error: 'missing_path' };
    if (!equalEvidenceValue(actual.value, finding.value)) return { error: 'mismatched_value' };
    const label = String(actual.value.type || 'personal record').replace(/_/g, ' ');
    return {
      text: `Your ${label} was ${actual.value.value} ${actual.value.unit} in ${actual.value.sport} on ${actual.value.date}.`,
      evidence: [evidenceItem(finding.path, actual.value)]
    };
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
  const allEvidence = [];
  const rendered = [];
  for (const finding of parsed.findings) {
    const result = renderTypedFinding(finding, context);
    if (result.error) return { ok: false, answer: FALLBACK_COPY, reason: result.error };
    rendered.push(result.text);
    allEvidence.push(...result.evidence);
  }
  const allowedLimitations = {
    INSUFFICIENT_TREND_DATA: 'There is not enough logged history to establish a reliable trend or usual training pattern.',
    DETAILED_WINDOW_12_WEEKS: 'Day-by-day and week-by-week detail is limited to the last 12 weeks.',
    STANDINGS_UNAVAILABLE: 'Standings are unavailable because leaderboard visibility is off or no eligible rank exists.',
    CAUSE_NOT_AVAILABLE: 'The logged data can describe what changed, but it cannot establish why it changed.',
    QUESTION_NOT_ANSWERABLE: 'The available logged data does not answer the question.'
  };
  const limitations = [];
  for (const code of parsed.limitations) {
    if (typeof code !== 'string' || !Object.prototype.hasOwnProperty.call(allowedLimitations, code)) {
      return { ok: false, answer: FALLBACK_COPY, reason: 'invalid_limitation' };
    }
    if (!limitations.includes(allowedLimitations[code])) limitations.push(allowedLimitations[code]);
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
    '{"type":"metric","path":"numeric-or-date-leaf","value":"exact copied value"}',
    '{"type":"comparison","leftPath":"numeric-leaf","leftValue":0,"rightPath":"same-metric numeric-leaf","rightValue":0}',
    '{"type":"standing","path":"standings.platform.month or standings.clubs.N.month","value":"exact copied object"}',
    '{"type":"personal_record","path":"allTime.personalRecords.N","value":"exact copied object"}',
    '{"type":"insufficient_trend_data"} only when DATA_JSON.dataQuality.trendEligible is false.',
    '{"type":"policy_refusal","reason":"prescriptive|diet_weight_body|medical|athlete_characterization"} must be the only finding, with no limitations, when the user asks for advice or prescriptions; asks what they should do, eat, increase, decrease, or change; asks for diet, weight, body composition, or medical commentary; or asks you to characterize them as under-training, over-training, lazy, fit, healthy, or similar.',
    'Do not policy-refuse a descriptive question merely because it mentions workouts, training, rest days, routines, weight training, rides, injuries, medical leave, diet, nutrition, calories, or weight in a historical or recorded-data context.',
    'For policy refusals, return only the typed policy_refusal finding. Never write refusal or advice prose.',
    'Do not use comparison when dataQuality.trendEligible is false.',
    'Limitations may contain only: INSUFFICIENT_TREND_DATA, DETAILED_WINDOW_12_WEEKS, STANDINGS_UNAVAILABLE, CAUSE_NOT_AVAILABLE, QUESTION_NOT_ANSWERABLE.',
    'Return JSON only: {"findings":[...],"limitations":["CODE"]}.'
  ].join('\n');
}

module.exports = {
  FALLBACK_COPY,
  REFUSAL_COPY,
  MODEL,
  MAX_HISTORY_TURNS,
  AiProviderConfigurationError,
  resolveAnthropicProvider,
  makeSignedHistoryTurn,
  verifyHistoryTurns,
  validateInsightResponse,
  buildSystemPrompt,
  valueAtPath
};