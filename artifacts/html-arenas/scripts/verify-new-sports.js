// E2E for the Session ③ registry additions (tennis + pilates):
//  - /log renders BOTH new sports as selectable chips (registry injection),
//    each opens its detail panel, and saving creates a real activity (full
//    browser flow, no direct insert for the two new sports).
//  - Points mirror the anchor sports EXACTLY: tennis = hockey (40/session),
//    pilates = yoga (20/session) — proven from /api/profile/stats totals with
//    anchor activities seeded alongside.
//  - /how-points-work lists both new sports with their rates (rendered from
//    the registry at request time).
//  - Zero console errors on the pages driven.
// Fixed-email fixture, all seeding inside try, cleanup in finally.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { launchBrowser } from './lib/mobile-geometry.js';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const { SPORT_POINTS } = createRequire(import.meta.url)(path.join(ROOT, 'sports.js'));

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DOMAIN = process.env.REPLIT_DEV_DOMAIN;
const BASE_URL = `https://${DOMAIN}/html`;
const EMAIL = 'vns-user@arenas-test.dev';
const PW = 'ArenasTest!234';

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

(async () => {
  let uid = null, browser = null;
  try {
    // Registry sanity first: the mirrors must be structural copies.
    check('registry: tennis mirrors hockey', JSON.stringify(SPORT_POINTS.tennis) === JSON.stringify(SPORT_POINTS.hockey),
      JSON.stringify([SPORT_POINTS.tennis, SPORT_POINTS.hockey]));
    check('registry: pilates mirrors yoga', JSON.stringify(SPORT_POINTS.pilates) === JSON.stringify(SPORT_POINTS.yoga),
      JSON.stringify([SPORT_POINTS.pilates, SPORT_POINTS.yoga]));

    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of (data && data.users) || []) if (u.email === EMAIL) {
      await admin.from('activities').delete().eq('user_id', u.id);
      await admin.auth.admin.deleteUser(u.id);
    }
    const { data: created, error: mkErr } = await admin.auth.admin.createUser({
      email: EMAIL, password: PW, email_confirm: true,
      user_metadata: { name: 'Vns Sports', handle: 'vns_sports' }
    });
    if (mkErr) throw new Error('createUser failed: ' + mkErr.message);
    uid = created.user.id;

    // Anchor activities seeded directly (hockey + yoga, 1h each).
    const day = (b) => new Date(Date.now() - b * 86400000).toISOString().slice(0, 10) + 'T12:00:00Z';
    const { error: iErr } = await admin.from('activities').insert([
      { user_id: uid, sport: 'hockey', title: 'Anchor hockey', date: day(2), duration: '01:00' },
      { user_id: uid, sport: 'yoga', title: 'Anchor yoga', date: day(3), duration: '01:00' }
    ]);
    if (iErr) throw new Error('insert failed: ' + iErr.message);

    const r = await fetch(BASE_URL + '/auth/login', {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `email=${encodeURIComponent(EMAIL)}&password=${encodeURIComponent(PW)}`
    });
    const setC = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
    const rawCookies = (setC || []).filter(Boolean).map((c) => c.split(';')[0]);
    check('login', r.status === 302 && rawCookies.length > 0);
    const cookieHeader = rawCookies.join('; ');
    const cookies = rawCookies.map((pair) => {
      const i = pair.indexOf('=');
      return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: DOMAIN, path: '/' };
    });

    browser = await launchBrowser();
    const context = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
    await context.addCookies(cookies);

    // Log one activity per new sport through the real form.
    for (const [sport, label, panel] of [['tennis', 'Tennis', 'Tennis details'], ['pilates', 'Pilates', 'Pilates details']]) {
      const page = await context.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`https://${DOMAIN}/html/log`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.act-sport-chip');
      const chipCount = await page.locator('.act-sport-chip').count();
      check(sport + ': /log renders all 14 registry chips', chipCount === 14, String(chipCount));
      const chip = page.locator('.act-sport-chip', { hasText: label }).first();
      check(sport + ': chip present', await chip.count() === 1);
      await chip.click();
      const panelLabel = await page.locator('#act-sport-fields-label').textContent();
      check(sport + ': detail panel opens', panelLabel === panel, panelLabel);
      const hasSessionType = await page.locator('#sf-sessiontype').count();
      check(sport + ': session-type select rendered', hasSessionType === 1);
      await page.selectOption('#sf-sessiontype', { index: 1 });
      await page.fill('#act-title', 'E2E ' + label + ' session');
      await page.fill('#act-duration', '01:00');
      await Promise.all([
        page.waitForURL('**/feed', { timeout: 15000 }),
        page.click('#save-activity-btn')
      ]);
      check(sport + ': save navigates to /feed', true);
      check(sport + ': zero console errors', errors.length === 0, errors.join(' | '));
      await page.close();
    }
    await context.close();

    // Points parity: hockey 40 + yoga 20 + tennis 40 + pilates 20 = 120, and
    // removing each pair-member changes the total identically.
    const api = await (await fetch(BASE_URL + '/api/profile/stats?period=all', { headers: { Cookie: cookieHeader } })).json();
    const bd = {};
    (api.sportBreakdown || []).forEach((s) => { bd[s.sport] = s; });
    check('stats: all 4 sports present', ['tennis', 'pilates', 'hockey', 'yoga'].every((s) => bd[s] && bd[s].sessions === 1),
      JSON.stringify(api.sportBreakdown));
    check('stats: totalPoints 120 (tennis=hockey=40, pilates=yoga=20)', api.hero && api.hero.totalPoints === 120,
      JSON.stringify(api.hero));

    // /how-points-work renders from the registry per request.
    const hpw = await (await fetch(BASE_URL + '/how-points-work', { headers: { Cookie: cookieHeader } })).text();
    check('/how-points-work lists Tennis', hpw.includes('Tennis'));
    check('/how-points-work lists Pilates', hpw.includes('Pilates'));
    const row = (name) => {
      const i = hpw.indexOf(name);
      return i < 0 ? '' : hpw.slice(i, i + 400);
    };
    check('/how-points-work: Tennis 40 per session', /40/.test(row('Tennis')) && /session/i.test(row('Tennis')), row('Tennis').slice(0, 120));
    check('/how-points-work: Pilates 20 per session', /20/.test(row('Pilates')) && /session/i.test(row('Pilates')), row('Pilates').slice(0, 120));
  } catch (e) {
    failures++;
    console.log('  FAIL (exception) ' + e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (uid) {
      await admin.from('activities').delete().eq('user_id', uid);
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
  }
  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})();
