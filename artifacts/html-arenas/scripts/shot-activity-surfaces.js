// Screenshot harness for the activity-card convergence (task: shared renderer).
// Seeds ONE persistent fixture set, screenshots the three activity-card
// surfaces (main feed as follower, club dashboard Feed tab as admin, profile
// Activities tab as author) at 1280 and 360, then cleans up when told to.
//
//   node scripts/shot-activity-surfaces.js seed         — create fixtures (manifest: /tmp/vac-manifest.json)
//   node scripts/shot-activity-surfaces.js shot <dir>   — take the 6 screenshots into <dir>
//   node scripts/shot-activity-surfaces.js clean        — delete fixtures via the manifest
//
// Dates/created_at are pinned 3 days back so "3d ago" stays stable between the
// before and after runs (pixel diff must not be polluted by timeAgo drift).
import fs from 'node:fs';
import { launchBrowser } from './lib/mobile-geometry.js';
import { createClient } from '@supabase/supabase-js';

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DOMAIN = process.env.REPLIT_DEV_DOMAIN;
const BASE_URL = `https://${DOMAIN}/html`;
const MANIFEST = '/tmp/vac-manifest.json';
const AUTHOR = 'vac-shot-author@arenas-test.dev';
const VIEWER = 'vac-shot-viewer@arenas-test.dev';
const PW = 'ArenasTest!234';

async function loginCookies(email) {
  const r = await fetch(BASE_URL + '/auth/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(PW)}`
  });
  const setC = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  const raw = (setC || []).filter(Boolean).map((c) => c.split(';')[0]);
  if (r.status !== 302 || !raw.length) throw new Error('login failed for ' + email);
  return raw.map((pair) => {
    const i = pair.indexOf('=');
    return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: DOMAIN, path: '/' };
  });
}

const LONG_NOTE = ('Long interval session out on the river loop. ' +
  'Legs felt heavy for the first two reps but the rhythm came back once I settled into the cadence. ' +
  'Negative-split the last three and finished with a controlled float. ').repeat(2) +
  'Fueling worked well; repeat next week.';
const MULTILINE_NOTE = 'Warmup 15min easy\nMain set: 4x8min threshold\nCooldown jog\nFelt strong on rep 3';

async function seed() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of (data && data.users) || []) if ([AUTHOR, VIEWER].includes(u.email)) await admin.auth.admin.deleteUser(u.id);
  const mk = async (email, name, handle) => {
    const { data: c, error } = await admin.auth.admin.createUser({
      email, password: PW, email_confirm: true,
      user_metadata: { name, handle, sports: ['running'] }
    });
    if (error) throw new Error('createUser: ' + error.message);
    return c.user.id;
  };
  const authorId = await mk(AUTHOR, 'Shot Author', 'vac_author');
  const viewerId = await mk(VIEWER, 'Shot Viewer', 'vac_viewer');
  const { error: fErr } = await admin.from('follows').insert({ follower_id: viewerId, following_id: authorId });
  if (fErr) throw new Error('follows: ' + fErr.message);

  const pinned = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  const acts = [
    { user_id: authorId, sport: 'running', title: 'VAC long note run', duration: '00:45:00', distance: '12 km', pace: '5:10 /km', notes: LONG_NOTE, date: pinned, created_at: pinned },
    { user_id: authorId, sport: 'running', title: 'VAC multiline run', duration: '00:40:00', notes: MULTILINE_NOTE, date: pinned, created_at: pinned },
    { user_id: authorId, sport: 'cycling', title: 'VAC short note ride', duration: '01:00:00', distance: '30 km', notes: 'Quick spin, easy day', date: pinned, created_at: pinned },
    { user_id: authorId, sport: 'running', title: 'VAC noteless run', duration: '00:20:00', notes: null, date: pinned, created_at: pinned },
    // Newer registry sports — prove pills pick up registry colors for them too.
    { user_id: authorId, sport: 'tennis', title: 'VAC tennis session', duration: '01:10:00', notes: 'Serve drills + two tiebreak sets', date: pinned, created_at: pinned },
    { user_id: authorId, sport: 'pilates', title: 'VAC pilates class', duration: '00:50:00', notes: null, date: pinned, created_at: pinned }
  ];
  const { error: aErr } = await admin.from('activities').insert(acts);
  if (aErr) throw new Error('activities: ' + aErr.message);

  const { data: club, error: cErr } = await admin.from('clubs')
    .insert({ name: 'VAC Shot Club', handle: 'vac-shot-club', sport: 'running', owner_id: authorId }).select().single();
  if (cErr) throw new Error('club: ' + cErr.message);
  const { error: mErr } = await admin.from('memberships').insert({ user_id: authorId, club_id: club.id, role: 'admin' });
  if (mErr) throw new Error('membership: ' + mErr.message);

  fs.writeFileSync(MANIFEST, JSON.stringify({ authorId, viewerId, clubId: club.id }, null, 2));
  console.log('seeded — manifest at ' + MANIFEST + ' (club ' + club.id + ')');
}

