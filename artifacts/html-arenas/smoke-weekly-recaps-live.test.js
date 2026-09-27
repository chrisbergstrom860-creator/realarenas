const test = require('node:test');
const assert = require('node:assert/strict');
const smoke = require('./scripts/smoke-weekly-recaps-live');

const USER_ID = '00000000-0000-4000-8000-000000000001';

test('recap smoke options require a UUID, positive count and timezone-aware ISO timestamp', () => {
  assert.deepEqual(smoke.parseArgs(['--user-id', USER_ID]), { userId: USER_ID, count: 5, now: undefined });
  assert.deepEqual(smoke.parseArgs(['--count', '3', '--now', '2026-03-16T12:00:00Z', '--user-id', USER_ID]), {
    userId: USER_ID, count: 3, now: new Date('2026-03-16T12:00:00Z')
  });
  assert.deepEqual(smoke.parseArgs(['--help']), { help: true });
  for (const args of [
    [], ['--user-id', 'invalid'], ['--user-id', USER_ID, '--count', '0'],
    ['--user-id', USER_ID, '--count', '1.5'], ['--user-id', USER_ID, '--count', '-1'],
    ['--user-id', USER_ID, '--now', '2026-03-16'],
    ['--user-id', USER_ID, '--now', '2026-02-30T12:00:00Z'],
    ['--user-id', USER_ID, '--now', 'garbage'],
    ['--user-id', USER_ID, '--count'], ['--user-id', USER_ID, '--unknown', 'x'],
    ['--user-id', USER_ID, '--user-id', USER_ID]
  ]) assert.throws(() => smoke.parseArgs(args));
});

test('recap smoke Supabase guard refuses writes before network access', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: true }; };
  try {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.throws(() => smoke.readOnlyFetch('https://example.test', { method }), /Read-only smoke refused/);
      assert.throws(() => smoke.readOnlyFetch(new Request('https://example.test', { method })), /Read-only smoke refused/);
    }
    assert.equal(calls, 0);
    await smoke.readOnlyFetch('https://example.test');
    await smoke.readOnlyFetch('https://example.test', { method: 'HEAD' });
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('recap smoke binds production runtime/service with provider retries disabled', async () => {
  const admin = { sentinel: true };
  let runtimeOptions;
  let serviceDeps;
  let clientOptions;
  const service = smoke.makeReadOnlyService(admin, {
    apiKey: 'test-only', provider: 'replit-ai-integrations', baseURL: 'https://example.test'
  }, {
    runtimeFactory(options) { runtimeOptions = options; return { sentinel: true }; },
    serviceFactory(deps) { serviceDeps = deps; return { buildContextForUser() {}, runValidatedRequest() {} }; },
    clientFactory(options) { clientOptions = options; return { messages: {} }; }
  });
  assert.equal(runtimeOptions.supabaseAdmin, admin);
  assert.equal(serviceDeps.sentinel, true);
  assert.equal(typeof service.buildContextForUser, 'function');
  assert.equal(typeof service.runValidatedRequest, 'function');
  assert.deepEqual(serviceDeps.createAnthropicClient(), { messages: {} });
  assert.deepEqual(clientOptions, {
    apiKey: 'test-only', maxRetries: 0, baseURL: 'https://example.test'
  });
  assert.deepEqual(smoke.diagnostic({ ok: false, reason: 'missing_path', offendingPath: 'last12Weeks.x' }), {
    accepted: false, reason: 'missing_path', offendingPath: 'last12Weeks.x'
  });
});