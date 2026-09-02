// TEMP verify: club-invite notification action pill (server side).
// 1. Seeds an admin + club and an invitee user, then inserts four invite
//    scenarios directly (pending / expired / accepted / revoked-i.e.-deleted)
//    with matching in-app notifications (same shape the real invite paths
//    write: type 'club', link '/join/<token>').
// 2. Asserts GET /api/notifications attaches the honest inviteState per row
//    and leaves non-invite notifications untouched.
// 3. Accepts the pending invite with the signed state from the canonical join
//    page and asserts: membership row exists, invite is
//    marked accepted, the notification's inviteState flips to 'joined', and
//    the club shows up in the server-injected sidebar on /feed.
// Cleans everything up afterwards.
//
// Run with the dev server up: node artifacts/html-arenas/scripts/verify-invite-notif.js

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const BASE_URL = 'http://localhost:80/html';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

async function deleteUserByEmail(email) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of (data && data.users) || []) {
    if (u.email === email) {
      await admin.from('notifications').delete().eq('user_id', u.id);
      await admin.from('memberships').delete().eq('user_id', u.id);
      await admin.auth.admin.deleteUser(u.id);
    }
  }
}

async function login(email, password) {
  const r = await fetch(BASE_URL + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }), redirect: 'manual'
  });
  return (r.headers.getSetCookie ? r.headers.getSetCookie() : [])
    .map((c) => c.split(';')[0]).join('; ');
}

function injectedJoinData(html) {
  const marker = 'window.JOIN_DATA = ';
  const start = html.indexOf(marker);
  const end = start < 0 ? -1 : html.indexOf(';</script>', start + marker.length);
  return start < 0 || end < 0 ? null : JSON.parse(html.slice(start + marker.length, end));
}

async function acceptExisting(token, cookie) {
  const page = await fetch(BASE_URL + '/join/' + token, { headers: { Cookie: cookie } });
  const rendered = injectedJoinData(await page.text());
  return fetch(BASE_URL + '/auth/join/' + token + '/existing', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      renderedPlan: rendered && rendered.plan,
      renderedPlanProof: rendered && rendered.planProof
    })
  });
}

