'use strict';

// Focused, seed-free contract tests for the Friends-in-challenges rail.
// The route itself is intentionally not required here: server.js starts the
// HTTP listener at module load and needs a live auth/database configuration.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const SERVER_SOURCE = fs.readFileSync(
  path.join(__dirname, 'server.js'),
  'utf8'
);
const FRIENDS_MARKER = '// ── "Friends in challenges"';
const friendsStart = SERVER_SOURCE.indexOf(FRIENDS_MARKER);
const friendsTryStart = SERVER_SOURCE.indexOf('    try {', friendsStart);
const friendsEnd = SERVER_SOURCE.indexOf(
  '\n\n    res.json({',
  friendsTryStart
);
assert.ok(friendsStart >= 0 && friendsTryStart >= 0 && friendsEnd >= 0,
  'Friends route block must remain extractable for its focused tests');
const FRIENDS_ROUTE_BLOCK = SERVER_SOURCE.slice(friendsTryStart, friendsEnd);

// Execute the production route block as-is. Only its database client and
// existing helpers are supplied by the fixture; the grouping/progress logic is
// never reimplemented in this test file.
async function runFriendsBlock({
  supabaseAdmin,
  fetchAllRows,
  buildUserProfileMap,
  memberZone,
  challengeHasEnded,
  challengeFetchRange,
  actsInChallengeWindow,
  computeChallengeProgress,
  userId = 'viewer',
  viewerTz = 'America/Los_Angeles'
}) {
  const context = {
    supabaseAdmin,
    fetchAllRows,
    buildUserProfileMap,
    memberZone,
    challengeHasEnded,
    challengeFetchRange,
    actsInChallengeWindow,
    computeChallengeProgress,
    userId,
    viewerTz,
    console: { log() {} }
  };
  const script = new vm.Script(`(async () => {
    let friendsInChallenges = [], followsAnyone = false;
    ${FRIENDS_ROUTE_BLOCK}
    return { friendsInChallenges, followsAnyone };
  })()`);
  return script.runInNewContext(context);
}

function makeSupabase({ follows, participants, challenges }) {
  const rowsByTable = {
    follows,
    challenge_participants: participants,
    challenges
  };
  const calls = [];
  return {
    calls,
    from(table) {
      let rows = [...(rowsByTable[table] || [])];
      const builder = {
        select(columns) {
          calls.push({ table, method: 'select', columns });
          return this;
        },
        in(column, values) {
          calls.push({ table, method: 'in', column, values });
          rows = rows.filter((row) => values.includes(row[column]));
          return this;
        },
        eq(column, value) {
          calls.push({ table, method: 'eq', column, value });
          rows = rows.filter((row) => row[column] === value);
          return this;
        },
        order(column, { ascending }) {
          calls.push({ table, method: 'order', column, ascending });
          rows.sort((a, b) => {
            const delta = new Date(a[column]) - new Date(b[column]);
            return ascending ? delta : -delta;
          });
          return this;
        },
        then(resolve, reject) {
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        }
      };
      return builder;
    }
  };
}

function makeHelpers({ profiles, activityRows, nowIso, fetchCalls, zoneCalls = [] }) {
  const challengeHasEnded = (challenge, tz) => (
    dayKey(nowIso, tz) > dayKey(challenge.end_date, 'UTC')
  );
  const challengeFetchRange = (challenge) => ({
    gteIso: new Date(new Date(challenge.start_date).getTime() - 86400000).toISOString(),
    lteIso: new Date(new Date(challenge.end_date).getTime() + 86400000).toISOString()
  });
  const actsInChallengeWindow = (activities, challenge, tz) => {
    zoneCalls.push({ helper: 'window', challengeId: challenge.id, tz });
    const startMs = new Date(challenge.start_date).getTime();
    const endMs = new Date(challenge.end_date).getTime();
    return (activities || []).filter((activity) => {
      const at = new Date(activity.date).getTime();
      return at >= startMs && at <= endMs;
    });
  };
  const computeChallengeProgress = (challenge, activities, tz) => {
    zoneCalls.push({ helper: 'progress', challengeId: challenge.id, tz });
    if (challenge.goal_type !== 'distance') return 0;
    return (activities || []).reduce((sum, activity) => {
      if (challenge.sport !== 'any' && activity.sport !== challenge.sport) return sum;
      return sum + Number.parseFloat(activity.distance || 0);
    }, 0);
  };
  return {
    fetchAllRows: async (table, applyFilters, columns) => {
      const queryCalls = [];
      const query = {
        in(column, values) {
          queryCalls.push(['in', column, values]);
          return this;
        },
        gte(column, value) {
          queryCalls.push(['gte', column, value]);
          return this;
        },
        lte(column, value) {
          queryCalls.push(['lte', column, value]);
          return this;
        }
      };
      applyFilters(query);
      fetchCalls.push({ table, columns, queryCalls });
      return activityRows;
    },
    buildUserProfileMap: async (ids) => Object.fromEntries(
      ids.map((id) => [id, profiles[id] || { name: 'Athlete', timezone: 'UTC' }])
    ),
    memberZone: (profile) => profile && profile.timezone ? profile.timezone : 'UTC',
    challengeHasEnded,
    challengeFetchRange,
    actsInChallengeWindow,
    computeChallengeProgress
  };
}

