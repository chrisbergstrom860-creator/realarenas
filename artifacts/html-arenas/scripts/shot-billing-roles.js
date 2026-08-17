// One-off screenshots for Task #79: the /billing page as a COACH (no club
// billing cards, explanatory empty state) vs an ADMIN and the demoted OWNER
// (upgrade + portal cards). Also asserts zero console errors on each render.
// Seeds throwaway users/clubs + a fake club_pro row; cleans up after.
import { createClient } from '@supabase/supabase-js';
import { launchBrowser } from './lib/mobile-geometry.js';

const BASE = 'http://localhost:80/html';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const PW = 'ArenasTest!234';
const EMAILS = {
  owner: 'billing-shot-owner@arenas-test.dev',
  admin: 'billing-shot-admin@arenas-test.dev',
  coach: 'billing-shot-coach@arenas-test.dev'
};
const PRO = 'Billing Shot Pro Club', FREE = 'Billing Shot Free Club';

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail ? ' — ' + JSON.stringify(detail).slice(0, 300) : '')); }
}

const { data: existing } = await admin.auth.admin.listUsers({ perPage: 1000 });
for (const u of existing.users || []) if (Object.values(EMAILS).includes(u.email)) {
  await admin.from('memberships').delete().eq('user_id', u.id);
  await admin.auth.admin.deleteUser(u.id);
}
await admin.from('subscriptions').delete().eq('stripe_customer_id', 'cus_billing_shot_fake');
await admin.from('clubs').delete().in('name', [PRO, FREE]);

const ids = {};
for (const [k, email] of Object.entries(EMAILS)) {
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PW, email_confirm: true,
    user_metadata: { name: 'Billing Shot ' + k, handle: 'billshot' + k, timezone: 'UTC' }
  });
  if (error) throw new Error(error.message);
  ids[k] = data.user.id;
}
console.log('MANIFEST users:', JSON.stringify(ids));

const { data: proClub } = await admin.from('clubs').insert({ name: PRO, handle: 'billing-shot-pro', sport: 'running', owner_id: ids.owner }).select().single();
const { data: freeClub } = await admin.from('clubs').insert({ name: FREE, handle: 'billing-shot-free', sport: 'running', owner_id: ids.owner }).select().single();
console.log('MANIFEST clubs:', proClub.id, freeClub.id);
await admin.from('memberships').insert([
  { user_id: ids.owner, club_id: proClub.id, role: 'member' },
  { user_id: ids.admin, club_id: proClub.id, role: 'admin' },
  { user_id: ids.admin, club_id: freeClub.id, role: 'admin' },
  { user_id: ids.coach, club_id: proClub.id, role: 'coach' },
  { user_id: ids.coach, club_id: freeClub.id, role: 'coach' }
]);
await admin.from('subscriptions').insert({
  owner_type: 'club', owner_id: proClub.id, plan: 'club_pro', status: 'active',
  stripe_customer_id: 'cus_billing_shot_fake', stripe_subscription_id: 'sub_billing_shot_fake'
});

async function loginCookies(email) {
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(PW)}`
  });
  const setC = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  return (setC || []).filter(Boolean).map((c) => {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    return { name: pair.slice(0, i), value: pair.slice(i + 1), url: 'http://localhost:80' };
  });
}

const browser = await launchBrowser();
try {
  for (const who of ['coach', 'admin', 'owner']) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 1400 } });
    await ctx.addCookies(await loginCookies(EMAILS[who]));
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE + '/billing', { waitUntil: 'networkidle' });
    const body = await page.textContent('body');
    if (who === 'coach') {
      check('coach: empty-state copy shown', body.includes('You don\u2019t manage billing for any clubs'));
      check('coach: no upgrade/portal club buttons',
        (await page.locator('button:has-text("Upgrade to Club Pro")').count()) === 0 &&
        (await page.locator('button:has-text("Manage billing")').count()) === 0);
    } else {
      check(who + ': sees both club cards', body.includes(PRO) && body.includes(FREE));
      check(who + ': upgrade button on free club', body.includes('Upgrade to Club Pro'));
      check(who + ': portal button on pro club', await page.locator('button:has-text("Manage billing")').count() >= 1);
    }
    check(who + ': zero console errors', errors.length === 0, errors);
    await page.screenshot({ path: '/tmp/billing-' + who + '.png', fullPage: true });
    console.log('saved /tmp/billing-' + who + '.png');
    await ctx.close();
  }
} finally {
  await browser.close();
  await admin.from('subscriptions').delete().eq('stripe_customer_id', 'cus_billing_shot_fake');
  await admin.from('memberships').delete().in('club_id', [proClub.id, freeClub.id]);
  await admin.from('clubs').delete().in('name', [PRO, FREE]);
  for (const uid of Object.values(ids)) await admin.auth.admin.deleteUser(uid);
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
