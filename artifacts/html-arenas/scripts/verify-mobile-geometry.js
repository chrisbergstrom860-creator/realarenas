// PERMANENT GUARD: mobile geometry audit across all app-shell pages.
// Run: node scripts/verify-mobile-geometry.js        (seed → measure → cleanup)
//      --keep         skip cleanup (debugging)
//      --page <name>  audit only one page config
//
// Engine: scripts/lib/mobile-geometry.js. Asserts at 360/380/414px:
//   - no element overflows its clipping container (overflow:hidden clip)
//   - no two text leaves' bounding boxes overlap
//   - every button inside the viewport AND hit-testable
//   - no page-level horizontal scroll; zero console/page errors
// SEED DENSITY IS THE POINT: empty surfaces cannot overflow, so every measured
// surface is seeded with content (long names/titles throughout) and the run
// reports RENDERED vs EMPTY per surface — an empty surface is UNMEASURED, not
// passing. Runs alongside verify-points-page.js / verify-km-consistency.js
// after any change to shell CSS, card renderers, or page templates.
import { createClient } from '@supabase/supabase-js';
import { launchBrowser, auditPage, VIEWPORTS } from './lib/mobile-geometry.js';

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DOMAIN = process.env.REPLIT_DEV_DOMAIN;
const BASE = `https://${DOMAIN}/html`;
const PW = 'ArenasTest!234';

let failures = 0, assertions = 0;
const check = (name, ok, detail) => {
  assertions++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  → ' + JSON.stringify(detail).slice(0, 500)}`);
  if (!ok) failures++;
};

// ── users: 2 audited viewers + 8 fillers, all with LONG names ──
const LONGNAMES = [
  'Konstantina-Alexandra Papadimitriou-Vandenberg', 'Maximilian-Frederick Oyelaran-Whitcombe',
  'Anastasiya Yevgenievna Dobrovolskaya-Smith', 'Bartholomew Okonkwo-Fitzgerald III',
  'Wilhelmina Vasquez-Oppenheimer', 'Christopher-Sebastian Nakamura-Lindqvist',
  'Margarethe-Sophia Van Der Bergstromsson', 'Theodore Emmanuel Achterberg-Nkemelu'
];
const userDefs = { creator: 'Konstantina-Alexandra Papadimitriou-Vandenberg', member: 'Maximilian-Frederick Oyelaran-Whitcombe' };
for (let i = 0; i < 8; i++) userDefs['f' + i] = LONGNAMES[i % LONGNAMES.length] + ' ' + (i + 1);
const emails = Object.fromEntries(Object.keys(userDefs).map((k) => [k, `geo-${k}@arenas-test.dev`]));

