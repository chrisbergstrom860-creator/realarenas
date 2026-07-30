#!/usr/bin/env node
/**
 * verify-css-vars.test.js — fixture tests proving verify-css-vars.js catches
 * the realistic ways a var() reference or definition escapes a parser.
 * Each FAIL case is proven by observing the guard exit non-zero AND name the
 * page and variable in its output — never by reasoning that it would.
 *
 * Run: node scripts/verify-css-vars.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GUARD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'verify-css-vars.js');

// Minimal shared sheet: one real var, mirroring arenas.css's role.
const SHARED_CSS = ':root {\n  --gray-100: #F3F4F6;\n}\n';
const LINK = '<link rel="stylesheet" href="arenas.css">';

function runGuard(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cssvars-'));
  try {
    fs.writeFileSync(path.join(dir, 'arenas.css'), SHARED_CSS);
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
    try {
      const out = execFileSync('node', [GUARD], { env: { ...process.env, CSS_VARS_HTML_DIR: dir }, encoding: 'utf8', stdio: 'pipe' });
      return { code: 0, out };
    } catch (e) {
      return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

let failures = 0;
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

if (failures) { console.error(`${failures} fixture test(s) FAILED`); process.exit(1); }
console.log('ALL FIXTURE TESTS PASS');
