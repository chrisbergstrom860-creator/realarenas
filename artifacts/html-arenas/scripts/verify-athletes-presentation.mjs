#!/usr/bin/env node
// Seed-free real-template proof for the Athletes directory. No server,
// credentials, cookies, seeds or data writes: the real arenas-athletes.html is
// rendered with the real server presentation builders + synthetic fixtures.
// Follow clicks are answered in-process (never reach a backend).
// Run: node scripts/verify-athletes-presentation.mjs [--inspect]
// Output (screenshots, report.json, contrast.json): /tmp/athletes-presentation
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, symlinkSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { athletesFixtures, athletesGeometryExpr, ATHLETES_SELECTORS as S } from './lib/athletes-geometry.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const output = '/tmp/athletes-presentation';
const origin = 'https://athletes-harness.invalid';
const inspect = process.argv.includes('--inspect');
const require = createRequire(import.meta.url);
const { SPORTS, SPORT_ICONS, LEGACY_SPORT_EMOJI } = require('../sports.js');
mkdirSync(output, { recursive: true });

// Colour emoji: point fontconfig at the already-present NotoColorEmoji via
// XDG_DATA_HOME (no installation). Must be set before Chromium launches.
const emojiCandidates = [process.env.ATHLETES_EMOJI_FONT,
  '/nix/store/czq26chhiy12hp7ghpxg2f04li9pni9s-noto-fonts-emoji-2.038/share/fonts/noto/NotoColorEmoji.ttf',
  '/repl/tools/aqcjxx6j9yq175dar0x60qb1kdzvrm9z-noto-fonts-color-emoji-2.051/share/fonts/noto/NotoColorEmoji.ttf'].filter(Boolean);
const emojiFont = emojiCandidates.find(f => existsSync(f));
if (emojiFont) {
  const xdg = path.join(output, 'xdg'), fonts = path.join(xdg, 'fonts');
  rmSync(xdg, { recursive: true, force: true }); mkdirSync(fonts, { recursive: true });
  symlinkSync(emojiFont, path.join(fonts, 'NotoColorEmoji.ttf'));
  process.env.XDG_DATA_HOME = xdg;
}
const { launchBrowser } = await import('./lib/mobile-geometry.js');

const server = readFileSync(path.join(root, 'server.js'), 'utf8');
function constant(name) {
  const match = server.match(new RegExp(`const ${name} = (\`[\\s\\S]*?\`);`));
  assert.ok(match, `Real ${name} source anchor changed`);
  return vm.runInNewContext(match[1], { SPORTS, SPORT_ICONS, LEGACY_SPORT_EMOJI });
}
const navStart = server.indexOf('function bnItem('), navEnd = server.indexOf('// Avatar dropdown enhancement:', navStart);
const injectStart = server.indexOf('function injectBottomNav('), injectEnd = server.indexOf('// ── PRO BADGE', injectStart);
assert.ok(navStart >= 0 && navEnd > navStart && injectStart >= 0 && injectEnd > injectStart, 'Real navigation anchors changed');
const manifest = JSON.parse(readFileSync(path.join(root, 'html/landing-assets/manifest.json'), 'utf8')).assets;
const bannerUrl = '/html/landing-assets/' + manifest['for-clubs-collage-800.webp'].file;
const registry = SPORTS.map(s => s.id);

function buildPage(total) {
  const fx = athletesFixtures({ registry, bannerUrl, total });
  const data = { userId: 'athletes-presentation-viewer', profile: { name: 'Harness Viewer', avatar_url: null },
    clubs: [], followingIds: fx.athletes.filter(a => a.isFollowing).map(a => a.id), ...fx };
  let html = readFileSync(path.join(root, 'html/arenas-athletes.html'), 'utf8');
  html = html.replace('</head>', `<script>window.ARENAS_DATA=${JSON.stringify(data).replace(/</g, '\\u003c')};</script>${constant('AVATAR_HELPERS_SCRIPT')}</head>`);
  html = html.replace('</body>', constant('TOPBAR_IDENTITY_SCRIPT') + constant('AVATAR_MENU_SCRIPT') + '</body>');
  return vm.runInNewContext(`${server.slice(navStart, navEnd)}\n${server.slice(injectStart, injectEnd)}\ninjectBottomNav(template, 'athletes', {showAiFab:false})`, {
    template: html, injectAiInsightsLoaders: v => v, injectNotificationsPanel: v => v, MANAGED_CLUBS_MENU_SCRIPT: ''
  });
}
const pages = { '/html/athletes': buildPage(), '/html/athletes-capped': buildPage(71) };

