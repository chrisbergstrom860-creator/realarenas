const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FALLBACK_COPY,
  REFUSAL_COPY,
  NOT_ANSWERABLE_COPY,
  NOT_ANSWERABLE_REASONS_BY_DOMAIN,
  makeSignedHistoryTurn,
  verifyHistoryTurns,
  validateInsightResponse,
  safeFindingDiagnostics,
  resolveAnthropicProvider,
  buildSystemPrompt,
  buildAiInsightsRequest,
  buildAiInsightsUsageLog,
  resolveChartSeries,
  INSIGHTS_CHART_BAR_COLOR,
  INSIGHTS_FEELING_SERIES
} = require('./ai-insights');

test('cacheable request preserves data bytes and separates changing question/history', () => {
  const data = { schemaVersion: 8, z: [{ sport: 'running', sessions: 3 }], a: 1 };
  const history = [{ question: 'Earlier?', answer: 'Earlier answer.', createdAt: '2026-09-10T10:00:00Z' }];
  const request = buildAiInsightsRequest(data, 'How far?', history);
  assert.deepEqual(request.system, [{ type: 'text', text: buildSystemPrompt() }]);
  assert.equal(request.model, 'claude-haiku-4-5');
  assert.equal(request.max_tokens, 1200);
  assert.equal(request.messages.length, 1);
  assert.equal(request.messages[0].role, 'user');
  const [prefix, suffix] = request.messages[0].content;
  assert.equal(request.messages[0].content.length, 2);
  assert.deepEqual(prefix, {
    type: 'text', text: JSON.stringify(data), cache_control: { type: 'ephemeral' }
  });
  assert.deepEqual(suffix, { type: 'text', text: JSON.stringify({ question: 'How far?', history }) });
  assert.equal((JSON.stringify(request).match(/"cache_control":/g) || []).length, 1);
  const changed = buildAiInsightsRequest(data, 'How often?', []);
  assert.deepEqual(changed.system, request.system);
  assert.equal(changed.messages[0].content[0].text, prefix.text);
  assert.notEqual(changed.messages[0].content[1].text, suffix.text);
});

