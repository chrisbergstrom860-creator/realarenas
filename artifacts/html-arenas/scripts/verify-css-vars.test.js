#!/usr/bin/env node
/**
 * verify-css-vars.test.js — two fixture suites protecting verify-css-vars.js
 * so future edits to the guard can't quietly weaken it:
 *
 * 1. Unit tests of the exported parsing helpers (stripComments/definedIn/
 *    consumedIn/dynamicRefsIn) — comment stripping, whitespace after var(,
 *    setProperty definitions, missing-variable detection.
 * 2. End-to-end tests running the guard against temp fixture pages — each
 *    FAIL case is proven by observing the guard exit non-zero AND name the
 *    page and variable in its output — never by reasoning that it would.
 *
 * Run: node scripts/verify-css-vars.test.js  (exits 1 on any failure)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stripComments, definedIn, consumedIn, dynamicRefsIn } from './verify-css-vars.js';

let failures = 0;

// ---------------------------------------------------------------------------
// Suite 1: unit tests of the exported parsing helpers
// ---------------------------------------------------------------------------

// The guard always strips comments before parsing (see read() in the guard);
// mirror that pipeline here.
const defs = (s) => definedIn(stripComments(s));
const uses = (s) => consumedIn(stripComments(s));

function test(name, fn) {
  try { fn(); console.log(`PASS  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); failures++; }
}

// --- consumption parsing ---------------------------------------------------
test('var( with newline/whitespace before the name still counts as usage', () => {
  assert.ok(uses('a { color: var(\n  --tint-blue\n); }').has('tint-blue'));
  assert.ok(uses('a { box-shadow: var(   --shadow-soft ); }').has('shadow-soft'));
});

test('commented-out consumption must NOT count as usage', () => {
  const css = 'a { color: red; /* color: var(--ghost-var); */ }';
  assert.ok(!uses(css).has('ghost-var'));
  const js = 'const x = 1;\n// el.style.color = "var(--js-ghost)";\n';
  assert.ok(!uses(js).has('js-ghost'));
});

// --- definition parsing ----------------------------------------------------
test('commented-out declarations must NOT count as definitions', () => {
  const css = ':root { /* --dead-var: #fff; */ --live-var: #000; }';
  const d = defs(css);
  assert.ok(!d.has('dead-var'));
  assert.ok(d.has('live-var'));
});

test("setProperty('--x', ...) counts as a definition", () => {
  const js = `el.style.setProperty('--panel-h', h + 'px');
    root.style.setProperty( "--accent" , color);`;
  const d = defs(js);
  assert.ok(d.has('panel-h'));
  assert.ok(d.has('accent'));
});

test('declarations anywhere (not just :root) and inline style attrs count', () => {
  assert.ok(defs('.card { --card-pad: 8px; }').has('card-pad'));
  assert.ok(defs('<div style="--row-gap: 4px">').has('row-gap'));
});

test('a consumed-but-never-defined variable is detected as unresolved', () => {
  const page = `:root { --defined-ok: 1px; }
    .a { margin: var(--defined-ok); color: var(--totally-missing); }`;
  const defined = defs(page);
  const unresolved = [...uses(page)].filter((n) => !defined.has(n));
  assert.deepEqual(unresolved, ['totally-missing']);
});

test('dynamically constructed var() names are reported', () => {
  assert.ok(dynamicRefsIn('el.style.color = `var(--${name}-tint)`;').length > 0);
  assert.ok(dynamicRefsIn("s = 'var(--' + name + ')';").length > 0);
  assert.equal(dynamicRefsIn('a { color: var(--static-name); }').length, 0);
});

// ---------------------------------------------------------------------------
// Suite 2: end-to-end fixture pages run through the real guard
// ---------------------------------------------------------------------------

const GUARD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'verify-css-vars.js');

// Minimal shared sheet: one real var, mirroring arenas.css's role.
const SHARED_CSS = ':root {\n  --gray-100: #F3F4F6;\n}\n';
const LINK = '<link rel="stylesheet" href="arenas.css">';

