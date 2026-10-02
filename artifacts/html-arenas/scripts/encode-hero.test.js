'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');
const { encodeHero, HERO_CONFIGS } = require('./encode-hero');

test('hero configs retain Challenges geometry and Log art direction', () => {
  assert.deepEqual(HERO_CONFIGS.challenges.targets, [
    { suffix: '800', width: 800, height: 300 },
    { suffix: '1600', width: 1600, height: 600 }
  ]);
  assert.deepEqual(HERO_CONFIGS.challenges.mobileCrop,
    { left: 1144, top: 0, width: 984, height: 738 });
  assert.deepEqual(HERO_CONFIGS.log.targets, [
    { suffix: '800', width: 800, height: 267 },
    { suffix: '1600', width: 1600, height: 533 }
  ]);
  const { left, top, width, height } = HERO_CONFIGS.log.mobileCrop;
  assert.equal(width * 3, height * 4);
  assert.ok(left >= 0 && top >= 0 && left + width <= 2172 && top + height <= 724);
  assert.ok(Math.abs((1451 - left) / width - 0.7) < 0.01);
  // Source-space bounding area enclosing the runner's head and ponytail.
  assert.ok(left < 1250 && left + width > 1525 && top < 220 && top + height > 400);
});

test('generalized Challenges encoding remains byte-identical to approved assets', {
  skip: !fs.existsSync(HERO_CONFIGS.challenges.source) && 'Ignored original source not available'
}, async (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'challenges-encode-parity-'));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const expected = {
    '800.avif': 'bbb206051b9e7966c7b8dc3012074a2ffcd178ca16a4e9fb1e517da93e6f5c6c',
    '800.webp': 'dc99b02eaff9690e5a0a2cc343ca32fc9ff6e53ecdec825ef0dc2aff852f9980',
    '1600.avif': 'eb00222d9f8b055b0fa17e4a1b52b70b5d268da1c77c7b7a7c36d4798d709174',
    '1600.webp': 'e5b96a36ec223f380959f6ecb5213d510e3ae00db438e9aa833af95351adfe29',
    'mobile.avif': 'c2c8d40c0bf28b8c3198c274e83ebb3eeeef6271419bd506a8252e1851286a77',
    'mobile.webp': 'e22fbc720b9354245ad4abe462bfc74d03409bddd78b88c67ca0e6c4a281375b'
  };
  await encodeHero('challenges', { outputDir });
  for (const [suffix, digest] of Object.entries(expected)) {
    const bytes = fs.readFileSync(path.join(outputDir, `challenges-hero-${suffix}`));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), digest, suffix);
  }
});

test('Log encoding emits the configured desktop and mobile dimensions', {
  skip: !fs.existsSync(HERO_CONFIGS.log.source) && 'Ignored original source not available'
}, async (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-encode-dimensions-'));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  await encodeHero('log', { outputDir });
  for (const target of [
    ...HERO_CONFIGS.log.targets,
    { suffix: 'mobile', ...HERO_CONFIGS.log.mobileCrop }
  ]) {
    for (const format of ['avif', 'webp']) {
      const metadata = await sharp(path.join(outputDir, `log-hero-${target.suffix}.${format}`)).metadata();
      assert.equal(metadata.width, target.width);
      assert.equal(metadata.height, target.height);
    }
  }
});
test('Athletes encoding emits configured dimensions and the approved face-safe crop', {
  skip: !fs.existsSync(HERO_CONFIGS.athletes.source) && 'Ignored original source not available'
}, async (t) => {
  assert.deepEqual(HERO_CONFIGS.athletes.mobileCrop, { left: 604, top: 0, width: 964, height: 723 });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'athletes-encode-dimensions-'));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  await encodeHero('athletes', { outputDir });
  for (const target of [
    ...HERO_CONFIGS.athletes.targets,
    { suffix: 'mobile', ...HERO_CONFIGS.athletes.mobileCrop }
  ]) {
    for (const format of ['avif', 'webp']) {
      const metadata = await sharp(path.join(outputDir, `athletes-hero-${target.suffix}.${format}`)).metadata();
      assert.equal(metadata.width, target.width);
      assert.equal(metadata.height, target.height);
    }
  }
});

test('Adding the athletes entry leaves Challenges and Log outputs byte-identical to the committed manifest', {
  skip: !(fs.existsSync(HERO_CONFIGS.challenges.source) && fs.existsSync(HERO_CONFIGS.log.source)) && 'Ignored original sources not available'
}, async (t) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'html', 'landing-assets', 'manifest.json'), 'utf8'));
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-byte-identity-'));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  for (const hero of ['challenges', 'log']) {
    await encodeHero(hero, { outputDir });
    for (const band of ['800', '1600', 'mobile']) {
      for (const format of ['avif', 'webp']) {
        const name = `${HERO_CONFIGS[hero].prefix}-${band}.${format}`;
        const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(outputDir, name))).digest('hex');
        assert.equal(digest, manifest.assets[name].sha256, name);
      }
    }
  }
});
