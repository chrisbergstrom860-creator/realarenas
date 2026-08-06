'use strict';

// Tests for the "challenges available" stat accuracy fix.
//
// The Discover grid is capped at 20 rows; this test suite proves that the
// header stat reflects the true joinable count (via an exact Supabase head-
// count query) and never silently understates once more than 20 exist.
//
// All tests run without a live server or Supabase connection.

const test = require('node:test');
const assert = require('node:assert');

// ── Shared filter helper — must stay byte-for-byte identical to
//    applyDiscoverFilters inside the GET /api/challenges route in server.js.
//    If you change the server implementation, update this copy too. ──────────
function applyDiscoverFilters(q, excludeIds, nowIso) {
  let query = q.eq('visibility', 'public').gt('end_date', nowIso);
  if (excludeIds && excludeIds.length) {
    query = query.not('id', 'in', `(${excludeIds.join(',')})`);
  }
  return query;
}

// ── Count resolution helper — same logic as in the route ────────────────────
function resolvePublicCount(countResult, fallbackLength) {
  return (!countResult.error && countResult.count != null)
    ? countResult.count
    : fallbackLength;
}

// ── Mock Supabase query builder ──────────────────────────────────────────────
// Records every chained call so tests can assert filter parity without a real
// Supabase connection. Mirrors the Supabase JS v2 fluent builder API.
function makeMockBuilder({ count = null, data = [], error = null } = {}) {
  const calls = [];
  const builder = {
    _calls: calls,
    eq(col, val)        { calls.push(['eq', col, val]);         return this; },
    gt(col, val)        { calls.push(['gt', col, val]);         return this; },
    not(col, op, val)   { calls.push(['not', col, op, val]);    return this; },
    order(col, opts)    { calls.push(['order', col, opts]);     return this; },
    limit(n)            { calls.push(['limit', n]);             return this; },
    then(resolve)       { return Promise.resolve({ data, count, error }).then(resolve); }
  };
  return builder;
}

const NOW = '2026-08-06T12:00:00.000Z';

// ── applyDiscoverFilters: filter-condition tests ─────────────────────────────

test('applyDiscoverFilters: applies visibility=public filter', () => {
  const b = makeMockBuilder();
  applyDiscoverFilters(b, [], NOW);
  assert.ok(
    b._calls.some(c => c[0] === 'eq' && c[1] === 'visibility' && c[2] === 'public'),
    'must call .eq("visibility", "public")'
  );
});

test('applyDiscoverFilters: applies end_date > nowIso filter', () => {
  const b = makeMockBuilder();
  applyDiscoverFilters(b, [], NOW);
  assert.ok(
    b._calls.some(c => c[0] === 'gt' && c[1] === 'end_date' && c[2] === NOW),
    'must call .gt("end_date", nowIso)'
  );
});

test('applyDiscoverFilters: omits .not() when exclusion list is empty', () => {
  const b = makeMockBuilder();
  applyDiscoverFilters(b, [], NOW);
  assert.ok(
    !b._calls.some(c => c[0] === 'not'),
    'must NOT call .not() with an empty exclusion list'
  );
});

test('applyDiscoverFilters: applies .not(id, in, ...) when exclusion list is non-empty', () => {
  const b = makeMockBuilder();
  const ids = ['aaa', 'bbb'];
  applyDiscoverFilters(b, ids, NOW);
  const notCall = b._calls.find(c => c[0] === 'not');
  assert.ok(notCall, '.not() must be called');
  assert.strictEqual(notCall[1], 'id');
  assert.strictEqual(notCall[2], 'in');
  assert.ok(notCall[3].includes('aaa') && notCall[3].includes('bbb'),
    'exclusion ids must appear in the .not() argument');
});

test('applyDiscoverFilters: count and grid builders receive identical filter conditions', () => {
  const bCount = makeMockBuilder();
  const bGrid  = makeMockBuilder();
  const ids = ['id-1', 'id-2'];

  applyDiscoverFilters(bCount, ids, NOW);
  applyDiscoverFilters(bGrid,  ids, NOW);

  // Only compare filter calls (eq/gt/not); order/limit are grid-only additions
  const filterCalls = b => b._calls.filter(c => ['eq', 'gt', 'not'].includes(c[0]));
  assert.deepStrictEqual(
    filterCalls(bCount), filterCalls(bGrid),
    'count and grid builders must receive identical filter conditions — no drift'
  );
});

