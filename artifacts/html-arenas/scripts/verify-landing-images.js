// Permanent regression guard for responsive content images, including feed.
//
// The expectation table is deliberately explicit. Responsive-band changes must
// update a visible row here rather than silently teaching the verifier to accept
// whatever the page happens to request.
//
// Requires the dev workflow to be running.
// Run: pnpm verify:landing-images
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { chromium } = require('playwright-core');

const BASE_URL = 'http://localhost:80/html';
const LANDING_URL = BASE_URL + '/landing';
const FOR_CLUBS_URL = BASE_URL + '/for-clubs';
const ASSET_URL = BASE_URL + '/landing-assets/';
const EXECUTABLE = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const ASSET_DIR = path.join(__dirname, '..', 'html', 'landing-assets');
const CHALLENGES_HTML = fs.readFileSync(
  path.join(__dirname, '..', 'html', 'arenas-challenges.html'), 'utf8'
);
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ASSET_DIR, 'manifest.json'), 'utf8'));
const asset = (logicalName) => {
  const entry = MANIFEST.assets && MANIFEST.assets[logicalName];
  if (!entry || !entry.file) throw new Error(`Missing landing asset manifest entry: ${logicalName}`);
  return entry.file;
};

const HERO_800 = asset('hero-trail-runners-800.avif');
const HERO_1600 = asset('hero-trail-runners-1600.avif');
const CLUBS_800 = asset('for-clubs-collage-800.avif');
const CLUBS_1600 = asset('for-clubs-collage-1600.avif');
const ANALYTICS_800 = asset('analytics-weekly-activity-800.avif');
const ANALYTICS_1600 = asset('analytics-weekly-activity-1600.avif');
const LEADERBOARD_HERO_800 = asset('leaderboards-hero-hiker-800.avif');
const LEADERBOARD_HERO_1600 = asset('leaderboards-hero-hiker-1600.avif');
const LEADERBOARD_CLUB_800 = asset('leaderboards-club-group-800.avif');
const LEADERBOARD_CLUB_1600 = asset('leaderboards-club-group-1600.avif');
const AUTH_800 = asset('auth-football-800.avif');
const AUTH_1536 = asset('auth-football-1536.avif');
const FEED_800 = asset('feed-yoga-800.avif');
const FEED_1600 = asset('feed-yoga-1600.avif');
const EVENTS_800 = asset('events-hikers-800.avif');
const EVENTS_1600 = asset('events-hikers-1600.avif');
const CHALLENGES_800 = asset('challenges-hero-800.avif');
const CHALLENGES_1600 = asset('challenges-hero-1600.avif');
const APPROVED_LEADERBOARD_HERO_HASHES = {
  'leaderboards-hero-hiker-800.avif': 'e663dc32c5504b85fbb2e16670dcef8001bfd3d21c1877a044b06a6efe5d1649',
  'leaderboards-hero-hiker-800.webp': '3a9c8f714e0634f856034ff43924d6972a728de8eddb2ab3bba6fce1289f534d',
  'leaderboards-hero-hiker-1600.avif': '231688edb3386df1cc6595b0c97b7ada2797e09f85e1b943b2107062a09b07a8',
  'leaderboards-hero-hiker-1600.webp': '291705176ef7ac12187e32c8a1cb6cd7044f48ab5b9e84d0d23cd1f8e6d0e635'
};
const LEADERBOARD_HERO_HASHES = Object.fromEntries(
  Object.entries(APPROVED_LEADERBOARD_HERO_HASHES)
    .map(([logicalName, digest]) => [asset(logicalName), digest])
);
const APPROVED_CHALLENGES_HERO_HASHES = {
  'challenges-hero-800.avif': 'bbb206051b9e7966c7b8dc3012074a2ffcd178ca16a4e9fb1e517da93e6f5c6c',
  'challenges-hero-800.webp': 'dc99b02eaff9690e5a0a2cc343ca32fc9ff6e53ecdec825ef0dc2aff852f9980',
  'challenges-hero-1600.avif': 'eb00222d9f8b055b0fa17e4a1b52b70b5d268da1c77c7b7a7c36d4798d709174',
  'challenges-hero-1600.webp': 'e5b96a36ec223f380959f6ecb5213d510e3ae00db438e9aa833af95351adfe29'
};
const CHALLENGES_HERO_HASHES = Object.fromEntries(
  Object.entries(APPROVED_CHALLENGES_HERO_HASHES)
    .map(([logicalName, digest]) => [asset(logicalName), digest])
);
const mobile = (width, density) =>
  asset(`analytics-mobile-composite-${width}-${density}x.avif`);

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
  { width: 1280, hero: [HERO_1600, HERO_1600, HERO_1600], analytics: [ANALYTICS_800, ANALYTICS_1600, ANALYTICS_1600] },
  { width: 1366, hero: [HERO_1600, HERO_1600, HERO_1600], analytics: [ANALYTICS_800, ANALYTICS_1600, ANALYTICS_1600] },
  { width: 1440, hero: [HERO_1600, HERO_1600, HERO_1600], analytics: [ANALYTICS_800, ANALYTICS_1600, ANALYTICS_1600] },
  { width: 1599, hero: [HERO_1600, HERO_1600, HERO_1600], analytics: [ANALYTICS_800, ANALYTICS_1600, ANALYTICS_1600] },
  { width: 1600, hero: [HERO_1600, HERO_1600, HERO_1600], analytics: [ANALYTICS_1600, ANALYTICS_1600, ANALYTICS_1600] },
  { width: 1920, hero: [HERO_1600, HERO_1600, HERO_1600], analytics: [ANALYTICS_1600, ANALYTICS_1600, ANALYTICS_1600] },
  { width: 2560, hero: [HERO_1600, HERO_1600, HERO_1600], analytics: [ANALYTICS_1600, ANALYTICS_1600, ANALYTICS_1600] }
];