const fontDirectories = [process.env.ATHLETES_PRESENTATION_FONT_DIR, process.env.LOG_PRESENTATION_FONT_DIR,
  path.join(root, 'html/fonts'), '/tmp/arenas-fonts'].filter(Boolean);
const fontDirectory = fontDirectories.find(d => existsSync(d) && readdirSync(d).some(f => f.endsWith('.css')));
const fontCSS = fontDirectory ? readdirSync(fontDirectory).filter(f => f.endsWith('.css')).map(f =>
  readFileSync(path.join(fontDirectory, f), 'utf8').replace(/url\((['"]?)(?!https?:|data:)([^'")]+)\1\)/g,
    (_, q, u) => `url("/__fonts/${u}")`)).join('\n') : null;
const report = { seedFree: true, fixtureAthletes: 13, emojiFont: emojiFont || null,
  fontSource: fontDirectory || 'real Google Fonts resources', checks: [], screenshots: [], contrast: [],
  geometry: [], browserErrors: [], forbiddenRequests: [], mockedFollow: [], bannerRequests: [], missingResources: [] };
async function check(name, fn) {
  try { const d = await fn(); report.checks.push({ name, ok: true, ...(d === undefined ? {} : { detail: d }) }); }
  catch (e) { report.checks.push({ name, ok: false, error: e.message }); }
}
const types = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.avif': 'image/avif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

const browser = await launchBrowser();
try {
  const context = await browser.newContext({ timezoneId: 'UTC', serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === origin && /^\/html\/api\/follow\//.test(url.pathname) && ['POST', 'DELETE'].includes(req.method())) {
      report.mockedFollow.push(`${req.method()} ${url.pathname}`); // in-process; no backend exists
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ following: req.method() === 'POST' }) });
    }
    if (req.method() !== 'GET') { report.forbiddenRequests.push(`${req.method()} ${req.url()}`); return route.abort('blockedbyclient'); }
    if (url.hostname === 'fonts.googleapis.com' && fontCSS) return route.fulfill({ contentType: 'text/css', body: fontCSS });
    if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.continue();
    if (url.origin !== origin) { report.forbiddenRequests.push(req.url()); return route.abort('blockedbyclient'); }
    if (pages[url.pathname]) return route.fulfill({ contentType: 'text/html', body: pages[url.pathname] });
    if (url.pathname === '/html/api/notifications') return route.fulfill({ contentType: 'application/json', body: '{"unreadCount":0}' });
    if (url.pathname.startsWith('/html/__fixture/')) { report.bannerRequests.push(url.pathname); return route.fulfill({ status: 404, body: '' }); }
    if (url.pathname.endsWith(manifest['for-clubs-collage-800.webp'].file)) report.bannerRequests.push(url.pathname);
    const relative = decodeURIComponent(url.pathname.replace(/^\/html\//, ''));
    const candidates = url.pathname.startsWith('/__fonts/') && fontDirectory
      ? [path.resolve(fontDirectory, decodeURIComponent(url.pathname.slice(9)))]
      : [path.resolve(root, 'html', relative), path.resolve(root, 'public', relative)];
    const local = candidates.find(f => (f.startsWith(root + path.sep) || (fontDirectory && f.startsWith(path.resolve(fontDirectory) + path.sep))) && existsSync(f));
    if (local) return route.fulfill({ contentType: types[path.extname(local)] || 'application/octet-stream', body: readFileSync(local) });
    report.missingResources.push(url.pathname);
    return route.fulfill({ status: 404, body: 'Unconfigured local presentation resource' });
  });

  for (const width of [360, 414, 1280, 1920]) {
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    page.on('pageerror', e => report.browserErrors.push(`${width}: ${e.message}`));
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${origin}/html/athletes`, { waitUntil: 'networkidle' });
    await page.waitForSelector(S.card);
    await page.evaluate(() => document.fonts.ready);
    await check(`${width}: actual fonts + colour emoji`, async () => {
      const r = await page.evaluate(async () => {
        await document.fonts.load('600 14px "Source Sans 3"'); await document.fonts.load('500 12px "IBM Plex Mono"');
        const fams = ['Source Sans 3', 'IBM Plex Mono'].every(f => [...document.fonts].some(x => x.family.replace(/["']/g, '') === f && x.status === 'loaded'));
        const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
        g.font = '24px sans-serif'; g.fillText('🏃', 2, 26);
        const d = g.getImageData(0, 0, 32, 32).data; let colour = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && (Math.abs(d[i] - d[i + 1]) > 30 || Math.abs(d[i + 1] - d[i + 2]) > 30)) colour++;
        return { fams, colour };
      });
      assert.ok(r.fams, 'Genuine Source Sans 3 and IBM Plex Mono required');
      assert.ok(r.colour > 20, 'NotoColorEmoji not rendering colour glyphs');
      return r;
    });
    await check(`${width}: hero copy, centred, mobile source first`, async () => {
      const h = await page.evaluate(() => {
        const hero = document.querySelector('.athletes-hero'), img = hero.querySelector('img');
        return { eyebrow: hero.querySelector('.athletes-hero-eyebrow').textContent, h1: hero.querySelector('h1').textContent,
          sub: hero.querySelector('.athletes-hero-sub').textContent, align: getComputedStyle(hero.querySelector('.athletes-hero-text')).textAlign,
          src: img.currentSrc.split('/').pop(), firstMedia: hero.querySelector('source').getAttribute('media') };
      });
      assert.equal(h.eyebrow, 'ATHLETES'); assert.equal(h.h1, 'A global community of active people');
      assert.equal(h.sub, 'Discover athletes, follow friends, and get inspired by people who share your passion.');
      assert.equal(h.align, 'center'); assert.equal(h.firstMedia, '(max-width:768px)');
      assert.match(h.src, width <= 768 ? /^athletes-hero-mobile\./ : /^athletes-hero-(800|1600)\./);
      return h;
    });
    if ([360, 414, 1280].includes(width)) await check(`${width}: hero worst-pixel contrast ≥4.5`, async () => {
      const rows = await page.evaluate(heroContrast);
      report.contrast.push(...rows.map(row => ({ width, ...row })));
      assert.ok(rows.length === 3 && rows.every(row => row.ratio >= 4.5), JSON.stringify(rows.map(r => [r.text.slice(0, 12), r.ratio.toFixed(2)])));
    });
    await check(`${width}: chips = All sports + declared registry only`, async () => {
      const chips = await page.locator(`${S.sportChips} [data-sport]`).evaluateAll(els => els.map(e => e.dataset.sport));
      assert.equal(chips[0], 'all');
      assert.ok(!chips.includes('snowboarding') && !chips.includes('padel') && !chips.includes('Strength'), chips.join());
      assert.ok(chips.slice(1).every(c => /^[a-z]+$/.test(c)));
      return chips;
    });
    await check(`${width}: grid cards — banner/gradient/fallback, chips cap, sports count`, async () => {
      await page.waitForTimeout(250);
      const r = await page.evaluate(() => [...document.querySelectorAll('#athlete-grid .adc-card')].map(c => ({
        id: c.dataset.userId, img: !!c.querySelector('.adc-banner-img'), failed: c.querySelector('.adc-banner').classList.contains('adc-banner-failed'),
        lazy: c.querySelector('.adc-banner-img')?.getAttribute('loading'), wh: c.querySelector('.adc-banner-img') ? [c.querySelector('.adc-banner-img').getAttribute('width'), c.querySelector('.adc-banner-img').getAttribute('height')].join('x') : null,
        bg: getComputedStyle(c.querySelector('.adc-banner')).backgroundImage.slice(0, 15),
        chips: [...c.querySelectorAll('.adc-pill')].map(p => p.textContent), sports: c.querySelectorAll('.adc-stat-val')[2].textContent,
        loc: c.querySelector('.adc-location').textContent })));
      const by = Object.fromEntries(r.map(x => [x.id, x]));
      assert.ok(by['fixture-01'].img && by['fixture-01'].lazy === 'lazy' && by['fixture-01'].wh === '640x160', 'present banner');
      assert.ok(!by['fixture-02'].img && by['fixture-02'].failed && by['fixture-02'].bg.startsWith('linear-gradient'), 'failed banner → gradient');
      assert.ok(!by['fixture-03'].img && by['fixture-03'].bg.startsWith('linear-gradient'), 'absent banner → gradient');
      assert.equal(by['fixture-01'].chips.length, 4); assert.equal(by['fixture-01'].chips[3], '+3'); assert.equal(by['fixture-01'].sports, '6');
      assert.equal(by['fixture-04'].chips.length, 0); assert.equal(by['fixture-04'].sports, '0');
      assert.equal(by['fixture-05'].chips.length, 1); assert.equal(by['fixture-05'].sports, '1', 'dup+legacy excluded');
      assert.equal(by['fixture-03'].chips.length, 3);
      assert.ok(r.every(x => !/·/.test(x.loc)), 'location line carries no sports');
    });
    await geometry(page, width, 'grid');
    await capture(page, width, 'grid');

    await page.evaluate(() => window.setView('list'));
    await check(`${width}: list view has NO banner element and no new banner request`, async () => {
      const before = report.bannerRequests.length;
      await page.waitForTimeout(150);
      assert.equal(await page.locator(S.banner).count(), 0);
      assert.equal(report.bannerRequests.length, before);
    });
    await geometry(page, width, 'list');
    await capture(page, width, 'list');

    await page.evaluate(() => window.setSport('running'));
    await check(`${width}: running filter; persists across view toggle`, async () => {
      const ids = () => page.locator(S.card).evaluateAll(els => els.map(e => e.dataset.userId));
      const listIds = await ids();
      assert.ok(listIds.length > 0 && listIds.length < 13);
      await page.evaluate(() => window.setView('grid'));
      assert.deepEqual(await ids(), listIds);
      assert.ok(await page.locator(S.sportChip('running')).evaluate(e => e.classList.contains('on')));
      await page.evaluate(() => window.setView('list'));
      assert.deepEqual(await ids(), listIds);
      return listIds.length;
    });
    await geometry(page, width, 'filtered-list');
    await capture(page, width, 'filtered');
    await page.evaluate(() => window.setView('grid'));
    await geometry(page, width, 'filtered-grid');
    await capture(page, width, 'filtered-grid');

    await check(`${width}: sport filter + search with empty result`, async () => {
      await page.locator(S.search).fill('zzzz-nobody');
      assert.match(await page.locator('#athlete-grid h3').innerText(), /No athletes match your search/);
      await page.locator(S.search).fill('');
    });
    await page.evaluate(() => window.setSport('all'));
    await check(`${width}: Following tab + empty search wording`, async () => {
      await page.locator(S.showFollowing).click();
      assert.equal(await page.locator(S.card).count(), 4);
      await page.locator(S.search).fill('zzzz-nobody');
      assert.equal(await page.locator('#athlete-grid h3').innerText(), 'No athletes match your search');
      await page.locator(S.search).fill('');
      await page.locator(S.showAll).click();
    });
    await check(`${width}: follow button containment + state change (in-process)`, async () => {
      const btn = page.locator(`${S.followBtn}[data-user-id="fixture-03"]`);
      assert.equal(await btn.innerText(), 'Follow');
      await btn.click();
      await page.waitForFunction(() => document.querySelector('#athlete-grid .adc-follow-btn[data-user-id="fixture-03"]').textContent === 'Following');
      assert.ok(await btn.evaluate(b => b.classList.contains('is-following')));
      await btn.click();
      await page.waitForFunction(() => document.querySelector('#athlete-grid .adc-follow-btn[data-user-id="fixture-03"]').textContent === 'Follow');
    });
    await page.close();

    const capped = await context.newPage();
    capped.on('pageerror', e => report.browserErrors.push(`${width} capped: ${e.message}`));
    await capped.setViewportSize({ width, height: 1000 });
    await capped.goto(`${origin}/html/athletes-capped`, { waitUntil: 'networkidle' });
    await check(`${width}: "Showing N of total" note`, async () =>
      assert.equal(await capped.locator(S.count).innerText(), 'Showing 13 of 71 — refine with search'));
    await capped.close();
  }
  await check('no browser errors', () => assert.deepEqual(report.browserErrors, []));
  await check('no live data requests or writes', () => assert.deepEqual(report.forbiddenRequests, []));
  await check('all local resources configured', () => assert.deepEqual(report.missingResources, []));
} finally {
  await browser.close();
  writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(path.join(output, 'contrast.json'), JSON.stringify(report.contrast, null, 2) + '\n');
}
for (const c of report.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.error ? ': ' + c.error : ''}`);
console.log(`${report.screenshots.length} screenshots; report at ${output}/report.json; zero live seeds`);
if (report.checks.some(c => !c.ok)) process.exitCode = 1;

async function geometry(page, width, state) {
  const g = await page.evaluate(athletesGeometryExpr({ view: state.includes('list') ? 'list' : 'grid' }));
  report.geometry.push({ width, state, ...g });
  await check(`${width}: ${state} geometry`, () => assert.deepEqual(g.failures, []));
}
async function capture(page, width, state) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(450); // let the real adc-fade-up entrance finish
  if (inspect) return;
  const filename = `${width}-${state}.png`;
  await page.screenshot({ path: path.join(output, filename), fullPage: true });
  report.screenshots.push(filename);
}

