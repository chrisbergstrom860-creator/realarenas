// One-off proof for the sportPillHtml convergence: on all three activity-card
// surfaces, every sport pill's computed background/color/border must equal the
// registry values for that sport — including tennis and pilates. Uses the
// shot-activity-surfaces fixtures (seed first).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { launchBrowser } from './lib/mobile-geometry.js';
const require = createRequire(import.meta.url);
const { SPORTS } = require('../sports.js');

const DOMAIN = process.env.REPLIT_DEV_DOMAIN;
const BASE_URL = `https://${DOMAIN}/html`;
const m = JSON.parse(fs.readFileSync('/tmp/vac-manifest.json', 'utf8'));
const PW = 'ArenasTest!234';

async function loginCookies(email) {
  const r = await fetch(BASE_URL + '/auth/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(PW)}`
  });
  const setC = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  const raw = (setC || []).filter(Boolean).map((c) => c.split(';')[0]);
  if (r.status !== 302 || !raw.length) throw new Error('login failed for ' + email);
  return raw.map((p) => { const i = p.indexOf('='); return { name: p.slice(0, i), value: p.slice(i + 1), domain: DOMAIN, path: '/' }; });
}

const rgb = (h) => `rgb(${[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
const REG = {};
SPORTS.forEach((s) => { REG[s.label] = { bg: rgb(s.colors.bg), text: rgb(s.colors.text), border: rgb(s.colors.border) }; });

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

const browser = await launchBrowser();
const vC = await loginCookies('vac-shot-viewer@arenas-test.dev');
const aC = await loginCookies('vac-shot-author@arenas-test.dev');
const targets = [
  { name: 'feed', cookies: vC, url: BASE_URL + '/feed', scope: '.feed-item-wrap' },
  { name: 'club-feed', cookies: aC, url: BASE_URL + '/clubs/dashboard?club=' + m.clubId + '#feed', scope: '#cf-feed-list' },
  { name: 'profile', cookies: aC, url: BASE_URL + '/profile#activities', scope: '.activity-card-item' }
];
try {
  for (const t of targets) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addCookies(t.cookies);
    const page = await ctx.newPage();
    await page.goto(t.url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction((sel) => document.querySelector(sel) && document.querySelector(sel).textContent.includes('VAC'), t.scope, { timeout: 20000 });
    const pills = await page.evaluate((labels) => {
      const out = [];
      document.querySelectorAll('span').forEach((el) => {
        const txt = el.textContent.trim().replace(/^\S+\s/, '');
        const label = labels.includes(el.textContent.trim()) ? el.textContent.trim() : (labels.includes(txt) ? txt : null);
        if (!label || !el.getAttribute('style') || el.getAttribute('style').indexOf('border-radius:20px') === -1) return;
        const cs = getComputedStyle(el);
        out.push({ label, bg: cs.backgroundColor, text: cs.color, border: cs.borderColor });
      });
      return out;
    }, Object.keys(REG));
    const seen = new Set();
    for (const p of pills) {
      const r = REG[p.label];
      seen.add(p.label);
      check(t.name + ' pill ' + p.label + ' uses registry colors',
        p.bg === r.bg && p.text === r.text && p.border === r.border,
        JSON.stringify(p) + ' vs ' + JSON.stringify(r));
    }
    if (t.name !== 'profile') { // profile fixture set == same activities
      check(t.name + ' shows Tennis pill', seen.has('Tennis'));
      check(t.name + ' shows Pilates pill', seen.has('Pilates'));
    } else {
      check('profile shows Tennis pill', seen.has('Tennis'));
      check('profile shows Pilates pill', seen.has('Pilates'));
    }
    await ctx.close();
  }
} finally { await browser.close().catch(() => {}); }
console.log(failures ? failures + ' FAILURE(S)' : 'ALL PASS');
process.exit(failures ? 1 : 0);
