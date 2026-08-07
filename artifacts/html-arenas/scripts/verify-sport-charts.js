// Verifies the redesigned "By sport" card (shared builder:
// html/arenas-sport-charts.js — three charts + exact-figures table).
//
// 1. Builder fixed cases (real module in a sandbox): largest-remainder
//    percentages sum to exactly 100 and match hand-computed shares; registry
//    color per sport reused across Sessions bars, Time bars, pie slice,
//    legend swatch, and table swatch; single sport = full <circle>; empty /
//    zero-session breakdown = ''; sessions-without-time = "—" label + 2px
//    stub in the sport color; distance figures land in the table ("—" when
//    none); legend lists EVERY sport; 12-sport render shrinks value labels.
// 2. Rendered-color distinguishability: every fill the builder emits for a
//    12-sport breakdown stays pairwise CIE76 ΔE >= 20 (same floor as the
//    registry guard, but measured on the actual markup output).
// 3. E2E: seeds a multi-sport user (incl. a no-duration sport), logs in, and
//    asserts the live profile page at 1280/414/380/360 renders exactly three
//    chart SVGs whose bar labels, legend percentages, and table figures match
//    /api/profile/stats EXACTLY; per-sport fill hex identical across all
//    three SVGs and equal to the registry; mobile stacks the charts (single
//    column) with the pie legend BELOW the pie; zero console errors.
//    Cleans the seeded user up afterwards (error-checked).
//
// Run with the dev server up: node artifacts/html-arenas/scripts/verify-sport-charts.js
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { createClient } from '@supabase/supabase-js';
import { launchBrowser } from './lib/mobile-geometry.js';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = 'http://localhost:80/html';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

// ── Load the real builder ──
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'html', 'arenas-sport-charts.js'), 'utf8'), sandbox);
const buildSportCharts = sandbox.window.buildSportCharts;

const SPORTS = require(path.join(ROOT, 'sports.js')).SPORTS;
const COLORS = {};
const HEX = {};
SPORTS.forEach((s) => { COLORS[s.id] = { bar: s.colors.text, icon: s.emoji, name: s.label }; HEX[s.id] = s.colors.text; });

