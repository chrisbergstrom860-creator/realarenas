const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildWeeklyRecapRequest, validateWeeklyRecapCompleteness, WEEKLY_RECAP_QUESTION,
  AiProviderConfigurationError
} = require('./ai-insights');
const {
  weeklyRecapEnabled, isWeeklyRecapDue, recapWindowFor, claimWeeklyRecap,
  createRecapNotification, recapUsageLog, storeGeneratedRecap, sweepExpiredWeeklyRecaps
} = require('./weekly-recaps');
const {
  eligibleUsers, listIndividualProSubscriptions, runOne, recoverGeneratedNotifications,
  recheckRecapEntitlement, main
} = require('./jobs/recaps');

function recapContext({ trendEligible = true, feelings = true, distance = 12 } = {}) {
  const weekly = Array.from({ length: 12 }, (_, i) => ({
    weekStart: i === 10 ? '2026-09-07' : i === 9 ? '2026-08-31' : `2026-0${i < 9 ? i + 1 : 9}-${String(i + 1).padStart(2, '0')}`,
    relative: i === 11 ? 'this_week' : i === 10 ? 'last_week' : i === 9 ? '2_weeks_ago' : `${11 - i}_weeks_ago`,
    activityCount: i === 10 ? 3 : 2, durationHours: i === 10 ? 4.5 : 2,
    distanceKm: i === 10 ? distance : 3, points: 1, sports: []
  }));
  const feelingRows = weekly.map((row, i) => ({
    weekStart: row.weekStart, relative: row.relative,
    strong: feelings && i === 10 ? 2 : 0, motivated: 0, easy: 0, tired: 0, sore: 0, struggled: 0
  }));
  return {
    schemaVersion: 8, timezone: 'UTC', asOfDate: '2026-09-14',
    last12Weeks: {
      weekly, feelings: feelingRows,
      feelingsTotal: { strong: feelings ? 2 : 0, motivated: 0, easy: 0, tired: 0, sore: 0, struggled: 0 }
    },
    dataQuality: { trendEligible }
  };
}

function requiredPayload(context, { includeDistance = true, includeChart = true } = {}) {
  const last = context.last12Weeks.weekly[10], previous = context.last12Weeks.weekly[9];
  const findings = [
    { type: 'metric', path: 'last12Weeks.weekly.10.activityCount', value: last.activityCount },
    { type: 'metric', path: 'last12Weeks.weekly.10.durationHours', value: last.durationHours },
    { type: 'metric', path: 'last12Weeks.weekly.10.points', value: last.points }
  ];
  if (includeDistance && last.distanceKm > 0) findings.push({ type: 'metric', path: 'last12Weeks.weekly.10.distanceKm', value: last.distanceKm });
  if (context.dataQuality.trendEligible) findings.push({
    type: 'comparison', leftPath: 'last12Weeks.weekly.10.durationHours', leftValue: last.durationHours,
    rightPath: 'last12Weeks.weekly.9.durationHours', rightValue: previous.durationHours
  });
  if (includeChart && context.last12Weeks.feelingsTotal.strong) {
    findings.push({ type: 'chart', metric: 'feelings', period: 'weekly', evidence: 'last12Weeks.feelings' });
  }
  return { findings, limitations: context.dataQuality.trendEligible ? [] : ['INSUFFICIENT_TREND_DATA'] };
}

test('weekly recap request is a synthetic empty-history request with fixed requirements', () => {
  const request = buildWeeklyRecapRequest(recapContext());
  assert.equal(JSON.parse(request.messages[0].content[1].text).question, WEEKLY_RECAP_QUESTION);
  assert.deepEqual(JSON.parse(request.messages[0].content[1].text).history, []);
  assert.match(request.system[0].text, /WEEKLY_RECAP_MODE v2/);
  assert.match(request.system[0].text, /last12Weeks\.weekly\.10\.activityCount/);
  assert.match(request.system[0].text, /last12Weeks\.weekly\.10\.points/);
  assert.match(request.system[0].text, /FORBID ALL calendar_plan_list and calendar_event_list/);
});

test('recap prompt permits calendar lists only from full matching records inside the seven-day range', () => {
  const context = recapContext();
  context.calendar = {
    plannedSessions: {
      byMonth: [{ month: '2026-09', plannedCount: 2 }],
      items: [
        { date: '2026-09-15', status: 'planned', title: 'Inside' },
        { date: '2026-09-30', status: 'planned', title: 'Outside' }
      ]
    }
  };
  assert.match(buildWeeklyRecapRequest(context).system[0].text, /FORBID ALL calendar_plan_list/);
  context.calendar.plannedSessions.items[1].status = 'done';
  const allowed = buildWeeklyRecapRequest(context).system[0].text;
  assert.match(allowed, /"type":"calendar_plan_list"/);
  assert.match(allowed, /"matchingStatus":"planned"/);
  assert.match(allowed, /"startInclusive":"2026-09-14"/);
  assert.match(allowed, /"endExclusive":"2026-09-21"/);
});

