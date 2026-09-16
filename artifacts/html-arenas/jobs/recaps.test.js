'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const {
  SOFT_RUNTIME_LIMIT_MS, HARD_RUNTIME_LIMIT_MS, HARD_RUNTIME_HEADROOM_MS,
  createRuntimeBudget, missingRunnerEnvironment, runCli, emitSummary,
  processPendingRecapEmails, main, runOne
} = require('./recaps');
const { sweepExpiredWeeklyRecaps } = require('../weekly-recaps');

function configuredEnvironment(overrides = {}) {
  return {
    RECAP_RUNNER_ENABLED: 'true',
    SUPABASE_URL: 'https://supabase.example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-only',
    RESEND_API_KEY: 'resend-test-only',
    SESSION_SECRET: 'session-secret-test-only',
    PUBLIC_BASE_URL: 'https://www.realarenas.com',
    ANTHROPIC_API_KEY: 'anthropic-test-only',
    ...overrides
  };
}

function pendingEmailSupabase(rows) {
  return {
    from: () => ({
      select() { return this; }, eq() { return this; }, lt() { return this; },
      order() { return this; },
      range: async () => ({ data: rows, error: null })
    })
  };
}

function recapUser() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    user_metadata: { prefs: { weekly_recap: true } }
  };
}

function validRecapOutput(usage = { input_tokens: 1000, output_tokens: 500 }) {
  return {
    validated: { ok: true, limitations: [], evidence: [] },
    findings: [],
    answer: 'A completed recap.',
    usage
  };
}

function generationSupabase({ storeError = false } = {}) {
  return {
    rpc: async (name) => {
      if (name === 'claim_weekly_recap') {
        return {
          data: {
            id: 'claim-id',
            lease_until: '2030-01-01T00:10:00.000Z',
            attempts: 1
          },
          error: null
        };
      }
      if (name === 'finish_weekly_recap') {
        return storeError
          ? { data: null, error: { message: 'store failed' } }
          : {
            data: {
              id: 'stored-id',
              status: 'generated',
              email_status: 'pending'
            },
            error: null
          };
      }
      if (name === 'fail_weekly_recap') return { data: null, error: null };
      throw new Error(`unexpected RPC ${name}`);
    }
  };
}

test('kill switch is checked before parsing flags or touching a database', async () => {
  let databaseCalls = 0;
  const logs = [];
  const code = await runCli(['--unknown-flag'], {
    env: { RECAP_RUNNER_ENABLED: 'false' },
    supabase: {
      rpc: async () => { databaseCalls++; },
      from: () => { databaseCalls++; }
    },
    logger: (line) => logs.push(JSON.parse(line))
  });
  assert.equal(code, 0);
  assert.equal(databaseCalls, 0);
  assert.deepEqual(logs, [{ event: 'weekly_recap_runner', status: 'disabled' }]);
});

test('enabled runner preflight reports missing names and accepts either existing AI provider', async () => {
  const missing = missingRunnerEnvironment(configuredEnvironment({
    RESEND_API_KEY: '',
    ANTHROPIC_API_KEY: ''
  }));
  assert.ok(missing.includes('RESEND_API_KEY'));
  assert.ok(missing.some((name) => name.includes('ANTHROPIC_API_KEY')));

  const proxyEnvironment = configuredEnvironment({
    ANTHROPIC_API_KEY: '',
    AI_INTEGRATIONS_ANTHROPIC_API_KEY: 'proxy-test-only',
    AI_INTEGRATIONS_ANTHROPIC_BASE_URL: 'https://ai-proxy.example.test'
  });
  assert.deepEqual(missingRunnerEnvironment(proxyEnvironment), []);

  const logs = [];
  const code = await runCli([], {
    env: configuredEnvironment({ RESEND_API_KEY: '' }),
    logger: (line) => logs.push(JSON.parse(line)),
    supabase: { rpc: async () => { throw new Error('must not reach DB'); } }
  });
  assert.equal(code, 2);
  assert.equal(logs[0].status, 'configuration_failure');
  assert.deepEqual(logs[0].missing, ['RESEND_API_KEY']);

  const railwayProxyOnly = configuredEnvironment({
    ANTHROPIC_API_KEY: '',
    AI_INTEGRATIONS_ANTHROPIC_API_KEY: 'proxy-test-only',
    AI_INTEGRATIONS_ANTHROPIC_BASE_URL: 'https://ai-proxy.example.test',
    RAILWAY_ENVIRONMENT: 'production'
  });
  let databaseCalls = 0;
  const railwayLogs = [];
  const railwayCode = await runCli([], {
    env: railwayProxyOnly,
    supabase: { rpc: async () => { databaseCalls++; } },
    logger: (line) => railwayLogs.push(JSON.parse(line))
  });
  assert.equal(railwayCode, 2);
  assert.equal(databaseCalls, 0);
  assert.deepEqual(railwayLogs[0].missing, ['ANTHROPIC_API_KEY']);
});

