// Measure live athlete-directory card metrics (/athletes, Grid + List views,
// plus profile Athletes tab): border-radius, vertical/horizontal gaps between
// cards, and left inset from the column edge. Also exercises search, the
// All/Following filter and the sort dropdown. SHOT=before|after screenshots
// /athletes (both views) at the given widths. Throwaway user; cleans up.
import { createClient } from '@supabase/supabase-js';
import { launchBrowser } from './lib/mobile-geometry.js';
import fs from 'node:fs';

const BASE = 'http://localhost:80/html';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const EMAIL = 'athmetrics-check@arenas-test.dev';
const PW = 'ArenasTest!234';
const SHOT = process.env.SHOT || '';
const WIDTHS = (process.env.WIDTHS || '1280,360').split(',').map(Number);

const { data: existing } = await admin.auth.admin.listUsers({ perPage: 1000 });
for (const u of existing.users || []) if (u.email === EMAIL) await admin.auth.admin.deleteUser(u.id);
const { data: cu, error } = await admin.auth.admin.createUser({
  email: EMAIL, password: PW, email_confirm: true,
  user_metadata: { name: 'Ath Metrics Check', handle: 'athmetrics_check', timezone: 'UTC' }
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

const measure = () => `(() => {
  const cards = [...document.querySelectorAll('#athlete-grid .adc-card')];
  if (!cards.length) return { cards: 0 };
  const cs = getComputedStyle(cards[0]);
  const col = document.getElementById('athletes-col').getBoundingClientRect();
  const rects = cards.map((c) => c.getBoundingClientRect());
  const r0 = rects[0];
  let vgap = null, hgap = null;
  for (const rc of rects.slice(1)) {
    if (Math.abs(rc.top - r0.top) < 2 && hgap === null) hgap = Math.round(rc.left - r0.right);
    if (rc.top > r0.bottom - 2 && vgap === null) vgap = Math.round(rc.top - r0.bottom);
  }
  return { cards: cards.length, radius: cs.borderRadius, vgap, hgap, leftPad: Math.round(r0.left - col.left) };
})()`;

for (const width of WIDTHS) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 1000 } });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '/athletes', { waitUntil: 'networkidle' });

  for (const view of ['grid', 'list']) {
    await page.evaluate((v) => window.setView && window.setView(v), view);
    await page.waitForTimeout(250);
    const m = await page.evaluate(measure());
    console.log(`athletes ${view} @${width}px:`, JSON.stringify(m));
    if (SHOT) {
      fs.mkdirSync('/tmp/athshots', { recursive: true });
      await page.screenshot({ path: `/tmp/athshots/${SHOT}-${view}-${width}.png` });
    }
  }

  if (width === WIDTHS[0]) {
    // Functional checks once (first width): search, All/Following, sort.
    await page.evaluate(() => window.setView('grid'));
    const count = () => page.evaluate(() => document.querySelectorAll('#athlete-grid .adc-card').length);
    const all = await count();
    await page.fill('#search-input, .search-input input, input[placeholder*="Search"]', 'zzz-no-such-athlete');
    await page.waitForTimeout(350);
    const none = await count();
    await page.fill('#search-input, .search-input input, input[placeholder*="Search"]', '');
    await page.waitForTimeout(350);
    console.log(`search: all=${all} filtered(zzz)=${none} restored=${await count()}`);
    const fBtns = await page.evaluate(() => [...document.querySelectorAll('button,.vt-btn,.btn')].filter((b) => /^(All|Following)$/.test(b.textContent.trim())).map((b) => b.textContent.trim()));
    if (fBtns.includes('Following')) {
      await page.evaluate(() => [...document.querySelectorAll('button,.vt-btn,.btn')].find((b) => b.textContent.trim() === 'Following').click());
      await page.waitForTimeout(350);
      console.log('following filter count:', await count());
      await page.evaluate(() => [...document.querySelectorAll('button,.vt-btn,.btn')].find((b) => b.textContent.trim() === 'All').click());
      await page.waitForTimeout(350);
    }
    const sortSel = await page.evaluate(() => {
      const s = document.querySelector('select.sort-select, select[id*=sort]');
      return s ? [...s.options].map((o) => o.value) : null;
    });
    if (sortSel) {
      const first = await page.evaluate(() => document.querySelector('#athlete-grid .adc-name')?.textContent.trim());
      await page.selectOption('select.sort-select, select[id*=sort]', sortSel[sortSel.length - 1]);
      await page.waitForTimeout(350);
      const after = await page.evaluate(() => document.querySelector('#athlete-grid .adc-name')?.textContent.trim());
      console.log(`sort options=${JSON.stringify(sortSel)} first(before)=${first} first(after)=${after}`);
    }
  }
  console.log(`@${width}px console errors:`, JSON.stringify(errors));
  await ctx.close();
}

await browser.close();
await admin.auth.admin.deleteUser(cu.user.id);
console.log('cleaned up');
