'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeHandler, sourceAtRef, ROUTES } = require('./scripts/lib/challenges-equivalence');

const FROZEN_AT = '2026-09-13T12:00:00.000Z';
const USER_ID = 'viewer';
const CHALLENGE_ID = 'pagination-challenge';
const ACTIVITY_PROJECTION = 'distance, duration, sport, date';

/*
 * This client deliberately behaves like the small part of the Supabase
 * builder used by GET /api/challenges.  In particular, range is applied after
 * filtering and ordering, as PostgREST does, even though the production
 * fetchAllRows call places range before its filter callback.
 */
function makeMockClient({ activities, failSecondPage = false }) {
  const rowsByTable = {
    activities,
    challenge_participants: [{ challenge_id: CHALLENGE_ID, user_id: USER_ID }],
    challenges: [{
      id: CHALLENGE_ID,
      created_by: USER_ID,
      visibility: 'private',
      title: 'Pagination challenge',
      description: null,
      sport: 'running',
      goal_type: 'distance',
      goal_target: 1100,
      goal_unit: 'km',
      start_date: '2026-09-01T00:00:00.000Z',
      end_date: '2026-10-01T00:00:00.000Z',
      club_id: null,
      image_path: null,
      created_at: '2026-08-01T00:00:00.000Z'
    }],
    challenge_invites: []
  };
  const queryRecords = [];
  const activityPages = [];

  const valueFor = (row, column) => row[column];
  const compareValues = (left, right, column) => {
    if (column === 'date' || column === 'created_at' || column === 'start_date' ||
        column === 'end_date') {
      return new Date(valueFor(left, column)).getTime()
        - new Date(valueFor(right, column)).getTime();
    }
    return String(valueFor(left, column) ?? '').localeCompare(
      String(valueFor(right, column) ?? ''
    ));
  };
  const project = (row, columns) => {
    if (!columns || columns === '*') return { ...row };
    const names = String(columns).split(',').map((name) => name.trim()).filter(Boolean);
    return Object.fromEntries(names
      .filter((name) => Object.prototype.hasOwnProperty.call(row, name))
      .map((name) => [name, row[name]]));
  };

  const client = {
    queryRecords,
    activityPages,
    from(table) {
      const record = { table, calls: [] };
      queryRecords.push(record);
      const builder = {
        select(columns, options) {
          record.calls.push(['select', columns, options]);
          record.columns = columns;
          return builder;
        },
        range(from, to) {
          record.calls.push(['range', from, to]);
          return builder;
        },
        eq(column, value) {
          record.calls.push(['eq', column, value]);
          return builder;
        },
        in(column, values) {
          record.calls.push(['in', column, values]);
          return builder;
        },
        gt(column, value) {
          record.calls.push(['gt', column, value]);
          return builder;
        },
        gte(column, value) {
          record.calls.push(['gte', column, value]);
          return builder;
        },
        lte(column, value) {
          record.calls.push(['lte', column, value]);
          return builder;
        },
        not(column, operator, value) {
          record.calls.push(['not', column, operator, value]);
          return builder;
        },
        is(column, value) {
          record.calls.push(['is', column, value]);
          return builder;
        },
        order(column, options) {
          record.calls.push(['order', column, { ...options }]);
          return builder;
        },
        limit(value) {
          record.calls.push(['limit', value]);
          return builder;
        },
        then(resolve, reject) {
          let result = (rowsByTable[table] || []).map((row) => ({ ...row }));
          const calls = record.calls;

          calls.filter((call) => call[0] === 'eq').forEach(([, column, value]) => {
            result = result.filter((row) => row[column] === value);
          });
          calls.filter((call) => call[0] === 'in').forEach(([, column, values]) => {
            result = result.filter((row) => values.includes(row[column]));
          });
          calls.filter((call) => call[0] === 'gt').forEach(([, column, value]) => {
            result = result.filter((row) => row[column] > value);
          });
          calls.filter((call) => call[0] === 'gte').forEach(([, column, value]) => {
            result = result.filter((row) => row[column] >= value);
          });
          calls.filter((call) => call[0] === 'lte').forEach(([, column, value]) => {
            result = result.filter((row) => row[column] <= value);
          });
          calls.filter((call) => call[0] === 'is').forEach(([, column, value]) => {
            result = result.filter((row) => value === null ? row[column] === null : row[column] === value);
          });
          calls.filter((call) => call[0] === 'not').forEach(([, column, operator, value]) => {
            if (operator !== 'in') return;
            const excluded = String(value).replace(/^\(|\)$/g, '').split(',');
            result = result.filter((row) => !excluded.includes(String(row[column])));
          });
          calls.filter((call) => call[0] === 'order').reverse().forEach(([, column, options]) => {
            result.sort((left, right) => {
              const delta = compareValues(left, right, column);
              return options && options.ascending === false ? -delta : delta;
            });
          });

          const range = calls.find((call) => call[0] === 'range');
          const from = range ? range[1] : 0;
          const to = range ? range[2] : result.length - 1;
          const page = result.slice(from, to + 1);
          if (table === 'activities') {
            activityPages.push({
              range: range ? [range[1], range[2]] : null,
              ids: page.map((row) => row.id)
            });
            if (failSecondPage && from === 1000) {
              return Promise.reject(new Error('activity page 2 failed')).then(resolve, reject);
            }
          }

          const limit = calls.find((call) => call[0] === 'limit');
          if (limit) result = result.slice(0, limit[1]);
          else result = page;
          const data = result.map((row) => project(row, record.columns));
          return Promise.resolve({ data, count: data.length, error: null }).then(resolve, reject);
        }
      };
      return builder;
    },
    auth: {
      admin: {
        getUserById(id) {
          return Promise.resolve({
            data: { user: { id, user_metadata: { name: 'Athlete' } } },
            error: null
          });
        }
      }
    }
  };
  return client;
}

