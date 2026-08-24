#!/usr/bin/env node
// Focused integration verification for explicit club manager dashboards and the
// membership-gated club leaderboard. Run with the app listening on localhost:80.

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const BASE_URL = 'http://localhost:80/html';
const MANIFEST = '/tmp/verify-club-member-leaderboard-manifest.json';
const PW = 'ArenasTest!234';
const TZ = 'America/Los_Angeles';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const emails = {
  manager: 'club-lb-manager@arenas-test.dev',
  viewer: 'club-lb-viewer@arenas-test.dev',
  active: 'club-lb-active@arenas-test.dev',
  opted: 'club-lb-opted@arenas-test.dev',
  prejoin: 'club-lb-prejoin@arenas-test.dev',
  departed: 'club-lb-departed@arenas-test.dev',
  outsider: 'club-lb-outsider@arenas-test.dev'
};
const users = {};
const records = [];
let failures = 0;

function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else {
    failures++;
    const suffix = detail == null ? '' : ' — ' +
      String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 350);
    console.log('FAIL  ' + name + suffix);
  }
}

function saveManifest(entry) {
  records.push(entry);
  const tmp = MANIFEST + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ records }, null, 2));
  fs.renameSync(tmp, MANIFEST);
}

async function deleteUserRows(id) {
  const refs = [
    ['activity_likes', 'user_id'], ['post_likes', 'user_id'],
    ['post_comments', 'user_id'], ['posts', 'user_id'],
    ['follows', 'follower_id'], ['follows', 'following_id'],
    ['event_rsvps', 'user_id'], ['challenge_participants', 'user_id'],
    ['challenge_invites', 'invitee_id'], ['challenge_invites', 'inviter_id'],
    ['club_join_requests', 'user_id'], ['club_invites', 'invited_by'],
    ['notifications', 'actor_id'], ['notifications', 'user_id'],
    ['goals', 'user_id'], ['achievements', 'user_id'],
    ['planned_sessions', 'user_id'], ['contact_messages', 'user_id'],
    ['memberships', 'user_id'], ['activities', 'user_id'], ['profiles', 'id']
  ];
  for (const [table, column] of refs) {
    await admin.from(table).delete().eq(column, id);
  }
}

async function removeStorage(id) {
  const bucket = admin.storage.from('avatars');
  const { data } = await bucket.list('users/' + id, { limit: 1000 });
  if (data && data.length) {
    await bucket.remove(data.map((f) => 'users/' + id + '/' + f.name));
  }
}

async function listAllAuthUsers() {
  const all = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error('list auth users: ' + error.message);
    all.push(...((data && data.users) || []));
    if (!data || data.users.length < 200) break;
    if (page > 100) throw new Error('auth user pagination runaway');
  }
  return all;
}

async function cleanupEntries(entries) {
  const activityIds = entries.filter((x) => x.type === 'activity').map((x) => x.id);
  const subscriptionIds = entries.filter((x) => x.type === 'subscription').map((x) => x.id);
  const clubIds = [...new Set(entries.filter((x) => x.type === 'club').map((x) => x.id))];
  const userIds = [...new Set(entries.filter((x) => x.type === 'user').map((x) => x.id))];

  if (activityIds.length) await admin.from('activities').delete().in('id', activityIds);
  if (subscriptionIds.length) await admin.from('subscriptions').delete().in('id', subscriptionIds);
  for (const clubId of clubIds) {
    await admin.from('notifications').delete().eq('entity_id', clubId);
    await admin.from('club_join_requests').delete().eq('club_id', clubId);
    await admin.from('club_invites').delete().eq('club_id', clubId);
    await admin.from('memberships').delete().eq('club_id', clubId);
    await admin.from('subscriptions').delete().eq('owner_type', 'club').eq('owner_id', clubId);
    await admin.from('clubs').delete().eq('id', clubId);
  }
  for (const id of userIds) {
    await deleteUserRows(id);
    await removeStorage(id);
    await admin.auth.admin.deleteUser(id);
  }
}

async function recoverStaleManifest() {
  if (!fs.existsSync(MANIFEST)) return;
  let stale;
  try {
    stale = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } catch (err) {
    throw new Error('cannot parse stale manifest: ' + err.message);
  }
  console.log('  ok  recovering stale manifest');
  await cleanupEntries(Array.isArray(stale.records) ? stale.records : []);
  fs.rmSync(MANIFEST, { force: true });
}

