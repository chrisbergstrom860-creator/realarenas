#!/usr/bin/env node
// Seed-free real-template proof. No server, credentials, cookies or data writes.
// Run after final controls/assets land: node scripts/verify-log-presentation.mjs
// --inspect skips screenshots; artifacts/reports otherwise live only in /tmp.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { launchBrowser } from './lib/mobile-geometry.js';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const output = '/tmp/log-presentation';
const origin = 'https://log-harness.invalid';
const inspect = process.argv.includes('--inspect');
const { SPORTS, SPORT_ICONS, LEGACY_SPORT_EMOJI } = createRequire(import.meta.url)('../sports.js');
const author = { name: 'Alex & Jordan', avatar_url: null, profilePublic: true };
const fixture = { userId: 'log-presentation-fixture', profile: author, clubs: [], gating: { proLocked: false } };
const notes = ('Steady coastal training with a patient start.\nFinished strong, recovered well. <>&"\'\n').repeat(6).slice(0, 500);
mkdirSync(output, { recursive: true });

// Evaluate only the real server's pure presentation builders, never server.js.
const server = readFileSync(path.join(root, 'server.js'), 'utf8');
function constant(name) {
  const match = server.match(new RegExp(`const ${name} = (\`[\\s\\S]*?\`);`));
  assert.ok(match, `Real ${name} source anchor changed`);
  return vm.runInNewContext(match[1], { SPORTS, SPORT_ICONS, LEGACY_SPORT_EMOJI });
}
const navStart = server.indexOf('function bnItem(');
const navEnd = server.indexOf('// Avatar dropdown enhancement:', navStart);
const injectStart = server.indexOf('function injectBottomNav(');
const injectEnd = server.indexOf('// ── PRO BADGE', injectStart);
assert.ok(navStart >= 0 && navEnd > navStart && injectStart >= 0 && injectEnd > injectStart, 'Real navigation anchors changed');
let html = readFileSync(path.join(root, 'html/arenas-log.html'), 'utf8');
html = html.replace('</head>', `<script>window.ARENAS_DATA=${JSON.stringify(fixture).replace(/</g, '\\u003c')};</script>${constant('AVATAR_HELPERS_SCRIPT')}</head>`);
html = html.replace('</body>', constant('TOPBAR_IDENTITY_SCRIPT') + constant('AVATAR_MENU_SCRIPT') + '</body>');
html = vm.runInNewContext(`${server.slice(navStart, navEnd)}\n${server.slice(injectStart, injectEnd)}\ninjectBottomNav(template, 'log', {showAiFab:false})`, {
  template: html, injectAiInsightsLoaders: value => value,
  injectNotificationsPanel: value => value, MANAGED_CLUBS_MENU_SCRIPT: ''
});

