// Verifies the CLIENT-SIDE cropper (html/arenas-crop.js) exports the region
// the user chose — the part the server-side suite cannot prove (the server
// diff is empty; its cover-resize is a no-op on exact-3:1 input by design).
//
// Method: a 300×900 source with three distinct 300px sentinel bands
// (red top / green middle / blue bottom). Drive the REAL UI (slider input →
// "Use this crop" click) to each extreme and the center, decode the exported
// blob, and assert its pixels are the expected band. If the drag/slider
// offset were ignored, every export would be the center band (green) and the
// top/bottom assertions would FAIL — the test is sensitive to exactly that
// regression. Also: export is always 1200×400 PNG; a genuinely all-black
// source still exports (the blank-guard must not false-positive); an
// undecodable file reports the decode fallback.
//
// Run with the dev server up (loads the public landing page for the scripts):
//   node artifacts/html-arenas/scripts/verify-crop-ui.js
// No data is seeded — nothing to clean up.

import { launchBrowser } from './lib/mobile-geometry.js';

const BASE = 'http://localhost:80/html';
let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail ? ' — ' + String(detail).slice(0, 300) : '')); }
}

const browser = await launchBrowser();
const page = await (await browser.newContext({ viewport: { width: 360, height: 780 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE + '/landing', { waitUntil: 'domcontentloaded' });
await page.addScriptTag({ url: BASE + '/arenas-overlay.js' });
await page.addScriptTag({ url: BASE + '/arenas-crop.js' });

// Drive the real UI: open with a sentinel-band source, set the slider,
// click "Use this crop", decode the blob, return band votes + dimensions.
async function cropAt(sliderValue, opts = {}) {
  return page.evaluate(async ({ sliderValue, allBlack }) => {
    const src = document.createElement('canvas');
    src.width = 300; src.height = 900;
    const x = src.getContext('2d');
    if (allBlack) { x.fillStyle = '#000'; x.fillRect(0, 0, 300, 900); }
    else {
      x.fillStyle = '#E11'; x.fillRect(0, 0, 300, 300);    // top    = red
      x.fillStyle = '#1B1'; x.fillRect(0, 300, 300, 300);  // middle = green
      x.fillStyle = '#11E'; x.fillRect(0, 600, 300, 300);  // bottom = blue
    }
    const blob = await new Promise((resolve, reject) => {
      window.arenasCrop.open({
        image: src.toDataURL(),
        onDone: resolve,
        onCancel: (r) => reject(new Error('cancelled: ' + r))
      });
      // The overlay builds after an async decode — poll for the controls.
      const t0 = Date.now();
      (function drive() {
        const slider = document.querySelector('#arenas-crop-overlay #ac-slider');
        const use = document.querySelector('#arenas-crop-overlay #ac-use');
        if (slider && use) {
          slider.value = String(sliderValue);
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          use.click();
          const err = document.querySelector('#arenas-crop-overlay #ac-err');
          if (err && err.style.display !== 'none') reject(new Error('guard: ' + err.textContent));
        } else if (Date.now() - t0 > 5000) reject(new Error('crop UI never appeared'));
        else setTimeout(drive, 25);
      })();
    });
    // Decode the exported blob and classify a pixel grid by dominant channel.
    const img = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const votes = { red: 0, green: 0, blue: 0, black: 0 };
    for (let gy = 0; gy < 6; gy++) for (let gx = 0; gx < 6; gx++) {
      const i = ((Math.floor((gy + 0.5) * c.height / 6) * c.width) + Math.floor((gx + 0.5) * c.width / 6)) * 4;
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
      if (r < 30 && g < 30 && b < 30) votes.black++;
      else if (r > g && r > b) votes.red++;
      else if (g > r && g > b) votes.green++;
      else votes.blue++;
    }
    return { w: img.width, h: img.height, type: blob.type, votes };
  }, { sliderValue, allBlack: !!opts.allBlack });
}

const top = await cropAt(0);
const mid = await cropAt(500);
const bot = await cropAt(1000);

check('export is 1200×400 PNG', top.w === 1200 && top.h === 400 && top.type === 'image/png', JSON.stringify(top));
// A 300×900 source cropped to 3:1 keeps a 300×100 slice: slider 0 must land
// entirely inside the top (red) band, 1000 inside the bottom (blue) band.
check('slider 0 keeps the TOP band (all red)', top.votes.red === 36, JSON.stringify(top.votes));
check('slider 500 keeps the MIDDLE band (all green)', mid.votes.green === 36, JSON.stringify(mid.votes));
check('slider 1000 keeps the BOTTOM band (all blue)', bot.votes.blue === 36, JSON.stringify(bot.votes));
check('offset honored (extremes differ — fails if drag/slider ignored)',
  JSON.stringify(top.votes) !== JSON.stringify(bot.votes), 'both = ' + JSON.stringify(top.votes));

// Blank-guard must NOT false-positive on a genuinely black photo (source
// region is black too → export allowed).
const black = await cropAt(500, { allBlack: true });
check('all-black source still exports (guard compares against source)', black.votes.black === 36, JSON.stringify(black));

// Undecodable file → onCancel('decode') (the events pages fall back to the
// raw file and the server center-crops).
const decodeReason = await page.evaluate(() => new Promise((resolve) => {
  window.arenasCrop.open({
    file: new File([new Uint8Array([1, 2, 3, 4])], 'junk.png', { type: 'image/png' }),
    onDone: () => resolve('done?!'),
    onCancel: (r) => resolve(r)
  });
  setTimeout(() => resolve('timeout'), 5000);
}));
check("undecodable file → onCancel('decode') fallback", decodeReason === 'decode', decodeReason);

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
