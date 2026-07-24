#!/usr/bin/env node
// One-shot codemod: replace every 🏟 BRAND mark with <img src="/html/arenas-icon.svg">
// (the PWA icon master), rewrite the emoji-box CSS defs into plain img boxes
// (preserving each surface's width/height and flex-shrink), and add favicon
// links to every page head. Content 🏟 (club-tile/sport fallbacks, hero
// eyebrows, feature icons, club-logo upload preview, achievement icon) is
// deliberately untouched. Asserts exact match counts and exits non-zero on
// any drift so a partial apply can't slip through.
'use strict';
const fs = require('fs');
const path = require('path');
const HTML = path.join(__dirname, '..', 'html');

const MARK = '/html/arenas-icon.svg';
let failures = 0;
const log = [];

function apply(file, label, from, to, expect) {
  const p = path.join(HTML, file);
  let src = fs.readFileSync(p, 'utf8');
  let count = 0;
  if (from instanceof RegExp) {
    src = src.replace(from, (...m) => { count++; return typeof to === 'function' ? to(...m) : to; });
  } else {
    let idx;
    while ((idx = src.indexOf(from)) !== -1) { src = src.slice(0, idx) + to + src.slice(idx + from.length); count++; }
  }
  if (count !== expect) { failures++; log.push(`FAIL ${file} [${label}]: expected ${expect}, got ${count}`); return; }
  fs.writeFileSync(p, src);
  log.push(`ok   ${file} [${label}] x${count}`);
}

// ── 1. Topbar / brand emoji divs → <img> ─────────────────────────────────
const img = cls => `<img class="${cls}" src="${MARK}" alt="">`;

const SHELL = ['arenas-log.html', 'arenas-billing.html', 'arenas-athletes.html', 'arenas-leaderboards.html',
  'arenas-challenges.html', 'arenas-events.html', 'arenas-calendar.html', 'arenas-feed.html',
  'arenas-club-member.html', 'arenas-my-profile.html', 'arenas-club-dashboard.html', 'arenas-club-invite.html',
  'arenas-blog.html', 'arenas-billing-canceled.html', 'arenas-billing-success.html', 'arenas-club-join.html',
  'arenas-landing-login.html'];
for (const f of SHELL) apply(f, 'logo-icon div', '<div class="logo-icon">🏟</div>', img('logo-icon'), 1);

const NAV = [['arenas-about.html', 1], ['arenas-how-points-work.html', 1], ['arenas-privacy.html', 1],
  ['arenas-terms.html', 1], ['arenas-forgot-password.html', 1], ['arenas-reset-password.html', 1],
  ['arenas-for-clubs.html', 2]];
for (const [f, n] of NAV) apply(f, 'nav-logo-icon div', '<div class="nav-logo-icon">🏟</div>', img('nav-logo-icon'), n);

apply('arenas-for-clubs.html', 'sm-logo-icon div', '<div class="sm-logo-icon">🏟</div>', img('sm-logo-icon'), 2);

for (const f of ['arenas-about.html', 'arenas-how-points-work.html', 'arenas-privacy.html', 'arenas-terms.html'])
  apply(f, 'footer-brand-icon div', '<div class="footer-brand-icon">🏟</div>', img('footer-brand-icon'), 1);

// © footer mini-tiles (inline-styled 22px yellow squares)
const TILE = '<div style="width:22px;height:22px;background:var(--yellow);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:12px">🏟</div>';
const TILE_IMG = `<img src="${MARK}" width="22" height="22" alt="Arenas" style="display:block">`;
for (const f of ['arenas-landing-login.html', 'arenas-blog.html', 'arenas-leaderboards.html', 'arenas-challenges.html'])
  apply(f, '© footer tile', TILE, TILE_IMG, 1);

// ── 2. CSS defs: emoji box → img box (preserve width/height/flex-shrink) ─
function cssRewrite(file, className, expect) {
  const re = new RegExp('\\.' + className.replace(/-/g, '\\-') + '\\s*\\{[^}]*\\}', 'g');
  apply(file, '.' + className + ' def', re, block => {
    const w = (block.match(/width:\s*([0-9]+px)/) || [])[1];
    const h = (block.match(/height:\s*([0-9]+px)/) || [])[1];
    const fsk = /flex-shrink:\s*0/.test(block) ? ';flex-shrink:0' : '';
    if (!w || !h) { failures++; log.push(`FAIL ${file} [.${className}]: no width/height in "${block.slice(0, 80)}"`); return block; }
    return `.${className}{width:${w};height:${h};display:block${fsk}}`;
  }, expect);
}
cssRewrite('arenas.css', 'logo-icon', 1);            // shared shell topbar
cssRewrite('arenas-landing-login.html', 'logo-icon', 1);
cssRewrite('arenas-club-join.html', 'logo-icon', 1);
cssRewrite('arenas-billing-success.html', 'logo-icon', 1);
cssRewrite('arenas-billing-canceled.html', 'logo-icon', 1);
cssRewrite('arenas-club-invite.html', 'logo-icon', 1);
cssRewrite('arenas-blog.html', 'logo-icon', 1);
for (const f of ['arenas-about.html', 'arenas-how-points-work.html', 'arenas-privacy.html', 'arenas-terms.html',
  'arenas-forgot-password.html', 'arenas-reset-password.html', 'arenas-for-clubs.html'])
  cssRewrite(f, 'nav-logo-icon', 1);
for (const f of ['arenas-about.html', 'arenas-how-points-work.html', 'arenas-privacy.html', 'arenas-terms.html'])
  cssRewrite(f, 'footer-brand-icon', 1);
cssRewrite('arenas-for-clubs.html', 'sm-logo-icon', 1);

// ── 3. Favicon links on every page head ──────────────────────────────────
const LINKS = `<link rel="icon" href="/html/favicon.ico" sizes="48x48">\n<link rel="icon" href="${MARK}" type="image/svg+xml">`;
const pages = fs.readdirSync(HTML).filter(f => f.startsWith('arenas-') && f.endsWith('.html'));
for (const f of pages) {
  const p = path.join(HTML, f);
  let src = fs.readFileSync(p, 'utf8');
  if (src.includes('rel="icon"')) { log.push(`skip ${f} [favicon]: already linked`); continue; }
  const anchor = src.match(/^([ \t]*)<meta name="theme-color"[^>]*>/m) || src.match(/^([ \t]*).*<\/title>/m);
  if (!anchor) { failures++; log.push(`FAIL ${f} [favicon]: no anchor (<meta theme-color> or </title>)`); continue; }
  const indent = anchor[1] || '';
  src = src.replace(anchor[0], anchor[0] + '\n' + LINKS.split('\n').map(l => indent + l).join('\n'));
  fs.writeFileSync(p, src);
  log.push(`ok   ${f} [favicon links added]`);
}

console.log(log.join('\n'));

// ── 4. Audit: what 🏟 remains (should be content fallbacks only) ─────────
console.log('\n=== remaining 🏟 (must all be content, not brand) ===');
for (const f of fs.readdirSync(HTML)) {
  if (!/\.(html|js)$/.test(f)) continue;
  const lines = fs.readFileSync(path.join(HTML, f), 'utf8').split('\n');
  lines.forEach((l, i) => { if (l.includes('🏟')) console.log(`${f}:${i + 1}: ${l.trim().slice(0, 110)}`); });
}
if (failures) { console.error(`\n${failures} FAILURE(S) — review above`); process.exit(1); }
console.log('\nCODEMOD CLEAN');