test('runtime budget uses monotonic time and stops new email work after the soft limit', async () => {
  let time = 1000;
  const runtime = createRuntimeBudget({
    monotonicNow: () => time,
    startedAt: '2026-09-14T08:00:00.000Z',
    tickId: 'tick-test'
  });
  assert.equal(runtime.pastSoftLimit(), false);
  time += SOFT_RUNTIME_LIMIT_MS + 1;
  assert.equal(runtime.pastSoftLimit(), true);

  let sends = 0;
  const results = await processPendingRecapEmails({
    from: () => ({
      select() { return this; }, eq() { return this; }, lt() { return this; },
      order() { return this; },
      range: async () => ({
        data: [{ id: 'pending', status: 'generated', email_status: 'pending' }],
        error: null
      })
    })
  }, {
    shouldContinue: () => !runtime.pastSoftLimit(),
    emailDelivery: async () => { sends++; return { status: 'sent', attempted: true }; },
    logger: () => {}
  });
  assert.equal(sends, 0);
  assert.deepEqual(results, []);
});

test('email batch passes the validated runner origin for first renders', async () => {
  let receivedOrigin;
  const results = await processPendingRecapEmails({
    from: () => ({
      select() { return this; }, eq() { return this; }, lt() { return this; },
      order() { return this; },
      range: async () => ({
        data: [{ id: 'pending', status: 'generated', email_status: 'pending' }],
        error: null
      })
    })
  }, {
    origin: 'https://www.realarenas.com',
    emailDelivery: async (options) => {
      receivedOrigin = options.origin;
      return { status: 'dry_run', attempted: false };
    },
    logger: () => {}
  });
  assert.equal(receivedOrigin, 'https://www.realarenas.com');
  assert.equal(results[0].status, 'dry_run');
});

test('email summary counts completed rows before a later delivery infrastructure throw', async () => {
  const runtime = createRuntimeBudget({ monotonicNow: () => 0 });
  const logs = [];
  let deliveries = 0;
  await assert.rejects(
    main(['--send-emails-only'], {
      env: configuredEnvironment(),
      runtime,
      supabase: pendingEmailSupabase([
        { id: 'first', status: 'generated', email_status: 'pending' },
        { id: 'second', status: 'generated', email_status: 'pending' }
      ]),
      emailDelivery: async () => {
        deliveries++;
        if (deliveries === 1) return { status: 'sent', attempted: true };
        throw new Error('email status read failed');
      },
      wait: async () => {},
      logger: (line) => logs.push(JSON.parse(line))
    }),
    /email status read failed/
  );
  const summary = logs.find((line) => line.event === 'weekly_recap_tick_summary');
  assert.equal(summary.emails_sent, 1);
  assert.equal(summary.emails_failed, 0);
});

