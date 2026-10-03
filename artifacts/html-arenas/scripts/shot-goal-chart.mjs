#!/usr/bin/env node
// Seed-free presentation harness for the Stats-tab Goals vs actual + streak
// block. Real my-profile template (+ real bottom-nav injector), all /api
// requests fulfilled from fixtures; non-GET fail closed. Target home:
// scripts/shot-goal-chart.mjs. Env HTML_DIR overrides the html dir (prep runs).
// Output: /tmp/goal-chart-shots/*.png
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
const REPO = process.env.REPO || fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const { launchBrowser } = await import(path.join(REPO, 'scripts/lib/mobile-geometry.js'));
const { SPORTS, SPORT_ICONS } = require(path.join(REPO, 'sports.js'));
const dir = process.env.HTML_DIR || path.join(REPO, 'html');
const fallbackDir = path.join(REPO, 'html');
const out = '/tmp/goal-chart-shots';
mkdirSync(out, { recursive: true });

const g = (id, period, type, sport, target, progress, expected, extra = {}) => ({
  id, period, type, sport, target, progress, expectedProgress: expected,
  unit: type === 'distance' ? 'km' : type === 'duration' ? 'hours' : type === 'streak' ? 'days' : 'sessions',
  onTrack: progress >= expected, isComplete: progress >= target, ...extra
});
const dist = (o, unit) => ({ ...o, unit, targetKm: unit === 'mi' ? +(o.target * 1.609).toFixed(2) : o.target,
  progressKm: unit === 'mi' ? +(o.progress * 1.609).toFixed(2) : o.progress,
  expectedKm: unit === 'mi' ? +(o.expectedProgress * 1.609).toFixed(2) : o.expectedProgress });
const populated = [
  g('w1', 'weekly', 'frequency', 'weightlifting', 4, 1, 2.3),
  g('w2', 'weekly', 'frequency', 'cycling', 4, 3, 2.3),
  g('w3', 'weekly', 'frequency', 'running', 5, 4, 2.9),
  g('w4', 'weekly', 'frequency', null, 3, 2, 1.7),
  g('w5', 'weekly', 'duration', 'running', 5, 3.5, 2.9),
  dist(g('w6', 'weekly', 'distance', 'running', 20, 12.4, 11.4), 'km'),
  dist(g('w7', 'weekly', 'distance', 'running', 10, 6, 5.7), 'mi'),
  g('m1', 'monthly', 'frequency', 'cycling', 16, 12, 9),
  g('m2', 'monthly', 'frequency', 'running', 20, 14, 11),
  g('m3', 'monthly', 'duration', null, 30, 18.5, 16.9),
  g('c1', 'custom', 'frequency', 'swimming', 12, 5, 6, { endDate: '2026-05-30' }),
  g('s1', 'weekly', 'streak', null, 7, 4, 4),
  g('s2', 'monthly', 'streak', 'running', 10, 2, 5)
];
const five = ['weightlifting', 'cycling', 'running', 'swimming', null].map((s, i) =>
  g('f' + i, 'weekly', 'frequency', s, [12, 16, 20, 8, 10][i], [2, 12, 14, 5, 10][i], 8));
const week = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((w, i) => ({
  date: `2026-04-${String(14 + i).padStart(2, '0')}`, weekday: w, active: i < 4, isToday: i === 4, isFuture: i > 4 }));