const BOUNDARIES = [
  [384, 385],
  [430, 431],
  [639, 640],
  [767, 768],
  [1279, 1280],
  [1599, 1600]
];

const HERO_RE = /^hero-trail-runners-(?:800|1600)\.[0-9a-f]{12}\.(?:avif|webp)$/;
const CLUBS_RE = /^for-clubs-collage-(?:800|1600)\.[0-9a-f]{12}\.(?:avif|webp)$/;
const ANALYTICS_RE = /^analytics-(?:weekly-activity-(?:800|1600)|mobile-composite-(?:380|390|600|767)-(?:2|3)x)\.[0-9a-f]{12}\.(?:avif|webp)$/;
const AUTH_RE = /^auth-football-(?:800|1536)\.[0-9a-f]{12}\.(?:avif|webp)$/;
const FEED_RE = /^feed-yoga-(?:800|1600)\.[0-9a-f]{12}\.(?:avif|webp)$/;
const EVENTS_RE = /^events-hikers-(?:800|1600)\.[0-9a-f]{12}\.(?:avif|webp)$/;
const CHALLENGES_RE = /^challenges-hero-(?:800|1600)\.[0-9a-f]{12}\.(?:avif|webp)$/;

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
  return Object.values(MANIFEST.assets).map((entry) => entry.file).sort();
}

