// Verifies the events-image manager (#evx-img-modal) after its migration onto
// the shared arenasOverlay primitive — specifically the FOUR behaviors the
// migration introduced (they did not exist on the hand-rolled version):
//   1. Escape closes the manager
//   2. body scroll lock applies while open and restores on close
//   3. focus returns to the trigger element on close
//   4. with the crop overlay open on top, Escape closes CROP first, manager second
// plus the new beforeClose dirty-guard (backdrop with a selected-but-not-
// uploaded image asks before discarding; dismissing keeps the modal) and the
// same-id replacement path.
//
// Runs against the public landing page with the module scripts injected — no
// auth, no data seeded, nothing to clean up.
//   node artifacts/html-arenas/scripts/verify-img-overlay.js

import { launchBrowser } from './lib/mobile-geometry.js';

const BASE = 'http://localhost:80/html';
let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail ? ' — ' + String(detail).slice(0, 300) : '')); }
}

// A real decodable PNG (600x200, 3:1) so the crop step opens for file tests —
// rendered by the browser itself (no pngjs dependency).
let pngBuf = null;
async function makePng() {
  if (pngBuf) return pngBuf;
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 600; c.height = 200;
    const x = c.getContext('2d');
    x.fillStyle = '#C81E1E'; x.fillRect(0, 0, 600, 200);
    return c.toDataURL('image/png').split(',')[1];
  });
  pngBuf = Buffer.from(b64, 'base64');
  return pngBuf;
}

const browser = await launchBrowser();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE + '/landing', { waitUntil: 'domcontentloaded' });
for (const s of ['arenas-overlay.js', 'arenas-crop.js', 'arenas-sports.js', 'arenas-event-form.js']) {
  await page.addScriptTag({ url: BASE + '/' + s }).catch(() => {});
}
check('module scripts loaded (arenasEventForm present)',
  await page.evaluate(() => !!(window.arenasEventForm && window.arenasOverlay && window.arenasCrop)));

// Contract guard: arenasCrop.open() MUST return a {cancel} handle on the
// normal path. It once only returned from the no-primitive early exit, so
// every caller's cropHandle was undefined and mid-decode cancellation
// silently never worked — this pins the contract so it can't regress quietly.
check('arenasCrop.open returns a {cancel} handle on the normal path',
  await page.evaluate(() => {
    const h = window.arenasCrop.open({ image: 'data:image/png;base64,AAAA', onCancel: () => {} });
    const ok = !!(h && typeof h.cancel === 'function');
    if (ok) h.cancel(); // abort the doomed decode; nothing may open later
    return ok;
  }));

// Trigger button — the element focus must return to.
await page.evaluate(() => {
  const b = document.createElement('button');
  b.id = 'img-trigger';
  b.textContent = 'Image';
  document.body.appendChild(b);
});

async function openManager() {
  await page.evaluate(() => {
    document.getElementById('img-trigger').focus();
    window.arenasEventForm.manageImage({ id: '00000000-0000-4000-8000-000000000000', image: null }, {});
  });
  await page.waitForSelector('#evx-img-modal', { timeout: 3000 });
}
const state = () => page.evaluate(() => ({
  modal: !!document.getElementById('evx-img-modal'),
  crop: !!document.getElementById('arenas-crop-overlay'),
  overflow: document.body.style.overflow,
  focused: document.activeElement && document.activeElement.id,
  role: (function (p) { return p && p.firstElementChild && p.firstElementChild.getAttribute('role') + '/' + p.firstElementChild.getAttribute('aria-modal'); })(document.getElementById('evx-img-modal'))
}));

// ── 1+2: open → aria + scroll lock; Escape closes; lock restores; focus returns ──
await openManager();
let s = await state();
check('open: panel has role=dialog aria-modal=true', s.role === 'dialog/true', s.role);
check('open: body scroll locked', s.overflow === 'hidden', s.overflow);
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
s = await state();
check('Escape closes the manager (no file selected)', !s.modal);
check('close: body scroll restored', s.overflow !== 'hidden', s.overflow);
check('close: focus returned to the trigger', s.focused === 'img-trigger', s.focused);

