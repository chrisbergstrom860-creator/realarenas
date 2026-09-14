// No-visible-change proof for the Insights extraction commit.
//
// It renders the pre-extraction panel directly from git ee99f48 and the
// working-tree container module with the same profile shell fixture and
// deterministic in-memory API.  It never starts the app, contacts a model,
// reads a database, or creates seeded data.
//
// Run: node scripts/prove-insights-extraction.js
// Diagnostic PNGs: /tmp/insights-extraction-{legacy,module}-{state}-{width}.png
import path from 'node:path';
import sharp from 'sharp';
import { launchBrowser } from './lib/mobile-geometry.js';
import {
  baselineCss,
  baselineProfile,
  classTree,
  currentCss,
  currentModule,
  legacyInsightsScript,
  proofFixtures,
  setProofPage,
  submitProofFixture
} from './lib/insights-proof.js';

const WIDTHS = [360, 414, 1280];
let assertions = 0;
let failures = 0;

function check(name, condition, detail = '') {
  assertions++;
  if (condition) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function render(page, implementation, width, state, sources) {
  const legacy = implementation === 'legacy';
  await setProofPage(page, {
    width,
    css: legacy ? sources.legacyCss : sources.moduleCss,
    legacySource: legacy ? sources.legacyScript : undefined,
    moduleSource: legacy ? undefined : sources.moduleScript
  });
  await submitProofFixture(page, proofFixtures[state]);
  // The real profile tab has a fade-up entrance.  Capture its settled visual
  // state rather than racing two otherwise-identical animation frames.
  await page.waitForTimeout(300);
  const tree = await classTree(page);
  const host = page.locator('#tab-insights');
  const summary = await host.evaluate((element) => ({
    chartCount: element.querySelectorAll('.ai-chart').length,
    svgCount: element.querySelectorAll('svg[role="img"]').length,
    barCount: element.querySelectorAll('.ai-chart-bar').length,
    legendItems: element.querySelectorAll('.ai-chart-legend-item').length,
    pageOverflow: document.documentElement.scrollWidth - innerWidth
  }));
  const png = path.join('/tmp', `insights-extraction-${implementation}-${state}-${width}.png`);
  await page.screenshot({ path: png, fullPage: true });
  return { png, tree, summary };
}

async function pixelDifference(left, right) {
  const [a, b] = await Promise.all([
    sharp(left).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(right).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  ]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height || a.info.channels !== b.info.channels) {
    return { compatible: false, left: a.info, right: b.info };
  }
  let changed = 0;
  let largest = 0;
  let total = 0;
  // Ignore imperceptible single-channel antialiasing noise, but do not mask
  // regions or DOM classes.  A layout/color/text difference is overwhelmingly
  // larger than this 2/255 component tolerance.
  for (let i = 0; i < a.data.length; i += a.info.channels) {
    let pixelLargest = 0;
    for (let channel = 0; channel < a.info.channels; channel++) {
      const delta = Math.abs(a.data[i + channel] - b.data[i + channel]);
      pixelLargest = Math.max(pixelLargest, delta);
      largest = Math.max(largest, delta);
      total += delta;
    }
    if (pixelLargest > 2) changed++;
  }
  return {
    compatible: true,
    pixels: a.info.width * a.info.height,
    changed,
    changedPercent: Number((changed / (a.info.width * a.info.height) * 100).toFixed(6)),
    largest,
    meanComponentDelta: Number((total / a.data.length).toFixed(6))
  };
}

let browser;
try {
  const profile = baselineProfile();
  const sources = {
    // The legacy source injects its own ai2 rules.  Each rendition therefore
    // gets its real shell stylesheet: ee99f48 for before, working-tree static
    // arenas.css for after.
    legacyCss: baselineCss(),
    moduleCss: currentCss(),
    legacyScript: legacyInsightsScript(profile),
    moduleScript: currentModule()
  };

  // This proves that the modern rendition uses static CSS in arenas.css rather
  // than borrowing the legacy script’s dynamically-injected rules.  The
  // before/after screenshots above each use their own real stylesheet.
  check('modern arenas.css contains every static Insights selector family',
    ['.ai2-hero-band', '.ai2-composer', '.ai2-trust-row', '.ai-chart-svg', '.ai-chart-caption']
      .every((selector) => sources.moduleCss.includes(selector)),
    'A static Insights stylesheet selector is missing.');
  check('extracted module has no ai2-styles runtime injection',
    !/ai2-styles|createElement\(\s*['"]style['"]\s*\)/.test(sources.moduleScript),
    'Insights CSS must be static in arenas.css.');

  browser = await launchBrowser();
  const page = await browser.newPage();
  for (const width of WIDTHS) {
    for (const state of Object.keys(proofFixtures)) {
      const before = await render(page, 'legacy', width, state, sources);
      const after = await render(page, 'module', width, state, sources);
      check(`${state}@${width}: panel tag/class tree matches ee99f48`,
        JSON.stringify(before.tree) === JSON.stringify(after.tree),
        JSON.stringify({ legacy: before.tree, module: after.tree }).slice(0, 1800));
      check(`${state}@${width}: both panels contain one rendered chart`,
        before.summary.chartCount === 1 && after.summary.chartCount === 1 &&
          before.summary.svgCount === 1 && after.summary.svgCount === 1,
        JSON.stringify({ legacy: before.summary, module: after.summary }));
      check(`${state}@${width}: chart bar structure is unchanged`,
        before.summary.barCount === after.summary.barCount &&
          before.summary.legendItems === after.summary.legendItems,
        JSON.stringify({ legacy: before.summary, module: after.summary }));
      check(`${state}@${width}: neither rendered panel overflows horizontally`,
        before.summary.pageOverflow <= 1 && after.summary.pageOverflow <= 1,
        JSON.stringify({ legacy: before.summary, module: after.summary }));
      const pixels = await pixelDifference(before.png, after.png);
      check(`${state}@${width}: pixel diff is zero beyond antialias tolerance`,
        pixels.compatible && pixels.changed === 0,
        JSON.stringify(pixels));
      console.log(`       pixel ${state}@${width}: ${JSON.stringify(pixels)}`);
    }
  }
  await page.close();
} catch (error) {
  check('proof harness completed', false, error && error.stack ? error.stack : String(error));
} finally {
  if (browser) await browser.close().catch(() => {});
}

console.log(failures
  ? `\n${failures} FAILURE(S) of ${assertions} extraction proof assertions`
  : `\nALL ${assertions} INSIGHTS EXTRACTION PROOF ASSERTIONS PASSED`);
process.exitCode = failures ? 1 : 0;