async function shot(dir) {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  fs.mkdirSync(dir, { recursive: true });
  const browser = await launchBrowser();
  const vCookies = await loginCookies(VIEWER);
  const aCookies = await loginCookies(AUTHOR);
  const targets = [
    { name: 'feed', cookies: vCookies, url: BASE_URL + '/feed', waitFn: () => Array.from(document.querySelectorAll('.feed-item-wrap')).some((c) => c.textContent.includes('VAC')) },
    { name: 'club-feed', cookies: aCookies, url: BASE_URL + '/clubs/dashboard?club=' + m.clubId + '#feed', waitFn: () => { const el = document.getElementById('cf-feed-list'); return el && el.textContent.includes('VAC'); } },
    { name: 'profile-acts', cookies: aCookies, url: BASE_URL + '/profile#activities', waitFn: () => document.querySelector('.activity-card-item') },
    // Unauthed marketing page — carries static sport-tag mocks whose hexes the guard covers.
    { name: 'landing', cookies: [], url: BASE_URL + '/landing', waitFn: () => document.querySelector('.prev-sport-tag') }
  ];
  try {
    for (const width of [1280, 360]) {
      for (const t of targets) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 } });
        await ctx.addCookies(t.cookies);
        const page = await ctx.newPage();
        await page.goto(t.url, { waitUntil: 'domcontentloaded' });
        if (t.waitFn) await page.waitForFunction(t.waitFn, { timeout: 20000 });
        await page.waitForTimeout(1200); // fonts/avatars/late paints settle
        await page.screenshot({ path: `${dir}/${t.name}-${width}.png`, fullPage: true });
        console.log(`shot ${t.name}-${width}.png`);
        await ctx.close();
      }
    }
  } finally { await browser.close().catch(() => {}); }
}

async function clean() {
  let m = null;
  try { m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { /* fall through to email lookup */ }
  const clubId = m && m.clubId;
  if (clubId) {
    await admin.from('memberships').delete().eq('club_id', clubId).then(() => {});
    await admin.from('clubs').delete().eq('id', clubId).then(() => {});
  }
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const ids = ((data && data.users) || []).filter((u) => [AUTHOR, VIEWER].includes(u.email)).map((u) => u.id);
  const USER_REFS = [
    ['activities', 'user_id'], ['posts', 'user_id'], ['post_likes', 'user_id'],
    ['activity_likes', 'user_id'], ['post_comments', 'user_id'],
    ['follows', 'follower_id'], ['follows', 'following_id'],
    ['memberships', 'user_id'], ['event_rsvps', 'user_id'],
    ['challenge_participants', 'user_id'], ['notifications', 'user_id'], ['notifications', 'actor_id'],
    ['goals', 'user_id'], ['achievements', 'user_id'], ['planned_sessions', 'user_id'],
    ['profiles', 'id']
  ];
  for (const id of ids) {
    for (const [t, c] of USER_REFS) await admin.from(t).delete().eq(c, id).then(() => {});
    let { error: dErr } = await admin.auth.admin.deleteUser(id);
    if (dErr) ({ error: dErr } = await admin.auth.admin.deleteUser(id));
    if (dErr) console.log('WARN cleanup: deleteUser ' + id + ' — ' + dErr.message);
  }
  try { fs.unlinkSync(MANIFEST); } catch { /* already gone */ }
  console.log('cleaned (' + ids.length + ' users)');
}

const cmd = process.argv[2];
if (cmd === 'seed') seed().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
else if (cmd === 'shot') shot(process.argv[3] || '/tmp/vac-shots').then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
else if (cmd === 'clean') clean().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
else { console.error('usage: seed | shot <dir> | clean'); process.exit(1); }
