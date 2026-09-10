const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {
  addDaysToKey,
  dateParts,
  dayKey,
  isValidTimezone,
  keyToEpochDays,
  monthKey,
  weekStartKey,
  zoneMidnightUtc
} = require('./tzdate');

const source = fs.readFileSync(require.resolve('./server.js'), 'utf8');
const profileSource = fs.readFileSync(require.resolve('./html/arenas-my-profile.html'), 'utf8');

function functionSourceFrom(text, name) {
  let start = text.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  if (text.slice(start - 6, start) === 'async ') start -= 6;
  const paramsStart = text.indexOf('(', start);
  let paramsDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < text.length; index++) {
    if (text[index] === '(') paramsDepth++;
    if (text[index] === ')' && --paramsDepth === 0) {
      bodyStart = text.indexOf('{', index);
      break;
    }
  }
  assert.notEqual(bodyStart, -1, `missing body for ${name}`);
  let depth = 0;
  for (let index = bodyStart; index < text.length; index++) {
    if (text[index] === '{') depth++;
    if (text[index] === '}' && --depth === 0) return text.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

function loadFunctions(names, globals) {
  const context = vm.createContext({ ...globals });
  vm.runInContext(`${names.map((name) => functionSourceFrom(source, name)).join('\n')}\nthis.result = { ${names.join(',')} };`, context);
  return context.result;
}

test('AI context passes its frozen clock through every clock-reading helper chain', () => {
  assert.match(source, /computeStreaks\(acts, tz, now\.getTime\(\)\)/);
  assert.match(source, /fetchActivitiesForUsers\(platformIds, 'month', 'all', tz, \{ capAtNow: true, now \}\)/);
  assert.match(source, /buildClubPointsLeaderboard\(safeRows, profileMap, 'month', user, \{ now \}\)/);
  assert.match(source, /enrichGoalRows\(user\.id, activeGoalsRes\.data \|\| \[\], tz, \{\s+includeRecentHistory: true,\s+now\s+\}\)/);
  assert.doesNotMatch(source, /includeRecentHistory: true,\s+now,\s+dayStablePace:/);
  assert.match(source, /goalWindow\(goal, tz, now\)/);
  assert.match(source, /recentGoalHistory\(goal, activities, streaks, tz, now\)/);
});

test('Goals API and AI context have day-rounded onTrack parity at the injected clock', async () => {
  class GuardedDate extends Date {
    constructor(...args) {
      assert.notEqual(args.length, 0, 'helper read an independent clock');
      super(...args);
    }

    static now() {
      throw new Error('helper called Date.now');
    }
  }
  const activityQueryCalls = [];
  let queriedActivities = [];
  const activityQuery = {
    select(columns) {
      activityQueryCalls.push(['select', columns]);
      return this;
    },
    eq(column, value) {
      activityQueryCalls.push(['eq', column, value]);
      return this;
    },
    in(column, value) {
      activityQueryCalls.push(['in', column, value]);
      return this;
    },
    gte(column, value) {
      activityQueryCalls.push(['gte', column, value]);
      return this;
    },
    lte(column, value) {
      activityQueryCalls.push(['lte', column, value]);
      return this;
    },
    order(column, options) {
      activityQueryCalls.push(['order', column, options]);
      return this;
    },
    then(resolve) {
      return Promise.resolve({ data: queriedActivities }).then(resolve);
    }
  };
  const { getDateRange, buildClubPointsLeaderboard, goalWindow, goalProgressInWindow, priorClosedGoalWindows, recentGoalHistory, enrichGoal, enrichGoalRows } = loadFunctions(
    ['getDateRange', 'fetchActivitiesForUsers', 'bucketActivities', 'buildClubPointsLeaderboard', 'goalWindow', 'goalNaturalUnit', 'goalProgressInWindow', 'priorClosedGoalWindows', 'recentGoalHistory', 'enrichGoal', 'enrichGoalRows'],
    {
      Date: GuardedDate,
      MI_TO_KM: 1.609,
      DISTANCE_SPORTS: [],
      addDaysToKey,
      dateParts,
      dayKey,
      isValidTimezone,
      keyToEpochDays,
      monthKey,
      weekStartKey,
      zoneMidnightUtc,
      computeStreaks: (activities, tz, nowMs) => {
        assert.notEqual(nowMs, undefined, 'sport streak omitted the frozen clock');
        return { currentStreak: 1 };
      },
      supabaseAdmin: {
        from(table) {
          assert.equal(table, 'activities');
          return activityQuery;
        }
      },
      getUserTimezone: () => 'America/Los_Angeles',
      calculatePoints: () => 0,
      parseDistanceKmUnitAware: () => 0,
      parseDurationHours: () => 0
    }
  );
  const goal = {
    id: 'goal',
    type: 'frequency',
    sport: null,
    target_value: 31,
    period: 'monthly',
    start_date: '2026-03-01',
    end_date: null,
    status: 'active',
    created_at: '2026-03-01T00:00:00Z',
    unit: null
  };
  const activities = Array.from({ length: 7 }, (_, index) => ({
    sport: 'running',
    date: `2026-03-${String(index + 1).padStart(2, '0')}T12:00:00Z`
  }));
  queriedActivities = activities;
  const early = enrichGoal(goal, activities, { currentStreak: 0 }, 'America/Los_Angeles', {
    now: new Date('2026-03-08T08:01:00Z')
  });
  const late = enrichGoal(goal, activities, { currentStreak: 0 }, 'America/Los_Angeles', {
    now: new Date('2026-03-09T06:59:00Z')
  });
  assert.equal(early.onTrack, true);
  assert.equal(late.onTrack, early.onTrack);

  const injectedNow = new Date('2026-03-08T12:00:00Z');
  assert.equal(getDateRange('month', 'America/Los_Angeles', injectedNow).end, injectedNow.toISOString());
  assert.equal(goalWindow(goal, 'America/Los_Angeles', injectedNow).startKey, '2026-03-01');
  assert.equal(priorClosedGoalWindows({ ...goal, period: 'weekly' }, 'America/Los_Angeles', injectedNow).length, 3);
  recentGoalHistory({
    ...goal,
    period: 'weekly',
    start_date: '2026-01-01',
    created_at: '2026-01-01T00:00:00Z'
  }, activities, { currentStreak: 0 }, 'America/Los_Angeles', injectedNow);
  const streakWindow = goalWindow({ ...goal, period: 'weekly' }, 'America/Los_Angeles', injectedNow);
  goalProgressInWindow({
    ...goal,
    type: 'streak',
    sport: 'running'
  }, activities, { currentStreak: 0 }, 'America/Los_Angeles', streakWindow, injectedNow.getTime());
  await enrichGoalRows('user-1', [goal], 'America/Los_Angeles', {
    includeRecentHistory: true,
    now: injectedNow
  });
  assert.deepEqual(activityQueryCalls.map((call) => call.slice(0, 2)), [
    ['select', 'id, sport, distance, duration, date'],
    ['eq', 'user_id'],
    ['order', 'date'],
    ['order', 'id']
  ]);
  assert.equal(activityQueryCalls[1][2], 'user-1');
  assert.equal(activityQueryCalls[2][2].ascending, true);
  assert.equal(activityQueryCalls[3][2].ascending, true);

  // This is the old divergence point: at local midday on March 8, seven of
  // 31 sessions satisfies seven completed calendar days, but not 7.5 elapsed
  // continuous days. Exercise the real shared row enricher exactly as the
  // Goals API and AI context call it, with only their production option
  // difference (AI requests recent history).
  activityQueryCalls.length = 0;
  queriedActivities = activities;
  const frozenMidday = new Date('2026-03-08T20:00:00Z');
  const [goalsApiGoal] = await enrichGoalRows('user-1', [goal], 'America/Los_Angeles', {
    now: frozenMidday
  });
  const [aiContextGoal] = await enrichGoalRows('user-1', [goal], 'America/Los_Angeles', {
    includeRecentHistory: true,
    now: frozenMidday
  });
  const oldContinuousResult = enrichGoal(
    goal,
    activities,
    { currentStreak: 0 },
    'America/Los_Angeles',
    { now: frozenMidday, dayStablePace: false }
  );
  assert.equal(oldContinuousResult.onTrack, false, 'fixture must distinguish the retired continuous-time default');
  assert.equal(goalsApiGoal.onTrack, true);
  assert.equal(aiContextGoal.onTrack, goalsApiGoal.onTrack);
  for (const field of [
    'progress', 'target', 'pct', 'isComplete', 'state', 'daysRemaining',
    'windowStart', 'windowEnd', 'projection'
  ]) {
    assert.equal(aiContextGoal[field], goalsApiGoal[field], `${field} changed between API and AI context`);
  }

  activityQueryCalls.length = 0;
  queriedActivities = [];
  const board = await buildClubPointsLeaderboard([
    { user_id: 'member-b' },
    { user_id: 'member-a' }
  ], {
    'member-a': { name: 'A', prefs: { show_on_leaderboards: true } },
    'member-b': { name: 'B', prefs: { show_on_leaderboards: true } }
  }, 'month', { id: 'member-a' }, { now: injectedNow });
  assert.deepEqual([...board.leaderboard].map((row) => row.userId), ['member-b', 'member-a']);
  assert.equal(activityQueryCalls.find((call) => call[0] === 'lte')[2], injectedNow.toISOString());
});

test('real Goals card and Overview mini-card render the day-rounded pace label', async () => {
  const { goalWindow, goalProgressInWindow, enrichGoal } = loadFunctions(
    ['goalWindow', 'goalProgressInWindow', 'enrichGoal'],
    {
      Date,
      MI_TO_KM: 1.609,
      DISTANCE_SPORTS: [],
      addDaysToKey,
      dateParts,
      dayKey,
      keyToEpochDays,
      weekStartKey,
      zoneMidnightUtc,
      computeStreaks: () => ({ currentStreak: 0 }),
      parseDistanceKmUnitAware: () => 0,
      parseDurationHours: () => 0
    }
  );
  const goal = {
    id: 'pace-parity',
    type: 'frequency',
    sport: 'running',
    target_value: 31,
    period: 'monthly',
    start_date: '2026-03-01',
    end_date: null,
    status: 'active',
    created_at: '2026-03-01T00:00:00Z',
    unit: null
  };
  const activities = Array.from({ length: 7 }, (_, index) => ({
    sport: 'running',
    date: `2026-03-${String(index + 1).padStart(2, '0')}T12:00:00Z`
  }));
  const apiGoal = enrichGoal(
    goal,
    activities,
    { currentStreak: 0 },
    'America/Los_Angeles',
    { now: new Date('2026-03-08T20:00:00Z') }
  );
  assert.equal(apiGoal.onTrack, true);

  // Run the actual Goals-tab formatter and card renderer extracted from the
  // shipped profile page, rather than reproducing its label ternary.
  const goalRenderer = vm.createContext({
    Date,
    window: {},
    SPORT_META: { running: ['🏃', 'Running'] },
    TYPE_ICONS: { distance: '📏', frequency: '🔁', duration: '⏱', streak: '🔥' }
  });
  const goalRendererNames = ['fmtNum', 'unitWord', 'fmtLocalDate', 'goalTitle', 'periodChip', 'goalIcon', 'goalCard'];
  vm.runInContext(
    `${goalRendererNames.map((name) => functionSourceFrom(profileSource, name)).join('\n')}
     this.renderGoalCard = goalCard;
     this.goalFormat = { title: goalTitle, unit: unitWord, icon: goalIcon, num: fmtNum };`,
    goalRenderer
  );
  const goalsCardHtml = goalRenderer.renderGoalCard(apiGoal, false);
  assert.match(goalsCardHtml, />On pace<\/span>/);
  assert.doesNotMatch(goalsCardHtml, />Behind pace<\/span>/);

  // Run the real async Overview renderer against a tiny in-memory browser and
  // API harness. No server, database fixture, or staged browser evidence is
  // involved.
  const body = { innerHTML: '' };
  const responses = {
    '/api/profile/overview': {
      week: { activities: 0, km: 0, hours: 0, points: 0 },
      dayStrip: [],
      currentStreak: 0,
      activityGrid: null,
      activeChallenges: [],
      upcomingRsvps: [],
      recentActivities: []
    },
    '/api/profile/achievements': { earnedCount: 0 },
    '/api/goals': { active: [apiGoal], archived: [] }
  };
  const browserWindow = {
    BASE: '',
    ARENAS_SPORT_ICONS: { running: '🏃' },
    ARENAS_SPORTS: [{ id: 'running', colors: { bg: '#eee' } }],
    __goalFmt: goalRenderer.goalFormat,
    buildFourWeekActivityGridHtml: () => ''
  };
  const overviewHarness = vm.createContext({
    Date,
    window: browserWindow,
    document: { getElementById: (id) => id === 'po-body' ? body : null },
    fetch: async (url) => ({ json: async () => responses[url] })
  });
  const overviewRendererSource = functionSourceFrom(profileSource, 'loadProfileOverview').replace(
    /} catch \(err\) \{\s+body\.innerHTML = '<div style="padding:40px;text-align:center;font-size:13px;color:var\(--gray-400\)">Could not load overview\.<\/div>';\s+}/,
    '} catch (err) { throw err; }'
  );
  vm.runInContext(
    `var OV_BASE = window.BASE || '';
     ${functionSourceFrom(profileSource, 'escOv')}
     ${overviewRendererSource}
     this.renderOverview = loadProfileOverview;`,
    overviewHarness
  );
  await overviewHarness.renderOverview();
  assert.match(body.innerHTML, />On pace<\/span>/);
  assert.doesNotMatch(body.innerHTML, />Behind pace<\/span>/);
});

