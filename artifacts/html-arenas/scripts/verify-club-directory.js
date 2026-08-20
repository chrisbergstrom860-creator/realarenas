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
  const { error: profileSchemaErr } = await admin.from('clubs').select('website_url, banner_path').limit(1);
  if (profileSchemaErr && /website_url|banner_path|column/i.test(profileSchemaErr.message || '')) {
    console.log('SKIP: public club profile columns are not live yet.');
    console.log('      Apply scripts/sql/public-club-profiles.sql first.');
    return;
  }
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

  // website_url via settings: accepted HTTPS, rejected non-HTTPS, blank clears.
  r = await api('owner', 'PATCH', '/clubs/' + pubClubId + '/settings', { website_url: 'https://oslo-runners.example.com' });
  check('settings: valid https website_url accepted', r.status === 200 && r.body && r.body.website_url === 'https://oslo-runners.example.com/', r);
  r = await api('owner', 'PATCH', '/clubs/' + pubClubId + '/settings', { website_url: 'http://oslo-runners.example.com' });
  check('settings: http website_url rejected 400 invalid_website', r.status === 400 && r.body && r.body.error === 'invalid_website', r);
  r = await api('owner', 'PATCH', '/clubs/' + pubClubId + '/settings', { website_url: 'javascript:void(0)' });
  check('settings: javascript: website_url rejected 400 invalid_website', r.status === 400 && r.body && r.body.error === 'invalid_website', r);
  r = await api('owner', 'PATCH', '/clubs/' + pubClubId + '/settings', { website_url: '' });
  check('settings: blank website_url clears to null', r.status === 200 && r.body && r.body.website_url === null, r);

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

  // ── 13. Leave club (self-serve) ──
  // Copy contracts (must match server.js verbatim):
  const OWNER_LEAVE_COPY = "The club owner cannot leave — the club and its billing belong to them. To step away, delete the club from its dashboard's Settings tab, or delete your account.";
  const SOLE_ADMIN_LEAVE_COPY = 'You are the only admin of Dir Public Club. Promote another member to admin from the invite page, then come back and leave the club.';

  // Relist the club (sec 11 made it private) and seed the leaver's footprint.
  r = await api('owner', 'PATCH', '/clubs/' + pubClubId + '/settings', { visibility: 'public' });
  check('13-setup: club relisted', r.status === 200, r);
  const { data: lvCh, error: lvChErr } = await admin.from('challenges').insert({
    title: 'Leave Verify Challenge', sport: 'running', goal_type: 'distance', goal_target: 50, goal_unit: 'km',
    start_date: new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10),
    end_date: new Date(Date.now() + 11 * 864e5).toISOString().slice(0, 10),
    club_id: pubClubId, created_by: users.owner.id, visibility: 'club'
  }).select().single();
  check('13-setup: club challenge seeded', !lvChErr && lvCh, lvChErr && lvChErr.message);
  const { data: lvEv, error: lvEvErr } = await admin.from('events').insert({
    created_by: users.owner.id, club_id: pubClubId, title: 'Leave Verify Event', sport: 'running',
    date: new Date(Date.now() + 7 * 864e5).toISOString(), location: 'Verify Park', visibility: 'club'
  }).select().single();
  check('13-setup: club event seeded', !lvEvErr && lvEv, lvEvErr && lvEvErr.message);
  await admin.from('challenge_participants').insert({ challenge_id: lvCh.id, user_id: users.seeker.id });
  await admin.from('event_rsvps').insert({ event_id: lvEv.id, user_id: users.seeker.id, status: 'going' });
  const { data: lvAct } = await admin.from('activities').insert({
    user_id: users.seeker.id, sport: 'running', title: 'Leave verify run',
    duration: '00:45', date: new Date(Date.now() - 864e5).toISOString().slice(0, 10)
  }).select().single();
  const { data: lvPostOwner } = await admin.from('posts').insert({
    user_id: users.owner.id, club_id: pubClubId, content: 'Leave verify announcement (owner)'
  }).select().single();
  const { data: lvPostCoach } = await admin.from('posts').insert({
    user_id: users.coach.id, club_id: pubClubId, content: 'Leave verify announcement (coach)'
  }).select().single();
  await admin.from('post_comments').insert({ post_id: lvPostOwner.id, user_id: users.seeker.id, content: 'leave verify comment' });
  await admin.from('post_likes').insert({ post_id: lvPostOwner.id, user_id: users.seeker.id });
  const { data: jrBefore } = await admin.from('club_join_requests').select('status').eq('club_id', pubClubId).eq('user_id', users.seeker.id).maybeSingle();
  check('13-setup: seeker join-request row exists (approved, from sec 8)', jrBefore && jrBefore.status === 'approved', jrBefore);

  // Zero-leak: non-member leave vs nonexistent club — byte-identical.
  const rLvOut = await api('seeker2', 'POST', '/clubs/' + pubClubId + '/leave');
  const rLvFake = await api('seeker2', 'POST', '/clubs/' + fakeId + '/leave');
  check('13: non-member leave → 404', rLvOut.status === 404, rLvOut);
  check('13: BYTE-IDENTICAL non-member vs nonexistent leave', rLvOut.status === rLvFake.status && rLvOut.raw === rLvFake.raw, { out: rLvOut.raw, fake: rLvFake.raw });

  // Owner refused with exact copy + zero effect.
  r = await api('owner', 'POST', '/clubs/' + pubClubId + '/leave');
  check('13: owner leave → 403 with exact copy', r.status === 403 && r.body && r.body.error === OWNER_LEAVE_COPY, r);
  const { data: ownMemAfter } = await admin.from('memberships').select('role').eq('club_id', pubClubId).eq('user_id', users.owner.id).maybeSingle();
  check('13: owner refusal zero effect (membership intact)', ownMemAfter && ownMemAfter.role === 'admin', ownMemAfter);

  // Server-injected canLeave flag on the member-home page.
  const pageData = async (k) => {
    const pr = await fetch(BASE_URL + '/clubs/member/' + pubClubId, { headers: { Cookie: users[k].cookie } });
    const ph = await pr.text();
    const pm = ph.match(/window\.ARENAS_DATA\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
    try { return JSON.parse(pm[1]); } catch (e) { return {}; }
  };
  let pd = await pageData('owner');
  check('13: owner page canLeave=false (control hidden server-side)', pd.canLeave === false, pd.canLeave);
  pd = await pageData('seeker');
  check('13: member page canLeave=true, clubPrivate=false', pd.canLeave === true && pd.clubPrivate === false, { canLeave: pd.canLeave, clubPrivate: pd.clubPrivate });

  // Sole-admin (non-owner): promote coach to admin, demote owner to member.
  await admin.from('memberships').update({ role: 'admin' }).eq('club_id', pubClubId).eq('user_id', users.coach.id);
  await admin.from('memberships').update({ role: 'member' }).eq('club_id', pubClubId).eq('user_id', users.owner.id);
  r = await api('coach', 'POST', '/clubs/' + pubClubId + '/leave');
  check('13: sole-admin-non-owner leave → 409 sole_admin with exact copy', r.status === 409 && r.body && r.body.error === 'sole_admin' && r.body.message === SOLE_ADMIN_LEAVE_COPY, r);
  const { data: coachMemAfter } = await admin.from('memberships').select('role').eq('club_id', pubClubId).eq('user_id', users.coach.id).maybeSingle();
  check('13: sole-admin refusal zero effect', coachMemAfter && coachMemAfter.role === 'admin', coachMemAfter);
  pd = await pageData('coach');
  check('13: blocked sole-admin page canLeave=false', pd.canLeave === false, pd.canLeave);

  // Boundary case: with another admin present, a non-owner admin CAN leave.
  await admin.from('memberships').update({ role: 'admin' }).eq('club_id', pubClubId).eq('user_id', users.owner.id);
  r = await api('coach', 'POST', '/clubs/' + pubClubId + '/leave');
  check('13: non-sole admin leave succeeds (another admin present)', r.status === 200 && r.body && r.body.success, r);
  const { data: coachMemGone } = await admin.from('memberships').select('user_id').eq('club_id', pubClubId).eq('user_id', users.coach.id);
  check('13: coach membership gone', (coachMemGone || []).length === 0, coachMemGone);
  const { data: coachPost } = await admin.from('posts').select('id').eq('id', lvPostCoach.id);
  check('13: departed admin\'s authored announcement intact', (coachPost || []).length === 1, coachPost);
  const { data: coachLeaveNotifs } = await admin.from('notifications').select('user_id, title, body, link').eq('type', 'club').eq('title', 'Member left').eq('actor_id', users.coach.id).eq('entity_id', pubClubId);
  check('13: admins notified exactly once of coach leave (owner only)', (coachLeaveNotifs || []).length === 1 && coachLeaveNotifs[0].user_id === users.owner.id && /Dir Coach left Dir Public Club/.test(coachLeaveNotifs[0].body) && coachLeaveNotifs[0].link === '/clubs/dashboard?club=' + pubClubId, coachLeaveNotifs);

  // Presence in standings BEFORE the member leaves.
  r = await api('owner', 'GET', '/challenges/' + lvCh.id + '/leaderboard');
  check('13: seeker ranked in challenge standings before leaving', ((r.body && r.body.leaderboard) || []).some(e => e.userId === users.seeker.id), r.body && r.body.leaderboard);
  r = await api('member', 'GET', '/leaderboard/club');
  check('13: seeker on club leaderboard before leaving', ((r.body && r.body.leaderboard) || []).some(e => e.userId === users.seeker.id), r.body && (r.body.clubName || r.body.leaderboard));

  // The member leaves.
  r = await api('seeker', 'POST', '/clubs/' + pubClubId + '/leave');
  check('13: member leave succeeds', r.status === 200 && r.body && r.body.success, r);
  // Gone: membership, participant row, RSVP, join-request row.
  const { data: g1 } = await admin.from('memberships').select('user_id').eq('club_id', pubClubId).eq('user_id', users.seeker.id);
  check('13: membership row gone', (g1 || []).length === 0, g1);
  const { data: g2 } = await admin.from('challenge_participants').select('user_id').eq('challenge_id', lvCh.id).eq('user_id', users.seeker.id);
  check('13: challenge_participants row gone', (g2 || []).length === 0, g2);
  const { data: g3 } = await admin.from('event_rsvps').select('user_id').eq('event_id', lvEv.id).eq('user_id', users.seeker.id);
  check('13: event_rsvps row gone', (g3 || []).length === 0, g3);
  const { data: g4 } = await admin.from('club_join_requests').select('*').eq('club_id', pubClubId).eq('user_id', users.seeker.id);
  check('13: club_join_requests row gone', (g4 || []).length === 0, g4);
  // Intact: comment, like, activity, the owner's announcement.
  const { data: k1 } = await admin.from('post_comments').select('id').eq('post_id', lvPostOwner.id).eq('user_id', users.seeker.id);
  check('13: comment on announcement intact', (k1 || []).length === 1, k1);
  const { data: k2 } = await admin.from('post_likes').select('user_id').eq('post_id', lvPostOwner.id).eq('user_id', users.seeker.id);
  check('13: like on announcement intact', (k2 || []).length === 1, k2);
  const { data: k3 } = await admin.from('activities').select('id').eq('id', lvAct.id);
  check('13: activity intact', (k3 || []).length === 1, k3);
  const { data: k4 } = await admin.from('posts').select('id').eq('id', lvPostOwner.id);
  check('13: owner announcement intact', (k4 || []).length === 1, k4);
  // Absent from standings after leaving.
  r = await api('owner', 'GET', '/challenges/' + lvCh.id + '/leaderboard');
  check('13: seeker absent from challenge standings after leaving', !((r.body && r.body.leaderboard) || []).some(e => e.userId === users.seeker.id), r.body && r.body.leaderboard);
  r = await api('member', 'GET', '/leaderboard/club');
  check('13: seeker absent from club leaderboard after leaving', !((r.body && r.body.leaderboard) || []).some(e => e.userId === users.seeker.id), r.body && r.body.leaderboard);
  // Admins notified exactly once (owner is the only admin; coach left).
  const { data: seekerLeaveNotifs } = await admin.from('notifications').select('user_id, body').eq('type', 'club').eq('title', 'Member left').eq('actor_id', users.seeker.id).eq('entity_id', pubClubId);
  check('13: admins notified exactly once of member leave', (seekerLeaveNotifs || []).length === 1 && seekerLeaveNotifs[0].user_id === users.owner.id && /Dir Seeker left Dir Public Club/.test(seekerLeaveNotifs[0].body), seekerLeaveNotifs);

  // ── 14. Rejoin: full public leave→request→approve→leave cycle ──
  r = await api('seeker', 'POST', '/clubs/' + pubClubId + '/join-request');
  check('14: re-request after leaving succeeds (no cooldown, fresh row)', r.status === 200 && r.body && r.body.success, r);
  const { data: rj1 } = await admin.from('club_join_requests').select('status, resolved_at').eq('club_id', pubClubId).eq('user_id', users.seeker.id);
  check('14: fresh pending row (single, unresolved)', rj1 && rj1.length === 1 && rj1[0].status === 'pending' && rj1[0].resolved_at === null, rj1);
  r = await api('owner', 'POST', '/clubs/' + pubClubId + '/join-requests/' + users.seeker.id + '/approve');
  check('14: re-approve succeeds', r.status === 200 && r.body && r.body.status === 'approved', r);
  const { data: rj2 } = await admin.from('memberships').select('role').eq('club_id', pubClubId).eq('user_id', users.seeker.id).maybeSingle();
  check('14: membership recreated with role member', rj2 && rj2.role === 'member', rj2);
  r = await api('seeker', 'POST', '/clubs/' + pubClubId + '/leave');
  check('14: second leave succeeds (cycle complete)', r.status === 200 && r.body && r.body.success, r);
  const { data: rj3 } = await admin.from('memberships').select('user_id').eq('club_id', pubClubId).eq('user_id', users.seeker.id);
  check('14: membership gone again', (rj3 || []).length === 0, rj3);

  // ── 15. Rejoin a PRIVATE club after leaving: fresh invite works ──
  await admin.from('memberships').insert({ user_id: users.seeker.id, club_id: privClubId, role: 'member' });
  r = await api('seeker', 'POST', '/clubs/' + privClubId + '/leave');
  check('15: leave private club succeeds', r.status === 200 && r.body && r.body.success, r);
  pd = null;
  const token2 = require('crypto').randomBytes(32).toString('hex');
  const { error: inv2Err } = await admin.from('club_invites').insert({
    club_id: privClubId, invited_by: users.owner.id, email: 'open-invite@realarenas.com',
    role: 'member', token: token2, status: 'pending',
    expires_at: new Date(Date.now() + 30 * 864e5).toISOString()
  });
  check('15: private-club open invite seeded', !inv2Err, inv2Err && inv2Err.message);
  const joinRes2 = await fetch(BASE_URL + '/auth/join/' + token2 + '/existing', {
    method: 'POST', headers: { Cookie: users.seeker.cookie }
  });
  const joinBody2 = await joinRes2.json().catch(() => null);
  check('15: invite accepted after leaving (nothing blocks rejoin)', joinRes2.status === 200 && joinBody2 && joinBody2.success, { status: joinRes2.status, joinBody2 });
  const { data: rj4 } = await admin.from('memberships').select('role').eq('club_id', privClubId).eq('user_id', users.seeker.id).maybeSingle();
  check('15: private-club membership recreated', rj4 && rj4.role === 'member', rj4);

  // Section 13-15 seeded-data cleanup (clubs/users cleanup below handles the rest).
  await admin.from('challenge_participants').delete().eq('challenge_id', lvCh.id);
  await admin.from('challenges').delete().eq('id', lvCh.id);
  await admin.from('event_rsvps').delete().eq('event_id', lvEv.id);
  await admin.from('events').delete().eq('id', lvEv.id);
  await admin.from('post_comments').delete().eq('post_id', lvPostOwner.id);
  await admin.from('post_likes').delete().eq('post_id', lvPostOwner.id);
  await admin.from('posts').delete().in('id', [lvPostOwner.id, lvPostCoach.id]);
  await admin.from('activities').delete().eq('id', lvAct.id);

  // ── 16. "Any sport" club: create → directory → filter → labels ──
  // 'any' is a club-only pseudo-value (never a registry entry). It must be
  // creatable end to end, appear unfiltered AND under every sport filter
  // (that's what the value claims), label as "Any sport" everywhere, and
  // create validation must still reject non-registry garbage.
  r = await api('coach', 'POST', '/clubs/create', { name: 'Dir Any Club', handle: 'dirany', sport: 'any', city: 'Malmo' });
  const anyClubId = ((r.body && r.body.redirect) || '').split('club=')[1];
  check('16: any-sport club created via create endpoint', !!anyClubId, r.body);
  console.log('MANIFEST anyClub:', JSON.stringify({ anyClubId }));
  r = await api('coach', 'PATCH', '/clubs/' + anyClubId + '/settings', { visibility: 'public' });
  check('16: any club listed public', r.status === 200 && r.body && r.body.visibility === 'public', r);
  // Garbage still rejected (registry validation intact, incl. legacy casing).
  r = await api('coach', 'POST', '/clubs/create', { name: 'Dir Bad Club', handle: 'dirbad', sport: 'surfing' });
  check('16: non-registry sport rejected 400 invalid_sport', r.status === 400 && r.body && r.body.error === 'invalid_sport', r);
  r = await api('coach', 'POST', '/clubs/create', { name: 'Dir Bad Club', handle: 'dirbad', sport: 'Running' });
  check('16: capitalized legacy casing rejected 400', r.status === 400 && r.body && r.body.error === 'invalid_sport', r);
  // Public signup funnel enforces the same contract (form route, 302s).
  const signupClub = (fields) => fetch(BASE_URL + '/auth/signup-club', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString()
  });
  let sr = await signupClub({ email: 'clubdir-badsport@arenas-test.dev', password: PW, name: 'Dir Bad', club_name: 'Bad Sport Club', handle: 'dirbadsport', sport: 'surfing', city: 'Oslo' });
  check('16: signup-club rejects non-registry sport (302 error, no account)', sr.status === 302 && /error=signup/.test(sr.headers.get('location') || ''), { status: sr.status, loc: sr.headers.get('location') });
  const { data: badList } = await admin.auth.admin.listUsers({ perPage: 1000 });
  check('16: no account created for rejected signup', !((badList && badList.users) || []).some(u => u.email === 'clubdir-badsport@arenas-test.dev'), null);
  sr = await signupClub({ email: 'clubdir-anysignup@arenas-test.dev', password: PW, name: 'Dir AnySignup', club_name: 'Signup Any Club', handle: 'diranysignup', sport: 'any', city: 'Oslo' });
  check('16: signup-club accepts any (302 success redirect)', sr.status === 302 && !/error=/.test(sr.headers.get('location') || ''), { status: sr.status, loc: sr.headers.get('location') });
  const { data: anySignupClub } = await admin.from('clubs').select('id, sport').eq('handle', 'diranysignup').maybeSingle();
  check('16: signup-funnel club stored with sport any', anySignupClub && anySignupClub.sport === 'any', anySignupClub);
  if (anySignupClub) {
    await admin.from('memberships').delete().eq('club_id', anySignupClub.id);
    await admin.from('clubs').delete().eq('id', anySignupClub.id);
  }
  await deleteUserByEmail('clubdir-anysignup@arenas-test.dev');

  // Directory payload carries the raw value.
  r = await api('seeker2', 'GET', '/clubs/directory');
  const anyCard = ((r.body && r.body.clubs) || []).find(c => c.id === anyClubId);
  check('16: directory card carries sport any', anyCard && anyCard.sport === 'any', anyCard);
  // Wizard select (server-rendered /for-clubs) offers the option.
  const fcHtml = await (await fetch(BASE_URL + '/for-clubs')).text();
  check('16: /for-clubs sport select offers Any sport', fcHtml.includes('<option value="any">Any sport</option>'), null);
  // Injected shared helpers know the pseudo-value (label + icon).
  const clubsHtml = await (await fetch(BASE_URL + '/clubs', { headers: { Cookie: users.seeker2.cookie } })).text();
  check('16: injected arenasSportTag handles any', clubsHtml.includes("'any') return '\uD83C\uDFDF Any sport'"), null);
  check('16: injected icon map carries any \uD83C\uDFDF', /"any":\s*"\uD83C\uDFDF"/.test(clubsHtml), null);

  // Browser: directory filter + labels at 1280 and 380, profile Clubs tab label.
  const { launchBrowser } = await import('./lib/mobile-geometry.js');
  const DOMAIN = process.env.REPLIT_DEV_DOMAIN;
  const toCookies = (raw) => raw.split('; ').map((pair) => {
    const i = pair.indexOf('=');
    return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: DOMAIN, path: '/' };
  });
  const browser = await launchBrowser();
  try {
    for (const width of [1280, 380]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.addCookies(toCookies(users.seeker2.cookie));
      const page = await context.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`https://${DOMAIN}/html/clubs`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelectorAll('#club-grid .ccd-card').length > 0, null, { timeout: 15000 });
      const unfiltered = await page.evaluate(() => Array.from(document.querySelectorAll('#club-grid .ccd-card')).map(c => c.textContent));
      check(`16: @${width} any club visible unfiltered`, unfiltered.some(t => t.includes('Dir Any Club')), unfiltered.length);
      check(`16: @${width} pill labels Any sport (never bare Any)`, unfiltered.some(t => t.includes('Any sport')), null);
      // Under EVERY sport filter option the any club stays visible.
      const options = await page.evaluate(() => Array.from(document.querySelectorAll('#sport-select option')).map(o => o.value).filter(Boolean));
      check(`16: @${width} filter dropdown has no Any chip but has sports`, options.length > 0 && !options.includes('any'), options);
      for (const opt of options) {
        const visible = await page.evaluate((v) => {
          window.setSport(v);
          return Array.from(document.querySelectorAll('#club-grid .ccd-card')).map(c => c.textContent);
        }, opt);
        check(`16: @${width} any club appears under filter "${opt}"`, visible.some(t => t.includes('Dir Any Club')), visible.length);
        if (opt === 'cycling') {
          check(`16: @${width} running club correctly absent under cycling`, !visible.some(t => t.includes('Dir Public Club')), null);
        }
      }
      await page.screenshot({ path: `/tmp/any-club-directory-${width}.png` });
      check(`16: @${width} zero console errors on /clubs`, errors.length === 0, errors.join(' | '));

      // Profile Clubs tab (coach is the any club's admin): meta says "Any sport".
      const context2 = await browser.newContext({ viewport: { width, height: 900 } });
      await context2.addCookies(toCookies(users.coach.cookie));
      const page2 = await context2.newPage();
      const errors2 = [];
      page2.on('console', (m) => { if (m.type() === 'error') errors2.push(m.text()); });
      page2.on('pageerror', (e) => errors2.push(String(e)));
      await page2.goto(`https://${DOMAIN}/html/profile#clubs`, { waitUntil: 'domcontentloaded' });
      await page2.waitForFunction(() => {
        const el = document.getElementById('clubs-list');
        return el && el.textContent.includes('Dir Any Club');
      }, null, { timeout: 15000 });
      const metaText = await page2.evaluate(() => document.getElementById('clubs-list').textContent);
      check(`16: @${width} profile Clubs tab labels Any sport`, metaText.includes('Any sport'), metaText.slice(0, 200));
      check(`16: @${width} profile Clubs tab never shows "Malmo \u00b7 Any" bare`, !/Malmo \u00b7 Any(?! sport)/.test(metaText), metaText.slice(0, 200));
      if (width === 380) await page2.screenshot({ path: `/tmp/any-club-profile-${width}.png` });
      check(`16: @${width} zero console errors on profile Clubs tab`, errors2.length === 0, errors2.join(' | '));
      await context.close();
      await context2.close();
    }
  } finally {
    await browser.close();
  }
  await admin.from('memberships').delete().eq('club_id', anyClubId);
  await admin.from('clubs').delete().eq('id', anyClubId);

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
