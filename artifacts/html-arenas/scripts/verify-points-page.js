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
    ['arenas-leaderboards.html', 1], ['arenas-challenges.html', 1], ['arenas-my-profile.html', 1]
  ];
  surfaces.forEach(([file, n]) => {
    const src = fs.readFileSync(path.join(HTML_DIR, file), 'utf8');
    const count = (src.match(/class="hpw-link"/g) || []).length;
    check(`${file} has ${n} “ⓘ How points work” link(s)`, count === n, `got ${count}`);
    check(`${file} link href points at /how-points-work`, src.includes('/how-points-work'));
  });
  const challengesSrc = fs.readFileSync(path.join(HTML_DIR, 'arenas-challenges.html'), 'utf8');
  const headerStats = (challengesSrc.match(/<div class="header-stats">([\s\S]*?)<\/div>\s*<\/div>\s*<div style=/) || [])[1] || '';
  const retainedStatIds = [...headerStats.matchAll(/<strong id="([^"]+)"/g)].map((m) => m[1]);
  check('challenges header keeps exactly the three approved stats in order',
    JSON.stringify(retainedStatIds) === JSON.stringify(['active-count', 'pts-month', 'challenges-available']),
    JSON.stringify(retainedStatIds));
  check('challenges header stat values precede their labels',
    /<strong id="active-count">[^<]*<\/strong><span id="active-count-label">/.test(headerStats) &&
    /<strong id="pts-month">[^<]*<\/strong><span>/.test(headerStats) &&
    /<strong id="challenges-available">[^<]*<\/strong><span id="challenges-available-label">/.test(headerStats));
  check('challenges header removes colored stat-dot markup and CSS',
    !challengesSrc.includes('class="stat-dot"') && !/\.stat-dot\s*\{/.test(challengesSrc));
  check('challenges header removes only the longest-streak binding',
    !headerStats.includes('longest-streak') &&
    !challengesSrc.includes("setStat('longest-streak'") &&
    challengesSrc.includes('const best = result.longestStreak || 0;') &&
    challengesSrc.includes('renderStreakCard(result);'));
  check('challenges header stats use value-over-label columns',
    /\.header-stat\s*\{[^}]*flex-direction:\s*column/.test(challengesSrc));
  const leaderboardsSrc = fs.readFileSync(path.join(HTML_DIR, 'arenas-leaderboards.html'), 'utf8');
  check('points breakdown belongs to leaderboards only',
    leaderboardsSrc.includes('id="pts-breakdown-body"') &&
    !challengesSrc.includes('id="pts-breakdown-body"'));
  check('leaderboards active-challenges rail is removed',
    !leaderboardsSrc.includes('active-challenges-list') &&
    !leaderboardsSrc.includes('CHALLENGE_ACCENTS'));

  // ── 5. Footer links on all public pages + the page itself ──
  ['arenas-landing-login.html', 'arenas-about.html', 'arenas-terms.html',
    'arenas-privacy.html', 'arenas-for-clubs.html', 'arenas-how-points-work.html'].forEach((file) => {
    const src = fs.readFileSync(path.join(HTML_DIR, file), 'utf8');
    check(`${file} footer links to How points work`, src.includes('>How points work</a>'));
  });

  // ── 6. Modal fragment (?fragment=1) serves the SAME rendered content ──
  const fres = await fetch(`${BASE_URL}/how-points-work?fragment=1`, { redirect: 'manual' });
  check('GET /how-points-work?fragment=1 returns 200', fres.status === 200, `got ${fres.status}`);
  const frag = await fres.text();
  const tableOf = (s) => { const m = s.match(/<table class="points-table"[\s\S]*?<\/table>/); return m ? m[0] : null; };
  check('fragment sport table is byte-identical to the page table',
    tableOf(frag) !== null && tableOf(frag) === tableOf(page));
  check('fragment carries the worked-example totals',
    frag.includes(`→&nbsp; ${ex1total} pts`) && frag.includes(`= ${ex2total} pts`));
  check('fragment has no page chrome (nav/footer/title)',
    !frag.includes('<nav') && !frag.includes('<footer') && !frag.includes('<title'));
  check('no unreplaced {{tokens}} left in fragment', !/{{[A-Z0-9_]+}}/.test(frag));

  // 6b. Fragment/nav markers must survive template edits — a missing marker
  //     turns ?fragment=1 into a 500 and breaks the authed nav swap.
  const tpl = fs.readFileSync(path.join(HTML_DIR, 'arenas-how-points-work.html'), 'utf8');
  ['/*HPW_CSS_START*/', '/*HPW_CSS_END*/', '<!--HPW_CONTENT_START-->', '<!--HPW_CONTENT_END-->',
    '<!--HPW_NAV_START-->', '<!--HPW_NAV_END-->'].forEach((m) => {
    check(`template still carries marker ${m}`, tpl.includes(m));
  });

  // ── 7. Chrome per requester on the standalone page ──
  // (Authed chrome swap is exercised by session tests, not this anonymous guard.)
  check('logged-out page shows marketing chrome (Sign up free)', page.includes('Sign up free'));
  check('logged-out page does NOT show the app nav (Back to app)', !page.includes('Back to app'));

  // ── 8. Authed pages still gate (regression: the new route must not have
  //       loosened anything) ──
  const lb = await fetch(`${BASE_URL}/leaderboards`, { redirect: 'manual' });
  check('/leaderboards still redirects logged-out users', lb.status === 302, `got ${lb.status}`);

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => { console.error('Verify script crashed:', err); process.exit(1); });