// ── 4: with the crop overlay open, Escape closes crop FIRST, manager second ──
await openManager();
await page.setInputFiles('#evx-img-file', { name: 'band.png', mimeType: 'image/png', buffer: await makePng() });
await page.waitForSelector('#arenas-crop-overlay', { timeout: 5000 });
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
s = await state();
check('Escape #1 closes the crop overlay, not the manager', !s.crop && s.modal, JSON.stringify(s));
// crop cancel (non-decode) resets the file selection → guard disarmed
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
s = await state();
check('Escape #2 then closes the manager (crop cancel disarmed the guard)', !s.modal, JSON.stringify(s));
check('after nested close: scroll restored + focus on trigger',
  s.overflow !== 'hidden' && s.focused === 'img-trigger', JSON.stringify(s));

// ── beforeClose guard: accepted crop + backdrop → confirm; dismiss keeps it ──
await openManager();
await page.setInputFiles('#evx-img-file', { name: 'band.png', mimeType: 'image/png', buffer: await makePng() });
await page.waitForSelector('#arenas-crop-overlay #ac-use', { timeout: 5000 });
await page.click('#arenas-crop-overlay #ac-use');
await page.waitForFunction(() => !document.getElementById('arenas-crop-overlay'), { timeout: 5000 });
check('crop accepted: Upload enabled', await page.evaluate(() => !document.getElementById('evx-img-up').disabled));
let dialogSeen = null;
page.once('dialog', (d) => { dialogSeen = d.message(); d.dismiss(); });
await page.mouse.click(20, 400); // backdrop, far from the 420px-centered panel
await page.waitForTimeout(200);
s = await state();
check('backdrop with un-uploaded crop asks before discarding', !!dialogSeen, String(dialogSeen));
check('dismissing the confirm keeps the manager open', s.modal, JSON.stringify(s));
page.once('dialog', (d) => d.accept());
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
s = await state();
check('accepting the confirm closes the manager', !s.modal, JSON.stringify(s));

// ── same-id replacement: reopening yields exactly one overlay ──
await openManager();
await openManager();
const count = await page.evaluate(() => document.querySelectorAll('#evx-img-modal').length);
check('same-id replacement leaves exactly one manager overlay', count === 1, count);
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// ── mid-decode cancellation race: replace / ✕ the manager while a crop decode
// is still in flight — no crop overlay may arrive late (the historical trap).
async function midDecodeRace(closeHow) {
  await openManager();
  await page.setInputFiles('#evx-img-file', { name: 'band.png', mimeType: 'image/png', buffer: await makePng() });
  // Close IMMEDIATELY — decode may or may not have finished; either way the
  // onClose cancellation must ensure no crop overlay survives or arrives late.
  await closeHow();
  let lateCrop = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 1500) {
    const diag = await page.evaluate(() => {
      const c = document.getElementById('arenas-crop-overlay');
      return c ? { modal: !!document.getElementById('evx-img-modal'), snippet: c.innerHTML.slice(0, 80) } : null;
    });
    if (diag) { lateCrop = true; console.log('  late crop diag: ' + JSON.stringify(diag)); break; }
    await page.waitForTimeout(50);
  }
  return lateCrop;
}
check('same-id replacement mid-decode: no late crop overlay',
  !(await midDecodeRace(() => openManager())));
await page.keyboard.press('Escape'); // close the replacement instance
await page.waitForTimeout(150);
check('✕ mid-decode: no late crop overlay',
  // Direct DOM click: if the decode already won the race the crop overlay
  // covers the ✕, and a pointer click would be intercepted — the point here
  // is the cancellation contract, not pointer reachability.
  !(await midDecodeRace(() => page.evaluate(() => document.getElementById('evx-img-x').click()))));

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
