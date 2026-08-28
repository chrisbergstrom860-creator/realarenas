#!/usr/bin/env node
// Real-data contract test for the rebuilt overall leaderboard.  The app must be
// running on localhost:80.  This script deliberately owns every row it creates;
// /tmp's manifest makes an interrupted run recoverable on the next invocation.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright-core');

const BASE = 'http://localhost:80/html';
const PW = 'ArenasTest!234';
const MANIFEST = '/tmp/verify-overall-leaderboard-manifest.json';
const SHOTS = '/tmp/overall-leaderboard-screenshots';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });
const defs = {
  viewer: ['Overall Bravo Viewer', 'overall_viewer'],
  alpha: ['Overall Alpha', 'overall_alpha'],
  charlie: ['Overall Charlie', 'overall_charlie'],
  delta: ['Overall Delta', 'overall_delta'],
  echo: ['Overall Echo', 'overall_echo'],
  outside: ['Overall Able Outside', 'overall_outside'],
  opted: ['Overall Hidden', 'overall_hidden'],
  zero: ['Overall Zero', 'overall_zero'],
  boundary: ['Overall Boundary', 'overall_boundary'],
  tieA: ['Overall Same Name', 'overall_tie_a'],
  tieB: ['Overall Same Name', 'overall_tie_b']
};
const email = (k) => `overall-lb-${k}@arenas-test.dev`;
const users = {}, records = [];
let failures = 0, browser, page, browserRows = [], browserBreakdowns = {};
let routeDelays = {}, routeFailures = {};
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail ? ' — ' + JSON.stringify(detail).slice(0, 500) : '')); }
}
function save(x) {
  records.push(x);
  fs.writeFileSync(MANIFEST + '.tmp', JSON.stringify({ records }, null, 2));
  fs.renameSync(MANIFEST + '.tmp', MANIFEST);
}
async function listAuth() {
  const out = [];
  for (let p = 1;; p++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: p, perPage: 200 });
    if (error) throw error;
    out.push(...(data.users || []));
    if ((data.users || []).length < 200) return out;
  }
}
async function deleteUserRows(id) {
  for (const [table, col] of [
    ['activity_likes', 'user_id'], ['post_likes', 'user_id'], ['post_comments', 'user_id'],
    ['posts', 'user_id'], ['follows', 'follower_id'], ['follows', 'following_id'],
    ['event_rsvps', 'user_id'], ['challenge_participants', 'user_id'],
    ['challenge_invites', 'invitee_id'], ['challenge_invites', 'inviter_id'],
    ['notifications', 'actor_id'], ['notifications', 'user_id'], ['goals', 'user_id'],
    ['achievements', 'user_id'], ['planned_sessions', 'user_id'], ['contact_messages', 'user_id'],
    ['memberships', 'user_id'], ['activities', 'user_id'], ['profiles', 'id']
  ]) await admin.from(table).delete().eq(col, id);
}
async function cleanup(entries) {
  const acts = entries.filter((x) => x.type === 'activity').map((x) => x.id);
  const ids = [...new Set(entries.filter((x) => x.type === 'user').map((x) => x.id))];
  if (acts.length) await admin.from('activities').delete().in('id', acts);
  for (const id of ids) { await deleteUserRows(id); await admin.auth.admin.deleteUser(id); }
}
async function recover() {
  if (!fs.existsSync(MANIFEST)) return;
  const stale = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  await cleanup(stale.records || []);
  fs.rmSync(MANIFEST, { force: true });
}
async function makeUser(k) {
  const [name, handle] = defs[k];
  const { data, error } = await admin.auth.admin.createUser({
    email: email(k), password: PW, email_confirm: true,
    user_metadata: { name, handle, timezone: 'UTC', sports: ['running'],
      prefs: k === 'opted' ? { show_on_leaderboards: false } : { show_on_leaderboards: true } }
  });
  if (error) throw new Error('create ' + k + ': ' + error.message);
  users[k] = { id: data.user.id }; save({ type: 'user', id: data.user.id, email: email(k) });
}
async function login(k) {
  const r = await fetch(BASE + '/auth/login', { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: email(k), password: PW }).toString() });
  const cs = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')])
    .map((x) => x && String(x).split(';')[0]).filter(Boolean);
  if (!cs.length) throw new Error('login ' + k + ' returned ' + r.status);
  users[k].cookie = cs.join('; ');
}
function browserCookies(header) {
  return String(header || '').split(';').map((part) => {
    const eq = part.indexOf('=');
    return { name: part.slice(0, eq).trim(), value: part.slice(eq + 1), domain: 'localhost', path: '/' };
  }).filter((c) => c.name);
}
async function api(period, key = 'viewer') {
  const r = await fetch(BASE + '/api/leaderboard/platform?period=' + period,
    { headers: { Cookie: users[key].cookie } });
  return { status: r.status, body: await r.json() };
}
async function challengesApi() {
  const r = await fetch(BASE + '/api/challenges', { headers: { Cookie: users.viewer.cookie } });
  return { status: r.status, body: await r.json() };
}
async function activity(k, distance, date, title, sport = 'running') {
  const { data, error } = await admin.from('activities').insert({
    user_id: users[k].id, sport, title: title || 'Overall leaderboard seed',
    distance: distance + ' km', duration: '00:30:00', date: date.toISOString()
  }).select('id').single();
  if (error) throw new Error('activity ' + k + ': ' + error.message);
  save({ type: 'activity', id: data.id });
}
async function clearActivities() {
  const ids = records.filter((x) => x.type === 'activity').map((x) => x.id);
  if (ids.length) await admin.from('activities').delete().in('id', ids);
  for (let i = records.length - 1; i >= 0; i--) if (records[i].type === 'activity') records.splice(i, 1);
  fs.writeFileSync(MANIFEST, JSON.stringify({ records }, null, 2));
}
async function seedPopulation(viewerDistance, count) {
  await clearActivities();
  const now = new Date();
  const keys = ['alpha', 'charlie', 'delta', 'echo', 'outside'].slice(0, count);
  // alpha + viewer tie in points and activity count; name determines their order.
  if (keys.includes('alpha')) { await activity('alpha', 5, now); await activity('alpha', 5, now); }
  if (viewerDistance) { await activity('viewer', viewerDistance / 2, now); await activity('viewer', viewerDistance / 2, now); }
  const distances = { charlie: 9, delta: 8, echo: 7, outside: 6 };
  for (const k of keys.filter((x) => x !== 'alpha')) {
    if (k === 'outside' && viewerDistance === 6) {
      await activity(k, 3, now); await activity(k, 3, now);
    } else await activity(k, distances[k], now);
  }
}
function row(board, k) { return board.leaderboard.find((x) => x.userId === users[k].id); }
function uiRow(k, rank, points, activityCount, isMe) {
  return {
    userId: users[k].id,
    name: defs[k][0],
    handle: defs[k][1],
    avatar_url: null,
    points,
    activityCount,
    rank,
    isMe: Boolean(isMe)
  };
}
async function openBoard(period, width, label) {
  await page.setViewportSize({ width, height: 900 });
  const weekResponse = page.waitForResponse((r) => r.url().includes('/api/leaderboard/platform?period=week'));
  await page.goto(BASE + '/leaderboards', { waitUntil: 'domcontentloaded' });
  await weekResponse;
  if (period !== 'week') {
    const requested = period === 'month' ? 'month' : 'all';
    const periodResponse = page.waitForResponse((r) => r.url().includes('/api/leaderboard/platform?period=' + requested));
    await page.getByRole('button', { name: period === 'month' ? 'This month' : 'All time' }).click();
    await periodResponse;
  }
  await page.waitForFunction(() => document.querySelector('#board-podium .podium-layout, #board-podium .empty-state'));
  await page.waitForFunction(() => {
    const breakdown = document.querySelector('#pts-breakdown-body');
    return breakdown && !/Loading/.test(breakdown.textContent || '');
  });
  await page.screenshot({ path: path.join(SHOTS, label + '-' + width + '.png'), fullPage: true });
  return page.evaluate(() => ({
    podium: document.querySelectorAll('#board-podium .podium-col').length,
    rows: document.querySelectorAll('#board-list .list-row').length,
    mine: document.querySelectorAll('.is-you').length,
    breakCount: document.querySelectorAll('.list-break').length,
    unranked: document.querySelector('.unranked-state') && document.querySelector('.unranked-state').textContent.trim(),
    boardText: (document.querySelector('.board-container') || {}).innerText || '',
    layout: document.querySelector('#board-podium .podium-layout') && document.querySelector('#board-podium .podium-layout').className,
    breakdownTitle: (document.querySelector('#pts-breakdown-title') || {}).textContent || '',
    breakdownTotal: (document.querySelector('.pts-total strong') || {}).textContent || '',
    breakdownRows: [...document.querySelectorAll('.pts-row')].filter((el) => getComputedStyle(el).display !== 'none').map((el) => el.textContent.trim()),
    breakdownTop: document.querySelector('.points-card').getBoundingClientRect().top,
    boardTop: document.querySelector('.board-container').getBoundingClientRect().top,
    viewportHeight: innerHeight
  }));
}
async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (verification must not be skipped)');
  await recover(); fs.mkdirSync(SHOTS, { recursive: true });
  for (const k of Object.keys(defs)) await makeUser(k);
  await login('viewer');
  await login('opted');

  // Date filtering is deliberately tested with rows immediately either side of
  // the UTC boundaries (all seeded users use UTC), plus a future row.
  await clearActivities();
  const now = new Date(), monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  await activity('boundary', 4, now, 'inside current periods');
  await activity('boundary', 4, new Date(monday - 1000), 'before week');
  await activity('boundary', 4, new Date(month - 1000), 'before month');
  await activity('boundary', 99, new Date(Date.now() + 86400000), 'future excluded');
  await activity('opted', 99, now, 'opted excluded');
  for (const period of ['week', 'month', 'all']) {
    const b = await api(period);
    check('API accepts ' + period, b.status === 200 && b.body.period === period, b);
    check(period + ': opted-out and zero-activity users excluded',
      !row(b.body, 'opted') && !row(b.body, 'zero'), b.body.leaderboard);
  }
  const boundaryWeek = await api('week'), boundaryMonth = await api('month'), boundaryAll = await api('all');
  const expectedMonthDeltaActivities = month.getTime() < monday.getTime() ? 2 : 1;
  check('week/month/all boundaries and future-date cap use viewer UTC',
    row(boundaryWeek.body, 'boundary').activityCount === 1 &&
    row(boundaryMonth.body, 'boundary').activityCount === expectedMonthDeltaActivities &&
    row(boundaryAll.body, 'boundary').activityCount === 3,
    { week: row(boundaryWeek.body, 'boundary'), month: row(boundaryMonth.body, 'boundary'),
      all: row(boundaryAll.body, 'boundary'), monday, month });
  const optedBoard = await api('week', 'opted');
  check('opted-out viewer has no public rank but keeps a truthful private breakdown',
    !optedBoard.body.leaderboard.some((item) => item.userId === users.opted.id) &&
    optedBoard.body.viewerBreakdown.total === 990 &&
    optedBoard.body.viewerBreakdown.rows.length === 1 &&
    optedBoard.body.viewerBreakdown.rows[0].sport === 'running',
    optedBoard.body);

  // The Challenges header and Leaderboards month breakdown must share the
  // viewer's month-start-through-now activity set. A future-dated row inside
  // the current calendar month is the regression case that previously drifted.
  await clearActivities();
  const sevenSports = [
    ['running', 10], ['cycling', 10], ['climbing', 1], ['swimming', 1],
    ['hockey', 1], ['basketball', 1], ['hiking', 1]
  ];
  for (const [sport, distance] of sevenSports) {
    await activity('viewer', distance, now, 'seven-sport ' + sport, sport);
  }
  const futureInMonth = new Date(Math.min(
    Date.now() + 86400000,
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - 1000
  ));
  await activity('viewer', 999, futureInMonth, 'future current-month excluded', 'running');
  const sevenMonth = await api('month');
  const challengeMonth = await challengesApi();
  const expectedSevenTotal = 355;
  check('future-dated current-month activity excluded identically by both account surfaces',
    sevenMonth.body.viewerBreakdown.total === expectedSevenTotal &&
    challengeMonth.body.pointsThisMonth === expectedSevenTotal,
    { leaderboard: sevenMonth.body.viewerBreakdown, challenges: challengeMonth.body.pointsThisMonth, futureInMonth });
  check('month API returns seven positive real sport rows whose sum equals total',
    sevenMonth.body.viewerBreakdown.rows.length === 7 &&
    sevenMonth.body.viewerBreakdown.rows.reduce((sum, item) => sum + item.points, 0) === sevenMonth.body.viewerBreakdown.total,
    sevenMonth.body.viewerBreakdown);

  // Real API tie ordering: activity count, then display name, then user ID.
  await clearActivities();
  await activity('alpha', 50000, now); await activity('alpha', 50000, now);
  await activity('viewer', 100000, now);
  await activity('charlie', 90000, now);
  await activity('delta', 80000, now); await activity('echo', 80000, now);
  await activity('tieA', 70000, now); await activity('tieB', 70000, now);
  const week = await api('week');
  const a = row(week.body, 'alpha'), v = row(week.body, 'viewer'), c = row(week.body, 'charlie');
  check('competition ranks include 1,1,3', a && v && c && a.rank === 1 && v.rank === 1 && c.rank === 3, { a, v, c });
  const rankedIds = week.body.leaderboard.map((x) => x.userId);
  check('equal-point order first prefers activity count',
    rankedIds.indexOf(users.alpha.id) < rankedIds.indexOf(users.viewer.id), week.body.leaderboard);
  check('equal-point order next prefers display name',
    rankedIds.indexOf(users.delta.id) < rankedIds.indexOf(users.echo.id), week.body.leaderboard);
  check('equal-point order finally prefers user ID',
    rankedIds.indexOf(users.tieA.id) < rankedIds.indexOf(users.tieB.id) === (users.tieA.id < users.tieB.id),
    { tieA: users.tieA.id, tieB: users.tieB.id, rankedIds });

  const executablePath = process.env.CHROMIUM_BIN ||
    execSync('command -v chromium || command -v chromium-browser').toString().trim();
  browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext();
  await context.addCookies(browserCookies(users.viewer.cookie));
  const errors = [], badRoutes = [];
  page = await context.newPage();
  await page.route('**/api/leaderboard/platform?*', async (route) => {
    const period = new URL(route.request().url()).searchParams.get('period') || 'week';
    if (routeDelays[period]) await new Promise((resolve) => setTimeout(resolve, routeDelays[period]));
    if (routeFailures[period]) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'temporary' }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        leaderboard: browserRows,
        period,
        sport: 'all',
        viewerBreakdown: browserBreakdowns[period] || { total: 0, rows: [] }
      })
    });
  });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (/\/api\/(?:following|follows|clubs)/.test(r.url())) badRoutes.push(r.url()); });

  // Inside: three podium + two population list slots, exactly once for viewer.
  browserRows = [
    uiRow('alpha', 1, 1000, 10),
    uiRow('viewer', 2, 900, 9, true),
    uiRow('charlie', 3, 800, 8),
    uiRow('delta', 4, 700, 7),
    uiRow('echo', 5, 600, 6)
  ];
  browserBreakdowns = {
    week: { total: 100, rows: [{ sport: 'running', points: 100 }] },
    month: sevenMonth.body.viewerBreakdown,
    all: { total: 220, rows: [{ sport: 'cycling', points: 120 }, { sport: 'running', points: 100 }] }
  };
  for (const period of ['week', 'month', 'all']) {
    for (const width of [1280, 380]) {
      const d = await openBoard(period, width, period + '-inside');
      check(period + ' inside ' + width + ': five population rows and viewer once',
        d.podium + d.rows === 5 && d.mine === 1 && d.breakCount === 0, d);
      check(period + ' inside ' + width + ': selector updates matching breakdown title and total',
        d.breakdownTitle.toLowerCase().includes(period === 'all' ? 'all time' : 'this ' + period) &&
        d.breakdownTotal === (period === 'week' ? '100 pts' : period === 'month' ? '355 pts' : '220 pts'), d);
      if (width === 380) {
        check(period + ' mobile: compact breakdown is above the board and board begins in the initial viewport',
          d.breakdownTop < d.boardTop && d.boardTop < d.viewportHeight, d);
      }
    }
  }
  const monthUi = await openBoard('month', 1280, 'month-seven-sports');
  const monthDisplayed = monthUi.breakdownRows;
  const displayedValues = monthDisplayed.map((text) => Number((text.match(/([\d,]+)\s*pts$/) || [])[1].replace(/,/g, '')));
  check('desktop seven-sport breakdown displays six sport rows plus Other sports',
    monthDisplayed.length === 7 &&
    monthDisplayed.filter((text) => !text.startsWith('Other sports')).length === 6 &&
    monthDisplayed.some((text) => text.startsWith('Other sports')), monthDisplayed);
  check('displayed sport rows plus Other sports equal the exact total',
    displayedValues.every(Number.isFinite) &&
    displayedValues.reduce((sum, value) => sum + value, 0) === sevenMonth.body.viewerBreakdown.total,
    { monthDisplayed, displayedValues, total: sevenMonth.body.viewerBreakdown.total });

  // An older slow request must not overwrite the newer selected period.
  routeDelays = { week: 250, month: 0 };
  await page.setViewportSize({ width: 380, height: 900 });
  await page.goto(BASE + '/leaderboards', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'This month' }).click();
  await page.waitForFunction(() => /this month/i.test((document.querySelector('#pts-breakdown-title') || {}).textContent || ''));
  await page.waitForTimeout(350);
  const raceState = await page.evaluate(() => ({
    active: (document.querySelector('.period-tab.active') || {}).textContent || '',
    title: (document.querySelector('#pts-breakdown-title') || {}).textContent || '',
    total: (document.querySelector('.pts-total strong') || {}).textContent || ''
  }));
  check('out-of-order responses cannot overwrite the newly selected period',
    raceState.active.trim() === 'This month' &&
    /this month/i.test(raceState.title) &&
    raceState.total === '355 pts',
    raceState);
  routeDelays = {};

  // A failed request is unavailable, never a fabricated zero-activity period.
  const errorsBeforeFailureTest = errors.length;
  routeFailures = { week: true };
  await page.goto(BASE + '/leaderboards', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /unavailable/i.test((document.querySelector('#pts-breakdown-body') || {}).textContent || ''));
  const errorState = await page.evaluate(() => ({
    breakdown: (document.querySelector('#pts-breakdown-body') || {}).textContent || '',
    board: (document.querySelector('.board-container') || {}).textContent || ''
  }));
  check('request failure renders unavailable states without a fake zero total',
    /unavailable/i.test(errorState.breakdown) &&
    /Rankings unavailable/.test(errorState.board) &&
    !/0\s*pts/.test(errorState.breakdown),
    errorState);
  const simulatedFailureErrors = errors.slice(errorsBeforeFailureTest);
  check('only the deliberately simulated 503 reached the browser console during failure test',
    simulatedFailureErrors.length === 1 && /503/.test(simulatedFailureErrors[0]),
    simulatedFailureErrors);
  errors.splice(errorsBeforeFailureTest);
  routeFailures = {};
  // Move viewer below fifth place. The sixth rank is a shared rank only if its
  // points tie; API rank, rather than visual position, is the asserted contract.
  browserRows = [
    uiRow('alpha', 1, 1000, 10),
    uiRow('charlie', 2, 900, 9),
    uiRow('delta', 3, 800, 8),
    uiRow('echo', 4, 700, 7),
    uiRow('outside', 5, 600, 6),
    uiRow('viewer', 5, 600, 6, true)
  ];
  for (const period of ['week', 'month', 'all']) {
    const mine = browserRows.find((x) => x.isMe);
    for (const width of [1280, 380]) {
      const d = await openBoard(period, width, period + '-outside');
      check(period + ' outside ' + width + ': fifth-boundary tie keeps five population plus one separated viewer at shared API rank',
        d.podium + d.rows === 6 && d.mine === 1 && d.breakCount === 1 &&
        await page.locator('.list-row.is-you .list-rank').textContent() === String(mine.rank), { d, mine });
    }
  }
  browserRows = [uiRow('alpha', 1, 1000, 10), uiRow('charlie', 2, 900, 9)];
  for (const width of [1280, 380]) {
    const d = await openBoard('week', width, 'unranked');
    check('unranked ' + width + ': leaderboard experience has no fake #1, top claim, or trophy',
      d.podium === 2 && d.rows === 0 && d.mine === 0 &&
      d.unranked === 'Not ranked this weekLog an activity this week to join the overall leaderboard.' &&
      !d.boardText.includes('#1') &&
      !d.boardText.includes('Top of the leaderboard') &&
      !d.boardText.includes('🏆'), d);
  }
  for (let n = 0; n <= 5; n++) {
    browserRows = ['alpha', 'charlie', 'delta', 'echo', 'outside'].slice(0, n)
      .map((k, i) => uiRow(k, i + 1, 1000 - i * 100, 10 - i));
    const d = await openBoard('week', 1280, 'layout-' + n);
    check('layout ' + n + ': podium class/count and visible population cap',
      (n === 0 ? d.layout === null && d.podium === 0 : d.layout === 'podium-layout p-' + Math.min(n, 3)) &&
      d.podium + d.rows === n, d);
  }
  const html = fs.readFileSync(path.join(__dirname, '..', 'html', 'arenas-leaderboards.html'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const route = server.slice(server.indexOf("app.get(BASE + '/api/leaderboard/platform'"), server.indexOf('async function getCurrentClubMembership'));
  check('no scope, sport, or metric controls and board loader calls only platform endpoint',
    !html.includes('scope-select') &&
    !html.includes('sport-nav-tab') &&
    !html.includes('metric-select') &&
    !html.includes('/api/leaderboard/following') &&
    !html.includes('/api/leaderboard/club') &&
    html.includes('/api/leaderboard/platform?'), null);
  check('platform route defines no following or club API dependency', !/following|follows|clubs/.test(route), null);
  check('browser had zero page/console errors and no following/club API calls', errors.length === 0 && badRoutes.length === 0, { errors, badRoutes });

  // Challenges keeps its monthly header stat and three remaining rail cards;
  // the removed breakdown must leave no blank placeholder or duplicate link.
  for (const width of [1280, 380]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(BASE + '/challenges', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const body = document.querySelector('#suggested-body');
      return body && !/Loading/.test(body.textContent || '');
    });
    await page.screenshot({ path: path.join(SHOTS, 'challenges-after-' + width + '.png'), fullPage: true });
    const challengeLayout = await page.evaluate(() => ({
      breakdowns: document.querySelectorAll('#pts-breakdown-body').length,
      pointsLinks: [...document.querySelectorAll('.hpw-link')].filter((el) => getComputedStyle(el).display !== 'none').length,
      railCards: document.querySelectorAll('.right-col .side-card').length,
      pointsStat: (document.querySelector('#pts-month') || {}).textContent || ''
    }));
    check('challenges after removal ' + width + ': monthly stat retained and breakdown absent',
      challengeLayout.breakdowns === 0 &&
      challengeLayout.pointsLinks === 1 &&
      challengeLayout.railCards === 3 &&
      /^\d[\d,]*$/.test(challengeLayout.pointsStat),
      challengeLayout);
  }
}

(async () => {
  const created = records;
  try { await main(); }
  catch (err) { failures++; console.log('FAIL  fatal — ' + err.message); }
  finally {
    if (browser) await browser.close();
    try {
      await cleanup(created);
      const auth = await listAuth();
      const seeded = created.filter((x) => x.type === 'user').map((x) => x.email);
      check('cleanup residue: auth users absent', !auth.some((u) => seeded.includes(u.email)), seeded);
      const ids = created.filter((x) => x.type === 'activity').map((x) => x.id);
      if (ids.length) { const { data } = await admin.from('activities').select('id').in('id', ids); check('cleanup residue: activities absent', !(data || []).length, data); }
      fs.rmSync(MANIFEST, { force: true });
    } catch (err) { failures++; console.log('FAIL  cleanup — ' + err.message); }
    console.log('Coverage: platform period/ranking rules, five-row viewer states, responsive screenshots, source/network scope guards, and manifest cleanup.');
    console.log('Constraint: this authenticated localhost integration verifier requires live Supabase service-role credentials and Playwright.');
    console.log(failures ? '\\n' + failures + ' FAILURE(S)' : '\\nALL CHECKS PASSED');
    process.exitCode = failures ? 1 : 0;
  }
})();