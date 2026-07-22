// Verification for the public /how-points-work page: asserts the rendered
// sport table matches the live sports registry (sports.js) row-for-row, that
// the worked-example math matches calculatePoints' behaviour, that the page is
// reachable logged-out, and that every entry link / footer link is in place.
// Run: node artifacts/html-arenas/scripts/verify-points-page.js
const fs = require('fs');
const path = require('path');
const { SPORTS, SPORT_POINTS } = require('../sports');

const BASE_URL = process.env.VERIFY_BASE_URL || 'http://localhost:80/html';
const HTML_DIR = path.join(__dirname, '..', 'html');

let failures = 0;
function check(label, ok, detail) {
  if (ok) { console.log(`  ok  ${label}`); }
  else { failures++; console.error(`FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

(async () => {
  // ── 1. Page reachable logged-out (no cookies sent) ──
  const res = await fetch(`${BASE_URL}/how-points-work`, { redirect: 'manual' });
  check('GET /how-points-work returns 200 logged-out', res.status === 200, `got ${res.status}`);
  const page = await res.text();

  // ── 2. Table rows == registry, same order, nothing extra ──
  const rowRe = /<tr><td class="pt-sport"><span class="pt-emoji">(.*?)<\/span>(.*?)<\/td><td>(.*?)<\/td><td class="pt-val">(\d+) pts per (km|session)<\/td><\/tr>/g;
  const rows = [...page.matchAll(rowRe)].map((m) => ({ emoji: m[1], label: m[2], scoring: m[3], rate: Number(m[4]), per: m[5] }));
  check(`table has exactly ${SPORTS.length} rows (one per registry sport)`, rows.length === SPORTS.length, `got ${rows.length}`);
  SPORTS.forEach((s, i) => {
    const r = rows[i];
    if (!r) { check(`row ${i} (${s.id}) present`, false); return; }
    const ok = r.emoji === s.emoji && r.label === s.label && r.per === s.scoring.per &&
      r.rate === s.scoring.rate &&
      r.scoring === (s.scoring.per === 'km' ? 'Per kilometre' : 'Per session');
    check(`row ${i} matches registry: ${s.emoji} ${s.label} — ${s.scoring.rate} pts per ${s.scoring.per}`, ok,
      ok ? '' : JSON.stringify(r));
  });

  // ── 3. Worked-example math matches calculatePoints semantics ──
  const run = SPORT_POINTS.running.rate, ride = SPORT_POINTS.cycling.rate;
  const climb = SPORT_POINTS.climbing.rate, yoga = SPORT_POINTS.yoga.rate;
  const round1 = (n) => Math.round(n * 10) / 10;
  const ex1total = Math.round(8 * run + 5 * run + 10 * 1.609 * run);
  const ex2total = Math.round(25 * ride + climb + yoga);
  check(`example 1 pieces (${round1(8 * run)}, ${round1(5 * run)}, ${round1(10 * 1.609 * run)} pts) rendered`,
    page.includes(`8 km × ${run} = ${round1(8 * run)} pts`) &&
    page.includes(`5 km × ${run} = ${round1(5 * run)} pts`) &&
    page.includes(`16.09 km × ${run} = ${round1(10 * 1.609 * run)} pts`));
  check(`example 1 total ${ex1total} pts rendered`, page.includes(`→&nbsp; ${ex1total} pts`));
  check(`example 2 pieces (${round1(25 * ride)}, ${climb}, ${yoga} pts) rendered`,
    page.includes(`25 km × ${ride} = ${round1(25 * ride)} pts`) &&
    page.includes(`Climbing session = ${climb} pts`) &&
    page.includes(`Yoga session = ${yoga} pts`));
  check(`example 2 total ${ex2total} pts rendered`, page.includes(`= ${ex2total} pts`));
  check('no unreplaced {{tokens}} left in page', !/{{[A-Z0-9_]+}}/.test(page));
  check('effort-parity claim (climbing ≈ 5 km run) is true in registry', climb === 5 * run,
    `climbing=${climb}, 5km run=${5 * run}`);

  // ── 4. Entry links present in source pages (served to authed users) ──
  const surfaces = [
    ['arenas-leaderboards.html', 1], ['arenas-challenges.html', 2], ['arenas-my-profile.html', 1]
  ];
  surfaces.forEach(([file, n]) => {
    const src = fs.readFileSync(path.join(HTML_DIR, file), 'utf8');
    const count = (src.match(/class="hpw-link"/g) || []).length;
    check(`${file} has ${n} “ⓘ How points work” link(s)`, count === n, `got ${count}`);
    check(`${file} link href points at /how-points-work`, src.includes('/how-points-work'));
  });

  // ── 5. Footer links on all public pages + the page itself ──
  ['arenas-landing-login.html', 'arenas-blog.html', 'arenas-about.html', 'arenas-terms.html',
    'arenas-privacy.html', 'arenas-for-clubs.html', 'arenas-how-points-work.html'].forEach((file) => {
    const src = fs.readFileSync(path.join(HTML_DIR, file), 'utf8');
    check(`${file} footer links to How points work`, src.includes('>How points work</a>'));
  });

  // ── 6. Authed pages still gate (regression: the new route must not have
  //       loosened anything) ──
  const lb = await fetch(`${BASE_URL}/leaderboards`, { redirect: 'manual' });
  check('/leaderboards still redirects logged-out users', lb.status === 302, `got ${lb.status}`);

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => { console.error('Verify script crashed:', err); process.exit(1); });
