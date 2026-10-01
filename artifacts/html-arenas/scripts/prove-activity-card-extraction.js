// Capture BEFORE any production edit:
// node scripts/prove-activity-card-extraction.js --capture-before
// Then compare the working tree using the identical harness:
// node scripts/prove-activity-card-extraction.js
// Evidence/snapshotted sources are in /tmp/activity-card-extraction-proof.
// To reproduce in a fresh checkout AFTER extraction, first capture the pinned
// historical tree: --capture-before --baseline-ref=82a1d19297cc7d8a77b2a9dd5441312b6506a11c
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { launchBrowser } from './lib/mobile-geometry.js';
import { sources, widths, proofDirectory, capture } from './lib/activity-card-proof.js';

fs.mkdirSync(proofDirectory, { recursive: true });
const baselineFile = path.join(proofDirectory, 'before.json');
const beforeMode = process.argv.includes('--capture-before');
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  if (beforeMode) {
    assert.ok(!fs.existsSync(baselineFile), 'Do not overwrite genuine pre-edit evidence');
    const refArgument = process.argv.find(argument => argument.startsWith('--baseline-ref='));
    const source = sources(refArgument ? refArgument.slice('--baseline-ref='.length) : undefined);
    assert.ok(!source.feed.includes('wrap.innerHTML = window.activityCardHtml'),
      'Baseline must be captured before extracting the feed renderer');
    const renders = [];
    for (const width of widths) for (const expanded of [false, true]) {
      const result = await capture(page, source, width, 'before', expanded);
      renders.push({ width, expanded, ...result });
      console.log(`Captured before ${width}, expanded=${expanded}: ${result.png}`);
    }
    fs.writeFileSync(baselineFile, JSON.stringify({ source, renders }, null, 2));
    console.log('Baseline source SHA256:', crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex'));
  } else {
    assert.ok(fs.existsSync(baselineFile), 'Capture the baseline before editing');
    const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
    const current = sources();
    const results = [];
    // Preserve the complete before capture sequence, including click-induced
    // scrolling/compositor state. Interleaving baseline and new renders would
    // create a different browser-state history from the genuine before run.
    const replays = [];
    for (const before of baseline.renders) {
      replays.push(await capture(page, baseline.source, before.width, 'replay', before.expanded));
    }
    const afterPage = await browser.newPage({ reducedMotion: 'reduce' });
    const afterRenders = [];
    for (const before of baseline.renders) {
      afterRenders.push(await capture(afterPage, current, before.width, 'after', before.expanded));
    }
    for (const [index, before] of baseline.renders.entries()) {
      const replay = replays[index];
      const after = afterRenders[index];
      for (const render of [replay, after]) {
        assert.equal(render.html, before.html, 'Exact feed HTML must be unchanged');
        assert.deepEqual(render.tree, before.tree, 'Tag/class structure must be unchanged');
        assert.deepEqual(render.metadata, before.metadata, 'Sort/filter metadata must be unchanged');
        assert.equal(render.overflow, before.overflow);
      }
      // Expansion is covered by exact HTML/tree/metadata parity and behavioral
      // tests. Its automatic scrolling can alter compositor antialiasing.
      // The required pixel proof is the untouched feed at each of 3 widths.
      if (before.expanded) continue;
      const images = await Promise.all([before.png, replay.png, after.png].map(file =>
        sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
      for (const image of images.slice(1)) {
        assert.deepEqual(image.info, images[0].info, 'Screenshot dimensions match');
        assert.ok(image.data.equals(images[0].data), 'Raw RGBA pixels must be byte-identical (no tolerance)');
      }
      const result = { width: before.width, expanded: before.expanded,
        changedPixels: 0, changedComponents: 0, htmlDiff: 0, structureDiff: 0,
        metadataDiff: 0, baselineReproducible: true, dimensions: images[0].info };
      results.push(result);
      console.log(JSON.stringify(result));
    }
    fs.writeFileSync(path.join(proofDirectory, 'results.json'), JSON.stringify(results, null, 2));
    console.log(`ALL ${results.length} FEED EXTRACTION PROOFS PASSED (strict zero pixel/structure diff)`);
  }
} finally {
  await browser.close();
}