(async () => {
  const adminEmail = 'invite-notif-admin@arenas-test.dev';
  const inviteeEmail = 'invite-notif-invitee@arenas-test.dev';
  const password = 'Invitecheck!12345';
  const clubName = 'Invite Notif Verify Club';

  await deleteUserByEmail(adminEmail);
  await deleteUserByEmail(inviteeEmail);
  await admin.from('clubs').delete().eq('name', clubName);

  const mk = (email, name, handle) => admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { name, handle }
  });
  const { data: adminUser, error: aErr } = await mk(adminEmail, 'Invite Admin', 'invadmin');
  const { data: invitee, error: iErr } = await mk(inviteeEmail, 'Invite Invitee', 'invinvitee');
  if (aErr || iErr) { check('create seeded users', false, (aErr || iErr).message); process.exit(1); }
  const adminId = adminUser.user.id;
  const inviteeId = invitee.user.id;

  let clubId = null;
  try {
    const { data: club, error: cErr } = await admin.from('clubs')
      .insert({ name: clubName, handle: 'invite-notif-verify', sport: 'running', owner_id: adminId }).select().single();
    if (cErr) { check('create club', false, cErr.message); throw new Error('setup'); }
    clubId = club.id;
    await admin.from('memberships').insert({ user_id: adminId, club_id: clubId, role: 'admin' });

    // Four invite scenarios (tokens hex like the real generator).
    const tok = () => crypto.randomBytes(32).toString('hex');
    const tPending = tok(), tExpired = tok(), tAccepted = tok(), tRevoked = tok();
    const future = new Date(Date.now() + 14 * 86400e3).toISOString();
    const past = new Date(Date.now() - 86400e3).toISOString();
    const { error: invErr } = await admin.from('club_invites').insert([
      { club_id: clubId, invited_by: adminId, email: inviteeEmail, role: 'member', token: tPending, status: 'pending', expires_at: future },
      { club_id: clubId, invited_by: adminId, email: inviteeEmail, role: 'member', token: tExpired, status: 'pending', expires_at: past },
      { club_id: clubId, invited_by: adminId, email: inviteeEmail, role: 'member', token: tAccepted, status: 'accepted', expires_at: future }
      // tRevoked: NO invite row (revoke = DELETE) — only the notification remains.
    ]);
    check('insert invite rows', !invErr, invErr && invErr.message);

    const notif = (token, body) => ({
      user_id: inviteeId, type: 'club', title: 'Club invite',
      body, link: '/join/' + token, read: false
    });
    const { error: nErr } = await admin.from('notifications').insert([
      notif(tPending, 'Invite Admin invited you to join ' + clubName + ' on Arenas'),
      notif(tExpired, '(expired) invite'),
      notif(tAccepted, '(accepted) invite'),
      notif(tRevoked, '(revoked) invite'),
      { user_id: inviteeId, type: 'like', title: 'New like', body: 'Someone liked your activity', link: '/feed', read: false }
    ]);
    check('insert notifications', !nErr, nErr && nErr.message);

    const cookie = await login(inviteeEmail, password);
    check('invitee login sets session cookies', cookie.includes('sb_access_token'));

    const getNotifs = async () => {
      const r = await fetch(BASE_URL + '/api/notifications', { headers: { Cookie: cookie } });
      return (await r.json()).notifications || [];
    };
    const stateOf = (list, token) => {
      const n = list.find((x) => x.link === '/join/' + token);
      return n ? (n.inviteState || '(none)') : '(missing)';
    };

    let list = await getNotifs();
    check('pending invite → inviteState pending', stateOf(list, tPending) === 'pending', stateOf(list, tPending));
    check('expired invite → inviteState expired', stateOf(list, tExpired) === 'expired', stateOf(list, tExpired));
    check('accepted invite → inviteState joined', stateOf(list, tAccepted) === 'joined', stateOf(list, tAccepted));
    check('revoked (deleted) invite → inviteState gone', stateOf(list, tRevoked) === 'gone', stateOf(list, tRevoked));
    const likeNotif = list.find((x) => x.type === 'like');
    check('non-invite notification carries NO inviteState', likeNotif && !('inviteState' in likeNotif));

    // Review the canonical page, then accept with its signed plan state.
    const acc = await acceptExisting(tPending, cookie);
    const accBody = await acc.json();
    check('reviewed invite accept succeeds', acc.ok && accBody && accBody.success === true, JSON.stringify(accBody));

    const { data: mem } = await admin.from('memberships')
      .select('role').eq('user_id', inviteeId).eq('club_id', clubId).maybeSingle();
    check('membership row created (role member)', mem && mem.role === 'member', JSON.stringify(mem));

    const { data: invRow } = await admin.from('club_invites')
      .select('status').eq('token', tPending).maybeSingle();
    check('personal invite marked accepted (single-use)', invRow && invRow.status === 'accepted', JSON.stringify(invRow));

    list = await getNotifs();
    check('after join: pending invite now inviteState joined', stateOf(list, tPending) === 'joined', stateOf(list, tPending));

    // Sidebar "My clubs" is server-injected — the club must appear on next load.
    const feed = await fetch(BASE_URL + '/feed', { headers: { Cookie: cookie } });
    const feedHtml = await feed.text();
    check('club appears in server-injected data on /feed', feedHtml.includes(clubName));

    // Double-accept stays honest (alreadyMember, no duplicate membership).
    const acc2 = await fetch(BASE_URL + '/auth/join/' + tPending + '/existing', {
      method: 'POST', headers: { Cookie: cookie }
    });
    const acc2Body = await acc2.json().catch(() => ({}));
    check('re-accept of consumed invite is a 404 (single-use) or alreadyMember', acc2.status === 404 || acc2Body.alreadyMember === true, acc2.status + ' ' + JSON.stringify(acc2Body));

    // ── Invite role ceiling: an inviter cannot grant a role above their own ──
    // Coach may invite members/coaches; only an admin can mint an admin invite.
    const REFUSAL = 'Coaches can invite members and coaches. Only a club admin can send an admin invite.';
    const coachEmail = 'invite-notif-coach@arenas-test.dev';
    const target2 = 'invite-notif-target2@arenas-test.dev';
    await deleteUserByEmail(coachEmail);
    await deleteUserByEmail(target2);
    const { data: coachUser, error: coErr } = await mk(coachEmail, 'Invite Coach', 'invcoach');
    check('create coach user', !coErr, coErr && coErr.message);
    const coachId = coachUser.user.id;
    await admin.from('memberships').insert({ user_id: coachId, club_id: clubId, role: 'coach' });
    const coachCookie = await login(coachEmail, password);
    const adminCookie = await login(adminEmail, password);
    const post = (cookie, path, body) => fetch(BASE_URL + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body)
    });
    const rowsFor = async (email) => (await admin.from('club_invites')
      .select('id, role').eq('club_id', clubId).eq('email', email)).data || [];

    // Coach → admin invite refused with zero effect (personal route).
    let r1 = await post(coachCookie, '/api/clubs/' + clubId + '/invites', { email: target2, role: 'admin' });
    let b1 = await r1.json();
    check('coach personal admin invite → 403 with explanatory copy', r1.status === 403 && b1.error === REFUSAL, r1.status + ' ' + JSON.stringify(b1));
    check('coach personal admin invite → zero rows', (await rowsFor(target2)).length === 0);

    // Coach → bulk batch containing an admin row refused whole, zero effect.
    let r2 = await post(coachCookie, '/api/clubs/' + clubId + '/invites/bulk', {
      invites: [{ email: 'invite-notif-b1@arenas-test.dev', role: 'member' }, { email: target2, role: 'admin' }]
    });
    let b2 = await r2.json();
    check('coach bulk with admin row → 403 whole batch', r2.status === 403 && b2.error === REFUSAL, r2.status + ' ' + JSON.stringify(b2));
    check('coach bulk refusal → zero rows (both emails)', (await rowsFor(target2)).length === 0 && (await rowsFor('invite-notif-b1@arenas-test.dev')).length === 0);

    // Coach can still invite members and coaches.
    let r3 = await post(coachCookie, '/api/clubs/' + clubId + '/invites', { email: target2, role: 'coach' });
    check('coach can mint a coach invite', r3.ok, r3.status);
    const coachMinted = await rowsFor(target2);
    check('coach-minted invite stored with role coach', coachMinted.length === 1 && coachMinted[0].role === 'coach', JSON.stringify(coachMinted));
    await admin.from('club_invites').delete().eq('club_id', clubId).eq('email', target2);

    // Coach join links still work and never carry a role above member.
    let r4 = await post(coachCookie, '/api/clubs/' + clubId + '/join-link', {});
    let b4 = await r4.json();
    check('coach join-link creation still works', r4.ok && !!b4.joinUrl, r4.status + ' ' + JSON.stringify(b4));
    const { data: openRows } = await admin.from('club_invites')
      .select('role').eq('club_id', clubId).eq('email', 'open-invite@realarenas.com');
    check('join link role is hardcoded member', (openRows || []).every((r) => r.role === 'member'), JSON.stringify(openRows));

    // Admin unaffected: personal admin invite works and REDEEMS as admin.
    let r5 = await post(adminCookie, '/api/clubs/' + clubId + '/invites', { email: target2, role: 'admin' });
    check('admin can still mint an admin invite', r5.ok, r5.status + ' ' + JSON.stringify(await r5.json().catch(() => ({}))));
    const adminMinted = await rowsFor(target2);
    check('admin-minted invite stored with role admin', adminMinted.length === 1 && adminMinted[0].role === 'admin', JSON.stringify(adminMinted));
    const { data: mintedRow } = await admin.from('club_invites')
      .select('token').eq('club_id', clubId).eq('email', target2).eq('status', 'pending').single();
    const { data: t2User, error: t2Err } = await mk(target2, 'Invite Target Two', 'invtarget2');
    check('create redeemer user', !t2Err, t2Err && t2Err.message);
    const t2Cookie = await login(target2, password);
    const r6 = await acceptExisting(mintedRow.token, t2Cookie);
    const b6 = await r6.json().catch(() => ({}));
    const { data: t2Mem } = await admin.from('memberships')
      .select('role').eq('user_id', t2User.user.id).eq('club_id', clubId).maybeSingle();
    check('legit admin invite redeems as admin membership', r6.ok && b6.success === true && t2Mem && t2Mem.role === 'admin', r6.status + ' ' + JSON.stringify({ b6, t2Mem }));

    // Coach cannot RESEND (extend + re-deliver) an admin invite either.
    // (Fresh pending admin invite — the target2 one was consumed above.)
    const resendEmail = 'invite-notif-resend@arenas-test.dev';
    const rMint = await post(adminCookie, '/api/clubs/' + clubId + '/invites', { email: resendEmail, role: 'admin' });
    check('mint pending admin invite for resend test', rMint.ok, rMint.status);
    const { data: adminInvRow } = await admin.from('club_invites')
      .select('id, expires_at').eq('club_id', clubId).eq('email', resendEmail).single();
    const r5b = await post(coachCookie, '/api/clubs/invites/' + adminInvRow.id + '/resend', {});
    const b5b = await r5b.json();
    const { data: afterResend } = await admin.from('club_invites')
      .select('expires_at').eq('id', adminInvRow.id).single();
    check('coach resend of admin invite → 403 with explanatory copy', r5b.status === 403 && b5b.error === REFUSAL, r5b.status + ' ' + JSON.stringify(b5b));
    check('coach resend refusal leaves expires_at unchanged', afterResend.expires_at === adminInvRow.expires_at, adminInvRow.expires_at + ' → ' + afterResend.expires_at);
    // Admin resend of the same invite still works (expiry extends).
    const r5c = await post(adminCookie, '/api/clubs/invites/' + adminInvRow.id + '/resend', {});
    const { data: afterAdminResend } = await admin.from('club_invites')
      .select('expires_at').eq('id', adminInvRow.id).single();
    check('admin resend of admin invite still works', r5c.ok && afterAdminResend.expires_at !== adminInvRow.expires_at, r5c.status);

    // Admin bulk with admin rows unaffected.
    let r7 = await post(adminCookie, '/api/clubs/' + clubId + '/invites/bulk', {
      invites: [{ email: 'invite-notif-b2@arenas-test.dev', role: 'admin' }]
    });
    let b7 = await r7.json();
    check('admin bulk admin invite unaffected', r7.ok && (b7.sent || []).length === 1, r7.status + ' ' + JSON.stringify(b7));

    // UI ceiling flag is server-decided on the /clubs/invite payload.
    const pageFor = async (cookie) => await (await fetch(BASE_URL + '/clubs/invite?club=' + clubId, { headers: { Cookie: cookie } })).text();
    const coachPage = await pageFor(coachCookie);
    const adminPage = await pageFor(adminCookie);
    check('coach invite console payload says canInviteAdmin:false', coachPage.includes('"canInviteAdmin":false'));
    check('admin invite console payload says canInviteAdmin:true', adminPage.includes('"canInviteAdmin":true'));
  } finally {
    if (clubId) {
      await admin.from('club_invites').delete().eq('club_id', clubId);
      await admin.from('memberships').delete().eq('club_id', clubId);
      await admin.from('clubs').delete().eq('id', clubId);
    }
    await deleteUserByEmail(adminEmail);
    await deleteUserByEmail(inviteeEmail);
    await deleteUserByEmail('invite-notif-coach@arenas-test.dev');
    await deleteUserByEmail('invite-notif-target2@arenas-test.dev');
    console.log('      seeded users/club cleaned up');
  }

  console.log(failures === 0 ? '\nAll checks passed.' : '\n' + failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('Script error:', e); process.exit(1); });
