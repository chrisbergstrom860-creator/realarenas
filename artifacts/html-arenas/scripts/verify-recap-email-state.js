#!/usr/bin/env node
'use strict';

// Real service-role verification of the recap-email SQL state machine.
// This script creates only a single @arenas-test.dev fixture user and generated
// recap rows; it never invokes the runner, Resend, or an application server.
// Run from artifacts/html-arenas: node scripts/verify-recap-email-state.js

const fs = require('node:fs');
const { createClient } = require('@supabase/supabase-js');

const MANIFEST = '/tmp/verify-recap-email-state-manifest.json';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const nonce = Date.now().toString(36);
const fixture = { userId: null, recapIds: [] };
let failures = 0;
let assertions = 0;

function check(name, ok, detail) {
  assertions++;
  if (ok) console.log('  ok  ' + name);
  else {
    failures++;
    console.error('FAIL  ' + name + (detail ? ' — ' + String(detail).slice(0, 900) : ''));
  }
}

function saveManifest() {
  fs.writeFileSync(MANIFEST, JSON.stringify(fixture, null, 2) + '\n');
}

function recapRow(result) {
  const data = result && result.data;
  return Array.isArray(data) ? data[0] : data;
}

function sameInstant(left, right) {
  return !!left && !!right && Date.parse(left) === Date.parse(right);
}

async function must(label, operation) {
  const result = await operation;
  if (result.error) throw new Error(label + ': ' + result.error.message);
  return result.data;
}

async function rpc(label, name, args) {
  const result = await admin.rpc(name, args);
  if (result.error) throw new Error(label + ': ' + result.error.message);
  return recapRow(result);
}

async function cleanupManifest(manifest) {
  const ids = (manifest.recapIds || []).filter(Boolean);
  const userId = manifest.userId;
  if (ids.length) {
    await must('cleanup fixture recaps', admin.from('weekly_recaps').delete().in('id', ids));
  }
  if (!userId) return;
  // A user-created profile can be an auth side effect; remove every row type
  // this verifier could directly or indirectly create before deleting auth.
  for (const [table, column] of [
    ['notifications', 'user_id'], ['subscriptions', 'owner_id'],
    ['profiles', 'id'], ['weekly_recaps', 'user_id']
  ]) {
    await must(`cleanup ${table}`, admin.from(table).delete().eq(column, userId));
  }
  await must('cleanup fixture auth user', admin.auth.admin.deleteUser(userId));
}

async function cleanup() {
  if (!fs.existsSync(MANIFEST)) return;
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  await cleanupManifest(manifest);
  fs.unlinkSync(MANIFEST);
}

async function createGeneratedRecap(label) {
  const weekStart = new Date(Date.UTC(2026, 0, 5 + fixture.recapIds.length * 7))
    .toISOString().slice(0, 10);
  const row = await must('create generated recap ' + label, admin.from('weekly_recaps').insert({
    user_id: fixture.userId,
    week_start: weekStart,
    timezone: 'UTC',
    window_start_utc: weekStart + 'T00:00:00.000Z',
    window_end_utc: new Date(new Date(weekStart + 'T00:00:00.000Z').getTime() + 7 * 86400000).toISOString(),
    status: 'generated',
    attempts: 1,
    findings: { findings: [], limitations: [], evidence: [] },
    prose: 'Fixture recap prose.',
    chart: null,
    context_schema_version: 8,
    contract_version: 1,
    generated_at: '2026-01-12T00:00:00.000Z'
  }).select('id,email_status,email_attempts,email_first_attempt_at').single());
  fixture.recapIds.push(row.id);
  saveManifest();
  return row;
}

