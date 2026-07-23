// TEMP verify: club-invite notification action pill (server side).
// 1. Seeds an admin + club and an invitee user, then inserts four invite
//    scenarios directly (pending / expired / accepted / revoked-i.e.-deleted)
//    with matching in-app notifications (same shape the real invite paths
//    write: type 'club', link '/join/<token>').
// 2. Asserts GET /api/notifications attaches the honest inviteState per row
//    and leaves non-invite notifications untouched.
// 3. Accepts the pending invite via POST /auth/join/:token/existing (the
//    panel button's endpoint) and asserts: membership row exists, invite is
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

    // Accept the pending invite through the panel button's endpoint.
    const acc = await fetch(BASE_URL + '/auth/join/' + tPending + '/existing', {
      method: 'POST', headers: { Cookie: cookie }
    });
    const accBody = await acc.json();
    check('inline accept succeeds', acc.ok && accBody && accBody.success === true, JSON.stringify(accBody));

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
  } finally {
    if (clubId) {
      await admin.from('club_invites').delete().eq('club_id', clubId);
      await admin.from('memberships').delete().eq('club_id', clubId);
      await admin.from('clubs').delete().eq('id', clubId);
    }
    await deleteUserByEmail(adminEmail);
    await deleteUserByEmail(inviteeEmail);
    console.log('      seeded users/club cleaned up');
  }

  console.log(failures === 0 ? '\nAll checks passed.' : '\n' + failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('Script error:', e); process.exit(1); });