// Optional local genuine font cache: font CSS + its relative woff/woff2 files.
// LOG_PRESENTATION_FONT_DIR=/tmp/... ; no synthetic font substitution.
const fontDirectories = [
  process.env.LOG_PRESENTATION_FONT_DIR,
  path.join(root, 'html/fonts'), path.join(root, 'public/fonts'),
  '/tmp/arenas-fonts', '/tmp/calendar-presentation/fonts'
].filter(Boolean);
const fontDirectory = fontDirectories.find(dir => existsSync(dir) && readdirSync(dir).some(f => f.endsWith('.css')));
const fontCSS = fontDirectory ? readdirSync(fontDirectory).filter(f => f.endsWith('.css')).map(f =>
  readFileSync(path.join(fontDirectory, f), 'utf8').replace(/url\((['"]?)(?!https?:|data:)([^'")]+)\1\)/g,
    (_, quote, url) => `url("/__fonts/${url}")`)).join('\n') : null;
const report = { seedFree: true, fixtureAuthor: author.name, fontSource: fontDirectory || 'real Google Fonts resources',
  checks: [], screenshots: [], contrast: [], geometry: [], ui: [], browserErrors: [], forbiddenRequests: [], missingResources: [] };
async function check(name, fn) {
  try { const detail = await fn(); report.checks.push({ name, ok: true, ...(detail === undefined ? {} : { detail }) }); }
  catch (error) { report.checks.push({ name, ok: false, error: error.message }); }
}
const types = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.avif': 'image/avif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const browser = await launchBrowser();
try {
  const context = await browser.newContext({ timezoneId: 'UTC', serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() !== 'GET') {
      report.forbiddenRequests.push(`${req.method()} ${req.url()}`);
      return route.abort('blockedbyclient');
    }
    if (url.hostname === 'fonts.googleapis.com' && fontCSS)
      return route.fulfill({ contentType: 'text/css', body: fontCSS });
    if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.continue();
    if (url.origin !== origin) {
      report.forbiddenRequests.push(req.url()); return route.abort('blockedbyclient');
    }
    if (url.pathname === '/html/log') return route.fulfill({ contentType: 'text/html', body: html });
    const relative = decodeURIComponent(url.pathname.replace(/^\/html\//, ''));
    const candidates = url.pathname.startsWith('/__fonts/') && fontDirectory
      ? [path.resolve(fontDirectory, decodeURIComponent(url.pathname.slice('/__fonts/'.length)))]
      : [path.resolve(root, 'html', relative), path.resolve(root, 'public', relative)];
    const local = candidates.find(f => (f.startsWith(root + path.sep) || (fontDirectory && f.startsWith(path.resolve(fontDirectory) + path.sep))) && existsSync(f));
    if (local) return route.fulfill({ contentType: types[path.extname(local)] || 'application/octet-stream', body: readFileSync(local) });
    report.missingResources.push(url.pathname);
    return route.fulfill({ status: 404, body: 'Unconfigured local presentation resource' });
  });
  for (const width of [360, 414, 1280, 1920]) {
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', e => report.browserErrors.push(`${width}: ${e.message}`));
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${origin}/html/log?date=2026-09-26`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#act-sport-chips .act-sport-chip');
    await page.evaluate(() => document.fonts.ready);
    await check(`${width}: actual fonts loaded`, async () => {
      assert.ok(await page.evaluate(async () => {
        await document.fonts.load('600 14px "Source Sans 3"');
        await document.fonts.load('500 12px "IBM Plex Mono"');
        return ['Source Sans 3', 'IBM Plex Mono'].every(family => [...document.fonts]
          .some(font => font.family.replace(/["']/g, '') === family && font.status === 'loaded'));
      }), 'Genuine Source Sans 3 and IBM Plex Mono required; fallback-font proof is invalid');
    });
    report.ui.push({ width, controls: await page.locator('#log-form input, #log-form select').evaluateAll(els =>
      els.map(el => ({ id: el.id, type: el.type, hidden: !el.getClientRects().length }))) });
    await check(`${width}: date prefill and empty preview`, async () => {
      assert.equal(await page.locator('#act-date').inputValue(), '2026-09-26');
      assert.match(await page.locator('#log-preview').textContent(), /Your activity will appear here/);
    });
    await capture(page, width, 'empty');
    if ([360, 414, 1280].includes(width)) await check(`${width}: hero worst-photo contrast ≥4.5`, async () => {
      const rows = await page.evaluate(heroContrast);
      report.contrast.push(...rows.map(row => ({ width, ...row })));
      assert.ok(rows.length === 2 && rows.every(row => row.ratio >= 4.5), JSON.stringify(rows));
    });
    await page.locator('[data-sport="running"]').click();
    await page.locator('#act-title').fill('Morning coastal run');
    await duration(page, '1:02:15');
    await page.locator('#sf-distance').fill('12.4 km');
    await page.locator('#act-notes').fill(notes);
    await page.locator('[data-feeling="strong"]').click();
    await settle(page);
    await check(`${width}: running 12.4 km / 1:02:15 → 5:01/km`, async () =>
      assert.equal(await page.locator('#sf-pace').inputValue(), '5:01/km'));
    await check(`${width}: shared renderer author, no links/footer`, async () => {
      const result = await page.evaluate(() => {
        const box = document.getElementById('log-preview');
        const before = box.innerHTML;
        window.logActivityHooks.renderPreview();
        return { stable: before === box.innerHTML, text: box.textContent,
          cards: box.querySelectorAll('.post-note-card').length,
          links: box.querySelectorAll('a, [onclick*="nav("], [onclick*="location"]').length,
          footers: box.querySelectorAll('.pn-footer').length };
      });
      assert.ok(result.stable, 'Live preview must use actual shared renderer');
      assert.equal(result.cards, 1);
      assert.ok(result.text.includes(author.name) && result.text.includes('Morning coastal run'));
      assert.equal(result.links, 0); assert.equal(result.footers, 0);
      assert.match(result.text, /5:01\/km/);
    });
    await capture(page, width, 'running');
    if (width < 1024) {
      await page.locator('#log-preview-toggle').click();
      await check(`${width}: mobile preview expanded`, async () => {
        assert.equal(await page.locator('#log-preview-toggle').getAttribute('aria-expanded'), 'true');
        assert.ok(await page.locator('#log-preview .post-note-card').isVisible());
      });
      await capture(page, width, 'running-mobile-expanded');
    }
    await check(`${width}: long notes expand/collapse safely`, async () => {
      const toggle = page.locator('#log-preview .fa-notes-toggle');
      assert.equal(await toggle.innerText(), 'Show more');
      assert.ok(await page.locator('#log-preview .fa-notes').evaluate(el => el.classList.contains('clamped')));
      await toggle.click();
      assert.equal(await toggle.innerText(), 'Show less');
      assert.equal(await page.locator('#log-preview .fa-notes').innerText(), notes.trim());
      assert.equal(await page.locator('#log-preview .fa-notes script').count(), 0);
      await capture(page, width, 'running-notes-expanded');
      await toggle.click();
      assert.equal(await toggle.innerText(), 'Show more');
    });
    await check(`${width}: manual pace override survives edits`, async () => {
      await page.locator('#sf-pace').fill('4:45/km');
      await page.locator('#sf-distance').fill('13 km');
      await duration(page, '1:05:00'); await settle(page);
      assert.equal(await page.locator('#sf-pace').inputValue(), '4:45/km');
    });
    await check(`${width}: clearing manual pace stays empty until sport reset`, async () => {
      await page.locator('#sf-pace').fill('');
      await page.locator('#sf-distance').fill('12.4 km');
      await duration(page, '1:02:15'); await settle(page);
      assert.equal(await page.locator('#sf-pace').inputValue(), '');
      await page.locator('#act-title').fill('Morning coastal run, edited');
      await settle(page);
      assert.equal(await page.locator('#sf-pace').inputValue(), '');
    });
    await page.locator('[data-sport="swimming"]').click();
    await duration(page, '40:00');
    await page.locator('#sf-distance').fill('2,000m'); await settle(page);
    await check(`${width}: sport switch resets override; swim → 2:00/100m`, async () =>
      assert.equal(await page.locator('#sf-pace').inputValue(), '2:00/100m'));
    await capture(page, width, 'swimming');
    await page.evaluate(() => window.resetActivityForm()); await settle(page);
    await check(`${width}: form reset clears preview and pace state`, async () => {
      assert.match(await page.locator('#log-preview').textContent(), /Your activity will appear here/);
      await page.locator('[data-sport="running"]').click();
      await duration(page, '1:02:15'); await page.locator('#sf-distance').fill('12.4 km');
      await settle(page); assert.equal(await page.locator('#sf-pace').inputValue(), '5:01/km');
    });
    if ([360, 414, 1280].includes(width)) await durationControls(page, width);
    await page.close();
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

async function settle(page) {
  await page.waitForTimeout(180); // Real preview's 100ms debounce, not a reimplemented renderer.
}
async function duration(page, value) {
  assert.ok(await page.locator('#act-duration').isVisible(), 'Real free-text duration control must remain visible');
  await page.locator('#act-duration').fill(value);
}
async function durationControls(page, width) {
  // Required fields are present before every invalid-save test, so a missing
  // title or sport cannot accidentally mask a duration validation failure.
  await page.locator('#act-title').fill('Duration interpretation training');
  await page.locator('#act-date').fill('2026-09-26');
  await page.locator('[data-sport="running"]').click();
  await page.locator('#sf-distance').fill('1 km');
  await duration(page, '5:30'); await settle(page);
  await check(`${width}: running 5:30 + 1 km warns and means 5 h 30 min`, async () => {
    assert.equal(await page.locator('#act-duration-interpretation').innerText(), 'Interpreted as 5 h 30 min');
    assert.ok(await page.locator('#act-duration-warning').isVisible());
    assert.match(await page.locator('#act-duration-warning').innerText(), /330:00\/km/);
    assert.equal(await page.locator('#sf-pace').inputValue(), '330:00/km');
    assert.equal(await page.locator('#act-duration').inputValue(), '5:30', 'Warning must not silently rewrite input');
  });
  await capture(page, width, 'duration-warning');
  await page.locator('#act-duration-use-alternative').click(); await settle(page);
  await check(`${width}: explicit switch → 0:05:30 and exact preview agreement`, async () => {
    assert.equal(await page.locator('#act-duration').inputValue(), '0:05:30');
    assert.equal(await page.locator('#act-duration-interpretation').innerText(), 'Interpreted as 5 min 30 s');
    assert.equal(await page.locator('#sf-pace').inputValue(), '5:30/km');
    assert.equal(await page.locator('#act-duration-warning').isVisible(), false);
    const stats = await page.locator('#log-preview .ac-stat').evaluateAll(els =>
      Object.fromEntries(els.map(el => [el.querySelector('.sl').textContent,
        [...el.querySelector('.sv').childNodes].filter(node => node.nodeType === Node.TEXT_NODE)
          .map(node => node.textContent).join('').trim()])));
    assert.equal(stats.Duration, '0:05:30');
    assert.equal(stats.Distance, '1 km');
    assert.equal(stats.Pace, '5:30/km');
    assert.equal(await page.locator('#act-duration').evaluate(el => document.activeElement === el), true);
  });
  await capture(page, width, 'duration-alternative');
  await duration(page, '45:00'); await page.locator('#sf-distance').fill('5 km'); await settle(page);
  await check(`${width}: running 45:00 + 5 km means 45 min without warning`, async () => {
    assert.equal(await page.locator('#act-duration-interpretation').innerText(), 'Interpreted as 45 min');
    assert.equal(await page.locator('#act-duration-warning').isVisible(), false);
    assert.equal(await page.locator('#sf-pace').inputValue(), '9:00/km');
  });
  await page.locator('[data-sport="cycling"]').click();
  await page.locator('#sf-distance').fill('1 km'); await duration(page, '5:30'); await settle(page);
  await check(`${width}: cycling 5:30 interprets 5 h 30 min with no running warning`, async () => {
    assert.equal(await page.locator('#act-duration-interpretation').innerText(), 'Interpreted as 5 h 30 min');
    assert.equal(await page.locator('#act-duration-warning').isVisible(), false);
  });
  await page.locator('[data-sport="running"]').click();
  await page.locator('#sf-distance').fill('1 km');
  for (const invalid of ['1:02:', '1:75:00']) {
    await duration(page, invalid); await settle(page);
    await check(`${width}: invalid ${invalid} inline error; Save focuses input, no POST`, async () => {
      assert.ok(await page.locator('#act-title').inputValue());
      assert.ok(await page.locator('#act-date').inputValue());
      assert.equal(await page.evaluate(() => selectedActivitySport), 'running');
      assert.ok(await page.locator('#act-duration-error').isVisible());
      assert.match(await page.locator('#act-duration-error').innerText(), /valid positive duration/i);
      assert.equal(await page.locator('#act-duration').getAttribute('aria-invalid'), 'true');
      assert.ok((await page.locator('#act-duration').getAttribute('aria-describedby')).split(/\s+/).includes('act-duration-error'));
      assert.equal(await page.locator('#act-duration-interpretation').innerText(), '');
      const before = report.forbiddenRequests.length;
      await page.locator('#save-activity-btn').click(); await settle(page);
      assert.equal(await page.locator('#act-duration').evaluate(el => document.activeElement === el), true);
      assert.equal(report.forbiddenRequests.length, before, 'Invalid Save must not attempt POST or any live request');
      assert.equal(await page.locator('#save-activity-btn').isDisabled(), false);
    });
    await capture(page, width, `duration-invalid-${invalid === '1:02:' ? 'trailing-colon' : 'minutes-range'}`);
  }
}
async function capture(page, width, state) {
  // Clicks/fills may scroll controls into view. Reset before full-page capture
  // so the real fixed navigation/header are consistently anchored at the top.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  const geometry = await page.evaluate(() => {
    const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const overflow = [...document.querySelectorAll('#log-form input, #log-form select, #log-form textarea, #log-preview .post-note-card')]
      .filter(visible).flatMap(el => {
        const r = el.getBoundingClientRect();
        const container = el.closest('#log-form, #log-preview').getBoundingClientRect();
        return r.left < Math.max(0, container.left) - 1 || r.right > Math.min(innerWidth, container.right) + 1
          ? [{ id: el.id, left: r.left, right: r.right }] : [];
      });
    return { pageOverflow: document.documentElement.scrollWidth - innerWidth, overflow };
  });
  report.geometry.push({ width, state, ...geometry });
  await check(`${width}: ${state} fits viewport/form`, () => {
    assert.ok(geometry.pageOverflow <= 1, JSON.stringify(geometry));
    assert.deepEqual(geometry.overflow, []);
  });
  if (!inspect) {
    const filename = `${width}-${state}.png`;
    await page.screenshot({ path: path.join(output, filename), fullPage: true });
    report.screenshots.push(filename);
  }
}

// Leaderboard method: actual selected photo, actual object-fit/position and
// overlay; worst background pixel throughout each rendered text rectangle.
async function heroContrast() {
  const hero = document.querySelector('.log-hero'), image = hero.querySelector('img');
  await image.decode();
  if (!image.naturalWidth) throw new Error('Actual selected hero image failed to load');
  const rect = hero.getBoundingClientRect(), imageRect = image.getBoundingClientRect();
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(rect.width); canvas.height = Math.ceil(rect.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const imageStyle = getComputedStyle(image), overlay = getComputedStyle(hero, '::before');
  if (imageStyle.objectFit !== 'cover') throw new Error('Update contrast sampler for non-cover hero');
  const position = imageStyle.objectPosition.split(' ').map(v => {
    if (!v.endsWith('%')) throw new Error('Update sampler for non-percent object position');
    return parseFloat(v) / 100;
  });
  const scale = Math.max(imageRect.width / image.naturalWidth, imageRect.height / image.naturalHeight);
  const dw = image.naturalWidth * scale, dh = image.naturalHeight * scale;
  ctx.drawImage(image, imageRect.left - rect.left + (imageRect.width - dw) * position[0],
    imageRect.top - rect.top + (imageRect.height - dh) * position[1], dw, dh);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const rgba = value => {
    const numbers = value.match(/[\d.]+/g).map(Number);
    return [numbers[0], numbers[1], numbers[2], numbers[3] ?? 1];
  };
  const stops = [...overlay.backgroundImage.matchAll(/rgba?\([^)]+\)\s+([\d.]+)%/g)]
    .map(match => ({ color: rgba(match[0]), at: Number(match[1]) / 100 }));
  if (overlay.backgroundImage !== 'none' && (!overlay.backgroundImage.startsWith('linear-gradient(90deg,') || stops.length < 2))
    throw new Error('Update contrast sampler for changed overlay gradient');
  function overlayAt(x) {
    if (!stops.length) return rgba(overlay.backgroundColor);
    const p = x / Math.max(1, canvas.width - 1);
    const end = stops.findIndex(stop => stop.at >= p);
    if (end <= 0) return stops[end < 0 ? stops.length - 1 : 0].color;
    const a = stops[end - 1], b = stops[end], t = (p - a.at) / (b.at - a.at);
    return a.color.map((c, i) => c + (b.color[i] - c) * t);
  }
  const lum = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  return [...hero.querySelectorAll('h1, p')].map(el => {
    const r = el.getBoundingClientRect(), style = getComputedStyle(el), foreground = rgba(style.color);
    let ratio = Infinity, samples = 0;
    for (let y = Math.max(0, Math.floor(r.top - rect.top)); y < Math.min(canvas.height, Math.ceil(r.bottom - rect.top)); y++) {
      for (let x = Math.max(0, Math.floor(r.left - rect.left)); x < Math.min(canvas.width, Math.ceil(r.right - rect.left)); x++) {
        const i = (y * canvas.width + x) * 4, over = overlayAt(x);
        const bg = over.slice(0, 3).map((v, j) => v * over[3] + pixels[i + j] * (1 - over[3]));
        const fg = foreground.slice(0, 3).map((v, j) => v * foreground[3] + bg[j] * (1 - foreground[3]));
        const a = lum(fg), b = lum(bg);
        ratio = Math.min(ratio, (Math.max(a, b) + .05) / (Math.min(a, b) + .05)); samples++;
      }
    }
    if (!samples) throw new Error('No rendered hero text samples');
    return { text: el.textContent, ratio, samples, foreground: style.color, font: style.fontFamily,
      size: style.fontSize, weight: style.fontWeight, currentSrc: image.currentSrc,
      naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
      objectPosition: imageStyle.objectPosition, overlay: overlay.backgroundImage === 'none' ? overlay.backgroundColor : overlay.backgroundImage };
  });
}