// PERMANENT GUARD: mobile geometry audit across all app-shell pages.
// Run: node scripts/verify-mobile-geometry.js        (seed → measure → cleanup)
//      --keep         skip cleanup (debugging)
//      --page <name>  audit only one page config
//
// Engine: scripts/lib/mobile-geometry.js. Asserts at 360/380/414px AND
// 1280/1440/1920px (desktop added with the shell-centering work):
//
// No known-failure exemptions — the guard must be fully green. (The former
// feed@desktop side-card clipping was fixed at the source: flex-shrink:0 on
// height-constrained rail children in arenas.css.)
//
// The full 6-width run exceeds a 5-minute shell window — run in halves:
//   GEO_WIDTHS=mobile | desktop | <comma list, e.g. 360,380>.
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
import { launchBrowser, auditPage } from './lib/mobile-geometry.js';
import { mustWrite, makeCleanup } from './lib/checked-writes.js';

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
// Every created row is tracked the moment it exists, so cleanup (in the
// finally block below) removes everything even after a partial-seed crash.
const createdRows = []; // { table, id } in creation order
const createdUsers = []; // auth user ids
async function ins(table, row) {
  const { data, error } = await admin.from(table).insert(row).select().maybeSingle();
  if (error) throw new Error(table + ': ' + error.message);
  if (data && data.id) createdRows.push({ table, id: data.id });
  else createdRows.push({ table, match: row });
  return data;
}
const day = 86400000;
const iso = (d) => new Date(Date.now() + d * day).toISOString();
const dt = (d) => iso(d).slice(0, 10);