test('SDK 0.123.0 forwards array-form caching through a custom integration base URL', async () => {
  const Anthropic = require('@anthropic-ai/sdk');
  let captured;
  const client = new Anthropic({
    apiKey: 'test-only-key',
    baseURL: 'https://integration.invalid/anthropic',
    maxRetries: 0,
    fetch: async (url, init) => {
      captured = { url: String(url), body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-haiku-4-5',
        content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn',
        stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const request = buildAiInsightsRequest({ schemaVersion: 8 }, 'Question?', []);
  await client.messages.create(request);
  assert.equal(captured.url, 'https://integration.invalid/anthropic/v1/messages');
  assert.deepEqual(captured.body, request);
});

test('usage logging uses separate input/write/read/output prices without content', () => {
  assert.deepEqual(buildAiInsightsUsageLog('user-test', 17, {
    input_tokens: 100, cache_creation_input_tokens: 2000,
    cache_read_input_tokens: 3000, output_tokens: 40,
    question: 'must not be logged', answer: 'must not be logged'
  }), {
    event: 'ai_insights_usage', user_id: 'user-test', question_length: 17,
    input_tokens: 100, cache_creation_input_tokens: 2000,
    cache_read_input_tokens: 3000, output_tokens: 40, estimated_cost_usd: 0.0031
  });
});

test('usage logging defaults missing and invalid provider counters to zero', () => {
  for (const usage of [undefined, null, {}, {
    input_tokens: NaN, cache_creation_input_tokens: -1,
    cache_read_input_tokens: '100', output_tokens: Infinity
  }]) {
    const log = buildAiInsightsUsageLog('user-test', 12, usage);
    assert.equal(log.input_tokens, 0);
    assert.equal(log.cache_creation_input_tokens, 0);
    assert.equal(log.cache_read_input_tokens, 0);
    assert.equal(log.output_tokens, 0);
    assert.equal(log.estimated_cost_usd, 0);
  }
});

const context = {
  schemaVersion: 8,
  asOfDate: '2026-09-10',
  timezone: 'America/Los_Angeles',
  allTime: {
    activityCount: 8,
    distanceKm: 42.5,
    averageSessionDurationHours: 1.2,
    sports: [{ sport: 'running', sessions: 6, averageDistanceKmPerActivity: 7.1 }]
  },
  last12Weeks: {
    distanceKm: 42.5,
    weekly: [
      { weekStart: '2026-08-31', relative: 'last_week', activityCount: 4, durationHours: 3.5, distanceKm: 20, points: 40, sports: [] },
      { weekStart: '2026-09-07', relative: 'this_week', activityCount: 2, durationHours: 1.5, distanceKm: 10, points: 20, sports: [] }
    ],
    feelings: [
      { weekStart: '2026-08-31', relative: 'last_week', strong: 1, tired: 2, motivated: 0, struggled: 1, sore: 0, easy: 0 },
      { weekStart: '2026-09-07', relative: 'this_week', strong: 0, tired: 0, motivated: 1, struggled: 0, sore: 0, easy: 1 }
    ],
    feelingsTotal: { strong: 1, tired: 2, motivated: 1, struggled: 1, sore: 0, easy: 1 },
    sports: [{ sport: 'running', sessions: 6, averageDistanceKmPerActivity: 7.1 }]
  },
  last12Months: [{
    month: '2026-08',
    relative: 'last_month',
    sessions: 6,
    durationHours: 7.2,
    distanceKm: 42.5,
    activeDays: 6,
    restDays: 25,
    observedDays: 31,
    averageSessionDurationHours: 1.2,
    averageHoursPerWeek: 1.6,
    averageSessionsPerWeek: 1.4,
    averageDistanceKmPerActivity: 7.1,
    sports: [{ sport: 'running', sessions: 6, durationHours: 7.2, distanceKm: 42.5, percentSessions: 100, averageSessionDurationHours: 1.2, averageHoursPerWeek: 1.6, averageSessionsPerWeek: 1.4, averageDistanceKmPerActivity: 7.1 }]
  }],
  dataQuality: { activeWeeksInDetailedWindow: 4, trendEligible: true },
  calendar: {
    plannedSessions: {
      items: [
        { date: '2026-09-10', sport: 'running', title: 'Easy run', plannedDuration: '45m', status: 'planned' },
        { date: '2026-09-11', sport: 'weightlifting', title: 'Strength', plannedDuration: null, status: 'planned' },
        { date: '2026-09-12', sport: 'cycling', title: 'Long ride', plannedDuration: '1h 20m', status: 'planned' }
      ],
      included: 3,
      total: 3,
      truncated: false,
      byMonth: [{ month: '2026-09', plannedCount: 3, totalPlannedMinutes: 125, included: 3, truncated: false }]
    },
    events: {
      items: [
        { date: '2026-09-10T17:00:00Z', title: 'Club ride', sport: 'cycling', type: 'group', clubName: 'Road Club', ownRsvp: 'going' },
        { date: '2026-09-11T18:30:00Z', title: 'Track meet', sport: 'running', type: 'meet', clubName: null, ownRsvp: 'interested' },
        { date: '2026-09-20T16:00:00Z', title: 'Open race', sport: 'running', type: 'race', clubName: null, ownRsvp: null }
      ],
      included: 3,
      total: 3,
      truncated: false,
      byMonth: [{ month: '2026-09', count: 3, included: 3, truncated: false }]
    },
    pastPlanAdherence: [{ month: '2026-08', relative: 'last_month', done: 3, skipped: 1, stillPlanned: 2 }]
  },
  goals: {
    active: {
      items: [{
        type: 'distance',
        sport: 'cycling',
        target: { value: 100, unit: 'km' },
        period: 'monthly',
        progress: { value: 65, unit: 'km', percent: 65 },
        onTrack: true,
        isComplete: false,
        windowStart: '2026-09-01T07:00:00.000Z',
        windowEnd: '2026-10-01T07:00:00.000Z',
        previousPeriodRange: { windowStart: '2026-06-01', windowEnd: '2026-09-01' },
        previousPeriods: [
          {
            windowStart: '2026-08-01',
            windowEnd: '2026-09-01',
            target: { value: 100, unit: 'km' },
            progress: { value: 105, unit: 'km', percent: 100 },
            achieved: true
          },
          {
            windowStart: '2026-07-01',
            windowEnd: '2026-08-01',
            target: { value: 100, unit: 'km' },
            progress: { value: 75, unit: 'km', percent: 75 },
            achieved: false
          },
          {
            windowStart: '2026-06-01',
            windowEnd: '2026-07-01',
            target: { value: 100, unit: 'km' },
            progress: { value: 90, unit: 'km', percent: 90 },
            achieved: false
          }
        ]
      }]
    }
  }
};

test('fixture uses AI context schema version 8', () => {
  assert.equal(context.schemaVersion, 8);
});

function addUtcDate(date, days) {
  const result = new Date(date + 'T12:00:00Z');
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function chartContext() {
  const weekly = Array.from({ length: 12 }, (_, index) => {
    const cyclingSessions = index + 1;
    const runningSessions = index % 2 ? 2 : 1;
    return {
      weekStart: addUtcDate('2026-06-22', index * 7),
      relative: index === 11 ? 'this_week' : index === 10 ? 'last_week' : `${11 - index}_weeks_ago`,
      activityCount: cyclingSessions + runningSessions,
      durationHours: cyclingSessions + runningSessions / 2,
      distanceKm: cyclingSessions * 10 + runningSessions * 5,
      sports: [
        { sport: 'cycling', sessions: cyclingSessions, durationHours: cyclingSessions, distanceKm: cyclingSessions * 10 },
        { sport: 'running', sessions: runningSessions, durationHours: runningSessions / 2, distanceKm: runningSessions * 5 }
      ]
    };
  });
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = addUtcDate('2025-10-01', index * 31).slice(0, 7);
    const cyclingSessions = index + 2;
    const runningSessions = index % 3 + 1;
    return {
      month,
      relative: index === 11 ? 'this_month' : index === 10 ? 'last_month' : `${11 - index}_months_ago`,
      sessions: cyclingSessions + runningSessions,
      durationHours: cyclingSessions + runningSessions / 2,
      distanceKm: cyclingSessions * 12 + runningSessions * 6,
      sports: [
        { sport: 'cycling', sessions: cyclingSessions, durationHours: cyclingSessions, distanceKm: cyclingSessions * 12 },
        { sport: 'running', sessions: runningSessions, durationHours: runningSessions / 2, distanceKm: runningSessions * 6 }
      ]
    };
  });
  return {
    schemaVersion: 8,
    asOfDate: '2026-09-10',
    coverage: { detailedWindow: { startDate: '2026-06-19', endDate: '2026-09-10', weeks: 12 } },
    allTime: { activityCount: 99 },
    last12Weeks: {
      daily: [
        { date: '2026-06-19', sessions: 2, durationHours: 1.5, distanceKm: 8 },
        { date: '2026-06-21', sessions: 1, durationHours: 0.5, distanceKm: 4 },
        { date: '2026-09-10', sessions: 3, durationHours: 2, distanceKm: 14 }
      ],
      weekly,
      feelings: weekly.map((row, index) => ({
        weekStart: row.weekStart,
        relative: row.relative,
        strong: index + 1,
        motivated: index % 2,
        easy: 2,
        tired: index % 3,
        sore: 0,
        struggled: 1
      })),
      sports: [
        { sport: 'cycling', sessions: 30, durationHours: 30, distanceKm: 120 },
        { sport: 'hiking', sessions: 2, durationHours: 8, distanceKm: 16 }
      ]
    },
    last12Months: months,
    dataQuality: { activityCount: 99, activeWeeksInDetailedWindow: 12, trendEligible: true }
  };
}

function chartFinding(metric, period, evidence, extra = {}) {
  return { type: 'chart', metric, period, evidence, ...extra };
}

test('chart resolver zero-fills the exact detailed coverage and uses aggregate distance contributors', () => {
  const data = chartContext();
  const chart = resolveChartSeries(chartFinding('distanceKm', 'daily', 'last12Weeks.daily'), data);
  assert.equal(chart.error, undefined);
  assert.equal(chart.title, 'Distance (km) per day — last 12 weeks');
  assert.equal(chart.unit, 'km');
  assert.equal(chart.labels.length, 84);
  assert.deepEqual(chart.labels.slice(0, 3), ['2026-06-19', '2026-06-20', '2026-06-21']);
  assert.equal(chart.labels.at(-1), '2026-09-10');
  assert.deepEqual(chart.series, [{
    key: 'distanceKm', label: 'Distance (km)', color: INSIGHTS_CHART_BAR_COLOR,
    values: chart.totals
  }]);
  assert.equal(chart.totals[0], 8);
  assert.equal(chart.totals[1], 0);
  assert.equal(chart.totals[2], 4);
  assert.equal(chart.totals.at(-1), 14);
  assert.equal(chart.caption, 'Includes cycling and hiking');
  assert.deepEqual(chart.relative, []);
});

test('chart resolver maps collection-native session names, sport colors, ordering, and feeling constants', () => {
  const data = chartContext();
  const weekly = resolveChartSeries(chartFinding('sessions', 'weekly', 'last12Weeks.weekly'), data);
  assert.deepEqual(weekly.labels, data.last12Weeks.weekly.map((row) => row.weekStart));
  assert.deepEqual(weekly.totals, data.last12Weeks.weekly.map((row) => row.activityCount));
  assert.equal(weekly.series[0].color, INSIGHTS_CHART_BAR_COLOR);
  const weeklyDistance = resolveChartSeries(chartFinding('distanceKm', 'weekly', 'last12Weeks.weekly'), data);
  assert.equal(weeklyDistance.caption, 'Includes running and cycling');
  const weeklyDistanceStack = resolveChartSeries(
    chartFinding('distanceKm', 'weekly', 'last12Weeks.weekly', { stackBySport: true }), data
  );
  assert.equal(weeklyDistanceStack.caption, 'Includes running and cycling');
  assert.deepEqual(weeklyDistanceStack.series.map((series) => series.key), ['cycling', 'running']);

  const monthlyStack = resolveChartSeries(chartFinding('sessions', 'monthly', 'last12Months', { stackBySport: true }), data);
  assert.equal(monthlyStack.labels.length, 12);
  assert.deepEqual(monthlyStack.series.map((series) => series.key), ['cycling', 'running']);
  assert.deepEqual(monthlyStack.series.map((series) => series.color), ['#1E40AF', '#C2410C']);
  assert.deepEqual(monthlyStack.totals, data.last12Months.map((row) => row.sessions));
  const monthlyDistanceStack = resolveChartSeries(
    chartFinding('distanceKm', 'monthly', 'last12Months', { stackBySport: true }), data
  );
  assert.equal(monthlyDistanceStack.caption, 'Includes running and cycling');
  assert.deepEqual(monthlyDistanceStack.totals, data.last12Months.map((row) => row.distanceKm));

  const sport = resolveChartSeries(chartFinding('durationHours', 'weekly', 'last12Weeks.weekly', { sport: 'cycling' }), data);
  assert.equal(sport.caption, 'Cycling');
  assert.deepEqual(sport.totals, data.last12Weeks.weekly.map((row) => row.sports[0].durationHours));

  const feelings = resolveChartSeries(chartFinding('feelings', 'weekly', 'last12Weeks.feelings'), data);
  assert.equal(feelings.unit, 'count');
  assert.deepEqual(feelings.series.map(({ key, label, color }) => ({ key, label, color })), INSIGHTS_FEELING_SERIES);
  assert.deepEqual(feelings.totals, data.last12Weeks.feelings.map((row) =>
    INSIGHTS_FEELING_SERIES.reduce((total, series) => total + row[series.key], 0)));
});

test('chart finding requires a non-chart data finding and returns chart evidence without model values', () => {
  const data = chartContext();
  const finding = chartFinding('sessions', 'daily', 'last12Weeks.daily');
  const alone = validateInsightResponse({ findings: [finding], limitations: [] }, data);
  assert.equal(alone.ok, false);
  assert.equal(alone.reason, 'chart_requires_data_finding');
  assert.equal(alone.answer, FALLBACK_COPY);

  const accepted = validateInsightResponse({
    findings: [finding, { type: 'metric', path: 'allTime.activityCount', value: 99 }],
    limitations: []
  }, data);
  assert.equal(accepted.ok, true);
  assert.match(accepted.answer, /99/);
  assert.equal(accepted.chart.labels.length, 84);
  assert.deepEqual(accepted.evidence.map((item) => item.path), ['last12Weeks.daily', 'allTime.activityCount']);

  const controlOnly = validateInsightResponse({
    findings: [finding, { type: 'insufficient_trend_data' }],
    limitations: []
  }, { ...data, dataQuality: { activityCount: 2, activeWeeksInDetailedWindow: 1, trendEligible: false } });
  assert.equal(controlOnly.ok, false);
  assert.equal(controlOnly.reason, 'chart_requires_data_finding');
});

test('chart finding rejects invalid contracts, no-data requests, and invalid context safely', () => {
  const data = chartContext();
  const withMetric = (finding) => validateInsightResponse({
    findings: [finding, { type: 'metric', path: 'allTime.activityCount', value: 99 }],
    limitations: []
  }, data);
  const cases = [
    [chartFinding('sessions', 'daily', 'last12Weeks.daily', { sport: 'cycling' }), 'chart_daily_constraints'],
    [chartFinding('sessions', 'daily', 'last12Weeks.daily', { stackBySport: false }), 'chart_daily_constraints'],
    [chartFinding('feelings', 'weekly', 'last12Weeks.feelings', { stackBySport: false }), 'chart_feelings_constraints'],
    [chartFinding('durationHours', 'weekly', 'last12Weeks.weekly', { sport: 'cycling', stackBySport: false }), 'chart_sport_stack_conflict'],
    [chartFinding('durationHours', 'weekly', 'last12Weeks.weekly', { sport: 'triathlon' }), 'chart_invalid_sport'],
    [chartFinding('sessions', 'weekly', 'last12Weeks.daily'), 'chart_evidence_period_mismatch'],
    [{ ...chartFinding('sessions', 'weekly', 'last12Weeks.weekly'), values: [999] }, 'invalid_chart_finding']
  ];
  for (const [finding, reason] of cases) {
    const result = withMetric(finding);
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(result.answer, FALLBACK_COPY);
  }
  const absentSport = withMetric(chartFinding('durationHours', 'weekly', 'last12Weeks.weekly', { sport: 'hiking' }));
  assert.equal(absentSport.reason, 'chart_sport_not_present');
  const multiple = validateInsightResponse({
    findings: [
      chartFinding('sessions', 'daily', 'last12Weeks.daily'),
      chartFinding('sessions', 'weekly', 'last12Weeks.weekly'),
      { type: 'metric', path: 'allTime.activityCount', value: 99 }
    ],
    limitations: []
  }, data);
  assert.equal(multiple.ok, false);
  assert.equal(multiple.reason, 'chart_limit');

  const noData = chartContext();
  noData.last12Weeks.weekly.forEach((row) => { row.activityCount = 0; });
  const zero = validateInsightResponse({
    findings: [
      chartFinding('sessions', 'weekly', 'last12Weeks.weekly'),
      { type: 'metric', path: 'allTime.activityCount', value: 99 }
    ],
    limitations: []
  }, noData);
  assert.equal(zero.ok, false);
  assert.equal(zero.reason, 'chart_no_data');

  const malformed = chartContext();
  malformed.last12Weeks.daily[0].sessions = Infinity;
  const unsafe = resolveChartSeries(chartFinding('sessions', 'daily', 'last12Weeks.daily'), malformed);
  assert.equal(unsafe.error, 'chart_invalid_context');
  const futureWindow = chartContext();
  futureWindow.coverage.detailedWindow.endDate = '2026-09-11';
  assert.equal(
    resolveChartSeries(chartFinding('sessions', 'daily', 'last12Weeks.daily'), futureWindow).error,
    'chart_invalid_context'
  );
});

test('evidence validator accepts exact paths and values', () => {
  const result = validateInsightResponse({
    findings: [
      { type: 'metric', path: 'allTime.activityCount', value: 8 },
      { type: 'metric', path: 'allTime.distanceKm', value: 42.5 }
    ],
    limitations: []
  }, context);
  assert.equal(result.ok, true);
  assert.match(result.answer, /8/);
  assert.match(result.answer, /42\.5 km/);
});

test('evidence validator rejects a fabricated number and returns fallback copy', () => {
  const result = validateInsightResponse({
    findings: [{ type: 'metric', path: 'allTime.activityCount', value: 8, displayValue: 999 }],
    limitations: []
  }, context);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_finding');
  assert.equal(result.answer, FALLBACK_COPY);
  assert.doesNotMatch(result.answer, /999/);
});

test('evidence validator rejects an existing path with a mismatched value', () => {
  const result = validateInsightResponse({
    findings: [{ type: 'metric', path: 'allTime.activityCount', value: 9 }],
    limitations: []
  }, context);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'mismatched_value');
  assert.equal(result.offendingPath, 'allTime.activityCount');
  assert.deepEqual(result.mismatchDetails, {
    expectedValue: 8,
    receivedValue: 9,
    expectedType: 'number',
    receivedType: 'number'
  });
  assert.equal(result.answer, FALLBACK_COPY);
  assert.doesNotMatch(result.answer, /9 activities/);
});

test('numeric strings and bracket paths normalize without weakening evidence equality', () => {
  const numericString = validateInsightResponse({
    findings: [{ type: 'metric', path: 'last12Months.0.durationHours', value: '7.2' }],
    limitations: []
  }, context);
  assert.equal(numericString.ok, true);
  assert.deepEqual(numericString.evidence, [{ path: 'last12Months.0.durationHours', value: 7.2 }]);

  const bracketPath = validateInsightResponse({
    findings: [{ type: 'metric', path: 'last12Months[0].durationHours', value: 7.2 }],
    limitations: []
  }, context);
  assert.equal(bracketPath.ok, true);
  assert.deepEqual(bracketPath.evidence, [{ path: 'last12Months.0.durationHours', value: 7.2 }]);

  const computed = validateInsightResponse({
    findings: [{ type: 'metric', path: 'last12Months[0].durationHours', value: '7.3' }],
    limitations: []
  }, context);
  assert.equal(computed.ok, false);
  assert.equal(computed.reason, 'mismatched_value');
  assert.equal(computed.offendingPath, 'last12Months.0.durationHours');
  assert.deepEqual(computed.mismatchDetails, {
    expectedValue: 7.2,
    receivedValue: '7.3',
    expectedType: 'number',
    receivedType: 'string'
  });
});

test('rejection diagnostics retain only safe schema-vocabulary paths', () => {
  const safe = validateInsightResponse({
    findings: [{ type: 'metric', path: 'last12Months.99.durationHours', value: 9 }],
    limitations: []
  }, context);
  assert.equal(safe.reason, 'missing_path');
  assert.equal(safe.offendingPath, 'last12Months.99.durationHours');

  const modelControlled = validateInsightResponse({
    findings: [{ type: 'metric', path: 'allTime.private-user-detail', value: 9 }],
    limitations: []
  }, context);
  assert.equal(modelControlled.reason, 'missing_path');
  assert.equal(modelControlled.offendingPath, null);
});

test('calendar, window-sport, rest-day, and average paths render from exact evidence', () => {
  const result = validateInsightResponse({
    findings: [
      { type: 'metric', path: 'last12Months.0.restDays', value: 25 },
      { type: 'metric', path: 'last12Months.0.averageHoursPerWeek', value: 1.6 },
      { type: 'metric', path: 'last12Months.0.sports.0.averageDistanceKmPerActivity', value: 7.1 },
      { type: 'metric', path: 'last12Weeks.sports.0.sessions', value: 6 }
    ],
    limitations: []
  }, context);
  assert.equal(result.ok, true);
  assert.match(result.answer, /August 2026/);
  assert.match(result.answer, /25 days/);
  assert.match(result.answer, /1\.6 hours/);
  assert.match(result.answer, /7\.1 km/);
  assert.equal(result.evidence.length, 4);
});

test('Monday weekly labels render current and previous periods without array-position inference', () => {
  const result = validateInsightResponse({
    findings: [
      { type: 'metric', path: 'last12Weeks.weekly.0.activityCount', value: 4 },
      { type: 'metric', path: 'last12Weeks.weekly.1.activityCount', value: 2 }
    ],
    limitations: []
  }, { ...context, asOfDate: '2026-09-07' });
  assert.equal(result.ok, true);
  assert.match(result.answer, /last week \(Aug 31 – Sep 6\) was 4/);
  assert.match(result.answer, /so far this week was 2/);
  assert.deepEqual(result.evidence.map((item) => item.path), [
    'last12Weeks.weekly.0.activityCount',
    'last12Weeks.weekly.1.activityCount'
  ]);
});

test('feeling counts render exact evidence with canonical friendly labels', () => {
  const result = validateInsightResponse({
    findings: [
      { type: 'metric', path: 'last12Weeks.feelings.0.tired', value: 2 },
      { type: 'metric', path: 'last12Weeks.feelingsTotal.easy', value: 1 }
    ],
    limitations: []
  }, context);
  assert.equal(result.ok, true);
  assert.equal(
    result.answer,
    'Your Tired count last week (Aug 31 – Sep 6) was 2. Your Easy day count in the last 12 weeks was 1.'
  );
  assert.doesNotMatch(result.answer, /\btired\b|\beasy\b/);
  assert.deepEqual(result.evidence, [
    { path: 'last12Weeks.feelings.0.tired', value: 2 },
    { path: 'last12Weeks.feelingsTotal.easy', value: 1 }
  ]);
});

test('feeling evidence rejects unknown keys and mismatched counts', () => {
  const unknown = validateInsightResponse({
    findings: [{ type: 'metric', path: 'last12Weeks.feelingsTotal.private_feeling', value: 1 }],
    limitations: []
  }, context);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, 'missing_path');
  assert.equal(unknown.offendingPath, null);

  const mismatched = validateInsightResponse({
    findings: [{ type: 'metric', path: 'last12Weeks.feelingsTotal.tired', value: 3 }],
    limitations: []
  }, context);
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.reason, 'mismatched_value');
  assert.equal(mismatched.answer, FALLBACK_COPY);
});

