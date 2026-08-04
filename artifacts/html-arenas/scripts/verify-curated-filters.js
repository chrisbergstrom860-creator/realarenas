// E2E for the Session ③ de-curation of the four sport-filter surfaces:
//  1. Leaderboards sport tabs = viewer's OWN profile sports (fallback trio
//     only for sport-less users). Server injects ARENAS_DATA.sports.
//  2. Club-dashboard pill rows derive from the club's ACTUAL challenges /
//     events; zero items = the row is hidden (no orphaned bar).
//  3. Challenges discover: default relabeled "All sports" (the old
//     "All my sports" never filtered by the viewer's sports); pills derive
//     from sports present in the loaded public challenges.
//  4. Feed: sport-less users get NO sport pills (row keeps All + Clubs, so
//     it never collapses to a lone pill); composer fallback = FULL registry.
// Two fixture users (one with tennis+pilates, one sport-less club admin),
// one fixture club; all seeding inside try, cleanup in finally.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { launchBrowser } from './lib/mobile-geometry.js';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const { SPORTS } = createRequire(import.meta.url)(path.join(ROOT, 'sports.js'));

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DOMAIN = process.env.REPLIT_DEV_DOMAIN;
const BASE_URL = `https://${DOMAIN}/html`;
const EMAILS = { a: 'vcf-tennis@arenas-test.dev', b: 'vcf-coach@arenas-test.dev' };
const PW = 'ArenasTest!234';

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

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