test('personal-record ties prefer earlier date and then sport id', () => {
  const { buildAiPersonalRecords } = loadFunctions(['buildAiPersonalRecords'], {
    parseDistanceKmUnitAware: (value) => Number(value) || 0,
    parseDurationHours: (value) => Number(value) || 0,
    round1: (value) => Math.round(value * 10) / 10,
    dayKey
  });
  const earlierWins = buildAiPersonalRecords([
    { sport: 'cycling', duration: 2, distance: 0, date: '2026-04-02T12:00:00Z' },
    { sport: 'running', duration: 2, distance: 0, date: '2026-04-01T12:00:00Z' }
  ], 'UTC').find((record) => record.type === 'longest_activity');
  assert.equal(earlierWins.sport, 'running');

  const sportWins = buildAiPersonalRecords([
    { sport: 'running', duration: 2, distance: 0, date: '2026-04-01T12:00:00Z' },
    { sport: 'cycling', duration: 2, distance: 0, date: '2026-04-01T12:00:00Z' }
  ], 'UTC').find((record) => record.type === 'longest_activity');
  assert.equal(sportWins.sport, 'cycling');
});

test('AI context queries and weekly sport buckets pin tie ordering', () => {
  assert.match(source, /\.order\('date', \{ ascending: true \}\)\s+\.order\('id', \{ ascending: true \}\)/);
  assert.match(source, /Object\.values\(bySportMap\)\.sort\(\(a, b\) => a\.sport\.localeCompare\(b\.sport\)\)/);
  assert.match(source, /\.order\('created_at', \{ ascending: true \}\)\.order\('id', \{ ascending: true \}\)\.limit\(5\)/);
  assert.match(source, /\.eq\('user_id', user\.id\)\s+\.order\('club_id', \{ ascending: true \}\)/);
  assert.match(source, /\.order\('created_at', \{ ascending: true \}\)\.order\('user_id', \{ ascending: true \}\)/);
  assert.match(source, /if \(includeRecentHistory\) \{\s+activityQuery = activityQuery\.order\('date', \{ ascending: true \}\)\.order\('id', \{ ascending: true \}\)/);
});