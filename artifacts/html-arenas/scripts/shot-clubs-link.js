// One-off check: the profile Clubs tab "Find more in the Clubs directory"
// link navigates to /clubs at desktop (1280) and mobile (360), with zero
// console errors on both pages. Seeds one throwaway user; cleans up after.
import { createClient } from '@supabase/supabase-js';
import { launchBrowser } from './lib/mobile-geometry.js';

const BASE = 'http://localhost:80/html';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const EMAIL = 'clubslink-check@arenas-test.dev';
const PW = 'ArenasTest!234';

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail ? ' — ' + JSON.stringify(detail).slice(0, 300) : '')); }
}

const { data: existing } = await admin.auth.admin.listUsers({ perPage: 1000 });
for (const u of existing.users || []) if (u.email === EMAIL) await admin.auth.admin.deleteUser(u.id);
const { data: cu, error } = await admin.auth.admin.createUser({
  email: EMAIL, password: PW, email_confirm: true,
  user_metadata: { name: 'Clubs Link Check', handle: 'clubslink_check', timezone: 'UTC' }
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
for (const width of [1280, 360]) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 900 } });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE + '/profile', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelector('[data-tab="clubs"], [onclick*="clubs"]') && null);
  // Open the Clubs tab via its tab control.
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.tab, [role=tab], button, div')].filter(
      (el) => /^clubs$/i.test((el.textContent || '').trim().replace(/\d+/g, '').trim()) && el.className.toString().includes('tab'));
    (tabs[0] || { click() {} }).click();
  });
  await page.waitForTimeout(400);
  const link = page.locator('#tab-clubs a', { hasText: 'Find more in the Clubs directory' });
  check(width + 'px: link present with shipped copy', await link.count() === 1);
  const href = await link.first().getAttribute('href');
  check(width + 'px: href is BASE-prefixed /clubs', href === '/html/clubs', href);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), link.first().click()]);
  check(width + 'px: navigated to the club directory', new URL(page.url()).pathname === '/html/clubs', page.url());
  check(width + 'px: directory page rendered (grid or empty state)', await page.locator('#club-grid > *').count() >= 1);
  check(width + 'px: zero console errors (profile + clubs)', errors.length === 0, errors);
  await ctx.close();
}
await browser.close();
await admin.auth.admin.deleteUser(cu.user.id);
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