function makeActivities(count = 1003) {
  return Array.from({ length: count }, (_, index) => {
    let date = '2026-09-10T12:00:00.000Z';
    if (index === 999 || index === 1000) date = '2026-09-11T12:00:00.000Z';
    if (index === 1001) date = '2026-09-12T12:00:00.000Z';
    if (index === 1002) date = '2026-09-13T12:00:00.000Z';
    return {
      id: `activity-${String(index).padStart(4, '0')}`,
      user_id: USER_ID,
      distance: index >= 1000 ? '50' : '1',
      duration: '1h',
      sport: 'running',
      date
    };
  });
}

function dayNumber(key) {
  const [year, month, day] = key.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
}

// Independent of the production scoring/streak helpers: the fixture uses
// running at 10 points per km and all rows are in September 2026.
function fullSetExpectations(rows) {
  const pointsThisMonth = rows.reduce(
    (total, row) => total + Number(row.distance) * 10,
    0
  );
  const progress = rows.reduce((total, row) => total + Number(row.distance), 0);
  const days = [...new Set(rows.map((row) => row.date.slice(0, 10)))].sort();
  let longestStreak = 0;
  let run = 0;
  for (let index = 0; index < days.length; index++) {
    run = index > 0 && dayNumber(days[index]) - dayNumber(days[index - 1]) === 1
      ? run + 1
      : 1;
    longestStreak = Math.max(longestStreak, run);
  }
  let currentStreak = 0;
  if (days.length && dayNumber('2026-09-13') - dayNumber(days[days.length - 1]) <= 1) {
    currentStreak = 1;
    for (let index = days.length - 1; index > 0; index--) {
      if (dayNumber(days[index]) - dayNumber(days[index - 1]) !== 1) break;
      currentStreak++;
    }
  }
  return { pointsThisMonth, progress, longestStreak, currentStreak };
}

async function runHandler({ activities, failSecondPage = false }) {
  const snapshot = sourceAtRef('WORKTREE');
  const client = makeMockClient({ activities, failSecondPage });
  const { handler } = makeHandler({
    source: snapshot.source,
    sourceName: snapshot.name,
    route: ROUTES.primary,
    client,
    frozenAt: FROZEN_AT
  });
  let body;
  await handler(
    {
      user: {
        id: USER_ID,
        user_metadata: { name: 'Viewer', timezone: 'UTC' }
      }
    },
    {
      json(value) {
        body = value;
      }
    }
  );
  return {
    body: JSON.parse(JSON.stringify(body)),
    client
  };
}

function assertActivityQueryProfile(client, expectedRanges) {
  const activityQueries = client.queryRecords.filter((record) => record.table === 'activities');
  assert.deepEqual(
    activityQueries.map((record) => record.calls),
    expectedRanges.map((range) => [
      ['select', ACTIVITY_PROJECTION, undefined],
      ['range', range[0], range[1]],
      ['eq', 'user_id', USER_ID],
      ['order', 'date', { ascending: true }],
      ['order', 'id', { ascending: true }]
    ])
  );
  activityQueries.forEach((record) => {
    assert.equal(
      record.calls.some(([method, column]) =>
        ['gt', 'gte', 'lte'].includes(method) && column === 'date'
      ),
      false,
      'viewer activity read must not add a date bound'
    );
  });
}

test('GET /api/challenges reads every viewer activity page for progress and stats', async () => {
  const activities = makeActivities();
  assert.equal(activities[999].date, activities[1000].date, 'tie must cross page boundary');
  const expected = fullSetExpectations(activities);
  const firstPageOnly = fullSetExpectations(activities.slice(0, 1000));
  assert.deepEqual(expected, {
    pointsThisMonth: 11500,
    progress: 1150,
    longestStreak: 4,
    currentStreak: 4
  });
  assert.deepEqual(firstPageOnly, {
    pointsThisMonth: 10000,
    progress: 1000,
    longestStreak: 2,
    currentStreak: 0
  });

  const { body, client } = await runHandler({ activities });
  assert.equal(body.pointsThisMonth, expected.pointsThisMonth);
  assert.equal(body.longestStreak, expected.longestStreak);
  assert.equal(body.currentStreak, expected.currentStreak);
  const challenge = body.myChallenges.find((row) => row.id === CHALLENGE_ID);
  assert.ok(challenge);
  assert.equal(challenge.progress, expected.progress);
  assert.equal(challenge.pct, 100);
  assertActivityQueryProfile(client, [[0, 999], [1000, 1999]]);
  assert.deepEqual(client.activityPages.map((page) => page.range), [[0, 999], [1000, 1999]]);
});

test('GET /api/challenges keeps a sub-page read to one range call', async () => {
  const activities = makeActivities().slice(0, 63);
  const expected = fullSetExpectations(activities);
  const { body, client } = await runHandler({ activities });

  assert.equal(body.pointsThisMonth, expected.pointsThisMonth);
  assert.equal(body.longestStreak, expected.longestStreak);
  assert.equal(body.currentStreak, expected.currentStreak);
  assert.equal(body.myChallenges[0].progress, expected.progress);
  assertActivityQueryProfile(client, [[0, 999]]);
  assert.deepEqual(client.activityPages.map((page) => page.range), [[0, 999]]);
});

test('a second activity page failure returns the legacy error without partial stats', async () => {
  const { body, client } = await runHandler({
    activities: makeActivities(),
    failSecondPage: true
  });

  assert.deepEqual(body, { error: 'activity page 2 failed' });
  assertActivityQueryProfile(client, [[0, 999], [1000, 1999]]);
  assert.deepEqual(client.activityPages.map((page) => page.range), [[0, 999], [1000, 1999]]);
});