function runGuard(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cssvars-'));
  try {
    fs.writeFileSync(path.join(dir, 'arenas.css'), SHARED_CSS);
    for (const [name, content] of Object.entries(files)) {
      const p = path.join(dir, name);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
    }
    try {
      const out = execFileSync('node', [GUARD], { env: { ...process.env, CSS_VARS_TEST_MODE: '1', CSS_VARS_HTML_DIR: dir }, encoding: 'utf8', stdio: 'pipe' });
      return { code: 0, out };
    } catch (e) {
      return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function expect(name, res, wantFail, page, variable) {
  const okCode = wantFail ? res.code !== 0 : res.code === 0;
  const okNamed = !wantFail || (res.out.includes(page) && res.out.includes('--' + variable));
  const ok = okCode && okNamed;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}` + (ok ? '' : `  → exit=${res.code}, output: ${res.out.slice(0, 300)}`));
  if (!ok) failures++;
}

// 1. Misspelled reference: var(--gray-1000) while only --gray-100 exists.
expect('misspelled ref (--gray-1000 vs --gray-100) FAILS and is named',
  runGuard({ 'page.html': `${LINK}<style>.a{color:var(--gray-1000)}</style>` }),
  true, 'page.html', 'gray-1000');

// 2. Definition only inside a @media block: the guard's documented
//    conservative scope model counts it as a definition (no cascade
//    modelling), so this PASSES today — a known, documented limitation.
expect('definition only under @media resolves (documented conservative model)',
  runGuard({ 'page.html': `${LINK}<style>@media (min-width:900px){:root{--media-only:#fff}}.a{color:var(--media-only)}</style>` }),
  false);

// 3. Reference in JS-built inline style (template literal writing markup).
expect('JS template-literal style="...var(--js-var)" FAILS when undefined',
  runGuard({ 'page.html': `${LINK}<script>el.innerHTML = \`<div style="color:var(--js-var)">x</div>\`;</script>` }),
  true, 'page.html', 'js-var');

// 3b. Same, via a loaded local script file.
expect('var() consumed inside a <script src> file FAILS when undefined',
  runGuard({
    'page.html': `${LINK}<script src="widget.js"></script>`,
    'widget.js': 'root.insertAdjacentHTML("beforeend", `<b style="background:var(--script-var)">y</b>`);'
  }),
  true, 'page.html', 'script-var');

// 3c. Same, via a NESTED relative script path (browser resolves js/widget.js
//     relative to the page; the guard must too, not just flat basenames).
expect('var() consumed inside a nested <script src="js/widget.js"> FAILS when undefined',
  runGuard({
    'page.html': `${LINK}<script src="js/widget.js"></script>`,
    'js/widget.js': 'root.insertAdjacentHTML("beforeend", `<b style="background:var(--nested-var)">y</b>`);'
  }),
  true, 'page.html', 'nested-var');

// 4. Reference inside the page's own @media block.
expect('var() consumed inside @media FAILS when undefined',
  runGuard({ 'page.html': `${LINK}<style>@media (max-width:600px){.a{color:var(--media-ref)}}</style>` }),
  true, 'page.html', 'media-ref');

// 5. Fallback syntax var(--x, #fff): resolves in the browser, but the guard
//    must still flag the undefined name — the fallback silently masks drift.
expect('var(--fb-var, #fff) with fallback still FAILS when undefined',
  runGuard({ 'page.html': `${LINK}<style>.a{color:var(--fb-var, #fff)}</style>` }),
  true, 'page.html', 'fb-var');

// 6. Self-contained page consuming a var that exists ONLY in arenas.css:
//    it doesn't link the sheet, so this must fail (no union checking).
expect('self-contained page using shared-only var FAILS (linked/self distinction)',
  runGuard({ 'page.html': `<style>.a{color:var(--gray-100)}</style>` }),
  true, 'page.html', 'gray-100');

// 6b. Control: the same reference on a LINKED page passes.
expect('control: linked page using shared var PASSES',
  runGuard({ 'page.html': `${LINK}<style>.a{color:var(--gray-100)}</style>` }),
  false);

if (failures) { console.error(`${failures} test(s) FAILED`); process.exit(1); }
console.log('ALL TESTS PASS');