function verifyManifestAndReferences() {
  const entries = Object.entries(MANIFEST.assets || {});
  const allowedFiles = new Set(entries.map(([, entry]) => entry.file));
  check(null, 'manifest has the complete 52-image inventory', entries.length === 52, '52', String(entries.length));
  for (const [logicalName, entry] of entries) {
    const extension = path.extname(logicalName).replace('.', '');
    const pattern = new RegExp(`\\.${entry.sha256.slice(0, MANIFEST.hashLength)}\\.${extension}$`);
    check(null, `${logicalName} filename carries its content hash`,
      pattern.test(entry.file) && /^[a-z0-9-]+\.[0-9a-f]{12}\.(?:avif|webp)$/.test(entry.file),
      `*.${entry.sha256.slice(0, 12)}.${extension}`, entry.file);
    const filePath = path.join(ASSET_DIR, entry.file);
    const digest = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    check(null, `${entry.file} bytes match manifest digest`,
      digest === entry.sha256, entry.sha256, digest);
  }
  for (const htmlName of [
    'arenas-landing-login.html',
    'arenas-for-clubs.html',
    'arenas-leaderboards.html',
    'arenas-feed.html',
    'arenas-events.html',
    'arenas-challenges.html'
  ]) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'html', htmlName), 'utf8');
    const references = [...html.matchAll(/\/html\/landing-assets\/([^"'()\s,]+)/g)]
      .map((match) => match[1]);
    check(null, `${htmlName} uses only manifest-backed hashed image names`,
      references.length > 0 && references.every((file) => allowedFiles.has(file)),
      'all image URLs in manifest', receivedList(references.filter((file) => !allowedFiles.has(file))));
  }
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
    check(null, `${file} immutable cache policy`,
      response.headers.get('cache-control') === 'public, max-age=31536000, immutable',
      'public, max-age=31536000, immutable', response.headers.get('cache-control'));
  }
  for (const logicalName of Object.keys(MANIFEST.assets)) {
    const response = await fetch(ASSET_URL + logicalName, {
      headers: { 'Cache-Control': 'no-cache' }
    });
    check(null, `${logicalName} old fixed URL is retired`,
      response.status === 404, 'HTTP 404', `HTTP ${response.status}`);
  }
  console.log(`  ok  checked ${files.length} immutable files and ${files.length} retired fixed URLs`);
}

async function verifyLeaderboardImageContract() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'html', 'arenas-leaderboards.html'), 'utf8');
  console.log('— Leaderboards responsive image contract —');
  for (const [logicalAvif, expectedWidth, expectedHeight] of [
    ['leaderboards-hero-hiker-800.avif', 800, 267],
    ['leaderboards-hero-hiker-1600.avif', 1600, 533],
    ['leaderboards-club-group-800.avif', 800, 600],
    ['leaderboards-club-group-1600.avif', 1600, 1200]
  ]) {
    for (const logicalName of [logicalAvif, logicalAvif.replace(/\.avif$/, '.webp')]) {
      const file = asset(logicalName);
      const assetPath = path.join(ASSET_DIR, file);
      const metadata = await sharp(assetPath).metadata();
      check(null, `${file} dimensions`,
        metadata.width === expectedWidth && metadata.height === expectedHeight,
        `${expectedWidth}x${expectedHeight}`, `${metadata.width}x${metadata.height}`);
      if (LEADERBOARD_HERO_HASHES[file]) {
        const digest = crypto.createHash('sha256').update(fs.readFileSync(assetPath)).digest('hex');
        check(null, `${file} is the approved wide-hiker encode`,
          digest === LEADERBOARD_HERO_HASHES[file],
          LEADERBOARD_HERO_HASHES[file], digest);
      }
    }
  }
  check(null, 'Leaderboards hero declares AVIF and WebP 800/1600 source sets',
    html.includes(`${asset('leaderboards-hero-hiker-800.avif')} 800w`) &&
    html.includes(`${asset('leaderboards-hero-hiker-1600.avif')} 1600w`) &&
    html.includes(`${asset('leaderboards-hero-hiker-800.webp')} 800w`) &&
    html.includes(`${asset('leaderboards-hero-hiker-1600.webp')} 1600w`));
  check(null, 'Leaderboards club image declares AVIF and WebP 800/1600 source sets',
    html.includes(`${asset('leaderboards-club-group-800.avif')} 800w`) &&
    html.includes(`${asset('leaderboards-club-group-1600.avif')} 1600w`) &&
    html.includes(`${asset('leaderboards-club-group-800.webp')} 800w`) &&
    html.includes(`${asset('leaderboards-club-group-1600.webp')} 1600w`));
  console.log('  ok  Leaderboards assets and source sets');
}