test('all-zero feeling summaries are unavailable, while a zero key is known when its period has observations', () => {
  const allZeroCounts = {
    strong: 0,
    tired: 0,
    motivated: 0,
    struggled: 0,
    sore: 0,
    easy: 0
  };
  const absentContext = {
    ...context,
    last12Weeks: {
      ...context.last12Weeks,
      feelings: context.last12Weeks.feelings.map((row) => ({ ...row, ...allZeroCounts })),
      feelingsTotal: { ...allZeroCounts }
    }
  };
  for (const path of ['last12Weeks.feelings.0.tired', 'last12Weeks.feelingsTotal.tired']) {
    const unavailable = validateInsightResponse({
      findings: [{ type: 'metric', path, value: 0 }],
      limitations: []
    }, absentContext);
    assert.equal(unavailable.ok, false);
    assert.equal(unavailable.reason, 'unsupported_path');
    assert.equal(unavailable.answer, FALLBACK_COPY);
  }

  const knownWeeklyZero = validateInsightResponse({
    findings: [{ type: 'metric', path: 'last12Weeks.feelings.0.sore', value: 0 }],
    limitations: []
  }, context);
  assert.equal(knownWeeklyZero.ok, true);
  assert.equal(knownWeeklyZero.answer, 'Your Sore count last week (Aug 31 – Sep 6) was 0.');

  const knownTotalZero = validateInsightResponse({
    findings: [{ type: 'metric', path: 'last12Weeks.feelingsTotal.sore', value: 0 }],
    limitations: []
  }, context);
  assert.equal(knownTotalZero.ok, true);
  assert.equal(knownTotalZero.answer, 'Your Sore count in the last 12 weeks was 0.');
});

