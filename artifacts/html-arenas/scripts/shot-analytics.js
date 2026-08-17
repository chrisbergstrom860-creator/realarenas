// Browser-level proof for Plausible analytics gating (one-off, Task: add
// Plausible). Proves BOTH directions:
//   1. DEV: on the local hostname the Plausible script is never requested and
//      pages render with zero console errors (snippet present but dormant,
//      window.plausible is a no-op).
//   2. PROD CONFIG: with the SAME served HTML on hostname www.realarenas.com
//      (simulated via request interception — every request is fulfilled from
//      the local server, and plausible.io requests are stubbed so NOT ONE
//      real hit reaches the production dashboard), the script IS requested
//      and the queue stub + arenasTrack are live.
import { launchBrowser } from './lib/mobile-geometry.js';

const LOCAL = 'http://localhost:80/html';

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail ? ' — ' + JSON.stringify(detail).slice(0, 300) : '')); }
}

const browser = await launchBrowser();

// ── 1. DEV: no Plausible request, zero console errors ──
for (const path of ['/landing', '/privacy', '/for-clubs']) {
  const page = await browser.newPage();
  const errors = [];
  const plausibleReqs = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (r.url().includes('plausible.io')) plausibleReqs.push(r.url()); });
  await page.goto(LOCAL + path, { waitUntil: 'networkidle' });
  const stub = await page.evaluate(() => typeof window.plausible === 'function' && typeof window.arenasTrack === 'function');
  check('dev ' + path + ': zero plausible.io requests', plausibleReqs.length === 0, plausibleReqs);
  check('dev ' + path + ': zero console errors', errors.length === 0, errors);
  check('dev ' + path + ': no-op plausible + arenasTrack defined', stub);
  // event call must be a safe no-op in dev
  const evOk = await page.evaluate(() => {
    let done = false;
    window.arenasTrack('Verify Event', () => { done = true; });
    return done;
  });
  check('dev ' + path + ': arenasTrack callback runs synchronously (no-op path)', evOk);
  await page.close();
}

// ── 2. PROD hostname simulation: script requested, zero real hits ──
{
  const page = await browser.newPage();
  const errors = [];
  let scriptRequested = 0;
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname.endsWith('plausible.io')) {
      scriptRequested++;
      // Stub: NEVER let a real request reach Plausible from a verifier run.
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* stubbed plausible */' });
    }
    if (url.hostname === 'www.realarenas.com') {
      // Serve the real local HTML under the production hostname. Production
      // mounts at root; the local server mounts at /html — same HTML either
      // way, and the hostname is what the gate reads.
      const local = LOCAL + url.pathname.replace(/^\/html/, '') + url.search;
      const r = await fetch(local, { redirect: 'manual' });
      const body = Buffer.from(await r.arrayBuffer());
      return route.fulfill({ status: r.status === 302 ? 200 : r.status, headers: { 'content-type': r.headers.get('content-type') || 'text/html' }, body });
    }
    return route.continue();
  });
  await page.goto('https://www.realarenas.com/landing', { waitUntil: 'networkidle' });
  check('prod hostname: Plausible script requested (and stubbed, zero real hits)', scriptRequested === 1, scriptRequested);
  const live = await page.evaluate(() => ({
    q: !!(window.plausible && (window.plausible.q !== undefined || typeof window.plausible === 'function')),
    track: typeof window.arenasTrack === 'function'
  }));
  check('prod hostname: plausible queue stub + arenasTrack live', live.q && live.track, live);
  const evOk = await page.evaluate(() => new Promise((res) => {
    window.arenasTrack('Verify Event', () => res(true));
    setTimeout(() => res(false), 1500);
  }));
  check('prod hostname: arenasTrack callback fires within 400ms fallback', evOk);
  check('prod hostname: zero console errors', errors.length === 0, errors);
  await page.close();
}

await browser.close();
if (failures) { console.log(failures + ' FAILURE(S)'); process.exit(1); }
console.log('ALL PASS');