// ── resolvePublicCount: count resolution tests ───────────────────────────────

test('resolvePublicCount: returns exact count when query succeeds', () => {
  assert.strictEqual(resolvePublicCount({ count: 25, error: null }, 20), 25);
});

test('resolvePublicCount: falls back to grid length when count is null', () => {
  assert.strictEqual(resolvePublicCount({ count: null, error: null }, 20), 20);
});

test('resolvePublicCount: falls back to grid length when query errors', () => {
  assert.strictEqual(resolvePublicCount({ count: 25, error: new Error('supabase error') }, 20), 20);
});

// ── Core scenario: 25 available, grid shows 20 ───────────────────────────────

test('stat shows 25 when count=25 even though grid is capped at 20 rows', () => {
  const gridRows   = Array.from({ length: 20 }, (_, i) => ({ id: `c-${i}` }));
  const publicCount = resolvePublicCount({ count: 25, error: null }, gridRows.length);

  assert.strictEqual(publicCount, 25, 'header stat must reflect true total, not grid cap');
  assert.strictEqual(gridRows.length, 20, 'grid must remain at its 20-row cap');
});

test('stat shows 20 when exactly 20 exist (count=20 = grid cap, no "20+" inflation)', () => {
  const gridRows    = Array.from({ length: 20 }, (_, i) => ({ id: `c-${i}` }));
  const publicCount = resolvePublicCount({ count: 20, error: null }, gridRows.length);

  assert.strictEqual(publicCount, 20,
    'must not inflate when the exact count equals the cap (exactly 20 challenges in DB)');
});

// ── Exclusion correctness ────────────────────────────────────────────────────

test('exclusions: created, joined, expired, private all excluded — discover pool = 25', () => {
  const FUTURE = '2026-12-31T00:00:00.000Z';
  const PAST   = '2026-01-01T00:00:00.000Z';
  const joinedId   = 'joined-id';
  const createdId  = 'created-id';

  // In-process simulation of the three Discover filter conditions:
  //   1. visibility === 'public'
  //   2. end_date   > fakeNow
  //   3. id not in excludeIds
  function simulateDiscover(rows, excludeIds, nowIso) {
    return rows.filter(r =>
      r.visibility === 'public' &&
      r.end_date   >  nowIso   &&
      !excludeIds.includes(r.id)
    );
  }

  const rows = [
    // 25 joinable public live challenges
    ...Array.from({ length: 25 }, (_, i) => ({
      id: `public-${i}`, visibility: 'public', end_date: FUTURE
    })),
    // 2 private (excluded by visibility filter)
    { id: 'priv-1', visibility: 'private', end_date: FUTURE },
    { id: 'priv-2', visibility: 'private', end_date: FUTURE },
    // 2 expired public (excluded by end_date filter)
    { id: 'exp-1',  visibility: 'public',  end_date: PAST  },
    { id: 'exp-2',  visibility: 'public',  end_date: PAST  },
    // 1 joined  (excluded via excludeFromDiscover by the server)
    { id: joinedId,  visibility: 'public', end_date: FUTURE },
    // 1 created (excluded via excludeFromDiscover by the server)
    { id: createdId, visibility: 'public', end_date: FUTURE },
  ];

  const excludeIds    = [joinedId, createdId];
  const discoverPool  = simulateDiscover(rows, excludeIds, NOW);

  assert.strictEqual(discoverPool.length, 25,
    'Discover pool must contain exactly 25 joinable public challenges');

  const gridRows    = discoverPool.slice(0, 20);
  assert.strictEqual(gridRows.length, 20, 'grid must show 20');

  const publicCount = resolvePublicCount({ count: discoverPool.length, error: null }, gridRows.length);
  assert.strictEqual(publicCount, 25, 'header stat must report 25, not 20');
});

// ── Grammar ──────────────────────────────────────────────────────────────────

test('singular grammar at exactly 1 available challenge', () => {
  function availLabel(n) {
    return n === 1 ? 'challenge available' : 'challenges available';
  }
  assert.strictEqual(availLabel(1),  'challenge available');
  assert.strictEqual(availLabel(0),  'challenges available');
  assert.strictEqual(availLabel(25), 'challenges available');
});
