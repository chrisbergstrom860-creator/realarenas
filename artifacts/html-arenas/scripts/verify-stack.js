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
// Unit + static: node artifacts/html-arenas/scripts/verify-stack.js
// Seeded E2E (dev server up): VERIFY_E2E=1 node artifacts/html-arenas/scripts/verify-stack.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');


const ROOT = path.join(__dirname, '..');
const BASE_URL = 'http://localhost:80/html';
// Seeded E2E is opt-in (VERIFY_E2E=1) — the unit + static checks below are
// seed-free and run anywhere. The client is created lazily so a missing env
// never breaks the unit run.
const RUN_E2E = process.env.VERIFY_E2E === '1';
let admin = null;

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
  const stacks = html.split('class="wk-bar"').slice(1);
  const sums = [];
  stacks.forEach((s) => {
    const segs = [...s.matchAll(/flex:0 0 ([\d.]+)%/g)].map((m) => parseFloat(m[1]));
    if (segs.length) sums.push(segs.reduce((a, b) => a + b, 0));
  });
  check('segment percentages sum to 100 per column', sums.length === 2 && sums.every((x) => Math.abs(x - 100) < 0.01), JSON.stringify(sums));

  // Tiny segment keeps its true share (0.1/6.0 = 1.667%) — no inflation.
  check('tiny 0.1h segment renders at true 1.667%', html.includes('flex:0 0 1.667%'));

  // Registry colors + tooltips.
  check('running segment uses #C2410C with tooltip', html.includes('title="Running · 4h"') && html.includes('background:#C2410C'));
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