const stats = {
  hero: { activities: 42, totalKm: 318.4, totalHours: 47.2, totalPoints: 1874 }, prs: [],
  streaks: { current: 4, longest: 12, avgPerWeek: 3.4 }, weekStrip: week,
  sportBreakdown: [], weeklyChart: Array.from({ length: 12 }, (_, i) => ({ label: `${i+1}Feb`, hours: 3 + (i % 4), bySport: [{ sport: 'running', hours: 3 + (i % 4) }] }))
};
const variants = {
  populated: { goals: populated, stats },
  empty: { goals: [], stats: { ...stats, streaks: { current: 0, longest: 12, avgPerWeek: 3.4 }, weekStrip: week.map(d => ({ ...d, active: false })) } },
  groups5: { goals: five, stats },   // weekly-only
  customOnly: { goals: [populated[10]], stats },
  streakOnly: { goals: [populated[11]], stats },
  scopedOnly: { goals: [populated[12]], stats }   // only a Running streak goal
};
// Expected panels: This week + This month persist whenever any bar goal
// exists (empty one shows honest copy, no tabs/bars); Custom only with goals.
const expectPanels = {
  populated: { periods: ['weekly', 'monthly', 'custom'], empty: [] },
  groups5: { periods: ['weekly', 'monthly'], empty: ['monthly'] },
  customOnly: { periods: ['weekly', 'monthly', 'custom'], empty: ['weekly', 'monthly'] },
  empty: { periods: [], empty: [], cta: true },
  streakOnly: { periods: [], empty: [], cta: true },
  scopedOnly: { periods: [], empty: [], cta: true }
};
const widthsFor = { groups5: [360], customOnly: [360, 1280], streakOnly: [360], scopedOnly: [360, 1280] };
// Current-tile streak goal association (null = no tile goal expected).
const expectTile = {
  populated: { id: 's1', sport: null, rows: ['s2'] },
  streakOnly: { id: 's1', sport: null, rows: [] },
  scopedOnly: { id: 's2', sport: 'running', scoped: 'Running: 2 days', target: 'Goal: 10 days', rows: [] }
};

const server = readFileSync(path.join(REPO, 'server.js'), 'utf8');
const navSrc = server.slice(server.indexOf('function bnItem('), server.indexOf('// Avatar dropdown enhancement:'));
const injSrc = server.slice(server.indexOf('function injectBottomNav('), server.indexOf('// ── PRO BADGE'));
const injected = `<script>
window.ARENAS_DATA=${JSON.stringify({ userId: 'harness', profile: { name: 'Goal harness' }, clubs: [], gating: { proLocked: false } })};
window.ARENAS_SPORTS=${JSON.stringify(SPORTS)};window.ARENAS_SPORT_ICONS=${JSON.stringify(SPORT_ICONS)};
window.ARENAS_SPORTS_BY_ID=Object.fromEntries(ARENAS_SPORTS.map(s=>[s.id,s]));</script>`;
const tpl = readFileSync(path.join(dir, 'arenas-my-profile.html'), 'utf8').replace('</head>', injected + '</head>');
const html = vm.runInNewContext(`${navSrc}\n${injSrc}\ninjectBottomNav(template,'profile',{showAiFab:false})`,
  { template: tpl, injectAiInsightsLoaders: v => v, injectNotificationsPanel: v => v, MANAGED_CLUBS_MENU_SCRIPT: '' });

