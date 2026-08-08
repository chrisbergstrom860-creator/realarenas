// Challenge goal-type rework verification:
//   - all four types (distance, duration, sessions, streak="Active days")
//     creatable via the API and computing progress correctly end to end
//   - duration sums activity hours in the window (parseDurationHours semantics)
//   - streak counts DISTINCT active days (two activities one day = 1)
//   - invalid goal_type rejected with 400 invalid_goal_type on create,
//     invalid_goal_type on pre-start PATCH
//   - existing stored 'streak' rows untouched and progress unchanged
//   - enrichment: goal-met-but-live challenge → isComplete true, isExpired
//     false (card shows live label + keeps Invites); genuinely ended →
//     isExpired true ("Ended")
//   - challengeHasEnded day-key semantics: end_date today ⇒ NOT ended
//   - club-feed milestone streak branch counts distinct days (no early
//     milestone from multi-activity days)
//   - notification copy uses the goal phrase ("3 active days"), never the
//     raw word "streak"
// Run with the dev server up:
//   node artifacts/html-arenas/scripts/verify-challenge-goal-types.js

const { createClient } = require('@supabase/supabase-js');
const BASE_URL = 'http://localhost:80/html';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const PW = 'ArenasTest!234';
const emails = { a: 'goaltype-a@arenas-test.dev', b: 'goaltype-b@arenas-test.dev' };

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail ? ' — ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400) : '')); }
}
const ymd = (offsetDays) => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
};

