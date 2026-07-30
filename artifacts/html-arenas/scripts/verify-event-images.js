// Seeded verification of event cover images (private event-images bucket +
// authenticated proxy gated by the single canUserSeeEvent rule).
//   - acceptance bar: a non-invitee cannot reach a private event's image.
//     Stranger with a valid session: proxy on the real id is BYTE-IDENTICAL
//     to a ghost id (status + body). Unauthenticated: same parity.
//   - no storage URL / object path in any payload, including the data export
//   - invitee sees the image; stale/absent ?v= serves current bytes
//   - replace deletes the old object; remove clears pointer + object;
//     event delete and account delete leave no orphan (bucket prefix listed
//     before/after)
//   - creator-only upload with zero-leak denial; format validation
// Run with the dev server up:
//   node artifacts/html-arenas/scripts/verify-event-images.js
// Cleanup is built in (also covered by scripts/test-data-sweep.js --delete).

const crypto = require('crypto');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');

const BASE_URL = 'http://localhost:80/html';
const BUCKET = 'event-images';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const PW = 'ArenasTest!234';
const emails = {
  c: 'evimg-creator@arenas-test.dev',
  i: 'evimg-invitee@arenas-test.dev',
  s: 'evimg-stranger@arenas-test.dev',
  x: 'evimg-acctdel@arenas-test.dev',
  h: 'evimg-coach@arenas-test.dev',
  a: 'evimg-clubadmin@arenas-test.dev',
  m: 'evimg-member@arenas-test.dev'
};
const names = {
  c: ['Evimg Creator', 'evimg_creator'],
  i: ['Evimg Invitee', 'evimg_invitee'],
  s: ['Evimg Stranger', 'evimg_stranger'],
  x: ['Evimg Acctdel', 'evimg_acctdel'],
  h: ['Evimg Coach', 'evimg_coach'],
  a: ['Evimg Clubadmin', 'evimg_clubadmin'],
  m: ['Evimg Member', 'evimg_member']
};

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail ? ' — ' + String(detail).slice(0, 400) : '')); }
}

async function deleteUserByEmail(email) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of (data && data.users) || []) {
    if (u.email === email) await admin.auth.admin.deleteUser(u.id);
  }
}

const users = {};

async function mkUser(key) {
  await deleteUserByEmail(emails[key]);
  const { data, error } = await admin.auth.admin.createUser({
    email: emails[key], password: PW, email_confirm: true,
    user_metadata: { name: names[key][0], handle: names[key][1] }
  });
  if (error) throw new Error(key + ': ' + error.message);
  users[key] = { id: data.user.id };
}

