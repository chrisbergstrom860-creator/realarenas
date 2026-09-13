'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeHandler, sourceAtRef, ROUTES } = require('./scripts/lib/challenges-equivalence');

function rejectingActivityClient(joined) {
  const tables = {
    challenge_participants: joined ? [{ challenge_id: 'challenge', user_id: 'viewer' }] : [],
    challenges: joined ? [{
      id: 'challenge', created_by: 'viewer', visibility: 'private',
      start_date: '2026-01-01T00:00:00.000Z', end_date: '2027-01-01T00:00:00.000Z',
      goal_type: 'distance', goal_target: 10, sport: 'running', club_id: null
    }] : []
  };
  return {
    from(table) {
      let rows = [...(tables[table] || [])];
      const query = {
        select() { return query; },
        order() { return query; },
        limit() { return query; },
        range() { return query; },
        gt() { return query; },
        gte() { return query; },
        lte() { return query; },
        not() { return query; },
        eq(key, value) { rows = rows.filter((row) => row[key] === value); return query; },
        is(key, value) { return query.eq(key, value); },
        in(key, values) { rows = rows.filter((row) => values.includes(row[key])); return query; },
        then(resolve, reject) {
          const result = table === 'activities'
            ? Promise.reject(new Error('activity transport rejected'))
            : Promise.resolve({ data: rows, count: rows.length, error: null });
          return result.then(resolve, reject);
        }
      };
      return query;
    },
    auth: { admin: { getUserById() { throw new Error('unexpected Auth lookup'); } } }
  };
}

async function responseFor(joined) {
  const snapshot = sourceAtRef('WORKTREE');
  const { handler } = makeHandler({
    source: snapshot.source, sourceName: snapshot.name,
    route: ROUTES.primary, client: rejectingActivityClient(joined),
    frozenAt: '2026-09-13T12:00:00.000Z'
  });
  let body;
  await handler({ user: { id: 'viewer', user_metadata: {} } }, { json(value) { body = value; } });
  return JSON.parse(JSON.stringify(body));
}

test('activity transport failure keeps the legacy main error when progress is required', async () => {
  assert.deepEqual(await responseFor(true), { error: 'activity transport rejected' });
});

test('stats-only activity transport failure leaves the legacy empty week grid', async () => {
  const result = await responseFor(false);
  assert.equal(result.error, undefined);
  assert.equal(result.pointsThisMonth, 0);
  assert.equal(result.currentStreak, 0);
  assert.equal(result.longestStreak, 0);
  assert.deepEqual(result.weekGrid, []);
});