// Emoji glyphs: point fontconfig at a cached Noto Color Emoji (nix store) via
// a /tmp config so headless Chromium renders real emoji. No app dependency.
if (!process.env.FONTCONFIG_FILE) {
  const { readdirSync, writeFileSync, mkdirSync } = await import('node:fs');
  const emojiDir = ['/nix/store', '/repl/tools'].flatMap(root => { try { return readdirSync(root).filter(d => /noto-fonts-(color-)?emoji/.test(d)).map(d => path.join(root, d, 'share/fonts/noto')); } catch { return []; } }).find(d => existsSync(path.join(d, 'NotoColorEmoji.ttf')));
  if (emojiDir) {
    mkdirSync('/tmp/goal-harness-fc/cache', { recursive: true });
    writeFileSync('/tmp/goal-harness-fc/fonts.conf', `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><include ignore_missing="yes">/etc/fonts/fonts.conf</include><dir>${emojiDir}</dir><cachedir>/tmp/goal-harness-fc/cache</cachedir></fontconfig>`);
    process.env.FONTCONFIG_FILE = '/tmp/goal-harness-fc/fonts.conf';
  } else console.warn('No cached Noto Color Emoji found — emoji may render as boxes');
}
const browser = await launchBrowser();
const errors = [], forbidden = [], report = [];
try {
  for (const [name, v] of Object.entries(variants)) {
    const widths = widthsFor[name] || [360, 414, 1280, 1920];
    for (const width of widths) {
      const ctx = await browser.newContext({ timezoneId: 'UTC', serviceWorkers: 'block', viewport: { width, height: 1000 } });
      await ctx.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (req.method() !== 'GET') { forbidden.push(req.method() + ' ' + url.pathname); return route.abort('blockedbyclient'); }
        if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.continue();
        if (url.hostname !== 'goal-harness.invalid') return route.abort('blockedbyclient');
        if (url.pathname === '/html/profile') return route.fulfill({ contentType: 'text/html', body: html });
        if (url.pathname === '/html/api/goals') return route.fulfill({ json: { active: v.goals, completed: [] } });
        if (url.pathname === '/html/api/profile/stats') return route.fulfill({ json: v.stats });
        if (url.pathname.startsWith('/html/api/')) return route.fulfill({ json: {} });
        const f = path.basename(url.pathname);
        const src = [path.join(dir, f), path.join(fallbackDir, f), path.join(REPO, 'public', f)].find(existsSync);
        if (src && /\.[a-z0-9]+$/i.test(f)) {
          const t = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
          return route.fulfill({ contentType: t[path.extname(f)] || 'application/octet-stream', body: readFileSync(src) });
        }
        return route.fulfill({ status: 404, body: '' });
      });
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push(`${name}@${width}: ${e.message}`));
      await page.goto('https://goal-harness.invalid/html/profile#stats');
      await page.evaluate(() => { setTab('stats'); document.getElementById('htab-stats').click(); });
      await page.waitForSelector('#gvw-streak', { timeout: 8000 }).catch(async e => { console.log(await page.evaluate(() => document.getElementById('sp-stats-body').innerText.slice(0,300)), errors); throw e; });
      await page.evaluate(() => document.fonts.ready);
      const hasChart = !expectPanels[name].cta;
      if (hasChart) await page.waitForSelector('.gc-svg');
      const geo = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const over = [...document.querySelectorAll('#gvw-card *, #gvw-streak *')].filter(e => e.getBoundingClientRect().right > vw + 0.5).length;
        const overlaps = [];
        document.querySelectorAll('.gc-svg').forEach(svg => {
          const r = [...svg.querySelectorAll('.gc-value, .gc-label, .gc-status, .gc-expected')].map(e => e.getBoundingClientRect());
          for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
            const a = r[i], b = r[j];
            if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlaps.push(i + ':' + j);
          }
        });
        return { over, overlaps: overlaps.length, panels: document.querySelectorAll('.gvw-panel').length,
          cta: !!document.querySelector('.gvw-empty-cta'), days: document.querySelectorAll('.gvw-day').length };
      });
      report.push({ name, width, ...geo });
      assert.equal(geo.over, 0, `${name}@${width} horizontal overflow`);
      assert.equal(geo.days, 7);
      assert.equal(geo.overlaps, 0, `${name}@${width} chart text overlap`);
      const exp = expectPanels[name];
      const pp = await page.evaluate(() => [...document.querySelectorAll('.gvw-panel')].map(p => ({
        period: p.dataset.period, empty: p.classList.contains('gvw-panel-empty'),
        tabs: p.querySelectorAll('.gvw-tab').length, bars: p.querySelectorAll('.gc-bar').length,
        text: p.querySelector('.gvw-panel-none')?.textContent || '' })));
      assert.deepEqual(pp.map(p => p.period), exp.periods, `${name} panels`);
      assert.deepEqual(pp.filter(p => p.empty).map(p => p.period), exp.empty, `${name} empty panels`);
      pp.filter(p => p.empty).forEach(p => {
        assert.equal(p.tabs, 0); assert.equal(p.bars, 0);
        assert.equal(p.text, `No ${p.period} goals yet`);
      });
      pp.filter(p => !p.empty).forEach(p => assert.ok(p.tabs > 0 && p.bars > 0, `${name} ${p.period} has chart`));
      assert.equal(geo.cta, !!exp.cta, `${name} CTA`);
      const tile = await page.evaluate(() => {
        const t = document.querySelector('.gvw-tile.cur .gvw-tile-goal');
        return { id: t?.dataset.goalId || null, sport: t?.dataset.sport || null, text: t?.textContent || '',
          rows: [...document.querySelectorAll('.gvw-sgoal')].map(r => r.dataset.goalId),
          kmNoExpected: window.__gvw.spec([{ id: 'x', type: 'distance', sport: 'running', unit: 'km', target: 5, progress: 1, targetKm: 5, progressKm: 1 }], 'distance').missing.length };
      });
      assert.equal(tile.kmNoExpected, 1, 'expectedKm required');
      const et = expectTile[name];
      if (et) {
        assert.equal(tile.id, et.id, `${name} tile goal`);
        assert.equal(tile.sport, et.sport, `${name} tile sport`);
        assert.deepEqual(tile.rows, et.rows, `${name} separate rows`);
        if (et.scoped) { assert.ok(tile.text.includes(et.scoped), tile.text); assert.ok(tile.text.includes(et.target), tile.text); }
        else assert.ok(/^Goal: \d+ days · /.test(tile.text), tile.text);
      } else assert.equal(tile.id, null, `${name} no tile goal`);
      // Streak: calendar link, data-active, pace-only goal status.
      const sk = await page.evaluate(() => ({
        href: document.querySelector('#gvw-streak a.gvw-streak-now')?.getAttribute('href'),
        active: [...document.querySelectorAll('.gvw-day')].map(d => d.getAttribute('data-active')),
        tile: document.querySelector('.gvw-tile-goal')?.textContent || '',
        missing: window.__gvw.spec([{ id: 'm', type: 'distance', sport: 'running', unit: 'km', target: 5, progress: 1 }], 'distance').missing.length,
        mutable: typeof (window.__gvw || {}).setGoals
      }));
      assert.equal(sk.href, '/html/calendar');
      assert.ok(sk.active.every(a => a === '1' || a === '0' || a === 'true'));
      assert.ok(!/Done/.test(sk.tile), 'streak tile must show pace only');
      assert.equal(sk.missing, 1, 'missing km must surface, not drop');
      assert.equal(sk.mutable, 'undefined');
      if (hasChart) {
        // Keyboard: Tab-focusable pair shows its summary; tap/click too.
        const kb = await page.evaluate(() => {
          const g = document.querySelector('.gc-group');
          g.focus();
          const host = g.closest('.gvw-chart');
          const focused = document.activeElement === g, tip1 = host.querySelector('.gvw-tip').textContent;
          host.querySelector('.gvw-tip').textContent = '';
          const g2 = host.querySelectorAll('.gc-group')[1] || g;
          g2.querySelector('.gc-bar').dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return { focused, tab: g.getAttribute('tabindex'), aria: g.getAttribute('aria-label'), tip1, tip2: host.querySelector('.gvw-tip').textContent };
        });
        assert.ok(kb.focused && kb.tab === '0', 'bar pair focusable');
        assert.ok(kb.tip1 && kb.tip1 === kb.aria && /Goal:/.test(kb.tip1), 'focus tooltip');
        assert.ok(/Actual:/.test(kb.tip2), 'tap tooltip');
        await page.evaluate(() => { document.activeElement.blur(); document.querySelectorAll('.gvw-tip').forEach(t => { t.textContent = ''; }); });
      }
      await page.locator('#gvw-card').scrollIntoViewIfNeeded().catch(() => {});
      const box = await page.evaluate(() => { const a = document.getElementById('gvw-card') || document.getElementById('gvw-streak'); const b = document.getElementById('gvw-streak');
        const t = a.getBoundingClientRect().top + scrollY, e = b.getBoundingClientRect().bottom + scrollY; return { t, e }; });
      await page.setViewportSize({ width, height: Math.ceil(box.e + 120) });
      await page.screenshot({ path: `${out}/${name}-${width}.png`, fullPage: true, clip: { x: 0, y: Math.max(0, box.t - 12), width, height: Math.ceil(box.e - box.t + 24) } });
      if (await page.locator('.gvw-empty-cta').count()) {
        const loaded = page.waitForResponse(r => r.url().endsWith('/api/goals') && r.request().method() === 'GET');
        await page.locator('.gvw-empty-cta').click();
        await loaded;
        await page.waitForFunction(() => !document.getElementById('goals-body').textContent.includes('Loading goals'));
        assert.ok(await page.locator('#tab-goals').isVisible(), 'CTA opens and loads Goals tab');
      }
      await ctx.close();
    }
  }
} finally { await browser.close(); }
console.table(report);
assert.deepEqual(errors, [], errors.join('\n'));
assert.deepEqual(forbidden, []);
console.log('screens ->', out);
