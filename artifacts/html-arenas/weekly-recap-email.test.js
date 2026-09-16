'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const {
  RECAP_EMAIL_RETRY_WINDOW_REASON,
  RECAP_EMAIL_RETRY_WINDOW_MS,
  recapEmailEnabled,
  deliverySnapshot,
  makeDeliverySnapshot,
  persistDeliverySnapshot,
  expireRetryWindow,
  deliverWeeklyRecapEmail
} = require('./weekly-recap-email');
const {
  listPendingRecapEmails, processPendingRecapEmails, recheckRecapEmailEntitlement, main,
  redactRecapEmailDryRunText
} = require('./jobs/recaps');

const recap = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: '22222222-2222-4222-8222-222222222222',
  status: 'generated',
  email_status: 'pending',
  email_attempts: 0,
  week_start: '2026-09-07',
  timezone: 'America/Los_Angeles',
  created_at: '2026-09-14T06:55:00.000Z',
  generated_at: '2026-09-14T07:00:00.000Z',
  prose: 'Stored recap prose.',
  findings: {
    findings: [],
    evidence: [
      { path: 'last12Weeks.weekly.10.activityCount', value: 3 },
      { path: 'last12Weeks.weekly.10.durationHours', value: 1.9 }
    ],
    limitations: []
  },
  chart: null
};
const user = { id: recap.user_id, email: 'athlete@example.test', user_metadata: { prefs: { weekly_recap: true, weekly_recap_email: true } } };
const render = () => ({ subject: 'Stored subject', html: '<p>stored</p>', text: 'stored' });
const signToken = (id, issuedAt) => `token-${id}-${issuedAt}`;

function queryResult(data) {
  return {
    select() { return this; },
    eq() { return this; },
    is() { return this; },
    limit: async () => ({ data, error: null })
  };
}

test('delivery snapshot freezes payload and stable key from the stored recap', () => {
  let settingsUrl;
  const captureSettings = (row, ignoredUser, links) => {
    settingsUrl = links.settingsUrl;
    return render(row, ignoredUser, links);
  };
  const one = makeDeliverySnapshot(recap, user, { render: captureSettings, signToken });
  const two = makeDeliverySnapshot({ ...recap }, { ...user, email: 'changed@example.test' }, { render, signToken });
  assert.equal(one.idempotencyKey, `weekly-recap-email:${recap.id}`);
  assert.match(one.payload, /athlete@example\.test/);
  assert.equal(one.payload.includes('changed@example.test'), false);
  assert.equal(settingsUrl, 'https://www.realarenas.com/profile?tab=settings');
  // Once saved, a retry reads the old immutable snapshot instead of rerendering.
  const stored = { ...recap, findings: { ...recap.findings, emailDelivery: one } };
  assert.equal(deliverySnapshot(stored).payload, one.payload);
  assert.notEqual(two.payload, one.payload, 'initial snapshot captures recipient exactly once');
});

test('snapshot persistence has one CAS winner and a loser uses that exact payload', async () => {
  const snapshot = makeDeliverySnapshot(recap, user, { render, signToken });
  let stored = { ...recap, findings: { ...recap.findings, emailDelivery: snapshot } };
  let updates = 0;
  const supabase = {
    from: () => {
      const query = {
        wrote: false,
        update() { updates++; this.wrote = true; return this; },
        eq() { return this; },
        is() { return this; },
        select() {
          return this.wrote
            ? Promise.resolve({ data: updates === 1 ? [stored] : [], error: null })
            : this;
        },
        limit: async () => ({ data: [stored], error: null })
      };
      return query;
    }
  };
  const loserInput = { ...recap, findings: { ...recap.findings } };
  const winnerInput = { ...recap, findings: { ...recap.findings } };
  const [winner, loser] = await Promise.all([
    persistDeliverySnapshot(supabase, winnerInput, snapshot),
    persistDeliverySnapshot(supabase, loserInput, makeDeliverySnapshot(recap, user, {
      render: () => ({ subject: 'different', html: '<p>different</p>', text: 'different' }), signToken
    }))
  ]);
  assert.equal(winner.snapshot.payload, snapshot.payload);
  assert.equal(loser.snapshot.payload, snapshot.payload);
  assert.equal(updates, 2);
});