test('recap completeness accepts the standard required finding set and rejects a missing required metric', () => {
  const context = recapContext();
  const valid = requiredPayload(context);
  assert.equal(validateWeeklyRecapCompleteness(valid, context).ok, true);
  const missing = requiredPayload(context);
  missing.findings = missing.findings.filter((finding) => finding.path !== 'last12Weeks.weekly.10.durationHours');
  assert.equal(validateWeeklyRecapCompleteness(missing, context).reason, 'recap_missing_required_metric');
  const missingPoints = requiredPayload(context);
  missingPoints.findings = missingPoints.findings.filter((finding) => finding.path !== 'last12Weeks.weekly.10.points');
  assert.equal(validateWeeklyRecapCompleteness(missingPoints, context).reason, 'recap_missing_required_metric');

  const invalidAsOf = recapContext();
  invalidAsOf.asOfDate = '2026-09-15';
  assert.equal(validateWeeklyRecapCompleteness(requiredPayload(invalidAsOf), invalidAsOf).reason, 'recap_invalid_as_of_date');
  const invalidBoundary = recapContext();
  invalidBoundary.last12Weeks.weekly[10].weekStart = '2026-09-06';
  assert.equal(validateWeeklyRecapCompleteness(requiredPayload(invalidBoundary), invalidBoundary).reason, 'recap_invalid_last_week_boundary');
});

test('low-history recap requires its limitation and feelings chart is omitted when there are no feelings', () => {
  const context = recapContext({ trendEligible: false, feelings: false, distance: 0 });
  const lowHistory = requiredPayload(context, { includeDistance: false, includeChart: false });
  assert.equal(validateWeeklyRecapCompleteness(lowHistory, context).ok, true);
  lowHistory.limitations = [];
  assert.equal(validateWeeklyRecapCompleteness(lowHistory, context).reason, 'recap_missing_trend_limitation');
});

test('recap completeness rejects zero-distance metrics, extra findings, and all chart variants when feelings are absent', () => {
  const context = recapContext({ feelings: false, distance: 0 });
  const payload = requiredPayload(context, { includeDistance: false, includeChart: false });
  payload.findings.push({ type: 'metric', path: 'last12Weeks.weekly.10.distanceKm', value: 0 });
  assert.equal(validateWeeklyRecapCompleteness(payload, context).reason, 'recap_zero_distance_metric');

  const extra = requiredPayload(recapContext());
  extra.findings.push({ type: 'metric', path: 'last12Weeks.weekly.9.activityCount', value: 2 });
  assert.equal(validateWeeklyRecapCompleteness(extra, recapContext()).reason, 'recap_unexpected_metric');

  const absent = recapContext({ feelings: false });
  const unexpectedChart = requiredPayload(absent, { includeChart: false });
  unexpectedChart.findings.push({ type: 'chart', metric: 'sessions', period: 'weekly', evidence: 'last12Weeks.weekly' });
  assert.equal(validateWeeklyRecapCompleteness(unexpectedChart, absent).reason, 'recap_unexpected_feelings_chart');
});

test('recap completeness permits only the single standard comparison and no comparisons for low history', () => {
  const context = recapContext();
  const payload = requiredPayload(context);
  payload.findings.push({
    type: 'comparison', leftPath: 'last12Weeks.weekly.10.activityCount', leftValue: 3,
    rightPath: 'last12Weeks.weekly.9.activityCount', rightValue: 2
  });
  assert.equal(validateWeeklyRecapCompleteness(payload, context).reason, 'recap_unexpected_comparison');
  const low = recapContext({ trendEligible: false });
  const lowPayload = requiredPayload(low);
  lowPayload.findings.push({
    type: 'comparison', leftPath: 'last12Weeks.weekly.10.durationHours', leftValue: 4.5,
    rightPath: 'last12Weeks.weekly.9.durationHours', rightValue: 2
  });
  assert.equal(validateWeeklyRecapCompleteness(lowPayload, low).reason, 'unsupported_trend',
    'ordinary validation runs before recap completeness');
});

