#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUTPUT_DIR = path.join(__dirname, '..', 'html', 'landing-assets');
const HERO_CONFIGS = {
  challenges: {
    label: 'Challenges',
    prefix: 'challenges-hero',
    source: path.join(__dirname, '..', 'hero-sources', 'challenges-hero-source.jpg'),
    sourceWidth: 2128,
    sourceHeight: 739,
    targets: [
      { suffix: '800', width: 800, height: 300 },
      { suffix: '1600', width: 1600, height: 600 }
    ],
    position: 'right',
    // Largest exact integer 4:3 crop, anchored right. Keeps both faces,
    // the high-five and sky above the man's raised fingertips.
    mobileCrop: { left: 1144, top: 0, width: 984, height: 738 }
  },
  log: {
    label: 'Log',
    prefix: 'log-hero',
    source: path.join(__dirname, '..', 'hero-sources', 'log-hero-source.png'),
    sourceWidth: 2172,
    sourceHeight: 724,
    targets: [
      { suffix: '800', width: 800, height: 267 },
      { suffix: '1600', width: 1600, height: 533 }
    ],
    position: 'right',
    // Full-height exact 4:3 crop: runner's centre (~1451px in source)
    // is at 70% of crop width. Her head and entire ponytail stay inside.
    mobileCrop: { left: 776, top: 0, width: 964, height: 723 }
  }
};

async function encodeHero(hero = 'challenges', options = {}) {
  const config = HERO_CONFIGS[hero];
  if (!config) throw new Error(`Unknown hero: ${hero}; choose ${Object.keys(HERO_CONFIGS).join(', ')}`);
  const outputDir = options.outputDir || OUTPUT_DIR;
  if (!fs.existsSync(config.source)) {
    throw new Error(`Missing ${config.label} hero source: ${config.source}`);
  }
  fs.mkdirSync(outputDir, { recursive: true });

  const source = sharp(config.source);
  const metadata = await source.metadata();
  if (metadata.width !== config.sourceWidth || metadata.height !== config.sourceHeight) {
    throw new Error(
      `Unexpected ${config.label} hero source dimensions: ${metadata.width}x${metadata.height}; expected ${config.sourceWidth}x${config.sourceHeight}`
    );
  }

  for (const target of config.targets) {
    const pipeline = source.clone().resize({
      width: target.width,
      height: target.height,
      fit: 'cover',
      position: config.position
    });
    await pipeline.clone().avif({ quality: 65, effort: 4 }).toFile(
      path.join(outputDir, `${config.prefix}-${target.suffix}.avif`)
    );
    await pipeline.clone().webp({ quality: 82 }).toFile(
      path.join(outputDir, `${config.prefix}-${target.suffix}.webp`)
    );
  }

  const mobile = source.clone().extract(config.mobileCrop);
  await mobile.clone().avif({ quality: 65, effort: 4 }).toFile(
    path.join(outputDir, `${config.prefix}-mobile.avif`)
  );
  await mobile.clone().webp({ quality: 82 }).toFile(
    path.join(outputDir, `${config.prefix}-mobile.webp`)
  );
}

if (require.main === module) {
  const hero = process.argv[2] || 'challenges';
  encodeHero(hero)
    .then(() => {
      const config = HERO_CONFIGS[hero];
      console.log(`Encoded ${config.label} hero at ${config.targets.map(({ width, height }) => `${width}x${height}`).join(', ')} and mobile ${config.mobileCrop.width}x${config.mobileCrop.height} in AVIF and WebP.`);
      console.log(`Mobile source crop: ${JSON.stringify(config.mobileCrop)}`);
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}

module.exports = {
  encodeHero, HERO_CONFIGS, OUTPUT_DIR,
  // Preserve the original Challenges API for existing callers.
  SOURCE: HERO_CONFIGS.challenges.source,
  TARGETS: HERO_CONFIGS.challenges.targets,
  MOBILE_CROP: HERO_CONFIGS.challenges.mobileCrop
};