// Sports-registry accent-color guard. The chart redesign made colors.text a
// data-encoding channel (same hex per sport across three charts), so the 12
// accents must stay mutually distinguishable and readable:
//
// 1. Min pairwise CIE76 ΔE across all 12 colors.text >= 20 — a future
//    registry edit can't silently reintroduce a clash like the old
//    running/basketball pair (ΔE 9.3, and literally 0 under deuteranopia).
// 2. WCAG AA: every colors.text >= 4.5:1 contrast on its own colors.bg
//    (the sport-pill pairing used app-wide).
// 3. Deuteranopia/protanopia (Viénot) minima are printed for the record —
//    informational, not thresholds: 12 same-darkness hues cannot all clear a
//    high dichromat bar, so CVD support relies on the redundant labels
//    (emoji axis, legend names, table) that every chart carries.
//
// Run: node artifacts/html-arenas/scripts/verify-sport-colors.js
'use strict';
const path = require('path');
const { SPORTS } = require(path.join(__dirname, '..', 'sports.js'));

const THRESHOLD = 20; // CIE76 ΔE floor, normal vision
let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
function lab(hex) {
  const [R, G, B] = rgb(hex).map(lin);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [X, Y, Z].map(f);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const dE = (a, b) => { const A = lab(a), B = lab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
const lum = (h) => { const [R, G, B] = rgb(h).map(lin); return 0.2126 * R + 0.7152 * G + 0.0722 * B; };
const contrast = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
function simulate(hex, kind) {
  const M = kind === 'protan'
    ? [[0.11238, 0.88762, 0], [0.11238, 0.88762, 0], [0.00401, -0.00401, 1]]
    : [[0.29275, 0.70725, 0], [0.29275, 0.70725, 0], [-0.02234, 0.02234, 1]];
  const l = rgb(hex).map(lin);
  const s = M.map((r) => r[0] * l[0] + r[1] * l[1] + r[2] * l[2]);
  const g = (c) => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055));
  return '#' + s.map((c) => Math.max(0, Math.min(255, g(c))).toString(16).padStart(2, '0')).join('');
}

check('registry has 12 sports', SPORTS.length === 12, String(SPORTS.length));

// 1. Pairwise ΔE floor.
let min = Infinity, minPair = '';
let minP = Infinity, minPPair = '', minD = Infinity, minDPair = '';
for (let i = 0; i < SPORTS.length; i++) {
  for (let j = i + 1; j < SPORTS.length; j++) {
    const a = SPORTS[i], b = SPORTS[j];
    const d = dE(a.colors.text, b.colors.text);
    if (d < min) { min = d; minPair = a.id + '/' + b.id; }
    const p = dE(simulate(a.colors.text, 'protan'), simulate(b.colors.text, 'protan'));
    if (p < minP) { minP = p; minPPair = a.id + '/' + b.id; }
    const q = dE(simulate(a.colors.text, 'deutan'), simulate(b.colors.text, 'deutan'));
    if (q < minD) { minD = q; minDPair = a.id + '/' + b.id; }
    check('ΔE ' + a.id + '/' + b.id + ' >= ' + THRESHOLD, d >= THRESHOLD, d.toFixed(1));
  }
}
console.log('  min pairwise ΔE (CIE76): ' + min.toFixed(1) + ' (' + minPair + ')');
console.log('  info: protanopia min ΔE ' + minP.toFixed(1) + ' (' + minPPair + '), deuteranopia min ΔE ' + minD.toFixed(1) + ' (' + minDPair + ')');

// 2. AA contrast on own pill background.
SPORTS.forEach((s) => {
  const c = contrast(s.colors.text, s.colors.bg);
  check('AA ' + s.id + ' text on own bg >= 4.5', c >= 4.5, c.toFixed(2));
});

console.log(failures ? failures + ' FAILURE(S)' : 'ALL PASS');
process.exit(failures ? 1 : 0);