const users = {};
async function mkUser(key) {
  const { data, error } = await admin.auth.admin.createUser({
    email: emails[key], password: PW, email_confirm: true,
    user_metadata: { name: userDefs[key], handle: 'geo_' + key, country: 'NO', state: 'Vestland',
      sports: ['running', 'cycling'] }
  });
  if (error) throw new Error(key + ': ' + error.message);
  users[key] = { id: data.user.id };
}
async function login(key) {
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(emails[key])}&password=${encodeURIComponent(PW)}`
  });
  const setC = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  const cookies = (setC || []).filter(Boolean).map((c) => {
    const [pair] = c.split(';'); const i = pair.indexOf('=');
    return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: DOMAIN, path: '/' };
  });
  if (r.status !== 302 || !cookies.length) throw new Error('login failed: ' + key);
  users[key].cookies = cookies;
}
async function ins(table, row) {
  const { data, error } = await admin.from(table).insert(row).select().maybeSingle();
  if (error) throw new Error(table + ': ' + error.message);
  return data;
}
const day = 86400000;
const iso = (d) => new Date(Date.now() + d * day).toISOString();
const dt = (d) => iso(d).slice(0, 10);

// ── seed (dense) ──
for (const k of Object.keys(userDefs)) await mkUser(k);
await login('creator'); await login('member');
const C = users.creator.id, M = users.member.id;
const F = [...Array(8)].map((_, i) => users['f' + i].id);
console.log('MANIFEST users:', JSON.stringify(Object.fromEntries(Object.entries(users).map(([k, v]) => [k, v.id]))));

const LONG = 'Late Autumn Ultra-Distance Trail Running Consistency and Elevation Gain Challenge';
const club = await ins('clubs', {
  name: 'Trans-Scandinavian Endurance and Alpine Expedition Society',
  handle: 'geoclub', sport: 'running', city: 'Ytre Snillfjordsbotn', owner_id: C
});
await ins('memberships', { user_id: C, club_id: club.id, role: 'admin' });
await ins('memberships', { user_id: M, club_id: club.id, role: 'member' });
for (const f of F.slice(0, 6)) await ins('memberships', { user_id: f, club_id: club.id, role: 'member' });

// follows: everyone follows creator; creator/member follow each other + fillers
for (const f of [...F, M]) await ins('follows', { follower_id: f, following_id: C });
for (const f of [M, ...F.slice(0, 5)]) await ins('follows', { follower_id: C, following_id: f });
await ins('follows', { follower_id: M, following_id: users.f0.id });

// challenges (long + short titles; populated participant lists)
const mkCh = async (by, title, vis, parts) => {
  const ch = await ins('challenges', { created_by: by, title, visibility: vis, sport: 'running',
    goal_type: 'distance', goal_target: 120, goal_unit: 'km', start_date: iso(-6), end_date: iso(18) });
  for (const p of parts) await ins('challenge_participants', { challenge_id: ch.id, user_id: p });
  return ch;
};
const chPriv = await mkCh(C, LONG, 'private', [C]);
await ins('challenge_invites', { challenge_id: chPriv.id, inviter_id: C, invitee_id: M });
const chShort = await mkCh(C, '5K Blitz', 'public', [C, M, ...F.slice(0, 3)]);
const chLong = await mkCh(C, LONG + ' II', 'public', [C, ...F.slice(0, 4)]);
const chByM = await mkCh(M, 'Dawn Patrol Weekly Sunrise Kilometre Accumulation Series', 'public', [M, users.f3.id]);
const CHALLENGES = [chPriv.id, chShort.id, chLong.id, chByM.id];

// activities: dense, multi-sport, long titles, spread over the month → feeds
// PRs, stats-4, calendar, leaderboards, club rollups, points, streaks.
const ACT_TITLE = 'Threshold intervals along the upper fjord switchbacks — long evening session with negative splits';
const sports = ['running', 'cycling', 'hiking', 'swimming'];
const seededActivityUsers = [C, M, ...F.slice(0, 6)];
for (const [ui, u] of seededActivityUsers.entries()) {
  for (let i = 0; i < 6; i++) {
    await ins('activities', {
      user_id: u, sport: sports[(ui + i) % sports.length],
      title: i % 2 ? ACT_TITLE : 'Short spin',
      date: dt(-(i * 4 + (ui % 3))), duration: '01:0' + (i % 6) + ':00',
      distance: (8 + i * 3.5) + ' km', notes: i % 3 ? ACT_TITLE : null
    });
  }
}
// earned achievements for creator → .achievement-grid renders earned rows
for (const b of ['first_steps', 'early_bird', 'regular', 'joined_club', 'challenger', 'hat_trick']) {
  await ins('achievements', { user_id: C, badge_id: b });
}
// goal for creator (Goals tab + overview mini-card)
await ins('goals', { user_id: C, type: 'distance', sport: 'running', target_value: 80, unit: 'km', period: 'weekly', status: 'active' });

// posts w/ kudos + comments (the flex action rows), long content
const POSTS = [];
for (const [u, txt] of [[C, ACT_TITLE + ' — felt strong through every rep, weather held up beautifully.'], [M, 'Completed the ' + LONG + ' opening block this morning!'], [users.f0.id, 'Short one.']]) {
  const p = await ins('posts', { user_id: u, content: txt, sport: 'running' });
  POSTS.push(p.id);
  for (const liker of [M, ...F.slice(0, 4)].filter((x) => x !== u)) await ins('post_likes', { post_id: p.id, user_id: liker });
  await ins('post_comments', { post_id: p.id, user_id: users.f1.id, content: 'Incredible consistency — that elevation profile looked absolutely brutal from the segment view!' });
  await ins('post_comments', { post_id: p.id, user_id: users.f2.id, content: 'Nice.' });
}
// events with RSVPs (long titles + location)
const EVENTS = [];
for (const [i, t] of ['Midnight-Sun Coastal Half-Marathon Preparation Long Run and Post-Run Waffle Social', 'Track Tuesday'].entries()) {
  const ev = await ins('events', { created_by: C, club_id: club.id, title: t, sport: 'running',
    event_type: 'training', date: iso(3 + i * 4), location: 'Ytre Snillfjordsbotn Community Athletics Track, North Entrance', visibility: 'club' });
  EVENTS.push(ev.id);
  for (const u of [M, ...F.slice(0, 4)]) await ins('event_rsvps', { event_id: ev.id, user_id: u, status: 'going' });
}
// notifications for creator
for (const [a, ty, ti] of [[M, 'like', 'New kudos'], [users.f0.id, 'follow', 'New follower'], [users.f1.id, 'comment', 'New comment']]) {
  await ins('notifications', { user_id: C, actor_id: a, type: ty, title: ti, body: 'Geo seed notification body text' });
}
console.log('MANIFEST club:', club.id, 'challenges:', JSON.stringify(CHALLENGES), 'events:', JSON.stringify(EVENTS));

// ── page configs ──
const htab = (id) => `document.getElementById('htab-${id}').click()`;
const PAGES = [
  { user: 'creator', name: 'feed', path: '/feed', waitFor: '.feed-item-wrap', root: 'body',
    surfaces: [
      { name: 'feed items', sel: '.feed-items', min: 3 },
      { name: 'right rail (side-col)', sel: '.side-col', min: 2 }
    ] },
  { user: 'creator', name: 'challenges', path: '/challenges', waitFor: '#tab-mine .challenge-card', root: 'body',
    surfaces: [{ name: 'mine cards', sel: '#tab-mine', min: 2 }],
    steps: [{ name: 'discover', js: `document.getElementById('tab-btn-discover').click()`, waitFor: '#discover-grid .challenge-card',
      surfaces: [{ name: 'discover cards', sel: '#discover-grid', min: 1 }] }] },
  { user: 'member', name: 'challenges-member', path: '/challenges', waitFor: '#tab-mine .challenge-card', root: 'body',
    surfaces: [{ name: 'mine cards (member)', sel: '#tab-mine', min: 1 }],
    steps: [{ name: 'discover', js: `document.getElementById('tab-btn-discover').click()`, waitFor: '#discover-grid .challenge-card',
      surfaces: [{ name: 'discover cards (member)', sel: '#discover-grid', min: 1 }] }] },
  { user: 'creator', name: 'events', path: '/events', waitFor: '#events-grid > *', root: 'body',
    surfaces: [{ name: 'events grid', sel: '#events-grid', min: 2 }] },
  { user: 'creator', name: 'leaderboards', path: '/leaderboards', waitFor: '.lb-row', root: 'body',
    surfaces: [
      { name: 'podium', sel: '.podium-stage', min: 3 },
      { name: 'table rows', sel: '.lb-table-header ~ *', min: 1 }
    ] },
  { user: 'creator', name: 'profile', path: '/profile', waitFor: '.hero-inner', root: 'body',
    surfaces: [{ name: 'overview', sel: '#tab-overview', min: 1 }],
    steps: [
      { name: 'activities', js: htab('activities'), surfaces: [{ name: 'activities list', sel: '#tab-activities', min: 1 }] },
      { name: 'stats', js: htab('stats'), surfaces: [{ name: 'stats & PRs body', sel: '#sp-stats-body', min: 1 }] },
      { name: 'achievements', js: htab('achievements'), surfaces: [{ name: 'achievements tab', sel: '#tab-achievements .content-cols-full', min: 1 }] },
      { name: 'following', js: htab('following'), surfaces: [{ name: 'following grid', sel: '.following-grid', min: 2 }] },
      { name: 'goals', js: htab('goals'), surfaces: [{ name: 'goals tab', sel: '#tab-goals', min: 1 }] }
    ] },
  // Mobile defaults to WEEK view (no .cal-grid) — wait on the shell, then
  // audit week (default) plus an explicit switch to month.
  { user: 'creator', name: 'calendar', path: '/calendar', waitFor: '.main', root: 'body',
    surfaces: [{ name: 'calendar body', sel: '.main', min: 1 }],
    steps: [{ name: 'month', js: `(document.querySelector('[data-view="month"], #view-month') || [...document.querySelectorAll('button')].find((b) => /month/i.test(b.textContent)) || {click(){}}).click()`,
      surfaces: [{ name: 'month grid', sel: '.cal-grid', min: 7 }] }] },
  { user: 'creator', name: 'athletes', path: '/athletes', waitFor: '#athlete-grid > *', root: 'body',
    // NOTE: .rec-strip / .nearby-grid / .network-stats exist only as dead
    // prototype CSS — no DOM ever renders them, so they are not surfaces.
    surfaces: [{ name: 'directory cards', sel: '#athlete-grid', min: 4 }] },
  { user: 'creator', name: 'log', path: '/log', waitFor: 'form, #act-form, .main', root: 'body',
    surfaces: [{ name: 'log form', sel: '.main', min: 1 }] },
  { user: 'creator', name: 'billing', path: '/billing', waitFor: '.main', root: 'body',
    surfaces: [{ name: 'billing content', sel: '.main', min: 1 }] },
  { user: 'creator', name: 'club-dashboard', path: '/clubs/dashboard?club=' + club.id, waitFor: '.main', root: 'body',
    surfaces: [{ name: 'overview', sel: '.main', min: 1 }],
    steps: [
      { name: 'members', js: `setTab('members', document.querySelector('.nav-item'))`, surfaces: [{ name: 'members tab', sel: '#tab-members', min: 1 }] },
      { name: 'leaderboard', js: `setTab('leaderboard', document.querySelector('.nav-item'))`, surfaces: [{ name: 'lb tab', sel: '#tab-leaderboard', min: 1 }] },
      { name: 'events', js: `setTab('events', document.querySelector('.nav-item'))`, surfaces: [{ name: 'events tab', sel: '#tab-events', min: 1 }] },
      { name: 'feed', js: `setTab('feed', document.querySelector('.nav-item'))`, surfaces: [{ name: 'club feed tab', sel: '#tab-feed', min: 1 }] },
      { name: 'reports', js: `setTab('reports', document.querySelector('.nav-item'))`, surfaces: [{ name: 'reports tab', sel: '#tab-reports', min: 1 }] }
    ] },
  { user: 'member', name: 'club-member', path: '/clubs/member/' + club.id, waitFor: '.main', root: 'body',
    surfaces: [
      { name: 'member home', sel: '.main', min: 1 },
      { name: 'member home content', sel: '#cm-content', min: 1 }
    ] }
];

// ── measure ──
const only = process.argv.includes('--page') ? process.argv[process.argv.indexOf('--page') + 1] : null;
const browser = await launchBrowser();
const contexts = {};
for (const key of ['creator', 'member']) {
  contexts[key] = await browser.newContext({ ignoreHTTPSErrors: true });
  await contexts[key].addCookies(users[key].cookies);
}
const summary = [];
for (const cfg of PAGES) {
  if (only && cfg.name !== only) continue;
  let out;
  try {
    out = await auditPage(contexts[cfg.user], BASE, cfg);
  } catch (e) {
    check(`${cfg.name}: page audited`, false, String(e).slice(0, 300));
    summary.push({ page: cfg.name, error: String(e).slice(0, 120) });
    continue;
  }
  console.log(`\n── ${cfg.name} (viewer: ${cfg.user}) ──`);
  for (const s of out.surfaceReport) {
    console.log(`   surface ${s.ok ? 'RENDERED' : (s.found ? 'EMPTY' : 'MISSING')}  ${s.name} (${s.children} children)`);
    check(`${cfg.name}: surface "${s.name}" rendered content (not an unmeasured empty state)`, s.ok, s);
  }
  let pageFails = 0;
  for (const r of out.results) {
    check(`${r.tag}: no page-level horizontal scroll`, r.hscroll <= 1, { hscroll: r.hscroll });
    check(`${r.tag}: nothing clipped inside a container`, !r.audit.missing && r.audit.clipped.length === 0, r.audit.clipped);
    check(`${r.tag}: no text bounding boxes overlap`, !r.audit.missing && r.audit.overlaps.length === 0, r.audit.overlaps);
    check(`${r.tag}: all buttons in-viewport and hit-testable`, !r.audit.missing && r.audit.offscreenButtons.length === 0, r.audit.offscreenButtons);
    pageFails += (r.hscroll > 1) + (r.audit.missing || r.audit.clipped.length ? 1 : 0) + (r.audit.overlaps.length ? 1 : 0) + (r.audit.offscreenButtons.length ? 1 : 0);
  }
  check(`${cfg.name}: zero console/page errors`, out.errors.length === 0, out.errors.slice(0, 4));
  summary.push({ page: cfg.name, failedChecks: pageFails + (out.errors.length ? 1 : 0), surfacesEmpty: out.surfaceReport.filter((s) => !s.ok).length });
}
await browser.close();
console.log('\nPER-PAGE SUMMARY:', JSON.stringify(summary, null, 1));

// ── cleanup ──
if (!process.argv.includes('--keep')) {
  for (const id of CHALLENGES) {
    await admin.from('challenge_invites').delete().eq('challenge_id', id);
    await admin.from('challenge_participants').delete().eq('challenge_id', id);
    await admin.from('challenges').delete().eq('id', id);
  }
  for (const id of EVENTS) { await admin.from('event_rsvps').delete().eq('event_id', id); await admin.from('events').delete().eq('id', id); }
  for (const id of POSTS) {
    await admin.from('post_likes').delete().eq('post_id', id);
    await admin.from('post_comments').delete().eq('post_id', id);
    await admin.from('posts').delete().eq('id', id);
  }
  for (const u of Object.values(users).map((x) => x.id)) {
    for (const t of ['activities', 'achievements', 'goals', 'notifications', 'memberships', 'posts']) await admin.from(t).delete().eq('user_id', u);
    await admin.from('follows').delete().or(`follower_id.eq.${u},following_id.eq.${u}`);
    await admin.from('notifications').delete().eq('actor_id', u);
  }
  await admin.from('clubs').delete().eq('id', club.id);
  for (const u of Object.values(users).map((x) => x.id)) await admin.auth.admin.deleteUser(u);
  console.log('cleanup: seeds removed');
}
console.log(failures ? `\n${failures} FAILURE(S) of ${assertions} assertions` : `\nALL PASS (${assertions} assertions)`);
process.exit(failures ? 1 : 0);