async function verifyAuthImageContract() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'html', 'arenas-landing-login.html'), 'utf8');
  console.log('— Auth photo responsive image contract —');
  for (const [logicalAvif, expectedWidth, expectedHeight] of [
    ['auth-football-800.avif', 800, 533],
    ['auth-football-1536.avif', 1536, 1024]
  ]) {
    for (const logicalName of [logicalAvif, logicalAvif.replace(/\.avif$/, '.webp')]) {
      const file = asset(logicalName);
      const metadata = await sharp(path.join(ASSET_DIR, file)).metadata();
      check(null, `${file} dimensions`,
        metadata.width === expectedWidth && metadata.height === expectedHeight,
        `${expectedWidth}x${expectedHeight}`, `${metadata.width}x${metadata.height}`);
    }
  }
  check(null, 'Auth photo declares AVIF and WebP 800/1536 source sets',
    html.includes(`${asset('auth-football-800.avif')} 800w`) &&
    html.includes(`${asset('auth-football-1536.avif')} 1536w`) &&
    html.includes(`${asset('auth-football-800.webp')} 800w`) &&
    html.includes(`${asset('auth-football-1536.webp')} 1536w`));
}

async function verifyFeedImageContract() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'html', 'arenas-feed.html'), 'utf8');
  console.log('— Feed banner responsive image contract —');
  for (const [logicalAvif, expectedWidth, expectedHeight] of [
    ['feed-yoga-800.avif', 800, 300],
    ['feed-yoga-1600.avif', 1600, 600]
  ]) {
    for (const logicalName of [logicalAvif, logicalAvif.replace(/\.avif$/, '.webp')]) {
      const file = asset(logicalName);
      const metadata = await sharp(path.join(ASSET_DIR, file)).metadata();
      check(null, `${file} dimensions`,
        metadata.width === expectedWidth && metadata.height === expectedHeight,
        `${expectedWidth}x${expectedHeight}`, `${metadata.width}x${metadata.height}`);
    }
  }
  check(null, 'Feed banner declares AVIF and WebP 800/1600 source sets',
    html.includes(`${asset('feed-yoga-800.avif')} 800w`) &&
    html.includes(`${asset('feed-yoga-1600.avif')} 1600w`) &&
    html.includes(`${asset('feed-yoga-800.webp')} 800w`) &&
    html.includes(`${asset('feed-yoga-1600.webp')} 1600w`));
}

async function verifyEventsImageContract() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'html', 'arenas-events.html'), 'utf8');
  console.log('— Events banner responsive image contract —');
  for (const [logicalAvif, expectedWidth, expectedHeight] of [
    ['events-hikers-800.avif', 800, 300],
    ['events-hikers-1600.avif', 1600, 600]
  ]) {
    for (const logicalName of [logicalAvif, logicalAvif.replace(/\.avif$/, '.webp')]) {
      const file = asset(logicalName);
      const metadata = await sharp(path.join(ASSET_DIR, file)).metadata();
      check(null, `${file} dimensions`,
        metadata.width === expectedWidth && metadata.height === expectedHeight,
        `${expectedWidth}x${expectedHeight}`, `${metadata.width}x${metadata.height}`);
    }
  }
  check(null, 'Events banner declares AVIF and WebP 800/1600 source sets',
    html.includes(`${asset('events-hikers-800.avif')} 800w`) &&
    html.includes(`${asset('events-hikers-1600.avif')} 1600w`) &&
    html.includes(`${asset('events-hikers-800.webp')} 800w`) &&
    html.includes(`${asset('events-hikers-1600.webp')} 1600w`));
}

