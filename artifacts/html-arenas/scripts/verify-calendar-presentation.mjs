#!/usr/bin/env node
// Pure unauthenticated browser harness. All app requests are fulfilled from
// local source/explicit test fixtures; non-GET requests fail closed. No server,
// cookies, Supabase client, seed manifest, or live writes are used.
// Run: node scripts/verify-calendar-presentation.mjs
// Screenshots + machine-readable contrast table: /tmp/calendar-presentation/
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { launchBrowser } from './lib/mobile-geometry.js';
import { calendarGeometry } from './lib/calendar-geometry.mjs';

const require = createRequire(import.meta.url);
const { SPORTS, SPORT_ICONS } = require('../sports.js');
const directory = fileURLToPath(new URL('../html/', import.meta.url));
const output = '/tmp/calendar-presentation';
mkdirSync(output, { recursive: true });
const day = '2026-09-14';
const title = 'Long training title with details Supercalifragilisticexpialidocious'.repeat(2);
const fixture = {
  month: '2026-09',
  activities: SPORTS.map((s, i) => ({
    id: `harness-activity-${s.id}`, sport: s.id, title: `${s.label}: ${title}`,
    date: `2026-09-${String(1 + i % 25).padStart(2, '0')}T12:00:00Z`,
    distance: '5.2 km', distanceKm: 5.2, duration: '00:48:00', durationMinutes: 48,
    notes: 'Read-only training notes. ' + title, feeling: 'great'
  })),
  plans: ['planned', 'done', 'skipped'].map((status, i) => ({
    id: `harness-plan-${status}`, sport: 'running', title: `${status}: ${title}`,
    date: `2026-09-${14 + i}`, planned_duration: '45m', status, notes: 'Session notes'
  })),
  events: ['going', 'none'].map((myStatus, i) => ({
    id: `harness-event-${myStatus}`, title: `${myStatus}: ${title}`, sport: 'cycling',
    date: `2026-09-${14 + i}T17:00:00Z`, myStatus, club_name: 'Long-distance community training club',
    location: 'Riverside park'
  })),
  stats: { sessions: SPORTS.length, hours: 16.4, distanceKm: 123.4, activeDays: 18, observedDays: 30, restDays: 12 }
};
// Guarantee the selected day contains all three sections, regardless of registry size.
fixture.activities.push({ ...fixture.activities[0], id: 'harness-selected', date: `${day}T12:00:00Z` });
const injected = `<script>
window.ARENAS_DATA=${JSON.stringify({ userId: 'harness', profile: { name: 'Calendar harness' }, clubs: [], gating: { proLocked: false } })};
window.ARENAS_SPORTS=${JSON.stringify(SPORTS)};
window.ARENAS_SPORT_ICONS=${JSON.stringify(SPORT_ICONS)};
window.ARENAS_SPORTS_BY_ID=Object.fromEntries(ARENAS_SPORTS.map(s=>[s.id,s]));
</script>`;
// Run the real server's pure navigation builder, not a copied mobile mock.
// Notifications/AI loaders are orthogonal authenticated integrations and are
// disabled here; the seeded guard exercises their production composition.
const serverSource = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const navigationSource = serverSource.slice(serverSource.indexOf('function bnItem('), serverSource.indexOf('// Avatar dropdown enhancement:'));
const injectorSource = serverSource.slice(serverSource.indexOf('function injectBottomNav('), serverSource.indexOf('// ── PRO BADGE'));
assert.ok(navigationSource.includes('function bottomNavFor(') && injectorSource.includes('return out;'), 'server navigation source anchors changed');
const html = vm.runInNewContext(`${navigationSource}\n${injectorSource}\ninjectBottomNav(template, 'calendar', {showAiFab:false})`, {
  template: readFileSync(path.join(directory, 'arenas-calendar.html'), 'utf8').replace('</head>', injected + '</head>'),
  injectAiInsightsLoaders: value => value,
  injectNotificationsPanel: value => value,
  MANAGED_CLUBS_MENU_SCRIPT: ''
});
const browser = await launchBrowser();
const errors = [], forbidden = [], contrast = [];
try {
  const context = await browser.newContext({ timezoneId: 'UTC', serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() !== 'GET') {
      forbidden.push(`${req.method()} ${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    // The only real requests allowed are the template's real font resources.
    if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.continue();
    if (url.hostname !== 'calendar-harness.invalid') {
      forbidden.push(req.url()); return route.abort('blockedbyclient');
    }
    if (url.pathname === '/html/calendar')
      return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/html/api/calendar/month')
      return route.fulfill({ json: fixture });
    const filename = path.basename(url.pathname);
    const local = path.join(directory, filename);
    const publicFile = fileURLToPath(new URL(`../public/${filename}`, import.meta.url));
    const source = existsSync(local) ? local : existsSync(publicFile) ? publicFile : null;
    if (source && /\.[a-z0-9]+$/i.test(filename)) {
      const types = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
      return route.fulfill({ contentType: types[path.extname(filename)] || 'application/octet-stream', body: readFileSync(source) });
    }
    forbidden.push(url.pathname);
    return route.fulfill({ status: 404, body: 'Unconfigured harness resource' });
  });
  for (const width of [360, 380, 414, 1280, 1440, 1920]) {
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => localStorage.setItem('arenas_calendar_view', 'month'));
    await page.goto('https://calendar-harness.invalid/html/calendar?_today=2026-09-14#2026-09');
    await page.waitForSelector('.cal-day');
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(async () => {
      await document.fonts.load('600 12px "Source Sans 3"');
      await document.fonts.load('500 11px "IBM Plex Mono"');
      return ['Source Sans 3', 'IBM Plex Mono'].every(family =>
        [...document.fonts].some(font => font.family.replace(/["']/g, '') === family && font.status === 'loaded'));
    }), 'real Source Sans 3 font must load; fallback fonts cannot prove contrast');
    let detail = await page.evaluate(calendarGeometry, { month: true, stats: true });
    assert.ok(detail.ok, `${width} month: ${JSON.stringify(detail)}`);
    await page.locator('#add-btn').click();
    assert.equal(await page.locator('#add-menu [role="menuitem"]').count(), 3);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#add-btn').getAttribute('aria-expanded'), 'false');
    // Collect actual rendered pill text, not synthetic color swatches.
    if (width === 1920) {
      contrast.push(...await page.evaluate(measureContrast));
    }
    await page.evaluate(d => window.openDayPanel(d), day);
    assert.equal(await page.locator('#dp-sheet').getAttribute('role'), width > 1024 ? 'complementary' : 'dialog');
    assert.equal(await page.locator('#dp-body textarea, #dp-body [contenteditable="true"]').count(), 0, 'activity notes are read-only');
    detail = await page.evaluate(calendarGeometry, { panel: true, month: true });
    assert.ok(detail.ok, `${width} populated: ${JSON.stringify(detail)}`);
    if ([360, 414, 1280, 1920].includes(width))
      await page.screenshot({ path: `${output}/${width}-month-panel.png`, fullPage: false });
    await page.locator('#dp-next').click();
    assert.match(await page.locator('#dp-title').innerText(), /15/);
    await page.locator('#dp-prev').click();
    assert.match(await page.locator('#dp-title').innerText(), /14/);
    await page.evaluate(() => window.openDayPanel('2026-09-30'));
    detail = await page.evaluate(calendarGeometry, { panel: true, empty: true });
    assert.ok(detail.ok, `${width} empty: ${JSON.stringify(detail)}`);
    await page.locator('#dp-body [data-cal-action="plan-new"]').click();
    assert.equal(await page.locator('#dpf-date').inputValue(), '2026-09-30');
    await page.locator('[data-cal-action="plan-cancel-form"]').click();
    await page.evaluate(() => window.closeDayPanel());
    for (const view of ['week', 'agenda']) {
      await page.locator(`#vt-${view}`).click();
      await page.waitForSelector('.ag-pills .cp');
      detail = await page.evaluate(calendarGeometry);
      assert.ok(detail.ok, `${width} ${view}: ${JSON.stringify(detail)}`);
      if ([360, 414, 1280, 1920].includes(width))
        await page.screenshot({ path: `${output}/${width}-${view}.png`, fullPage: false });
    }
    console.log(`PASS calendar ${width}: month, stats, populated/empty panel, week, agenda`);
    await page.close();
  }
  writeFileSync(`${output}/contrast.json`, JSON.stringify(contrast, null, 2) + '\n');
  console.table(contrast.map(row => ({
    state: row.text.match(/([\p{L}]+):/u)?.[1] || row.text.slice(0, 20),
    foreground: row.foreground, background: row.background,
    ratio: row.ratio.toFixed(3), font: row.font, size: row.size, weight: row.weight
  })));
  for (const s of SPORTS) assert.ok(contrast.some(r => r.text.includes(`${s.label}:`)), `missing rendered sport ${s.id}`);
  for (const state of ['planned', 'done', 'skipped', 'going', 'none'])
    assert.ok(contrast.some(r => r.text.includes(`${state}:`)), `missing rendered state ${state}`);
  assert.ok(contrast.length && contrast.every(r => r.ratio >= 4.5), 'every rendered pill text state must meet 4.5:1');
  assert.deepEqual(errors, [], 'browser errors');
  assert.deepEqual(forbidden, [], 'unexpected request or attempted write');
  console.log(`PASS ${contrast.length} rendered text contrasts ≥4.5; 12 screenshots at ${output}; zero live data writes`);
} finally {
  await browser.close();
}

function measureContrast() {
  const rgba = value => {
    const m = value.match(/[\d.]+/g);
    if (!m) throw new Error(`Unsupported computed color ${value}`);
    return [Number(m[0]), Number(m[1]), Number(m[2]), m[3] === undefined ? 1 : Number(m[3])];
  };
  const blend = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3]));
  const lum = rgb => rgb.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
    .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
  const results = [];
  for (const pill of document.querySelectorAll('.cp')) {
    if (!pill.getClientRects().length) continue;
    const walker = document.createTreeWalker(pill, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, el = node.parentElement;
      if (!/[\p{L}\p{N}]/u.test(node.textContent)) continue; // Emoji are not text contrast samples.
      const style = getComputedStyle(el);
      const ancestors = [];
      for (let a = el; a; a = a.parentElement) ancestors.unshift(a);
      let bg = [255, 255, 255];
      for (const a of ancestors) {
        const s = getComputedStyle(a);
        if (Number(s.opacity) !== 1 || s.backgroundImage !== 'none')
          throw new Error('Contrast requires explicit opaque states, not opacity/gradient approximation');
        bg = blend(rgba(s.backgroundColor), bg);
      }
      const fg = blend(rgba(style.color), bg);
      const a = lum(fg), b = lum(bg), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      const row = {
        text: pill.textContent.trim(), sample: node.textContent.trim(), foreground: style.color,
        background: bg.map(Math.round).join(','), ratio, font: style.fontFamily,
        size: style.fontSize, weight: style.fontWeight
      };
      if (!results.some(r => r.text === row.text && r.foreground === row.foreground && r.font === row.font && r.size === row.size)) results.push(row);
    }
  }
  return results;
}