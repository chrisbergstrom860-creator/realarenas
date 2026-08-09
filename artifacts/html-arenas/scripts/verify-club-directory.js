// Club directory verification:
//   - directory lists ONLY visibility='public' clubs; private clubs absent
//   - zero-leak: POST join-request to a PRIVATE club is byte-identical
//     (status + body) to a NONEXISTENT club id
//   - request lifecycle:
//       request → pending row + manager notification fan-out (admin + coach)
//       duplicate request → 409 request_pending
//       already-member request → 409 already_member
//       cancel own pending → row gone; cancel again → 404
//       decline → status declined, NO notification to requester, 7-day
//         cooldown (409 request_cooldown with retryAt); after cooldown
//         (resolved_at backdated) re-request flips the SAME row to pending
//       approve → membership (role member) + row approved + requester notified
//   - approve/decline authorization: coach allowed (isClubManager), plain
//     member and outsider get the byte-identical 404 {error:'Club not found'}
//   - settings: coach PATCH → 404 (admin-only); admin toggles visibility;
//     going private deletes pending requests + removes club from directory
//   - invited-while-pending: accepting an open invite deletes the pending row
// Run with the dev server up:
//   node artifacts/html-arenas/scripts/verify-club-directory.js

const { createClient } = require('@supabase/supabase-js');
const BASE_URL = 'http://localhost:80/html';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const PW = 'ArenasTest!234';
const emails = {
  owner: 'clubdir-owner@arenas-test.dev',
  coach: 'clubdir-coach@arenas-test.dev',
  member: 'clubdir-member@arenas-test.dev',
  seeker: 'clubdir-seeker@arenas-test.dev',
  seeker2: 'clubdir-seeker2@arenas-test.dev',
  owner2: 'clubdir-owner2@arenas-test.dev'
};

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail ? ' — ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400) : '')); }
}

