#!/usr/bin/env node
// Generate html/favicon.ico (multi-size, PNG-compressed ICO: 16/32/48) from
// the same brand-mark master the PWA icons use (html/arenas-icon.svg), so the
// favicon can never drift from the installed-app icon.
//
// PNG-in-ICO is valid for all modern browsers (IE<11 is the only casualty).
// Pages also link the SVG itself (<link rel="icon" type="image/svg+xml">);
// the .ico is the raster fallback and kills the default /favicon.ico 404.
//
// Run: node scripts/generate-favicon.js   (from artifacts/html-arenas)
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'html', 'arenas-icon.svg');
const OUT = path.join(ROOT, 'html', 'favicon.ico');
const SIZES = [16, 32, 48];

function packIco(pngs) {
  // ICONDIR (6 bytes) + ICONDIRENTRY (16 bytes each) + PNG blobs.
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);            // reserved
  header.writeUInt16LE(1, 2);            // type: icon
  header.writeUInt16LE(pngs.length, 4);  // count
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size === 256 ? 0 : size, 0); // width (0 = 256)
    e.writeUInt8(size === 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2);                       // palette count
    e.writeUInt8(0, 3);                       // reserved
    e.writeUInt16LE(1, 4);                    // color planes
    e.writeUInt16LE(32, 6);                   // bits per pixel
    e.writeUInt32LE(buf.length, 8);           // blob size
    e.writeUInt32LE(offset, 12);              // blob offset
    entries.push(e);
    offset += buf.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map(p => p.buf)]);
}

async function main() {
  if (!fs.existsSync(SRC)) throw new Error('missing ' + SRC);
  const pngs = [];
  for (const size of SIZES) {
    const buf = await sharp(SRC, { density: 300 }).resize(size, size).png().toBuffer();
    pngs.push({ size, buf });
    console.log(`favicon layer: ${size}x${size} (${buf.length} bytes)`);
  }
  fs.writeFileSync(OUT, packIco(pngs));
  console.log(`wrote ${path.relative(ROOT, OUT)} (${fs.statSync(OUT).size} bytes, sizes: ${SIZES.join('/')})`);
}

main().catch(err => { console.error(err); process.exit(1); });
