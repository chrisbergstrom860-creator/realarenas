'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FOUNDER_ID, alertKey, sendRecapFailureAlert, deliverAlert, recoverRecapFailureAlerts
} = require('./recap-failure-alert');

const failure = {
  userId: '11111111-1111-4111-8111-111111111111',
  weekStart: '2026-09-14', kind: 'generation', reason: 'unsupported_path'
};

test('founder alert has stable key and frozen provider payload; repeat does not send twice', async () => {
  let snapshot;
  let notification;
  let messageId = null;
  let sends = 0;
  const db = {
    auth: { admin: { getUserById: async (id) => {
      assert.equal(id, FOUNDER_ID);
      return { data: { user: { email: 'founder@example.test' } }, error: null };
    } } },
    from: (table) => ({
      upsert: async (row, opts) => {
        assert.equal(opts.ignoreDuplicates, true);
        if (table === 'notifications') notification = row;
        else if (!snapshot) snapshot = row;
        return { error: null };
      },
      update(row) {
        assert.equal(table, 'recap_failure_alerts');
        messageId = row.message_id;
        return {
          eq() { return this; }, is() { return this; },
          select: async () => ({ data: [{ message_id: messageId }], error: null })
        };
      }
    }),
    rpc: async () => ({ data: messageId ? null : {
      affected_user_id: failure.userId, payload: snapshot.payload,
      first_attempt_at: new Date().toISOString()
    }, error: null })
  };
  const send = async (payload, key) => {
    sends++;
    assert.equal(payload, snapshot.payload);
    assert.equal(key, alertKey(failure.userId, failure.weekStart, failure.kind));
    return { ok: true, id: 'provider-123' };
  };
  assert.equal((await sendRecapFailureAlert(db, failure, send)).status, 'sent');
  assert.equal((await sendRecapFailureAlert(db, failure, send)).status, 'not_claimed');
  assert.equal(sends, 1);
  assert.equal(notification.type, 'recap_alert');
  assert.equal(notification.user_id, FOUNDER_ID);
  assert.match(notification.body, /11111111-1111-4111-8111-111111111111/);
  assert.equal(JSON.parse(snapshot.payload).subject, 'Weekly recap failure — 2026-09-14');
});

test('provider is not called after frozen first-attempt window expires', async () => {
  const db = { rpc: async () => ({ data: {
    affected_user_id: failure.userId, payload: '{}',
    first_attempt_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  }, error: null }) };
  assert.equal((await deliverAlert(db, failure, () => {
    throw new Error('must not send');
  })).status, 'retry_window_expired');
});

test('recovery starts no database work when the soft budget has expired', async () => {
  const results = await recoverRecapFailureAlerts({
    from: () => { throw new Error('must not query'); }
  }, { shouldContinue: () => false });
  assert.deepEqual(results, []);
});

test('expired alert snapshots do not exhaust recovery budget or starve later failures', async () => {
  const oldWeek = '2026-09-07';
  const currentWeek = '2026-09-14';
  const old = Array.from({ length: 100 }, (_, i) => ({
    user_id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
    week_start: oldWeek, status: 'failed', attempts: 3,
    failure_reason: 'context_build_failed'
  }));
  const fresh = { ...failure, user_id: failure.userId, week_start: currentWeek,
    status: 'failed', attempts: 3, failure_reason: failure.reason };
  let notifications = 0;
  let sends = 0;
  const db = {
    auth: { admin: { getUserById: async () => ({
      data: { user: { email: 'founder@example.test' } }, error: null
    }) } },
    from: (table) => {
      const filters = {};
      return {
        select() { return this; },
        eq(key, value) { filters[key] = value; return this; },
        is() { return this; },
        or() { return this; },
        order() { return this; },
        range: async (start, end) => ({
          data: [...old, fresh].slice(start, end + 1), error: null
        }),
        limit: async () => ({
          data: table === 'recap_failure_alerts' && filters.affected_user_id
            ? filters.affected_user_id === fresh.user_id ? [] : [{
              message_id: null,
              first_attempt_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
            }]
            : [],
          error: null
        }),
        upsert: async (row) => {
          if (table === 'notifications') notifications++;
          return { error: null };
        },
        update: () => ({
          eq() { return this; }, is() { return this; },
          select: async () => ({ data: [{ message_id: 'sent-1' }], error: null })
        })
      };
    },
    rpc: async () => ({ data: {
      affected_user_id: fresh.user_id, payload: '{}',
      first_attempt_at: new Date().toISOString()
    }, error: null })
  };
  const results = await recoverRecapFailureAlerts(db, {
    sender: async () => { sends++; return { ok: true, id: 'sent-1' }; }
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'sent');
  assert.equal(notifications, 1);
  assert.equal(sends, 1);
});