test('absent feeling data remains an exclusive server-owned not-answerable result', () => {
  const result = validateInsightResponse({
    findings: [{ type: 'not_answerable', domain: 'recorded_training', reason: 'unsupported_metric' }],
    limitations: []
  }, context);
  assert.equal(result.ok, true);
  assert.equal(result.notAnswerable, true);
  assert.equal(result.answer, NOT_ANSWERABLE_COPY.unsupported_metric);
  assert.deepEqual(result.evidence, []);
  assert.deepEqual(result.limitations, []);
});

test('feeling prompt keeps monthly and absent-data answers honest without advice', () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /weekly feeling buckets cannot answer calendar-month questions exactly/);
  assert.match(prompt, /no recorded feelings.*unsupported_metric/);
  assert.match(prompt, /all-zero row or total has no feeling evidence/);
  assert.match(prompt, /do not infer causes, characterize the athlete, or give advice/);
});

test('first-of-month labels render previous and current months explicitly', () => {
  const monthContext = {
    ...context,
    asOfDate: '2026-09-01',
    last12Months: [
      { ...context.last12Months[0], month: '2026-08', relative: 'last_month', sessions: 6 },
      { ...context.last12Months[0], month: '2026-09', relative: 'this_month', sessions: 1 }
    ]
  };
  const result = validateInsightResponse({
    findings: [
      { type: 'metric', path: 'last12Months.0.sessions', value: 6 },
      { type: 'metric', path: 'last12Months.1.sessions', value: 1 }
    ],
    limitations: []
  }, monthContext);
  assert.equal(result.ok, true);
  assert.match(result.answer, /last month \(August 2026\) was 6/);
  assert.match(result.answer, /so far in September 2026 was 1/);
  assert.deepEqual(result.evidence.map((item) => item.path), [
    'last12Months.0.sessions',
    'last12Months.1.sessions'
  ]);
});

