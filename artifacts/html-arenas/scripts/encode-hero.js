#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SOURCE = path.join(__dirname, '..', 'hero-sources', 'challenges-hero-source.jpg');
const OUTPUT_DIR = path.join(__dirname, '..', 'html', 'landing-assets');
const TARGETS = [
  { suffix: '800', width: 800, height: 300 },
  { suffix: '1600', width: 1600, height: 600 }
];
// Largest exact integer 4:3 crop within 2128x739, anchored right. Keeps
// both faces and the high-five, with sky above the man's raised fingertips.
const MOBILE_CROP = { left: 1144, top: 0, width: 984, height: 738 };

async function encodeHero() {
  if (!fs.existsSync(SOURCE)) {
    throw new Error(`Missing Challenges hero source: ${SOURCE}`);
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const source = sharp(SOURCE);
  const metadata = await source.metadata();
  if (metadata.width !== 2128 || metadata.height !== 739) {
    throw new Error(
      `Unexpected Challenges hero source dimensions: ${metadata.width}x${metadata.height}; expected 2128x739`
    );
  }

  for (const target of TARGETS) {
    const pipeline = source.clone().resize({
      width: target.width,
      height: target.height,
      fit: 'cover',
      position: 'right'
    });
    await pipeline.clone().avif({ quality: 65, effort: 4 }).toFile(
      path.join(OUTPUT_DIR, `challenges-hero-${target.suffix}.avif`)
    );
    await pipeline.clone().webp({ quality: 82 }).toFile(
      path.join(OUTPUT_DIR, `challenges-hero-${target.suffix}.webp`)
    );
  }

  const mobile = source.clone().extract(MOBILE_CROP);
  await mobile.clone().avif({ quality: 65, effort: 4 }).toFile(
    path.join(OUTPUT_DIR, 'challenges-hero-mobile.avif')
  );
  await mobile.clone().webp({ quality: 82 }).toFile(
    path.join(OUTPUT_DIR, 'challenges-hero-mobile.webp')
  );
}

if (require.main === module) {
  encodeHero()
    .then(() => {
      console.log('Encoded Challenges hero at 800x300, 1600x600 and mobile 984x738 in AVIF and WebP.');
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}

module.exports = { encodeHero, SOURCE, OUTPUT_DIR, TARGETS, MOBILE_CROP };