// Verifies the Stats & PRs "Weekly activity" stacked columns + tab reorder:
// 1. Loads the shared builder (html/arenas-stack.js) in Node: segment heights
//    sum to 100% of each column, registry colors per sport, native title
//    tooltips ("Sport · Xh"), zero-week baseline tick, legend lists exactly
//    the sports present in the visible range (hours desc), tiny segments keep
//    their true proportion (no minimum-height inflation).
// 2. Static checks on arenas-my-profile.html: card order is By sport →
//    Personal records → Weekly activity; the 6/12/24 pills and the
//    localStorage weeks preference are untouched.
// 3. E2E: seeds a user with hours spread across sports and weeks, then
//    asserts /api/profile/stats weeklyChart bySport sums EXACTLY to the
//    labeled weekly total (largest-remainder tenths), across weeks=6/12/24,
//    with zero weeks reported honestly. Cleans up afterwards.
//
// Run with the dev server up: node artifacts/html-arenas/scripts/verify-stack.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.join(__dirname, '..');
const BASE_URL = 'http://localhost:80/html';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'html', 'arenas-stack.js'), 'utf8'), sandbox);
const buildWeeklyStack = sandbox.window.buildWeeklyStack;

const SPORTS = require(path.join(ROOT, 'sports.js')).SPORTS;
const COLORS = {};
SPORTS.forEach((s) => { COLORS[s.id] = { bar: s.colors.text, icon: s.emoji, name: s.label }; });

function fixedCases() {
  console.log('— fixed builder cases —');
  const weekly = [
    { label: '1Jun', hours: 6.0, bySport: [{ sport: 'running', hours: 4.0 }, { sport: 'cycling', hours: 1.9 }, { sport: 'golf', hours: 0.1 }] },
    { label: '8Jun', hours: 0, bySport: [] },
    { label: '15Jun', hours: 2.5, bySport: [{ sport: 'cycling', hours: 2.5 }] }
  ];
  const html = buildWeeklyStack(weekly, COLORS, 6, false);

  // Every stacked column's flex-basis percentages sum to 100.
  const stacks = html.split('flex-direction:column">').slice(1);
  const sums = [];
  stacks.forEach((s) => {
    const segs = [...s.matchAll(/flex:0 0 ([\d.]+)%/g)].map((m) => parseFloat(m[1]));
    if (segs.length) sums.push(segs.reduce((a, b) => a + b, 0));
  });
  check('segment percentages sum to 100 per column', sums.length === 2 && sums.every((x) => Math.abs(x - 100) < 0.01), JSON.stringify(sums));

  // Tiny segment keeps its true share (0.1/6.0 = 1.667%) — no inflation.
  check('tiny 0.1h segment renders at true 1.667%', html.includes('flex:0 0 1.667%'));

  // Registry colors + tooltips.
  check('running segment uses #9A3412 with tooltip', html.includes('title="Running · 4h"') && html.includes('background:#9A3412'));
  check('cycling segment uses #1E40AF with tooltip', html.includes('title="Cycling · 1.9h"') && html.includes('background:#1E40AF'));

  // Total label unchanged (labels the whole stack), zero week honest.
  check('total-hours label present (6h)', html.includes('>6h</div>'));
  check('zero week keeps flat baseline tick', html.includes('height:3px;border-radius:1px;background:var(--gray-200)'));

  // Legend: exactly the present sports, hours desc (run 4.0 > cyc 4.4? no —
  // cycling 1.9+2.5=4.4 > running 4.0 > golf 0.1).
  const legendPart = html.split('border-top:var(--border)')[1] || '';
  const order = [...legendPart.matchAll(/(Running|Cycling|Golf|Yoga)/g)].map((m) => m[1]);
  check('legend lists exactly present sports by hours desc', JSON.stringify(order) === '["Cycling","Running","Golf"]', JSON.stringify(order));
  check('legend omits absent sports', !legendPart.includes('Yoga'));

  // All-zero range → no legend at all.
  const empty = buildWeeklyStack([{ label: '1Jun', hours: 0, bySport: [] }], COLORS, 6, false);
  check('all-zero range renders no legend', !empty.includes('border-top:var(--border)'));
}

function staticOrderChecks() {
  console.log('— static page checks —');
  const page = fs.readFileSync(path.join(ROOT, 'html', 'arenas-my-profile.html'), 'utf8');
  const iSport = page.indexOf('🏅 By sport');
  const iPrs = page.indexOf('🏆 Personal records');
  const iWeekly = page.indexOf('📊 Weekly activity');
  check('card order: By sport → Personal records → Weekly activity',
    iSport > -1 && iPrs > iSport && iWeekly > iPrs,
    JSON.stringify({ iSport, iPrs, iWeekly }));
  check('weeks localStorage preference untouched', page.includes('arenas_stats_weeks'));
  check('range pills intact (weekPill 6/12/24)', page.includes('weekPill(6) + weekPill(12) + weekPill(24)'));
}