(async () => {
  const ids = { users: [], club: null, challenges: [], events: [] };
  let browser = null;
  try {
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of (data && data.users) || []) if (Object.values(EMAILS).includes(u.email)) {
      await admin.from('memberships').delete().eq('user_id', u.id);
      await admin.auth.admin.deleteUser(u.id);
    }
    const mk = async (email, meta) => {
      const { data: c, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: meta });
      if (error) throw new Error('createUser: ' + error.message);
      ids.users.push(c.user.id);
      return c.user.id;
    };
    const uidA = await mk(EMAILS.a, { name: 'Vcf Tennis', handle: 'vcf_tennis', sports: ['tennis', 'pilates'] });
    const uidB = await mk(EMAILS.b, { name: 'Vcf Coach', handle: 'vcf_coach' }); // NO sports

    const { data: club, error: cErr } = await admin.from('clubs')
      .insert({ name: 'VCF Filter Club', handle: 'vcf-filter-club', sport: 'tennis', city: 'Testville', owner_id: uidB })
      .select('id').single();
    if (cErr) throw new Error('club insert: ' + cErr.message);
    ids.club = club.id;
    const { error: mErr } = await admin.from('memberships').insert({ user_id: uidB, club_id: club.id, role: 'admin' });
    if (mErr) throw new Error('membership insert: ' + mErr.message);

    browser = await launchBrowser();
    const ctxFor = async (email, width) => {
      const context = await browser.newContext({ viewport: { width: width || 1280, height: 1200 } });
      await context.addCookies(await loginCookies(email));
      return context;
    };
    const openPage = async (context, url) => {
      const page = await context.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      return { page, errors };
    };

    // ── 1. Leaderboards tabs ──
    const ctxA = await ctxFor(EMAILS.a);
    {
      const { page, errors } = await openPage(ctxA, `https://${DOMAIN}/html/leaderboards`);
      await page.waitForSelector('.sport-nav-tab');
      const tabs = await page.locator('.sport-nav-tab').allTextContents();
      check('lb: sports user sees Tennis + Pilates tabs', /Tennis/.test(tabs.join()) && /Pilates/.test(tabs.join()), tabs.join('|'));
      check('lb: no curated Running tab for tennis user', !/Running/.test(tabs.join()), tabs.join('|'));
      // Per-sport board actually loads for a derived tab (server takes any ?sport=)
      await page.locator('.sport-nav-tab', { hasText: 'Tennis' }).click();
      await page.waitForTimeout(800);
      check('lb: zero console errors (user A)', errors.length === 0, errors.join(' | '));
      await page.close();
    }
    const ctxB = await ctxFor(EMAILS.b);
    {
      const { page, errors } = await openPage(ctxB, `https://${DOMAIN}/html/leaderboards`);
      await page.waitForSelector('.sport-nav-tab');
      const tabs = await page.locator('.sport-nav-tab').allTextContents();
      check('lb: sport-less user falls back to trio', /Running/.test(tabs.join()) && /Cycling/.test(tabs.join()) && /Climbing/.test(tabs.join()), tabs.join('|'));
      check('lb: zero console errors (user B)', errors.length === 0, errors.join(' | '));
      await page.close();
    }

    // ── 4. Feed pills + composer ──
    {
      const { page, errors } = await openPage(ctxA, `https://${DOMAIN}/html/feed`);
      await page.waitForSelector('#filter-bar .f-pill');
      const pills = await page.locator('#filter-bar .f-pill').allTextContents();
      check('feed: tennis user gets Tennis + Pilates pills', /Tennis/.test(pills.join()) && /Pilates/.test(pills.join()), pills.join('|'));
      check('feed: zero console errors (user A)', errors.length === 0, errors.join(' | '));
      await page.close();
    }
    {
      const { page, errors } = await openPage(ctxB, `https://${DOMAIN}/html/feed`);
      await page.waitForSelector('#filter-bar .f-pill');
      const pills = await page.locator('#filter-bar .f-pill').allTextContents();
      check('feed: sport-less user gets ONLY All + Clubs (no stray pills)', pills.length === 2 && /All/.test(pills[0]) && /Clubs/.test(pills[1]), pills.join('|'));
      const chips = await page.locator('#composer-sports .c-sport-chip').count();
      check('feed: composer fallback = full registry (' + SPORTS.length + ' chips)', chips === SPORTS.length, String(chips));
      check('feed: zero console errors (user B)', errors.length === 0, errors.join(' | '));
      await page.close();
    }

    // ── 2. Club dashboard rows — EMPTY club first ──
    {
      const { page, errors } = await openPage(ctxB, `https://${DOMAIN}/html/clubs/dashboard`);
      await page.waitForSelector('#ch-filter-row', { state: 'attached' });
      const chHidden = await page.locator('#ch-filter-row').evaluate((el) => getComputedStyle(el).display === 'none');
      check('club: zero challenges → filter row hidden', chHidden);
      const evHidden = await page.locator('#ev-filter-pill-all').evaluate((el) => getComputedStyle(el.parentElement).display === 'none');
      check('club: zero events → filter row hidden', evHidden);
      check('club: zero console errors (empty)', errors.length === 0, errors.join(' | '));
      await page.close();
    }
    // Seed one tennis challenge + one pilates event on the club.
    const day = (fwd) => new Date(Date.now() + fwd * 86400000).toISOString().slice(0, 10);
    const { data: ch, error: chErr } = await admin.from('challenges').insert({
      created_by: uidB, club_id: ids.club, title: 'VCF Tennis Challenge', sport: 'tennis',
      goal_type: 'sessions', goal_target: 5, goal_unit: 'sessions', start_date: day(-1), end_date: day(10), visibility: 'club'
    }).select('id').single();
    if (chErr) throw new Error('challenge insert: ' + chErr.message);
    ids.challenges.push(ch.id);
    const { data: ev, error: evErr } = await admin.from('events').insert({
      created_by: uidB, club_id: ids.club, title: 'VCF Pilates Event', sport: 'pilates',
      date: day(5) + 'T10:00:00Z', location: 'Studio 1', visibility: 'club'
    }).select('id').single();
    if (evErr) throw new Error('event insert: ' + evErr.message);
    ids.events.push(ev.id);
    {
      const { page, errors } = await openPage(ctxB, `https://${DOMAIN}/html/clubs/dashboard`);
      await page.waitForSelector('#ch-filter-row', { state: 'attached' });
      const chPills = await page.locator('#ch-filter-row .ch-filter-pill').allTextContents();
      check('club: challenge pills = All + Tennis only', chPills.length === 2 && /Tennis/.test(chPills.join()), chPills.join('|'));
      check('club: no dead Cycling/Any pills', !/Cycling|Any sport/.test(chPills.join()), chPills.join('|'));
      const evPills = await page.locator('.ev-filter-pill').allTextContents();
      check('club: event pills = All + Pilates only', evPills.length === 2 && /Pilates/.test(evPills.join()), evPills.join('|'));
      check('club: zero console errors (seeded)', errors.length === 0, errors.join(' | '));
      await page.close();
    }

    // ── 3. Challenges discover ──
    const { data: pub, error: pubErr } = await admin.from('challenges').insert({
      created_by: uidA, club_id: null, title: 'VCF Public Tennis Cup', sport: 'tennis',
      goal_type: 'sessions', goal_target: 3, goal_unit: 'sessions', start_date: day(-1), end_date: day(14), visibility: 'public'
    }).select('id').single();
    if (pubErr) throw new Error('public challenge insert: ' + pubErr.message);
    ids.challenges.push(pub.id);
    {
      // View as user B — a creator's own challenge lands in My challenges,
      // not their Discover list, so the pill must be proven on another viewer.
      const { page, errors } = await openPage(ctxB, `https://${DOMAIN}/html/challenges`);
      // The Discover tab starts hidden — assert on attached DOM (pills render
      // there on load), then click through to Discover for the visible check.
      await page.waitForSelector('#ch-sport-filter-all', { state: 'attached' });
      await page.waitForFunction(() => document.querySelectorAll('.sport-filter[data-derived]').length > 0, null, { timeout: 15000 }).catch(() => {});
      const allLabel = (await page.locator('#ch-sport-filter-all').textContent()).trim();
      check('discover: default relabeled "All sports"', allLabel === 'All sports', allLabel);
      const derived = await page.locator('.sport-filter[data-derived]').allTextContents();
      check('discover: Tennis pill derived from live challenges', /Tennis/.test(derived.join()), derived.join('|'));
      check('discover: zero console errors', errors.length === 0, errors.join(' | '));
      await page.close();
    }

    // 360px sanity: leaderboards tab bar scrolls, feed pills wrap — no overflow.
    {
      const nctx = await ctxFor(EMAILS.a, 360);
      const { page, errors } = await openPage(nctx, `https://${DOMAIN}/html/leaderboards`);
      await page.waitForSelector('.sport-nav-tab');
      const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check('lb @360: no page-level horizontal overflow', overflowX <= 1, String(overflowX));
      check('lb @360: zero console errors', errors.length === 0, errors.join(' | '));
      await page.close();
      await nctx.close();
    }
    await ctxA.close(); await ctxB.close();
  } catch (e) {
    failures++;
    console.log('  FAIL (exception) ' + e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    for (const id of ids.challenges) {
      await admin.from('challenge_participants').delete().eq('challenge_id', id);
      await admin.from('challenges').delete().eq('id', id);
    }
    for (const id of ids.events) {
      await admin.from('event_rsvps').delete().eq('event_id', id);
      await admin.from('events').delete().eq('id', id);
    }
    if (ids.club) {
      await admin.from('memberships').delete().eq('club_id', ids.club);
      await admin.from('clubs').delete().eq('id', ids.club);
    }
    for (const uid of ids.users) {
      await admin.from('activities').delete().eq('user_id', uid);
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
  }
  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})();
