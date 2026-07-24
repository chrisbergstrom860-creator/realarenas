#!/usr/bin/env node
// Generate the Arenas PWA icon set from the brand-mark SVG using sharp.
//
// Source of truth: html/arenas-icon.svg (yellow rounded square + drawn
// stadium-track glyph). Three variants are rasterized:
//   1. "any" icons (192/512): the rounded square as-is, transparent corners.
//   2. maskable 512: FULL-BLEED yellow (no rounded corners — the platform
//      mask supplies the shape) with the glyph shrunk into the safe zone
//      (a centered circle of r = 40% of the canvas survives every Android
//      mask shape; we keep the glyph inside ~78% of that to be safe).
//   3. apple-touch-icon 180: full-bleed yellow square (iOS applies its own
//      corner rounding; transparent corners would render black).
//
// Also writes /tmp/arenas-icon-mask-preview.png — the maskable icon under a
// circle mask (the tightest standard mask) so the safe zone can be checked
// visually.
//
// Run: node scripts/generate-icons.js   (from artifacts/html-arenas)

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'html', 'icons');
const SRC = path.join(ROOT, 'html', 'arenas-icon.svg');

// The glyph elements only (no background), centered on a 512 canvas — reused
// by every variant so the mark can never drift between them.
const GLYPH = `
  <rect x="118" y="170" width="276" height="172" rx="86" fill="none" stroke="#111827" stroke-width="30"/>
  <rect x="182" y="224" width="148" height="64" rx="32" fill="none" stroke="#111827" stroke-width="20"/>
  <rect x="248" y="152" width="16" height="58" rx="8" fill="#111827"/>`;

function svgRounded() {
  // Same geometry as html/arenas-icon.svg (kept in one string here so the
  // generator is self-contained; the .svg file is the human-readable master).
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <rect x="0" y="0" width="512" height="512" rx="110" fill="#FFD21E"/>${GLYPH}
  </svg>`;
}

function svgFullBleed(glyphScale) {
  // Full-bleed yellow; glyph optionally scaled about the canvas center.
  const s = glyphScale || 1;
  const t = 256 * (1 - s);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <rect x="0" y="0" width="512" height="512" fill="#FFD21E"/>
    <g transform="translate(${t} ${t}) scale(${s})">${GLYPH}</g>
  </svg>`;
}

async function main() {
  if (!fs.existsSync(SRC)) throw new Error('missing ' + SRC);
  fs.mkdirSync(OUT, { recursive: true });

  const jobs = [
    // "any" purpose — rounded square with transparent corners
    { svg: svgRounded(), size: 192, file: 'icon-192.png' },
    { svg: svgRounded(), size: 512, file: 'icon-512.png' },
    // maskable — full bleed, glyph pulled in for the safe zone.
    // Glyph bounding box at scale .9: 276*.9=248w, (342-158)*.9=166h around
    // center → half-diagonal ≈ √(124²+83²) ≈ 149px < 205px safe-zone radius.
    { svg: svgFullBleed(0.9), size: 512, file: 'icon-maskable-512.png' },
    // apple-touch-icon — full bleed at the glyph's natural size
    { svg: svgFullBleed(1), size: 180, file: 'apple-touch-icon.png' }
  ];

  for (const j of jobs) {
    await sharp(Buffer.from(j.svg), { density: 300 })
      .resize(j.size, j.size)
      .png()
      .toFile(path.join(OUT, j.file));
    const meta = await sharp(path.join(OUT, j.file)).metadata();
    console.log(`${j.file}: ${meta.width}x${meta.height} (${meta.format})`);
  }

  // Mask preview: maskable icon under a circle mask — the tightest mask
  // Android uses. The glyph must sit fully inside the circle.
  const circle = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
       <circle cx="256" cy="256" r="256" fill="#fff"/>
     </svg>`
  );
  await sharp(path.join(OUT, 'icon-maskable-512.png'))
    .composite([{ input: circle, blend: 'dest-in' }])
    .png()
    .toFile('/tmp/arenas-icon-mask-preview.png');
  console.log('mask preview: /tmp/arenas-icon-mask-preview.png');
}

main().catch((err) => { console.error(err); process.exit(1); });