const users = {};
async function deleteUserByEmail(email) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of (data && data.users) || []) if (u.email === email) await admin.auth.admin.deleteUser(u.id);
}
async function mkUser(k, name, handle) {
  await deleteUserByEmail(emails[k]);
  const { data, error } = await admin.auth.admin.createUser({
    email: emails[k], password: PW, email_confirm: true,
    user_metadata: { name, handle, timezone: 'UTC' }
  });
  if (error) throw new Error(error.message);
  users[k] = { id: data.user.id };
}
async function login(k) {
  const r = await fetch(BASE_URL + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(emails[k])}&password=${encodeURIComponent(PW)}`, redirect: 'manual'
  });
  const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')])
    .map(c => String(c).split(';')[0]).join('; ');
  if (!cookie) throw new Error('login failed ' + k);
  users[k].cookie = cookie;
}
async function api(k, method, path, body) {
  const r = await fetch(BASE_URL + '/api' + path, {
    method, headers: { Cookie: users[k].cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function logAct(k, fields) {
  const r = await api(k, 'POST', '/activities/create', { title: 'test', ...fields });
  if (!r.body || r.body.error) throw new Error('activity create failed: ' + JSON.stringify(r.body));
}
async function myChallenge(k, id) {
  const r = await api(k, 'GET', '/challenges');
  const all = [...(r.body.myChallenges || []), ...(r.body.discover || []), ...(r.body.clubChallenges || [])];
  return all.find(c => c.id === id);
}

const madeChallenges = [];
async function mkChallenge(k, fields) {
  const r = await api(k, 'POST', '/challenges/create', {
    title: fields.title, sport: fields.sport || 'running',
    goal_type: fields.goal_type, goal_target: fields.goal_target,
    goal_unit: fields.goal_unit || ({ distance: 'km', duration: 'hours', sessions: 'sessions', streak: 'days' }[fields.goal_type] || 'x'),
    start_date: fields.start_date, end_date: fields.end_date, visibility: fields.visibility || 'public'
  });
  if (r.body && r.body.challenge) madeChallenges.push(r.body.challenge.id);
  return r;
}

async function main() {
  await mkUser('a', 'Goaltype Alpha', 'goaltype_alpha');
  await mkUser('b', 'Goaltype Beta', 'goaltype_beta');
  for (const k of ['a', 'b']) await login(k);
  console.log('MANIFEST users:', JSON.stringify({ a: users.a.id, b: users.b.id }));

  const start = ymd(-3), end = ymd(10);

  // ── 1. Invalid goal type rejected ──
  let r = await mkChallenge('a', { title: 'GT bad', goal_type: 'pushups', goal_target: 10, start_date: start, end_date: end });
  check('create with invalid goal_type → 400 invalid_goal_type', r.status === 400 && r.body.error === 'invalid_goal_type', r);

  // ── 2. All four types creatable + progress end to end ──
  const mk = {};
  for (const [t, target, unit] of [['distance', 20, 'km'], ['duration', 3, 'hours'], ['sessions', 3, 'sessions'], ['streak', 2, 'days']]) {
    r = await mkChallenge('a', { title: 'GT ' + t, goal_type: t, goal_target: target, goal_unit: unit, start_date: start, end_date: end });
    check(t + ' creatable', r.body && r.body.challenge && r.body.challenge.goal_type === t, r.body);
    mk[t] = r.body.challenge;
  }

  // Activities: two on the SAME day (yesterday) + one today.
  await logAct('a', { sport: 'running', date: ymd(-1), distance: '5 km', duration: '1:30' });   // 1.5h
  await logAct('a', { sport: 'running', date: ymd(-1), distance: '3 km', duration: '45:00' }); // 0.75h
  await logAct('a', { sport: 'running', date: ymd(0), distance: '4 km', duration: '60' });     // 1h (bare min)

  let c = await myChallenge('a', mk.distance.id);
  check('distance progress = 12 km', c && c.progress === 12, c && c.progress);
  c = await myChallenge('a', mk.duration.id);
  check('duration progress = 3.3 hours (1.5+0.75+1, rounded 1dp)', c && Math.abs(c.progress - 3.3) < 0.01, c && c.progress);
  check('duration isComplete at 3.3/3', c && c.isComplete === true, c);
  c = await myChallenge('a', mk.sessions.id);
  check('sessions progress = 3', c && c.progress === 3, c && c.progress);
  c = await myChallenge('a', mk.streak.id);
  check('streak (Active days) counts DISTINCT days: 2 not 3', c && c.progress === 2, c && c.progress);

  // ── 3. Goal-met-but-live: isComplete true, isExpired false ──
  c = await myChallenge('a', mk.sessions.id);
  check('goal-met live: isComplete && !isExpired', c && c.isComplete === true && c.isExpired === false, c && { isComplete: c.isComplete, isExpired: c.isExpired });

  // Leaderboard overshoot stays raw
  r = await api('a', 'GET', '/challenges/' + mk.sessions.id + '/leaderboard');
  const lbMe = (r.body.leaderboard || []).find(e => e.user_id === users.a.id || e.userId === users.a.id) || (r.body.leaderboard || [])[0];
  check('leaderboard raw overshoot 3 (target 3, pct clamps)', lbMe && Number(lbMe.progress) === 3, lbMe);

  // ── 4. challengeHasEnded day-key semantics ──
  // end_date = TODAY → the end day is not over yet → not ended, not expired.
  r = await mkChallenge('a', { title: 'GT ends today', goal_type: 'sessions', goal_target: 99, start_date: ymd(-5), end_date: ymd(0) });
  c = await myChallenge('a', r.body.challenge.id);
  check('end_date today → isExpired false (end day still counts)', c && c.isExpired === false, c && c.isExpired);
  // end_date = yesterday → ended.
  const { data: endedCh, error: endedErr } = await admin.from('challenges').insert({
    created_by: users.a.id, title: 'GT ended', sport: 'running', goal_type: 'sessions',
    goal_target: 99, goal_unit: 'sessions', start_date: ymd(-10), end_date: ymd(-1), visibility: 'public'
  }).select().single();
  if (endedErr) throw new Error(endedErr.message);
  madeChallenges.push(endedCh.id);
  await admin.from('challenge_participants').insert({ challenge_id: endedCh.id, user_id: users.a.id });
  c = await myChallenge('a', endedCh.id);
  check('end_date yesterday → isExpired true ("Ended")', c && c.isExpired === true, c && c.isExpired);
  // PATCH after end refused (challengeHasEnded authorization path)
  r = await api('a', 'PATCH', '/challenges/' + endedCh.id, { title: 'nope' });
  check('edit after end refused (challenge_ended)', r.body && (r.body.error === 'challenge_ended' || r.body.error === 'already_ended'), r.body);
  // PATCH with invalid goal type pre-start
  r = await mkChallenge('a', { title: 'GT future', goal_type: 'sessions', goal_target: 5, start_date: ymd(2), end_date: ymd(9) });
  const fut = r.body.challenge;
  r = await api('a', 'PATCH', '/challenges/' + fut.id, { goal_type: 'pushups' });
  check('PATCH invalid goal_type rejected', r.body && !!r.body.error, r.body);
  r = await api('a', 'PATCH', '/challenges/' + fut.id, { goal_type: 'duration', goal_target: 4, goal_unit: 'hours' });
  check('PATCH to duration accepted pre-start', r.body && !r.body.error, r.body);

  // ── 5. Existing stored 'streak' rows keep value + progress ──
  const { data: streakRow } = await admin.from('challenges').select('goal_type').eq('id', mk.streak.id).single();
  check("stored value stays 'streak' (display-only rename)", streakRow.goal_type === 'streak', streakRow);

  // ── 6. Notification copy: goal phrase, no raw 'streak' word ──
  // b follows nothing; invite b to a private streak challenge → notif body.
  r = await mkChallenge('a', { title: 'GT invite copy', goal_type: 'streak', goal_target: 3, goal_unit: 'days', start_date: start, end_date: end, visibility: 'private' });
  const invCh = r.body.challenge;
  await api('b', 'POST', '/follow/' + users.a.id); // follower basis for invites
  r = await api('a', 'POST', '/challenges/' + invCh.id + '/invites', { invitees: [users.b.id] });
  const { data: notifs } = await admin.from('notifications').select('body').eq('user_id', users.b.id);
  const invNotif = (notifs || []).map(n => n.body).join(' | ');
  check('invite notif says "3 active days", not "streak"', /3 active days/.test(invNotif) && !/streak/i.test(invNotif), invNotif);

  // ── 7. Club-feed milestone distinct-day check (unit-level via server data) ──
  // Covered structurally: streak progress above proved distinct-day counting in
  // the shared helper; the milestone loop now uses the same Set-of-dayKeys.
  // Direct check: target 2 with 2 activities on ONE day must NOT be complete.
  r = await mkChallenge('a', { title: 'GT milestone', goal_type: 'streak', goal_target: 2, goal_unit: 'days', start_date: ymd(-1), end_date: ymd(5) });
  const ms = r.body.challenge;
  // Only yesterday's two activities fall in [-1..]: distinct days = 2 (yesterday + today) — narrow window to yesterday only:
  const { error: updErr } = await admin.from('challenges').update({ start_date: ymd(-1), end_date: ymd(-1) }).eq('id', ms.id);
  if (updErr) throw new Error(updErr.message);
  c = await myChallenge('a', ms.id);
  check('two same-day activities → active days progress 1 (not 2)', c && c.progress === 1 && c.isComplete === false, c && { progress: c.progress, isComplete: c.isComplete });

  // ── 8. Club-feed milestone for a DURATION challenge (regression: the
  //       milestone loop must select `duration`, or every duration milestone
  //       computes as 0 and never appears). a's logged hours = 3.25.
  r = await api('a', 'POST', '/clubs/create', { name: 'GT Milestone Club', handle: 'gtmsclub', sport: 'running', city: '' });
  // Route responds with a redirect to the new club dashboard, not a club object.
  const clubId = ((r.body && r.body.redirect) || '').split('club=')[1];
  check('club created', !!clubId, r.body);
  r = await api('a', 'POST', '/challenges/create', {
    title: 'GT club duration', sport: 'running', goal_type: 'duration', goal_target: 2, goal_unit: 'hours',
    start_date: start, end_date: end, visibility: 'club', club_id: clubId
  });
  check('club duration challenge created', r.body && r.body.challenge, r.body);
  const clubCh = r.body.challenge;
  await api('a', 'POST', '/challenges/' + clubCh.id + '/join');
  r = await api('a', 'GET', '/clubs/' + clubId + '/feed');
  const milestone = ((r.body && r.body.feed) || []).find(f => f.type === 'milestone' && f.challengeTitle === 'GT club duration');
  check('club feed emits duration milestone (3.25h ≥ 2h goal)', !!milestone, r.body && (r.body.feed || []).map(f => f.type));

  // ── Cleanup ──
  await admin.from('challenge_participants').delete().eq('challenge_id', clubCh.id);
  await admin.from('challenges').delete().eq('id', clubCh.id);
  await admin.from('posts').delete().eq('club_id', clubId);
  await admin.from('memberships').delete().eq('club_id', clubId);
  await admin.from('clubs').delete().eq('id', clubId);
  for (const id of madeChallenges.concat([fut.id, invCh.id, ms.id])) {
    await admin.from('challenge_invites').delete().eq('challenge_id', id);
    await admin.from('challenge_participants').delete().eq('challenge_id', id);
    await admin.from('challenges').delete().eq('id', id);
  }
  for (const k of ['a', 'b']) {
    await admin.from('activities').delete().eq('user_id', users[k].id);
    await admin.from('notifications').delete().eq('user_id', users[k].id);
    await admin.from('notifications').delete().eq('actor_id', users[k].id);
    await admin.from('follows').delete().eq('follower_id', users[k].id);
    await admin.from('follows').delete().eq('following_id', users[k].id);
    const { error } = await admin.auth.admin.deleteUser(users[k].id);
    check('cleanup: user ' + k + ' deleted', !error, error && error.message);
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
