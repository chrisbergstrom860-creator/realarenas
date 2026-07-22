// Verifies the "By sport" pie on Stats & PRs:
// 1. Loads the shared builder (html/arenas-pie.js) in Node and asserts the
//    printed percentages use largest-remainder rounding (sum to exactly 100),
//    match hand-computed session shares, use the registry color per sport,
//    and honor the label treatment (inline >= 10%, legend below that).
// 2. Honest states: single sport = full circle, empty breakdown = ''.
// 3. E2E scope switch: seeds a multi-sport user with activities in and out of
//    the current month, then asserts /api/profile/stats month vs all return
//    different session mixes and each mix produces the expected percentages.
//    Cleans the seeded user up afterwards.
//
// Run with the dev server up: node artifacts/html-arenas/scripts/verify-pie.js

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

// Load the real builder in a sandbox.
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'html', 'arenas-pie.js'), 'utf8'), sandbox);
const buildSportPie = sandbox.window.buildSportPie;

// Registry colors (same derivation as the page: colors.text is the slice/bar hex).
const SPORTS = require(path.join(ROOT, 'sports.js')).SPORTS;
const COLORS = {};
SPORTS.forEach((s) => { COLORS[s.id] = { bar: s.colors.text, icon: s.emoji, name: s.label }; });

// Pull every printed percentage out of the generated markup.
function printedPcts(html) {
  const out = [];
  const re = /(\d+)%/g;
  let m;
  while ((m = re.exec(html))) out.push(parseInt(m[1], 10));
  return out;
}

function fixedCases() {
  console.log('— fixed cases (real builder, hand-computed shares) —');

  // Real-account shape: 8 cycling / 3 weightlifting / 1 golf.
  // Exact: 66.667 / 25 / 8.333 → floors 66+25+8=99 → leftover point goes to
  // the largest remainder (.667, cycling) → 67 / 25 / 8.
  let html = buildSportPie([
    { sport: 'cycling', sessions: 8 },
    { sport: 'weightlifting', sessions: 3 },
    { sport: 'golf', sessions: 1 }
  ], COLORS, false);
  let pcts = printedPcts(html);
  check('8/3/1 → 67/25/8', JSON.stringify(pcts) === '[67,25,8]', JSON.stringify(pcts));
  check('8/3/1 sums to 100', pcts.reduce((a, b) => a + b, 0) === 100);
  check('cycling slice uses registry color #1E40AF', html.includes('fill="#1E40AF"'));
  check('weightlifting slice uses registry color #854D0E', html.includes('fill="#854D0E"'));
  check('golf slice uses registry color #3F6212', html.includes('fill="#3F6212"'));
  check('67% and 25% labeled inline (svg text)', /<text[^>]*>🚴 67%/.test(html) && /<text[^>]*>🏋️ 25%/.test(html));
  check('8% slice inline on desktop (>= 7% threshold at 300px)', /<text[^>]*>⛳ 8%/.test(html) && !html.includes('⛳ Golf · 8%'));
  check('desktop pie renders at 300px', html.includes('width:300px'));

  // Narrow: smaller render keeps the historic 10% threshold → 8% → legend.
  html = buildSportPie([
    { sport: 'cycling', sessions: 8 },
    { sport: 'weightlifting', sessions: 3 },
    { sport: 'golf', sessions: 1 }
  ], COLORS, true);
  check('8% slice pushed to legend on narrow (10% threshold)', !/<text[^>]*>⛳/.test(html) && html.includes('⛳ Golf · 8%'));
  check('narrow pie capped at 180px', html.includes('width:180px'));

  // Desktop threshold boundary: 7% inline, 6% legend.
  html = buildSportPie([{ sport: 'running', sessions: 13 }, { sport: 'golf', sessions: 1 }], COLORS, false);
  check('7% slice inline on desktop (93/7)', /<text[^>]*>⛳ 7%/.test(html));
  html = buildSportPie([{ sport: 'running', sessions: 15 }, { sport: 'golf', sessions: 1 }], COLORS, false);
  check('6% slice still legend on desktop (94/6)', !/<text[^>]*>⛳/.test(html) && html.includes('⛳ Golf · 6%'));

  // A 1/3-each split: 33.33×3 → floors 99 → one +1 → 34/33/33.
  html = buildSportPie([
    { sport: 'running', sessions: 2 },
    { sport: 'yoga', sessions: 2 },
    { sport: 'golf', sessions: 2 }
  ], COLORS, false);
  pcts = printedPcts(html);
  check('2/2/2 → sums to exactly 100 (34/33/33)', pcts.reduce((a, b) => a + b, 0) === 100 && pcts.filter((p) => p === 33).length === 2 && pcts.includes(34), JSON.stringify(pcts));

  // Single sport = full circle, never an arc path.
  html = buildSportPie([{ sport: 'running', sessions: 5 }], COLORS, false);
  check('single sport renders <circle> not <path>', html.includes('<circle') && !html.includes('<path'));
  check('single sport labeled 100%', printedPcts(html)[0] === 100);

  // Empty breakdown → '' (the card owns the empty state).
  check('empty breakdown → empty string', buildSportPie([], COLORS, false) === '');
  check('zero-session rows filtered → empty string', buildSportPie([{ sport: 'running', sessions: 0 }], COLORS, false) === '');

  // Narrow variant stacks (border-top, not border-left).
  html = buildSportPie([{ sport: 'cycling', sessions: 8 }, { sport: 'golf', sessions: 1 }], COLORS, true);
  check('narrow uses border-top (stacked below bars)', html.includes('border-top:var(--border)') && !html.includes('border-left'));
}