test('recap completeness rejects a calendar month with results outside the coming seven days and a record outside last week', () => {
  const context = recapContext();
  context.asOfDate = '2026-10-05';
  context.last12Weeks.weekly[10].weekStart = '2026-09-28';
  context.calendar = {
    plannedSessions: {
      items: [{ date: '2026-10-14', sport: 'running', title: 'Later', plannedDuration: '1:00', status: 'planned' }],
      byMonth: [{ month: '2026-10', plannedCount: 1, included: 1, truncated: false }]
    }
  };
  const calendar = requiredPayload(context);
  calendar.findings.push({
    type: 'calendar_plan_list', path: 'calendar.plannedSessions.items', filter: { month: '2026-10' }
  });
  assert.equal(validateWeeklyRecapCompleteness(calendar, context).reason, 'recap_calendar_outside_coming_week');

  const recordContext = recapContext();
  recordContext.allTime = { personalRecords: [{ type: 'longest_run', sport: 'running', value: 10, unit: 'km', date: '2026-08-01' }] };
  const record = requiredPayload(recordContext);
  record.findings.push({
    type: 'personal_record', path: 'allTime.personalRecords.0',
    value: recordContext.allTime.personalRecords[0]
  });
  assert.equal(validateWeeklyRecapCompleteness(record, recordContext).reason, 'recap_personal_record_outside_week');
});

test('eligibility is Monday 08:00 local, including UTC fallback and a DST week', () => {
  const la = { user_metadata: { timezone: 'America/Los_Angeles', prefs: { weekly_recap: true } } };
  assert.equal(isWeeklyRecapDue(la, new Date('2026-03-09T14:59:00Z')), false, '07:59 PDT');
  assert.equal(isWeeklyRecapDue(la, new Date('2026-03-09T15:01:00Z')), true, '08:01 PDT');
  assert.equal(isWeeklyRecapDue(la, new Date('2026-03-10T15:01:00Z')), true, 'Tuesday catches up the completed week');
  assert.equal(isWeeklyRecapDue(la, new Date('2026-03-15T15:01:00Z')), true, 'Sunday catches up the completed week');
  assert.equal(isWeeklyRecapDue(la, new Date('2026-03-16T14:59:00Z')), false, 'next Monday is not due before 08:00 PDT');
  const utc = { user_metadata: { prefs: { weekly_recap: true } } };
  assert.equal(isWeeklyRecapDue(utc, new Date('2026-03-09T08:01:00Z')), true);
  const window = recapWindowFor(la, new Date('2026-03-09T15:01:00Z'));
  assert.equal(window.weekStart, '2026-03-02');
  assert.equal(window.windowEndUtc, '2026-03-09T07:00:00.000Z', 'DST-aware local Monday boundary');
  assert.equal(weeklyRecapEnabled({ user_metadata: { prefs: {} } }), false);
});

test('claim RPC is one-winner under concurrent calls and notification uses a stable idempotency key', async () => {
  let claimed = false;
  const notifications = [];
  const supabase = {
    rpc: async (name, args) => {
      if (name !== 'claim_weekly_recap') return { data: null, error: null };
      if (claimed) return { data: { id: null, lease_until: null, attempts: null }, error: null };
      claimed = true;
      return { data: { id: 'claim', lease_until: args.p_lease_until, attempts: 1 }, error: null };
    },
    from: () => ({ upsert: async (row, opts) => { notifications.push({ row, opts }); return { error: null }; } })
  };
  const window = { userId: 'a', weekStart: '2026-03-02', timezone: 'UTC', windowStartUtc: 'x', windowEndUtc: 'y' };
  const claims = await Promise.all([claimWeeklyRecap(supabase, window), claimWeeklyRecap(supabase, window)]);
  assert.equal(claims.filter(Boolean).length, 1);
  await createRecapNotification(supabase, 'a', window.weekStart);
  assert.equal(notifications[0].row.source_key, 'weekly-recap:2026-03-02');
  assert.deepEqual(notifications[0].opts, { onConflict: 'user_id,source_key', ignoreDuplicates: true });
  const usage = recapUsageLog('not-logged-here', { input_tokens: 10 }, 'c');
  assert.equal(usage.kind, 'recap');
  assert.equal(usage.correlation_id, 'c');
});

test('dry-run validates through the injected service without claim, retention, or notification writes', async () => {
  const context = recapContext();
  const payload = requiredPayload(context);
  let writes = 0;
  const result = await runOne({
    supabase: {
      rpc: async () => { writes++; return { data: null, error: null }; },
      from: () => ({ upsert: async () => { writes++; return { error: null }; } })
    },
    service: {
      buildContextForUser: async () => context,
      runValidatedRequest: async () => ({
        text: JSON.stringify(payload),
        validated: validateWeeklyRecapCompleteness(payload, context),
        findings: payload.findings,
        answer: 'Validated recap.',
        usage: { output_tokens: 2 }
      })
    },
    user: { id: 'u', user_metadata: { prefs: { weekly_recap: true } } },
    now: new Date('2026-03-09T08:01:00Z'),
    dryRun: true,
    entitlementCheck: async () => ({ eligible: true }),
    logger: () => {}
  });
  assert.equal(result.status, 'dry_run_validated');
  assert.equal(writes, 0);
});

function validRunnerOutput() {
  return {
    validated: { ok: true, answer: 'Validated recap.', limitations: [], evidence: [] },
    findings: [{ type: 'metric', path: 'last12Weeks.weekly.10.activityCount', value: 3 }],
    answer: 'Validated recap.',
    usage: { input_tokens: 10, output_tokens: 2 }
  };
}

