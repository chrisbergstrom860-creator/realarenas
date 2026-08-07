// TEMP verify: honest 404s on notification dismiss + club member removal.
// Seeds an admin (+club), a member, and an outsider; asserts:
//  - DELETE /api/notifications/:id → 404 for nonexistent id AND for someone
//    else's notification (byte-identical bodies), 200 + actual delete for own.
//  - DELETE /api/clubs/:clubId/members/:userId → 404 when target isn't a
//    member, 200 + row gone when they are.
// Cleans everything up afterwards.
// Run with the dev server up: node artifacts/html-arenas/scripts/verify-delete-honesty.js

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

async function del(path, cookie) {
  const r = await fetch(BASE_URL + path, { method: 'DELETE', headers: { Cookie: cookie } });
  const text = await r.text();
  return { status: r.status, text };
}

(async () => {
  const adminEmail = 'del-honesty-admin@arenas-test.dev';
  const memberEmail = 'del-honesty-member@arenas-test.dev';
  const outsiderEmail = 'del-honesty-outsider@arenas-test.dev';
  const password = 'Delhonesty!12345';
  const clubName = 'Delete Honesty Verify Club';

  await deleteUserByEmail(adminEmail);
  await deleteUserByEmail(memberEmail);
  await deleteUserByEmail(outsiderEmail);
  await admin.from('clubs').delete().eq('name', clubName);

  const mk = (email, name, handle) => admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { name, handle }
  });
  const { data: a, error: aErr } = await mk(adminEmail, 'Del Admin', 'delhadmin');
  const { data: m, error: mErr } = await mk(memberEmail, 'Del Member', 'delhmember');
  const { data: o, error: oErr } = await mk(outsiderEmail, 'Del Outsider', 'delhoutsider');
  if (aErr || mErr || oErr) { check('create users', false, (aErr || mErr || oErr).message); process.exit(1); }
  const adminId = a.user.id, memberId = m.user.id, outsiderId = o.user.id;

  let clubId = null;
  try {
    const { data: club, error: cErr } = await admin.from('clubs')
      .insert({ name: clubName, handle: 'del-honesty-verify', sport: 'running', owner_id: adminId }).select().single();
    if (cErr) { check('create club', false, cErr.message); throw new Error('setup'); }
    clubId = club.id;
    await admin.from('memberships').insert([
      { user_id: adminId, club_id: clubId, role: 'admin' },
      { user_id: memberId, club_id: clubId, role: 'member' }
    ]);

    // Notifications: one for member, one for outsider.
    const { data: nMine } = await admin.from('notifications')
      .insert({ user_id: memberId, type: 'like', title: 'Mine', body: 'x', link: '/feed', read: false }).select().single();
    const { data: nTheirs } = await admin.from('notifications')
      .insert({ user_id: outsiderId, type: 'like', title: 'Theirs', body: 'x', link: '/feed', read: false }).select().single();

    const memberCookie = await login(memberEmail, password);
    const adminCookie = await login(adminEmail, password);
    check('logins work', memberCookie.includes('sb_access_token') && adminCookie.includes('sb_access_token'));

    // ── Notification dismiss ──
    const rGhost = await del('/api/notifications/00000000-0000-0000-0000-000000000000', memberCookie);
    check('nonexistent notification → 404', rGhost.status === 404, 'got ' + rGhost.status + ' ' + rGhost.text);
    const rTheirs = await del('/api/notifications/' + nTheirs.id, memberCookie);
    check("someone else's notification → 404", rTheirs.status === 404, 'got ' + rTheirs.status);
    check('404 bodies byte-identical (no leak)', rGhost.text === rTheirs.text, rGhost.text + ' vs ' + rTheirs.text);
    const { data: stillThere } = await admin.from('notifications').select('id').eq('id', nTheirs.id).maybeSingle();
    check("other's notification untouched", !!stillThere);
    const rMine = await del('/api/notifications/' + nMine.id, memberCookie);
    check('own notification dismiss → 200 success', rMine.status === 200 && JSON.parse(rMine.text).success === true, rMine.status + ' ' + rMine.text);
    const { data: gone } = await admin.from('notifications').select('id').eq('id', nMine.id).maybeSingle();
    check('own notification actually deleted', !gone);

    // ── Club member removal ──
    const rNotMember = await del('/api/clubs/' + clubId + '/members/' + outsiderId, adminCookie);
    check('remove non-member → 404', rNotMember.status === 404, 'got ' + rNotMember.status + ' ' + rNotMember.text);
    const rNonAdmin = await del('/api/clubs/' + clubId + '/members/' + adminId, memberCookie);
    check('non-admin remove attempt → 403', rNonAdmin.status === 403, 'got ' + rNonAdmin.status);
    const rReal = await del('/api/clubs/' + clubId + '/members/' + memberId, adminCookie);
    check('remove real member → 200 success', rReal.status === 200 && JSON.parse(rReal.text).success === true, rReal.status + ' ' + rReal.text);
    const { data: rowGone } = await admin.from('memberships').select('user_id').eq('user_id', memberId).eq('club_id', clubId).maybeSingle();
    check('membership row actually deleted', !rowGone);
    const rAgain = await del('/api/clubs/' + clubId + '/members/' + memberId, adminCookie);
    check('repeat removal → 404 (no phantom success)', rAgain.status === 404, 'got ' + rAgain.status);
  } catch (e) {
    if (e.message !== 'setup') { check('unexpected error', false, e.message); }
  } finally {
    if (clubId) await admin.from('clubs').delete().eq('id', clubId);
    await deleteUserByEmail(adminEmail);
    await deleteUserByEmail(memberEmail);
    await deleteUserByEmail(outsiderEmail);
  }

  console.log(failures ? '\n' + failures + ' FAILURES' : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
