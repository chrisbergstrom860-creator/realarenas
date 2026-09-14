// Browser-level contract for the fixed mobile FAB geometry. This deliberately
// uses the production stylesheet and the exported browser expression, but only
// a tiny in-memory fixture: no app server, auth, or seeded rows are involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, bottomNavExpr } from './lib/mobile-geometry.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(resolve(root, 'html/arenas.css'), 'utf8');
const expected = { itemCount: 0, activeCount: 0, log: true, ai: true };

function fixture({ swapEdges = false, wrongBottom = false, badStyle = false } = {}) {
  const aiStyle = [
    swapEdges ? 'left:auto;right:16px' : '',
    wrongBottom ? 'bottom:80px' : '',
    badStyle ? 'background:#123456;color:#fff;font-size:22px;border:2px solid red;padding:2px;appearance:auto' : ''
  ].filter(Boolean).join(';');
  const logStyle = swapEdges ? 'left:16px;right:auto' : '';
  return `<!doctype html>
<html><head><style>${css}
  .main { min-height:1200px !important; position:relative !important; }
  .main .last-content { position:absolute; left:16px; bottom:140px; }
</style></head>
<body>
  <main class="main"><p class="last-content">ordinary final content</p></main>
  <nav class="bottom-nav bn-has-fab" aria-label="Bottom navigation"></nav>
  <button class="bn-fab bn-fab-log" aria-label="Log activity" style="${logStyle}">＋</button>
  <button class="bn-fab bn-fab-ai" aria-label="Ask AI Insights" style="${aiStyle}">✦</button>
</body></html>`;
}

let browser;
test.before(async () => {
  browser = await launchBrowser();
});

test.after(async () => {
  await browser?.close();
});

async function audit(options) {
  const page = await browser.newPage({ viewport: { width: 360, height: 840 } });
  try {
    await page.setContent(fixture(options));
    return await page.evaluate(bottomNavExpr(expected));
  } finally {
    await page.close();
  }
}

test('production CSS baseline passes exact FAB edges, safe-area bottom, and dark AI style', async () => {
  const result = await audit();
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  assert.equal(result.checks.find((check) => check.name.startsWith('AI FAB is exactly 72px')).ok, true);
  assert.equal(result.checks.find((check) => check.name.startsWith('AI FAB preserves')).ok, true);
});

test('swapped FAB edges fail the side-specific contract', async () => {
  const result = await audit({ swapEdges: true });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find((check) => check.name.startsWith('AI FAB is exactly 52x52')).ok, false);
  assert.equal(result.checks.find((check) => check.name.startsWith('log FAB is exactly 52x52')).ok, false);
});

test('a wrong FAB bottom inset fails the per-FAB bottom contract', async () => {
  const result = await audit({ wrongBottom: true });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find((check) => check.name.startsWith('AI FAB is exactly 72px')).ok, false);
});

test('bad AI border, colors, padding, or font styling fails the reviewed style contract', async () => {
  const result = await audit({ badStyle: true });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find((check) => check.name.startsWith('AI FAB preserves')).ok, false);
});