function dayKey(iso, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

test('Friends block uses public goal/window fields, end-date ordering, and paged activities', () => {
  const friendsBlock = FRIENDS_ROUTE_BLOCK;
  assert.match(
    friendsBlock,
    /\.select\('id, title, sport, goal_type, goal_target, goal_unit, start_date, end_date'\)/
  );
  assert.match(friendsBlock, /\.eq\('visibility', 'public'\)/);
  assert.match(friendsBlock, /\.order\('end_date', \{ ascending: false \}\)/);
  assert.match(friendsBlock, /fetchAllRows\(\s*'activities'/);
  assert.match(friendsBlock, /computeChallengeProgress\(/);
  assert.match(friendsBlock, /actsInChallengeWindow\(/);
});

test('Friends block applies viewer-day expiration, participant completion, and sorted moreCount', async () => {
  const nowIso = '2026-08-06T23:30:00.000Z';
  const challenges = [
    // End-day is still active in Los Angeles (the viewer zone), but ended in
    // Tokyo at this instant. The second invocation below proves that boundary.
    {
      id: 'ends-today',
      title: 'Ends today',
      sport: 'run',
      goal_type: 'distance',
      goal_target: 10,
      start_date: '2026-08-01T00:00:00.000Z',
      end_date: '2026-08-06T00:00:00.000Z',
      visibility: 'public'
    },
    {
      id: 'latest',
      title: 'Latest active',
      sport: 'run',
      goal_type: 'distance',
      goal_target: 10,
      start_date: '2026-08-01T00:00:00.000Z',
      end_date: '2026-08-10T00:00:00.000Z',
      visibility: 'public'
    },
    {
      id: 'middle',
      title: 'Middle active',
      sport: 'run',
      goal_type: 'distance',
      goal_target: 10,
      start_date: '2026-08-01T00:00:00.000Z',
      end_date: '2026-08-08T00:00:00.000Z',
      visibility: 'public'
    },
    {
      id: 'ended',
      title: 'Ended',
      sport: 'run',
      goal_type: 'distance',
      goal_target: 1,
      start_date: '2026-07-01T00:00:00.000Z',
      end_date: '2026-08-05T00:00:00.000Z',
      visibility: 'public'
    },
    {
      id: 'private',
      title: 'Private',
      sport: 'run',
      goal_type: 'distance',
      goal_target: 1,
      start_date: '2026-08-01T00:00:00.000Z',
      end_date: '2026-08-10T00:00:00.000Z',
      visibility: 'private'
    }
  ];
  // Deliberately not challenge order: production grouping must iterate the
  // ordered challenge rows, not the participant-row order.
  const participants = [
    { challenge_id: 'middle', user_id: 'friend-a' },
    { challenge_id: 'latest', user_id: 'friend-a' },
    { challenge_id: 'ends-today', user_id: 'friend-a' },
    { challenge_id: 'latest', user_id: 'friend-b' },
    { challenge_id: 'middle', user_id: 'friend-b' },
    { challenge_id: 'ended', user_id: 'friend-c' },
    { challenge_id: 'private', user_id: 'friend-c' }
  ];
  const activityRows = [
    // 1,000 earlier rows must not hide this later completion row.
    ...Array.from({ length: 1000 }, () => ({
      user_id: 'friend-a', distance: '0', sport: 'run', date: '2026-08-02T00:00:00.000Z'
    })),
    { user_id: 'friend-a', distance: '10', sport: 'run', date: '2026-08-09T00:00:00.000Z' },
    { user_id: 'friend-b', distance: '2', sport: 'run', date: '2026-08-03T00:00:00.000Z' }
  ];
  const supabaseAdmin = makeSupabase({
    follows: [
      { follower_id: 'viewer', following_id: 'friend-a' },
      { follower_id: 'viewer', following_id: 'friend-b' },
      { follower_id: 'viewer', following_id: 'friend-c' }
    ],
    participants,
    challenges
  });
  const fetchCalls = [];
  const zoneCalls = [];
  const helpers = makeHelpers({
    profiles: {
      'friend-a': { name: 'A', timezone: 'America/Los_Angeles', profilePublic: true },
      'friend-b': { name: 'B', timezone: 'America/New_York', profilePublic: true },
      'friend-c': { name: 'C', timezone: 'UTC', profilePublic: true }
    },
    activityRows,
    nowIso,
    fetchCalls,
    zoneCalls
  });
  const result = await runFriendsBlock({ supabaseAdmin, ...helpers });

  // friend-a completed latest (the row after the first 1000), so only the
  // middle and end-day challenges remain; end-date order picks middle.
  const friendA = result.friendsInChallenges.find((row) => row.id === 'friend-a');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(friendA)), {
    id: 'friend-a',
    name: 'A',
    avatar_url: null,
    profilePublic: true,
    sport: 'run',
    challengeTitle: 'Middle active',
    moreCount: 1
  });
  // friend-b has not completed either challenge; latest must be shown and the
  // older active challenge must count once.
  const friendB = result.friendsInChallenges.find((row) => row.id === 'friend-b');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(friendB)), {
    id: 'friend-b',
    name: 'B',
    avatar_url: null,
    profilePublic: true,
    sport: 'run',
    challengeTitle: 'Latest active',
    moreCount: 1
  });
  assert.equal(result.friendsInChallenges.some((row) => row.id === 'friend-c'), false);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].table, 'activities');
  assert.equal(fetchCalls[0].columns, 'user_id, distance, duration, sport, date');
  assert.deepStrictEqual(fetchCalls[0].queryCalls[0][0], 'in');
  assert.ok(zoneCalls.some((call) => (
    call.helper === 'window' &&
    call.challengeId === 'middle' &&
    call.tz === 'America/Los_Angeles'
  )));
  assert.ok(zoneCalls.some((call) => (
    call.helper === 'progress' &&
    call.challengeId === 'latest' &&
    call.tz === 'America/New_York'
  )));
});