async function e2eScopeSwitch() {
  console.log('— e2e: seeded multi-sport user, month vs all scope —');
  const email = 'pie-scope-check@arenas-test.dev';
  const password = 'Piecheck!12345';
  const { data: existing } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of (existing && existing.users) || []) {
    if (u.email === email) {
      await admin.from('activities').delete().eq('user_id', u.id);
      await admin.auth.admin.deleteUser(u.id);
    }
  }
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { name: 'Pie Scope Check', handle: 'piecheck' }
  });
  if (cErr) { check('create seeded user', false, cErr.message); return; }
  const uid = created.user.id;

  try {
    const now = new Date();
    const lastYear = new Date(now.getFullYear() - 1, 5, 15).toISOString();
    const seed = [
      { sport: 'running', title: 'R1', date: now.toISOString() },
      { sport: 'running', title: 'R2', date: now.toISOString() },
      { sport: 'running', title: 'R3', date: now.toISOString() },
      { sport: 'cycling', title: 'C1', date: now.toISOString(), distance: '10 km' },
      { sport: 'yoga', title: 'Y1', date: lastYear },
      { sport: 'yoga', title: 'Y2', date: lastYear }
    ].map((a) => ({ ...a, user_id: uid, duration: '30:00' }));
    const { error: iErr } = await admin.from('activities').insert(seed);
    check('insert seeded activities', !iErr, iErr && iErr.message);

    const loginRes = await fetch(BASE_URL + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }), redirect: 'manual'
    });
    const cookie = (loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [])
      .map((c) => c.split(';')[0]).join('; ');
    check('login sets session cookies', cookie.includes('sb_access_token'));

    const stats = async (period) => {
      const r = await fetch(BASE_URL + '/api/profile/stats?period=' + period, { headers: { Cookie: cookie } });
      return r.json();
    };

    // Month scope: 3 run + 1 cyc → 75 / 25.
    const month = await stats('month');
    const monthMix = month.sportBreakdown.map((s) => s.sport + ':' + s.sessions).join(',');
    check('month scope mix = running:3,cycling:1', monthMix === 'running:3,cycling:1', monthMix);
    let pcts = printedPcts(buildSportPie(month.sportBreakdown, COLORS, false));
    check('month pie → 75/25', JSON.stringify(pcts) === '[75,25]', JSON.stringify(pcts));

    // All scope: 3 run + 1 cyc + 2 yoga → exact 50 / 16.667 / 33.333 → LR 50/17/33.
    const all = await stats('all');
    const allMix = all.sportBreakdown.map((s) => s.sport + ':' + s.sessions).sort().join(',');
    check('all scope mix = cycling:1,running:3,yoga:2', allMix === 'cycling:1,running:3,yoga:2', allMix);
    pcts = printedPcts(buildSportPie(all.sportBreakdown, COLORS, false)).sort((a, b) => b - a);
    check('all pie → 50/33/17 (sums 100)', JSON.stringify(pcts) === '[50,33,17]', JSON.stringify(pcts));
    check('scope switch changes the mix (month ≠ all)', monthMix !== allMix);
  } finally {
    await admin.from('activities').delete().eq('user_id', uid);
    await admin.auth.admin.deleteUser(uid);
    console.log('      seeded user cleaned up');
  }
}

(async () => {
  fixedCases();
  await e2eScopeSwitch();
  console.log(failures === 0 ? '\nAll checks passed.' : '\n' + failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('Script error:', e); process.exit(1); });
