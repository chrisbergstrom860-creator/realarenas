// Edit-path e2e: drives the REAL dashboard edit modal (shared
// arenas-event-form.js, mode 'edit') end to end and proves the PATCH
// round-trip — including the two fields the convergence added to the
// dashboard forms: entry_fee and max_participants.
// Checks: prefill (title/date/time/fee/max), field edits through the modal,
// DB row after save, and that ✕/Cancel close without saving.
// Cleanup is tracked-row + error-checked user deletion (manifest logged).
// Run with the dev server up:
//   node artifacts/html-arenas/scripts/verify-event-edit.js
import { createClient } from '@supabase/supabase-js';
import { launchBrowser } from './lib/mobile-geometry.js';

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DOMAIN = process.env.REPLIT_DEV_DOMAIN;
const BASE = `https://${DOMAIN}/html`;
const PW = 'ArenasTest!234';
const EMAIL = 'evedit-coach@arenas-test.dev';

let failures = 0;
function check(name, ok, extra) {
  console.log((ok ? '  ok  ' : 'FAIL  ') + name + (ok || !extra ? '' : ' — ' + extra));
  if (!ok) failures++;
}

// Pre-clean leftovers from an interrupted run.
{
  const { data: leftover } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of (leftover && leftover.users) || []) {
    if (u.email === EMAIL) await admin.auth.admin.deleteUser(u.id);
  }
  await admin.from('clubs').delete().eq('handle', 'evedit-club');
}

const { data: created, error: mkErr } = await admin.auth.admin.createUser({
  email: EMAIL, password: PW, email_confirm: true,
  user_metadata: { name: 'Evedit Coach', handle: 'evedit_coach' }
});
if (mkErr) { console.error('FATAL: createUser: ' + mkErr.message); process.exit(1); }
const coachId = created.user.id;
const { data: club, error: clubErr } = await admin.from('clubs')
  .insert({ name: 'Evedit Club', handle: 'evedit-club', sport: 'running', owner_id: coachId }).select().single();
if (clubErr) { console.error('FATAL: club: ' + clubErr.message); process.exit(1); }
await admin.from('memberships').insert({ user_id: coachId, club_id: club.id, role: 'coach' });

