// Athlete self-edit e2e (events page host) + the material-change
// notification policy that now applies to BOTH hosts (single PATCH path):
//   - zero-leak: outsider PATCH on a private event is byte-identical to a
//     PATCH on a nonexistent id
//   - an RSVP'd attendee (visible event, no manage rights) gets the
//     permission refusal and the row is untouched
//   - notification matrix: fires on date change, fires on location change,
//     NOT on description-only edits, respects notify_events=false, reaches
//     going + interested and nobody else (not cancelled, not the actor)
//   - RSVPs survive an edit
//   - UI: Edit button on the owner card, real modal round-trip (events-page
//     context: free-text type/level, split date/time, NO visibility field),
//     Cancel saves nothing
// Cleanup is tracked + error-checked (manifest logged).
// Run with the dev server up:
//   node artifacts/html-arenas/scripts/verify-event-self-edit.js
import { createClient } from '@supabase/supabase-js';
import { launchBrowser } from './lib/mobile-geometry.js';

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DOMAIN = process.env.REPLIT_DEV_DOMAIN;
const BASE = `https://${DOMAIN}/html`;
const PW = 'ArenasTest!234';
const EMAILS = {
  creator: 'evself-creator@arenas-test.dev',
  outsider: 'evself-outsider@arenas-test.dev',
  going: 'evself-going@arenas-test.dev',
  interested: 'evself-interested@arenas-test.dev',
  cancelled: 'evself-cancelled@arenas-test.dev',
  optout: 'evself-optout@arenas-test.dev'      // going, but notify_events=false
};

let failures = 0;
function check(name, ok, extra) {
  console.log((ok ? '  ok  ' : 'FAIL  ') + name + (ok || !extra ? '' : ' — ' + extra));
  if (!ok) failures++;
}

// Pre-clean leftovers from an interrupted run.
{
  const { data: leftover } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emails = new Set(Object.values(EMAILS));
  for (const u of (leftover && leftover.users) || []) {
    if (emails.has(u.email)) await admin.auth.admin.deleteUser(u.id);
  }
}

const U = {};
for (const [key, email] of Object.entries(EMAILS)) {
  const meta = { name: 'Evself ' + key, handle: 'evself_' + key };
  if (key === 'optout') meta.prefs = { notify_events: false };
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PW, email_confirm: true, user_metadata: meta
  });
  if (error) { console.error('FATAL: createUser ' + key + ': ' + error.message); process.exit(1); }
  U[key] = data.user.id;
}

const origDate = new Date(Date.now() + 4 * 86400000);
origDate.setHours(9, 0, 0, 0);
const mkEvent = async (over) => {
  const { data, error } = await admin.from('events').insert({
    title: 'Evself Social Run', sport: 'running', event_type: 'Community run',
    date: origDate.toISOString(), location: 'Evself Park Gates', distance: '8km',
    level: 'All abilities', description: 'Original description',
    entry_fee: null, max_participants: null,
    visibility: 'public', club_id: null, created_by: U.creator, ...over
  }).select().single();
  if (error) { console.error('FATAL: event: ' + error.message); process.exit(1); }
  return data;
};
const evPub = await mkEvent({});
const evPriv = await mkEvent({ title: 'Evself Secret Relay', visibility: 'private' });
for (const [uid, status] of [[U.going, 'going'], [U.interested, 'interested'], [U.cancelled, 'cancelled'], [U.optout, 'going']]) {
  await admin.from('event_rsvps').insert({ event_id: evPub.id, user_id: uid, status });
}
console.log('MANIFEST:', JSON.stringify({ users: U, events: [evPub.id, evPriv.id] }));

