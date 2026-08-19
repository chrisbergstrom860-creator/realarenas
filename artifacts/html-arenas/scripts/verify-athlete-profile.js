// Seeded verification of the public athlete profile page (/athletes/:userId)
// — the access matrix the feature was scoped around:
//   - viewer V sees normal athlete N: identity, public stats (shared-helper
//     computation), activities, earned badge, PUBLIC club; N's PRIVATE club
//     name must be ABSENT (zero-leak, same standard as the club directory)
//   - opted-out athlete O (show_on_leaderboards=false), a random UUID, and a
//     DELETED account all return BYTE-IDENTICAL not-found bodies (404)
//   - private-training athlete P (activity_feed_visible=false): identity +
//     trophy case + clubs + follow counts render, the private-state copy
//     shows, and P's activity titles / training stats are absent
//   - self → 302 /profile; unauthenticated → 302 /landing
//   - no PR / personal-record strings anywhere (visitors get no PRs)
// Run with the dev server up:
//   node artifacts/html-arenas/scripts/verify-athlete-profile.js
// Cleanup is built in (also covered by scripts/test-data-sweep.js --delete).

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const BASE_URL = 'http://localhost:80/html';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const PW = 'ArenasTest!234';
const emails = {
  v: 'athprof-viewer@arenas-test.dev',
  n: 'athprof-normal@arenas-test.dev',
  o: 'athprof-optout@arenas-test.dev',
  p: 'athprof-private@arenas-test.dev',
  d: 'athprof-deleted@arenas-test.dev'
};
const names = {
  v: ['Athprof Viewer', 'athprof_viewer'],
  n: ['Athprof Normal', 'athprof_normal'],
  o: ['Athprof Optout', 'athprof_optout'],
  p: ['Athprof Private', 'athprof_private'],
  d: ['Athprof Deleted', 'athprof_deleted']
};

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail ? ' — ' + String(detail).slice(0, 400) : '')); }
}

async function deleteUserByEmail(email) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of (data && data.users) || []) {
    if (u.email === email) await admin.auth.admin.deleteUser(u.id);
  }
}

const users = {}; // key → { id, cookie }

async function mkUser(key, extraMeta) {
  await deleteUserByEmail(emails[key]);
  const { data, error } = await admin.auth.admin.createUser({
    email: emails[key], password: PW, email_confirm: true,
    user_metadata: Object.assign({ name: names[key][0], handle: names[key][1] }, extraMeta || {})
  });
  if (error) throw new Error(key + ': ' + error.message);
  users[key] = { id: data.user.id };
}

async function login(key) {
  const r = await fetch(BASE_URL + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emails[key], password: PW }),
    redirect: 'manual'
  });
  const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')])
    .map((c) => c && c.split(';')[0]).filter(Boolean).join('; ');
  if (!cookie) throw new Error('login failed for ' + key);
  users[key].cookie = cookie;
}

function get(key, path) {
  return fetch(BASE_URL + path, { headers: { Cookie: users[key].cookie }, redirect: 'manual' });
}

const seeded = { clubs: [], acts: [], ach: [], follows: [] };