const users = {};
async function deleteUserByEmail(email) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of (data && data.users) || []) if (u.email === email) await admin.auth.admin.deleteUser(u.id);
}
async function mkUser(k, name, handle) {
  await deleteUserByEmail(emails[k]);
  const { data, error } = await admin.auth.admin.createUser({
    email: emails[k], password: PW, email_confirm: true,
    user_metadata: { name, handle, timezone: 'UTC' }
  });
  if (error) throw new Error(error.message);
  users[k] = { id: data.user.id };
}
async function login(k) {
  const r = await fetch(BASE_URL + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(emails[k])}&password=${encodeURIComponent(PW)}`, redirect: 'manual'
  });
  const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')])
    .map(c => String(c).split(';')[0]).join('; ');
  if (!cookie) throw new Error('login failed ' + k);
  users[k].cookie = cookie;
}
async function api(k, method, path, body) {
  const r = await fetch(BASE_URL + '/api' + path, {
    method, headers: { Cookie: users[k].cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, body: json, raw: text };
}

async function main() {
  for (const [k, n, h] of [['owner', 'Dir Owner', 'dir_owner'], ['coach', 'Dir Coach', 'dir_coach'], ['member', 'Dir Member', 'dir_member'], ['seeker', 'Dir Seeker', 'dir_seeker'], ['seeker2', 'Dir SeekerTwo', 'dir_seeker2'], ['owner2', 'Dir OwnerTwo', 'dir_owner2']]) {
    await mkUser(k, n, h);
  }
  for (const k of Object.keys(emails)) await login(k);
  console.log('MANIFEST users:', JSON.stringify(Object.fromEntries(Object.keys(users).map(k => [k, users[k].id]))));

  // Two clubs: one to be made public, one that stays private.
  let r = await api('owner', 'POST', '/clubs/create', { name: 'Dir Public Club', handle: 'dirpublic', sport: 'running', city: 'Oslo' });
  const pubClubId = ((r.body && r.body.redirect) || '').split('club=')[1];
  check('public-club created', !!pubClubId, r.body);
  r = await api('owner', 'POST', '/clubs/create', { name: 'Dir Private Club', handle: 'dirprivate', sport: 'cycling', city: 'Bergen' });
  const privClubId = ((r.body && r.body.redirect) || '').split('club=')[1];
  check('private-club created', !!privClubId, r.body);
  console.log('MANIFEST clubs:', JSON.stringify({ pubClubId, privClubId }));
  await admin.from('memberships').insert([
    { user_id: users.coach.id, club_id: pubClubId, role: 'coach' },
    { user_id: users.member.id, club_id: pubClubId, role: 'member' }
  ]);

  // ── 1. Default private: neither club is listed ──
  r = await api('seeker', 'GET', '/clubs/directory');
  const listedIds0 = ((r.body && r.body.clubs) || []).map(c => c.id);
  check('new clubs default private (absent from directory)', !listedIds0.includes(pubClubId) && !listedIds0.includes(privClubId), listedIds0);

  // ── 2. Settings gate: coach PATCH → 404 (admin-only); admin lists club ──
  r = await api('coach', 'PATCH', '/clubs/' + pubClubId + '/settings', { visibility: 'public' });
  check('coach settings PATCH → 404 Club not found', r.status === 404 && r.raw === JSON.stringify({ error: 'Club not found' }), r);
  r = await api('owner', 'PATCH', '/clubs/' + pubClubId + '/settings', { visibility: 'public', description: 'Weekly track sessions in Oslo.' });
  check('admin lists club (visibility+description saved)', r.status === 200 && r.body && r.body.visibility === 'public' && r.body.description === 'Weekly track sessions in Oslo.', r);
  r = await api('owner', 'PATCH', '/clubs/' + pubClubId + '/settings', { visibility: 'listed-sorta' });
  check('invalid visibility rejected 400', r.status === 400 && r.body && r.body.error === 'invalid_visibility', r);

  // ── 3. Directory payload ──
  r = await api('seeker', 'GET', '/clubs/directory');
  let dir = (r.body && r.body.clubs) || [];
  const card = dir.find(c => c.id === pubClubId);
  check('public club listed with card fields', card && card.name === 'Dir Public Club' && card.sport === 'running' && card.city === 'Oslo' && card.description === 'Weekly track sessions in Oslo.' && card.memberCount === 3, card);
  check('private club still absent', !dir.some(c => c.id === privClubId), dir.map(c => c.id));
  check('seeker viewerState none', card && card.viewerState === 'none', card && card.viewerState);
  r = await api('member', 'GET', '/clubs/directory');
  const memberCard = ((r.body && r.body.clubs) || []).find(c => c.id === pubClubId);
  check('existing member sees viewerState member (card does not vanish)', memberCard && memberCard.viewerState === 'member' && memberCard.viewerRole === 'member', memberCard);

  // ── 4. Zero-leak: private club vs nonexistent id — byte-identical ──
  const fakeId = '00000000-0000-4000-8000-000000000000';
  const rPriv = await api('seeker', 'POST', '/clubs/' + privClubId + '/join-request');
  const rFake = await api('seeker', 'POST', '/clubs/' + fakeId + '/join-request');
  check('private-club request → 404', rPriv.status === 404, rPriv);
  check('BYTE-IDENTICAL private vs nonexistent (status+body)', rPriv.status === rFake.status && rPriv.raw === rFake.raw, { priv: rPriv.raw, fake: rFake.raw });

  // ── 5. Request lifecycle: request → pending + manager fan-out ──
  r = await api('seeker', 'POST', '/clubs/' + pubClubId + '/join-request');
  check('request succeeds', r.status === 200 && r.body && r.body.success, r);
  const { data: row1 } = await admin.from('club_join_requests').select('*').eq('club_id', pubClubId).eq('user_id', users.seeker.id).maybeSingle();
  check('pending row exists', row1 && row1.status === 'pending', row1);
  const { data: mgrNotifs } = await admin.from('notifications').select('user_id, title, body').eq('type', 'join_request').eq('entity_id', pubClubId).eq('actor_id', users.seeker.id);
  const notifiedIds = (mgrNotifs || []).map(n => n.user_id).sort();
  check('managers notified (admin + coach, NOT member)', notifiedIds.length === 2 && notifiedIds.includes(users.owner.id) && notifiedIds.includes(users.coach.id), mgrNotifs);
  check('notification copy', mgrNotifs && mgrNotifs[0] && mgrNotifs[0].title === 'New join request' && /Dir Seeker requested to join Dir Public Club/.test(mgrNotifs[0].body), mgrNotifs && mgrNotifs[0]);

  r = await api('seeker', 'POST', '/clubs/' + pubClubId + '/join-request');
  check('duplicate request → 409 request_pending', r.status === 409 && r.body && r.body.error === 'request_pending', r);
  r = await api('member', 'POST', '/clubs/' + pubClubId + '/join-request');
  check('already-member request → 409 already_member', r.status === 409 && r.body && r.body.error === 'already_member', r);
  r = await api('seeker', 'GET', '/clubs/directory');
  const pendCard = ((r.body && r.body.clubs) || []).find(c => c.id === pubClubId);
  check('directory shows viewerState pending', pendCard && pendCard.viewerState === 'pending', pendCard);

  // Dashboard payload carries the queue.
  const dashRes = await fetch(BASE_URL + '/clubs/dashboard?club=' + pubClubId, { headers: { Cookie: users.owner.cookie } });
  const dashHtml = await dashRes.text();
  const dm = dashHtml.match(/window\.ARENAS_DATA\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
  let dashData = {};
  try { dashData = JSON.parse(dm[1]); } catch (e) {}
  const jr = (dashData.joinRequests || []).find(x => x.user_id === users.seeker.id);
  check('dashboard joinRequests queue carries requester (name from auth metadata)', jr && jr.name === 'Dir Seeker', dashData.joinRequests);
  check('dashboard club payload carries visibility + description', dashData.club && dashData.club.visibility === 'public' && dashData.club.description === 'Weekly track sessions in Oslo.', dashData.club);

  // ── 6. Authorization: member/outsider resolve → byte-identical 404; coach OK ──
  const rMem = await api('member', 'POST', '/clubs/' + pubClubId + '/join-requests/' + users.seeker.id + '/approve');
  const rOut = await api('seeker2', 'POST', '/clubs/' + pubClubId + '/join-requests/' + users.seeker.id + '/approve');
  check('plain member approve → 404 Club not found', rMem.status === 404 && rMem.raw === JSON.stringify({ error: 'Club not found' }), rMem);
  check('outsider approve byte-identical to member denial', rOut.status === rMem.status && rOut.raw === rMem.raw, rOut);

  // ── 7. Decline (by coach — isClubManager) → cooldown ──
  r = await api('coach', 'POST', '/clubs/' + pubClubId + '/join-requests/' + users.seeker.id + '/decline');
  check('coach can decline (isClubManager)', r.status === 200 && r.body && r.body.status === 'declined', r);
  const { data: row2 } = await admin.from('club_join_requests').select('*').eq('club_id', pubClubId).eq('user_id', users.seeker.id).maybeSingle();
  check('row declined with resolved_at/resolved_by', row2 && row2.status === 'declined' && !!row2.resolved_at && row2.resolved_by === users.coach.id, row2);
  const { data: seekerNotifs } = await admin.from('notifications').select('id').eq('user_id', users.seeker.id).eq('type', 'join_request');
  check('decline is quiet (no notification to requester)', (seekerNotifs || []).length === 0, seekerNotifs);
  r = await api('seeker', 'POST', '/clubs/' + pubClubId + '/join-request');
  check('re-request inside cooldown → 409 with retryAt', r.status === 409 && r.body && r.body.error === 'request_cooldown' && !!r.body.retryAt, r);
  r = await api('seeker', 'GET', '/clubs/directory');
  const cdCard = ((r.body && r.body.clubs) || []).find(c => c.id === pubClubId);
  check('directory shows cooldown state + date', cdCard && cdCard.viewerState === 'cooldown' && !!cdCard.cooldownUntil, cdCard);

  // Backdate the decline 8 days → cooldown over, re-request reuses the row.
  await admin.from('club_join_requests').update({ resolved_at: new Date(Date.now() - 8 * 864e5).toISOString() })
    .eq('club_id', pubClubId).eq('user_id', users.seeker.id);
  r = await api('seeker', 'POST', '/clubs/' + pubClubId + '/join-request');
  check('re-request after cooldown succeeds', r.status === 200 && r.body && r.body.success, r);
  const { data: rows3 } = await admin.from('club_join_requests').select('*').eq('club_id', pubClubId).eq('user_id', users.seeker.id);
  check('same row flipped back to pending (no duplicate)', rows3 && rows3.length === 1 && rows3[0].status === 'pending' && rows3[0].resolved_at === null, rows3);

  // ── 8. Approve → membership + notification ──
  r = await api('owner', 'POST', '/clubs/' + pubClubId + '/join-requests/' + users.seeker.id + '/approve');
  check('approve succeeds', r.status === 200 && r.body && r.body.status === 'approved', r);
  const { data: mem } = await admin.from('memberships').select('role').eq('club_id', pubClubId).eq('user_id', users.seeker.id).maybeSingle();
  check('membership created with role member', mem && mem.role === 'member', mem);
  const { data: row4 } = await admin.from('club_join_requests').select('status, resolved_by').eq('club_id', pubClubId).eq('user_id', users.seeker.id).maybeSingle();
  check('row approved, resolved_by owner', row4 && row4.status === 'approved' && row4.resolved_by === users.owner.id, row4);
  const { data: okNotifs } = await admin.from('notifications').select('title, body, link').eq('user_id', users.seeker.id).eq('type', 'join_request');
  check('requester notified of approval', okNotifs && okNotifs.length === 1 && okNotifs[0].title === 'Request approved' && /Dir Public Club/.test(okNotifs[0].body), okNotifs);
  r = await api('owner', 'POST', '/clubs/' + pubClubId + '/join-requests/' + users.seeker.id + '/approve');
  check('re-approve resolved request → 404 Request not found', r.status === 404 && r.body && r.body.error === 'Request not found', r);

  // ── 9. Cancel own pending request ──
  r = await api('seeker2', 'POST', '/clubs/' + pubClubId + '/join-request');
  check('seeker2 request succeeds', r.status === 200, r);
  r = await api('seeker2', 'DELETE', '/clubs/' + pubClubId + '/join-request');
  check('cancel own pending succeeds', r.status === 200 && r.body && r.body.success, r);
  r = await api('seeker2', 'DELETE', '/clubs/' + pubClubId + '/join-request');
  check('cancel again → 404 Request not found', r.status === 404 && r.body && r.body.error === 'Request not found', r);

  // ── 10. Invited-while-pending: open-invite acceptance deletes the row ──
  r = await api('seeker2', 'POST', '/clubs/' + pubClubId + '/join-request');
  check('seeker2 re-request succeeds', r.status === 200, r);
  // Seed an open invite link directly (service role) — same shape the open
  // link route writes: sentinel email, role member, 30-day TTL.
  const token = require('crypto').randomBytes(32).toString('hex');
  const { error: invErr } = await admin.from('club_invites').insert({
    club_id: pubClubId, invited_by: users.owner.id, email: 'open-invite@realarenas.com',
    role: 'member', token, status: 'pending',
    expires_at: new Date(Date.now() + 30 * 864e5).toISOString()
  });
  check('open invite link seeded', !invErr, invErr && invErr.message);
  const joinRes = await fetch(BASE_URL + '/auth/join/' + token + '/existing', {
    method: 'POST', headers: { Cookie: users.seeker2.cookie }
  });
  const joinBody = await joinRes.json().catch(() => null);
  check('open-invite accept succeeds', joinRes.status === 200 && joinBody && joinBody.success, { status: joinRes.status, joinBody });
  const { data: row5 } = await admin.from('club_join_requests').select('*').eq('club_id', pubClubId).eq('user_id', users.seeker2.id);
  check('pending request deleted on invite acceptance', row5 && row5.length === 0, row5);

  // ── 11. Going private: pending requests purged, club unlisted ──
  await admin.from('memberships').delete().eq('club_id', pubClubId).eq('user_id', users.seeker2.id);
  await admin.from('club_join_requests').delete().eq('club_id', pubClubId).eq('user_id', users.seeker2.id);
  r = await api('seeker2', 'POST', '/clubs/' + pubClubId + '/join-request');
  check('fresh pending request before unlisting', r.status === 200, r);
  r = await api('owner', 'PATCH', '/clubs/' + pubClubId + '/settings', { visibility: 'private' });
  check('unlist succeeds', r.status === 200 && r.body && r.body.visibility === 'private', r);
  const { data: purged } = await admin.from('club_join_requests').select('*').eq('club_id', pubClubId).eq('status', 'pending');
  check('pending requests purged on going private', purged && purged.length === 0, purged);
  r = await api('seeker2', 'GET', '/clubs/directory');
  check('club gone from directory after unlisting', !((r.body && r.body.clubs) || []).some(c => c.id === pubClubId), r.body && r.body.clubs);
  const rPriv2 = await api('seeker2', 'POST', '/clubs/' + pubClubId + '/join-request');
  check('request to now-private club byte-identical 404', rPriv2.status === 404 && rPriv2.raw === rFake.raw, rPriv2);

  // ── 12. Account delete of a sole club owner sweeps request rows ──
  // owner2 solely owns a listed club with one pending and one resolved
  // (declined) request; deleting the account must leave zero residual rows.
  r = await api('owner2', 'POST', '/clubs/create', { name: 'Dir Doomed Club', handle: 'dirdoomed', sport: 'running', city: 'Tromsø' });
  const doomedId = ((r.body && r.body.redirect) || '').split('club=')[1];
  check('owner2 club created', !!doomedId, r.body);
  r = await api('owner2', 'PATCH', '/clubs/' + doomedId + '/settings', { visibility: 'public' });
  check('owner2 club listed', r.status === 200, r);
  r = await api('seeker', 'POST', '/clubs/' + doomedId + '/join-request');
  check('pending request on doomed club', r.status === 200, r);
  r = await api('seeker2', 'POST', '/clubs/' + doomedId + '/join-request');
  check('second request on doomed club', r.status === 200, r);
  r = await api('owner2', 'POST', '/clubs/' + doomedId + '/join-requests/' + users.seeker2.id + '/decline');
  check('one request resolved (declined) on doomed club', r.status === 200, r);
  r = await api('owner2', 'POST', '/account/delete', { confirm: 'DELETE' });
  check('sole-owner account delete succeeds', r.status === 200 && r.body && r.body.ok === true, r);
  const { data: doomedReqs } = await admin.from('club_join_requests').select('*').eq('club_id', doomedId);
  check('no residual join-request rows after account delete (pending + resolved)', (doomedReqs || []).length === 0, doomedReqs);
  const { data: doomedClub } = await admin.from('clubs').select('id').eq('id', doomedId);
  check('doomed club itself deleted', (doomedClub || []).length === 0, doomedClub);

  // ── Cleanup ──
  await admin.from('clubs').delete().eq('id', pubClubId);
  await admin.from('clubs').delete().eq('id', privClubId);
  for (const k of Object.keys(users)) {
    await admin.from('notifications').delete().eq('user_id', users[k].id);
    await admin.from('notifications').delete().eq('actor_id', users[k].id);
    await deleteUserByEmail(emails[k]);
  }
  const { data: leftovers } = await admin.from('club_join_requests').select('*').in('club_id', [pubClubId, privClubId]);
  check('cleanup: no leftover request rows', (leftovers || []).length === 0, leftovers);

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