test('each delivery eligibility guard skips without a send', async () => {
  for (const [reason, entitlement] of [
    ['account_missing', { eligible: false, reason: 'account_missing', user: null }],
    ['recap_preference_disabled', { eligible: false, reason: 'recap_preference_disabled', user }],
    ['email_preference_disabled', { eligible: false, reason: 'email_preference_disabled', user }],
    ['pro_required', { eligible: false, reason: 'pro_required', user }]
  ]) {
    let sends = 0;
    const result = await deliverWeeklyRecapEmail({
      supabase: {}, recap, correlationId: 'c', dryRun: true, logger: () => {},
      entitlementCheck: async () => entitlement,
      sender: async () => { sends++; return { ok: true, id: 'message' }; }
    });
    assert.equal(result.status, 'skipped', reason);
    assert.equal(result.reason, reason);
    assert.equal(sends, 0);
  }
});

test('email entitlement classifies a missing account, either preference, and Pro correctly', async () => {
  const candidate = (emailUser, subscriptions = [{ owner_id: recap.user_id }], userError = null) => ({
    auth: { admin: { getUserById: async () => ({ data: { user: emailUser }, error: userError }) } },
    from: () => ({
      select() { return this; }, eq() { return this; }, in() { return this; },
      order() { return this; }, range: async () => ({ data: subscriptions, error: null })
    })
  });
  assert.equal((await recheckRecapEmailEntitlement(candidate(null), recap.user_id)).reason, 'account_missing');
  assert.equal((await recheckRecapEmailEntitlement(candidate({ ...user, user_metadata: { prefs: { weekly_recap: false, weekly_recap_email: true } } }), recap.user_id)).reason, 'recap_preference_disabled');
  assert.equal((await recheckRecapEmailEntitlement(candidate({ ...user, user_metadata: { prefs: { weekly_recap: true, weekly_recap_email: false } } }), recap.user_id)).reason, 'email_preference_disabled');
  assert.equal((await recheckRecapEmailEntitlement(candidate(user, []), recap.user_id)).reason, 'pro_required');
  assert.equal((await recheckRecapEmailEntitlement(candidate(null, [], { status: 404, message: 'User not found' }), recap.user_id)).reason, 'account_missing');
  assert.equal((await recheckRecapEmailEntitlement(candidate({
    ...user, user_metadata: { prefs: { weekly_recap: true } }
  }), recap.user_id)).eligible, true, 'missing dependent preference honors default true');
  assert.equal(recapEmailEnabled({ user_metadata: { prefs: { weekly_recap: true } } }), true);
});

test('expired retry window marks the generated pending row failed until terminal', async () => {
  const snapshot = makeDeliverySnapshot(recap, user, { render, signToken });
  let row = {
    ...recap, email_attempts: 1,
    findings: { ...recap.findings, emailDelivery: snapshot }
  };
  const reasons = [];
  const supabase = {
    from: () => queryResult([row]),
    rpc: async (name, args) => {
      if (name === 'begin_weekly_recap_email_attempt') return { data: { id: null }, error: null };
      assert.equal(name, 'mark_weekly_recap_email');
      assert.equal(args.p_failure_reason, RECAP_EMAIL_RETRY_WINDOW_REASON);
      reasons.push(args.p_failure_reason);
      row = {
        ...row,
        email_attempts: row.email_attempts + 1,
        email_status: row.email_attempts + 1 < 3 ? 'pending' : 'failed'
      };
      return { data: row, error: null };
    }
  };
  const result = await deliverWeeklyRecapEmail({
    supabase, recap: row, correlationId: 'c', logger: () => {},
    entitlementCheck: async () => ({ eligible: true, user }),
    sender: async () => { throw new Error('must not send after begin no-op'); }
  });
  assert.equal(result.reason, RECAP_EMAIL_RETRY_WINDOW_REASON);
  assert.equal(row.email_status, 'failed');
  assert.deepEqual(reasons, [RECAP_EMAIL_RETRY_WINDOW_REASON, RECAP_EMAIL_RETRY_WINDOW_REASON]);
});

test('expiry helper does not overwrite a concurrent sent state', async () => {
  const sent = { ...recap, email_status: 'sent', email_attempts: 1 };
  const supabase = {
    from: () => queryResult([sent]),
    rpc: async () => { throw new Error('must not mark a sent row'); }
  };
  const final = await expireRetryWindow(supabase, recap.id);
  assert.equal(final.email_status, 'sent');
});