(async () => {
  try {
    if (fs.existsSync(MANIFEST)) await cleanup();
    saveManifest();

    const created = await must('create fixture auth user', admin.auth.admin.createUser({
      email: `recap-email-state-${nonce}@arenas-test.dev`,
      password: 'RecapEmailState!234',
      email_confirm: true,
      user_metadata: {
        name: 'Recap Email State Fixture',
        prefs: { weekly_recap: false, weekly_recap_email: false }
      }
    }));
    fixture.userId = created.user.id;
    saveManifest();

    const missing = await rpc('begin nonexistent recap', 'begin_weekly_recap_email_attempt', {
      p_id: '00000000-0000-0000-0000-000000000000'
    });
    check('begin RPC returns a null composite for a nonexistent recap', !missing || !missing.id,
      JSON.stringify(missing));

    const sent = await createGeneratedRecap('sent');
    check('new generated recap begins email-pending at zero attempts',
      sent.email_status === 'pending' && sent.email_attempts === 0 && sent.email_first_attempt_at === null,
      JSON.stringify(sent));
    const sentWithoutMessage = await admin.rpc('mark_weekly_recap_email', {
      p_id: sent.id, p_status: 'sent', p_message_id: null, p_failure_reason: null
    });
    check('sent transition requires a Resend message id', !!sentWithoutMessage.error,
      sentWithoutMessage.error && sentWithoutMessage.error.message);
    const sentMarked = await rpc('mark sent recap', 'mark_weekly_recap_email', {
      p_id: sent.id, p_status: 'sent', p_message_id: 're_fixture_sent', p_failure_reason: null
    });
    check('pending recap transitions to sent with a message id and timestamp',
      sentMarked?.id === sent.id && sentMarked.email_status === 'sent' &&
        sentMarked.email_message_id === 're_fixture_sent' && !!sentMarked.email_sent_at,
      JSON.stringify(sentMarked));
    const sentImmutable = await rpc('attempt sent recap mutation', 'mark_weekly_recap_email', {
      p_id: sent.id, p_status: 'failed', p_message_id: null, p_failure_reason: 'must not overwrite sent'
    });
    const persistedSent = await must('read terminal sent recap', admin.from('weekly_recaps')
      .select('email_status,email_attempts,email_message_id,email_failure_reason').eq('id', sent.id).single());
    check('sent recap is terminal and immutable through email state RPC',
      (!sentImmutable || !sentImmutable.id) && persistedSent.email_status === 'sent' &&
        persistedSent.email_attempts === 0 && persistedSent.email_message_id === 're_fixture_sent' &&
        persistedSent.email_failure_reason === null,
      JSON.stringify({ sentImmutable, persistedSent }));

    const failed = await createGeneratedRecap('failure-retries');
    const failure = async () => rpc('mark failed recap', 'mark_weekly_recap_email', {
      p_id: failed.id, p_status: 'failed', p_message_id: null, p_failure_reason: 'fixture send failure'
    });
    const firstFailure = await failure();
    const secondFailure = await failure();
    const thirdFailure = await failure();
    check('first failed send returns generated recap to pending with attempt one',
      firstFailure?.email_status === 'pending' && firstFailure.email_attempts === 1,
      JSON.stringify(firstFailure));
    check('second failed send returns generated recap to pending with attempt two',
      secondFailure?.email_status === 'pending' && secondFailure.email_attempts === 2,
      JSON.stringify(secondFailure));
    check('third failed send is terminal failed with attempt three',
      thirdFailure?.email_status === 'failed' && thirdFailure.email_attempts === 3,
      JSON.stringify(thirdFailure));

    const concurrent = await createGeneratedRecap('concurrent-begin');
    const [firstBegin, secondBegin] = await Promise.all([
      rpc('begin concurrent recap first', 'begin_weekly_recap_email_attempt', { p_id: concurrent.id }),
      rpc('begin concurrent recap second', 'begin_weekly_recap_email_attempt', { p_id: concurrent.id })
    ]);
    const beginTimes = [firstBegin, secondBegin].map((row) => row && row.email_first_attempt_at);
    const concurrentPersisted = await must('read concurrent begin recap', admin.from('weekly_recaps')
      .select('id,email_first_attempt_at').eq('id', concurrent.id).single());
    check('first-attempt timestamp remains immutable after repeated begin calls',
      beginTimes.every(Boolean) && sameInstant(beginTimes[0], concurrentPersisted.email_first_attempt_at),
      JSON.stringify({ beginTimes, concurrentPersisted }));
    check('concurrent begin calls preserve one immutable first-attempt timestamp',
      beginTimes.every(Boolean) && sameInstant(beginTimes[0], beginTimes[1]),
      JSON.stringify({ firstBegin, secondBegin }));

    const expired = await createGeneratedRecap('expired-window');
    const oldFirstAttempt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await must('age fixture first attempt beyond retry window', admin.from('weekly_recaps')
      .update({ email_first_attempt_at: oldFirstAttempt }).eq('id', expired.id));
    const expiredBegin = await rpc('begin expired recap', 'begin_weekly_recap_email_attempt', { p_id: expired.id });
    const expiredRow = await must('read expired fixture recap', admin.from('weekly_recaps')
      .select('id,status,email_status,email_attempts,email_first_attempt_at').eq('id', expired.id).single());
    check('expired retry-window begin is a no-op and leaves generated pending row for runner terminal handling',
      (!expiredBegin || !expiredBegin.id) && expiredRow.status === 'generated' &&
        expiredRow.email_status === 'pending' && sameInstant(expiredRow.email_first_attempt_at, oldFirstAttempt),
      JSON.stringify({ expiredBegin, expiredRow }));
  } catch (error) {
    failures++;
    console.error('FATAL', error && error.stack ? error.stack : error);
  } finally {
    try {
      await cleanup();
      check('fixture manifest is removed after cleanup', !fs.existsSync(MANIFEST));
      if (fixture.userId) {
        const { data, error } = await admin.auth.admin.getUserById(fixture.userId);
        check('fixture auth user is removed after cleanup', !data || !data.user,
          error && error.message);
      }
    } catch (error) {
      failures++;
      console.error('CLEANUP FAILED', error && error.stack ? error.stack : error);
    }
  }
  console.log(failures
    ? `\n${failures} FAILURE(S) of ${assertions} recap email SQL checks`
    : `\nALL ${assertions}/${assertions} RECAP EMAIL SQL CHECKS PASSED`);
  process.exit(failures ? 1 : 0);
})();