// Leaderboards method: actual selected image, actual object-fit/position and
// overlay; worst background pixel throughout each rendered text rectangle.
async function heroContrast() {
  const hero = document.querySelector('.athletes-hero'), image = hero.querySelector('img');
  await image.decode();
  if (!image.naturalWidth) throw new Error('Actual selected hero image failed to load');
  const rect = hero.getBoundingClientRect(), imageRect = image.getBoundingClientRect();
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(rect.width); canvas.height = Math.ceil(rect.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const imageStyle = getComputedStyle(image), overlay = getComputedStyle(hero, '::before');
  if (imageStyle.objectFit !== 'cover') throw new Error('Update contrast sampler for non-cover hero');
  const position = imageStyle.objectPosition.split(' ').map(v => parseFloat(v) / 100);
  const scale = Math.max(imageRect.width / image.naturalWidth, imageRect.height / image.naturalHeight);
  const dw = image.naturalWidth * scale, dh = image.naturalHeight * scale;
  ctx.drawImage(image, imageRect.left - rect.left + (imageRect.width - dw) * position[0],
    imageRect.top - rect.top + (imageRect.height - dh) * position[1], dw, dh);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const rgba = v => { const n = v.match(/[\d.]+/g).map(Number); return [n[0], n[1], n[2], n[3] ?? 1]; };
  if (overlay.backgroundImage !== 'none') throw new Error('Update contrast sampler for gradient overlay');
  const over = rgba(overlay.backgroundColor);
  const lum = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
  return [...hero.querySelectorAll('h1, p')].map(el => {
    const r = el.getBoundingClientRect(), style = getComputedStyle(el), fg0 = rgba(style.color);
    let ratio = Infinity, samples = 0;
    for (let y = Math.max(0, Math.floor(r.top - rect.top)); y < Math.min(canvas.height, Math.ceil(r.bottom - rect.top)); y++) {
      for (let x = Math.max(0, Math.floor(r.left - rect.left)); x < Math.min(canvas.width, Math.ceil(r.right - rect.left)); x++) {
        const i = (y * canvas.width + x) * 4;
        const bg = over.slice(0, 3).map((v, j) => v * over[3] + pixels[i + j] * (1 - over[3]));
        const fg = fg0.slice(0, 3).map((v, j) => v * fg0[3] + bg[j] * (1 - fg0[3]));
        const a = lum(fg), b = lum(bg);
        ratio = Math.min(ratio, (Math.max(a, b) + .05) / (Math.min(a, b) + .05)); samples++;
      }
    }
    if (!samples) throw new Error('No rendered hero text samples');
    return { text: el.textContent, ratio, samples, size: style.fontSize, weight: style.fontWeight,
      currentSrc: image.currentSrc.split('/').pop(), objectPosition: imageStyle.objectPosition, overlay: overlay.backgroundColor };
  });
}
