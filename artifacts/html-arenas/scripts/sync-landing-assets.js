#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const HASH_LENGTH = 12;
const FORMATS = ['avif', 'webp'];

function variants(prefix, bands) {
  return bands.flatMap((band) => FORMATS.map((format) => `${prefix}-${band}.${format}`));
}

const DEFAULT_LOGICAL_ASSETS = [
  ...variants('hero-trail-runners', ['800', '1600']),
  ...variants('for-clubs-collage', ['800', '1600']),
  ...variants('leaderboards-hero-hiker', ['800', '1600']),
  ...variants('leaderboards-club-group', ['800', '1600']),
  ...variants('auth-football', ['800', '1536']),
  ...variants('feed-yoga', ['800', '1600']),
  ...variants('events-hikers', ['800', '1600']),
  ...variants('challenges-hero', ['800', '1600']),
  ...variants('analytics-weekly-activity', ['800', '1600']),
  ...variants('analytics-mobile-composite', [
    '380-2x', '380-3x', '390-2x', '390-3x',
    '600-2x', '600-3x', '767-2x', '767-3x'
  ])
].sort();

function hashedName(logicalName, digest) {
  const extension = path.extname(logicalName);
  return `${logicalName.slice(0, -extension.length)}.${digest.slice(0, HASH_LENGTH)}${extension}`;
}

function readManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return { version: 1, hashLength: HASH_LENGTH, assets: {} };
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function writeAtomic(filePath, contents) {
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, contents);
  fs.renameSync(temporary, filePath);
}

async function syncLandingAssets(options = {}) {
  const assetDir = options.assetDir ||
    path.join(__dirname, '..', 'html', 'landing-assets');
  const manifestPath = options.manifestPath || path.join(assetDir, 'manifest.json');
  const referenceFiles = options.referenceFiles || [
    path.join(__dirname, '..', 'html', 'arenas-landing-login.html'),
    path.join(__dirname, '..', 'html', 'arenas-for-clubs.html'),
    path.join(__dirname, '..', 'html', 'arenas-leaderboards.html'),
    path.join(__dirname, '..', 'html', 'arenas-feed.html'),
    path.join(__dirname, '..', 'html', 'arenas-events.html'),
    path.join(__dirname, '..', 'html', 'arenas-challenges.html')
  ];
  const logicalAssets = [...(options.logicalAssets || DEFAULT_LOGICAL_ASSETS)].sort();
  const previous = readManifest(manifestPath);
  const next = { version: 1, hashLength: HASH_LENGTH, assets: {} };
  const stagedFiles = [];

  for (const logicalName of logicalAssets) {
    const logicalPath = path.join(assetDir, logicalName);
    const previousFile = previous.assets[logicalName] && previous.assets[logicalName].file;
    const previousPath = previousFile && path.join(assetDir, previousFile);
    const inputPath = fs.existsSync(logicalPath)
      ? logicalPath
      : previousPath && fs.existsSync(previousPath)
        ? previousPath
        : null;
    if (!inputPath) throw new Error(`Missing landing asset input for ${logicalName}`);

    const bytes = fs.readFileSync(inputPath);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const file = hashedName(logicalName, sha256);
    const outputPath = path.join(assetDir, file);
    if (!fs.existsSync(outputPath)) fs.writeFileSync(outputPath, bytes);
    const metadata = await sharp(bytes).metadata();
    next.assets[logicalName] = {
      file,
      sha256,
      width: metadata.width,
      height: metadata.height
    };
    stagedFiles.push(outputPath);
  }

  const allowedFiles = new Set(Object.values(next.assets).map((entry) => entry.file));
  const rewrittenReferences = new Map();
  for (const referenceFile of referenceFiles) {
    let contents = fs.readFileSync(referenceFile, 'utf8');
    for (const logicalName of logicalAssets) {
      const previousFile = previous.assets[logicalName] && previous.assets[logicalName].file;
      const replacements = new Set([logicalName, previousFile].filter(Boolean));
      for (const oldName of replacements) {
        contents = contents.split(oldName).join(next.assets[logicalName].file);
      }
    }
    const referenced = [...contents.matchAll(/\/(?:html\/)?landing-assets\/([^"'()\s,]+)/g)]
      .map((match) => match[1]);
    const stale = referenced.filter((file) =>
      /\.(?:avif|webp)$/.test(file) && !allowedFiles.has(file));
    if (stale.length) {
      throw new Error(`${path.basename(referenceFile)} contains unmanaged landing assets: ${[...new Set(stale)].join(', ')}`);
    }
    rewrittenReferences.set(referenceFile, contents);
  }

  for (const [referenceFile, contents] of rewrittenReferences) writeAtomic(referenceFile, contents);
  writeAtomic(manifestPath, JSON.stringify(next, null, 2) + '\n');

  for (const logicalName of logicalAssets) {
    const extension = path.extname(logicalName);
    const stem = logicalName.slice(0, -extension.length);
    const managedPattern = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.[0-9a-f]{${HASH_LENGTH}}${extension.replace('.', '\\.')}$`);
    for (const file of fs.readdirSync(assetDir)) {
      if ((file === logicalName || managedPattern.test(file)) && !allowedFiles.has(file)) {
        fs.rmSync(path.join(assetDir, file), { force: true });
      }
    }
  }

  return { manifest: next, files: stagedFiles };
}

if (require.main === module) {
  syncLandingAssets()
    .then(({ manifest }) => {
      console.log(`Synced ${Object.keys(manifest.assets).length} content-hashed landing assets.`);
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}

module.exports = {
  DEFAULT_LOGICAL_ASSETS,
  HASH_LENGTH,
  hashedName,
  syncLandingAssets
};