test('calendar and active-goal typed findings render only exact copied records', () => {
  const findings = [
    ['calendar_plan', 'calendar.plannedSessions.items.0'],
    ['calendar_event', 'calendar.events.items.0'],
    ['plan_adherence', 'calendar.pastPlanAdherence.0'],
    ['goal_projection', 'goals.active.items.0']
  ].map(([type, path]) => ({ type, path, value: path.split('.').reduce((value, token) => value[token], context) }));
  const result = validateInsightResponse({ findings, limitations: [] }, context);
  assert.equal(result.ok, true);
  assert.equal(result.evidence.length, 4);
  assert.match(result.answer, /Easy run/);
  assert.match(result.answer, /Club ride/);
  assert.match(result.answer, /today for 45 minutes/);
  assert.match(result.answer, /today at 10:00 AM/);
  assert.match(result.answer, /your plans were 3 done, 1 skipped, and 2 still planned/);
  assert.match(result.answer, /on track/);
  assert.deepEqual(result.limitations, []);
});

test('previous goal periods render achieved, not-achieved, and three-period past-tense copy', () => {
  const first = context.goals.active.items[0].previousPeriods[0];
  const achieved = validateInsightResponse({
    findings: [{
      type: 'goal_period',
      path: 'goals.active.items.0.previousPeriods.0',
      value: first
    }],
    limitations: []
  }, context);
  assert.equal(achieved.ok, true);
  assert.equal(
    achieved.answer,
    'Last month your cycling distance goal reached 105 of 100 km and was achieved.'
  );

  const second = context.goals.active.items[0].previousPeriods[1];
  const notAchieved = validateInsightResponse({
    findings: [{
      type: 'goal_period',
      path: 'goals.active.items.0.previousPeriods.1',
      value: second
    }],
    limitations: []
  }, context);
  assert.equal(notAchieved.ok, true);
  assert.equal(
    notAchieved.answer,
    'In July 2026 your cycling distance goal reached 75 of 100 km and was not achieved.'
  );

  const list = validateInsightResponse({
    findings: [{
      type: 'goal_period_list',
      path: 'goals.active.items.0.previousPeriods'
    }],
    limitations: []
  }, context);
  assert.equal(list.ok, true);
  assert.equal(
    list.answer,
    'Over your last three closed months, your cycling distance goal reached 105 of 100 km in August 2026 and was achieved; 75 of 100 km in July 2026 and was not achieved; 90 of 100 km in June 2026 and was not achieved.'
  );
  assert.equal(list.evidence.length, 3);
});

