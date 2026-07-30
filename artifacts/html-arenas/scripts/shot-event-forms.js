// Screenshot the three event forms (events-page create, dashboard create,
// dashboard edit) at 1280px and 380px. Usage:
//   node scripts/shot-event-forms.js before   → /tmp/shots/before-*.png
//   node scripts/shot-event-forms.js after    → /tmp/shots/after-*.png
// Seeds a coach + club + one event; cleans up fully (error-checked).
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import { launchBrowser } from './lib/mobile-geometry.js';

const LABEL = process.argv[2] || 'before';
const OUT = '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DOMAIN = process.env.REPLIT_DEV_DOMAIN;
const BASE = `https://${DOMAIN}/html`;
const PW = 'ArenasTest!234';
const EMAIL = 'efshot-coach@arenas-test.dev';

{
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of (data && data.users) || []) if (u.email === EMAIL) await admin.auth.admin.deleteUser(u.id);
  await admin.from('clubs').delete().eq('handle', 'efshot-club');
}
const { data: created, error: mkErr } = await admin.auth.admin.createUser({
  email: EMAIL, password: PW, email_confirm: true,
  user_metadata: { name: 'Efshot Coach', handle: 'efshot_coach' }
});
if (mkErr) { console.error('FATAL createUser: ' + mkErr.message); process.exit(1); }
const uid = created.user.id;
const { data: club } = await admin.from('clubs')
  .insert({ name: 'Efshot Club', handle: 'efshot-club', sport: 'running', owner_id: uid }).select().single();
await admin.from('memberships').insert({ user_id: uid, club_id: club.id, role: 'coach' });
const { data: ev } = await admin.from('events').insert({
  title: 'Efshot Session', sport: 'running', event_type: 'Track session',
  date: new Date(Date.now() + 86400000).toISOString(), location: 'Efshot Track',
  distance: '5km', level: 'Intermediate', description: 'Shot fixture',
  visibility: 'club', club_id: club.id, created_by: uid
}).select().single();
console.log('MANIFEST:', JSON.stringify({ uid, club: club.id, event: ev.id }));

let browser = null;
try {
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(EMAIL)}&password=${encodeURIComponent(PW)}`
  });
  const setC = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  const cookies = (setC || []).filter(Boolean).map((c) => {
    const [pair] = c.split(';'); const i = pair.indexOf('=');
    return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: DOMAIN, path: '/' };
  });
  if (r.status !== 302 || !cookies.length) throw new Error('login failed');

  browser = await launchBrowser();
  for (const width of [1280, 380]) {
    const context = await browser.newContext({ viewport: { width, height: 1400 } });
    await context.addCookies(cookies);
    const page = await context.newPage();

    // 1) Events page create form
    await page.goto(BASE + '/events', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('typeof window.openCreateEvent === "function"');
    await page.evaluate('window.openCreateEvent()');
    await page.waitForSelector('#evx-form');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${LABEL}-events-create-${width}.png`, fullPage: true });

    // 2) Dashboard create form
    await page.goto(BASE + '/clubs/dashboard?club=' + club.id, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('typeof window.openCreateClubEvent === "function"');
    await page.evaluate('window.openCreateClubEvent()');
    await page.waitForSelector('#cev-title');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${LABEL}-dash-create-${width}.png`, fullPage: true });

    // 3) Dashboard edit form
    await page.goto(BASE + '/clubs/dashboard?club=' + club.id, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('typeof window.editClubEvent === "function"');
    await page.evaluate((id) => window.editClubEvent(id), ev.id);
    await page.waitForSelector('#edit-ev-title');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${LABEL}-dash-edit-${width}.png`, fullPage: true });

    await context.close();
  }
  console.log('shots written to ' + OUT);
} catch (err) {
  console.error('FAIL: ' + err.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await admin.from('events').delete().eq('club_id', club.id);
  await admin.from('notifications').delete().eq('user_id', uid);
  await admin.from('notifications').delete().eq('actor_id', uid);
  await admin.from('memberships').delete().eq('club_id', club.id);
  await admin.from('clubs').delete().eq('id', club.id);
  const { error: uErr } = await admin.auth.admin.deleteUser(uid);
  console.log('cleanup ' + (uErr ? 'FAILED: ' + uErr.message : 'ok'));
}