test('runner uses wall-clock lease, echoes the exact returned lease, and rejects composite RPC no-ops', async () => {
  const rpcCalls = [];
  const leaseReturnedByDb = '2026-03-09T08:11:37.123+00:00';
  const supabase = {
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (name === 'claim_weekly_recap') return { data: { id: 'claim-id', attempts: 1, lease_until: leaseReturnedByDb }, error: null };
      if (name === 'finish_weekly_recap') return { data: { id: 'stored-id' }, error: null };
      throw new Error(`unexpected rpc ${name}`);
    },
    from: () => ({ upsert: async () => ({ error: null }) })
  };
  const contextDates = [];
  const successLogs = [];
  const expectedChart = { metric: 'feelings', period: 'weekly', labels: ['2026-03-02'], series: [] };
  const result = await runOne({
    supabase,
    service: {
      buildContextForUser: async (id, asOf) => { contextDates.push(asOf.toISOString()); return { schemaVersion: 8 }; },
      runValidatedRequest: async () => ({
        ...validRunnerOutput(),
        validated: {
          ok: true, answer: 'Validated recap.', chart: expectedChart,
          limitations: ['INSUFFICIENT_TREND_DATA'], evidence: [{ path: 'last12Weeks.weekly.10.activityCount', value: 3 }]
        }
      })
    },
    user: { id: 'u', user_metadata: { prefs: { weekly_recap: true } } },
    now: new Date('2001-01-01T08:01:00Z'),
    leaseNow: new Date('2026-03-09T08:01:37.123Z'),
    dryRun: false,
    entitlementCheck: async () => ({ eligible: true }),
    logger: (line) => successLogs.push(JSON.parse(line))
  });
  assert.equal(result.status, 'generated');
  assert.equal(rpcCalls[0].args.p_lease_until, '2026-03-09T08:11:37.123Z', '--now does not create a stale SQL lease');
  assert.equal(rpcCalls[1].args.p_lease_until, leaseReturnedByDb, 'finish echoes SQL return verbatim');
  assert.deepEqual(rpcCalls[1].args.p_chart, expectedChart, 'verified chart output is stored with the recap');
  assert.deepEqual(rpcCalls[1].args.p_findings, {
    findings: validRunnerOutput().findings,
    limitations: ['INSUFFICIENT_TREND_DATA'],
    evidence: [{ path: 'last12Weeks.weekly.10.activityCount', value: 3 }]
  }, 'stored findings are the validated UI envelope, not a raw model array');
  assert.equal(successLogs.length, 1, 'successful generation emits one terminal usage line');
  assert.deepEqual(
    { event: successLogs[0].event, kind: successLogs[0].kind, status: successLogs[0].status },
    { event: 'ai_insights_usage', kind: 'recap', status: 'generated' }
  );
  assert.equal(contextDates[0], '2001-01-01T00:00:00.000Z', '--now still controls context');

  const noop = await storeGeneratedRecap({ rpc: async () => ({ data: { id: null }, error: null }) },
    { id: 'claim', lease_until: leaseReturnedByDb }, {
      findings: [], answer: 'x', contextSchemaVersion: 8
    });
  assert.equal(noop, null, 'composite {id:null} is not mistaken for a stored row');
});

test('runner stores recap prose rendered from the validated finding snapshot', async () => {
  const rpcCalls = [];
  const findings = [
    { type: 'metric', path: 'last12Weeks.weekly.10.activityCount', value: 3 },
    { type: 'metric', path: 'last12Weeks.weekly.10.durationHours', value: 1.9 },
    { type: 'metric', path: 'last12Weeks.weekly.10.distanceKm', value: 13.4 },
    { type: 'metric', path: 'last12Weeks.weekly.10.points', value: 47 },
    { type: 'comparison', leftPath: 'last12Weeks.weekly.10.durationHours', leftValue: 1.9, rightPath: 'last12Weeks.weekly.9.durationHours', rightValue: 2.9 }
  ];
  const result = await runOne({
    supabase: {
      rpc: async (name, args) => {
        rpcCalls.push({ name, args });
        if (name === 'claim_weekly_recap') return { data: { id: 'claim', attempts: 1, lease_until: 'lease' }, error: null };
        if (name === 'finish_weekly_recap') return { data: { id: 'stored' }, error: null };
        throw new Error(`unexpected RPC ${name}`);
      },
      from: () => ({ upsert: async () => ({ error: null }) })
    },
    service: {
      buildContextForUser: async () => ({ schemaVersion: 8 }),
      runValidatedRequest: async () => ({
        findings,
        answer: 'Model wording must not be stored.',
        chart: null,
        usage: {},
        validated: { ok: true, limitations: [], evidence: [] }
      })
    },
    user: { id: 'u', user_metadata: { prefs: { weekly_recap: true } } },
    now: new Date('2026-09-14T08:01:00Z'), leaseNow: new Date('2026-09-14T08:01:00Z'),
    dryRun: false, entitlementCheck: async () => ({ eligible: true }), logger: () => {}
  });
  assert.equal(result.status, 'generated');
  assert.equal(rpcCalls.find((call) => call.name === 'finish_weekly_recap').args.p_prose,
    'Last week (Sep 7–13) you logged 3 sessions, 1.9 hours and 13.4 km for 47 points — about an hour less than the week before.');
});