test('calendar totals and monthly aggregates are renderable metrics', () => {
  const result = validateInsightResponse({
    findings: [
      { type: 'metric', path: 'calendar.plannedSessions.total', value: 3 },
      { type: 'metric', path: 'calendar.plannedSessions.included', value: 3 },
      { type: 'metric', path: 'calendar.plannedSessions.byMonth.0.plannedCount', value: 3 },
      { type: 'metric', path: 'calendar.plannedSessions.byMonth.0.totalPlannedMinutes', value: 125 },
      { type: 'metric', path: 'calendar.events.total', value: 3 },
      { type: 'metric', path: 'calendar.events.included', value: 3 },
      { type: 'metric', path: 'calendar.events.byMonth.0.count', value: 3 }
    ],
    limitations: []
  }, context);
  assert.equal(result.ok, true);
  assert.match(result.answer, /You have 3 future plan records across all statuses\./);
  assert.match(result.answer, /You have 3 planned sessions left in September 2026\./);
  assert.match(result.answer, /You have 125 planned minutes in September 2026\./);
  assert.match(result.answer, /You have 3 eligible events in September 2026\./);
});

test('top-level plan totals are labeled as all-status records, not sessions left', () => {
  const allStatusContext = {
    ...context,
    calendar: {
      ...context.calendar,
      plannedSessions: {
        ...context.calendar.plannedSessions,
        total: 4,
        included: 4
      }
    }
  };
  const result = validateInsightResponse({
    findings: [
      { type: 'metric', path: 'calendar.plannedSessions.total', value: 4 },
      { type: 'metric', path: 'calendar.plannedSessions.byMonth.0.plannedCount', value: 3 }
    ],
    limitations: []
  }, allStatusContext);
  assert.equal(result.ok, true);
  assert.match(result.answer, /You have 4 future plan records across all statuses\./);
  assert.match(result.answer, /You have 3 planned sessions left in September 2026\./);
});

test('same-month count metrics are deduplicated only when their matching list renders', () => {
  const sameMonth = validateInsightResponse({
    findings: [
      { type: 'metric', path: 'calendar.plannedSessions.byMonth.0.plannedCount', value: 3 },
      { type: 'calendar_plan_list', path: 'calendar.plannedSessions.items', filter: { month: '2026-09' } }
    ],
    limitations: []
  }, context);
  assert.equal(sameMonth.ok, true);
  assert.equal((sameMonth.answer.match(/planned sessions left in September 2026/g) || []).length, 1);
  assert.doesNotMatch(sameMonth.answer, /was 3/);
  assert.equal(sameMonth.evidence.length, 4);

  const sameEventMonth = validateInsightResponse({
    findings: [
      { type: 'metric', path: 'calendar.events.byMonth.0.count', value: 3 },
      { type: 'calendar_event_list', path: 'calendar.events.items', filter: { month: '2026-09' } }
    ],
    limitations: []
  }, context);
  assert.equal(sameEventMonth.ok, true);
  assert.equal((sameEventMonth.answer.match(/events in September 2026/g) || []).length, 1);
  assert.doesNotMatch(sameEventMonth.answer, /was 3/);
  assert.equal(sameEventMonth.evidence.length, 4);

  const differentMonthContext = {
    ...context,
    calendar: {
      ...context.calendar,
      plannedSessions: {
        ...context.calendar.plannedSessions,
        byMonth: [
          ...context.calendar.plannedSessions.byMonth,
          { month: '2026-10', plannedCount: 0, totalPlannedMinutes: 0, included: 0, truncated: false }
        ]
      }
    }
  };
  const differentMonth = validateInsightResponse({
    findings: [
      { type: 'metric', path: 'calendar.plannedSessions.byMonth.0.plannedCount', value: 3 },
      { type: 'calendar_plan_list', path: 'calendar.plannedSessions.items', filter: { month: '2026-10' } }
    ],
    limitations: []
  }, differentMonthContext);
  assert.equal(differentMonth.ok, true);
  assert.match(differentMonth.answer, /You have 3 planned sessions left in September 2026\./);
  assert.match(differentMonth.answer, /You have no planned sessions in October 2026\./);
});

test('zero calendar months render honest empty answers for lists and count metrics', () => {
  const zeroMonthContext = {
    ...context,
    calendar: {
      ...context.calendar,
      plannedSessions: {
        ...context.calendar.plannedSessions,
        byMonth: [
          ...context.calendar.plannedSessions.byMonth,
          { month: '2026-10', plannedCount: 0, totalPlannedMinutes: 0, included: 0, truncated: false }
        ]
      },
      events: {
        ...context.calendar.events,
        byMonth: [
          ...context.calendar.events.byMonth,
          { month: '2026-10', count: 0, included: 0, truncated: false }
        ]
      }
    }
  };
  const lists = validateInsightResponse({
    findings: [
      { type: 'calendar_event_list', path: 'calendar.events.items', filter: { month: '2026-10' } },
      { type: 'calendar_plan_list', path: 'calendar.plannedSessions.items', filter: { month: '2026-10' } }
    ],
    limitations: []
  }, zeroMonthContext);
  assert.equal(lists.ok, true);
  assert.equal(lists.answer,
    'You have no events scheduled in October 2026. You have no planned sessions in October 2026.');

  const counts = validateInsightResponse({
    findings: [
      { type: 'metric', path: 'calendar.events.byMonth.1.count', value: 0 },
      { type: 'metric', path: 'calendar.plannedSessions.byMonth.1.plannedCount', value: 0 }
    ],
    limitations: []
  }, zeroMonthContext);
  assert.equal(counts.ok, true);
  assert.equal(counts.answer,
    'You have no events scheduled in October 2026. You have no planned sessions in October 2026.');
});

test('calendar list months beyond the filled range are not answerable rather than known empty', () => {
  const result = validateInsightResponse({
    findings: [{
      type: 'calendar_event_list',
      path: 'calendar.events.items',
      filter: { month: '2027-03' }
    }],
    limitations: []
  }, context);
  assert.equal(result.ok, true);
  assert.equal(result.notAnswerable, true);
  assert.equal(result.notAnswerableReason, 'calendar_month_out_of_range');
  assert.equal(result.answer, NOT_ANSWERABLE_COPY.calendar_month_out_of_range);
  assert.deepEqual(result.evidence, []);
});