async function login(key) {
  const r = await fetch(BASE_URL + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(emails[key])}&password=${encodeURIComponent(PW)}`,
    redirect: 'manual'
  });
  const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')])
    .map(c => String(c).split(';')[0]).join('; ');
  if (!cookie) throw new Error('login failed for ' + key);
  users[key].cookie = cookie;
}

function api(key, path, opts = {}) {
  return fetch(BASE_URL + path, {
    ...opts,
    headers: {
      Cookie: users[key].cookie,
      ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {})
    }
  });
}
async function apiJson(key, path, opts = {}) {
  const r = await api(key, path, opts);
  return { status: r.status, text: await r.text() };
}

// A real 900×900 PNG (portrait-ish square: proves crop-not-letterbox).
function makePng() {
  return sharp({ create: { width: 900, height: 900, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .png().toBuffer();
}

function uploadImage(key, eventId, buf, filename) {
  const fd = new FormData();
  fd.append('image', new Blob([buf], { type: 'image/png' }), filename || 'test.png');
  return fetch(BASE_URL + '/api/events/' + eventId + '/image', {
    method: 'POST', headers: { Cookie: users[key].cookie }, body: fd
  });
}

async function listPrefix(eventId) {
  const { data, error } = await admin.storage.from(BUCKET).list('events/' + eventId);
  if (error) throw new Error('list: ' + error.message);
  return (data || []).map(o => o.name);
}

const ghost = crypto.randomUUID();
async function proxyRaw(cookie, id, q) {
  const r = await fetch(BASE_URL + '/api/events/' + id + '/image' + (q || ''), {
    headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual'
  });
  return { status: r.status, ct: r.headers.get('content-type') || '', cc: r.headers.get('cache-control') || '', body: Buffer.from(await r.arrayBuffer()) };
}

async function main() {
  for (const k of ['c', 'i', 's', 'x', 'h', 'a', 'm']) { await mkUser(k); await login(k); }
  console.log('MANIFEST users:', JSON.stringify(Object.fromEntries(Object.keys(users).map(k => [k, users[k].id]))));
  await admin.from('follows').insert([{ follower_id: users.c.id, following_id: users.i.id }]);

  // Private event with invitee I; public event too (images are not private-only).
  const future = new Date(Date.now() + 7 * 86400000).toISOString();
  let r = await apiJson('c', '/api/events/create', {
    method: 'POST',
    body: JSON.stringify({ title: 'Evimg Private Ride', sport: 'cycling', date: future, location: 'Test Velodrome', visibility: 'private', invitees: [users.i.id] })
  });
  const priv = JSON.parse(r.text).event;
  r = await apiJson('c', '/api/events/create', {
    method: 'POST',
    body: JSON.stringify({ title: 'Evimg Public Run', sport: 'running', date: future, location: 'Test Park', visibility: 'public' })
  });
  const pub = JSON.parse(r.text).event;
  console.log('MANIFEST events:', JSON.stringify({ priv: priv.id, pub: pub.id }));

  const png = await makePng();

  // ── Upload: creator-only, zero-leak, format validation ──
  let up = await uploadImage('c', priv.id, png);
  let upBody = JSON.parse(await up.text());
  check('creator upload succeeds with version token', up.status === 200 && upBody.success && /^\d+$/.test(String(upBody.image)), JSON.stringify(upBody));
  check('upload response carries no path/URL', !(await Promise.resolve(JSON.stringify(upBody))).match(/image_path|storage\/v1/), JSON.stringify(upBody));

  const nonCreator = await apiJson('i', '/api/events/' + priv.id + '/image', { method: 'POST', body: JSON.stringify({}) });
  const ghostUp = await apiJson('i', '/api/events/' + ghost + '/image', { method: 'POST', body: JSON.stringify({}) });
  check('non-creator upload ≡ ghost id (byte-identical)', nonCreator.status === ghostUp.status && nonCreator.text === ghostUp.text, nonCreator.text + ' vs ' + ghostUp.text);

  const badFile = await uploadImage('c', pub.id, Buffer.from('not an image at all'), 'x.png');
  check('non-image file → 400', badFile.status === 400, badFile.status);

  up = await uploadImage('c', pub.id, png);
  upBody = JSON.parse(await up.text());
  check('public event upload also works (creator-only, not private-only)', up.status === 200 && upBody.success, JSON.stringify(upBody));

  // ── Proxy access ──
  const asC = await proxyRaw(users.c.cookie, priv.id);
  check('creator proxy 200 image/webp', asC.status === 200 && asC.ct === 'image/webp', asC.status + ' ' + asC.ct);
  check('Cache-Control private+immutable', /private/.test(asC.cc) && /immutable/.test(asC.cc) && /max-age=31536000/.test(asC.cc), asC.cc);
  const dims = await sharp(asC.body).metadata();
  check('served image is 1200×400 WebP cover-crop', dims.width === 1200 && dims.height === 400 && dims.format === 'webp', JSON.stringify({ w: dims.width, h: dims.height, f: dims.format }));

  const asI = await proxyRaw(users.i.cookie, priv.id);
  check('invitee proxy 200', asI.status === 200 && asI.body.equals(asC.body), asI.status);

  const sReal = await proxyRaw(users.s.cookie, priv.id);
  const sGhost = await proxyRaw(users.s.cookie, ghost);
  check('stranger: real id ≡ ghost id (status)', sReal.status === sGhost.status && sReal.status === 404, sReal.status + '/' + sGhost.status);
  check('stranger: real id ≡ ghost id (bytes)', sReal.body.equals(sGhost.body), sReal.body.toString().slice(0, 120) + ' vs ' + sGhost.body.toString().slice(0, 120));

  const uReal = await proxyRaw(null, priv.id);
  const uGhost = await proxyRaw(null, ghost);
  check('unauthenticated: real id ≡ ghost id', uReal.status === uGhost.status && uReal.body.equals(uGhost.body), uReal.status + '/' + uGhost.status);

  const staleV = await proxyRaw(users.c.cookie, priv.id, '?v=1');
  const noV = await proxyRaw(users.c.cookie, priv.id);
  check('stale ?v serves current bytes', staleV.status === 200 && staleV.body.equals(asC.body), staleV.status);
  check('absent ?v serves current bytes', noV.status === 200 && noV.body.equals(asC.body), noV.status);

  // ── No path / storage URL in any payload (incl. export) ──
  const surfaces = [
    ['GET /api/events (creator)', await apiJson('c', '/api/events')],
    ['GET /api/events (invitee)', await apiJson('i', '/api/events')],
    ['calendar month', await apiJson('c', '/api/calendar/month?month=' + future.slice(0, 7))],
    ['data export', await apiJson('c', '/api/account/export')],
    ['feed page HTML', await apiJson('i', '/feed')]
  ];
  for (const [tag, resp] of surfaces) {
    check(tag + ': no image_path / storage URL', !/image_path|storage\/v1\/object/.test(resp.text), (resp.text.match(/.{0,60}(image_path|storage\/v1\/object).{0,60}/) || [])[0]);
  }
  const evPayload = JSON.parse((await apiJson('c', '/api/events')).text);
  const privOut = [].concat(evPayload.myCreatedEvents || []).find(e => e.id === priv.id);
  check('payload carries version token only', privOut && /^\d+$/.test(String(privOut.image)), JSON.stringify(privOut && privOut.image));

  // ── Replace deletes the old object ──
  let before = await listPrefix(priv.id);
  check('one object after first upload', before.length === 1, JSON.stringify(before));
  await new Promise(res => setTimeout(res, 5)); // Date.now() must tick
  const rep = await uploadImage('c', priv.id, png);
  check('replace succeeds', rep.status === 200, rep.status);
  let after = await listPrefix(priv.id);
  check('replace: old object deleted (still exactly one)', after.length === 1 && after[0] !== before[0], JSON.stringify({ before, after }));

  // ── Remove: pointer cleared first, object gone ──
  const rm = await apiJson('c', '/api/events/' + priv.id + '/image', { method: 'DELETE' });
  check('remove succeeds', JSON.parse(rm.text).success === true, rm.text);
  after = await listPrefix(priv.id);
  check('remove: bucket prefix empty', after.length === 0, JSON.stringify(after));
  const { data: rowAfterRm } = await admin.from('events').select('image_path').eq('id', priv.id).single();
  check('remove: pointer null', rowAfterRm.image_path === null, JSON.stringify(rowAfterRm));
  const goneProxy = await proxyRaw(users.c.cookie, priv.id);
  const goneGhost = await proxyRaw(users.c.cookie, ghost);
  check('imageless event proxy ≡ ghost (no oracle)', goneProxy.status === goneGhost.status && goneProxy.body.equals(goneGhost.body), goneProxy.status);

  // ── Event delete leaves no orphan ──
  await uploadImage('c', priv.id, png);
  before = await listPrefix(priv.id);
  check('re-upload before event delete', before.length === 1, JSON.stringify(before));
  const evDel = await apiJson('c', '/api/events/' + priv.id, { method: 'DELETE' });
  check('event delete succeeds', JSON.parse(evDel.text).success === true, evDel.text);
  after = await listPrefix(priv.id);
  check('event delete: bucket prefix empty', after.length === 0, JSON.stringify(after));

  // ── Account delete leaves no orphan ──
  r = await apiJson('x', '/api/events/create', {
    method: 'POST',
    body: JSON.stringify({ title: 'Evimg Doomed Event', sport: 'running', date: future, location: 'Nowhere', visibility: 'public' })
  });
  const doomed = JSON.parse(r.text).event;
  await uploadImage('x', doomed.id, png);
  before = await listPrefix(doomed.id);
  check('doomed event has an object', before.length === 1, JSON.stringify(before));
  const acctDel = await apiJson('x', '/api/account/delete', { method: 'POST', body: JSON.stringify({ confirm: 'DELETE' }) });
  check('account delete succeeds', JSON.parse(acctDel.text).ok === true, acctDel.text);
  after = await listPrefix(doomed.id);
  check('account delete: bucket prefix empty', after.length === 0, JSON.stringify(after));

  // ── Manager matrix: creator OR club admin/coach (canManageEvent) ──
  // A club event: coach + admin can upload/replace/remove; a plain member and
  // a stranger get the byte-identical ghost answer; a manager of SOME club
  // still cannot touch someone else's solo event.
  await admin.from('clubs').delete().eq('handle', 'evimg-mgr-club');
  const { data: club, error: clubErr } = await admin.from('clubs')
    .insert({ name: 'Evimg Manager Club', handle: 'evimg-mgr-club', sport: 'running', owner_id: users.c.id }).select().single();
  check('seed: club created', !clubErr, clubErr && clubErr.message);
  console.log('MANIFEST club:', club.id);
  await admin.from('memberships').insert([
    { user_id: users.c.id, club_id: club.id, role: 'admin' },
    { user_id: users.h.id, club_id: club.id, role: 'coach' },
    { user_id: users.a.id, club_id: club.id, role: 'admin' },
    { user_id: users.m.id, club_id: club.id, role: 'member' }
  ]);
  r = await apiJson('c', '/api/events/create', {
    method: 'POST',
    body: JSON.stringify({ title: 'Evimg Club Session', sport: 'running', date: future, location: 'Club Track', visibility: 'club', club_id: club.id })
  });
  const clubEv = JSON.parse(r.text).event;
  console.log('MANIFEST club event:', clubEv.id);

  let cu = await uploadImage('h', clubEv.id, png);
  check('coach upload succeeds', cu.status === 200 && JSON.parse(await cu.text()).success === true, cu.status);
  let objs = await listPrefix(clubEv.id);
  const firstObj = objs[0];
  cu = await uploadImage('a', clubEv.id, png);
  check('club admin replace succeeds', cu.status === 200 && JSON.parse(await cu.text()).success === true, cu.status);
  objs = await listPrefix(clubEv.id);
  check('admin replace: still one object, new name', objs.length === 1 && objs[0] !== firstObj, JSON.stringify({ firstObj, objs }));

  // Denials: plain member and stranger, upload AND remove, byte-identical to ghost.
  const ghostUp2 = await uploadImage('m', ghost, png);
  const ghostUp2Text = await ghostUp2.text();
  for (const [k, who] of [['m', 'plain member'], ['s', 'stranger']]) {
    const den = await uploadImage(k, clubEv.id, png);
    const denText = await den.text();
    check(who + ' upload ≡ ghost id (byte-identical)', den.status === ghostUp2.status && denText === ghostUp2Text, denText + ' vs ' + ghostUp2Text);
    const denRm = await apiJson(k, '/api/events/' + clubEv.id + '/image', { method: 'DELETE' });
    const ghostRm = await apiJson(k, '/api/events/' + ghost + '/image', { method: 'DELETE' });
    check(who + ' remove ≡ ghost id (byte-identical)', denRm.status === ghostRm.status && denRm.text === ghostRm.text, denRm.text + ' vs ' + ghostRm.text);
  }
  check('member/stranger denials left the admin object untouched', (await listPrefix(clubEv.id)).length === 1 && (await listPrefix(clubEv.id))[0] === objs[0], JSON.stringify(await listPrefix(clubEv.id)));

  // Coach can remove.
  const coachRm = await apiJson('h', '/api/events/' + clubEv.id + '/image', { method: 'DELETE' });
  check('coach remove succeeds', JSON.parse(coachRm.text).success === true, coachRm.text);
  check('coach remove: bucket prefix empty', (await listPrefix(clubEv.id)).length === 0, 'residue');

  // Solo events stay creator-only: the coach (a manager of SOME club) gets
  // the ghost answer on the creator's solo public event.
  const soloDen = await uploadImage('h', pub.id, png);
  const soloDenText = await soloDen.text();
  const soloGhost = await uploadImage('h', ghost, png);
  const soloGhostText = await soloGhost.text();
  check('solo event: club coach upload ≡ ghost id', soloDen.status === soloGhost.status && soloDenText === soloGhostText, soloDenText + ' vs ' + soloGhostText);
  const soloRm = await apiJson('h', '/api/events/' + pub.id + '/image', { method: 'DELETE' });
  const soloRmGhost = await apiJson('h', '/api/events/' + ghost + '/image', { method: 'DELETE' });
  check('solo event: club coach remove ≡ ghost id', soloRm.status === soloRmGhost.status && soloRm.text === soloRmGhost.text, soloRm.text);

  // Manager-matrix cleanup (rows first, error-checked).
  await uploadImage('h', clubEv.id, png); // leave an object so delete-cleanup is proven for the manager path
  const clubEvDel = await apiJson('h', '/api/events/' + clubEv.id, { method: 'DELETE' });
  check('cleanup: coach deletes club event, no orphan', JSON.parse(clubEvDel.text).success === true && (await listPrefix(clubEv.id)).length === 0, clubEvDel.text);
  const { error: memDelErr } = await admin.from('memberships').delete().eq('club_id', club.id);
  const { error: clubDelErr } = await admin.from('clubs').delete().eq('id', club.id);
  check('cleanup: club + memberships deleted', !memDelErr && !clubDelErr, (memDelErr || clubDelErr || {}).message);

  // ── Cleanup ──
  const pubDel = await apiJson('c', '/api/events/' + pub.id, { method: 'DELETE' });
  check('cleanup: public event delete leaves no orphan', JSON.parse(pubDel.text).success === true && (await listPrefix(pub.id)).length === 0, pubDel.text);
  // Row cleanup BEFORE auth deletion (lingering references can make the auth
  // delete fail), and every auth delete is error-checked — a silent failure
  // here is exactly what leaves baseline residue.
  const ids = ['c', 'i', 's', 'h', 'a', 'm'].map(k => users[k].id);
  await admin.from('notifications').delete().in('user_id', ids);
  await admin.from('notifications').delete().in('actor_id', ids);
  await admin.from('follows').delete().in('follower_id', ids);
  await admin.from('follows').delete().in('following_id', ids);
  await admin.from('event_rsvps').delete().in('user_id', ids);
  await admin.from('event_invites').delete().in('invitee_id', ids);
  for (const k of ['c', 'i', 's', 'h', 'a', 'm']) {
    const { error } = await admin.auth.admin.deleteUser(users[k].id);
    check('cleanup: user ' + k + ' deleted', !error, error && error.message);
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
