// Measure live card metrics on /events, /clubs and /profile (Clubs tab):
// border-radius, vertical gap between consecutive cards, and left padding
// between the column edge and the card. Uses an existing baseline user via
// throwaway login user. Optionally screenshots /clubs (SHOT=before|after).
import { createClient } from '@supabase/supabase-js';
import { launchBrowser } from './lib/mobile-geometry.js';
import fs from 'node:fs';

const BASE = 'http://localhost:80/html';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const EMAIL = 'cardmetrics-check@arenas-test.dev';
const PW = 'ArenasTest!234';
const SHOT = process.env.SHOT || '';

const { data: existing } = await admin.auth.admin.listUsers({ perPage: 1000 });
for (const u of existing.users || []) if (u.email === EMAIL) await admin.auth.admin.deleteUser(u.id);
const { data: cu, error } = await admin.auth.admin.createUser({
  email: EMAIL, password: PW, email_confirm: true,
  user_metadata: { name: 'Card Metrics Check', handle: 'cardmetrics_check', timezone: 'UTC' }
});
if (error) throw new Error(error.message);
console.log('MANIFEST user:', cu.user.id);

const r = await fetch(BASE + '/auth/login', {
  method: 'POST', redirect: 'manual',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `email=${encodeURIComponent(EMAIL)}&password=${encodeURIComponent(PW)}`
});
const setC = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
const cookies = (setC || []).filter(Boolean).map((c) => {
  const [pair] = c.split(';');
  const i = pair.indexOf('=');
  return { name: pair.slice(0, i), value: pair.slice(i + 1), url: 'http://localhost:80' };
});
if (r.status !== 302 || !cookies.length) throw new Error('login failed');

const browser = await launchBrowser();

const measureExpr = (cardSel, colSel) => `(() => {
  const cards = [...document.querySelectorAll(${JSON.stringify(cardSel)})];
  if (!cards.length) return { cards: 0 };
  const cs = getComputedStyle(cards[0]);
  const col = document.querySelector(${JSON.stringify(colSel)});
  const r0 = cards[0].getBoundingClientRect();
  let vgap = null;
  if (cards.length > 1) {
    const r1 = cards[1].getBoundingClientRect();
    vgap = Math.round(r1.top - r0.bottom);
  }
  const colLeft = col ? col.getBoundingClientRect().left : 0;
  return {
    cards: cards.length,
    radius: cs.borderRadius,
    vgap,
    leftPad: Math.round(r0.left - colLeft),
    marginBottom: cs.marginBottom
  };
})()`;

async function measure(width, path, cardSel, colSel, label, shotName) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 1000 } });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  if (path === '/profile') {
    await page.evaluate(() => {
      const t = [...document.querySelectorAll('[class*=tab]')].find((el) => /^clubs/i.test((el.textContent || '').trim()) && !el.id?.startsWith('tab-'));
      if (t) t.click();
    });
    await page.waitForTimeout(400);
  }
  const m = await page.evaluate(measureExpr(cardSel, colSel));
  console.log(`${label} @${width}px:`, JSON.stringify(m), errors.length ? 'CONSOLE ERRORS: ' + JSON.stringify(errors) : '(no console errors)');
  if (shotName) {
    fs.mkdirSync('/tmp/clubshots', { recursive: true });
    await page.screenshot({ path: `/tmp/clubshots/${shotName}-${width}.png`, fullPage: false });
  }
  await ctx.close();
}

for (const w of [1280, 360]) {
  await measure(w, '/events', '.evx-card', '.events-col', 'events .evx-card');
  await measure(w, '/clubs', '.ccd-card', '.clubs-col', 'clubs .ccd-card', SHOT ? SHOT : null);
  await measure(w, '/profile', '#clubs-list .club-card', '#tab-clubs', 'profile .club-card');
}
if (SHOT) for (const w of [380, 414, 1440, 1920]) {
  await measure(w, '/clubs', '.ccd-card', '.clubs-col', 'clubs .ccd-card', SHOT);
}

await browser.close();
await admin.auth.admin.deleteUser(cu.user.id);
console.log('cleaned up');