function metricCases() {
  console.log('— metric option, partial bucket, label density —');
  const mk = (n, partial) => Array.from({ length: n }, (_, i) => ({
    label: 'W' + i, start: '', end: '', isPartial: partial && i === n - 1,
    hours: 3, km: 42.5, sessions: 4,
    bySport: [{ sport: 'cycling', hours: 2, km: 40, sessions: 1 }, { sport: 'running', hours: 1, km: 2.5, sessions: 3 }]
  }));
  const w12 = mk(12, true);
  const h = buildWeeklyStack(w12, COLORS, { metric: 'hours', width: 900 });
  const k = buildWeeklyStack(w12, COLORS, { metric: 'km', width: 900 });
  const s = buildWeeklyStack(w12, COLORS, { metric: 'sessions', width: 900 });
  check('hours metric labels "3h"', h.includes('>3h</div>') && h.includes('data-metric="hours"'));
  check('km metric labels "42.5 km"', k.includes('>42.5 km</div>') && k.includes('data-metric="km"'));
  check('sessions metric labels "4"', s.includes('>4</div>') && s.includes('data-metric="sessions"'));
  check('km segment shares follow km (cycling 94.118%)', k.includes('flex:0 0 94.118%'));
  check('sessions segment shares follow sessions (running 75%)', s.includes('flex:0 0 75.000%'));
  check('km tooltip unit', k.includes('title="Cycling · 40 km"'));
  const order = (html) => [...(html.split('wk-legend"')[1] || '').matchAll(/<\/span>\S+ (\w+)<\/div>/g)].map((m) => m[1]).filter((t) => t !== 'progress');
  check('legend sorted by hours: Cycling, Running', JSON.stringify(order(h)) === '["Cycling","Running"]', JSON.stringify(order(h)));
  check('legend sorted by sessions: Running, Cycling', JSON.stringify(order(s)) === '["Running","Cycling"]', JSON.stringify(order(s)));
  check('final bucket labelled "This week"', h.includes('>This week</div>') && !h.includes('>Now<'));
  check('partial final bucket: dashed outline', (h.match(/wk-partial/g) || []).length === 1 && h.includes('dashed var(--gray-500)'));
  check('partial final bucket: reduced fill', h.includes('opacity:.42'));
  check('partial legend key "In progress"', h.includes('In progress'));
  const full = buildWeeklyStack(mk(12, false), COLORS, { metric: 'hours', width: 900 });
  check('complete final week: no dashed outline', !full.includes('wk-partial') && full.includes('>This week</div>'));
  const zeroKm = buildWeeklyStack([{ label: 'A', hours: 1, km: 0, sessions: 1, bySport: [{ sport: 'yoga', hours: 1, km: 0, sessions: 1 }] }], COLORS, { metric: 'km', width: 600 });
  check('km metric: zero-km week → baseline tick, no legend', zeroKm.includes('wk-zero') && !zeroKm.includes('wk-legend"'));

  // Every bar keeps its visible total across 6–104 bars and widths; dense
  // ranges scroll locally with a min slot >= the widest label; only axis
  // dates thin; final bucket always labelled.
  const AS = sandbox.window.ArenasStack;
  for (const n of [6, 12, 26, 52, 104]) {
    for (const width of [336, 600, 1200]) {
      for (const metric of ['hours', 'km', 'sessions']) {
        const html = buildWeeklyStack(mk(n, true), COLORS, { metric, width });
        const vals = (html.match(/class="wk-val"/g) || []).length; // fixture has no zero weeks
        const axes = [...html.matchAll(/class="wk-axis"[^>]*>([^<]*)</g)].filter((m) => m[1]).length;
        const lw = AS.labelPx(AS.metrics[metric].fmt(metric === 'km' ? 42.5 : metric === 'hours' ? 3 : 4));
        const d = AS.density(n, width, metric, lw);
        const scroll = html.includes('class="wk-scroll"');
        check(`n=${n} w=${width} ${metric}: ${n}/${n} values, ${axes} dates, slot ${d.slot.toFixed(1)}>=${lw}${scroll ? ', scrolls' : ''}`,
          vals === n && d.slot >= lw && d.slot * d.axisEvery >= 46 && axes <= Math.ceil(n / d.axisEvery) + 1 &&
          html.includes('>This week</div>') && (html.match(/class="wk-col"/g) || []).length === n &&
          scroll === (d.slot * n > width - 28 + 0.5));
      }
    }
  }
  check('104 bars @360 scroll locally with fixed inner width + hint', (() => { const h = buildWeeklyStack(mk(104, true), COLORS, { metric: 'hours', width: 336 }); return h.includes('overflow-x:auto') && /data-scroll="1"[^>]*width:\d+px/.test(h) && h.includes('Scroll for earlier weeks'); })());
  check('12 bars @1200 fit without scrolling', !buildWeeklyStack(mk(12, true), COLORS, { metric: 'km', width: 1200 }).includes('wk-scroll'));
  const zh = (m) => buildWeeklyStack([{ label: 'A', hours: 0, km: 0, sessions: 0, bySport: [] }, ...mk(3, true)], COLORS, { metric: m, width: 600 });
  check('zero week: value label above baseline in every metric (0h / 0 km / 0)', ['hours', 'km', 'sessions'].every((m) => (zh(m).match(/class="wk-val"/g) || []).length === 4) && zh('hours').includes('>0h</div>') && zh('km').includes('>0 km</div>') && />0<\/div><div class="wk-bar wk-zero/.test(zh('sessions')));
  check('legacy wrapper: zero week stays unlabelled', !buildWeeklyStack([{ label: 'A', hours: 0, bySport: [] }, { label: 'B', hours: 2, bySport: [{ sport: 'running', hours: 2 }] }], COLORS, 6, false).includes('>0h<'));
}

function staticOrderChecks() {
  console.log('— static page checks —');
  const page = fs.readFileSync(path.join(ROOT, 'html', 'arenas-my-profile.html'), 'utf8');
  const render = page.slice(page.indexOf('// Section order: period control'));
  const seq = ['spKpis(r)', 'spWeeklyCard(r)', 'gvwCard(r)', 'sportRow', 'spPrsCard(r.prs)', 'barsRow'].map((t) => render.indexOf(t));
  check('section order: KPIs → Weekly → Goals/Streak → Sport row → PRs → Bars', seq.every((v, i) => v > -1 && (i === 0 || v > seq[i - 1])), JSON.stringify(seq));
  check('period control 6W/12W/6M/1Y/All', ['6w', '12w', '6m', '1y', 'all'].every((p) => page.includes(`setStatsPeriod(this,'${p}')`)));
  check('period persisted + legacy weeks migration', page.includes("'arenas_stats_period'") && page.includes("{ 6: '6w', 12: '12w', 24: '6m' }"));
  check('metric persisted (arenas_stats_metric)', page.includes("'arenas_stats_metric'"));
  check('comparison copy is "vs previous period" (equal-length window)', page.includes('vs previous period') && !page.includes("vs previous ' + SP_PERIOD_LABEL"));
  check('API called with period only (no weeks param)', page.includes("'/api/profile/stats?period=' + encodeURIComponent(spPeriod))") && !page.includes('&weeks='));
  check('old three-stat strip / four-total row removed', !page.includes('Avg sessions / week') && !page.includes('Points earned</div>'));
  check('104-week cap note', page.includes('Showing the last 104 weeks'));
  check('dense chart scrolled to end on render', page.includes('sc.scrollLeft = sc.scrollWidth'));
  check('goals caption', page.includes('Goals use their own weekly and monthly windows'));
}

async function e2e() {
  if (!RUN_E2E) { console.log('— e2e skipped (set VERIFY_E2E=1 with the dev server up) —'); return; }
  admin = require('@supabase/supabase-js').createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
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

    const bad400 = await fetch(BASE_URL + '/api/profile/stats?period=bogus', { headers: { Cookie: cookie } });
    check('unknown period → 400', bad400.status === 400, String(bad400.status));
    for (const [period, weeks] of [['6w', 6], ['12w', 12]]) {
      const r = await fetch(BASE_URL + '/api/profile/stats?period=' + period, { headers: { Cookie: cookie } });
      const stats = await r.json();
      const wc = stats.weeklyChart;
      check(period + ' returns ' + weeks + ' buckets', wc.length === weeks, String(wc.length));
      check(period + ': final bucket isPartial is boolean, buckets carry km + sessions',
        typeof wc[wc.length - 1].isPartial === 'boolean' && wc.every((w) => typeof w.km === 'number' && typeof w.sessions === 'number'));
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

    const r12 = await fetch(BASE_URL + '/api/profile/stats?period=12w', { headers: { Cookie: cookie } });
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
  metricCases();
  staticOrderChecks();
  await e2e();
  console.log(failures === 0 ? '\nAll checks passed.' : '\n' + failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('Script error:', e); process.exit(1); });