const fills = (html) => [...html.matchAll(/(?:fill|background):?[="]*\s*(#[0-9A-Fa-f]{6})/g)].map((m) => m[1].toUpperCase());
// Legend percents render as ">NN%</span>" — in-slice labels are SVG <text>
// (fill="#FFFFFF">NN%</text>) and style attrs contain "100%", so anchor on
// the closing </span>.
const legendPcts = (html) => [...html.matchAll(/>(\d+)%<\/span>/g)].map((m) => parseInt(m[1], 10));

function fixedCases() {
  console.log('— builder fixed cases —');
  // 8/3/1 → exact 66.667/25/8.333 → largest remainder → 67/25/8.
  let html = buildSportCharts([
    { sport: 'cycling', sessions: 8, km: 120, hours: 6.5 },
    { sport: 'weightlifting', sessions: 3, km: 0, hours: 2.5 },
    { sport: 'golf', sessions: 1, km: 0, hours: 0 }
  ], COLORS, false);
  const pcts = legendPcts(html);
  check('8/3/1 legend → 67/25/8 (sums 100)', JSON.stringify(pcts) === '[67,25,8]', JSON.stringify(pcts));
  check('three chart SVGs', (html.match(/<svg /g) || []).length === 3);
  for (const id of ['cycling', 'weightlifting', 'golf']) {
    const n = fills(html).filter((f) => f === HEX[id].toUpperCase()).length;
    // sessions bar + time bar + slice + legend swatch + table swatch = 5
    check(id + ' registry hex ' + HEX[id] + ' appears in all 5 slots', n === 5, 'found ' + n);
  }
  check('golf zero hours → "—" label above stub', />—<\/text>/.test(html));
  check('golf zero hours → 2px stub bar', /height="2" rx="3" fill="#4D7C0F"/.test(html));
  check('table: cycling 120 km exact', html.includes('120 km'));
  check('table: no-distance sports show —', /—<\/span>/.test(html));
  check('table: golf zero hours —', (html.match(/>—<\/span>/g) || []).length >= 3);
  check('sessions values above bars (8,3,1)', />8<\/text>/.test(html) && />3<\/text>/.test(html) && />1<\/text>/.test(html));
  check('legend lists every sport', ['Cycling', 'Weightlifting', 'Golf'].every((n) => html.includes(n)));

  // Honest states.
  check('single sport → full circle', /<circle cx="100" cy="100" r="80" fill="#C2410C"/.test(
    buildSportCharts([{ sport: 'running', sessions: 5, km: 40, hours: 4 }], COLORS, false)));
  check('empty breakdown → ""', buildSportCharts([], COLORS, false) === '');
  check('zero-session rows filtered → ""', buildSportCharts([{ sport: 'running', sessions: 0, km: 0, hours: 0 }], COLORS, false) === '');

  // 12 sports: value labels shrink to 11px, legend still lists all 12.
  const twelve = SPORTS.map((s, i) => ({ sport: s.id, sessions: i + 1, km: 0, hours: i * 0.5 }));
  const h12 = buildSportCharts(twelve, COLORS, false);
  check('12 sports → 11px value labels', h12.includes('font-size="11"') && !h12.includes('font-size="13"'));
  check('12 sports → all 12 in legend', SPORTS.every((s) => h12.includes(s.label)));

  // In-slice labels: 12/5/1/1 sessions → 63/27/5/5 (largest remainder).
  // 63% and 27% fit (arc at label radius >= text width), the 5% slices do
  // not; every sport still gets a legend row. Labels are white.
  const h4 = buildSportCharts([
    { sport: 'cycling', sessions: 12, km: 200, hours: 10 },
    { sport: 'weightlifting', sessions: 5, km: 0, hours: 4 },
    { sport: 'pickleball', sessions: 1, km: 0, hours: 1 },
    { sport: 'golf', sessions: 1, km: 0, hours: 0 }
  ], COLORS, false);
  const inSlice = [...h4.matchAll(/fill="#FFFFFF">(\d+)%<\/text>/g)].map((m) => parseInt(m[1], 10));
  check('63/27 in-slice, 5/5 omitted', JSON.stringify(inSlice.sort((a, b) => b - a)) === '[63,27]', JSON.stringify(inSlice));
  check('legend still lists all four', JSON.stringify(legendPcts(h4)) === '[63,27,5,5]', JSON.stringify(legendPcts(h4)));
  check('single sport → centered 100% label', /fill="#FFFFFF">100%<\/text>/.test(
    buildSportCharts([{ sport: 'running', sessions: 5, km: 40, hours: 4 }], COLORS, false)));

  // White in-slice text must clear WCAG AA (4.5) on every registry accent.
  const linC = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lumC = (h) => { const [R, G, B] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).map(linC); return 0.2126 * R + 0.7152 * G + 0.0722 * B; };
  SPORTS.forEach((s) => {
    const c = (1 + 0.05) / (lumC(s.colors.text) + 0.05);
    check('white on ' + s.id + ' slice >= 4.5', c >= 4.5, c.toFixed(2));
  });

  // Narrow flag: single column + slimmer 30px bar slots + legend BELOW a
  // column-filling pie. Desktop keeps the legend BESIDE a fixed 300px pie,
  // sized to its content (no align-self:stretch).
  const hn = buildSportCharts(twelve, COLORS, true);
  check('narrow → single-column grid', hn.includes('grid-template-columns:1fr>') || hn.includes('grid-template-columns:1fr"'));
  check('narrow → 30px bar slots', hn.includes('width="30"') && !hn.includes('width="40"'));
  check('narrow → legend below column-filling pie', hn.includes('flex-direction:column;align-items:center;gap:12px') && hn.includes('max-width:300px'));
  check('desktop → legend beside fixed 300px pie, content-sized', html.includes('width:300px;height:300px') && !html.includes('align-self:stretch'));

  // Rendered-color ΔE floor on the actual 12-sport output.
  const used = [...new Set(fills(h12))].filter((f) => f !== '#374151' && f !== '#FFFFFF'); // label ink isn't a sport channel
  check('all registry sport colors rendered distinctly', used.length === SPORTS.length, String(used.length));
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lab = (hex) => {
    const [R, G, B] = rgb(hex).map(lin);
    const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
    const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const [fx, fy, fz] = [X, Y, Z].map(f);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  };
  let min = Infinity, pair = '';
  for (let i = 0; i < used.length; i++) for (let j = i + 1; j < used.length; j++) {
    const A = lab(used[i]), B = lab(used[j]);
    const d = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
    if (d < min) { min = d; pair = used[i] + '/' + used[j]; }
  }
  check('rendered pairwise ΔE >= 20', min >= 20, min.toFixed(1) + ' (' + pair + ')');
}

// ── E2E ──
const EMAIL = 'vsc-user@arenas-test.dev';
const PW = 'ArenasTest!234';
async function e2e() {
  console.log('— e2e (live page vs /api/profile/stats) —');
  // All seeding happens INSIDE the try so the finally cleanup always runs —
  // a mid-seed or login failure must not orphan the fixed-email account.
  let uid = null;
  let browser = null;
  try {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of (data && data.users) || []) if (u.email === EMAIL) {
    await admin.from('activities').delete().eq('user_id', u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
  const { data: created, error: mkErr } = await admin.auth.admin.createUser({
    email: EMAIL, password: PW, email_confirm: true,
    user_metadata: { name: 'Vsc Charts', handle: 'vsc_charts' }
  });
  check('create user', !mkErr, mkErr && mkErr.message);
  if (mkErr) throw new Error('createUser failed');
  uid = created.user.id;

  const today = new Date();
  const day = (back) => new Date(today.getTime() - back * 86400000).toISOString().slice(0, 10) + 'T12:00:00Z';
  const seed = [];
  // running 4×45min w/ 8km, cycling 2×90min w/ 30km, golf 1 with NO duration.
  for (let i = 0; i < 4; i++) seed.push({ user_id: uid, sport: 'running', title: 'Run ' + i, date: day(i), duration: '00:45', distance: '8 km' });
  for (let i = 0; i < 2; i++) seed.push({ user_id: uid, sport: 'cycling', title: 'Ride ' + i, date: day(i + 4), duration: '01:30', distance: '30 km' });
  seed.push({ user_id: uid, sport: 'golf', title: 'Round', date: day(6), duration: null, distance: null });
  const { error: iErr } = await admin.from('activities').insert(seed);
  check('insert activities', !iErr, iErr && iErr.message);
  if (iErr) throw new Error('insert failed');

  const r = await fetch(BASE_URL + '/auth/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(EMAIL)}&password=${encodeURIComponent(PW)}`
  });
  const setC = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  const rawCookies = (setC || []).filter(Boolean).map((c) => c.split(';')[0]);
  check('login', r.status === 302 && rawCookies.length > 0);
  const cookieHeader = rawCookies.join('; ');

  const api = await (await fetch(BASE_URL + '/api/profile/stats?period=all', { headers: { Cookie: cookieHeader } })).json();
  const bd = api.sportBreakdown || [];
  check('api breakdown has 3 sports', bd.length === 3, JSON.stringify(bd.map((s) => s.sport)));
  const bySport = {};
  bd.forEach((s) => { bySport[s.sport] = s; });
  check('api golf has sessions but 0 hours', bySport.golf && bySport.golf.sessions === 1 && bySport.golf.hours === 0,
    JSON.stringify(bySport.golf));

  const DOMAIN = process.env.REPLIT_DEV_DOMAIN;
  const cookies = rawCookies.map((pair) => {
    const i = pair.indexOf('=');
    return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: DOMAIN, path: '/' };
  });
  browser = await launchBrowser();
    // 561/481 bracket the card's 560px stack threshold: the desktop pie row
    // (300px pie + 24 gap + nowrap legend) needs ~470px, so 481–560 must use
    // the stacked narrow layout or it clips (architect finding, Aug 2026).
    for (const width of [1280, 561, 481, 414, 380, 360]) {
      const context = await browser.newContext({ viewport: { width, height: 1400 } });
      await context.addCookies(cookies);
      const page = await context.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`https://${DOMAIN}/html/profile#stats`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#sp-stats-body svg[role="img"]', { timeout: 15000 });
      await page.waitForTimeout(800);

      const got = await page.evaluate(() => {
        const svgs = [...document.querySelectorAll('#sp-stats-body svg[role="img"]')];
        // Select charts by aria-label, not DOM order — the pie panel moved
        // to the top of the card (pie → Sessions → Time).
        const byLabel = (frag) => svgs.find((s) => (s.getAttribute('aria-label') || '').includes(frag)) || null;
        const sessionsSvg = byLabel('Sessions per sport');
        const timeSvg = byLabel('Hours per sport');
        const pieSvg = byLabel('Share of sessions');
        const fillsOf = (svg) => [...svg.querySelectorAll('[fill]')].map((el) => el.getAttribute('fill').toUpperCase()).filter((f) => f.startsWith('#') && f !== '#374151' && f !== '#FFFFFF');
        const texts = (svg) => [...svg.querySelectorAll('text')].map((t) => t.textContent.trim());
        // Anchor card/grid lookups on the PIE svg, not svgs[0]: the weekly
        // stack chart is also svg[role="img"] inside #sp-stats-body, and
        // closest() from it finds the outer stats layout grid, not the
        // By-sport charts grid.
        const card = pieSvg && pieSvg.closest('div[style*="border-radius"]');
        const grid = pieSvg && pieSvg.closest('div[style*="grid-template-columns"]');
        return {
          svgCount: svgs.length,
          sessionsLabels: sessionsSvg ? texts(sessionsSvg) : [],
          timeLabels: timeSvg ? texts(timeSvg) : [],
          pieFills: pieSvg ? fillsOf(pieSvg) : [],
          pieTexts: pieSvg ? texts(pieSvg) : [],
          sessionsFills: sessionsSvg ? fillsOf(sessionsSvg) : [],
          timeFills: timeSvg ? fillsOf(timeSvg) : [],
          gridCols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
          legendPctSum: [...document.querySelectorAll('#sp-stats-body span')]
            .map((el) => el.textContent.trim()).filter((t) => /^\d+%$/.test(t))
            .reduce((a, t) => a + parseInt(t, 10), 0),
          cardText: card ? card.textContent : '',
          // Visible spill only: an element's rect escaping the card's rect.
          // scrollWidth > clientWidth alone is NOT a failure — ellipsized
          // legend/table name spans overflow-hide by design.
          cardOverflowX: card ? (() => {
            const cr = card.getBoundingClientRect();
            let worst = 0;
            card.querySelectorAll('*').forEach((el) => {
              const b = el.getBoundingClientRect();
              if (b.width > 0) worst = Math.max(worst, b.right - cr.right, cr.left - b.left);
            });
            return Math.round(worst);
          })() : -1,
          docOverflowX: document.documentElement.scrollWidth - window.innerWidth
        };
      });
      const w = 'w' + width;
      check(w + ': three chart SVGs', got.svgCount === 3, String(got.svgCount));
      check(w + ': zero console errors', errors.length === 0, errors.slice(0, 2).join(' | '));
      // Values match the API exactly.
      const sess = bd.map((s) => String(s.sessions));
      check(w + ': sessions labels match api', sess.every((v) => got.sessionsLabels.includes(v)), JSON.stringify(got.sessionsLabels));
      const timeLbls = bd.map((s) => (s.hours > 0 ? s.hours + 'h' : '—'));
      check(w + ': time labels match api (incl golf —)', timeLbls.every((v) => got.timeLabels.includes(v)), JSON.stringify(got.timeLabels));
      const kmStr = bd.filter((s) => s.km > 0).map((s) => s.km + ' km');
      check(w + ': table km figures match api', kmStr.every((v) => got.cardText.includes(v)), JSON.stringify(kmStr));
      // In-slice rule live: 57/29/14 all clear the fit threshold → three
      // white in-slice labels matching the legend percentages.
      const inSliceLive = (got.pieTexts || []).filter((t) => /^\d+%$/.test(t)).length;
      check(w + ': in-slice labels where they fit (3 of 3 here)', inSliceLive === 3, String(inSliceLive));
      check(w + ': legend percentages sum to 100', got.legendPctSum === 100, String(got.legendPctSum));
      // Color consistency: per-sport fill identical across all three SVGs and
      // equal to the registry hex.
      for (const s of bd) {
        const hex = HEX[s.sport].toUpperCase();
        const inAll = got.sessionsFills.includes(hex) && got.timeFills.includes(hex) && got.pieFills.includes(hex);
        check(w + ': ' + s.sport + ' ' + hex + ' consistent across all three SVGs', inAll,
          JSON.stringify({ s: got.sessionsFills, t: got.timeFills, p: got.pieFills }));
      }
      // Layout: >768px (desktop shell) = pie full-width on top + 2-column
      // bar row below. <=768px the mobile-shell CSS collapses inline
      // "1fr 1fr" grids to one column (arenas.css bottom-nav block), and
      // <=560px the builder itself renders the stacked narrow variant — so
      // everything at or below 768 is a single column.
      check(w + ': ' + (width > 768 ? '2-column bar row under full-width pie' : 'stacked single column'),
        width > 768 ? got.gridCols === 2 : got.gridCols === 1, String(got.gridCols));
      // No horizontal clipping anywhere in the card, and no page scroll.
      check(w + ': card has no horizontal overflow', got.cardOverflowX <= 2, String(got.cardOverflowX));
      check(w + ': no page-level horizontal scroll', got.docOverflowX <= 0, String(got.docOverflowX));
      await context.close();
    }
  } catch (e) {
    check('e2e completed', false, e.message);
  } finally {
    if (browser) await browser.close();
    if (uid) {
      const { error: dErr } = await admin.from('activities').delete().eq('user_id', uid);
      check('cleanup activities', !dErr, dErr && dErr.message);
      const { error: uErr } = await admin.auth.admin.deleteUser(uid);
      check('cleanup user', !uErr, uErr && uErr.message);
    }
  }
}

fixedCases();
await e2e();
console.log(failures ? failures + ' FAILURE(S)' : 'ALL PASS');
process.exit(failures ? 1 : 0);