test('runner marks only model/validation failures and stops before storage when entitlement changes', async () => {
  const calls = [];
  let entitlementChecks = 0;
  const result = await runOne({
    supabase: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        if (name === 'claim_weekly_recap') return { data: { id: 'claim', attempts: 1, lease_until: 'db-lease-exact' }, error: null };
        if (name === 'fail_weekly_recap') return { data: null, error: null };
        throw new Error(`store must not happen: ${name}`);
      },
      from: () => ({ upsert: async () => ({ error: null }) })
    },
    service: {
      buildContextForUser: async () => ({ schemaVersion: 8 }),
      runValidatedRequest: async () => validRunnerOutput()
    },
    user: { id: 'u', user_metadata: { prefs: { weekly_recap: true } } },
    now: new Date('2026-03-09T08:01:00Z'),
    leaseNow: new Date('2026-03-09T08:01:00Z'),
    dryRun: false,
    entitlementCheck: async () => ({ eligible: ++entitlementChecks === 1 }),
    logger: () => {}
  });
  assert.equal(result.status, 'skipped_ineligible');
  assert.deepEqual(calls.map((call) => call.name), ['claim_weekly_recap', 'fail_weekly_recap']);
  assert.equal(calls[1].args.p_lease_until, 'db-lease-exact');

  const failedCalls = [];
  const failureLogs = [];
  const modelFailed = await runOne({
    supabase: {
      rpc: async (name, args) => {
        failedCalls.push({ name, args });
        return name === 'claim_weekly_recap'
          ? { data: { id: 'claim', attempts: 1, lease_until: 'exact-lease' }, error: null }
          : { data: null, error: null };
      },
      from: () => ({ upsert: async () => ({ error: null }) })
    },
    service: {
      buildContextForUser: async () => ({ schemaVersion: 8 }),
      runValidatedRequest: async () => ({
        validated: { ok: false, reason: 'recap_missing_required_metric' },
        findings: [], answer: '', usage: { input_tokens: 47, output_tokens: 4 }
      })
    },
    user: { id: 'u', user_metadata: { prefs: { weekly_recap: true } } },
    now: new Date('2026-03-09T08:01:00Z'), leaseNow: new Date('2026-03-09T08:01:00Z'),
    dryRun: false, entitlementCheck: async () => ({ eligible: true }), logger: (line) => failureLogs.push(JSON.parse(line))
  });
  assert.equal(modelFailed.status, 'failed');
  assert.deepEqual(failedCalls.map((call) => call.name), ['claim_weekly_recap', 'fail_weekly_recap']);
  assert.equal(failedCalls[1].args.p_lease_until, 'exact-lease');
  assert.equal(failureLogs.length, 1, 'each user has one terminal usage line');
  assert.equal(failureLogs[0].event, 'ai_insights_usage');
  assert.equal(failureLogs[0].kind, 'recap');
  assert.equal(failureLogs[0].reason, 'recap_missing_required_metric');
  assert.equal(failureLogs[0].input_tokens, 47, 'validation failures retain provider usage');
});

test('generated notification failure is recovered idempotently without another model invocation', async () => {
  let serviceCalls = 0;
  let notificationWrites = 0;
  let failFirstNotification = true;
  const from = (table) => {
    if (table === 'weekly_recaps') {
      return {
        select() { return this; }, eq() { return this; },
        limit: async () => ({ data: [{ user_id: 'u', week_start: '2026-03-02' }], error: null })
      };
    }
    if (table === 'notifications') {
      return {
        select() { return this; }, eq() { return this; },
        limit: async () => ({ data: [], error: null }),
        upsert: async () => {
          notificationWrites++;
          return { error: failFirstNotification ? { message: 'temporary notification outage' } : null };
        }
      };
    }
    throw new Error(`unexpected table ${table}`);
  };
  const supabase = {
    rpc: async (name) => {
      if (name === 'claim_weekly_recap') return { data: { id: 'claim', attempts: 1, lease_until: 'exact-lease' }, error: null };
      if (name === 'finish_weekly_recap') return { data: { id: 'stored' }, error: null };
      throw new Error(`unexpected rpc ${name}`);
    },
    from
  };
  const one = await runOne({
    supabase,
    service: {
      buildContextForUser: async () => ({ schemaVersion: 8 }),
      runValidatedRequest: async () => { serviceCalls++; return validRunnerOutput(); }
    },
    user: { id: 'u', user_metadata: { prefs: { weekly_recap: true } } },
    now: new Date('2026-03-09T08:01:00Z'), leaseNow: new Date('2026-03-09T08:01:00Z'),
    dryRun: false, entitlementCheck: async () => ({ eligible: true }), logger: () => {}
  });
  assert.equal(one.status, 'notification_failed');
  failFirstNotification = false;
  const recovered = await recoverGeneratedNotifications(supabase, () => {}, async () => ({ eligible: true }));
  assert.equal(recovered[0].status, 'notified');
  assert.equal(serviceCalls, 1);
  assert.equal(notificationWrites, 2);
});