async function main() {
  // ── SEED ──
  await mkUser('v');
  await mkUser('n', { bio: 'Athprof verify bio', sports: ['running'], location: 'Testville', timezone: 'America/Los_Angeles' });
  await mkUser('o', { prefs: { show_on_leaderboards: false } });
  await mkUser('p', { prefs: { activity_feed_visible: false } });
  await mkUser('d');
  await login('v');
  console.log('MANIFEST users:', Object.keys(users).map((k) => k + '=' + users[k].id).join(' '));

  // N's activities deliberately separate scope: two ordinary rows are inside
  // the four-week window and one is older. Add 1,001 same-day rows as a public
  // route pagination regression: ALL-TIME ACTIVITIES and the four-week count
  // must stay complete beyond PostgREST's 1,000-row page size.
  const nowMs = Date.now();
  const { data: actRows, error: aErr } = await admin.from('activities').insert([
    { user_id: users.n.id, sport: 'running', title: 'Athprof Morning Run', distance: '5 km', duration: '30:00', date: new Date(nowMs).toISOString() },
    { user_id: users.n.id, sport: 'cycling', title: 'Athprof Evening Spin', distance: '3 km', duration: '15:00', date: new Date(nowMs - 8 * 86400000).toISOString() },
    { user_id: users.n.id, sport: 'swimming', title: 'Athprof Old Swim', distance: '2 km', duration: '20:00', date: new Date(nowMs - 35 * 86400000).toISOString() }
  ]).select();
  if (aErr) throw new Error('activities: ' + aErr.message);
  seeded.acts = actRows.map((r) => r.id);
  const overflowDate = new Date(nowMs - 86400000).toISOString();
  const overflowRows = Array.from({ length: 1001 }, (_, i) => ({
    user_id: users.n.id,
    sport: 'running',
    title: 'Athprof Volume Session ' + i,
    distance: '0 km',
    duration: '0:00',
    date: overflowDate
  }));
  for (let from = 0; from < overflowRows.length; from += 500) {
    const { error } = await admin.from('activities').insert(overflowRows.slice(from, from + 500));
    if (error) throw new Error('overflow activities: ' + error.message);
  }
  // P also trains — but privately.
  const { data: pAct, error: pErr } = await admin.from('activities').insert(
    { user_id: users.p.id, sport: 'running', title: 'Athprof Secret Session', distance: '7 km', duration: '40:00', date: new Date().toISOString() }
  ).select();
  if (pErr) throw new Error('p activity: ' + pErr.message);
  seeded.acts.push(pAct[0].id);
  // The owner path is separate from the visitor route; seed V so its
  // /api/profile/overview response proves the same shared grid is present.
  const { data: vAct, error: vErr } = await admin.from('activities').insert(
    { user_id: users.v.id, sport: 'running', title: 'Athprof Owner Session', distance: '4 km', duration: '25:00', date: new Date(nowMs).toISOString() }
  ).select();
  if (vErr) throw new Error('viewer activity: ' + vErr.message);
  seeded.acts.push(vAct[0].id);

  // N's earned badge (real catalog id: first_activity exists in BADGES).
  const { error: bErr } = await admin.from('achievements').insert({ user_id: users.n.id, badge_id: 'first_steps' });
  if (bErr && !/duplicate/i.test(bErr.message)) console.log('  (achievements seed skipped: ' + bErr.message + ')');
  else seeded.ach.push(users.n.id);

  // N's clubs: one public, one private.
  const { data: pubClub, error: c1 } = await admin.from('clubs').insert({
    name: 'Athprof Public Club', handle: 'athprof-public-club', sport: 'running', owner_id: users.n.id, visibility: 'public'
  }).select().single();
  if (c1) throw new Error('pub club: ' + c1.message);
  const { data: privClub, error: c2 } = await admin.from('clubs').insert({
    name: 'Athprof Secret Club', handle: 'athprof-secret-club', sport: 'cycling', owner_id: users.n.id, visibility: 'private'
  }).select().single();
  if (c2) throw new Error('priv club: ' + c2.message);
  seeded.clubs = [pubClub.id, privClub.id];
  const { error: mErr } = await admin.from('memberships').insert([
    { club_id: pubClub.id, user_id: users.n.id, role: 'admin' },
    { club_id: privClub.id, user_id: users.n.id, role: 'admin' }
  ]);
  if (mErr) throw new Error('memberships: ' + mErr.message);
  console.log('MANIFEST clubs:', seeded.clubs.join(' '));

  // N follows V (populates N's Following list).
  const { error: fErr } = await admin.from('follows').insert({ follower_id: users.n.id, following_id: users.v.id });
  if (fErr) throw new Error('follow: ' + fErr.message);
  seeded.follows.push([users.n.id, users.v.id]);

  // Deleted account: capture the id, then delete.
  const deletedId = users.d.id;
  await admin.auth.admin.deleteUser(deletedId);

  // ── 1. Normal athlete page ──
  const rn = await get('v', '/athletes/' + users.n.id);
  const bn = await rn.text();
  check('normal profile: 200', rn.status === 200, rn.status);
  check('normal profile: name present', bn.includes('Athprof Normal'));
  check('normal profile: activity title present', bn.includes('Athprof Morning Run'));
  check('normal profile: totalKm computed via shared parser (10)', bn.includes('"totalKm":10'));
  check('normal profile: ALL-TIME count includes >1,000 rows', bn.includes('"totalActivities":1004'));
  check('normal profile: four-week count includes >1,000 rows', bn.includes('"activityCount":1003'));
  check('normal profile: four-week grid has four week rows', (bn.match(/"startKey":/g) || []).length >= 5);
  check('normal profile: exact ALL-TIME ACTIVITIES copy present', bn.includes('ALL-TIME ACTIVITIES'));
  check('normal profile: currentStreak field present', bn.includes('"currentStreak":'));
  check('normal profile: sportsBreakdown present', bn.includes('"sportsBreakdown":'));
  check('normal profile: earned badge in payload', bn.includes('"first_steps"') || bn.includes('first_steps'));
  check('normal profile: public club present', bn.includes('Athprof Public Club'));
  check('normal profile: PRIVATE club ABSENT (zero-leak)', !bn.includes('Athprof Secret Club'));
  check('normal profile: following list carries V', bn.includes('Athprof Viewer'));
  check('normal profile: bio present', bn.includes('Athprof verify bio'));
  check('normal profile: no PR strings for visitors', !/personal record|"prs"|Personal Records/i.test(bn));
  check('normal profile: ai_insight scrubbed', !bn.includes('"ai_insight"'));

  // ── 2. Byte-identical zero-leak matrix ──
  const bodies = [];
  for (const target of [users.o.id, crypto.randomUUID(), deletedId, 'not-even-a-uuid']) {
    const r = await get('v', '/athletes/' + target);
    check('not-found 404 for ' + target.slice(0, 13) + '…', r.status === 404, r.status);
    bodies.push(await r.text());
  }
  check('opted-out === random UUID (byte-identical)', bodies[0] === bodies[1]);
  check('opted-out === deleted account (byte-identical)', bodies[0] === bodies[2]);
  check('opted-out === malformed id (byte-identical)', bodies[0] === bodies[3]);
  check('not-found body carries no athlete data', !bodies[0].includes('Athprof'));

  // ── 3. activity_feed_visible boundary ──
  const rp = await get('v', '/athletes/' + users.p.id);
  const bp = await rp.text();
  check('private-training profile: 200 (identity still visible)', rp.status === 200, rp.status);
  check('private-training: name present', bp.includes('Athprof Private'));
  check('private-training: private-state copy present', bp.includes('keeps their training private'));
  check('private-training: activity title ABSENT', !bp.includes('Athprof Secret Session'));
  check('private-training: stats null in payload', bp.includes('"stats":null'));
  check('private-training: activities null in payload', bp.includes('"activities":null'));
  check('private-training: no grid payload leaks', !bp.includes('"activityGrid":'));
  check('private-training: follow counts still present', bp.includes('"followerCount"'));

  // ── 3b. Opt-out is undiscoverable in the directory too ──
  const rdir = await get('v', '/api/athletes/directory');
  const dir = await rdir.json();
  const dirIds = (dir.athletes || []).map((x) => x.id);
  check('directory: normal athlete listed', dirIds.includes(users.n.id));
  check('directory: opted-out athlete ABSENT', !dirIds.includes(users.o.id));

  // ── 4. Self + unauth ──
  const rs = await get('v', '/athletes/' + users.v.id);
  check('self → 302', rs.status === 302, rs.status);
  check('self redirect target /profile', String(rs.headers.get('location')).includes('/profile'));
  const rov = await get('v', '/api/profile/overview');
  const ov = await rov.json();
  check('owner overview: 200', rov.status === 200, rov.status);
  check('owner overview: same four-week grid present', ov.activityGrid && ov.activityGrid.weeks.length === 4);
  check('owner overview: own current activity counted', ov.activityGrid && ov.activityGrid.activityCount === 1, ov.activityGrid);
  const ru = await fetch(BASE_URL + '/athletes/' + users.n.id, { redirect: 'manual' });
  check('unauthenticated → 302', ru.status === 302, ru.status);
  check('unauth redirect target /landing', String(ru.headers.get('location')).includes('/landing'));

  // ── CLEANUP ──
  for (const [f, g] of seeded.follows) await admin.from('follows').delete().eq('follower_id', f).eq('following_id', g);
  await admin.from('activities').delete().in('user_id', [users.v.id, users.n.id, users.p.id]);
  await admin.from('achievements').delete().eq('user_id', users.n.id);
  for (const id of seeded.clubs) {
    await admin.from('memberships').delete().eq('club_id', id);
    await admin.from('clubs').delete().eq('id', id);
  }
  for (const k of ['v', 'n', 'o', 'p']) await admin.auth.admin.deleteUser(users[k].id);

  if (failures) { console.log('\nverify-athlete-profile: ' + failures + ' FAILURE(S)'); process.exit(1); }
  console.log('\nverify-athlete-profile OK');
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
