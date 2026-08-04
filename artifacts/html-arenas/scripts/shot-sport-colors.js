// Screenshot every surface that consumes the sports-registry accent color
// (colors.text) so a registry change can be compared before/after. Usage:
//   node scripts/shot-sport-colors.js before   → screenshots/sport-colors/before-*.png
//   node scripts/shot-sport-colors.js after
// Seeds one athlete with activities across all 12 sports (one with no
// recorded time) + a club so the dashboard surfaces render. Cleans up fully.
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import { launchBrowser } from './lib/mobile-geometry.js';

const LABEL = process.argv[2] || 'before';
const OUT = 'screenshots/sport-colors';
fs.mkdirSync(OUT, { recursive: true });

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DOMAIN = process.env.REPLIT_DEV_DOMAIN;
const BASE = `https://${DOMAIN}/html`;
const PW = 'ArenasTest!234';
const EMAIL = 'scshot-user@arenas-test.dev';

// Track created resources so the finally-block cleanup can always run —
// no seed step may sit outside the try (a mid-seed failure must not orphan
// the fixed-email account or its rows).
let uid = null;
let club = null;
let browser = null;
let failed = false;
try {
  // ── Cleanup any prior residue, then seed ──
  {
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of (data && data.users) || []) if (u.email === EMAIL) {
      await admin.from('activities').delete().eq('user_id', u.id);
      await admin.auth.admin.deleteUser(u.id);
    }
    await admin.from('clubs').delete().eq('handle', 'scshot-club');
  }
  const { data: created, error: mkErr } = await admin.auth.admin.createUser({
    email: EMAIL, password: PW, email_confirm: true,
    user_metadata: { name: 'Scshot Athlete', handle: 'scshot_athlete' }
  });
  if (mkErr) throw new Error('createUser: ' + mkErr.message);
  uid = created.user.id;
  const { data: clubRow, error: clubErr } = await admin.from('clubs')
    .insert({ name: 'Scshot Club', handle: 'scshot-club', sport: 'running', owner_id: uid }).select().single();
  if (clubErr) throw new Error('club: ' + clubErr.message);
  club = clubRow;
  const { error: memErr } = await admin.from('memberships').insert({ user_id: uid, club_id: club.id, role: 'coach' });
  if (memErr) throw new Error('membership: ' + memErr.message);

  // Activities across all 12 sports, recent dates (this month window), varied
  // sessions so the charts rank; golf deliberately has NO duration (the "—"
  // case); distance sports carry km.
  const SPORTS_SEED = [
  ['running', 4, '00:45', '8 km'], ['cycling', 3, '01:30', '40 km'],
  ['swimming', 2, '00:40', '1.5 km'], ['hiking', 1, '03:00', '12 km'],
  ['climbing', 2, '01:15', null], ['football', 2, '01:00', null],
  ['weightlifting', 3, '00:50', null], ['yoga', 2, '01:00', null],
  ['golf', 1, null, null], ['pickleball', 1, '00:45', null],
  ['basketball', 2, '00:55', null], ['hockey', 1, '01:00', null]
];
  const rows = [];
  let dayBack = 0;
  for (const [sport, n, dur, dist] of SPORTS_SEED) {
    for (let i = 0; i < n; i++) {
      const d = new Date(Date.now() - dayBack * 86400000); dayBack = (dayBack + 1) % 20;
      rows.push({
        user_id: uid, sport, title: `${sport} session ${i + 1}`,
        date: d.toISOString().slice(0, 10) + 'T12:00:00Z',
        duration: dur, distance: dist
      });
    }
  }
  const { error: actErr } = await admin.from('activities').insert(rows);
  if (actErr) throw new Error('activities: ' + actErr.message);
  console.log('MANIFEST:', JSON.stringify({ uid, club: club.id, activities: rows.length }));

  const r = await fetch(BASE + '/auth/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(EMAIL)}&password=${encodeURIComponent(PW)}`
  });
  const setC = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  const cookies = (setC || []).filter(Boolean).map((c) => {
    const [pair] = c.split(';'); const i = pair.indexOf('=');
    return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: DOMAIN, path: '/' };
  });
  if (r.status !== 302 || !cookies.length) throw new Error('login failed');

  browser = await launchBrowser();
  const shots = [
    // Sport pills on the merged feed (own activities render as feed cards).
    { name: 'feed', path: '/feed', waitFor: '.main', settle: 1200 },
    // Sport pills on the profile Activities tab.
    { name: 'profile-activities', path: '/profile', waitFor: '.hero-inner', settle: 1200,
      js: `var t=document.getElementById('htab-activities'); if(t) t.click();` },
    // Stats & PRs: By-sport card + weekly stack — the chart surfaces.
    { name: 'profile-stats', path: '/profile#stats', waitFor: '.hero-inner', settle: 2000,
      js: `var t=document.getElementById('htab-stats'); if(t) t.click();` },
    // Athlete directory cards (sport tag pills via arenas-athlete-cards.js).
    { name: 'athletes', path: '/athletes', waitFor: '.main', settle: 1200 },
    // Club dashboard (members/feed surfaces derive pill styles from the registry).
    { name: 'club-dashboard', path: '/clubs/dashboard?club=' + club.id, waitFor: '.main', settle: 1600 }
  ];
  for (const width of [1280, 380]) {
    const context = await browser.newContext({ viewport: { width, height: 1600 } });
    await context.addCookies(cookies);
    const page = await context.newPage();
    for (const s of shots) {
      await page.goto(BASE + s.path, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector(s.waitFor, { timeout: 15000 });
      if (s.js) await page.evaluate(s.js);
      await page.waitForTimeout(s.settle);
      await page.screenshot({ path: `${OUT}/${LABEL}-${s.name}-${width}.png`, fullPage: true });
      console.log('saved', `${OUT}/${LABEL}-${s.name}-${width}.png`);
    }
    await context.close();
  }
} catch (e) {
  failed = true;
  console.error('SHOT FAILURE:', e.message);
} finally {
  if (browser) await browser.close();
  // ── Cleanup (error-checked, guarded — runs whatever seeding reached) ──
  const del = async (label, p) => { const { error } = await p; if (error) { failed = true; console.error('CLEANUP FAIL ' + label + ': ' + error.message); } };
  if (uid) {
    await del('activities', admin.from('activities').delete().eq('user_id', uid));
    await del('memberships', admin.from('memberships').delete().eq('user_id', uid));
  }
  if (club) await del('club', admin.from('clubs').delete().eq('id', club.id));
  if (uid) {
    const { error: uErr } = await admin.auth.admin.deleteUser(uid);
    if (uErr) { failed = true; console.error('CLEANUP FAIL user: ' + uErr.message); }
  }
  console.log(failed ? 'DONE WITH FAILURES' : 'DONE CLEAN');
  process.exit(failed ? 1 : 0);
}