test('two concurrent runners submit one byte-identical idempotent delivery', async () => {
  const snapshot = makeDeliverySnapshot(recap, user, { render, signToken });
  let row = {
    ...recap, email_first_attempt_at: new Date().toISOString(),
    findings: { ...recap.findings, emailDelivery: snapshot }
  };
  let marks = 0;
  let senderCalls = 0;
  let release;
  const bothCalled = new Promise((resolve) => { release = resolve; });
  const sentPayloads = [];
  const supabase = {
    from: () => ({
      select() { return this; }, eq() { return this; },
      limit: async () => ({ data: [row], error: null })
    }),
    rpc: async (name, args) => {
      if (name === 'begin_weekly_recap_email_attempt') return { data: row, error: null };
      if (name === 'mark_weekly_recap_email') {
        marks++;
        if (marks === 1) {
          row = { ...row, email_status: 'sent', email_message_id: args.p_message_id };
          return { data: row, error: null };
        }
        return { data: { id: null }, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    }
  };
  const sender = async (payload, key) => {
    sentPayloads.push({ payload, key });
    senderCalls++;
    if (senderCalls === 2) release();
    await bothCalled;
    // The mocked provider honors Resend's stable key and sends only once.
    return { ok: true, id: 'resend-message-id' };
  };
  const call = () => deliverWeeklyRecapEmail({
    supabase, recap: row, correlationId: 'c', logger: () => {},
    entitlementCheck: async () => ({ eligible: true, user }), sender
  });
  const results = await Promise.all([call(), call()]);
  assert.deepEqual(results.map((result) => result.status).sort(), ['already_sent', 'sent']);
  assert.equal(sentPayloads.length, 2);
  assert.equal(new Set(sentPayloads.map((call) => call.payload)).size, 1);
  assert.equal(new Set(sentPayloads.map((call) => call.key)).size, 1);
});

test('fresh entitlement is rechecked after snapshot persistence and before begin', async () => {
  const snapshot = makeDeliverySnapshot(recap, user, { render, signToken });
  const stored = { ...recap, findings: { ...recap.findings, emailDelivery: snapshot } };
  const marks = [];
  let checks = 0;
  const result = await deliverWeeklyRecapEmail({
    supabase: {
      from: () => queryResult([stored]),
      rpc: async (name, args) => {
        marks.push({ name, args });
        return { data: { ...stored, email_status: 'skipped' }, error: null };
      }
    },
    recap: stored, correlationId: 'c', logger: () => {},
    entitlementCheck: async () => (++checks === 1
      ? { eligible: true, user }
      : { eligible: false, reason: 'email_preference_disabled', user }),
    sender: async () => { throw new Error('must not send'); }
  });
  assert.equal(result.reason, 'email_preference_disabled');
  assert.equal(checks, 2);
  assert.equal(marks[0].args.p_status, 'skipped');
});

test('a paused worker expires its begin claim before HTTP and sender throws are recorded', async () => {
  const snapshot = makeDeliverySnapshot(recap, user, { render, signToken });
  let row = {
    ...recap,
    findings: { ...recap.findings, emailDelivery: snapshot },
    email_first_attempt_at: new Date(Date.now() - RECAP_EMAIL_RETRY_WINDOW_MS - 1).toISOString()
  };
  const calls = [];
  const supabase = {
    from: () => queryResult([row]),
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'begin_weekly_recap_email_attempt') return { data: row, error: null };
      if (name === 'mark_weekly_recap_email') {
        row = { ...row, email_attempts: 3, email_status: 'failed' };
        return { data: row, error: null };
      }
      throw new Error(`unexpected ${name}`);
    }
  };
  const expired = await deliverWeeklyRecapEmail({
    supabase, recap: row, correlationId: 'c', logger: () => {},
    entitlementCheck: async () => ({ eligible: true, user }),
    sender: async () => { throw new Error('must not call paused sender'); },
    now: () => new Date()
  });
  assert.equal(expired.reason, RECAP_EMAIL_RETRY_WINDOW_REASON);
  assert.equal(calls.filter((call) => call.name === 'mark_weekly_recap_email')[0].args.p_failure_reason,
    RECAP_EMAIL_RETRY_WINDOW_REASON);

  row = {
    ...recap,
    findings: { ...recap.findings, emailDelivery: snapshot },
    email_first_attempt_at: new Date().toISOString()
  };
  const failed = await deliverWeeklyRecapEmail({
    supabase, recap: row, correlationId: 'c', logger: () => {},
    entitlementCheck: async () => ({ eligible: true, user }),
    sender: async () => { throw new Error('transport exploded'); },
    now: () => new Date()
  });
  assert.equal(failed.reason, 'email_send_failed');
});

test('email processing caps provider attempts at fifty and paces attempts', async () => {
  const pending = Array.from({ length: 51 }, (_, i) => ({
    ...recap, id: `pending-${i}`, email_status: 'pending'
  }));
  let delivered = 0;
  const waits = [];
  const supabase = {
    from: () => ({
      select() { return this; },
      eq() { return this; },
      lt() { return this; },
      order() { return this; },
      range: async () => ({ data: pending, error: null })
    })
  };
  const results = await processPendingRecapEmails(supabase, {
    logger: () => {},
    emailDelivery: async () => ({ status: 'failed', attempted: ++delivered <= 50 }),
    wait: async (ms) => waits.push(ms)
  });
  assert.equal(results.length, 50);
  assert.equal(delivered, 50);
  assert.equal(waits.length, 49);
  assert.ok(waits.every((ms) => ms === 120));
});