test('watchdog summary keeps the first email when the next delivery hangs', async () => {
  let watchdog;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const logs = [];
  let exitCode = null;
  let deliveries = 0;
  const run = runCli(['--send-emails-only'], {
    env: configuredEnvironment(),
    supabase: pendingEmailSupabase([
      { id: 'first', status: 'generated', email_status: 'pending' },
      { id: 'second', status: 'generated', email_status: 'pending' }
    ]),
    emailDelivery: async () => {
      deliveries++;
      if (deliveries === 1) return { status: 'sent', attempted: true };
      await gate;
      return { status: 'sent', attempted: true };
    },
    wait: async () => {},
    logger: (line) => logs.push(JSON.parse(line)),
    processUptime: () => 0,
    setTimeout: (callback, delay) => {
      assert.equal(delay, HARD_RUNTIME_LIMIT_MS - HARD_RUNTIME_HEADROOM_MS);
      watchdog = callback;
      return 'watchdog';
    },
    clearTimeout: () => {},
    exit: (code) => { exitCode = code; }
  });
  await new Promise((resolve) => setImmediate(resolve));
  watchdog();
  release();
  assert.equal(await run, 0);
  assert.equal(exitCode, 0);
  const summaries = logs.filter((line) => line.event === 'weekly_recap_tick_summary');
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].emails_sent, 1);
});

test('provider usage is counted before a durable store failure', async () => {
  const runtime = createRuntimeBudget({ monotonicNow: () => 0 });
  const usageCalls = [];
  await assert.rejects(
    runOne({
      supabase: generationSupabase({ storeError: true }),
      service: {
        buildContextForUser: async () => ({ schemaVersion: 'test' }),
        runValidatedRequest: async () => validRecapOutput()
      },
      user: recapUser(),
      now: new Date('2026-09-14T12:00:00.000Z'),
      dryRun: false,
      leaseNow: new Date('2026-09-14T12:00:00.000Z'),
      entitlementCheck: async () => ({ eligible: true, user: recapUser() }),
      logger: () => {},
      onUsage: (usage) => {
        usageCalls.push(usage);
        runtime.counters.provider_cost_usd += usage.estimated_cost_usd;
      }
    }),
    /store failed/
  );
  const logs = [];
  emitSummary(runtime, (line) => logs.push(JSON.parse(line)));
  assert.equal(usageCalls.length, 1);
  assert.ok(logs[0].provider_cost_usd > 0);
});

test('generated summary counts a durable row before post-store entitlement failure', async () => {
  const runtime = createRuntimeBudget({ monotonicNow: () => 0 });
  let entitlementChecks = 0;
  await assert.rejects(
    runOne({
      supabase: generationSupabase(),
      service: {
        buildContextForUser: async () => ({ schemaVersion: 'test' }),
        runValidatedRequest: async () => validRecapOutput()
      },
      user: recapUser(),
      now: new Date('2026-09-14T12:00:00.000Z'),
      dryRun: false,
      leaseNow: new Date('2026-09-14T12:00:00.000Z'),
      entitlementCheck: async () => {
        entitlementChecks++;
        if (entitlementChecks === 3) throw new Error('post-store entitlement failed');
        return { eligible: true, user: recapUser() };
      },
      logger: () => {},
      onGenerated: () => { runtime.counters.generated++; }
    }),
    /post-store entitlement failed/
  );
  const logs = [];
  emitSummary(runtime, (line) => logs.push(JSON.parse(line)));
  assert.equal(entitlementChecks, 3);
  assert.equal(logs[0].generated, 1);
});

test('summary line has the complete aggregate shape and provider cost total', () => {
  let time = 10;
  const runtime = createRuntimeBudget({
    monotonicNow: () => time,
    startedAt: '2026-09-14T08:00:00.000Z',
    tickId: 'tick-test'
  });
  runtime.counters.eligible = 2;
  runtime.counters.generated = 1;
  runtime.counters.generation_failed = 1;
  runtime.counters.emails_sent = 1;
  runtime.counters.emails_skipped = 1;
  runtime.counters.emails_failed = 0;
  runtime.counters.retention_deleted = 3;
  runtime.counters.provider_cost_usd = 0.0042;
  time += 17;
  const logs = [];
  emitSummary(runtime, (line) => logs.push(JSON.parse(line)));
  assert.deepEqual(logs[0], {
    event: 'weekly_recap_tick_summary',
    kind: 'recap',
    tick_id: 'tick-test',
    started_at: '2026-09-14T08:00:00.000Z',
    duration_ms: 17,
    eligible: 2,
    generated: 1,
    generation_failed: 1,
    emails_sent: 1,
    emails_skipped: 1,
    emails_failed: 0,
    retention_deleted: 3,
    provider_cost_usd: 0.0042
  });
});

