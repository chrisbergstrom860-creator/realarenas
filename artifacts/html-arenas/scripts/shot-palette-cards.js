// Before/after screenshots for challenge cards (PROGRESS_COLORS bar fills).
// Seeds ONE athlete joined to 14 session challenges (one per registry sport)
// each at 50% progress so every bar renders a visible fill. Usage:
//   node scripts/shot-palette-cards.js before|after   → screenshots/palette-cards/<label>-*.png
//   node scripts/shot-palette-cards.js clean          → remove fixtures only
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import { launchBrowser } from './lib/mobile-geometry.js';

const LABEL = process.argv[2] || 'before';
const OUT = 'screenshots/palette-cards';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BASE = `https://${process.env.REPLIT_DEV_DOMAIN}/html`;
const EMAIL = 'palshot-user@arenas-test.dev';
const PW = 'ArenasTest!234';
const day = 86400000;
const iso = (d) => new Date(Date.now() + d * day).toISOString();

async function cleanup() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of (data && data.users) || []) if (u.email === EMAIL) {
    await admin.from('challenge_participants').delete().eq('user_id', u.id);
    await admin.from('challenges').delete().eq('created_by', u.id);
    await admin.from('activities').delete().eq('user_id', u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
}
if (LABEL === 'clean') { await cleanup(); console.log('cleaned'); process.exit(0); }

fs.mkdirSync(OUT, { recursive: true });
const SPORTS = ['running','cycling','climbing','swimming','football','weightlifting','hiking','yoga','golf','pickleball','basketball','hockey','tennis','pilates'];
let browser = null;
let failed = false;
try {
  await cleanup();
  const { data: created, error: mkErr } = await admin.auth.admin.createUser({
    email: EMAIL, password: PW, email_confirm: true,
    user_metadata: { name: 'Palshot Athlete', handle: 'palshot_athlete' }
  });
  if (mkErr) throw new Error('createUser: ' + mkErr.message);
  const uid = created.user.id;
  console.log('MANIFEST user:', uid);
  const chalIds = [];
  for (const sport of SPORTS) {
    const { data: c, error } = await admin.from('challenges').insert({
      created_by: uid, title: `Palshot ${sport} sprint`, sport,
      goal_type: 'sessions', goal_target: 2, goal_unit: 'sessions',
      start_date: iso(-3), end_date: iso(11), visibility: 'private', description: null, club_id: null
    }).select().single();
    if (error) throw new Error(`challenge ${sport}: ${error.message}`);
    chalIds.push(c.id);
    await admin.from('challenge_participants').insert({ challenge_id: c.id, user_id: uid });
    // one session inside the window → 1/2 = 50% bar fill
    const { error: aErr } = await admin.from('activities').insert({
      user_id: uid, sport, title: `Palshot ${sport} session`,
      duration: '00:45', date: iso(-1)
    });
    if (aErr) throw new Error(`activity ${sport}: ${aErr.message}`);
  }
  console.log('MANIFEST challenges:', JSON.stringify(chalIds));

  browser = await launchBrowser();
  const ctx = await browser.newContext({ viewportSize: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto(`${BASE}/landing`, { waitUntil: 'networkidle' });
  await page.evaluate(async ({ base, email, pw }) => {
    const body = new URLSearchParams({ email, password: pw });
    await fetch(`${base}/auth/login`, { method: 'POST', body, redirect: 'manual' });
  }, { base: BASE, email: EMAIL, pw: PW });

  for (const [path, name] of [['/challenges', 'challenges']]) {
    for (const w of [1280, 360]) {
      await page.setViewportSize({ width: w, height: w === 360 ? 800 : 900 });
      await page.goto(BASE + path, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/${LABEL}-${name}-${w}.png`, fullPage: true });
      console.log(`shot ${LABEL}-${name}-${w}`);
    }
  }
  console.log('console errors:', consoleErrors.length ? JSON.stringify(consoleErrors) : 'none');
} catch (e) {
  failed = true;
  console.error('FAILED:', e.message);
} finally {
  if (browser) await browser.close();
  await cleanup(); // each run seeds fresh, so always sweep its own fixtures
  process.exit(failed ? 1 : 0);
}
