// Permanent regression guard for landing-page hero and analytics image bands.
//
// The expectation table is deliberately explicit. Responsive-band changes must
// update a visible row here rather than silently teaching the verifier to accept
// whatever the page happens to request.
//
// Requires the dev workflow to be running.
// Run: pnpm verify:landing-images
'use strict';

const { chromium } = require('playwright-core');

const BASE_URL = 'http://localhost:80/html';
const LANDING_URL = BASE_URL + '/landing';
const ASSET_URL = BASE_URL + '/landing-assets/';
const EXECUTABLE = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;

const HERO_800 = 'hero-trail-runners-800.avif';
const HERO_1600 = 'hero-trail-runners-1600.avif';
const ANALYTICS_800 = 'analytics-weekly-activity-800.avif';
const ANALYTICS_1600 = 'analytics-weekly-activity-1600.avif';
const mobile = (width, density) => `analytics-mobile-composite-${width}-${density}x.avif`;

// Explicit width/DPR contract. `null` means that image category must make zero
// requests at that width and DPR.
const EXPECTATIONS = [
  { width: 380, hero: [HERO_800, HERO_1600, HERO_1600], analytics: [mobile(380, 2), mobile(380, 2), mobile(380, 3)] },
  { width: 384, hero: [HERO_800, HERO_1600, HERO_1600], analytics: [mobile(380, 2), mobile(380, 2), mobile(380, 3)] },
  { width: 385, hero: [HERO_800, HERO_1600, HERO_1600], analytics: [mobile(390, 2), mobile(390, 2), mobile(390, 3)] },
  { width: 390, hero: [HERO_800, HERO_1600, HERO_1600], analytics: [mobile(390, 2), mobile(390, 2), mobile(390, 3)] },
  { width: 393, hero: [HERO_800, HERO_1600, HERO_1600], analytics: [mobile(390, 2), mobile(390, 2), mobile(390, 3)] },
  { width: 430, hero: [HERO_800, HERO_1600, HERO_1600], analytics: [mobile(390, 2), mobile(390, 2), mobile(390, 3)] },
  { width: 431, hero: [HERO_800, HERO_1600, HERO_1600], analytics: [mobile(600, 2), mobile(600, 2), mobile(600, 3)] },
  { width: 600, hero: [HERO_800, HERO_1600, HERO_1600], analytics: [mobile(600, 2), mobile(600, 2), mobile(600, 3)] },
  { width: 639, hero: [HERO_800, HERO_1600, HERO_1600], analytics: [mobile(600, 2), mobile(600, 2), mobile(600, 3)] },
  { width: 640, hero: [HERO_800, HERO_1600, HERO_1600], analytics: [mobile(767, 2), mobile(767, 2), mobile(767, 3)] },
  { width: 767, hero: [HERO_800, HERO_1600, HERO_1600], analytics: [mobile(767, 2), mobile(767, 2), mobile(767, 3)] },
  { width: 768, hero: [HERO_800, HERO_1600, HERO_1600], analytics: [ANALYTICS_800, ANALYTICS_1600, ANALYTICS_1600] },
  { width: 1024, hero: [HERO_800, HERO_1600, HERO_1600], analytics: [ANALYTICS_800, ANALYTICS_1600, ANALYTICS_1600] },
  { width: 1279, hero: [HERO_800, HERO_1600, HERO_1600], analytics: [ANALYTICS_800, ANALYTICS_1600, ANALYTICS_1600] },
  { width: 1280, hero: [HERO_800, HERO_1600, HERO_1600], analytics: [ANALYTICS_800, ANALYTICS_1600, ANALYTICS_1600] },
  { width: 1599, hero: [HERO_800, HERO_1600, HERO_1600], analytics: [ANALYTICS_800, ANALYTICS_1600, ANALYTICS_1600] },
  { width: 1600, hero: [HERO_1600, HERO_1600, HERO_1600], analytics: [ANALYTICS_1600, ANALYTICS_1600, ANALYTICS_1600] }
];

const BOUNDARIES = [
  [384, 385],
  [430, 431],
  [639, 640],
  [767, 768],
  [1279, 1280],
  [1599, 1600]
];

const HERO_RE = /^hero-trail-runners-(?:800|1600)\.(?:avif|webp)$/;
const ANALYTICS_RE = /^analytics-(?:weekly-activity-(?:800|1600)|mobile-composite-(?:380|390|600|767)-(?:2|3)x)\.(?:avif|webp)$/;

let passes = 0;
let failures = 0;
const failedCases = new Map();

function receivedList(files) {
  return files.length ? files.join(', ') : '(none)';
}

function check(caseKey, name, ok, expected, received) {
  if (ok) {
    passes++;
    return;
  }
  failures++;
  if (caseKey) {
    if (!failedCases.has(caseKey)) failedCases.set(caseKey, []);
    failedCases.get(caseKey).push(name);
  }
  const detail = [
    expected !== undefined ? 'expected ' + expected : '',
    received !== undefined ? 'received ' + received : ''
  ].filter(Boolean).join('; ');
  console.log(`FAIL [${caseKey || 'assets'}] ${name}${detail ? ' — ' + detail : ''}`);
}

