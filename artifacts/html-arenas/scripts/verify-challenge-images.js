// Seeded verification of challenge cover images (private challenge-images
// bucket + authenticated proxy gated by the single canUserSeeChallenge rule)
// AND the reconciled visibility routes (join + leaderboard).
//   - acceptance bar: a non-participant cannot reach a non-public challenge's
//     image. Stranger with a valid session: proxy on the real id is
//     BYTE-IDENTICAL to a ghost id (status + body). Unauthenticated: parity.
//   - HOLE-CLOSED assertion: a NON-MEMBER with a valid session and a real
//     PRIVATE CLUB challenge id gets the byte-identical not-found on JOIN and
//     LEADERBOARD, proven against a nonexistent id.
//   - no storage URL / object path in any payload, including the data export
//   - invitee sees the image; stale/absent ?v= serves current bytes
//   - replace deletes the old object; remove clears pointer + object;
//     challenge delete and account delete leave no orphan (prefix listed)
//   - upload auth = requireChallengeEditor (creator; club admin/coach for
//     club-scoped) with the PATCH-standard denial shapes; format validation
//   - served asset is the 1440×240 (6:1) WebP contract
// Run with the dev server up:
//   node artifacts/html-arenas/scripts/verify-challenge-images.js
// Cleanup is built in (also covered by scripts/test-data-sweep.js --delete).

const crypto = require('crypto');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');

