// E2E: club dashboard "Create a club event" modal cover-image flow.
// Drives the REAL dashboard UI in a browser as a coach: open the modal, fill
// the form, pick a sentinel-banded file, use the shared crop overlay
// (arenas-crop.js — slider to the TOP band, so a center-crop would produce
// the wrong pixels), submit, and prove:
//   - the created event has an image (payload version token + storage object)
//   - the stored banner is the CHOSEN band (top/red), not the center band
//   - a create with NO image still succeeds and stays imageless
//   - the dashboard event card renders no <img> (ships image-free by decision)
// Cleanup is tracked-row + error-checked user deletion (manifest logged).
// Run with the dev server up:
//   node artifacts/html-arenas/scripts/verify-dashboard-create-image.js
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { launchBrowser } from './lib/mobile-geometry.js';

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DOMAIN = process.env.REPLIT_DEV_DOMAIN;
const BASE = `https://${DOMAIN}/html`;
const PW = 'ArenasTest!234';
const EMAIL = 'dcimg-coach@arenas-test.dev';
const BUCKET = 'event-images';

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? '  ok' : 'FAIL'}  ${name}${ok ? '' : ' — ' + String(detail).slice(0, 300)}`);
  if (!ok) failures++;
};

// Kill any prior residue for this email.
{
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of (data && data.users) || []) if (u.email === EMAIL) await admin.auth.admin.deleteUser(u.id);
  await admin.from('clubs').delete().eq('handle', 'dcimg-club');
}

const { data: created, error: mkErr } = await admin.auth.admin.createUser({
  email: EMAIL, password: PW, email_confirm: true,
  user_metadata: { name: 'Dcimg Coach', handle: 'dcimg_coach' }
});
if (mkErr) { console.error('FATAL: createUser: ' + mkErr.message); process.exit(1); }
const coachId = created.user.id;
const { data: club, error: clubErr } = await admin.from('clubs')
  .insert({ name: 'Dcimg Club', handle: 'dcimg-club', sport: 'running', owner_id: coachId }).select().single();
if (clubErr) { console.error('FATAL: club: ' + clubErr.message); process.exit(1); }
await admin.from('memberships').insert({ user_id: coachId, club_id: club.id, role: 'coach' });
console.log('MANIFEST:', JSON.stringify({ coach: coachId, club: club.id }));

// 300×900 sentinel: red top / green middle / blue bottom. A center crop
// yields green; the test drives the slider to 0 and demands red.
const sentinel = await sharp({
  create: { width: 300, height: 900, channels: 3, background: { r: 255, g: 0, b: 0 } }
}).composite([
  { input: await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 0, g: 200, b: 0 } } }).png().toBuffer(), top: 300, left: 0 },
  { input: await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 0, g: 0, b: 255 } } }).png().toBuffer(), top: 600, left: 0 }
]).png().toBuffer();

let browser = null;
try {
  // Login (cookie for the browser context).
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
  const cookieHeader = cookies.map((c) => c.name + '=' + c.value).join('; ');

  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies(cookies);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '/clubs/dashboard?club=' + club.id, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('typeof window.openCreateClubEvent === "function"');
  check('crop stack loaded on dashboard', await page.evaluate('!!window.arenasCrop && !!window.arenasOverlay'));

  // ── Create WITH image via the real modal + crop overlay ──
  await page.evaluate('window.openCreateClubEvent()');
  await page.waitForSelector('#cev-title');
  await page.fill('#cev-title', 'Dcimg Banner Session');
  await page.fill('#cev-location', 'Dcimg Track');
  await page.setInputFiles('#cev-image', { name: 'sentinel.png', mimeType: 'image/png', buffer: sentinel });
  await page.waitForSelector('#ac-use', { timeout: 10000 });
  check('crop overlay opened from dashboard file pick', true);
  await page.waitForSelector('#ac-slider');
  await page.evaluate(() => {
    const s = document.getElementById('ac-slider');
    s.value = '0'; s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#ac-use');
  await page.waitForSelector('#ac-use', { state: 'detached' });
  await page.click('#cev-submit-btn');
  // Toast then reload; wait for the event row to appear with an image.
  let ev = null;
  for (let i = 0; i < 40 && !ev; i++) {
    const { data } = await admin.from('events').select('id, image_path, club_id').eq('title', 'Dcimg Banner Session').maybeSingle();
    if (data && data.image_path) ev = data;
    else await new Promise((res) => setTimeout(res, 500));
  }
  check('event created from dashboard with image_path set', !!ev, 'no event/image after 20s');
  if (ev) {
    const { data: objs } = await admin.storage.from(BUCKET).list('events/' + ev.id);
    check('storage object exists', (objs || []).length === 1, JSON.stringify(objs));
    // Proxy serves it; pixels are the CHOSEN top band (red), not center green.
    const pr = await fetch(BASE + '/api/events/' + ev.id + '/image', { headers: { Cookie: cookieHeader } });
    check('proxy 200 image/webp', pr.status === 200 && (pr.headers.get('content-type') || '').includes('image/webp'), pr.status);
    const buf = Buffer.from(await pr.arrayBuffer());
    const px = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const at = (x, y) => { const i = (y * px.info.width + x) * px.info.channels; return [px.data[i], px.data[i + 1], px.data[i + 2]]; };
    const [cr, cg, cb] = at(600, 200);
    check('banner is the CHOSEN top band (red, not center green)', cr > 180 && cg < 80 && cb < 80, `rgb(${cr},${cg},${cb})`);
    // Events payload carries the version token for it.
    const payload = await (await fetch(BASE + '/api/events', { headers: { Cookie: cookieHeader } })).json();
    const inPayload = [].concat(payload.clubEvents || [], payload.myCreatedEvents || []).find((e) => e.id === ev.id);
    check('events payload carries image version token', inPayload && /^\d+$/.test(String(inPayload.image)), JSON.stringify(inPayload && inPayload.image));
    // Dashboard card ships image-free: no <img> inside the club event card.
    // Hash-less URL: a hash-only change would be a same-document navigation
    // (no server request, stale DOM).
    await page.goto(BASE + '/clubs/dashboard?club=' + club.id, { waitUntil: 'domcontentloaded' });
    // Cards live in the Events tab, which may be hidden on load — attachment
    // is what matters for the "no <img> in the card markup" assertion.
    try {
      await page.waitForSelector('.club-event-card', { state: 'attached', timeout: 15000 });
      const cardHasImg = await page.evaluate(() => !!document.querySelector('.club-event-card img'));
      check('dashboard event card renders no image (by decision)', !cardHasImg);
      const leaked = await page.evaluate((p) => document.documentElement.outerHTML.includes(p), ev.image_path);
      check('dashboard page data carries no image_path (server-only)', !leaked, ev.image_path);
    } catch (waitErr) {
      const dbg = await page.evaluate(() => {
        const d = window.ARENAS_DATA || {};
        return { url: location.href, club: d.club && d.club.id, up: (d.upcomingEvents || []).length, past: (d.pastEvents || []).length, list: !!document.getElementById('club-events-list') };
      });
      check('dashboard event card renders no image (by decision)', false, 'no card — ' + JSON.stringify(dbg));
    }
  }

  // ── Create with NO image still succeeds and stays imageless ──
  await page.evaluate('window.openCreateClubEvent()');
  await page.waitForSelector('#cev-title');
  await page.fill('#cev-title', 'Dcimg Plain Session');
  await page.fill('#cev-location', 'Dcimg Field');
  await page.click('#cev-submit-btn');
  let plain = null;
  for (let i = 0; i < 40 && !plain; i++) {
    const { data } = await admin.from('events').select('id, image_path').eq('title', 'Dcimg Plain Session').maybeSingle();
    if (data) plain = data;
    else await new Promise((res) => setTimeout(res, 500));
  }
  check('imageless create succeeds', !!plain, 'no event after 20s');
  check('imageless event has null image_path', plain && plain.image_path === null, JSON.stringify(plain));

  // ── Lifecycle: closing the modal right after picking a file must tear
  // down the crop (token invalidated, overlay gone) and a freshly opened
  // modal must still create cleanly.
  // The dashboard reloads itself 1.5s after a successful create — let that
  // navigation land first or evaluate() dies with "context destroyed".
  await new Promise((res) => setTimeout(res, 2500));
  await page.waitForFunction('typeof window.openCreateClubEvent === "function"');
  await page.evaluate('window.openCreateClubEvent()');
  await page.waitForSelector('#cev-title');
  await page.setInputFiles('#cev-image', { name: 'sentinel.png', mimeType: 'image/png', buffer: sentinel });
  await page.evaluate('window.closeCreateClubEvent()'); // close while crop opens/decodes
  await new Promise((res) => setTimeout(res, 1500));
  const survived = await page.evaluate(() => ({
    crop: !!document.getElementById('arenas-crop-overlay'),
    modal: !!document.getElementById('create-club-event-overlay'),
    scrollLocked: document.body.style.overflow === 'hidden'
  }));
  check('crop overlay does not outlive the modal (no scroll lock)', !survived.crop && !survived.modal && !survived.scrollLocked, JSON.stringify(survived));
  await page.evaluate('window.openCreateClubEvent()');
  await page.waitForSelector('#cev-title');
  await page.fill('#cev-title', 'Dcimg After Teardown');
  await page.fill('#cev-location', 'Dcimg Court');
  await page.click('#cev-submit-btn');
  let after = null;
  for (let i = 0; i < 40 && !after; i++) {
    const { data } = await admin.from('events').select('id, image_path').eq('title', 'Dcimg After Teardown').maybeSingle();
    if (data) after = data;
    else await new Promise((res) => setTimeout(res, 500));
  }
  check('reopened modal creates cleanly after teardown', !!after && after.image_path === null, JSON.stringify(after));

  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (err) {
  check('run completed', false, err.message);
} finally {
  if (browser) await browser.close();
  // Cleanup: events via API-order (rows first w/ object cleanup handled by
  // server on DELETE), then memberships/club/user — every step error-checked.
  const { data: evs } = await admin.from('events').select('id, image_path').eq('club_id', club.id);
  for (const e of evs || []) {
    if (e.image_path) await admin.storage.from(BUCKET).remove([e.image_path]);
    const { data: objs } = await admin.storage.from(BUCKET).list('events/' + e.id);
    if ((objs || []).length) await admin.storage.from(BUCKET).remove(objs.map((o) => 'events/' + e.id + '/' + o.name));
  }
  const del = async (p, name) => { const { error } = await p; check('cleanup: ' + name, !error, error && error.message); };
  await del(admin.from('event_rsvps').delete().eq('user_id', coachId), 'rsvps');
  await del(admin.from('events').delete().eq('club_id', club.id), 'events');
  await del(admin.from('notifications').delete().eq('user_id', coachId), 'notifications (user)');
  await del(admin.from('notifications').delete().eq('actor_id', coachId), 'notifications (actor)');
  await del(admin.from('memberships').delete().eq('club_id', club.id), 'memberships');
  await del(admin.from('clubs').delete().eq('id', club.id), 'club');
  const { error: uErr } = await admin.auth.admin.deleteUser(coachId);
  check('cleanup: coach user deleted', !uErr, uErr && uErr.message);
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
