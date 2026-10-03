// Seed-free screenshot harness for the Stats & PRs redesign.
//
// Serves the REAL html/ template and shared modules from disk on a local
// port, injects window.ARENAS_DATA the same way server.js injectArenasData
// does, plus the sports registry from sports.js, and answers /api/* GETs
// from deterministic fixtures (scripts/lib/stats-fixtures.mjs). No database,
// no auth, no server.js. Any non-GET request is aborted and fails the run.
//
// Usage: node scripts/shot-stats-redesign.mjs [outDir]
//   → <outDir>/stats-<period>-<width>.png for 12w/all × 360/414/1280/1920
// Env: PERIODS=12w,all  WIDTHS=360,414,1280,1920
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { launchBrowser } from './lib/mobile-geometry.js';
import vm from 'node:vm';
import { statsFixture, goalsFixture } from './lib/stats-fixtures.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, 'html');
const OUT = process.argv[2] || path.join(ROOT, 'screenshots', 'stats-redesign');
const PERIODS = (process.env.PERIODS || '12w,all').split(',');
const WIDTHS = (process.env.WIDTHS || '360,414,1280,1920').split(',').map(Number);
fs.mkdirSync(OUT, { recursive: true });

// sports.js lives in the artifact root (workspace); fall back if the staged
// tree only mirrors html/ and scripts/.
const sportsPath = [path.join(ROOT, 'sports.js'), path.join(process.cwd(), 'sports.js'), '/home/runner/workspace/artifacts/html-arenas/sports.js']
  .find((p) => fs.existsSync(p));
const { SPORTS, SPORT_ICONS } = require(sportsPath);
const GOALS = process.env.GOALS || 'populated'; // populated | empty

// Emoji glyphs: same /tmp fontconfig setup as shot-goal-chart.mjs (cached
// Noto Color Emoji from the nix store). Must be set before Chromium launches.
if (!process.env.FONTCONFIG_FILE) {
  const emojiDir = ['/nix/store', '/repl/tools'].flatMap((root) => { try { return fs.readdirSync(root).filter((d) => /noto-fonts-(color-)?emoji/.test(d)).map((d) => path.join(root, d, 'share/fonts/noto')); } catch { return []; } })
    .find((d) => fs.existsSync(path.join(d, 'NotoColorEmoji.ttf')));
  if (emojiDir) {
    fs.mkdirSync('/tmp/goal-harness-fc/cache', { recursive: true });
    fs.writeFileSync('/tmp/goal-harness-fc/fonts.conf', `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><include ignore_missing="yes">/etc/fonts/fonts.conf</include><dir>${emojiDir}</dir><cachedir>/tmp/goal-harness-fc/cache</cachedir></fontconfig>`);
    process.env.FONTCONFIG_FILE = '/tmp/goal-harness-fc/fonts.conf';
  } else console.warn('No cached Noto Color Emoji found — emoji may render as boxes');
}

// Real bottom nav: evaluate server.js's own bnItem…/injectBottomNav source in
// a sandbox (read-only text slice, server never runs) — same as shot-goal-chart.
const serverPath = [path.join(ROOT, 'server.js'), '/home/runner/workspace/artifacts/html-arenas/server.js'].find((p) => fs.existsSync(p));
const serverSrc = fs.readFileSync(serverPath, 'utf8');
const navSrc = serverSrc.slice(serverSrc.indexOf('function bnItem('), serverSrc.indexOf('// Avatar dropdown enhancement:'));
const injSrc = serverSrc.slice(serverSrc.indexOf('function injectBottomNav('), serverSrc.indexOf('// ── PRO BADGE'));

const DATA = {
  profile: { name: 'Rhea Okafor', handle: 'rhea.rides', bio: 'Commuter turned century rider. Tuesday track sessions, Sunday long ones.', location: 'Bristol', sports: ['cycling', 'running'], avatar_url: null, banner_url: null, timezone: 'Europe/London', timezoneSource: 'auto' },
  prefs: {}, countries: [], usStates: [], timezones: ['Europe/London'],
  userId: '00000000-0000-4000-8000-000000000001', email: 'rhea@example.test', memberSince: '2023-05-08T09:00:00Z',
  postCount: 12, activityCount: 418, kmLogged: 9312, followerCount: 87, followingCount: 64,
  posts: [], activitySports: ['cycling', 'running', 'weightlifting', 'yoga', 'swimming'], clubs: [], followingList: [], followerList: [],
  tabUnseen: {}, gating: { proLocked: false, aiInsightsPro: true }
};