test('entitlement reads require current opt-in and Pro, and retention RPC has zero arguments', async () => {
  const user = { id: 'u', user_metadata: { prefs: { weekly_recap: true } } };
  const supabase = {
    auth: { admin: { getUserById: async () => ({ data: { user }, error: null }) } },
    from: (table) => {
      assert.equal(table, 'subscriptions');
      return {
        select() { return this; }, eq() { return this; }, in() { return this; },
        order() { return this; }, range: async () => ({ data: [{ owner_id: 'u' }], error: null })
      };
    }
  };
  assert.equal((await recheckRecapEntitlement(supabase, 'u')).eligible, true);
  const rpcArgs = [];
  await sweepExpiredWeeklyRecaps({ rpc: async (name, args) => { rpcArgs.push({ name, args }); return { data: 0, error: null }; } });
  assert.deepEqual(rpcArgs, [{ name: 'delete_expired_weekly_recaps', args: undefined }]);
});

test('runner dry-run has no claim, notification, recap, or retention writes', async () => {
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    user_metadata: { prefs: { weekly_recap: true } }
  };
  let rpcCalls = 0;
  const output = [];
  const subscriptionQuery = {
    select() { return this; }, eq() { return this; }, in() { return this; },
    order() { return this; }, range: async () => ({ data: [{ owner_id: user.id }], error: null })
  };
  const result = await main(['--dry-run', '--now', '2026-03-09T08:01:00Z'], {
    supabase: {
      auth: { admin: {
        listUsers: async () => ({ data: { users: [user] }, error: null }),
        getUserById: async () => ({ data: { user }, error: null })
      } },
      from: (table) => {
        assert.equal(table, 'subscriptions', 'dry run must not inspect recap or notification write paths');
        return subscriptionQuery;
      },
      rpc: async () => { rpcCalls++; return { error: null }; }
    },
    service: {
      buildContextForUser: async () => ({ schemaVersion: 8 }),
      runValidatedRequest: async () => validRunnerOutput()
    },
    logger: (line) => output.push(JSON.parse(line))
  });
  assert.equal(result.results[0].status, 'dry_run_validated');
  assert.equal(rpcCalls, 0);
  assert.equal(output.filter((line) => line.event === 'ai_insights_usage').length, 1);
  assert.equal(output.at(-1).event, 'weekly_recap_dry_run_result');
  assert.equal(output.at(-1).results[0].validated.ok, true);
});

test('default eligibility filters generated, exhausted, and live leases before applying the 50-user batch cap', async () => {
  const now = new Date('2026-03-09T15:01:00Z');
  const users = Array.from({ length: 53 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    user_metadata: {
      timezone: index === 50 ? 'America/Los_Angeles' : 'UTC',
      prefs: { weekly_recap: true }
    }
  }));
  const generated = users.slice(0, 50).map((user) => ({
    user_id: user.id, week_start: recapWindowFor(user, now).weekStart,
    status: 'generated', attempts: 1, lease_until: null
  }));
  // This is deliberately a different completed week for an LA athlete; it
  // must not suppress the current local-week candidate.
  generated.push({
    user_id: users[50].id, week_start: '2026-02-23',
    status: 'generated', attempts: 1, lease_until: null
  });
  generated.push({
    user_id: users[51].id, week_start: recapWindowFor(users[51], now).weekStart,
    status: 'failed', attempts: 3, lease_until: null
  });
  generated.push({
    user_id: users[52].id, week_start: recapWindowFor(users[52], now).weekStart,
    status: 'pending', attempts: 1, lease_until: '2099-01-01T00:00:00.000Z'
  });
  const supabase = {
    auth: { admin: {
      listUsers: async () => ({ data: { users }, error: null }),
      getUserById: async (id) => ({ data: { user: users.find((user) => user.id === id) || null }, error: null })
    } },
    from: (table) => {
      if (table === 'subscriptions') {
        return {
          select() { return this; }, eq() { return this; }, in() { return this; },
          order() { return this; }, range: async () => ({ data: users.map((user) => ({ owner_id: user.id })), error: null })
        };
      }
      if (table === 'weekly_recaps') {
        return {
          select() { return this; },
          in(column, values) {
            if (column === 'user_id') {
              this.ids = values;
              assert.ok(values.length <= 100);
              return this;
            }
            assert.equal(column, 'week_start');
            assert.ok(values.length <= 100, 'only relevant local week keys are requested');
            return Promise.resolve({
              data: generated.filter((row) => this.ids.includes(row.user_id) && values.includes(row.week_start)),
              error: null
            });
          }
        };
      }
      throw new Error(`unexpected table ${table}`);
    }
  };
  const eligible = await eligibleUsers(supabase, { userId: null, dryRun: false }, now);
  assert.deepEqual(eligible.map((user) => user.id), [users[50].id],
    'first 50 generated rows cannot starve later current-week candidates');
  const dryRunEligible = await eligibleUsers(supabase, { userId: null, dryRun: true }, now);
  assert.equal(dryRunEligible.length, 50, 'dry-run deliberately permits already-generated candidates');
  const forced = await eligibleUsers(supabase, { userId: users[0].id, dryRun: false }, now);
  assert.deepEqual(forced.map((user) => user.id), [users[0].id], '--user-id deliberately bypasses existing-row filtering');
});

