const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FALLBACK_COPY,
  REFUSAL_COPY,
  NOT_ANSWERABLE_COPY,
  makeSignedHistoryTurn,
  verifyHistoryTurns,
  validateInsightResponse,
  resolveAnthropicProvider
} = require('./ai-insights');

const context = {
  schemaVersion: 2,
  allTime: {
    activityCount: 8,
    distanceKm: 42.5,
    averageSessionDurationHours: 1.2,
    sports: [{ sport: 'running', sessions: 6, averageDistanceKmPerActivity: 7.1 }]
  },
  last12Weeks: {
    distanceKm: 42.5,
    sports: [{ sport: 'running', sessions: 6, averageDistanceKmPerActivity: 7.1 }]
  },
  last12Months: [{
    month: '2026-08',
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
  dataQuality: { activeWeeksInDetailedWindow: 4, trendEligible: true }
};

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
  for (const reason of Object.keys(NOT_ANSWERABLE_COPY)) {
    const result = validateInsightResponse({
      findings: [{ type: 'not_answerable', reason }],
      limitations: []
    }, context);
    assert.equal(result.ok, true);
    assert.equal(result.notAnswerable, true);
    assert.equal(result.notAnswerableReason, reason);
    assert.equal(result.answer, NOT_ANSWERABLE_COPY[reason]);
    assert.deepEqual(result.evidence, []);
  }
});

test('not-answerable rejects extra prose, mixed findings, limitations, and unknown reasons', () => {
  for (const payload of [
    { findings: [{ type: 'not_answerable', reason: 'missing_injury_date', text: 'I need your injury date.' }], limitations: [] },
    { findings: [{ type: 'not_answerable', reason: 'missing_injury_date' }, { type: 'metric', path: 'allTime.activityCount', value: 8 }], limitations: [] },
    { findings: [{ type: 'not_answerable', reason: 'missing_injury_date' }], limitations: ['DETAILED_WINDOW_12_WEEKS'] },
    { findings: [{ type: 'not_answerable', reason: 'unknown' }], limitations: [] }
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