function inject(html) {
  const reg = `<script>window.ARENAS_SPORTS=${JSON.stringify(SPORTS)};window.ARENAS_SPORT_ICONS=${JSON.stringify(SPORT_ICONS || {})};window.ARENAS_SPORTS_BY_ID={};window.ARENAS_SPORTS.forEach(function(s){window.ARENAS_SPORTS_BY_ID[s.id]=s;});window.arenasSportName=function(id){var s=window.ARENAS_SPORTS_BY_ID[id];return s?s.label:String(id||'');};</script>`;
  const json = JSON.stringify(DATA).replace(/</g, '\\u003c');
  const tpl = html.replace('</head>', `${reg}<script>window.ARENAS_DATA = ${json};</script></head>`);
  return vm.runInNewContext(`${navSrc}\n${injSrc}\ninjectBottomNav(template,'profile',{showAiFab:false})`,
    { template: tpl, injectAiInsightsLoaders: (v) => v, injectNotificationsPanel: (v) => v, MANAGED_CLUBS_MENU_SCRIPT: '' });
}

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/html/profile') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(inject(fs.readFileSync(path.join(HTML, 'arenas-my-profile.html'), 'utf8')));
  }
  const rel = u.pathname.replace(/^\/html\//, '');
  const file = path.join(HTML, rel);
  if (file.startsWith(HTML) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    return res.end(fs.readFileSync(file));
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const results = [];
const browser = await launchBrowser();
try {
  for (const period of PERIODS) {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      await ctx.addInitScript((p) => { try { localStorage.setItem('arenas_stats_period', p); } catch (e) {} }, period);
      const page = await ctx.newPage();
      const errors = [];
      const writes = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
      await page.route('**/*', (route) => {
        const req = route.request();
        const url = new URL(req.url());
        if (req.method() !== 'GET') { writes.push(req.method() + ' ' + url.pathname); return route.abort(); }
        if (url.origin !== BASE) return route.abort(); // fonts / third parties: offline
        if (url.pathname.startsWith('/html/api/') || url.pathname.startsWith('/api/')) {
          const p = url.pathname.replace(/^\/html/, '');
          let body = {};
          if (p === '/api/profile/stats') { const per = url.searchParams.get('period') || '12w'; body = statsFixture(per, { emptyWeeks: per === 'all' }); }
          else if (p === '/api/goals') body = { active: goalsFixture(GOALS), completed: [] };
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        }
        return route.continue();
      });
      await page.goto(`${BASE}/html/profile#stats`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#sp-weekly-chart .wk-chart', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(500);
      const m = await page.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const kpis = [...document.querySelectorAll('.sp-kpi')].map((e) => e.getBoundingClientRect());
        const rows = new Set(kpis.map((r) => Math.round(r.top))).size;
        const cols = new Set(kpis.map((r) => Math.round(r.left))).size;
        const sportRow = q('#sp-sport-row');
        const stacked = sportRow ? getComputedStyle(sportRow).gridTemplateColumns.split(' ').length === 1 : null;
        const sc = q('#sp-weekly-chart .wk-scroll');
        const last = q('#sp-weekly-chart .wk-col:last-child');
        const scr = sc ? sc.getBoundingClientRect() : null;
        const lr = last ? last.getBoundingClientRect() : null;
        return {
          bars: document.querySelectorAll('#sp-weekly-chart .wk-col').length,
          values: document.querySelectorAll('#sp-weekly-chart .wk-val').length,
          nonZero: [...document.querySelectorAll('#sp-weekly-chart .wk-col')].filter((c) => !c.querySelector('.wk-zero')).length,
          scrolls: !!sc,
          lastVisible: !!lr && (!scr || (lr.right <= scr.right + 1 && lr.left >= scr.left - 1)),
          valueOverlap: (() => { const r = [...document.querySelectorAll('#sp-weekly-chart .wk-val')].map((e) => e.getBoundingClientRect()); let o = 0; for (let i = 1; i < r.length; i++) if (r[i].left < r[i - 1].right - 0.5) o++; return o; })(),
          goalPanels: document.querySelectorAll('#gvw-card .gvw-panel').length,
          nav: !!q('.bottom-nav'),
          partial: !!q('.wk-partial'),
          lastAxis: (document.querySelector('.wk-col:last-child .wk-axis') || {}).textContent,
          cap: !!q('#sp-weekly-cap'),
          kpiGrid: rows + 'x' + cols,
          stacked,
          deltaLines: document.querySelectorAll('.sp-kpi-delta').length,
          docOverflowX: document.documentElement.scrollWidth - window.innerWidth,
          // Stats-tab spill only (the shell chrome is server-injected and out
          // of scope for this harness): any #tab-stats element past the edge.
          statsOverflow: [...document.querySelectorAll('#tab-stats *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > window.innerWidth + 1; }).slice(0, 4).map((e) => e.tagName + '.' + String(e.className.baseVal ?? e.className).split(' ')[0] + '#' + e.id + '@' + Math.round(e.getBoundingClientRect().right)),
          order: [...document.querySelectorAll('#sp-stats-body > *')].map((e) => e.id || e.className.split(' ')[0])
        };
      });
      // Page-logic checks (real page functions): PR fill order + window label.
      const logic = await page.evaluate((fx) => {
        const o = window.__spStats.orderPrs(fx.prs);
        return {
          primary: o.primary.map((p) => p.label), more: o.more.map((p) => p.label),
          win: window.__spStats.windowLabel({ start: '2025-12-29', end: '2026-03-19', days: 80 }),
          prsVisible: [...document.querySelectorAll('#sp-prs .sp-pr')].filter((e) => e.offsetParent).length
        };
      }, statsFixture('12w', { noCycling: true }));
      const logicOk = JSON.stringify(logic.primary) === '["Longest activity","Biggest week","Biggest month","Longest run"]'
        && JSON.stringify(logic.more) === '["Fastest pace · run"]' && logic.win === '29 Dec 2025 – 18 Mar 2026 · 80 days' && logic.prsVisible === 4;
      if (!logicOk) errors.push('page logic: ' + JSON.stringify(logic));
      // Full-page captures stitch position:fixed chrome into the page: the
      // shared .toast (parked off-viewport via translateY when idle) shows up
      // as a dark pill mid-page. Confirm it is idle/off-screen in the live
      // viewport, then hide it for the capture only.
      const toastIdle = await page.evaluate(() => [...document.querySelectorAll('.toast')].every((t) => !t.textContent.trim() || t.getBoundingClientRect().top >= window.innerHeight));
      if (!toastIdle) errors.push('toast visible in viewport');
      await page.addStyleTag({ content: '.toast{visibility:hidden!important}' });
      const file = path.join(OUT, `stats-${period}-${width}.png`);
      await page.screenshot({ path: file, fullPage: true });
      if (process.env.CLIP) { await page.evaluate(() => document.getElementById('sp-kpis') || document.querySelector('.sp-kpis').scrollIntoView()); await page.screenshot({ path: file.replace('.png', '-view.png') }); }
      const ok = errors.length === 0 && writes.length === 0 && m.bars > 0 && m.docOverflowX <= 0
        && m.values === m.bars && m.valueOverlap === 0 && m.lastVisible && m.statsOverflow.length === 0
        && (GOALS === 'empty' || m.goalPanels > 0);
      if (!ok) failures++;
      results.push({ period, width, ok, ...m, errors: errors.slice(0, 3), writes });
      console.log((ok ? '  ok  ' : 'FAIL  ') + `${period}@${width}`, JSON.stringify({ ...m, errors: errors.slice(0, 2), writes }));
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
console.log(failures ? failures + ' FAILURE(S)' : 'ALL PASS', '→', OUT);
process.exit(failures ? 1 : 0);