// ── seed (dense) ──
let browser = null;
try {
for (const k of Object.keys(userDefs)) { await mkUser(k); createdUsers.push(users[k].id); }
await login('creator'); await login('member');
const C = users.creator.id, M = users.member.id;
const F = [...Array(8)].map((_, i) => users['f' + i].id);
console.log('MANIFEST users:', JSON.stringify(Object.fromEntries(Object.entries(users).map(([k, v]) => [k, v.id]))));

const LONG = 'Late Autumn Ultra-Distance Trail Running Consistency and Elevation Gain Challenge';
const club = await ins('clubs', {
  name: 'Trans-Scandinavian Endurance and Alpine Expedition Society',
  handle: 'geoclub', sport: 'running', city: 'Ytre Snillfjordsbotn', owner_id: C,
  // Listed in the /clubs directory so the clubs page renders a worst-case
  // long-name + long-description card for the geometry pass.
  visibility: 'public',
  description: 'A club for extraordinarily committed long-distance mountain athletes crossing the Scandinavian ranges in all four seasons, with weekly structured sessions and an annual expedition.'
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
// private invite-only event by creator → owner card shows the Invites button;
// invitees (M pending, f0 going) populate the manage overlay's list AND leave
// eligible followees (f1..f4) so the invite-more picker renders too.
const evPriv = await ins('events', { created_by: C, title: 'Invitational Fjordline Night Relay — Headlamp Pacing Practice and Team Selection Trial', sport: 'running',
  event_type: 'training', date: iso(6), location: 'Ytre Snillfjordsbotn Community Athletics Track, North Entrance', visibility: 'private' });
EVENTS.push(evPriv.id);
for (const u of [M, users.f0.id]) await ins('event_invites', { event_id: evPriv.id, invitee_id: u, inviter_id: C });
await ins('event_rsvps', { event_id: evPriv.id, user_id: users.f0.id, status: 'going' });
// Cover images on every seeded event so image-bearing variants of each
// surface are MEASURED (events-page banners incl. the mobile top band,
// calendar day-panel 44px thumbs, member-home 48px thumbs, feed RSVP 56px
// thumbs). Real objects in the private bucket — a broken <img> occupies no
// height and would silently un-measure the banner.
const sharp = (await import('sharp')).default;
const coverWebp = await sharp({ create: { width: 1200, height: 400, channels: 3, background: { r: 30, g: 90, b: 160 } } })
  .webp({ quality: 82 }).toBuffer();
for (const evId of EVENTS) {
  const objectPath = 'events/' + evId + '/' + Date.now() + '.webp';
  const { error: imgErr } = await admin.storage.from('event-images')
    .upload(objectPath, coverWebp, { contentType: 'image/webp', upsert: false });
  if (imgErr) throw new Error('event image seed: ' + imgErr.message);
  await mustWrite('event image pointer for event ' + evId, admin.from('events').update({ image_path: objectPath }).eq('id', evId));
}
// notifications for creator
for (const [a, ty, ti] of [[M, 'like', 'New kudos'], [users.f0.id, 'follow', 'New follower'], [users.f1.id, 'comment', 'New comment']]) {
  await ins('notifications', { user_id: C, actor_id: a, type: ty, title: ti, body: 'Geo seed notification body text' });
}
console.log('MANIFEST club:', club.id, 'challenges:', JSON.stringify(CHALLENGES), 'events:', JSON.stringify(EVENTS));

// ── page configs ──
// MODAL STATES ARE PART OF THIS GUARD: pages at rest never render their
// modals, so every modal is an unmeasured surface unless it has a step here.
// Convention for a modal step: { name, js: <open it>, waitFor: <overlay
// visible>, root: <the overlay id> } — root scopes the geometry audit to the
// modal (the engine deliberately keeps measuring inside the fixed overlay
// when it IS the root). New modals get a step entry, never a new script.
// NOTE the closers: static .modal-overlay modals close via closeModals();
// arenasOverlay-built overlays close via arenasOverlay.close(id).
const htab = (id) => `document.getElementById('htab-${id}').click()`;
const closeModals = `document.querySelectorAll('.modal-overlay').forEach((m) => m.classList.remove('open'));`;
const closeOverlays = `['create-challenge-overlay','challenge-leaderboard-overlay','invite-manager-overlay','challenge-delete-overlay'].forEach((i) => window.arenasOverlay && arenasOverlay.close(i));`;
const PAGES = [
  { user: 'creator', name: 'feed', path: '/feed', waitFor: '.feed-item-wrap', root: 'body',
    surfaces: [
      { name: 'feed items', sel: '.feed-items', min: 3 },
      // Mobile rail restructure: only the Activity streak card survives on
      // phones (the other three are display:none via .sc-mobile-hide) and the
      // rail is reordered above the feed column. Exactly 1 visible card —
      // max guards the hidden-card contract (a regression re-showing the
      // other three cards must fail here, not just a missing streak).
      { name: 'right rail (side-col)', sel: '.side-col', min: 1, max: 1, mobileOnly: true }
    ] },
  { user: 'creator', name: 'challenges', path: '/challenges', waitFor: '#tab-mine .challenge-card', root: 'body',
    surfaces: [{ name: 'mine cards', sel: '#tab-mine', min: 2 }],
    steps: [
      { name: 'discover', js: `document.getElementById('tab-btn-discover').click()`, waitFor: '#discover-grid .challenge-card',
        surfaces: [{ name: 'discover cards', sel: '#discover-grid', min: 1 }] },
      // arenasOverlay-built modal states (runtime construction — trigger them,
      // there is no static markup). openCreateChallenge bypasses the Pro-lock
      // redirect deliberately: the overlay itself is what gets measured.
      { name: 'modal-create-challenge', js: closeOverlays + `window.openCreateChallenge()`,
        waitFor: '#create-challenge-overlay', root: '#create-challenge-overlay' },
      { name: 'modal-challenge-leaderboard', js: closeOverlays + `document.querySelector('[onclick^="viewLeaderboard"]').click()`,
        waitFor: '#challenge-leaderboard-overlay', root: '#challenge-leaderboard-overlay',
        surfaces: [{ name: 'challenge lb panel', sel: '#challenge-leaderboard-overlay > div', min: 2 }] },
      { name: 'modal-invite-manager', js: closeOverlays + `document.querySelector('[onclick^="openInviteManager"]').click()`,
        waitFor: '#invite-manager-overlay', root: '#invite-manager-overlay' },
      { name: 'modal-manage-challenge', js: closeOverlays + `document.querySelector('[onclick^="openDeleteChallenge"]').click()`,
        waitFor: '#challenge-delete-overlay', root: '#challenge-delete-overlay' }
    ] },
  { user: 'member', name: 'challenges-member', path: '/challenges', waitFor: '#tab-mine .challenge-card', root: 'body',
    surfaces: [{ name: 'mine cards (member)', sel: '#tab-mine', min: 1 }],
    steps: [{ name: 'discover', js: `document.getElementById('tab-btn-discover').click()`, waitFor: '#discover-grid .challenge-card',
      surfaces: [{ name: 'discover cards (member)', sel: '#discover-grid', min: 1 }] }] },
  { user: 'creator', name: 'events', path: '/events', waitFor: '#events-grid > *', root: 'body',
    surfaces: [
      { name: 'events grid', sel: '#events-grid', min: 2 },
      // Owner's PRIVATE event card action row: pill + Edit + Invites + Image +
      // Delete (5 children) — the widest manage row anywhere. Measured at all
      // VIEWPORTS (360/380/414); clip/offscreen checks catch a squeezed button.
      { name: 'owner private card actions', sel: '#events-grid div:has(> [onclick*="manageInvites"])', min: 5 },
      // Mobile rail restructure: the "Your RSVPs" card is the rail's ONLY
      // card and is lifted above the events list (flex-column + order:-1 —
      // the collapsed body-grid is display:flex here, not grid). Exactly 1
      // visible card, same contract as the feed rail: a regression that adds
      // cards or re-hides the rail must fail, not pass silently.
      { name: 'right rail (sidebar-col)', sel: '.sidebar-col', min: 1, max: 1, mobileOnly: true }
    ],
    steps: [
      { name: 'modal-create-event', js: `document.getElementById('create-event-btn').click()`,
        waitFor: '#evx-modal', root: '#evx-modal' },
      // Invite manager on the owner's private event card: invitee list (going
      // + pending w/ revoke) plus the invite-more picker and its send button.
      { name: 'modal-event-invites',
        // Batch C1: #evx-modal rides arenasOverlay — close via the primitive
        // (raw .remove() would leave a stale stack entry + locked scroll).
        js: `window.arenasOverlay.close('evx-modal'); window.arenasOverlay.close('evx-inv-modal'); document.querySelector('[onclick*="manageInvites"]').click()`,
        waitFor: '#evx-inv-pick', root: '#evx-inv-modal',
        surfaces: [{ name: 'event invite manager', sel: '#evx-inv-modal > div', min: 2 }] },
      // Shared 3:1 crop overlay (arenas-crop.js on arenasOverlay). Driven via
      // the image hook — file pickers can't be automated here. Non-black test
      // image so the blank-export guard never trips on the seed.
      { name: 'modal-crop',
        js: `['evx-modal','evx-inv-modal'].forEach((id) => window.arenasOverlay.close(id));
             document.querySelectorAll('#evx-img-modal').forEach((m) => m.remove());
             (() => { const c = document.createElement('canvas'); c.width = 300; c.height = 900;
               const x = c.getContext('2d'); x.fillStyle = '#B33A3A'; x.fillRect(0, 0, 300, 900);
               window.arenasCrop.open({ image: c.toDataURL(), onDone: () => {}, onCancel: () => {} }); })()`,
        waitFor: '#arenas-crop-overlay #ac-slider', root: '#arenas-crop-overlay',
        surfaces: [{ name: 'crop overlay panel', sel: '#arenas-crop-overlay > div', min: 4 }] }
    ] },
  { user: 'creator', name: 'leaderboards', path: '/leaderboards', waitFor: '.lb-row', root: 'body',
    surfaces: [
      { name: 'podium', sel: '.podium-stage', min: 3 },
      { name: 'table rows', sel: '.lb-table-header ~ *', min: 1 }
    ],
    steps: [
      // Shared "How points work" modal (arenas-hpw-modal.js) — one
      // representative page; identical overlay on challenges/my-profile.
      { name: 'modal-hpw', js: `document.querySelector('.hpw-link').click()`,
        waitFor: '#hpw-modal-body', root: '#hpw-modal-overlay' }
    ] },
  { user: 'creator', name: 'profile', path: '/profile', waitFor: '.owner-activity-grid .activity-grid-row', root: 'body',
    // The 📷 edit badge deliberately sits ON the avatar circle (desktop
    // parity) — exempt the wrap from the text-overlap rule only.
    ignoreOverlap: ['.hero-av-wrap'],
    surfaces: [
      { name: 'overview', sel: '#tab-overview', min: 1 },
      { name: 'owner four-week rows', sel: '.owner-activity-grid .activity-grid-rows', min: 4, max: 4 },
      { name: 'owner weekday headings', sel: '.owner-activity-grid .activity-grid-weekdays', min: 7, max: 7 }
    ],
    checks: [
      { name: 'owner grid is exactly 4 rows by 7 columns', js: `(() => {
        const rows = [...document.querySelectorAll('.owner-activity-grid .activity-grid-row')];
        const cells = rows.flatMap((row) => [...row.children]);
        return { ok: rows.length === 4 && cells.length === 28 && rows.every((row) => row.children.length === 7),
          rows: rows.length, cells: cells.length };
      })()` }
    ],
    steps: [
      { name: 'activities', js: htab('activities'), surfaces: [{ name: 'activities list', sel: '#tab-activities', min: 1 }] },
      // waitFor the goals-vs-actual bars: they arrive in the same innerHTML
      // assignment as the by-sport svgs, and the render now awaits the goals
      // fetch too — the step's 250ms settle alone is not enough.
      { name: 'stats', js: htab('stats'), waitFor: '#gvw-card .gvw-bar', surfaces: [
        { name: 'stats & PRs body', sel: '#sp-stats-body', min: 1 },
        // By-sport redesign: exactly the three chart SVGs (Sessions, Time,
        // Share of sessions) — weekly stack is divs, so svg count = charts.
        { name: 'by-sport chart svgs', sel: '#sp-stats-body svg[role="img"]', min: 3 },
        // Goals vs actual card (creator has a seeded weekly goal): header +
        // chart body must render at every width (the surface check counts
        // CHILDREN of the matched element, so target the card, not the bars).
        { name: 'goals vs actual card', sel: '#gvw-card', min: 2 }
      ] },
      { name: 'achievements', js: htab('achievements'), surfaces: [{ name: 'achievements tab', sel: '#tab-achievements .content-cols-full', min: 1 }] },
      { name: 'following', js: htab('following'), surfaces: [{ name: 'following grid', sel: '.following-grid', min: 2 }] },
      { name: 'goals', js: htab('goals'), surfaces: [{ name: 'goals tab', sel: '#tab-goals', min: 1 }] },
      // Live my-profile modals. (modal-comment is dead prototype markup with
      // no opener anywhere — not a reachable state, so not measured.)
      // Batch C2: avatar rides arenasOverlay too (root created per-open,
      // no .open class); close it via the primitive before the next step.
      { name: 'modal-avatar-photo', js: closeModals + `window.openAvatarModal()`,
        waitFor: '#modal-avatar-photo .modal-close', root: '#modal-avatar-photo' },
      { name: 'modal-banner-photo',
        js: `window.arenasOverlay.close('modal-avatar-photo'); window.openBannerModal()`,
        waitFor: '#modal-banner-photo .modal-close', root: '#modal-banner-photo' },
      // Batch B: these two open via window.arenasOverlay as well.
      { name: 'modal-delete-account',
        js: `window.arenasOverlay.close('modal-banner-photo'); window.openDeleteModal()`,
        waitFor: '#modal-delete-account .modal-close', root: '#modal-delete-account' },
      { name: 'modal-goal', js: `window.arenasOverlay.close('modal-delete-account'); ` + closeModals + `window.openGoalForm()`,
        waitFor: '#modal-goal .modal-close', root: '#modal-goal' }
    ] },
  { user: 'member', name: 'athlete-profile', path: '/athletes/' + C,
    waitFor: '.activity-overview-split [data-activity-grid]', root: 'body',
    surfaces: [
      { name: 'public four-week rows', sel: '.activity-overview-split .activity-grid-rows', min: 4, max: 4 },
      { name: 'public weekday headings', sel: '.activity-overview-split .activity-grid-weekdays', min: 7, max: 7 },
      { name: 'public by-sport rows', sel: '[data-by-sport-card] div:has(> .public-sport-hours-row)', min: 1 }
    ],
    checks: [
      { name: 'public grid is exactly 4 rows by 7 columns', js: `(() => {
        const rows = [...document.querySelectorAll('.activity-overview-split .activity-grid-row')];
        const cells = rows.flatMap((row) => [...row.children]);
        const future = cells.filter((cell) => cell.dataset.state === 'future');
        return { ok: rows.length === 4 && cells.length === 28 && rows.every((row) => row.children.length === 7)
          && future.every((cell) => cell.children.length === 0),
          rows: rows.length, cells: cells.length, futureWithDots: future.filter((cell) => cell.children.length).length };
      })()` },
      { name: 'ALL-TIME ACTIVITIES stays on one unclipped line', js: `(() => {
        const el = document.querySelector('[data-stat-label="all-time-activities"]');
        if (!el) return { ok: false, missing: true };
        const range = document.createRange(); range.selectNodeContents(el);
        const lines = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0).length;
        return { ok: lines === 1 && el.scrollWidth <= el.clientWidth + 1,
          lines, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
      })()` },
      { name: 'grid and By sport use the intended responsive row', js: `(() => {
        const grid = document.querySelector('.activity-overview-split [data-activity-grid]');
        const sport = document.querySelector('.activity-overview-split [data-by-sport-card]');
        const tracks = [...document.querySelectorAll('.public-sport-hours-track')];
        if (!grid || !sport || !tracks.length) return { ok: false, missing: true };
        const g = grid.getBoundingClientRect(), s = sport.getBoundingClientRect();
        const tracksWide = tracks.every((track) => track.getBoundingClientRect().width >= 24);
        const mobile = window.innerWidth <= 768;
        const layoutOk = mobile
          ? g.bottom <= s.top + 1 && Math.abs(g.width - s.width) <= 2
          : Math.abs(g.top - s.top) <= 2 && g.right <= s.left + 1 && Math.abs(g.width - s.width) <= 2;
        return { ok: layoutOk && tracksWide, mobile, grid: { x:g.x, y:g.y, width:g.width, bottom:g.bottom },
          sport: { x:s.x, y:s.y, width:s.width }, trackWidths: tracks.map((track) => track.getBoundingClientRect().width) };
      })()` }
    ] },
  // Mobile defaults to WEEK view (no .cal-grid) — wait on the shell, then
  // audit week (default) plus an explicit switch to month.
  { user: 'creator', name: 'calendar', path: '/calendar', waitFor: '.main', root: 'body',
    surfaces: [{ name: 'calendar body', sel: '.main', min: 1 }],
    steps: [
      { name: 'month', js: `(document.querySelector('[data-view="month"], #view-month') || [...document.querySelectorAll('button')].find((b) => /month/i.test(b.textContent)) || {click(){}}).click()`,
        surfaces: [{ name: 'month grid', sel: '.cal-grid', min: 7 }] },
      // Day panel on a seeded long-title day (mobile = bottom-sheet layout).
      { name: 'modal-day-panel', js: `window.openDayPanel('${dt(-4)}')`,
        waitFor: '#day-panel.open', root: '#day-panel',
        surfaces: [{ name: 'day panel body', sel: '#day-panel .modal-body', min: 1 }] }
    ] },
  { user: 'creator', name: 'athletes', path: '/athletes', waitFor: '#athlete-grid > *', root: 'body',
    // NOTE: .rec-strip / .nearby-grid / .network-stats exist only as dead
    // prototype CSS — no DOM ever renders them, so they are not surfaces.
    surfaces: [{ name: 'directory cards', sel: '#athlete-grid', min: 4 }],
    steps: [
      { name: 'modal-athlete-profile', js: `document.querySelector('#athlete-grid .adc-card[data-clickable]').click()`,
        // Batch A: quick-view opens via window.arenasOverlay (root created
        // per-open, no .open class); panel ids are unchanged.
        waitFor: '#modal-profile #modal-banner', root: '#modal-profile' }
    ] },
  { user: 'member', name: 'clubs-directory', path: '/clubs', waitFor: '#club-grid > *', root: 'body',
    surfaces: [{ name: 'club cards', sel: '#club-grid', min: 1 }] },
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
      { name: 'reports', js: `setTab('reports', document.querySelector('.nav-item'))`, surfaces: [{ name: 'reports tab', sel: '#tab-reports', min: 1 }] },
      // Live dashboard modals. (modal-event / modal-event-rsvp /
      // modal-challenge are dead prototype markup with no opener — the live
      // RSVP list is the runtime inline #rsvp-modal-overlay built by
      // viewEventRsvps.)
      // Batch C2: club-logo rides arenasOverlay (no .open class).
      { name: 'modal-club-logo', js: closeModals + `window.openClubLogoModal()`,
        waitFor: '#modal-club-logo .modal-close', root: '#modal-club-logo' },
      { name: 'modal-event-rsvps',
        js: `window.arenasOverlay.close('modal-club-logo'); ` + closeModals + `window.viewEventRsvps('${EVENTS[0]}')`,
        waitFor: '#rsvp-modal-overlay', root: '#rsvp-modal-overlay',
        surfaces: [{ name: 'rsvp list panel', sel: '#rsvp-modal-overlay > div', min: 2 }] }
    ] },
  { user: 'member', name: 'club-member', path: '/clubs/member/' + club.id, waitFor: '.main', root: 'body',
    surfaces: [
      { name: 'member home', sel: '.main', min: 1 },
      { name: 'member home content', sel: '#cm-content', min: 1 }
    ] }
];

// ── measure ──
const only = process.argv.includes('--page') ? process.argv[process.argv.indexOf('--page') + 1] : null;
browser = await launchBrowser();
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
  for (const c of out.checksReport || []) {
    check(`${cfg.name}: ${c.name}`, c.ok, c.detail);
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
console.log('\nPER-PAGE SUMMARY:', JSON.stringify(summary, null, 1));

} finally {
  // ── cleanup: runs even after a partial-seed or mid-audit crash. Every
  // deletion is error-checked; any cleanup failure fails the whole run so
  // leaked seed accounts (deterministic emails + shared password) can never
  // pass silently. ──
  if (browser) await browser.close().catch(() => {});
  if (process.argv.includes('--keep')) {
    console.log('cleanup: SKIPPED (--keep) — seeds left in place');
  } else {
    const clean = makeCleanup();
    const del = (label, q) => clean.cw(label, q);
    // Child rows keyed off tracked parents first, then the rows themselves
    // (reverse creation order so FK children go before parents).
    for (const r of [...createdRows].reverse()) {
      if (r.table === 'challenges') {
        await del('challenge_invites', admin.from('challenge_invites').delete().eq('challenge_id', r.id));
        await del('challenge_participants', admin.from('challenge_participants').delete().eq('challenge_id', r.id));
      }
      if (r.table === 'events') {
        await del('event_rsvps', admin.from('event_rsvps').delete().eq('event_id', r.id));
        // Seeded cover-image objects (private bucket) — best-effort sweep.
        try {
          const { data: objs } = await admin.storage.from('event-images').list('events/' + r.id);
          if (objs && objs.length) await admin.storage.from('event-images')
            .remove(objs.map((o) => 'events/' + r.id + '/' + o.name));
        } catch (e) { console.log('event image sweep (ignored):', e.message); }
      }
      if (r.table === 'posts') {
        await del('post_likes', admin.from('post_likes').delete().eq('post_id', r.id));
        await del('post_comments', admin.from('post_comments').delete().eq('post_id', r.id));
      }
      if (r.id) await del(r.table, admin.from(r.table).delete().eq('id', r.id));
      else {
        let q = admin.from(r.table).delete();
        for (const [k, v] of Object.entries(r.match)) if (v !== null && typeof v !== 'object') q = q.eq(k, v);
        await del(r.table + ' (by match)', q);
      }
    }
    // Belt-and-braces sweep by user id, then the auth users themselves.
    for (const u of createdUsers) {
      for (const t of ['activities', 'achievements', 'goals', 'notifications', 'memberships', 'posts']) {
        await del(t + ' by user', admin.from(t).delete().eq('user_id', u));
      }
      await del('follows', admin.from('follows').delete().or(`follower_id.eq.${u},following_id.eq.${u}`));
      await del('notifications by actor', admin.from('notifications').delete().eq('actor_id', u));
    }
    for (const u of createdUsers) {
      await del('auth user ' + u, admin.auth.admin.deleteUser(u));
    }
    if (clean.failed()) { failures += clean.count(); console.log(`cleanup: ${clean.count()} FAILURE(S) — residue may remain, run scripts/test-data-sweep.js`); }
    else console.log(`cleanup: ${createdRows.length} rows + ${createdUsers.length} users removed`);
  }
}
console.log(failures ? `\n${failures} FAILURE(S) of ${assertions} assertions` : `\nALL PASS (${assertions} assertions)`);
process.exit(failures ? 1 : 0);
