const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FALLBACK_COPY,
  REFUSAL_COPY,
  NOT_ANSWERABLE_COPY,
  makeSignedHistoryTurn,
  verifyHistoryTurns,
  validateInsightResponse,
  safeFindingDiagnostics,
  resolveAnthropicProvider
} = require('./ai-insights');

const context = {
  schemaVersion: 4,
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
    pastPlanAdherence: [{ month: '2026-08', done: 3, skipped: 1, stillPlanned: 2 }]
  },
  goals: { active: { items: [{ type: 'distance', sport: 'cycling', target: { value: 100, unit: 'km' }, period: 'monthly', progress: { value: 65, unit: 'km', percent: 65 }, onTrack: true, isComplete: false, windowStart: '2026-09-01T07:00:00.000Z', windowEnd: '2026-10-01T07:00:00.000Z' }] } }
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
  assert.match(differentMonth.answer, /You have no planned sessions left in October 2026\./);
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
      filter: { month: '2026-10' }
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