test('subscription discovery paginates beyond the first 1,000 records with a stable range query', async () => {
  const ranges = [];
  const firstPage = Array.from({ length: 1000 }, (_, index) => ({ owner_id: `user-${index}` }));
  const subscriptions = await listIndividualProSubscriptions({
    from: (table) => {
      assert.equal(table, 'subscriptions');
      return {
        select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; },
        range: async (from, to) => {
          ranges.push([from, to]);
          return { data: from === 0 ? firstPage : [{ owner_id: 'user-1000' }], error: null };
        }
      };
    }
  });
  assert.equal(subscriptions.length, 1001);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999]]);
});

test('a recovered generated recap is not processed again as a default eligible-user skip', async () => {
  const user = {
    id: '00000000-0000-4000-8000-000000000099',
    user_metadata: { prefs: { weekly_recap: true } }
  };
  const now = new Date('2026-03-09T08:01:00Z');
  const weekStart = recapWindowFor(user, now).weekStart;
  const logs = [];
  const supabase = {
    auth: { admin: {
      listUsers: async () => ({ data: { users: [user] }, error: null }),
      getUserById: async () => ({ data: { user }, error: null })
    } },
    rpc: async (name) => {
      assert.equal(name, 'delete_expired_weekly_recaps');
      return { data: 0, error: null };
    },
    from: (table) => {
      if (table === 'subscriptions') {
        return {
          select() { return this; }, eq() { return this; }, in() { return this; },
          order() { return this; }, range: async () => ({ data: [{ owner_id: user.id }], error: null })
        };
      }
      if (table === 'weekly_recaps') {
        return {
          select() { return this; },
          eq(column, value) {
            if (column === 'email_status' && value === 'pending') this.emailQuery = true;
            return this;
          },
          lt() { return this; },
          order() { return this; },
          range: async () => this.emailQuery ? ({ data: [], error: null }) : ({ data: [], error: null }),
          in(column) {
            if (!this.ids) {
              assert.equal(column, 'user_id');
              this.ids = true;
              return this;
            }
            assert.equal(column, 'week_start');
            return Promise.resolve({
              data: [{ user_id: user.id, week_start: weekStart, status: 'generated', attempts: 1 }],
              error: null
            });
          },
          limit: async () => ({ data: [{ user_id: user.id, week_start: weekStart }], error: null })
        };
      }
      if (table === 'notifications') {
        return {
          select() { return this; }, eq() { return this; },
          limit: async () => ({ data: [{ id: 'already-notified' }], error: null })
        };
      }
      throw new Error(`unexpected table ${table}`);
    }
  };
  const result = await main(['--now', '2026-03-09T08:01:00Z'], {
    supabase, service: { runValidatedRequest: async () => { throw new Error('must not generate'); } },
    logger: (line) => logs.push(JSON.parse(line))
  });
  assert.deepEqual(result.results, []);
  assert.equal(result.recoveries[0].status, 'already_notified');
  assert.equal(logs.filter((line) => line.event === 'ai_insights_usage').length, 1);
});