const origDate = new Date(Date.now() + 3 * 86400000);
origDate.setHours(9, 30, 0, 0);
const { data: ev, error: evErr } = await admin.from('events').insert({
  title: 'Evedit Original', sport: 'running', event_type: 'Track session',
  date: origDate.toISOString(), location: 'Evedit Track', distance: '5km',
  level: 'Intermediate', description: 'Original description',
  entry_fee: '£5', max_participants: 10,
  visibility: 'club', club_id: club.id, created_by: coachId
}).select().single();
if (evErr) { console.error('FATAL: event: ' + evErr.message); process.exit(1); }
console.log('MANIFEST:', JSON.stringify({ coach: coachId, club: club.id, event: ev.id }));

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
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies(cookies);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '/clubs/dashboard?club=' + club.id, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('typeof window.editClubEvent === "function"');

  // ── Cancel path: open, then Cancel — nothing saved.
  await page.evaluate(`window.editClubEvent(${JSON.stringify(ev.id)})`);
  await page.waitForSelector('#edit-ev-title');
  const prefill = await page.evaluate(() => ({
    title: document.getElementById('edit-ev-title').value,
    date: document.getElementById('edit-ev-date').value,
    time: document.getElementById('edit-ev-time').value,
    fee: document.getElementById('edit-ev-fee').value,
    max: document.getElementById('edit-ev-max').value,
    type: document.getElementById('edit-ev-type').value,
    level: document.getElementById('edit-ev-level').value,
    hasSportField: !!document.getElementById('edit-ev-sports') || !!document.getElementById('edit-ev-sport')
  }));
  check('prefill: title', prefill.title === 'Evedit Original', prefill.title);
  check('prefill: date + time split from stored ISO',
    prefill.date === origDate.toISOString().split('T')[0] && /^\d\d:\d\d$/.test(prefill.time),
    JSON.stringify(prefill));
  check('prefill: entry fee + max participants (new on dashboard edit)',
    prefill.fee === '£5' && prefill.max === '10', JSON.stringify(prefill));
  check('prefill: type/level selects carry stored values',
    prefill.type === 'Track session' && prefill.level === 'Intermediate', JSON.stringify(prefill));
  check('edit mode has no sport field', !prefill.hasSportField);
  await page.fill('#edit-ev-title', 'Should Not Save');
  await page.click('#edit-ev-cancel');
  await page.waitForTimeout(400);
  const afterCancel = await admin.from('events').select('title').eq('id', ev.id).single();
  check('Cancel saves nothing', afterCancel.data && afterCancel.data.title === 'Evedit Original',
    JSON.stringify(afterCancel.data));
  const modalGone = await page.evaluate(() => !document.getElementById('edit-event-overlay'));
  check('Cancel closes the modal', modalGone);

  // ── Save path: change every PATCHable field incl. fee + max.
  await page.evaluate(`window.editClubEvent(${JSON.stringify(ev.id)})`);
  await page.waitForSelector('#edit-ev-title');
  const newDate = new Date(Date.now() + 5 * 86400000);
  const newDateStr = newDate.toISOString().split('T')[0];
  await page.fill('#edit-ev-title', 'Evedit Updated');
  await page.selectOption('#edit-ev-type', 'Race');
  await page.fill('#edit-ev-date', newDateStr);
  await page.fill('#edit-ev-time', '18:45');
  await page.fill('#edit-ev-location', 'Evedit Stadium');
  await page.fill('#edit-ev-distance', '10km');
  await page.fill('#edit-ev-fee', '£15');
  await page.fill('#edit-ev-max', '25');
  await page.selectOption('#edit-ev-level', 'Advanced');
  await page.fill('#edit-ev-desc', 'Updated description');
  await page.click('#edit-ev-submit-btn');
  let row = null;
  for (let i = 0; i < 20 && !row; i++) {
    const { data } = await admin.from('events').select('*').eq('id', ev.id).single();
    if (data && data.title === 'Evedit Updated') row = data;
    else await new Promise((res) => setTimeout(res, 500));
  }
  check('PATCH round-trip: title', !!row, 'row never updated');
  if (row) {
    check('PATCH round-trip: event_type/location/distance/level/description',
      row.event_type === 'Race' && row.location === 'Evedit Stadium' &&
      row.distance === '10km' && row.level === 'Advanced' && row.description === 'Updated description',
      JSON.stringify(row));
    check('PATCH round-trip: entry_fee + max_participants',
      row.entry_fee === '£15' && Number(row.max_participants) === 25,
      JSON.stringify({ fee: row.entry_fee, max: row.max_participants }));
    // ISO composed client-side from the date+time inputs (local tz).
    const expected = new Date(newDateStr + 'T18:45').toISOString();
    check('PATCH round-trip: date composed from split date+time inputs',
      new Date(row.date).toISOString() === expected,
      row.date + ' vs ' + expected);
    check('untouched fields survive (sport, club, visibility)',
      row.sport === 'running' && row.club_id === club.id && row.visibility === 'club',
      JSON.stringify({ sport: row.sport, club: row.club_id, vis: row.visibility }));
  }

  // ── Image manager lifecycle (new dashboard Image action, shared module):
  // closing the manager right after picking a file must cancel a mid-decode
  // crop — no orphan crop overlay, no scroll lock.
  // The dashboard reloads itself 1.2s after a successful save — let that
  // navigation land first or evaluate() dies with "context destroyed".
  await page.waitForTimeout(2500);
  await page.waitForFunction('typeof window.manageClubEventImage === "function"');
  await page.evaluate(`window.manageClubEventImage(${JSON.stringify(ev.id)})`);
  await page.waitForSelector('#evx-img-file');
  const tinyPng = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c62f8cfc000000400ffff030000060005fe9b48ad0000000049454e44ae426082', 'hex');
  await page.setInputFiles('#evx-img-file', { name: 't.png', mimeType: 'image/png', buffer: tinyPng });
  // The crop overlay (z 600) may already sit above the manager — close via
  // direct DOM click, mirroring a teardown that races the decode.
  await page.evaluate(() => document.getElementById('evx-img-x').click());
  await page.waitForTimeout(1200);
  const imgSurvived = await page.evaluate(() => ({
    crop: !!document.getElementById('arenas-crop-overlay'),
    manager: !!document.getElementById('evx-img-modal'),
    scrollLocked: document.body.style.overflow === 'hidden'
  }));
  check('image manager close tears down crop (no orphan overlay/scroll lock)',
    !imgSurvived.crop && !imgSurvived.manager && !imgSurvived.scrollLocked, JSON.stringify(imgSurvived));

  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (err) {
  check('run completed', false, err.message);
} finally {
  if (browser) await browser.close();
  const del = async (p, name) => { const { error } = await p; check('cleanup: ' + name, !error, error && error.message); };
  await del(admin.from('events').delete().eq('club_id', club.id), 'events');
  await del(admin.from('notifications').delete().eq('user_id', coachId), 'notifications');
  await del(admin.from('memberships').delete().eq('club_id', club.id), 'memberships');
  await del(admin.from('clubs').delete().eq('id', club.id), 'club');
  {
    const { error } = await admin.auth.admin.deleteUser(coachId);
    check('cleanup: coach user deleted', !error, error && error.message);
  }
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