test('bounded month lists are selected and written entirely by the server', () => {
  const result = validateInsightResponse({
    findings: [
      { type: 'calendar_plan_list', path: 'calendar.plannedSessions.items', filter: { month: '2026-09' } },
      { type: 'calendar_event_list', path: 'calendar.events.items', filter: { month: '2026-09' } }
    ],
    limitations: []
  }, context);
  assert.equal(result.ok, true);
  assert.match(result.answer, /You have 3 planned sessions left in September 2026: Easy run today for 45 minutes; Strength tomorrow; Long ride on Saturday for 1 hour 20 minutes\./);
  assert.match(result.answer, /You have 3 events in September 2026: Club ride today at 10:00 AM with Road Club \(RSVP: going\); Track meet tomorrow at 11:30 AM \(RSVP: interested\); Open race on Sep 20 at 9:00 AM\./);
  assert.equal(result.evidence.length, 8);
});

test('captured provider list value is accepted only when it exactly matches the filtered records', () => {
  const capturedFinding = {
    type: 'calendar_plan_list',
    path: 'calendar.plannedSessions.items',
    filter: { month: '2026-09' },
    value: context.calendar.plannedSessions.items
  };
  const accepted = validateInsightResponse({ findings: [capturedFinding], limitations: [] }, context);
  assert.equal(accepted.ok, true);
  assert.match(accepted.answer, /You have 3 planned sessions left/);

  const altered = validateInsightResponse({
    findings: [{
      ...capturedFinding,
      value: capturedFinding.value.slice(0, 2)
    }],
    limitations: []
  }, context);
  assert.equal(altered.ok, false);
  assert.equal(altered.reason, 'mismatched_value');
  assert.equal(altered.filterPresent, true);
  assert.equal(altered.filterValid, true);
});

test('list findings reject arbitrary extra keys and months absent from byMonth with filter diagnostics', () => {
  const extraKey = validateInsightResponse({
    findings: [{
      type: 'calendar_plan_list',
      path: 'calendar.plannedSessions.items',
      filter: { month: '2026-09' },
      displayValue: 'not allowed'
    }],
    limitations: []
  }, context);
  assert.equal(extraKey.ok, false);
  assert.equal(extraKey.reason, 'invalid_finding');
  assert.equal(extraKey.filterPresent, true);
  assert.equal(extraKey.filterValid, true);

  const missingMonth = validateInsightResponse({
    findings: [{
      type: 'calendar_plan_list',
      path: 'calendar.plannedSessions.items',
      filter: { month: '2026-08' }
    }],
    limitations: []
  }, context);
  assert.equal(missingMonth.ok, false);
  assert.equal(missingMonth.reason, 'missing_path');
  assert.equal(missingMonth.filterPresent, true);
  assert.equal(missingMonth.filterValid, false);
});

test('a truncated month list receives server-enforced disclosure', () => {
  const cappedContext = {
    ...context,
    calendar: {
      ...context.calendar,
      plannedSessions: {
        ...context.calendar.plannedSessions,
        total: 12,
        truncated: true,
        byMonth: [{
          ...context.calendar.plannedSessions.byMonth[0],
          plannedCount: 12,
          truncated: true
        }]
      }
    }
  };
  const result = validateInsightResponse({
    findings: [{ type: 'calendar_plan_list', path: 'calendar.plannedSessions.items', filter: { month: '2026-09' } }],
    limitations: []
  }, cappedContext);
  assert.equal(result.ok, true);
  assert.match(result.answer, /You have 12 planned sessions left.*here are the first 3/);
  assert.deepEqual(result.limitations, [
    'Calendar results were capped, so additional matching plans or events are not included.'
  ]);
});

test('a complete requested month does not inherit unrelated calendar truncation', () => {
  const unrelatedCapContext = {
    ...context,
    calendar: {
      ...context.calendar,
      events: { ...context.calendar.events, total: 99, truncated: true }
    }
  };
  const result = validateInsightResponse({
    findings: [{
      type: 'calendar_plan_list',
      path: 'calendar.plannedSessions.items',
      filter: { month: '2026-09' }
    }],
    limitations: ['CALENDAR_RESULTS_TRUNCATED']
  }, unrelatedCapContext);
  assert.equal(result.ok, true);
  assert.deepEqual(result.limitations, []);
  assert.match(result.answer, /You have 3 planned sessions left/);
});

test('safe rejection diagnostics expose only allowlisted finding types and paths', () => {
  assert.deepEqual(safeFindingDiagnostics({
    findings: [
      { type: 'metric', path: 'calendar.plannedSessions.total', value: 99, text: 'PRIVATE FREE TEXT' },
      { type: 'comparison', leftPath: 'allTime.activityCount', rightPath: 'allTime.distanceKm', text: 'MORE PRIVATE TEXT' },
      { type: 'PRIVATE TYPE', path: 'calendar.events.items.0', title: 'PRIVATE TITLE' }
    ],
    limitations: []
  }), {
    findingCount: 3,
    findings: [
      { type: 'metric', paths: ['calendar.plannedSessions.total'] },
      { type: 'comparison', paths: ['allTime.activityCount', 'allTime.distanceKm'] },
      { type: 'unknown', paths: ['calendar.events.items.0'] }
    ]
  });
});

test('calendar cap disclosure is server-enforced when the model omits it', () => {
  const cappedContext = {
    ...context,
    calendar: {
      ...context.calendar,
      plannedSessions: { ...context.calendar.plannedSessions, truncated: true }
    }
  };
  const finding = {
    type: 'calendar_plan',
    path: 'calendar.plannedSessions.items.0',
    value: cappedContext.calendar.plannedSessions.items[0]
  };
  const result = validateInsightResponse({ findings: [finding], limitations: [] }, cappedContext);
  assert.equal(result.ok, true);
  assert.deepEqual(result.limitations, [
    'Calendar results were capped, so additional matching plans or events are not included.'
  ]);
});

test('calendar and goal object findings reject altered records', () => {
  const result = validateInsightResponse({
    findings: [{ type: 'goal_projection', path: 'goals.active.items.0', value: { ...context.goals.active.items[0], onTrack: false } }],
    limitations: []
  }, context);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'mismatched_value');
  assert.equal(result.offendingPath, 'goals.active.items.0');
});

test('signed history rejects a client-tampered answer', () => {
  const secret = 'stable-test-secret';
  const signed = makeSignedHistoryTurn(secret, 'user-1', 'How far?', 'You logged 42.5 km.', new Date('2026-09-03T12:00:00Z'));
  assert.equal(verifyHistoryTurns(secret, 'user-1', [signed], new Date('2026-09-03T12:01:00Z')).length, 1);
  const tampered = { ...signed, answer: 'You logged 999 km.' };
  assert.deepEqual(verifyHistoryTurns(secret, 'user-1', [tampered], new Date('2026-09-03T12:01:00Z')), []);
});