test('retention count contract rejects missing or malformed RPC counts', async () => {
  for (const data of [undefined, null, '0', -1, 1.5]) {
    await assert.rejects(
      sweepExpiredWeeklyRecaps({
        rpc: async () => ({ data, error: null })
      }),
      /invalid deletion count/
    );
  }
  assert.equal(await sweepExpiredWeeklyRecaps({
    rpc: async () => ({ data: 0, error: null })
  }), 0);
});

test('hard watchdog emits a summary and exits zero while a tick promise is still hung', async () => {
  let watchdog;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const logs = [];
  let exitCode = null;
  const run = runCli([], {
    env: configuredEnvironment(),
    logger: (line) => logs.push(JSON.parse(line)),
    startedAt: '2026-09-14T08:00:00.000Z',
    processUptime: () => 0,
    setTimeout: (callback, delay) => {
      assert.equal(delay, HARD_RUNTIME_LIMIT_MS - HARD_RUNTIME_HEADROOM_MS);
      watchdog = callback;
      return 'watchdog';
    },
    clearTimeout: () => {},
    exit: (code) => { exitCode = code; },
    runMain: async () => gate
  });
  await new Promise((resolve) => setImmediate(resolve));
  watchdog();
  release();
  assert.equal(await run, 0);
  assert.equal(exitCode, 0);
  assert.equal(logs.at(-1).event, 'weekly_recap_tick_summary');
});

test('CLI watchdog subtracts startup uptime, reserves headroom, and ignores limit env overrides', async () => {
  const bootstrapSeconds = 1.234;
  let observedDelay = null;
  const code = await runCli([], {
    env: configuredEnvironment({
      RECAP_HARD_RUNTIME_LIMIT_MS: '1',
      RECAP_RUNNER_HARD_TIMEOUT_MS: '1'
    }),
    processUptime: () => bootstrapSeconds,
    setTimeout: (callback, delay) => {
      observedDelay = delay;
      return 'watchdog';
    },
    clearTimeout: () => {},
    runMain: async () => {}
  });
  const bootstrapMs = Math.ceil(bootstrapSeconds * 1000);
  assert.equal(code, 0);
  assert.equal(
    observedDelay,
    HARD_RUNTIME_LIMIT_MS - HARD_RUNTIME_HEADROOM_MS - bootstrapMs
  );
  assert.ok(observedDelay <= 299000 - bootstrapMs);
});

test('child-process watchdog path can be accelerated without waiting five minutes', () => {
  const script = [
    "const { runCli } = require('./jobs/recaps');",
    `const env = ${JSON.stringify(configuredEnvironment())};`,
    "let release; const gate = new Promise((resolve) => { release = resolve; });",
    "runCli([], { env, setTimeout: (cb) => { setImmediate(() => { cb(); release(); }); return 1; },",
    "  clearTimeout: () => {}, exit: (code) => console.log(JSON.stringify({ exit: code })),",
    "  runMain: async () => gate }).then((code) => console.log(JSON.stringify({ code })));"
  ].join(' ');
  const child = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 2000
  });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /weekly_recap_tick_summary/);
  assert.match(child.stdout, /"exit":0/);
  assert.match(child.stdout, /"code":0/);
});

test('fatal unhandled rejection is redacted and exits one', () => {
  const script = [
    "const { installFatalHandlers } = require('./jobs/recaps');",
    "installFatalHandlers();",
    "Promise.reject(new Error('secret database URL and key'));"
  ].join(' ');
  const child = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8'
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /"status":"fatal"/);
  assert.equal(child.stderr.includes('secret database URL'), false);
});