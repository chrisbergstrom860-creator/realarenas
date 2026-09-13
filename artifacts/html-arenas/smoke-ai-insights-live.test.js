const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const smoke = require('./scripts/smoke-ai-insights-live');

const USER_ID = '00000000-0000-4000-8000-000000000001';

test('manual smoke defaults preserve seven requests including duplicate feelings', () => {
  const args = smoke.parseArgs(['--user-id', USER_ID]);
  assert.equal(args.questions.length, 7);
  assert.equal(args.questions.filter((q) => q === smoke.FEELINGS_QUESTION).length, 2);
  assert.equal(args.questions.at(-1), smoke.SINGLE_COUNT_QUESTION);
  const verifier = fs.readFileSync(path.join(__dirname, 'scripts/verify-ai-insights.js'), 'utf8');
  const match = verifier.match(/const CHART_QUESTIONS = (\[[\s\S]*?\]);/);
  assert.ok(match);
  assert.deepEqual(smoke.CHART_QUESTIONS, Array.from(vm.runInNewContext(match[1])));
  assert.deepEqual(smoke.parseArgs(['--user-id', USER_ID, '--question', 'First?', '--question', 'Second?']).questions,
    ['First?', 'Second?']);
  assert.throws(() => smoke.parseArgs(['--user-id', 'not-a-uuid']), /UUID/);
});

test('manual smoke blocks all database writes before network access', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: true }; };
  try {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
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

test('manual smoke extraction omits startup and requires the real context entrypoint', () => {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const program = smoke.extractContextProgram(source + '\nthrow new Error("startup ran");');
  assert.ok(program.includes('async function buildAiInsightsContext(user)'));
  assert.equal(program.includes('app.listen('), false);
  assert.equal(program.includes('startup ran'), false);
  assert.throws(() => smoke.extractContextProgram(''), /constants missing/);
});

test('manual smoke enforces feelings chart and single-count no-chart expectations', () => {
  assert.equal(smoke.expectationFailure(smoke.FEELINGS_QUESTION, {
    accepted: true, chart: { metric: 'feelings', period: 'weekly' }
  }), null);
  assert.match(smoke.expectationFailure(smoke.FEELINGS_QUESTION, { accepted: true, chart: null }), /weekly feelings chart/);
  assert.equal(smoke.expectationFailure(smoke.SINGLE_COUNT_QUESTION, { accepted: true, chart: null }), null);
  assert.match(smoke.expectationFailure(smoke.SINGLE_COUNT_QUESTION, {
    accepted: true, chart: { metric: 'sessions', period: 'weekly' }
  }), /returned a chart/);
});

test('manual smoke retries only rate limits, with a bounded count and Retry-After wait', async () => {
  const limited = { status: 429, headers: { 'retry-after': '2' } };
  assert.equal(smoke.rateLimitDelay(limited), 2000);
  assert.equal(smoke.rateLimitDelay({ status: 500 }), null);
  assert.equal(smoke.rateLimitDelay({ status: 429, headers: { 'retry-after': '300' } }), null);
  let attempts = 0;
  const waits = [];
  const client = { messages: { create: async () => {
    attempts++;
    if (attempts < 3) throw limited;
    return { stop_reason: 'end_turn' };
  } } };
  const result = await smoke.callProvider(client, {}, () => {}, async (ms) => waits.push(ms));
  assert.equal(result.stop_reason, 'end_turn');
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [2000, 2000]);
  attempts = 0;
  client.messages.create = async () => { attempts++; throw limited; };
  await assert.rejects(smoke.callProvider(client, {}, () => {}, async () => {}), (err) => err === limited);
  assert.equal(attempts, 3);
});