test('Friends block honors end-day expiration in the viewer zone', async () => {
  const challenge = {
    id: 'ends-today',
    title: 'Ends today',
    sport: 'run',
    goal_type: 'distance',
    goal_target: 10,
    start_date: '2026-08-01T00:00:00.000Z',
    end_date: '2026-08-06T00:00:00.000Z',
    visibility: 'public'
  };
  const supabaseAdmin = makeSupabase({
    follows: [{ follower_id: 'viewer', following_id: 'friend' }],
    participants: [{ challenge_id: challenge.id, user_id: 'friend' }],
    challenges: [challenge]
  });
  const fetchCalls = [];
  const helpers = makeHelpers({
    profiles: { friend: { name: 'Friend', timezone: 'UTC', profilePublic: true } },
    activityRows: [],
    nowIso: '2026-08-06T23:30:00.000Z',
    fetchCalls
  });

  const pacific = await runFriendsBlock({
    supabaseAdmin,
    ...helpers,
    viewerTz: 'America/Los_Angeles'
  });
  assert.equal(pacific.friendsInChallenges.length, 1);

  const tokyo = await runFriendsBlock({
    supabaseAdmin,
    ...helpers,
    viewerTz: 'Asia/Tokyo'
  });
  assert.equal(tokyo.friendsInChallenges.length, 0);
  assert.equal(fetchCalls.length, 1, 'ended challenge must not fetch activities');
});