async function verifyChallengesImageContract() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'html', 'arenas-challenges.html'), 'utf8');
  console.log('— Challenges hero responsive image contract —');
  for (const [logicalAvif, expectedWidth, expectedHeight] of [
    ['challenges-hero-800.avif', 800, 300],
    ['challenges-hero-1600.avif', 1600, 600]
  ]) {
    for (const logicalName of [logicalAvif, logicalAvif.replace(/\.avif$/, '.webp')]) {
      const file = asset(logicalName);
      const assetPath = path.join(ASSET_DIR, file);
      const metadata = await sharp(assetPath).metadata();
      check(null, `${file} dimensions`,
        metadata.width === expectedWidth && metadata.height === expectedHeight,
        `${expectedWidth}x${expectedHeight}`, `${metadata.width}x${metadata.height}`);
      const digest = crypto.createHash('sha256').update(fs.readFileSync(assetPath)).digest('hex');
      check(null, `${file} is an approved Challenges hero encode`,
        digest === CHALLENGES_HERO_HASHES[file],
        CHALLENGES_HERO_HASHES[file], digest);
    }
  }
  check(null, 'Challenges hero declares AVIF and WebP 800/1600 source sets',
    html.includes(`${asset('challenges-hero-800.avif')} 800w`) &&
    html.includes(`${asset('challenges-hero-1600.avif')} 1600w`) &&
    html.includes(`${asset('challenges-hero-800.webp')} 800w`) &&
    html.includes(`${asset('challenges-hero-1600.webp')} 1600w`));
  console.log('  ok  Challenges hero assets and source sets');
}