async function createUser(key, name, extraMeta) {
  const { data, error } = await admin.auth.admin.createUser({
    email: emails[key],
    password: PW,
    email_confirm: true,
    user_metadata: {
      name,
      handle: 'clb_' + key,
      timezone: TZ,
      sports: ['running'],
      ...(extraMeta || {})
    }
  });
  if (error) throw new Error('create user ' + key + ': ' + error.message);
  users[key] = { id: data.user.id };
  saveManifest({ type: 'user', id: data.user.id, email: emails[key] });
}

async function login(key) {
  const response = await fetch(BASE_URL + '/auth/login', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: emails[key], password: PW }).toString()
  });
  const rawCookies = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')];
  const cookie = rawCookies.map((c) => c && String(c).split(';')[0]).filter(Boolean).join('; ');
  if (!cookie) throw new Error('login failed for ' + key + ' (' + response.status + ')');
  users[key].cookie = cookie;
}

async function api(key, method, route, body) {
  const response = await fetch(BASE_URL + '/api' + route, {
    method,
    redirect: 'manual',
    headers: {
      Cookie: users[key].cookie,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const raw = await response.text();
  let json = null;
  try { json = JSON.parse(raw); } catch (err) {}
  return { status: response.status, raw, body: json, location: response.headers.get('location') };
}

async function page(key, route) {
  const response = await fetch(BASE_URL + route, {
    redirect: 'manual',
    headers: { Cookie: users[key].cookie }
  });
  return { status: response.status, raw: await response.text(), location: response.headers.get('location') };
}

async function createClub(name, handle) {
  const result = await api('manager', 'POST', '/clubs/create', {
    name, handle, sport: 'running', city: 'Test City'
  });
  const id = result.body && result.body.redirect &&
    new URL(result.body.redirect, BASE_URL).searchParams.get('club');
  if (!id) throw new Error('create club failed: ' + result.raw);
  saveManifest({ type: 'club', id });
  return id;
}

async function createActivity(userId, title, date, distance) {
  const { data, error } = await admin.from('activities').insert({
    user_id: userId,
    sport: 'running',
    title,
    distance: distance || '1 km',
    duration: '00:10:00',
    date
  }).select('id').single();
  if (error) throw new Error('create activity ' + title + ': ' + error.message);
  saveManifest({ type: 'activity', id: data.id });
  return data.id;
}

function zonedParts(date, zone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
}

function monthBoundaryUtc(zone) {
  const now = new Date();
  const here = zonedParts(now, zone);
  const target = Date.UTC(here.year, here.month - 1, 1, 0, 0, 0);
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const seen = zonedParts(new Date(guess), zone);
    const represented = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
    guess += target - represented;
  }
  return guess;
}

function rowFor(payload, id) {
  return ((payload && payload.leaderboard) || []).find((row) => row.userId === id);
}

async function verifyClean(created) {
  const ids = created.filter((x) => x.type === 'user').map((x) => x.id);
  const clubs = created.filter((x) => x.type === 'club').map((x) => x.id);
  const acts = created.filter((x) => x.type === 'activity').map((x) => x.id);
  let authUsers = [];
  let authError = null;
  try { authUsers = await listAllAuthUsers(); } catch (err) { authError = err; }
  check('cleanup: seeded auth users absent',
    !authError && !authUsers.some((u) => Object.values(emails).includes(u.email)),
    authError && authError.message);
  if (clubs.length) {
    const { data } = await admin.from('clubs').select('id').in('id', clubs);
    check('cleanup: seeded clubs absent', (data || []).length === 0, data);
    const { data: subs } = await admin.from('subscriptions').select('id').in('owner_id', clubs);
    check('cleanup: seeded subscriptions absent', (subs || []).length === 0, subs);
  }
  if (acts.length) {
    const { data } = await admin.from('activities').select('id').in('id', acts);
    check('cleanup: seeded activities absent', (data || []).length === 0, data);
  }
  let storageCount = 0;
  for (const id of ids) {
    const { data } = await admin.storage.from('avatars').list('users/' + id, { limit: 1 });
    storageCount += (data || []).length;
  }
  check('cleanup: seeded user storage absent', storageCount === 0, storageCount);
}

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  await recoverStaleManifest();

  await createUser('manager', 'Club LB Manager');
  await createUser('viewer', 'Club LB Viewer');
  await createUser('active', 'Club LB Active');
  await createUser('opted', 'Club LB Opted', { prefs: { show_on_leaderboards: false } });
  await createUser('prejoin', 'Club LB Prejoin');
  await createUser('departed', 'Club LB Departed');
  await createUser('outsider', 'Club LB Outsider');
  for (const key of Object.keys(users)) await login(key);

  // A is deliberately older than B. Any latest-membership fallback therefore
  // points at B, while every meaningful seeded statistic belongs to A.
  const clubA = await createClub('Club LB Explicit Alpha', 'clblbalpha');
  const clubB = await createClub('Club LB Latest Beta', 'clblbbeta');

  const { data: subscription, error: subscriptionError } = await admin.from('subscriptions').insert({
    owner_type: 'club',
    owner_id: clubA,
    plan: 'club_pro',
    status: 'active',
    stripe_customer_id: 'cus_club_lb_test',
    stripe_subscription_id: 'sub_club_lb_test'
  }).select('id').single();
  if (subscriptionError) throw new Error('create club pro subscription: ' + subscriptionError.message);
  saveManifest({ type: 'subscription', id: subscription.id });

  const joined = [
    { user_id: users.viewer.id, club_id: clubA, role: 'member' },
    { user_id: users.active.id, club_id: clubA, role: 'member' },
    { user_id: users.opted.id, club_id: clubA, role: 'member' },
    { user_id: users.prejoin.id, club_id: clubA, role: 'member' },
    { user_id: users.departed.id, club_id: clubA, role: 'member' }
  ];
  const { error: membershipError } = await admin.from('memberships').insert(joined);
  if (membershipError) throw new Error('create memberships: ' + membershipError.message);

  const boundary = monthBoundaryUtc(TZ);
  await createActivity(users.viewer.id, 'LB just before viewer month', new Date(boundary - 60000).toISOString(), '2 km');
  await createActivity(users.viewer.id, 'LB just inside viewer month', new Date(boundary + 60000).toISOString(), '3 km');
  await createActivity(users.active.id, 'LB recent active', new Date().toISOString(), '4 km');
  await createActivity(users.opted.id, 'LB opted old aggregate', new Date(Date.now() - 10 * 86400000).toISOString(), '5 km');
  await createActivity(users.prejoin.id, 'LB prejoin history', new Date(boundary - 40 * 86400000).toISOString(), '6 km');
  await createActivity(users.departed.id, 'LB departed history', new Date(boundary - 20 * 86400000).toISOString(), '7 km');
  await createActivity(users.viewer.id, 'LB future date excluded', new Date(Date.now() + 10 * 86400000).toISOString(), '9 km');
  await createActivity(users.opted.id, 'LB opted future does not suppress nudge', new Date(Date.now() + 10 * 86400000).toISOString(), '11 km');
  await admin.from('memberships').delete().eq('club_id', clubA).eq('user_id', users.departed.id);

  // 1: explicit manager scope, no fallback, all manager periods retained.
  const dashA = await api('manager', 'GET', '/leaderboard/club-dashboard?clubId=' + clubA + '&period=all');
  const dashB = await api('manager', 'GET', '/leaderboard/club-dashboard?clubId=' + clubB + '&period=all');
  const dashNone = await api('manager', 'GET', '/leaderboard/club-dashboard?period=all');
  check('1: explicit older club selected (not latest membership)',
    dashA.status === 200 && dashA.body && dashA.body.stats.totalMembers === 5 &&
    dashA.body.stats.totalSessions === 5 && dashB.body && dashB.body.stats.totalMembers === 1 &&
    dashB.body.stats.totalSessions === 0,
    { alpha: dashA.body && dashA.body.stats, beta: dashB.body && dashB.body.stats });
  check('1: missing clubId has no latest-membership fallback',
    dashNone.status === 200 && dashNone.raw === JSON.stringify({ error: 'Not authorised' }), dashNone);
  for (const period of ['week', 'month', 'all']) {
    const result = await api('manager', 'GET', '/leaderboard/club-dashboard?clubId=' + clubA + '&period=' + period);
    check('1: manager period ' + period + ' remains supported',
      result.status === 200 && result.body && result.body.period === period && !result.body.error, result);
  }

  // 2 and 3: zero-leak gates and member period contract.
  const fakeId = '00000000-0000-4000-8000-000000000321';
  const inaccessibleApi = await api('outsider', 'GET', '/clubs/' + clubA + '/leaderboard');
  const missingApi = await api('outsider', 'GET', '/clubs/' + fakeId + '/leaderboard');
  check('2: member API inaccessible/nonexistent is byte-identical',
    inaccessibleApi.status === missingApi.status && inaccessibleApi.raw === missingApi.raw, { inaccessibleApi, missingApi });
  const inaccessiblePage = await page('outsider', '/clubs/member/' + clubA + '/leaderboard');
  const missingPage = await page('outsider', '/clubs/member/' + fakeId + '/leaderboard');
  check('2: member page inaccessible/nonexistent is byte-identical',
    inaccessiblePage.status === missingPage.status && inaccessiblePage.raw === missingPage.raw,
    { inaccessible: inaccessiblePage.status + ':' + inaccessiblePage.raw, missing: missingPage.status + ':' + missingPage.raw });
  const softHome = await api('outsider', 'GET', '/clubs/' + clubA + '/member-home');
  check('2: member-home nonmember keeps HTTP 200 soft error',
    softHome.status === 200 && softHome.raw === JSON.stringify({ error: 'Not a member of this club' }), softHome);

  const defaultBoard = await api('viewer', 'GET', '/clubs/' + clubA + '/leaderboard');
  const monthBoard = await api('viewer', 'GET', '/clubs/' + clubA + '/leaderboard?period=month');
  const allBoard = await api('viewer', 'GET', '/clubs/' + clubA + '/leaderboard?period=all');
  const weekBoard = await api('viewer', 'GET', '/clubs/' + clubA + '/leaderboard?period=week');
  check('3: member API defaults to month', defaultBoard.status === 200 && defaultBoard.body.period === 'month', defaultBoard);
  check('3: member API accepts month and all',
    monthBoard.status === 200 && allBoard.status === 200 &&
    monthBoard.body.period === 'month' && allBoard.body.period === 'all', { month: monthBoard.body, all: allBoard.body });
  check('3: member API rejects week',
    weekBoard.status === 400 && weekBoard.raw === JSON.stringify({ error: 'Invalid period' }), weekBoard);

  // 4: viewer-local month cut, current-roster all-time semantics.
  const viewerMonth = rowFor(monthBoard.body, users.viewer.id);
  const viewerAll = rowFor(allBoard.body, users.viewer.id);
  const prejoinAll = rowFor(allBoard.body, users.prejoin.id);
  check('4: month boundary follows viewer timezone',
    viewerMonth && viewerMonth.activityCount === 1 && viewerAll && viewerAll.activityCount === 2,
    { month: viewerMonth, all: viewerAll, boundary: new Date(boundary).toISOString() });
  check('4: future-dated activity is excluded from month and all-time',
    viewerMonth && viewerMonth.points === 30 && viewerAll && viewerAll.points === 50,
    { month: viewerMonth, all: viewerAll });
  check('4: all-time includes pre-join activity for current members',
    prejoinAll && prejoinAll.activityCount === 1, prejoinAll);
  check('4: departed members disappear',
    !rowFor(monthBoard.body, users.departed.id) && !rowFor(allBoard.body, users.departed.id), allBoard.body.leaderboard);

  // 5 and 6: opt-out affects rankings, never private management aggregates/risk.
  const optedHome = await api('opted', 'GET', '/clubs/' + clubA + '/member-home');
  check('5: opted-out member absent from member boards',
    !rowFor(monthBoard.body, users.opted.id) && !rowFor(allBoard.body, users.opted.id), allBoard.body.leaderboard);
  check('5: opted-out viewer has no member-home standing',
    optedHome.status === 200 && optedHome.body && optedHome.body.standing.rank === null &&
    optedHome.body.standing.total === 4 && optedHome.body.standing.points === 0, optedHome.body && optedHome.body.standing);
  check('5: opted-out member absent from manager distance/session rows',
    !((dashA.body.byDistance || []).some((r) => r.userId === users.opted.id)) &&
    !((dashA.body.bySessions || []).some((r) => r.userId === users.opted.id)), dashA.body);
  check('6: manager aggregates still include opted-out activity',
    dashA.body.stats.totalMembers === 5 && dashA.body.stats.totalSessions === 5 &&
    dashA.body.stats.totalKm === 20, dashA.body.stats);
  check('6: manager rankings and aggregates exclude future activities',
    dashA.body.stats.totalSessions === 5 && dashA.body.stats.totalKm === 20 &&
    (dashA.body.byDistance || []).find((r) => r.userId === users.viewer.id).totalKm === 5,
    dashA.body);
  check('6: opted-out inactive member remains at-risk',
    (dashA.body.atRisk || []).some((r) => r.userId === users.opted.id), dashA.body.atRisk);
  const nudge = await api('manager', 'POST', '/clubs/' + clubA + '/nudge-atrisk');
  const { data: optedNudges } = await admin.from('notifications')
    .select('id').eq('user_id', users.opted.id).eq('entity_id', clubA).eq('type', 'club');
  check('6: nudge includes opted-out inactive member',
    nudge.status === 200 && nudge.body && nudge.body.success && (optedNudges || []).length === 1,
    { nudge: nudge.body, optedNudges });

  // 7: member home consumes the canonical month board result.
  const viewerHome = await api('viewer', 'GET', '/clubs/' + clubA + '/member-home');
  check('7: member-home standing equals month board viewer result',
    viewerHome.status === 200 && viewerHome.body && monthBoard.body.viewer &&
    viewerHome.body.standing.rank === monthBoard.body.viewer.rank &&
    viewerHome.body.standing.total === monthBoard.body.viewer.total &&
    viewerHome.body.standing.points === monthBoard.body.viewer.points &&
    viewerHome.body.standing.period === 'month', { home: viewerHome.body && viewerHome.body.standing, board: monthBoard.body.viewer });

  // 8: verify the actual membership-gated HTML, not merely the source template.
  const currentPage = await page('viewer', '/clubs/member/' + clubA + '/leaderboard');
  const count = (text, needle) => (text.match(new RegExp(needle, 'g')) || []).length;
  check('8: current-member page has exactly month/all and no week',
    currentPage.status === 200 &&
    count(currentPage.raw, '>This month<') === 1 &&
    count(currentPage.raw, '>All time<') === 1 &&
    count(currentPage.raw, '>This week<') === 0,
    { status: currentPage.status, month: count(currentPage.raw, '>This month<'), all: count(currentPage.raw, '>All time<'), week: count(currentPage.raw, '>This week<') });
  await admin.from('memberships').delete().eq('club_id', clubA).eq('user_id', users.viewer.id);
  const removedApi = await api('viewer', 'GET', '/clubs/' + clubA + '/leaderboard');
  const removedPage = await page('viewer', '/clubs/member/' + clubA + '/leaderboard');
  check('8: removed member fails closed on API and page',
    removedApi.status === 404 && removedPage.status === 404,
    { api: removedApi.status + ':' + removedApi.raw, page: removedPage.status + ':' + removedPage.raw });

  // 9: guard the independent global weekly board and server's canonical branch.
  const htmlRoot = path.join(__dirname, '..');
  const globalSource = fs.readFileSync(path.join(htmlRoot, 'html', 'arenas-leaderboards.html'), 'utf8');
  const serverSource = fs.readFileSync(path.join(htmlRoot, 'server.js'), 'utf8');
  check('9: global leaderboard remains weekly',
    /state\s*=\s*\{\s*scope:\s*'platform',\s*period:\s*'week'/.test(globalSource) &&
    globalSource.includes("setPeriod('week', this)") &&
    globalSource.includes('weekly board starts fresh every Monday'), null);
  check('9: canonical server week branch still exists',
    serverSource.includes("if (period === 'week')") &&
    serverSource.includes('weekStartKey(now, zone)') &&
    serverSource.includes("fetchActivitiesForUsers(userIds, period, sport"), null);
  const apiStart = serverSource.indexOf("app.get(BASE + '/api/clubs/:clubId/leaderboard'");
  const apiEnd = serverSource.indexOf("// Club dashboard leaderboard", apiStart);
  const pageStart = serverSource.indexOf("app.get(BASE + '/clubs/member/:clubId/leaderboard'");
  const pageEnd = serverSource.indexOf("app.get(BASE + '/clubs/member/:clubId'", pageStart + 1);
  const countMembershipChecks = (source) => (source.match(/getCurrentClubMembership\(/g) || []).length;
  check('9: member API and page revalidate membership before send',
    countMembershipChecks(serverSource.slice(apiStart, apiEnd)) === 2 &&
    countMembershipChecks(serverSource.slice(pageStart, pageEnd)) === 2, null);
}

(async () => {
  let created = [];
  try {
    await run();
  } catch (err) {
    failures++;
    console.log('FAIL  fatal — ' + err.message);
  } finally {
    created = records.slice();
    for (const user of Object.values(users)) {
      if (!user.cookie) continue;
      try {
        await fetch(BASE_URL + '/auth/logout', {
          redirect: 'manual',
          headers: { Cookie: user.cookie }
        });
      } catch (err) {}
    }
    try {
      await cleanupEntries(created);
      fs.rmSync(MANIFEST, { force: true });
      await verifyClean(created);
    } catch (err) {
      failures++;
      console.log('FAIL  cleanup — ' + err.message);
    }
    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
    process.exitCode = failures ? 1 : 0;
  }
})();