const assert = require('node:assert/strict');
const test = require('node:test');
const { createAiInsightsService } = require('./ai-insights-service');
const tz = require('./tzdate');

function resolved(value) {
  const chain = {};
  for (const method of ['select', 'eq', 'in', 'order', 'gte', 'lt', 'limit']) chain[method] = () => chain;
  chain.then = (resolve, reject) => Promise.resolve(value).then(resolve, reject);
  return chain;
}

function serviceForFrozenContext(providerResponse = null) {
  const emptyRows = { data: [], error: null };
  const supabaseAdmin = {
    from(table) {
      return resolved(table === 'goals' ? { data: [], count: 0, error: null } : emptyRows);
    }
  };
  return createAiInsightsService({
    supabaseAdmin,
    getAuthUser: async () => ({ id: '00000000-0000-4000-8000-000000000001', user_metadata: {} }),
    getUserTimezone: tz.getUserTimezone,
    dayKey: tz.dayKey,
    keyToEpochDays: tz.keyToEpochDays,
    addDaysToKey: tz.addDaysToKey,
    weekStartKey: tz.weekStartKey,
    monthKey: tz.monthKey,
    computeStreaks: tz.computeStreaks,
    parseDurationHours: () => 0,
    parseDistanceKmUnitAware: () => 0,
    calculatePoints: () => 0,
    fetchAllRows: async () => [],
    visibleEventsFilter: async (_id, rows) => rows,
    prefsFromMeta: () => ({ show_on_leaderboards: false }),
    listAllAuthUsers: async () => [],
    fetchActivitiesForUsers: async () => [],
    bucketActivities: () => ({}),
    buildUserProfileMap: async () => ({}),
    buildClubPointsLeaderboard: async () => ({}),
    getCurrentClubMembership: async () => null,
    enrichGoalRows: async () => [],
    goalNaturalUnit: () => '',
    createAnthropicClient: () => ({
      messages: {
        create: async () => {
          if (!providerResponse) throw new Error('not used');
          return providerResponse;
        }
      }
    })
  });
}

test('AI Insights service builds the existing context from a frozen clock', async () => {
  const service = serviceForFrozenContext();
  const context = await service.buildContextForUser(
    '00000000-0000-4000-8000-000000000001',
    '2026-09-14T12:00:00.000Z'
  );
  assert.equal(context.schemaVersion, 8);
  assert.equal(context.timezone, 'UTC');
  assert.equal(context.asOfDate, '2026-09-14');
  assert.deepEqual(context.last12Weeks.weekly.at(-1), {
    weekStart: '2026-09-14',
    relative: 'this_week',
    activityCount: 0,
    durationHours: 0,
    distanceKm: 0,
    points: 0,
    sports: []
  });
  assert.equal(context.last12Weeks.weekly.at(-2).relative, 'last_week');
  assert.equal(context.calendar.plannedSessions.total, 0);
  assert.equal(context.goals.active.total, 0);
});

test('recap mode uses the fixed contract and completes ordinary validation', async () => {
  const responseText = JSON.stringify({
    findings: [
      { type: 'metric', path: 'last12Weeks.weekly.10.activityCount', value: 0 },
      { type: 'metric', path: 'last12Weeks.weekly.10.durationHours', value: 0 },
      { type: 'metric', path: 'last12Weeks.weekly.10.points', value: 0 }
    ],
    limitations: ['INSUFFICIENT_TREND_DATA']
  });
  const service = serviceForFrozenContext({
    content: [{ type: 'text', text: '```json\n' + responseText + '\n```' }],
    usage: { input_tokens: 1, output_tokens: 2 }
  });
  const context = await service.buildContextForUser(
    '00000000-0000-4000-8000-000000000001',
    '2026-09-14T12:00:00.000Z'
  );
  const output = await service.runValidatedRequest(context, 'recap', {
    providerConfig: { provider: 'test', apiKey: 'not-a-secret' }
  });
  assert.equal(output.validated.ok, true);
  assert.equal(output.validated.recap.contractVersion, 2);
  assert.deepEqual(output.findings, JSON.parse(responseText).findings);
  assert.equal(output.usage.output_tokens, 2);
});
