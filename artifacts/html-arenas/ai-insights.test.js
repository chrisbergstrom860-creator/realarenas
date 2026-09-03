const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FALLBACK_COPY,
  REFUSAL_COPY,
  makeSignedHistoryTurn,
  verifyHistoryTurns,
  validateInsightResponse,
  requiresAdviceRefusal,
  resolveAnthropicProvider
} = require('./ai-insights');

const context = {
  schemaVersion: 1,
  allTime: { activityCount: 8, distanceKm: 42.5 },
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
  assert.equal(result.answer, FALLBACK_COPY);
  assert.doesNotMatch(result.answer, /9 activities/);
});

test('signed history rejects a client-tampered answer', () => {
  const secret = 'stable-test-secret';
  const signed = makeSignedHistoryTurn(secret, 'user-1', 'How far?', 'You logged 42.5 km.', new Date('2026-09-03T12:00:00Z'));
  assert.equal(verifyHistoryTurns(secret, 'user-1', [signed], new Date('2026-09-03T12:01:00Z')).length, 1);
  const tampered = { ...signed, answer: 'You logged 999 km.' };
  assert.deepEqual(verifyHistoryTurns(secret, 'user-1', [tampered], new Date('2026-09-03T12:01:00Z')), []);
});

test('advice questions get the exact descriptive-only refusal', () => {
  assert.equal(requiresAdviceRefusal('Am I under-training and what workouts should I do?'), true);
  assert.equal(REFUSAL_COPY, "I can describe your recorded training, but I can’t prescribe workouts or comment on diet, weight, body composition, or whether you are under-training. Try asking what changed in your volume, consistency, sports, personal records, or standings.");
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