async function e2e() {
  console.log('— e2e: seeded hours across sports and weeks —');
  const email = 'stack-check@arenas-test.dev';
  const password = 'Stackcheck!12345';
  const { data: existing } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of (existing && existing.users) || []) {
    if (u.email === email) {
      await admin.from('activities').delete().eq('user_id', u.id);
      await admin.auth.admin.deleteUser(u.id);
    }
  }
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { name: 'Stack Check', handle: 'stackcheck' }
  });
  if (cErr) { check('create seeded user', false, cErr.message); return; }
  const uid = created.user.id;

  try {
    const now = Date.now();
    const daysAgo = (n) => new Date(now - n * 86400000).toISOString();
    // This week-ish: running 2h + cycling 1.5h. ~2 weeks back: yoga 45min +
    // golf 1h. ~5 weeks back: cycling 30min. Durations use H:MM:SS / MM:SS.
    const seed = [
      { sport: 'running', title: 'R1', date: daysAgo(0), duration: '1:00:00' },
      { sport: 'running', title: 'R2', date: daysAgo(0), duration: '1:00:00' },
      { sport: 'cycling', title: 'C1', date: daysAgo(0), duration: '1:30:00' },
      { sport: 'yoga', title: 'Y1', date: daysAgo(14), duration: '45:00' },
      { sport: 'golf', title: 'G1', date: daysAgo(14), duration: '1:00:00' },
      { sport: 'cycling', title: 'C2', date: daysAgo(35), duration: '30:00' }
    ].map((a) => ({ ...a, user_id: uid }));
    const { error: iErr } = await admin.from('activities').insert(seed);
    check('insert seeded activities', !iErr, iErr && iErr.message);

    const loginRes = await fetch(BASE_URL + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }), redirect: 'manual'
    });
    const cookie = (loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [])
      .map((c) => c.split(';')[0]).join('; ');
    check('login sets session cookies', cookie.includes('sb_access_token'));

    for (const weeks of [6, 12, 24]) {
      const r = await fetch(BASE_URL + '/api/profile/stats?period=all&weeks=' + weeks, { headers: { Cookie: cookie } });
      const stats = await r.json();
      const wc = stats.weeklyChart;
      check('weeks=' + weeks + ' returns ' + weeks + ' buckets', wc.length === weeks, String(wc.length));
      // THE core assertion: per week, segment hours sum EXACTLY to the
      // labeled total (tenths math, no float fuzz allowed).
      const bad = wc.filter((w) => {
        const segSum = Math.round((w.bySport || []).reduce((s, x) => s + x.hours, 0) * 10);
        return segSum !== Math.round(w.hours * 10);
      });
      check('weeks=' + weeks + ': every stack sums to its labeled total', bad.length === 0, JSON.stringify(bad));
      const zeroOk = wc.filter((w) => w.hours === 0).every((w) => (w.bySport || []).length === 0);
      check('weeks=' + weeks + ': zero weeks have empty bySport', zeroOk);
    }

    const r12 = await fetch(BASE_URL + '/api/profile/stats?period=all&weeks=12', { headers: { Cookie: cookie } });
    const wc12 = (await r12.json()).weeklyChart;
    const nonZero = wc12.filter((w) => w.hours > 0);
    check('hours spread across multiple weeks', nonZero.length >= 3, String(nonZero.length));
    const thisWeek = wc12[wc12.length - 1];
    const mix = (thisWeek.bySport || []).map((s) => s.sport + ':' + s.hours).join(',');
    check('current week = running:2 + cycling:1.5 (3.5h total)',
      thisWeek.hours === 3.5 && mix === 'running:2,cycling:1.5', thisWeek.hours + ' / ' + mix);
    const presentSports = new Set();
    wc12.forEach((w) => (w.bySport || []).forEach((s) => presentSports.add(s.sport)));
    check('present sports across range = run/cyc/yoga/golf',
      JSON.stringify([...presentSports].sort()) === '["cycling","golf","running","yoga"]',
      JSON.stringify([...presentSports].sort()));
  } finally {
    await admin.from('activities').delete().eq('user_id', uid);
    await admin.auth.admin.deleteUser(uid);
    console.log('      seeded user cleaned up');
  }
}

(async () => {
  fixedCases();
  staticOrderChecks();
  await e2e();
  console.log(failures === 0 ? '\nAll checks passed.' : '\n' + failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('Script error:', e); process.exit(1); });
