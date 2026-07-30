#!/usr/bin/env node
/**
 * verify-css-vars.js — permanent guard: every var(--name) a page consumes must
 * resolve to a definition. Unresolved var() is SILENT in the browser (no
 * console error — just a missing tint/shadow), so screenshots can't be trusted
 * to catch it; this static check can.
 *
 * Rules:
 * - Pages that <link> arenas.css resolve against: shared arenas.css :root
 *   ∪ the page's own definitions.
 * - Self-contained pages (no <link>) resolve against their own definitions ONLY.
 * - A page's "consumption" includes its inline <script> JS and every local
 *   <script src> file it loads (shared scripts inject HTML with var() refs).
 * - Definitions include custom-property declarations anywhere in the page/CSS
 *   (not just :root), inline style="--x:.." attrs, and JS setProperty('--x',..).
 * - Also reports any dynamically constructed var(--...) names (template
 *   literals / concatenation), which static checking cannot resolve.
 *
 * Scope model (deliberately conservative): a custom-property declaration
 * ANYWHERE in the page/its scripts counts as a definition, regardless of the
 * selector it sits under. This can under-report (a var defined only under an
 * unrelated selector satisfies the check) but never over-reports; modelling
 * CSS cascade scope statically is out of scope for this guard. Comments are
 * stripped before parsing so commented-out declarations do NOT count.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// CSS_VARS_HTML_DIR override exists for the fixture tests (verify-css-vars.test.js).
const HTML_DIR = process.env.CSS_VARS_HTML_DIR ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'html');

const read = (f) => stripComments(fs.readFileSync(f, 'utf8'));

// Remove /* */ CSS/JS block comments and // JS line comments (crude but safe:
// only strips // when preceded by whitespace or line start, so URLs survive).
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

function definedIn(text) {
  const out = new Set();
  // custom-property declarations: preceded by { ; " ' ` whitespace or start
  for (const m of text.matchAll(/(?:^|[;{\s"'`])--([a-zA-Z0-9-]+)\s*:/g)) out.add(m[1]);
  // JS: el.style.setProperty('--x', ...)
  for (const m of text.matchAll(/setProperty\(\s*['"`]--([a-zA-Z0-9-]+)['"`]/g)) out.add(m[1]);
  return out;
}
function consumedIn(text) {
  const out = new Set();
  // comments were stripped in read(); tolerate any whitespace after var(
  for (const m of text.matchAll(/var\(\s*--([a-zA-Z0-9-]+)/gi)) out.add(m[1]);
  return out;
}
function dynamicRefsIn(text) {
  const hits = [];
  for (const re of [/var\(--\$\{[^}]*\}/g, /['"`]var\(--['"`]\s*\+/g, /\+\s*['"`]--[a-zA-Z0-9-]*['"`]/g]) {
    for (const m of text.matchAll(re)) hits.push(m[0]);
  }
  return hits;
}

const shared = definedIn(read(path.join(HTML_DIR, 'arenas.css')));

const pages = fs.readdirSync(HTML_DIR).filter((f) => f.endsWith('.html')).sort();
let assertions = 0;
const failures = [];
const dynamicReports = [];
let linkedCount = 0, selfCount = 0;

for (const page of pages) {
  const html = read(path.join(HTML_DIR, page));
  const linked = /<link[^>]+arenas\.css/.test(html);
  linked ? linkedCount++ : selfCount++;

  // gather the page's local <script src> files
  let corpus = html;
  const scriptFiles = [];
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) {
    const src = m[1];
    if (/^https?:|^\/\//.test(src)) continue; // external CDN
    const base = path.basename(src.split('?')[0]);
    const local = path.join(HTML_DIR, base);
    if (fs.existsSync(local)) { corpus += '\n' + read(local); scriptFiles.push(base); }
  }

  const defined = definedIn(corpus);
  if (linked) for (const v of shared) defined.add(v);

  for (const name of consumedIn(corpus)) {
    assertions++;
    if (!defined.has(name)) {
      failures.push(`${page}${linked ? ' (linked)' : ' (self-contained)'}: var(--${name}) has NO definition` +
        (linked ? ' in shared :root or page' : ' in page (does not link arenas.css)'));
    }
  }
  const dyn = dynamicRefsIn(corpus);
  if (dyn.length) dynamicReports.push(`${page}: ${dyn.join(' | ')}`);
}

console.log(`Pages: ${pages.length} (${linkedCount} linked, ${selfCount} self-contained); shared :root vars: ${shared.size}`);
console.log(`Assertions (page,var) pairs checked: ${assertions}`);
if (dynamicReports.length) {
  console.log('Dynamically constructed var() references (cannot be statically verified):');
  for (const d of dynamicReports) console.log('  ' + d);
} else {
  console.log('Dynamically constructed var() references: none found.');
}
if (failures.length) {
  console.error('FAIL — unresolved CSS variables:');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log('ALL PASS');