const BASE_URL = 'http://localhost:80/html';
const BUCKET = 'challenge-images';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const PW = 'ArenasTest!234';
const emails = {
  c: 'chimg-creator@arenas-test.dev',
  i: 'chimg-invitee@arenas-test.dev',
  s: 'chimg-stranger@arenas-test.dev',
  x: 'chimg-acctdel@arenas-test.dev',
  h: 'chimg-coach@arenas-test.dev',
  m: 'chimg-member@arenas-test.dev'
};
const names = {
  c: ['Chimg Creator', 'chimg_creator'],
  i: ['Chimg Invitee', 'chimg_invitee'],
  s: ['Chimg Stranger', 'chimg_stranger'],
  x: ['Chimg Acctdel', 'chimg_acctdel'],
  h: ['Chimg Coach', 'chimg_coach'],
  m: ['Chimg Member', 'chimg_member']
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

// A real 900×900 PNG (square: proves the 6:1 cover-crop, not a letterbox).
function makePng() {
  return sharp({ create: { width: 900, height: 900, channels: 3, background: { r: 40, g: 40, b: 200 } } })
    .png().toBuffer();
}

function uploadImage(key, challengeId, buf, filename) {
  const fd = new FormData();
  fd.append('image', new Blob([buf], { type: 'image/png' }), filename || 'test.png');
  return fetch(BASE_URL + '/api/challenges/' + challengeId + '/image', {
    method: 'POST', headers: { Cookie: users[key].cookie }, body: fd
  });
}

async function listPrefix(challengeId) {
  const { data, error } = await admin.storage.from(BUCKET).list('challenges/' + challengeId);
  if (error) throw new Error('list: ' + error.message);
  return (data || []).map(o => o.name);
}

const ghost = crypto.randomUUID();
async function proxyRaw(cookie, id, q) {
  const r = await fetch(BASE_URL + '/api/challenges/' + id + '/image' + (q || ''), {
    headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual'
  });
  return { status: r.status, ct: r.headers.get('content-type') || '', cc: r.headers.get('cache-control') || '', body: Buffer.from(await r.arrayBuffer()) };
}

// Seed a challenge row directly (avoids the create route's invite fan-out)
// with the creator auto-joined, matching the app invariant.
async function mkChallenge(createdBy, fields) {
  const start = new Date(Date.now() - 86400000).toISOString();
  const end = new Date(Date.now() + 14 * 86400000).toISOString();
  const { data, error } = await admin.from('challenges').insert({
    title: fields.title, sport: 'running', goal_type: 'distance', goal_target: 50,
    goal_unit: 'km', start_date: start, end_date: end, created_by: createdBy,
    visibility: fields.visibility, club_id: fields.club_id || null,
    description: 'chimg verify'
  }).select().single();
  if (error) throw new Error('mkChallenge: ' + error.message);
  const { error: pErr } = await admin.from('challenge_participants')
    .insert({ challenge_id: data.id, user_id: createdBy });
  if (pErr) throw new Error('mkChallenge join: ' + pErr.message);
  return data;
}

async function main() {
  for (const k of ['c', 'i', 's', 'x', 'h', 'm']) { await mkUser(k); await login(k); }
  console.log('MANIFEST users:', JSON.stringify(Object.fromEntries(Object.keys(users).map(k => [k, users[k].id]))));

  // Club: coach h manages it, member m belongs, creator c is ALSO a member
  // (club challenges are normally made by managers; c is admin here).
  const { data: club, error: clubErr } = await admin.from('clubs').insert({
    name: 'Chimg Verify Club', handle: 'chimg-verify-club', sport: 'running', owner_id: users.c.id
  }).select().single();
  if (clubErr) throw new Error('club: ' + clubErr.message);
  const { error: memErr } = await admin.from('memberships').insert([
    { club_id: club.id, user_id: users.c.id, role: 'admin' },
    { club_id: club.id, user_id: users.h.id, role: 'coach' },
    { club_id: club.id, user_id: users.m.id, role: 'member' }
  ]);
  if (memErr) throw new Error('memberships: ' + memErr.message);
  console.log('MANIFEST club:', club.id);

  // Three challenges: private solo (invitee i), public solo, private CLUB.
  const priv = await mkChallenge(users.c.id, { title: 'Chimg Private Solo', visibility: 'private' });
  const pub = await mkChallenge(users.c.id, { title: 'Chimg Public', visibility: 'public' });
  const clubCh = await mkChallenge(users.c.id, { title: 'Chimg Private Club', visibility: 'private', club_id: club.id });
  const { error: invErr } = await admin.from('challenge_invites').insert({
    challenge_id: priv.id, inviter_id: users.c.id, invitee_id: users.i.id
  });
  if (invErr) throw new Error('invite: ' + invErr.message);
  console.log('MANIFEST challenges:', JSON.stringify({ priv: priv.id, pub: pub.id, clubCh: clubCh.id }));

  const png = await makePng();

  // ── HOLE-CLOSED: private club challenge, non-member stranger s ──
  const jReal = await apiJson('s', '/api/challenges/' + clubCh.id + '/join', { method: 'POST', body: '{}' });
  const jGhost = await apiJson('s', '/api/challenges/' + ghost + '/join', { method: 'POST', body: '{}' });
  check('HOLE CLOSED: non-member join private club ch ≡ ghost id (byte-identical)',
    jReal.status === jGhost.status && jReal.text === jGhost.text && /Challenge not found/.test(jReal.text),
    jReal.status + ' ' + jReal.text + ' vs ' + jGhost.status + ' ' + jGhost.text);
  const lReal = await apiJson('s', '/api/challenges/' + clubCh.id + '/leaderboard');
  const lGhost = await apiJson('s', '/api/challenges/' + ghost + '/leaderboard');
  check('HOLE CLOSED: non-member leaderboard private club ch ≡ ghost id (byte-identical)',
    lReal.status === lGhost.status && lReal.text === lGhost.text && /Challenge not found/.test(lReal.text),
    lReal.status + ' ' + lReal.text + ' vs ' + lGhost.status + ' ' + lGhost.text);
  // Member m may see the club challenge's roster and may join it.
  const lMem = await apiJson('m', '/api/challenges/' + clubCh.id + '/leaderboard');
  check('club member reads private club leaderboard', /"leaderboard"/.test(lMem.text) && !/Challenge not found/.test(lMem.text), lMem.text.slice(0, 120));
  const jMem = await apiJson('m', '/api/challenges/' + clubCh.id + '/join', { method: 'POST', body: '{}' });
  check('club member joins private club challenge', /"success":true/.test(jMem.text), jMem.text);
  // Participant-as-grant: joining again is idempotent success, not an error.
  const jAgain = await apiJson('m', '/api/challenges/' + clubCh.id + '/join', { method: 'POST', body: '{}' });
  check('duplicate join is idempotent success (participant is a grant)', /"success":true/.test(jAgain.text), jAgain.text);

  // Private solo: stranger join/leaderboard ≡ ghost (zero-leak, replaces invite_required).
  const sj = await apiJson('s', '/api/challenges/' + priv.id + '/join', { method: 'POST', body: '{}' });
  check('stranger join private solo ≡ ghost id', sj.status === jGhost.status && sj.text === jGhost.text, sj.status + ' ' + sj.text);
  const sl = await apiJson('s', '/api/challenges/' + priv.id + '/leaderboard');
  check('stranger leaderboard private solo ≡ ghost id', sl.status === lGhost.status && sl.text === lGhost.text, sl.status + ' ' + sl.text);

  // ── Upload auth (requireChallengeEditor) + format validation ──
  let up = await uploadImage('c', priv.id, png);
  let upBody = JSON.parse(await up.text());
  check('creator upload succeeds with version token', up.status === 200 && upBody.success && /^\d+$/.test(String(upBody.image)), JSON.stringify(upBody));
  check('upload response carries no path/URL', !JSON.stringify(upBody).match(/image_path|storage\/v1/), JSON.stringify(upBody));

  // Non-editor on a PRIVATE SOLO challenge ≡ ghost id (zero-leak branch).
  const nonEd = await apiJson('s', '/api/challenges/' + priv.id + '/image', { method: 'POST', body: '{}' });
  const ghostUp = await apiJson('s', '/api/challenges/' + ghost + '/image', { method: 'POST', body: '{}' });
  check('non-editor upload on private solo ≡ ghost id (byte-identical)', nonEd.status === ghostUp.status && nonEd.text === ghostUp.text, nonEd.text + ' vs ' + ghostUp.text);
  // Non-editor on a PUBLIC challenge gets the PATCH-standard 403 (the
  // challenge is publicly listed — no existence to protect).
  const pubDen = await apiJson('s', '/api/challenges/' + pub.id + '/image', { method: 'POST', body: '{}' });
  check('non-editor upload on public challenge → 403 not_authorized', pubDen.status === 403 && /not_authorized/.test(pubDen.text), pubDen.status + ' ' + pubDen.text);
  // Club coach CAN set the club challenge's image (the event-images lesson).
  const coachUp = await uploadImage('h', clubCh.id, png);
  check('club coach upload on club challenge succeeds', /"success":true/.test(await coachUp.text()), coachUp.status);
  // Member (non-manager) cannot.
  const memUp = await apiJson('m', '/api/challenges/' + clubCh.id + '/image', { method: 'POST', body: '{}' });
  check('club member upload → 403 not_authorized', memUp.status === 403 && /not_authorized/.test(memUp.text), memUp.status + ' ' + memUp.text);

  const badFile = await uploadImage('c', pub.id, Buffer.from('not an image at all'), 'x.png');
  check('non-image file → 400', badFile.status === 400, badFile.status);

  // ── Proxy access ──
  const asC = await proxyRaw(users.c.cookie, priv.id);
  check('creator proxy 200 image/webp', asC.status === 200 && asC.ct === 'image/webp', asC.status + ' ' + asC.ct);
  check('Cache-Control private+immutable', /private/.test(asC.cc) && /immutable/.test(asC.cc) && /max-age=31536000/.test(asC.cc), asC.cc);
  const dims = await sharp(asC.body).metadata();
  check('served image is 1440×240 (6:1) WebP cover-crop', dims.width === 1440 && dims.height === 240 && dims.format === 'webp', JSON.stringify({ w: dims.width, h: dims.height, f: dims.format }));

  const asI = await proxyRaw(users.i.cookie, priv.id);
  check('invitee proxy 200 (same bytes)', asI.status === 200 && asI.body.equals(asC.body), asI.status);

  const sReal = await proxyRaw(users.s.cookie, priv.id);
  const sGhost = await proxyRaw(users.s.cookie, ghost);
  check('stranger proxy: real id ≡ ghost id (status 404)', sReal.status === sGhost.status && sReal.status === 404, sReal.status + '/' + sGhost.status);
  check('stranger proxy: real id ≡ ghost id (bytes)', sReal.body.equals(sGhost.body), sReal.body.toString().slice(0, 120) + ' vs ' + sGhost.body.toString().slice(0, 120));
  // Private CLUB challenge image: non-member ≡ ghost; member 200.
  const sClub = await proxyRaw(users.s.cookie, clubCh.id);
  check('non-member proxy on private club ch ≡ ghost id', sClub.status === sGhost.status && sClub.body.equals(sGhost.body), sClub.status);
  const mClub = await proxyRaw(users.m.cookie, clubCh.id);
  check('club member proxy on private club ch → 200', mClub.status === 200 && mClub.ct === 'image/webp', mClub.status);

  const uReal = await proxyRaw(null, priv.id);
  const uGhost = await proxyRaw(null, ghost);
  check('unauthenticated: real id ≡ ghost id', uReal.status === uGhost.status && uReal.body.equals(uGhost.body), uReal.status + '/' + uGhost.status);

  const staleV = await proxyRaw(users.c.cookie, priv.id, '?v=1');
  const noV = await proxyRaw(users.c.cookie, priv.id);
  check('stale ?v serves current bytes', staleV.status === 200 && staleV.body.equals(asC.body), staleV.status);
  check('absent ?v serves current bytes', noV.status === 200 && noV.body.equals(asC.body), noV.status);

  // Imageless challenge ≡ ghost id on the proxy (pub has no image now — the
  // bad-file upload failed, so it never got one).
  const noImg = await proxyRaw(users.c.cookie, pub.id);
  const cGhost = await proxyRaw(users.c.cookie, ghost);
  check('imageless challenge proxy ≡ ghost id', noImg.status === cGhost.status && noImg.body.equals(cGhost.body), noImg.status);

  // ── No path / storage URL in any payload (incl. export) ──
  const surfaces = [
    ['GET /api/challenges (creator)', await apiJson('c', '/api/challenges')],
    ['GET /api/challenges (invitee)', await apiJson('i', '/api/challenges')],
    ['leaderboard payload', await apiJson('c', '/api/challenges/' + priv.id + '/leaderboard')],
    ['club member home page', await apiJson('m', '/clubs/member/' + club.id)],
    ['club dashboard page', await apiJson('c', '/club-dashboard?club=' + club.id)],
    ['data export', await apiJson('c', '/api/account/export')]
  ];
  // Avatars are a deliberately PUBLIC bucket (public URLs in payloads are
  // their contract) — only image_path pointers and private-bucket storage
  // URLs count as leaks here.
  const leakRe = /image_path|storage\/v1\/object(?!\/public\/avatars\/)/;
  for (const [tag, resp] of surfaces) {
    check(tag + ': no image_path / private storage URL', !leakRe.test(resp.text), (resp.text.match(/.{0,60}(image_path|storage\/v1\/object(?!\/public\/avatars\/)).{0,60}/) || [])[0]);
  }
  const chPayload = JSON.parse((await apiJson('c', '/api/challenges')).text);
  const privOut = [].concat(chPayload.myChallenges || []).find(c => c.id === priv.id);
  check('payload carries version token only', privOut && /^\d+$/.test(String(privOut.image)), JSON.stringify(privOut && privOut.image));
  // Export explicitly has NO image field (matches events — confirmed decision).
  const exp = JSON.parse(surfaces[5][1].text);
  const expCh = JSON.stringify(exp).match(/"image"\s*:/);
  check('export has no image field at all', !expCh, (expCh || [])[0]);

  // ── Replace deletes the old object ──
  let before = await listPrefix(priv.id);
  check('one object after first upload', before.length === 1, JSON.stringify(before));
  await new Promise(res => setTimeout(res, 5)); // Date.now() must tick
  const rep = await uploadImage('c', priv.id, png);
  check('replace succeeds', rep.status === 200, rep.status);
  let after = await listPrefix(priv.id);
  check('replace: old object deleted (still exactly one)', after.length === 1 && after[0] !== before[0], JSON.stringify({ before, after }));

  // ── Remove: pointer cleared first, object gone ──
  const rm = await apiJson('c', '/api/challenges/' + priv.id + '/image', { method: 'DELETE' });
  check('remove succeeds', /"success":true/.test(rm.text), rm.text);
  after = await listPrefix(priv.id);
  check('remove: bucket prefix empty', after.length === 0, JSON.stringify(after));
  const { data: rowAfterRm } = await admin.from('challenges').select('image_path').eq('id', priv.id).single();
  check('remove: pointer cleared', rowAfterRm.image_path === null, JSON.stringify(rowAfterRm));

  // ── Challenge delete leaves no orphan ──
  await new Promise(res => setTimeout(res, 5));
  const reup = await uploadImage('c', priv.id, png);
  check('re-upload before delete', reup.status === 200, reup.status);
  // Delete requires aloneness: clear invite + non-creator participants first.
  await admin.from('challenge_invites').delete().eq('challenge_id', priv.id);
  const del = await apiJson('c', '/api/challenges/' + priv.id, { method: 'DELETE' });
  check('challenge delete succeeds', /"success":true/.test(del.text), del.text);
  check('challenge delete: bucket prefix empty', (await listPrefix(priv.id)).length === 0, 'residue');

  // ── Account delete leaves no orphan ──
  const xCh = await mkChallenge(users.x.id, { title: 'Chimg Acctdel Solo', visibility: 'public' });
  const xUp = await uploadImage('x', xCh.id, png);
  check('acctdel user upload', xUp.status === 200, xUp.status);
  const acctDel = await apiJson('x', '/api/account/delete', { method: 'POST', body: JSON.stringify({ confirm: 'DELETE' }) });
  check('account delete succeeds', /true/.test(acctDel.text), acctDel.text);
  check('account delete: bucket prefix empty', (await listPrefix(xCh.id)).length === 0, JSON.stringify(await listPrefix(xCh.id)));

  // ── Cleanup ──
  for (const id of [pub.id, clubCh.id]) {
    await admin.from('challenge_participants').delete().eq('challenge_id', id);
    const { data: row } = await admin.from('challenges').select('image_path').eq('id', id).maybeSingle();
    await admin.from('challenges').delete().eq('id', id);
    if (row && row.image_path) await admin.storage.from(BUCKET).remove([row.image_path]);
  }
  check('cleanup: club challenge objects removed', (await listPrefix(clubCh.id)).length === 0, 'residue');
  const { error: memDelErr } = await admin.from('memberships').delete().eq('club_id', club.id);
  const { error: clubDelErr } = await admin.from('clubs').delete().eq('id', club.id);
  check('cleanup: club + memberships deleted', !memDelErr && !clubDelErr, (memDelErr || clubDelErr || {}).message);
  const ids = ['c', 'i', 's', 'h', 'm'].map(k => users[k].id);
  await admin.from('notifications').delete().in('user_id', ids);
  await admin.from('notifications').delete().in('actor_id', ids);
  for (const k of ['c', 'i', 's', 'h', 'm']) {
    const { error } = await admin.auth.admin.deleteUser(users[k].id);
    check('cleanup: user ' + k + ' deleted', !error, error && error.message);
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