test('typed policy refusal gets exact server-owned copy', () => {
  for (const reason of ['prescriptive', 'diet_weight_body', 'medical', 'athlete_characterization']) {
    const result = validateInsightResponse({
      findings: [{ type: 'policy_refusal', reason }],
      limitations: []
    }, context);
    assert.equal(result.ok, true);
    assert.equal(result.policyRefusal, true);
    assert.equal(result.policyReason, reason);
    assert.equal(result.answer, REFUSAL_COPY);
    assert.deepEqual(result.evidence, []);
  }
});

test('policy refusal rejects extra model prose, mixed findings, and unknown reasons', () => {
  const withProse = validateInsightResponse({
    findings: [{ type: 'policy_refusal', reason: 'prescriptive', text: 'You should run tomorrow.' }],
    limitations: []
  }, context);
  assert.equal(withProse.ok, false);
  assert.equal(withProse.answer, FALLBACK_COPY);
  assert.doesNotMatch(withProse.answer, /run tomorrow/);

  const mixed = validateInsightResponse({
    findings: [
      { type: 'policy_refusal', reason: 'prescriptive' },
      { type: 'metric', path: 'allTime.activityCount', value: 8 }
    ],
    limitations: []
  }, context);
  assert.equal(mixed.ok, false);
  assert.equal(mixed.reason, 'invalid_policy_refusal');

  const unknown = validateInsightResponse({
    findings: [{ type: 'policy_refusal', reason: 'other' }],
    limitations: []
  }, context);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, 'invalid_policy_refusal');
});

test('typed not-answerable results use reason-specific server copy', () => {
  for (const [domain, reasons] of Object.entries(NOT_ANSWERABLE_REASONS_BY_DOMAIN)) {
    for (const reason of reasons) {
      const finding = {
        type: 'not_answerable',
        domain,
        reason,
        ...(domain === 'goals' ? { subjectPath: 'goals.active.items.0' } : {})
      };
      const result = validateInsightResponse({
        findings: [finding],
        limitations: []
      }, context);
      assert.equal(result.ok, true);
      assert.equal(result.notAnswerable, true);
      assert.equal(result.notAnswerableReason, reason);
      assert.equal(result.notAnswerableDomain, domain);
      assert.equal(result.answer, NOT_ANSWERABLE_COPY[reason]);
      assert.deepEqual(result.evidence, []);
    }
  }
});

test('not-answerable rejects wrong-domain reasons and unresolved goal subject paths', () => {
  for (const finding of [
    {
      type: 'not_answerable',
      domain: 'future_schedule',
      reason: 'goal_changed_after_period'
    },
    {
      type: 'not_answerable',
      domain: 'goals',
      subjectPath: 'goals.active.items.99',
      reason: 'goal_changed_after_period'
    }
  ]) {
    const result = validateInsightResponse({
      findings: [finding],
      limitations: []
    }, context);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid_not_answerable');
    assert.equal(result.answer, FALLBACK_COPY);
  }
});

test('not-answerable rejects extra prose, mixed findings, limitations, and unknown reasons', () => {
  for (const payload of [
    { findings: [{ type: 'not_answerable', domain: 'recorded_training', reason: 'missing_injury_date', text: 'I need your injury date.' }], limitations: [] },
    { findings: [{ type: 'not_answerable', domain: 'recorded_training', reason: 'missing_injury_date' }, { type: 'metric', path: 'allTime.activityCount', value: 8 }], limitations: [] },
    { findings: [{ type: 'not_answerable', domain: 'recorded_training', reason: 'missing_injury_date' }], limitations: ['DETAILED_WINDOW_12_WEEKS'] },
    { findings: [{ type: 'not_answerable', domain: 'recorded_training', reason: 'unknown' }], limitations: [] }
  ]) {
    const result = validateInsightResponse(payload, context);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid_not_answerable');
    assert.equal(result.answer, FALLBACK_COPY);
  }
});

test('model-controlled prose is rejected rather than displayed', () => {
  const result = validateInsightResponse({
    findings: [{ type: 'metric', path: 'allTime.distanceKm', value: 42.5, text: 'Take it easy tomorrow.' }],
    limitations: []
  }, context);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_finding');
  assert.equal(result.answer, FALLBACK_COPY);
  assert.doesNotMatch(result.answer, /Take it easy/);
});

test('trend language is rejected below the 8-activity and 4-week threshold', () => {
  const sparse = {
    allTime: { activityCount: 3, distanceKm: 12 },
    last12Weeks: { distanceKm: 12 },
    dataQuality: { activeWeeksInDetailedWindow: 3, trendEligible: false }
  };
  const result = validateInsightResponse({
    findings: [{
      type: 'comparison',
      leftPath: 'allTime.distanceKm',
      leftValue: 12,
      rightPath: 'last12Weeks.distanceKm',
      rightValue: 12
    }],
    limitations: []
  }, sparse);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unsupported_trend');
  assert.equal(result.answer, FALLBACK_COPY);
});

test('provider selection uses Replit integration outside Railway', () => {
  assert.deepEqual(resolveAnthropicProvider({
    AI_INTEGRATIONS_ANTHROPIC_API_KEY: 'replit-key',
    AI_INTEGRATIONS_ANTHROPIC_BASE_URL: 'https://replit-proxy.example'
  }), {
    provider: 'replit-ai-integrations',
    apiKey: 'replit-key',
    baseURL: 'https://replit-proxy.example'
  });
});

test('provider selection requires the direct key on Railway', () => {
  assert.deepEqual(resolveAnthropicProvider({
    RAILWAY_ENVIRONMENT: 'production',
    ANTHROPIC_API_KEY: 'direct-key',
    AI_INTEGRATIONS_ANTHROPIC_API_KEY: 'replit-key',
    AI_INTEGRATIONS_ANTHROPIC_BASE_URL: 'https://replit-proxy.example'
  }), {
    provider: 'anthropic-direct',
    apiKey: 'direct-key'
  });
  assert.throws(
    () => resolveAnthropicProvider({ RAILWAY_ENVIRONMENT: 'production' }),
    (error) => error.code === 'ai_insights_not_configured' && /ANTHROPIC_API_KEY/.test(error.message)
  );
});

test('provider selection rejects partial or absent configuration', () => {
  assert.throws(
    () => resolveAnthropicProvider({ AI_INTEGRATIONS_ANTHROPIC_BASE_URL: 'https://replit-proxy.example' }),
    (error) => error.code === 'ai_insights_not_configured'
  );
  assert.throws(
    () => resolveAnthropicProvider({}),
    (error) => error.code === 'ai_insights_not_configured'
  );
});