function assertImageRequests(caseKey, label, expected, files) {
  if (expected === null) {
    check(caseKey, `${label} request count`, files.length === 0, '0', String(files.length));
    check(caseKey, `${label} variant`, files.length === 0, '(none)', receivedList(files));
  } else {
    check(caseKey, `${label} request count`, files.length === 1, '1', String(files.length));
    check(caseKey, `${label} variant`, files.length === 1 && files[0] === expected, expected, receivedList(files));
  }
  const formats = new Set(files.map((file) => file.split('.').pop()));
  check(caseKey, `${label} does not request both AVIF and WebP`,
    !(formats.has('avif') && formats.has('webp')), 'one format', receivedList(files));
}

function expectedAssetFiles() {
  const avifs = new Set();
  for (const row of EXPECTATIONS) {
    for (const file of [...row.hero, ...row.analytics]) {
      if (file) avifs.add(file);
    }
  }
  return [...avifs].sort().flatMap((file) => [file, file.replace(/\.avif$/, '.webp')]);
}

async function verifyServedFiles() {
  const files = expectedAssetFiles();
  console.log(`— served files (${files.length}) —`);
  for (const file of files) {
    let response;
    try {
      response = await fetch(ASSET_URL + file, {
        headers: { 'Cache-Control': 'no-cache' }
      });
    } catch (error) {
      check(null, file, false, 'HTTP 200 with the matching image content type', error.message);
      continue;
    }
    const expectedType = file.endsWith('.avif') ? 'image/avif' : 'image/webp';
    const receivedType = (response.headers.get('content-type') || '').split(';')[0];
    check(null, file, response.status === 200 && receivedType === expectedType,
      `HTTP 200 ${expectedType}`, `HTTP ${response.status} ${receivedType || '(no content-type)'}`);
  }
  console.log(`  ok  ${files.length - failures}/${files.length} served files`);
}

async function verifyBrowserMatrix() {
  if (!EXECUTABLE) {
    throw new Error('REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE is not set');
  }
  const browser = await chromium.launch({
    headless: true,
    executablePath: EXECUTABLE,
    args: ['--no-sandbox']
  });
  console.log(`— browser matrix (${EXPECTATIONS.length * 3} fresh-cache cases) —`);
  try {
    for (const row of EXPECTATIONS) {
      for (const dpr of [1, 2, 3]) {
        const caseKey = `${row.width}px DPR ${dpr}`;
        const context = await browser.newContext({
          viewport: { width: row.width, height: 1000 },
          deviceScaleFactor: dpr,
          serviceWorkers: 'block',
          extraHTTPHeaders: { 'Cache-Control': 'no-cache' }
        });
        const page = await context.newPage();
        const session = await context.newCDPSession(page);
        await session.send('Network.setCacheDisabled', { cacheDisabled: true });
        const requested = [];
        page.on('request', (request) => {
          let pathname;
          try {
            pathname = new URL(request.url()).pathname;
          } catch {
            return;
          }
          const prefix = '/html/landing-assets/';
          if (pathname.startsWith(prefix)) requested.push(pathname.slice(prefix.length));
        });

        let navigationError = null;
        try {
          await page.goto(`${LANDING_URL}?verify-landing-images=${row.width}-${dpr}`, {
            waitUntil: 'networkidle',
            timeout: 30000
          });
        } catch (error) {
          navigationError = error;
        }
        if (navigationError) {
          check(caseKey, 'landing page loads', false, 'successful navigation', navigationError.message);
          await context.close();
          continue;
        }

        const hero = requested.filter((file) => HERO_RE.test(file));
        const analytics = requested.filter((file) => ANALYTICS_RE.test(file));
        assertImageRequests(caseKey, 'hero', row.hero[dpr - 1], hero);
        assertImageRequests(caseKey, 'analytics', row.analytics[dpr - 1], analytics);

        const geometry = await page.evaluate(() => ({
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth
        }));
        check(caseKey, 'no horizontal page overflow',
          geometry.documentWidth <= geometry.viewportWidth && geometry.bodyWidth <= geometry.viewportWidth,
          `document/body <= ${geometry.viewportWidth}px`,
          `document ${geometry.documentWidth}px, body ${geometry.bodyWidth}px`);

        if (!failedCases.has(caseKey)) {
          console.log(`  ok  ${caseKey} — hero ${receivedList(hero)}; analytics ${receivedList(analytics)}`);
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

function reportBoundaryFailures() {
  for (const [below, above] of BOUNDARIES) {
    const keys = [...failedCases.keys()].filter((key) =>
      key.startsWith(below + 'px ') || key.startsWith(above + 'px '));
    if (keys.length) {
      console.log(`BOUNDARY FAIL ${below}/${above}: ${keys.join(', ')}`);
    }
  }
}

(async () => {
  await verifyServedFiles();
  await verifyBrowserMatrix();
  reportBoundaryFailures();
  if (failures) {
    console.log(`\nverify-landing-images FAILED (${failures} failures, ${passes} passes)`);
    process.exit(1);
  }
  console.log(`\nverify-landing-images OK (${passes} assertions; ${EXPECTATIONS.length * 3} browser cases; ${expectedAssetFiles().length} served files)`);
})().catch((error) => {
  console.error('verify-landing-images FATAL:', error && error.stack ? error.stack : error);
  process.exit(1);
});