async function verifyEventsImageMatrix() {
  const browser = await chromium.launch({
    headless: true, executablePath: EXECUTABLE, args: ['--no-sandbox']
  });
  const widths = [360, 380, 768, 1280, 1920];
  console.log(`— Events banner browser matrix (${widths.length * 3} fresh-cache cases) —`);
  try {
    for (const width of widths) {
      for (const dpr of [1, 2, 3]) {
        const caseKey = `Events banner ${width}px DPR ${dpr}`;
        const slotWidth = width <= 768 ? width : 900;
        const expected = slotWidth * dpr <= 800 ? EVENTS_800 : EVENTS_1600;
        const context = await browser.newContext({
          viewport: { width, height: 500 }, deviceScaleFactor: dpr,
          serviceWorkers: 'block', extraHTTPHeaders: { 'Cache-Control': 'no-cache' }
        });
        const page = await context.newPage();
        const session = await context.newCDPSession(page);
        await session.send('Network.setCacheDisabled', { cacheDisabled: true });
        const requested = [];
        page.on('request', (request) => {
          try {
            const pathname = new URL(request.url()).pathname;
            const prefix = '/html/landing-assets/';
            if (pathname.startsWith(prefix)) requested.push(pathname.slice(prefix.length));
          } catch {}
        });
        await page.setContent(
          '<style>body{margin:0}.band{display:block;width:' + (width < 1024 ? '100vw' : 'calc(100vw - 216px)') + ';height:232px}.band img{width:100%;height:100%;object-fit:cover}</style>' +
          '<picture class="band">' +
          '<source type="image/avif" srcset="' + ASSET_URL + asset('events-hikers-800.avif') + ' 800w, ' + ASSET_URL + asset('events-hikers-1600.avif') + ' 1600w" sizes="(min-width:1024px) calc(100vw - 216px), 100vw">' +
          '<source type="image/webp" srcset="' + ASSET_URL + asset('events-hikers-800.webp') + ' 800w, ' + ASSET_URL + asset('events-hikers-1600.webp') + ' 1600w" sizes="(min-width:1024px) calc(100vw - 216px), 100vw">' +
          '<img src="' + ASSET_URL + asset('events-hikers-800.webp') + '" alt="">' +
          '</picture>'
        );
        await page.locator('img').evaluate((img) => img.decode());
        const events = requested.filter((file) => EVENTS_RE.test(file));
        assertImageRequests(caseKey, 'Events banner', expected, events);
        if (!failedCases.has(caseKey)) console.log(`  ok  ${caseKey} — ${receivedList(events)}`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

async function verifyChallengesImageMatrix() {
  const browser = await chromium.launch({
    headless: true, executablePath: EXECUTABLE, args: ['--no-sandbox']
  });
  const widths = [360, 380, 768, 1280, 1920];
  // Use the page's real HTML/CSS and its shared athlete shell. The route is
  // fulfilled from the checked-in page so this guard does not require a
  // database user or challenge fixtures; only the page's data requests are
  // stubbed below.
  const matrixPage = CHALLENGES_HTML
    .replace('</head>',
      '<script>' +
      'window.ARENAS_DATA={profile:{name:"Image verifier"},clubs:[],gating:{proLocked:false},sports:[]};' +
      'window.ARENAS_SPORTS=[];window.ARENAS_SPORT_ICONS={any:"⚡"};' +
      '</script></head>')
    .replace('</body>',
      '<nav class="bottom-nav bn-has-fab" aria-label="Primary">' +
      '<a class="bn-item" onclick="nav(\'/feed\')"><span class="bn-icon">🏠</span><span class="bn-label">Feed</span></a>' +
      '<a class="bn-item" onclick="nav(\'/events\')"><span class="bn-icon">🎟️</span><span class="bn-label">Events</span></a>' +
      '<a class="bn-item" onclick="nav(\'/calendar\')"><span class="bn-icon">🗓️</span><span class="bn-label">Cal</span></a>' +
      '<a class="bn-item" onclick="nav(\'/leaderboards\')"><span class="bn-icon">🏆</span><span class="bn-label">Ranks</span></a>' +
      '<a class="bn-item bn-active" onclick="nav(\'/challenges\')"><span class="bn-icon">⚡</span><span class="bn-label">Challenges</span></a>' +
      '<a class="bn-item" onclick="nav(\'/profile\')"><span class="bn-icon">👤</span><span class="bn-label">Profile</span></a>' +
      '</nav><a class="bn-fab" aria-label="Log activity" onclick="nav(\'/log\')">➕</a></body>');
  const challengeResponse = {
    myChallenges: [],
    friendsChallenges: [],
    publicChallenges: [],
    publicCount: 0,
    pointsThisMonth: 0
  };
  console.log(`— Challenges hero browser matrix (${widths.length * 3} fresh-cache cases) —`);
  try {
    for (const width of widths) {
      for (const dpr of [1, 2, 3]) {
        const caseKey = `Challenges hero ${width}px DPR ${dpr}`;
        const slotWidth = width <= 768 ? width : width - 216;
        const expected = slotWidth * dpr <= 800 ? CHALLENGES_800 : CHALLENGES_1600;
        const context = await browser.newContext({
          viewport: { width, height: 500 }, deviceScaleFactor: dpr,
          serviceWorkers: 'block', extraHTTPHeaders: { 'Cache-Control': 'no-cache' }
        });
        const page = await context.newPage();
        const session = await context.newCDPSession(page);
        await session.send('Network.setCacheDisabled', { cacheDisabled: true });
        await page.route('**/html/challenges*', (route) => route.fulfill({
          status: 200,
          contentType: 'text/html',
          headers: { 'cache-control': 'no-store' },
          body: matrixPage
        }));
        await page.route('**/html/api/notifications*', (route) => route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ unreadCount: 0 })
        }));
        await page.route('**/html/api/challenges*', (route) => route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(challengeResponse)
        }));
        const requested = [];
        page.on('request', (request) => {
          try {
            const pathname = new URL(request.url()).pathname;
            const prefix = '/html/landing-assets/';
            if (pathname.startsWith(prefix)) requested.push(pathname.slice(prefix.length));
          } catch {}
        });
        await page.goto(`${BASE_URL}/challenges?verify-challenges-images=${width}-${dpr}`, {
          waitUntil: 'networkidle', timeout: 30000
        });
        await page.locator('.ch-hero-bg').evaluate((img) => img.decode());
        const challenges = requested.filter((file) => CHALLENGES_RE.test(file));
        assertImageRequests(caseKey, 'Challenges hero', expected, challenges);
        if (!failedCases.has(caseKey)) console.log(`  ok  ${caseKey} — ${receivedList(challenges)}`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

async function verifyFeedImageMatrix() {
  const browser = await chromium.launch({
    headless: true, executablePath: EXECUTABLE, args: ['--no-sandbox']
  });
  const widths = [360, 380, 768, 1280, 1920];
  console.log(`— Feed banner browser matrix (${widths.length * 2} fresh-cache cases) —`);
  try {
    for (const width of widths) {
      for (const dpr of [1, 2]) {
        const caseKey = `Feed banner ${width}px DPR ${dpr}`;
        const slotWidth = width <= 768 ? width : 656;
        const expected = slotWidth * dpr <= 800 ? FEED_800 : FEED_1600;
        const context = await browser.newContext({
          viewport: { width, height: 500 }, deviceScaleFactor: dpr,
          serviceWorkers: 'block', extraHTTPHeaders: { 'Cache-Control': 'no-cache' }
        });
        const page = await context.newPage();
        const session = await context.newCDPSession(page);
        await session.send('Network.setCacheDisabled', { cacheDisabled: true });
        const requested = [];
        page.on('request', (request) => {
          try {
            const pathname = new URL(request.url()).pathname;
            const prefix = '/html/landing-assets/';
            if (pathname.startsWith(prefix)) requested.push(pathname.slice(prefix.length));
          } catch {}
        });
        await page.setContent(
          '<style>body{margin:0}.band{display:block;width:' + (width <= 768 ? '100vw' : '656px') + ';height:180px}.band img{width:100%;height:100%;object-fit:cover}</style>' +
          '<picture class="band">' +
          '<source type="image/avif" srcset="' + ASSET_URL + asset('feed-yoga-800.avif') + ' 800w, ' + ASSET_URL + asset('feed-yoga-1600.avif') + ' 1600w" sizes="(max-width: 768px) 100vw, 656px">' +
          '<source type="image/webp" srcset="' + ASSET_URL + asset('feed-yoga-800.webp') + ' 800w, ' + ASSET_URL + asset('feed-yoga-1600.webp') + ' 1600w" sizes="(max-width: 768px) 100vw, 656px">' +
          '<img src="' + ASSET_URL + asset('feed-yoga-800.webp') + '" alt="">' +
          '</picture>'
        );
        await page.locator('img').evaluate((img) => img.decode());
        const feed = requested.filter((file) => FEED_RE.test(file));
        assertImageRequests(caseKey, 'Feed banner', expected, feed);
        if (!failedCases.has(caseKey)) console.log(`  ok  ${caseKey} — ${receivedList(feed)}`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

async function verifyAuthImageMatrix() {
  const browser = await chromium.launch({
    headless: true, executablePath: EXECUTABLE, args: ['--no-sandbox']
  });
  const widths = [380, 1280, 1440, 1600, 1920];
  console.log(`— Auth photo browser matrix (${widths.length * 2} fresh-cache cases) —`);
  try {
    for (const width of widths) {
      for (const dpr of [1, 2]) {
        const caseKey = `Auth photo ${width}px DPR ${dpr}`;
        const expected = width <= 768 ? null : (dpr === 1 && width <= 1600 ? AUTH_800 : AUTH_1536);
        const context = await browser.newContext({
          viewport: { width, height: 900 }, deviceScaleFactor: dpr,
          serviceWorkers: 'block', extraHTTPHeaders: { 'Cache-Control': 'no-cache' }
        });
        const page = await context.newPage();
        const session = await context.newCDPSession(page);
        await session.send('Network.setCacheDisabled', { cacheDisabled: true });
        const requested = [];
        page.on('request', (request) => {
          try {
            const pathname = new URL(request.url()).pathname;
            const prefix = '/html/landing-assets/';
            if (pathname.startsWith(prefix)) requested.push(pathname.slice(prefix.length));
          } catch {}
        });
        await page.goto(`${LANDING_URL}?verify-auth-photo=${width}-${dpr}#login`, {
          waitUntil: 'networkidle', timeout: 30000
        });
        const auth = requested.filter((file) => AUTH_RE.test(file));
        assertImageRequests(caseKey, 'Auth photo', expected, auth);
        const panelDisplay = await page.locator('.auth-left').evaluate((node) => getComputedStyle(node).display);
        check(caseKey, 'Auth photo panel visibility',
          width <= 768 ? panelDisplay === 'none' : panelDisplay !== 'none',
          width <= 768 ? 'none' : 'rendered', panelDisplay);
        if (!failedCases.has(caseKey)) console.log(`  ok  ${caseKey} — ${receivedList(auth)}`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
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

async function verifyForClubsMatrix() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: EXECUTABLE,
    args: ['--no-sandbox']
  });
  const widths = [380, 768, 1279, 1280, 1600, 1920];
  console.log(`— For Clubs browser matrix (${widths.length * 3} fresh-cache cases) —`);
  try {
    for (const width of widths) {
      for (const dpr of [1, 2, 3]) {
        const caseKey = `For Clubs ${width}px DPR ${dpr}`;
        const expected = width >= 1280 || dpr >= 2 ? CLUBS_1600 : CLUBS_800;
        const context = await browser.newContext({
          viewport: { width, height: 1000 },
          deviceScaleFactor: dpr,
          serviceWorkers: 'block',
          extraHTTPHeaders: { 'Cache-Control': 'no-cache' }
        });
        const page = await context.newPage();
        const session = await context.newCDPSession(page);
        await session.send('Network.setCacheDisabled', { cacheDisabled: true });
        const requested = [];
        page.on('request', (request) => {
          try {
            const pathname = new URL(request.url()).pathname;
            const prefix = '/html/landing-assets/';
            if (pathname.startsWith(prefix)) requested.push(pathname.slice(prefix.length));
          } catch {}
        });
        await page.goto(`${FOR_CLUBS_URL}?verify-landing-images=${width}-${dpr}`, {
          waitUntil: 'networkidle',
          timeout: 30000
        });
        const clubs = requested.filter((file) => CLUBS_RE.test(file));
        assertImageRequests(caseKey, 'For Clubs hero', expected, clubs);
        const geometry = await page.evaluate(() => ({
          viewportWidth: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth
        }));
        check(caseKey, 'no horizontal page overflow',
          geometry.documentWidth <= geometry.viewportWidth && geometry.bodyWidth <= geometry.viewportWidth,
          `document/body <= ${geometry.viewportWidth}px`,
          `document ${geometry.documentWidth}px, body ${geometry.bodyWidth}px`);
        if (!failedCases.has(caseKey)) {
          console.log(`  ok  ${caseKey} — hero ${receivedList(clubs)}`);
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
  verifyManifestAndReferences();
  await verifyServedFiles();
  await verifyLeaderboardImageContract();
  await verifyAuthImageContract();
  await verifyFeedImageContract();
  await verifyEventsImageContract();
  await verifyChallengesImageContract();
  await verifyBrowserMatrix();
  await verifyForClubsMatrix();
  await verifyAuthImageMatrix();
  await verifyFeedImageMatrix();
  await verifyEventsImageMatrix();
  await verifyChallengesImageMatrix();
  reportBoundaryFailures();
  if (failures) {
    console.log(`\nverify-landing-images FAILED (${failures} failures, ${passes} passes)`);
    process.exit(1);
  }
  console.log(`\nverify-landing-images OK (${passes} assertions; ${EXPECTATIONS.length * 3 + 68} browser cases; ${expectedAssetFiles().length} served files)`);
})().catch((error) => {
  console.error('verify-landing-images FATAL:', error && error.stack ? error.stack : error);
  process.exit(1);
});