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
let imageRequests = [];
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
  const clubs = entries.filter((x) => x.type === 'club').map((x) => x.id);
  const acts = entries.filter((x) => x.type === 'activity').map((x) => x.id);
  const ids = [...new Set(entries.filter((x) => x.type === 'user').map((x) => x.id))];
  if (acts.length) await admin.from('activities').delete().in('id', acts);
  if (clubs.length) {
    await admin.from('memberships').delete().in('club_id', clubs);
    await admin.from('clubs').delete().in('id', clubs);
  }
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
async function makeViewerClub() {
  const handle = 'overall-fixture-' + Date.now().toString(36);
  const { data: club, error: clubError } = await admin.from('clubs').insert({
    name: 'Overall Fixture Club',
    handle,
    sport: 'running',
    owner_id: users.viewer.id,
    visibility: 'private'
  }).select('id, name').single();
  if (clubError) throw new Error('create club: ' + clubError.message);
  save({ type: 'club', id: club.id });
  const { error: memberError } = await admin.from('memberships').insert({
    club_id: club.id,
    user_id: users.viewer.id,
    role: 'admin'
  });
  if (memberError) throw new Error('create membership: ' + memberError.message);
  return club;
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
  imageRequests = [];
  const weekResponse = page.waitForResponse((r) => r.url().includes('/api/leaderboard/platform?period=week'));
  await page.goto(BASE + '/leaderboards', { waitUntil: 'domcontentloaded' });
  await weekResponse;
  if (period !== 'week') {
    const requested = period === 'month' ? 'month' : 'all';
    const periodResponse = page.waitForResponse((r) => r.url().includes('/api/leaderboard/platform?period=' + requested));
    await page.evaluate((nextPeriod) => {
      const statePeriod = nextPeriod === 'all' ? 'alltime' : nextPeriod;
      const button = [...document.querySelectorAll('.period-tab')].find((item) =>
        item.textContent.trim() === (nextPeriod === 'month' ? 'This month' : 'All time'));
      window.setPeriod(statePeriod, button);
    }, requested);
    await periodResponse;
  }
  await page.waitForFunction(() => document.querySelector('#board-podium .podium-layout, #board-podium .empty-state'));
  await page.waitForFunction(() => {
    const breakdown = document.querySelector('#pts-breakdown-body');
    return breakdown && !/Loading/.test(breakdown.textContent || '');
  });
  await page.waitForFunction(() => [...document.querySelectorAll('.page-header-bg, .club-promo-bg')].every((img) => img.complete));
  await page.screenshot({ path: path.join(SHOTS, label + '-' + width + '.png'), fullPage: true });
  const result = await page.evaluate(async () => {
    const contrastRatio = (a, b) => {
      const lum = (rgb) => {
        const c = rgb.map((v) => {
          const n = v / 255;
          return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      };
      const x = lum(a), y = lum(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const image = document.querySelector('.page-header-bg');
    const header = document.querySelector('.page-header');
    const h = header.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(h.width));
    canvas.height = Math.max(1, Math.round(h.height));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const dw = image.naturalWidth * scale, dh = image.naturalHeight * scale;
    ctx.drawImage(image, (canvas.width - dw) * 0.5, (canvas.height - dh) * 0.55, dw, dh);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const color = (value) => (value.match(/\d+(?:\.\d+)?/g) || []).slice(0, 3).map(Number);
    let worstContrast = Infinity;
    for (const element of document.querySelectorAll('.page-kicker, .page-header-left h1, .page-header-left h1 span, .page-header-left p, .period-tab:not(.active)')) {
      const r = element.getBoundingClientRect();
      const fg = color(getComputedStyle(element).color);
      for (let y = Math.max(0, Math.floor(r.top - h.top)); y < Math.min(canvas.height, Math.ceil(r.bottom - h.top)); y += 2) {
        for (let x = Math.max(0, Math.floor(r.left - h.left)); x < Math.min(canvas.width, Math.ceil(r.right - h.left)); x += 2) {
          const i = (y * canvas.width + x) * 4;
          const p = x / Math.max(1, canvas.width - 1);
          const alpha = p <= 0.54 ? 0.9 + (0.72 - 0.9) * (p / 0.54) : 0.72 + (0.54 - 0.72) * ((p - 0.54) / 0.46);
          const bg = [pixels[i], pixels[i + 1], pixels[i + 2]].map((v) => Math.round(v * (1 - alpha)));
          worstContrast = Math.min(worstContrast, contrastRatio(fg, bg));
        }
      }
    }
    const board = document.querySelector('.board-container').getBoundingClientRect();
    const right = document.querySelector('.right-col').getBoundingClientRect();
    const selectedHero = (image.currentSrc || '').split('/').pop();
    const clubImage = document.querySelector('.club-promo-bg');
    const clubPromo = document.querySelector('.club-promo');
    const clubRect = clubPromo.getBoundingClientRect();
    const clubMedia = document.querySelector('.club-promo-media');
    const clubMediaRect = clubMedia.getBoundingClientRect();
    const clubCanvas = document.createElement('canvas');
    clubCanvas.width = Math.max(1, Math.round(clubMediaRect.width));
    clubCanvas.height = Math.max(1, Math.round(clubMediaRect.height));
    const clubCtx = clubCanvas.getContext('2d', { willReadFrequently: true });
    const clubScale = Math.max(clubCanvas.width / clubImage.naturalWidth, clubCanvas.height / clubImage.naturalHeight);
    const clubDrawWidth = clubImage.naturalWidth * clubScale;
    const clubDrawHeight = clubImage.naturalHeight * clubScale;
    clubCtx.drawImage(clubImage, (clubCanvas.width - clubDrawWidth) * 0.5, (clubCanvas.height - clubDrawHeight) * 0.5, clubDrawWidth, clubDrawHeight);
    const clubPixels = clubCtx.getImageData(0, 0, clubCanvas.width, clubCanvas.height).data;
    const clubLineContrasts = [];
    for (const element of document.querySelectorAll('.club-promo-title-main, .club-promo-title-accent, .club-promo-copy, .club-promo-btn')) {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rects = [...range.getClientRects()];
      const style = getComputedStyle(element);
      const fg = color(style.color);
      const solidParts = style.backgroundColor.match(/[\d.]+/g) || [];
      const solidBg = solidParts.slice(0, 3).map(Number);
      const hasSolidBg = solidParts.length >= 3 && (solidParts.length < 4 || Number(solidParts[3]) > 0);
      rects.forEach((rect, lineIndex) => {
        let lineWorst = Infinity;
        for (let y = Math.max(0, Math.floor(rect.top - clubRect.top)); y < Math.min(clubRect.height, Math.ceil(rect.bottom - clubRect.top)); y += 2) {
          for (let x = Math.max(0, Math.floor(rect.left - clubRect.left)); x < Math.min(clubRect.width, Math.ceil(rect.right - clubRect.left)); x += 2) {
            let bg = hasSolidBg ? solidBg : [255, 255, 255];
            const mx = x - (clubMediaRect.left - clubRect.left);
            const my = y - (clubMediaRect.top - clubRect.top);
            if (!hasSolidBg && mx >= 0 && mx < clubCanvas.width && my >= 0 && my < clubCanvas.height) {
              const i = (Math.floor(my) * clubCanvas.width + Math.floor(mx)) * 4;
              const p = mx / Math.max(1, clubCanvas.width);
              const mask = p <= 0.46 ? 0 : p >= 0.84 ? 1 : (p - 0.46) / 0.38;
              bg = [clubPixels[i], clubPixels[i + 1], clubPixels[i + 2]].map((value) => Math.round(value * mask + 255 * (1 - mask)));
            }
            lineWorst = Math.min(lineWorst, contrastRatio(fg, bg));
          }
        }
        clubLineContrasts.push({
          line: element.className + ':' + (lineIndex + 1),
          ratio: Number(lineWorst.toFixed(2))
        });
      });
    }
    return {
    podium: document.querySelectorAll('#board-podium .podium-col').length,
    rows: document.querySelectorAll('#board-list .list-row').length,
    mine: document.querySelectorAll('.is-you').length,
    breakCount: document.querySelectorAll('.list-break').length,
    unranked: document.querySelector('.unranked-state') && document.querySelector('.unranked-state').textContent.trim(),
    boardText: (document.querySelector('.board-container') || {}).innerText || '',
    layout: document.querySelector('#board-podium .podium-layout') && document.querySelector('#board-podium .podium-layout').className,
    breakdownTitle: (document.querySelector('#pts-breakdown-title') || {}).textContent || '',
    breakdownTotal: (document.querySelector('.pts-total strong') || {}).textContent || '',
    breakdownText: (document.querySelector('#pts-breakdown-body') || {}).textContent || '',
    breakdownRows: [...document.querySelectorAll('.pts-row')].filter((el) => getComputedStyle(el).display !== 'none').map((el) => el.textContent.trim()),
    topSportsText: (document.querySelector('#top-sports-body') || {}).textContent || '',
    topPercentages: [...document.querySelectorAll('.ts-pct')].map((el) => Number(el.textContent.replace('%', ''))),
    topSportRows: document.querySelectorAll('.ts-row').length,
    breakdownTop: document.querySelector('.points-card').getBoundingClientRect().top,
    boardTop: board.top,
    boardBottom: board.bottom,
    rightTop: right.top,
    boardLeft: board.left,
    boardRight: board.right,
    clubText: (document.querySelector('#club-promo-container') || {}).textContent || '',
    clubMarkup: clubPromo.outerHTML,
    clubHrefs: [...clubPromo.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href')),
    exploreHref: (document.querySelector('.club-promo-btn') || {}).getAttribute && document.querySelector('.club-promo-btn').getAttribute('href'),
    clubLineContrasts,
    clubLayout: {
      width: Math.round(clubRect.width),
      height: Math.round(clubRect.height),
      mediaLeft: Math.round(clubMediaRect.left - clubRect.left),
      mediaWidth: Math.round(clubMediaRect.width),
      contentWidth: Math.round(document.querySelector('.club-promo-content').getBoundingClientRect().width),
      railWidth: Math.round(document.querySelector('.right-col').getBoundingClientRect().width),
      mainWidth: Math.round(document.querySelector('.main').getBoundingClientRect().width)
    },
    selectedHero,
    selectedClub: clubImage ? (clubImage.currentSrc || '').split('/').pop() : null,
    worstBannerContrast: worstContrast,
    viewportHeight: innerHeight,
    viewportWidth: innerWidth,
    documentWidth: document.documentElement.scrollWidth
    };
  });
  result.imageRequests = [...new Set(imageRequests)];
  return result;
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
  check('platform endpoint viewerBreakdown total exactly matches the viewer leaderboard row',
    row(sevenMonth.body, 'viewer') &&
    row(sevenMonth.body, 'viewer').points === sevenMonth.body.viewerBreakdown.total,
    { viewer: row(sevenMonth.body, 'viewer'), breakdown: sevenMonth.body.viewerBreakdown });

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
  const session = await context.newCDPSession(page);
  await session.send('Network.setCacheDisabled', { cacheDisabled: true });
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
  page.on('request', (request) => {
    try {
      const pathname = new URL(request.url()).pathname;
      const marker = '/landing-assets/';
      if (pathname.includes(marker) && /leaderboards-(?:hero-hiker|club-group)-/.test(pathname)) {
        imageRequests.push(pathname.slice(pathname.indexOf(marker) + marker.length));
      }
    } catch {}
  });

  // Inside: three podium + two population list slots, exactly once for viewer.
  browserRows = [
    uiRow('alpha', 1, 1000, 10),
    uiRow('viewer', 2, 900, 9, true),
    uiRow('charlie', 3, 800, 8),
    uiRow('delta', 4, 700, 7),
    uiRow('echo', 5, 600, 6)
  ];
  browserBreakdowns = {
    week: { total: 900, rows: [{ sport: 'running', points: 450 }, { sport: 'cycling', points: 225 }, { sport: 'hiking', points: 135 }, { sport: 'yoga', points: 90 }] },
    month: { total: 900, rows: [{ sport: 'running', points: 277 }, { sport: 'cycling', points: 199 }, { sport: 'climbing', points: 150 }, { sport: 'swimming', points: 100 }, { sport: 'hockey', points: 90 }, { sport: 'basketball', points: 50 }, { sport: 'hiking', points: 34 }] },
    all: { total: 900, rows: [{ sport: 'cycling', points: 500 }, { sport: 'running', points: 400 }] }
  };
  for (const period of ['week', 'month', 'all']) {
    for (const width of [1280, 380]) {
      const d = await openBoard(period, width, period + '-inside');
      check(period + ' inside ' + width + ': five population rows and viewer once',
        d.podium + d.rows === 5 && d.mine === 1 && d.breakCount === 0, d);
      check(period + ' inside ' + width + ': selector updates matching breakdown title and total',
        d.breakdownTitle.toLowerCase().includes(period === 'all' ? 'all time' : 'this ' + period) &&
        d.breakdownTotal === '900 pts', d);
      check(period + ' inside ' + width + ': panel total equals the viewer leaderboard points',
        d.breakdownTotal === '900 pts' && d.boardText.includes('900 pts'), d);
      check(period + ' inside ' + width + ': displayed sport percentages sum to 100',
        d.topPercentages.length === browserBreakdowns[period].rows.length &&
        d.topPercentages.reduce((sum, value) => sum + value, 0) === 100, d.topPercentages);
      if (width === 380) {
        check(period + ' mobile: board comes before the stacked right rail',
          d.boardTop < d.rightTop && d.rightTop >= d.boardBottom, d);
      }
    }
  }
  const monthUi = await openBoard('month', 1280, 'month-seven-sports');
  const monthDisplayed = monthUi.breakdownRows;
  const displayedValues = monthDisplayed.map((text) => Number((text.match(/([\d,]+)\s*pts$/) || [])[1].replace(/,/g, '')));
  check('desktop seven-sport breakdown displays every real sport row without a synthetic Other row',
    monthDisplayed.length === 7 &&
    !monthDisplayed.some((text) => text.startsWith('Other sports')), monthDisplayed);
  check('displayed sport rows equal the exact total',
    displayedValues.every(Number.isFinite) &&
    displayedValues.reduce((sum, value) => sum + value, 0) === 900,
    { monthDisplayed, displayedValues, total: 900 });

  for (const width of [360, 380, 768, 1280, 1600]) {
    const d = await openBoard('week', width, 'responsive');
    const expectedHero = width >= 1024 ? 'leaderboards-hero-hiker-1600.avif' : 'leaderboards-hero-hiker-800.avif';
    check('responsive ' + width + ': no horizontal overflow',
      d.documentWidth <= d.viewportWidth, d);
    check('responsive ' + width + ': exact one hero and one club image request',
      d.imageRequests.filter((name) => /^leaderboards-hero-hiker-/.test(name)).length === 1 &&
      d.imageRequests.filter((name) => /^leaderboards-club-group-/.test(name)).length === 1,
      d.imageRequests);
    check('responsive ' + width + ': AVIF band selection is correct',
      d.selectedHero === expectedHero &&
      d.selectedClub === 'leaderboards-club-group-800.avif' &&
      d.imageRequests.every((name) => name.endsWith('.avif')),
      { selectedHero: d.selectedHero, selectedClub: d.selectedClub, requests: d.imageRequests });
    check('responsive ' + width + ': banner copy clears worst-case photo pixels at AA contrast',
      d.worstBannerContrast >= 4.5, d.worstBannerContrast);
    check('responsive ' + width + ': every club-card text line clears its worst-case faded-photo pixel at AA contrast',
      d.clubLineContrasts.length >= 5 &&
      d.clubLineContrasts.every((item) => item.ratio >= 4.5),
      d.clubLineContrasts);
    if ([360, 380, 768, 1280].includes(width)) {
      console.log('  layout ' + width + 'px ' + JSON.stringify(d.clubLayout) + ' contrast ' + JSON.stringify(d.clubLineContrasts));
    }
    if (width < 1024) {
      const gutter = width <= 480 ? 16 : 24;
      check('responsive ' + width + ': board uses app gutters and right rail stacks after it',
        Math.abs(d.boardLeft - gutter) <= 1 &&
        Math.abs(d.boardRight - (width - gutter)) <= 1 &&
        d.rightTop >= d.boardBottom, d);
    }
  }
  for (const width of [360, 768, 1280, 1600, 1920]) {
    for (const dpr of [1, 2, 3]) {
      const imageContext = await browser.newContext({
        viewport: { width, height: 900 },
        deviceScaleFactor: dpr,
        serviceWorkers: 'block',
        extraHTTPHeaders: { 'Cache-Control': 'no-cache' }
      });
      await imageContext.addCookies(browserCookies(users.viewer.cookie));
      const imagePage = await imageContext.newPage();
      const imageSession = await imageContext.newCDPSession(imagePage);
      await imageSession.send('Network.setCacheDisabled', { cacheDisabled: true });
      const requested = [];
      imagePage.on('request', (request) => {
        try {
          const pathname = new URL(request.url()).pathname;
          const marker = '/landing-assets/';
          if (pathname.includes(marker) && /leaderboards-(?:hero-hiker|club-group)-/.test(pathname)) {
            requested.push(pathname.slice(pathname.indexOf(marker) + marker.length));
          }
        } catch {}
      });
      await imagePage.route('**/api/leaderboard/platform?*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          leaderboard: browserRows,
          period: 'week',
          sport: 'all',
          viewerBreakdown: browserBreakdowns.week
        })
      }));
      await imagePage.goto(BASE + '/leaderboards?image-matrix=' + width + '-' + dpr, { waitUntil: 'networkidle' });
      const selected = await imagePage.evaluate(() => ({
        hero: (document.querySelector('.page-header-bg').currentSrc || '').split('/').pop(),
        club: (document.querySelector('.club-promo-bg').currentSrc || '').split('/').pop()
      }));
      const unique = [...new Set(requested)];
      const expectedHero = (
        (width === 360 && dpr <= 2) ||
        (width === 768 && dpr === 1)
      ) ? 'leaderboards-hero-hiker-800.avif' : 'leaderboards-hero-hiker-1600.avif';
      const clubCssWidth = width <= 480 ? width - 32 : width < 1024 ? width - 48 : 320;
      const expectedClub = clubCssWidth * dpr <= 800
        ? 'leaderboards-club-group-800.avif'
        : 'leaderboards-club-group-1600.avif';
      check('image matrix ' + width + 'px DPR ' + dpr + ': exactly one request per responsive image',
        unique.filter((name) => /^leaderboards-hero-hiker-/.test(name)).length === 1 &&
        unique.filter((name) => /^leaderboards-club-group-/.test(name)).length === 1,
        unique);
      check('image matrix ' + width + 'px DPR ' + dpr + ': selected expected AVIF bands',
        selected.hero === expectedHero &&
        selected.club === expectedClub &&
        unique.every((name) => name.endsWith('.avif')),
        { selected, unique });
      await imageContext.close();
    }
  }
  const noClubUi = await openBoard('week', 1280, 'no-club');
  check('no-club fixture sees the universal Explore clubs card',
    /Join a club and climb higher\./.test(noClubUi.clubText.replace(/\s+/g, ' ')) &&
    /Compete with friends, earn points together, and stay motivated\./.test(noClubUi.clubText) &&
    noClubUi.exploreHref === '/html/clubs' &&
    JSON.stringify(noClubUi.clubHrefs) === JSON.stringify(['/html/clubs']) &&
    !/Climb with your clubs/.test(noClubUi.clubText),
    noClubUi);
  const fixtureClub = await makeViewerClub();
  const clubUi = await openBoard('week', 1280, 'club-member');
  check('club member sees the exact same universal discovery card as a user with no clubs',
    fixtureClub &&
    clubUi.clubMarkup === noClubUi.clubMarkup &&
    clubUi.clubText === noClubUi.clubText &&
    clubUi.exploreHref === '/html/clubs' &&
    JSON.stringify(clubUi.clubHrefs) === JSON.stringify(['/html/clubs']) &&
    !/Climb with your clubs/.test(clubUi.clubText),
    { noClub: noClubUi.clubMarkup, member: clubUi.clubMarkup });
  const clubsRouteSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const clubsRouteStart = clubsRouteSource.indexOf("app.get(BASE + '/clubs'");
  const clubsRouteEnd = clubsRouteSource.indexOf("app.post(BASE + '/api/clubs/", clubsRouteStart);
  const clubsPageRoute = clubsRouteSource.slice(clubsRouteStart, clubsRouteEnd);
  check('Explore clubs target is the authenticated discovery directory, not a user-clubs destination',
    clubsPageRoute.includes('buildClubDirectory(req.user.id)') &&
    clubsPageRoute.includes("'arenas-clubs.html'") &&
    !/clubs\/member\//.test(clubsPageRoute),
    clubsPageRoute);

  const populatedRows = browserRows;
  const populatedWeekBreakdown = browserBreakdowns.week;
  browserRows = browserRows.filter((item) => !item.isMe);
  browserBreakdowns.week = { total: 0, rows: [] };
  const emptyUi = await openBoard('week', 380, 'empty-viewer-period');
  check('zero-activity period renders honest personal-panel empty states without placeholder sport numbers',
    /No points yet this week\. Log an activity to see your sport breakdown\./.test(emptyUi.breakdownText) &&
    /Total this week0 pts/.test(emptyUi.breakdownText.replace(/\s+/g, ' ')) &&
    emptyUi.breakdownRows.length === 0 &&
    emptyUi.topSportsText.trim() === 'No sport shares yet this week.' &&
    emptyUi.topPercentages.length === 0,
    emptyUi);
  browserRows = populatedRows;
  browserBreakdowns.week = populatedWeekBreakdown;

  // An older slow request must not overwrite the newer selected period.
  routeDelays = { week: 250, month: 0 };
  await page.setViewportSize({ width: 380, height: 900 });
  await page.goto(BASE + '/leaderboards', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('.period-tab')].find((item) => item.textContent.trim() === 'This month');
    window.setPeriod('month', button);
  });
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
    raceState.total === '900 pts',
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
    console.log('Coverage: platform period/ranking rules, exact viewer totals/shares, five responsive screenshots and image bands, both club-card states, source/network scope guards, and manifest cleanup.');
    console.log('Constraint: this authenticated localhost integration verifier requires live Supabase service-role credentials and Playwright.');
    console.log(failures ? '\\n' + failures + ' FAILURE(S)' : '\\nALL CHECKS PASSED');
    process.exitCode = failures ? 1 : 0;
  }
})();