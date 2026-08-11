// Seeded verification of the app-wide athlete-link sweep — every surface that
// renders athlete names/avatars must carry the data the shared mechanism
// (arenas-athlete-link.js) needs, with the reachability rule enforced:
//   - payloads carry profilePublic (or authorProfilePublic/coachProfilePublic)
//   - opted-out athletes (show_on_leaderboards=false) come back FALSE so
//     their names are never links (their profile 404s — zero-leak)
//   - follow notifications deep-link to the actor's profile ONLY when the
//     actor is reachable; opted-out actors keep the stored link
//   - the served page/JS wiring exists (athleteLinkAttrs in shared module,
//     pages include the script, CSS affordance present)
// Click/no-click browser behavior is covered by the playwright pass, not here.
// Run with the dev server up:
//   node artifacts/html-arenas/scripts/verify-athlete-links.js
// Cleanup is built in (also covered by scripts/test-data-sweep.js --delete).

const { createClient } = require('@supabase/supabase-js');

const BASE_URL = 'http://localhost:80/html';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const PW = 'ArenasTest!234';
const emails = {
  v: 'athlink-viewer@arenas-test.dev',
  n: 'athlink-normal@arenas-test.dev',
  o: 'athlink-optout@arenas-test.dev'
};
const names = {
  v: ['Athlink Viewer', 'athlink_viewer'],
  n: ['Athlink Normal', 'athlink_normal'],
  o: ['Athlink Optout', 'athlink_optout']
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

const users = {};

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
function post(key, path, body) {
  return fetch(BASE_URL + path, {
    method: 'POST',
    headers: { Cookie: users[key].cookie, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual'
  });
}

const seeded = { clubs: [], acts: [], posts: [], events: [], challenges: [] };

async function main() {
  // ── SEED ──
  await mkUser('v');
  await mkUser('n');
  await mkUser('o', { prefs: { show_on_leaderboards: false } });
  await login('v'); await login('n'); await login('o');
  console.log('MANIFEST users:', Object.keys(users).map((k) => k + '=' + users[k].id).join(' '));

  // Follows: v→n, v→o (feed sources), and o→n (opted-out actor notification).
  await post('v', '/api/follow/' + users.n.id);
  await post('v', '/api/follow/' + users.o.id);
  await post('o', '/api/follow/' + users.n.id);

  // Activities by n and o (feed activity cards).
  const { data: actRows, error: aErr } = await admin.from('activities').insert([
    { user_id: users.n.id, sport: 'running', title: 'Athlink N Run', distance: '5 km', duration: '30:00', date: new Date().toISOString() },
    { user_id: users.o.id, sport: 'running', title: 'Athlink O Run', distance: '4 km', duration: '25:00', date: new Date().toISOString() }
  ]).select();
  if (aErr) throw new Error('activities: ' + aErr.message);
  seeded.acts = actRows.map((r) => r.id);

  // Personal posts by n and o (feed post cards).
  const { data: postRows, error: pErr } = await admin.from('posts').insert([
    { user_id: users.n.id, content: 'Athlink N post' },
    { user_id: users.o.id, content: 'Athlink O post' }
  ]).select();
  if (pErr) throw new Error('posts: ' + pErr.message);
  seeded.posts = postRows.map((r) => r.id);

  // Club with n as admin, v + o as members; announcement by n.
  const { data: club, error: cErr } = await admin.from('clubs').insert({
    name: 'Athlink Club', handle: 'athlink-club', sport: 'running', owner_id: users.n.id, visibility: 'public'
  }).select().single();
  if (cErr) throw new Error('club: ' + cErr.message);
  seeded.clubs = [club.id];
  const { error: mErr } = await admin.from('memberships').insert([
    { club_id: club.id, user_id: users.n.id, role: 'admin' },
    { club_id: club.id, user_id: users.v.id, role: 'member' },
    { club_id: club.id, user_id: users.o.id, role: 'member' }
  ]);
  if (mErr) throw new Error('memberships: ' + mErr.message);
  const { data: annRow, error: annErr } = await admin.from('posts').insert(
    { user_id: users.n.id, club_id: club.id, content: 'Athlink announcement' }
  ).select().single();
  if (annErr) throw new Error('announcement: ' + annErr.message);
  seeded.posts.push(annRow.id);

  // Club event by n; o RSVPs going (dashboard RSVP list + feed RSVP card).
  const { data: ev, error: eErr } = await admin.from('events').insert({
    title: 'Athlink Event', sport: 'running', date: new Date(Date.now() + 3 * 864e5).toISOString(),
    location: 'Testville', created_by: users.n.id, club_id: club.id, visibility: 'public'
  }).select().single();
  if (eErr) throw new Error('event: ' + eErr.message);
  seeded.events = [ev.id];
  const { error: rErr } = await admin.from('event_rsvps').insert(
    { event_id: ev.id, user_id: users.o.id, status: 'going' }
  );
  if (rErr) throw new Error('rsvp: ' + rErr.message);

  // Club challenge with n + o participating (challenge leaderboard).
  const { data: ch, error: chErr } = await admin.from('challenges').insert({
    title: 'Athlink Challenge', sport: 'any', goal_type: 'distance', goal_target: 50, goal_unit: 'km',
    start_date: new Date(Date.now() - 864e5).toISOString(), end_date: new Date(Date.now() + 7 * 864e5).toISOString(),
    created_by: users.n.id, club_id: club.id, visibility: 'club'
  }).select().single();
  if (chErr) throw new Error('challenge: ' + chErr.message);
  seeded.challenges = [ch.id];
  const { error: cpErr } = await admin.from('challenge_participants').insert([
    { challenge_id: ch.id, user_id: users.n.id },
    { challenge_id: ch.id, user_id: users.o.id }
  ]);
  if (cpErr) throw new Error('participants: ' + cpErr.message);

  // ── 1. Shared wiring exists ──
  const js = await (await fetch(BASE_URL + '/arenas-athlete-link.js')).text();
  check('shared module served + defines athleteLinkAttrs', js.includes('athleteLinkAttrs'));
  const css = await (await fetch(BASE_URL + '/arenas.css')).text();
  check('CSS cursor affordance for [data-athlete-link]', css.includes('[data-athlete-link]'));
  for (const page of ['/feed', '/leaderboards', '/challenges', '/profile']) {
    const html = await (await get('v', page)).text();
    check('page includes shared script: ' + page, html.includes('arenas-athlete-link.js'));
  }

  // ── 2. Feed payload flags (posts / activities / RSVPs) ──
  const feedHtml = await (await get('v', '/feed')).text();
  const dataMatch = feedHtml.match(/window\.ARENAS_DATA\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
  check('feed: ARENAS_DATA parse', !!dataMatch);
  const fd = dataMatch ? JSON.parse(dataMatch[1]) : {};
  const postN = (fd.posts || []).find((p) => p.user_id === users.n.id && !p.clubId);
  const postO = (fd.posts || []).find((p) => p.user_id === users.o.id);
  check('feed post: normal author flagged reachable', postN && postN.authorProfilePublic === true);
  check('feed post: opted-out author flagged UNreachable', postO && postO.authorProfilePublic === false);
  const actN = (fd.feedActivities || []).find((a) => a.user_id === users.n.id);
  const actO = (fd.feedActivities || []).find((a) => a.user_id === users.o.id);
  check('feed activity: normal author reachable', actN && actN.author && actN.author.profilePublic === true);
  check('feed activity: opted-out author UNreachable', actO && actO.author && actO.author.profilePublic === false);
  const rsvpO = (fd.followingRsvps || []).find((r) => r.user_id === users.o.id);
  check('feed RSVP: opted-out author UNreachable', rsvpO && rsvpO.author && rsvpO.author.profilePublic === false);

  // ── 3. Club member-home (roster + announcement author) ──
  const mh = await (await get('v', '/api/clubs/' + club.id + '/member-home')).json();
  const rosterN = (mh.roster || []).find((m) => m.userId === users.n.id);
  const rosterO = (mh.roster || []).find((m) => m.userId === users.o.id);
  check('roster: normal member reachable', rosterN && rosterN.profilePublic === true);
  check('roster: opted-out member UNreachable', rosterO && rosterO.profilePublic === false);
  const ann = (mh.announcements || []).find((a) => a.userId === users.n.id);
  check('announcement: coachProfilePublic present', ann && ann.coachProfilePublic === true);

  // ── 4. Club feed tab items ──
  const cf = await (await get('v', '/api/clubs/' + club.id + '/feed')).json();
  const cfPostO = (cf.feed || []).find((i) => i.type === 'post' && i.userId === users.o.id);
  const cfActN = (cf.feed || []).find((i) => i.type === 'activity' && i.userId === users.n.id);
  const cfRsvpO = (cf.feed || []).find((i) => i.type === 'rsvp' && i.userId === users.o.id);
  const cfJoinO = (cf.feed || []).find((i) => i.type === 'join' && i.userId === users.o.id);
  check('club feed post: opted-out UNreachable', cfPostO && cfPostO.profilePublic === false);
  check('club feed activity: normal reachable', cfActN && cfActN.profilePublic === true);
  check('club feed rsvp: opted-out UNreachable', cfRsvpO && cfRsvpO.profilePublic === false);
  check('club feed join: opted-out UNreachable', cfJoinO && cfJoinO.profilePublic === false);

  // ── 5. Challenge leaderboard entries ──
  const cl = await (await get('v', '/api/challenges/' + ch.id + '/leaderboard')).json();
  const clN = (cl.leaderboard || []).find((e) => e.userId === users.n.id);
  const clO = (cl.leaderboard || []).find((e) => e.userId === users.o.id);
  check('challenge lb: normal reachable', clN && clN.profilePublic === true);
  check('challenge lb: opted-out UNreachable', clO && clO.profilePublic === false);

  // ── 6. Event RSVP list (manager view) ──
  const er = await (await get('n', '/api/events/' + ev.id + '/rsvps')).json();
  const erO = (er.rsvps || []).find((r) => r.userId === users.o.id);
  check('event rsvps: opted-out UNreachable', erO && erO.profilePublic === false);

  // ── 7. Follow-notification link remap (reachable actor only) ──
  const notifs = await (await get('n', '/api/notifications')).json();
  const list = notifs.notifications || notifs || [];
  const fromV = list.find((x) => x.type === 'follow' && x.actor_id === users.v.id);
  const fromO = list.find((x) => x.type === 'follow' && x.actor_id === users.o.id);
  check('follow notif from reachable actor links to their profile',
    fromV && fromV.link === '/athletes/' + users.v.id, fromV && fromV.link);
  check('follow notif from OPTED-OUT actor does NOT link to their profile',
    fromO && fromO.link !== '/athletes/' + users.o.id, fromO && fromO.link);

  // ── 8. Directory still excludes opted-out (link target integrity) ──
  const dir = await (await get('v', '/api/athletes/directory')).json();
  const dirIds = (dir.athletes || []).map((x) => x.id);
  check('directory: opted-out absent', !dirIds.includes(users.o.id));
  check('directory: normal present', dirIds.includes(users.n.id));

  console.log(failures ? '\nverify-athlete-links FAILED (' + failures + ')' : '\nverify-athlete-links OK');
}

async function cleanup() {
  try {
    for (const id of seeded.challenges) {
      await admin.from('challenge_participants').delete().eq('challenge_id', id);
      await admin.from('challenges').delete().eq('id', id);
    }
    for (const id of seeded.events) {
      await admin.from('event_rsvps').delete().eq('event_id', id);
      await admin.from('events').delete().eq('id', id);
    }
    for (const id of seeded.posts) {
      await admin.from('post_likes').delete().eq('post_id', id);
      await admin.from('posts').delete().eq('id', id);
    }
    for (const id of seeded.acts) await admin.from('activities').delete().eq('id', id);
    for (const id of seeded.clubs) {
      await admin.from('memberships').delete().eq('club_id', id);
      await admin.from('clubs').delete().eq('id', id);
    }
    // The follow POSTs mint real side-effect rows (notifications,
    // achievements, profiles) that can block auth deletion — clear them
    // first, for every seeded user, before deleting the accounts.
    for (const k of Object.keys(users)) {
      const id = users[k] && users[k].id;
      if (!id) continue;
      await admin.from('follows').delete().or('follower_id.eq.' + id + ',following_id.eq.' + id);
      await admin.from('notifications').delete().or('user_id.eq.' + id + ',actor_id.eq.' + id);
      await admin.from('achievements').delete().eq('user_id', id);
      await admin.from('profiles').delete().eq('id', id);
    }
    for (const k of Object.keys(emails)) await deleteUserByEmail(emails[k]);
  } catch (err) {
    console.log('cleanup error:', err.message);
  }
}

main()
  .catch((err) => { failures++; console.log('FATAL', err.message); })
  .finally(async () => { await cleanup(); process.exit(failures ? 1 : 0); });
