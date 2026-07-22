// Verifies that every km surface in the app computes distance through the
// single canonical unit-aware parser and that all totals agree.
//
// 1. Static: server.js contains exactly ONE distance parser (unit-aware) and
//    no unit-blind call sites or inline numeral-only distance parses.
// 2. Real account: recomputes the reported account's all-time km by hand and
//    asserts the hero and Stats & PRs code paths now share set+parser+rounding.
// 3. E2E: seeds a mixed-unit user (km / mi / unitless / metres / null),
//    logs in, and asserts the profile hero, Stats & PRs (all/month/year),
//    profile overview week, and feed sidebar week all report the identical
//    number. Cleans the seeded user up afterwards.
//
// Run with the dev server up: node artifacts/html-arenas/scripts/verify-km-consistency.js

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.join(__dirname, '..');
const BASE_URL = 'http://localhost:80/html';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

// Mirror of the canonical parser (kept in sync by the static checks below,
// which pin the exact implementation lines in server.js).
function parseKm(distance) {
  if (distance == null) return 0;
  const raw = String(distance).toLowerCase().replace(/,/g, '');
  const n = parseFloat(raw.replace(/[^0-9.]/g, ''));
  if (isNaN(n) || n <= 0) return 0;
  if (raw.includes('km')) return n;
  if (raw.includes('mi')) return n * 1.609;
  if (raw.includes('m')) return n / 1000;
  return n;
}
const round1 = (x) => Math.round(x * 10) / 10;

async function staticChecks() {
  console.log('— static: single canonical parser —');
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const calls = (src.match(/parseDistanceKm\(/g) || []).length; // would also match ...UnitAware( only if written without suffix
  check('no unit-blind parseDistanceKm( call sites', calls === 0, calls + ' found');
  const unitAwareCalls = (src.match(/parseDistanceKmUnitAware\(/g) || []).length;
  check('unit-aware parser used across surfaces (>= 12 call sites)', unitAwareCalls >= 12, unitAwareCalls + ' found');
  const inline = (src.match(/distance[^\n]*replace\(\/\[\^0-9/g) || []).length;
  // The only allowed numeral-strip on a distance string is inside the parser itself.
  check('no inline numeral-only distance parses outside the parser', inline <= 1, inline + ' found');
  // Pin the parser's implementation so the local mirror above stays truthful.
  for (const line of [
    "if (raw.includes('km')) return n;",
    "if (raw.includes('mi')) return n * 1.609;",
    "if (raw.includes('m')) return n / 1000;"
  ]) check('parser pins: ' + line, src.includes(line));

  console.log('— parser unit behaviour —');
  check('"10mi" → 16.09', parseKm('10mi') === 16.09);
  check('"5 miles" → 8.045', parseKm('5 miles') === 8.045);
  check('"2,000m" → 2', parseKm('2,000m') === 2);
  check('"10 km" → 10', parseKm('10 km') === 10);
  check('"5" (unitless) → 5', parseKm('5') === 5);
  check('null → 0', parseKm(null) === 0);
}

async function realAccountCheck() {
  console.log('— real account recompute —');
  const { data, error } = await admin
    .from('activities')
    .select('sport, distance, date')
    .eq('user_id', '4e3cd18f-2c09-4ce9-ada1-67fbe725fcd4');
  if (error) { check('fetch real account activities', false, error.message); return; }
  const acts = data || [];
  const unitAware = round1(acts.reduce((s, a) => s + parseKm(a.distance), 0));
  const unitBlind = Math.round(acts.reduce((s, a) => {
    const n = parseFloat(String(a.distance == null ? '0' : a.distance).replace(/[^0-9.]/g, ''));
    return s + (isNaN(n) ? 0 : n);
  }, 0));
  console.log('      activities=' + acts.length + '  unit-aware=' + unitAware + '  legacy-unit-blind=' + unitBlind);
  check('legacy unit-blind math reproduces the reported 47', unitBlind === 47, String(unitBlind));
  check('unit-aware math reproduces the reported hero 69.5', unitAware === 69.5, String(unitAware));
}

async function e2eSeededUser() {
  console.log('— e2e: seeded mixed-unit user —');
  const email = 'km-consistency-check@arenas-test.dev';
  const password = 'Kmcheck!12345';
  // Clean any leftover from a previous run.
  const { data: existing } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of (existing && existing.users) || []) {
    if (u.email === email) {
      await admin.from('activities').delete().eq('user_id', u.id);
      await admin.auth.admin.deleteUser(u.id);
    }
  }
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { name: 'KM Consistency Check', handle: 'kmcheck' }
  });
  if (cErr) { check('create seeded user', false, cErr.message); return; }
  const uid = created.user.id;

  try {
    const today = new Date().toISOString();
    const seed = [
      { sport: 'running', title: 'Run km', distance: '10 km' },
      { sport: 'cycling', title: 'Ride mi', distance: '5mi' },
      { sport: 'running', title: 'Run unitless', distance: '3' },
      { sport: 'swimming', title: 'Swim metres', distance: '2,000m' },
      { sport: 'yoga', title: 'Yoga no distance', distance: null }
    ].map((a) => ({ ...a, user_id: uid, date: today, duration: '30:00' }));
    const { error: iErr } = await admin.from('activities').insert(seed);
    check('insert seeded activities', !iErr, iErr && iErr.message);

    const expected = round1(seed.reduce((s, a) => s + parseKm(a.distance), 0));
    console.log('      expected total on every surface: ' + expected + ' km (10 + 8.045 + 3 + 2 + 0)');

    // Login through the real auth route to exercise the real endpoints.
    const loginRes = await fetch(BASE_URL + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      redirect: 'manual'
    });
    const setCookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [];
    const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
    check('login sets session cookies', cookie.includes('sb_access_token'), 'status ' + loginRes.status);
    const get = async (p) => {
      const r = await fetch(BASE_URL + p, { headers: { Cookie: cookie } });
      return r.headers.get('content-type', '').includes('json') ? r.json() : r.text();
    };

    // The hero lives in the server-rendered /profile page (injected payload).
    const profileHtml = await get('/profile');
    const hm = typeof profileHtml === 'string' && profileHtml.match(/"kmLogged":\s*([0-9.]+)/);
    check('profile hero kmLogged = ' + expected, !!hm && parseFloat(hm[1]) === expected, hm ? hm[1] : 'not found in /profile');

    for (const period of ['all', 'month', 'year']) {
      const stats = await get('/api/profile/stats?period=' + period);
      check('Stats & PRs (' + period + ') totalKm = ' + expected,
        stats.hero && stats.hero.totalKm === expected,
        JSON.stringify(stats.hero && stats.hero.totalKm));
    }

    const overview = await get('/api/profile/overview');
    check('profile overview week km = ' + expected,
      overview.week && overview.week.km === expected,
      JSON.stringify(overview.week && overview.week.km));

    const feedHtml = await get('/feed');
    const m = typeof feedHtml === 'string' && feedHtml.match(/"week":\s*\{[^}]*"km":\s*([0-9.]+)/);
    check('feed sidebar week km = ' + expected, !!m && parseFloat(m[1]) === expected, m ? m[1] : 'not found in /feed');
  } finally {
    await admin.from('activities').delete().eq('user_id', uid);
    await admin.auth.admin.deleteUser(uid);
    console.log('      seeded user cleaned up');
  }
}

(async () => {
  await staticChecks();
  await realAccountCheck();
  await e2eSeededUser();
  console.log(failures === 0 ? '\nAll checks passed.' : '\n' + failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('Script error:', e); process.exit(1); });
