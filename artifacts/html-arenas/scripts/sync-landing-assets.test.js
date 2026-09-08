'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const sharp = require('sharp');
const { syncLandingAssets } = require('./sync-landing-assets');

test('re-encoding an image changes its hashed name, rewrites references, and removes the old file', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'landing-asset-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const assetDir = path.join(root, 'landing-assets');
  const referenceFile = path.join(root, 'page.html');
  const styleFile = path.join(root, 'styles.html');
  const manifestPath = path.join(assetDir, 'manifest.json');
  const logicalName = 'fixture-800.avif';
  fs.mkdirSync(assetDir, { recursive: true });
  fs.writeFileSync(referenceFile,
    `<link rel="preload" href="/html/landing-assets/${logicalName}">` +
    `<picture><source srcset="/html/landing-assets/${logicalName} 800w">` +
    `<img src="/html/landing-assets/${logicalName}"></picture>`);
  fs.writeFileSync(styleFile,
    `<style>.hero{background-image:image-set(url('/html/landing-assets/${logicalName}') 1x)}</style>`);

  await sharp({
    create: { width: 8, height: 4, channels: 3, background: '#112233' }
  }).avif().toFile(path.join(assetDir, logicalName));
  const first = await syncLandingAssets({
    assetDir,
    manifestPath,
    referenceFiles: [referenceFile, styleFile],
    logicalAssets: [logicalName]
  });
  const firstName = first.manifest.assets[logicalName].file;
  assert.match(firstName, /^fixture-800\.[0-9a-f]{12}\.avif$/);
  assert.equal(fs.readFileSync(referenceFile, 'utf8').split(firstName).length - 1, 3);
  assert.equal(fs.readFileSync(styleFile, 'utf8').split(firstName).length - 1, 1);
  assert.equal(fs.existsSync(path.join(assetDir, logicalName)), false);

  await sharp({
    create: { width: 8, height: 4, channels: 3, background: '#aa5500' }
  }).avif().toFile(path.join(assetDir, logicalName));
  const second = await syncLandingAssets({
    assetDir,
    manifestPath,
    referenceFiles: [referenceFile, styleFile],
    logicalAssets: [logicalName]
  });
  const secondName = second.manifest.assets[logicalName].file;
  const rewritten = fs.readFileSync(referenceFile, 'utf8') + fs.readFileSync(styleFile, 'utf8');
  assert.notEqual(secondName, firstName);
  assert.match(rewritten, new RegExp(secondName.replace(/\./g, '\\.')));
  assert.equal(rewritten.includes(firstName), false);
  assert.equal(fs.existsSync(path.join(assetDir, firstName)), false);
  assert.equal(fs.existsSync(path.join(assetDir, secondName)), true);
});