async function login(email) {
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(PW)}`
  });
  const setC = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  const cookieHeader = (setC || []).filter(Boolean).map((c) => c.split(';')[0]).join('; ');
  if (r.status !== 302 || !cookieHeader) throw new Error('login failed for ' + email);
  return cookieHeader;
}
const patch = (cookie, id, body) => fetch(BASE + '/api/events/' + encodeURIComponent(id), {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify(body)
});
const notifCount = async (uid, entityId) => {
  const { data } = await admin.from('notifications').select('id, type, title')
    .eq('user_id', uid).eq('entity_id', entityId).eq('type', 'event').eq('title', 'Event updated');
  return (data || []).length;
};
const clearNotifs = () => admin.from('notifications').delete().in('user_id', Object.values(U));

let browser = null;
try {
  const ck = {};
  for (const key of ['creator', 'outsider', 'going']) ck[key] = await login(EMAILS[key]);

  // ── Zero-leak: outsider PATCH on the private event vs a nonexistent id —
  // byte-identical bodies (the established standard).
  const fakeId = '00000000-0000-4000-8000-000000000000';
  const [leakRes, ghostRes] = await Promise.all([
    patch(ck.outsider, evPriv.id, { title: 'Hijacked' }),
    patch(ck.outsider, fakeId, { title: 'Hijacked' })
  ]);
  const [leakBody, ghostBody] = [await leakRes.text(), await ghostRes.text()];
  check('zero-leak: outsider PATCH on private event is byte-identical to nonexistent id',
    leakBody === ghostBody && leakBody.includes('Event not found'),
    JSON.stringify({ leakBody, ghostBody }));
  const privAfter = await admin.from('events').select('title').eq('id', evPriv.id).single();
  check('zero-leak: private event row untouched', privAfter.data.title === 'Evself Secret Relay');

  // ── RSVP'd attendee (visible public event, no manage rights): refusal, not
  // a leak; row untouched.
  const attRes = await patch(ck.going, evPub.id, { title: 'Attendee Takeover' });
  const attBody = await attRes.json();
  check('attendee PATCH refused with permission message',
    attBody && attBody.error === 'You do not have permission to edit this event', JSON.stringify(attBody));
  const pubAfter1 = await admin.from('events').select('title').eq('id', evPub.id).single();
  check('attendee PATCH: row untouched', pubAfter1.data.title === 'Evself Social Run');

  // ── Notification matrix (single PATCH path — same behavior both hosts).
  // 1) description-only edit → silent.
  await clearNotifs();
  await (await patch(ck.creator, evPub.id, { description: 'Cosmetic tweak only' })).json();
  await new Promise((r) => setTimeout(r, 800));
  check('description-only edit notifies nobody',
    (await notifCount(U.going, evPub.id)) === 0 && (await notifCount(U.interested, evPub.id)) === 0);

  // 2) date change → going + interested notified; cancelled, opt-out, actor not.
  await clearNotifs();
  const newDate = new Date(Date.now() + 6 * 86400000); newDate.setHours(18, 30, 0, 0);
  await (await patch(ck.creator, evPub.id, { date: newDate.toISOString() })).json();
  await new Promise((r) => setTimeout(r, 1200));
  const dateCounts = {
    going: await notifCount(U.going, evPub.id),
    interested: await notifCount(U.interested, evPub.id),
    cancelled: await notifCount(U.cancelled, evPub.id),
    optout: await notifCount(U.optout, evPub.id),
    creator: await notifCount(U.creator, evPub.id)
  };
  check('date change notifies going + interested',
    dateCounts.going === 1 && dateCounts.interested === 1, JSON.stringify(dateCounts));
  check('date change: cancelled RSVP not notified', dateCounts.cancelled === 0, JSON.stringify(dateCounts));
  check('date change: notify_events=false respected', dateCounts.optout === 0, JSON.stringify(dateCounts));
  check('date change: actor not notified', dateCounts.creator === 0, JSON.stringify(dateCounts));
  {
    const { data } = await admin.from('notifications').select('body')
      .eq('user_id', U.going).eq('entity_id', evPub.id).eq('title', 'Event updated').limit(1);
    const body = (data && data[0] && data[0].body) || '';
    check('date change notification names the date', /changed the date of/.test(body), body);
  }

  // 3) unchanged date resubmitted (form always sends it) → silent.
  await clearNotifs();
  await (await patch(ck.creator, evPub.id, { date: newDate.toISOString(), title: 'Evself Social Run' })).json();
  await new Promise((r) => setTimeout(r, 800));
  check('resubmitting an unchanged date notifies nobody', (await notifCount(U.going, evPub.id)) === 0);

  // 4) location change → fires.
  await clearNotifs();
  await (await patch(ck.creator, evPub.id, { location: 'Evself South Entrance' })).json();
  await new Promise((r) => setTimeout(r, 1200));
  check('location change notifies going RSVP', (await notifCount(U.going, evPub.id)) === 1);

  // 5) location normalization. The column is NOT NULL in the schema, so a
  // null submission surfaces the DB error (no silent fallback) and must not
  // notify; a whitespace-padded resubmission of the same value is trimmed by
  // the change detection and stays silent.
  await clearNotifs();
  const nullRes = await (await patch(ck.creator, evPub.id, { location: null })).json();
  await new Promise((r) => setTimeout(r, 800));
  check('location null is refused by the DB (explicit error, not silent)',
    nullRes && /not-null/.test(nullRes.error || ''), JSON.stringify(nullRes));
  check('refused null-location edit notifies nobody', (await notifCount(U.going, evPub.id)) === 0);
  const nullRow = await admin.from('events').select('location').eq('id', evPub.id).single();
  check('refused null-location edit leaves the row untouched',
    nullRow.data.location === 'Evself South Entrance', JSON.stringify(nullRow.data));
  await clearNotifs();
  await (await patch(ck.creator, evPub.id, { location: '  Evself South Entrance  ' })).json();
  await new Promise((r) => setTimeout(r, 800));
  check('whitespace-padded same location notifies nobody (trim normalization)',
    (await notifCount(U.going, evPub.id)) === 0);
  await (await patch(ck.creator, evPub.id, { location: 'Evself South Entrance' })).json(); // restore exact value

  // ── RSVPs survive all of the above edits.
  const { data: rsvps } = await admin.from('event_rsvps').select('user_id, status').eq('event_id', evPub.id);
  const byUser = Object.fromEntries((rsvps || []).map((r) => [r.user_id, r.status]));
  check('RSVPs survive edits (statuses unchanged)',
    byUser[U.going] === 'going' && byUser[U.interested] === 'interested' &&
    byUser[U.cancelled] === 'cancelled' && byUser[U.optout] === 'going',
    JSON.stringify(byUser));

  // ── UI: the real events-page edit modal.
  const setC = ck.creator.split('; ').map((pair) => {
    const i = pair.indexOf('=');
    return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: DOMAIN, path: '/' };
  });
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies(setC);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '/events', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#events-grid > *');
  const cardEdit = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#events-grid button')].map((b) => b.textContent.trim());
    return { hasEdit: btns.includes('Edit'), btns: btns.slice(0, 12) };
  });
  check('owner card shows an Edit button', cardEdit.hasEdit, JSON.stringify(cardEdit.btns));

  // Cancel path: prefill + no visibility field + nothing saved on ✕.
  await page.evaluate(`ARENAS_EVENTS.edit(${JSON.stringify(evPub.id)})`);
  await page.waitForSelector('#eev-title');
  const prefill = await page.evaluate(() => ({
    title: document.getElementById('eev-title').value,
    date: document.getElementById('eev-date').value,
    time: document.getElementById('eev-time').value,
    typeTag: document.getElementById('eev-type').tagName,
    levelTag: document.getElementById('eev-level').tagName,
    hasVisibility: !!document.getElementById('eev-visibility'),
    hasClub: !!document.getElementById('eev-club'),
    hasInvitees: !!document.getElementById('eev-invitees'),
    bannerText: (document.querySelector('#eev-modal form') || {}).textContent || ''
  }));
  check('prefill: title', prefill.title === 'Evself Social Run', prefill.title);
  check('prefill: split date + time populated',
    /^\d{4}-\d\d-\d\d$/.test(prefill.date) && /^\d\d:\d\d$/.test(prefill.time), JSON.stringify(prefill));
  check('events-page context: type + level are free-text inputs',
    prefill.typeTag === 'INPUT' && prefill.levelTag === 'INPUT', JSON.stringify(prefill));
  check('edit mode has NO visibility/club/invitee fields (immutable by construction)',
    !prefill.hasVisibility && !prefill.hasClub && !prefill.hasInvitees, JSON.stringify(prefill));
  check('banner explains material-change notifications',
    /date or location/.test(prefill.bannerText) && /notified/.test(prefill.bannerText));
  await page.fill('#eev-title', 'Should Not Save');
  await page.click('#eev-close');
  await page.waitForTimeout(400);
  const afterCancel = await admin.from('events').select('title').eq('id', evPub.id).single();
  check('✕ closes without saving', afterCancel.data.title === 'Evself Social Run'
    && await page.evaluate(() => !document.getElementById('eev-modal')));

  // Save path: full round-trip through the real modal.
  await page.evaluate(`ARENAS_EVENTS.edit(${JSON.stringify(evPub.id)})`);
  await page.waitForSelector('#eev-title');
  const uiDate = new Date(Date.now() + 8 * 86400000).toISOString().split('T')[0];
  await page.fill('#eev-title', 'Evself Updated Run');
  await page.fill('#eev-type', 'Recovery jog');
  await page.fill('#eev-date', uiDate);
  await page.fill('#eev-time', '07:15');
  await page.fill('#eev-location', 'Evself North Loop');
  await page.fill('#eev-level', 'Beginners welcome');
  await page.fill('#eev-desc', 'Updated via events page');
  await page.click('#eev-submit');
  let row = null;
  for (let i = 0; i < 20 && !row; i++) {
    const { data } = await admin.from('events').select('*').eq('id', evPub.id).single();
    if (data && data.title === 'Evself Updated Run') row = data;
    else await new Promise((res) => setTimeout(res, 500));
  }
  const diag = row ? null : await page.evaluate(() => ({
    err: (document.getElementById('eev-error') || {}).textContent,
    errShown: !!(document.getElementById('eev-error') || {}).offsetParent,
    modal: !!document.getElementById('eev-modal'),
    btn: (document.getElementById('eev-submit') || {}).textContent
  })).catch((e) => ({ evalErr: String(e) }));
  check('UI PATCH round-trip: title', !!row, 'row never updated ' + JSON.stringify(diag));
  if (row) {
    check('UI PATCH round-trip: free-text type/level + location + description',
      row.event_type === 'Recovery jog' && row.level === 'Beginners welcome' &&
      row.location === 'Evself North Loop' && row.description === 'Updated via events page',
      JSON.stringify(row));
    const expected = new Date(uiDate + 'T07:15').toISOString();
    check('UI PATCH round-trip: date composed from split inputs',
      new Date(row.date).toISOString() === expected, row.date + ' vs ' + expected);
    check('untouched fields survive (sport, visibility, club)',
      row.sport === 'running' && row.visibility === 'public' && row.club_id === null,
      JSON.stringify({ sport: row.sport, vis: row.visibility, club: row.club_id }));
  }
  // The DB row lands before the client's success handler runs — give the
  // onSuccess close a beat before asserting.
  await page.waitForTimeout(800);
  const modalGone = await page.evaluate(() => !document.getElementById('eev-modal'));
  check('modal closes after save', modalGone);

  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (err) {
  check('run completed', false, err.message);
} finally {
  if (browser) await browser.close();
  const del = async (p, name) => { const { error } = await p; check('cleanup: ' + name, !error, error && error.message); };
  await del(admin.from('notifications').delete().in('user_id', Object.values(U)), 'notifications');
  await del(admin.from('event_rsvps').delete().in('event_id', [evPub.id, evPriv.id]), 'rsvps');
  await del(admin.from('events').delete().in('id', [evPub.id, evPriv.id]), 'events');
  for (const [key, uid] of Object.entries(U)) {
    const { error } = await admin.auth.admin.deleteUser(uid);
    check('cleanup: user ' + key, !error, error && error.message);
  }
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