test('email-only runner import does not load the AI service or validator', () => {
  const script = `require('./jobs/recaps'); console.log([...Object.keys(require.cache)].some((p) => /ai-insights(?:-service)?\\.js$/.test(p)))`;
  const child = spawnSync(process.execPath, ['-e', script], { cwd: __dirname, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), 'false');
});

test('email-only dry run prints reviewable subject/body with hidden token and performs no writes', async () => {
  const logs = [];
  let deliveries = 0;
  let writes = 0;
  const supabase = {
    auth: { admin: {
      getUserById: async () => ({ data: { user }, error: null }),
      listUsers: async () => { throw new Error('must not list generation users'); }
    } },
    from: (table) => {
      if (table === 'weekly_recaps') {
        return {
          select() { return this; }, eq() { return this; }, lt() { return this; },
          order() { return this; },
          range: async () => ({ data: [recap], error: null }),
          update() { writes++; throw new Error('must not write dry run'); }
        };
      }
      if (table === 'subscriptions') {
        return {
          select() { return this; }, eq() { return this; }, in() { return this; },
          order() { return this; }, range: async () => ({ data: [{ owner_id: user.id }], error: null })
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: async () => { writes++; throw new Error('must not invoke write RPC in dry run'); }
  };
  const result = await main(['--send-emails-only', '--dry-run', '--user-id', user.id], {
    supabase,
    // If `main` imports/calls normal generation this missing service would fail.
    emailDelivery: async ({ dryRun }) => {
      deliveries++;
      assert.equal(dryRun, true);
      return {
        status: 'dry_run', attempted: false, subject: 'Your week in training — Sep 7–13',
        text: 'See your full recap: https://www.realarenas.com/recaps/2026-09-07\\n\\n' +
          'Unsubscribe: https://www.realarenas.com/email/unsubscribe/recap?t=secret-token'
      };
    },
    logger: (line) => logs.push(JSON.parse(line))
  });
  assert.equal(deliveries, 1);
  assert.equal(writes, 0);
  assert.equal(result.emails[0].status, 'dry_run');
  const report = logs.at(-1).results[0];
  assert.equal(report.subject, 'Your week in training — Sep 7–13');
  assert.match(report.text, /See your full recap/);
  assert.match(report.text, /t=\[redacted\]/);
  assert.equal(report.text.includes('secret-token'), false);
  assert.equal(JSON.stringify(report).includes('athlete@example.test'), false);
});

test('dry-run redaction removes only unsubscribe token values', () => {
  assert.equal(
    redactRecapEmailDryRunText('x /email/unsubscribe/recap?t=abc_123\ny'),
    'x /email/unsubscribe/recap?t=[redacted]\ny'
  );
});

test('email-only dry preview renders a sent recap from findings without reading its frozen provider payload', async () => {
  const sent = {
    ...recap,
    email_status: 'sent',
    prose: 'Old model prose.',
    findings: {
      findings: [
        { type: 'metric', path: 'last12Weeks.weekly.10.activityCount', value: 1 },
        { type: 'metric', path: 'last12Weeks.weekly.10.durationHours', value: 1 },
        { type: 'metric', path: 'last12Weeks.weekly.10.points', value: 5 }
      ],
      evidence: [],
      limitations: [],
      emailDelivery: { payload: '{"subject":"FROZEN OLD","text":"FROZEN OLD"}', idempotencyKey: `weekly-recap-email:${recap.id}`, recipient: user.email }
    }
  };
  const result = await deliverWeeklyRecapEmail({
    supabase: {}, recap: sent, correlationId: 'preview',
    entitlementCheck: async () => ({ eligible: true, user }),
    dryRun: true, signToken, logger: () => {}
  });
  assert.equal(result.status, 'dry_run');
  assert.match(result.text, /Last week \(Sep 7–13\) you logged 1 session, 1 hour for 5 points\./);
  assert.equal(result.text.includes('FROZEN OLD'), false);
});

test('dry preview query includes generated sent rows while live delivery remains pending-only', async () => {
  const filters = [];
  const query = {
    select() { return this; },
    eq(column, value) { filters.push([column, value]); return this; },
    lt(column, value) { filters.push([column, value]); return this; },
    order() { return this; },
    range: async () => ({ data: [], error: null })
  };
  await listPendingRecapEmails({ from: () => query }, recap.user_id, 50, true);
  assert.deepEqual(filters, [['status', 'generated'], ['user_id', recap.user_id]]);
});