test('claimed infrastructure failures best-effort fail with the exact lease and preserve the original error', async () => {
  const scenarios = [
    {
      name: 'context',
      expectedCalls: ['claim_weekly_recap', 'fail_weekly_recap'],
      reason: 'context_build_failed',
      service: { buildContextForUser: async () => { throw new Error('context outage'); } },
      entitlementCheck: async () => ({ eligible: true })
    },
    {
      name: 'prestore entitlement',
      expectedCalls: ['claim_weekly_recap', 'fail_weekly_recap'],
      reason: 'prestore_entitlement_recheck_failed',
      service: { buildContextForUser: async () => ({ schemaVersion: 8 }), runValidatedRequest: async () => validRunnerOutput() },
      entitlementCheck: (() => {
        let checks = 0;
        return async () => {
          checks++;
          if (checks === 2) throw new Error('entitlement read outage');
          return { eligible: true };
        };
      })()
    },
    {
      name: 'finish',
      expectedCalls: ['claim_weekly_recap', 'finish_weekly_recap', 'fail_weekly_recap'],
      reason: 'finish_rpc_failed',
      service: { buildContextForUser: async () => ({ schemaVersion: 8 }), runValidatedRequest: async () => validRunnerOutput() },
      entitlementCheck: async () => ({ eligible: true })
    },
    {
      name: 'context fail recording',
      expectedCalls: ['claim_weekly_recap', 'fail_weekly_recap'],
      reason: 'context_build_failed_fail_recording_failed',
      failureReason: 'context_build_failed',
      failRpcError: true,
      service: { buildContextForUser: async () => { throw new Error('context outage'); } },
      entitlementCheck: async () => ({ eligible: true })
    }
  ];
  for (const scenario of scenarios) {
    const calls = [];
    const logs = [];
    const original = scenario.name === 'finish' ? 'finish outage' :
      scenario.name.startsWith('context') ? 'context outage' : 'entitlement read outage';
    const supabase = {
      rpc: async (name, args) => {
        calls.push({ name, args });
        if (name === 'claim_weekly_recap') {
          return { data: { id: 'claim', attempts: 1, lease_until: 'lease-returned-by-db' }, error: null };
        }
        if (name === 'finish_weekly_recap') return { data: null, error: { message: 'finish outage' } };
        if (name === 'fail_weekly_recap') return { data: null, error: scenario.failRpcError ? { message: 'fail RPC outage' } : null };
        throw new Error(`unexpected rpc ${name}`);
      },
      from: () => ({ upsert: async () => ({ error: null }) })
    };
    await assert.rejects(
      runOne({
        supabase, service: scenario.service,
        user: { id: 'u', user_metadata: { prefs: { weekly_recap: true } } },
        now: new Date('2026-03-09T08:01:00Z'), leaseNow: new Date('2026-03-09T08:01:00Z'),
        dryRun: false, entitlementCheck: scenario.entitlementCheck,
        logger: (line) => logs.push(JSON.parse(line))
      }),
      new RegExp(original)
    );
    assert.deepEqual(calls.map((call) => call.name), scenario.expectedCalls, scenario.name);
    const failureCall = calls.at(-1);
    assert.equal(failureCall.args.p_lease_until, 'lease-returned-by-db', scenario.name);
    assert.equal(failureCall.args.p_failure_reason, scenario.failureReason || scenario.reason, scenario.name);
    assert.equal(logs.length, 1, scenario.name);
    assert.deepEqual(
      { event: logs[0].event, status: logs[0].status, reason: logs[0].reason },
      { event: 'ai_insights_usage', status: 'infrastructure_failure', reason: scenario.reason },
      scenario.name
    );
  }
});

test('provider configuration failures are infrastructure failures, not per-user model failures', async () => {
  const calls = [];
  const logs = [];
  const configurationError = new AiProviderConfigurationError('direct key missing');
  await assert.rejects(
    runOne({
      supabase: {
        rpc: async (name, args) => {
          calls.push({ name, args });
          if (name === 'claim_weekly_recap') {
            return { data: { id: 'claim', attempts: 1, lease_until: 'lease-returned-by-db' }, error: null };
          }
          if (name === 'fail_weekly_recap') return { data: null, error: null };
          throw new Error(`unexpected rpc ${name}`);
        },
        from: () => ({ upsert: async () => ({ error: null }) })
      },
      service: {
        buildContextForUser: async () => ({ schemaVersion: 8 }),
        runValidatedRequest: async () => { throw configurationError; }
      },
      user: { id: 'u', user_metadata: { prefs: { weekly_recap: true } } },
      now: new Date('2026-03-09T08:01:00Z'), leaseNow: new Date('2026-03-09T08:01:00Z'),
      dryRun: false, entitlementCheck: async () => ({ eligible: true }),
      logger: (line) => logs.push(JSON.parse(line))
    }),
    configurationError
  );
  assert.deepEqual(calls.map((call) => call.name), ['claim_weekly_recap', 'fail_weekly_recap']);
  assert.equal(calls[1].args.p_lease_until, 'lease-returned-by-db');
  assert.equal(calls[1].args.p_failure_reason, 'provider_configuration_failed');
  assert.deepEqual(
    { event: logs[0].event, status: logs[0].status, reason: logs[0].reason },
    { event: 'ai_insights_usage', status: 'infrastructure_failure', reason: 'provider_configuration_failed' }
  );
  assert.equal(logs.length, 1);
});