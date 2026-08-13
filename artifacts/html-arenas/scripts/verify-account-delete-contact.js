// Pins account deletion's coverage of contact_messages:
//   1. A user who submitted the contact form BOTH logged in (row carries
//      user_id) and logged out (row carries NO user_id, only from_email —
//      typed with different letter-case) leaves ZERO contact_messages rows
//      after /api/account/delete, proven by querying the table directly
//      (by user_id AND by case-insensitive from_email), never by trusting
//      the delete call's response.
//   2. The email match is case-insensitive but LIKE-safe: the fixture email
//      contains underscores, and a control row whose address differs only
//      where the underscores sit must SURVIVE — an unescaped `_` wildcard
//      would wrongly delete it.
//   3. An unrelated control row (different address entirely) also survives.
//   4. Cascade proofs for the two report-only gaps in the deletion sweep:
//      activity_likes — the fixture BOTH gives a like (on a borrowed activity
//      owned by someone else, so only the auth-user FK cascade can remove it;
//      the sweep never touches that row) and receives one (another user's
//      like on the fixture's activity, removed via the activity-delete FK
//      cascade when the sweep deletes the fixture's activities) — zero rows
//      reference the deleted user in either direction afterwards.
//      profiles — the row (kept in sync by profiles_id_fkey to auth.users)
//      must be gone after the auth user is deleted.
// Runs against a spawned server (RESEND_API_KEY stripped so no real mail is
// sent; raised limiter cap so submissions can't 429; BASE_PATH=/html).
const { spawn } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const PW = 'Probe-1234!';
let fails = 0, cleanupFails = 0;
const ok = (c, l, x) => { console.log((c ? '  ok  ' : '  FAIL ') + l + (x ? ' — ' + x : '')); if (!c) fails++; };

// Underscores on purpose — they double as the LIKE-escaping proof.
const FIXTURE_EMAIL = 'delete_contact_verify@arenas-test.dev';
const FIXTURE_MIXEDCASE = 'Delete_Contact_VERIFY@Arenas-Test.dev';
// Differs from the fixture ONLY at the underscore positions: an unescaped
// `_` in the ilike pattern would match (and wrongly delete) this row.
const LIKE_TRAP_EMAIL = 'deleteXcontactXverify@arenas-test.dev';
const CONTROL_EMAIL = 'unrelated-control@arenas-test.dev';

async function precleanFixtureUser() {
  try {
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
    const stale = (data.users || []).find((u) => u.email === FIXTURE_EMAIL);
    if (stale) { await admin.auth.admin.deleteUser(stale.id); console.log('  info: pre-cleaned stale fixture user'); }
  } catch (e) { console.log('  info: fixture pre-clean skipped —', e.message); }
}

function spawnNoKeyServer(port, extraEnv) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PORT: String(port), BASE_PATH: '/html', ...(extraEnv || {}) };
    delete env.RESEND_API_KEY;
    const proc = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env });
    const timer = setTimeout(() => reject(new Error('spawned server never listened')), 30000);
    proc.stdout.on('data', (d) => {
      if (String(d).includes('Server listening')) { clearTimeout(timer); resolve({ proc, base: `http://localhost:${port}/html` }); }
    });
    proc.on('exit', (code) => reject(new Error('spawned server exited ' + code)));
  });
}

async function login(base, email) {
  const r = await fetch(base + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password: PW }), redirect: 'manual',
  });
  const raw = r.headers.getSetCookie();
  if (!raw.length) throw new Error('login failed');
  return raw.map((c) => c.split(';')[0]).join('; ');
}

const postContact = (base, body, cookie) => fetch(base + '/api/contact', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body),
});

(async () => {
  const ids = { users: [], messages: [] };
  const save = () => fs.writeFileSync('/tmp/verify-account-delete-contact-manifest.json', JSON.stringify(ids, null, 2));
  let spawned = null;
  let uid = null;
  try {
    await precleanFixtureUser();
    // Pre-clean any residue rows from an earlier killed run.
    await admin.from('contact_messages').delete().in('from_email',
      [FIXTURE_EMAIL, FIXTURE_MIXEDCASE, LIKE_TRAP_EMAIL, CONTROL_EMAIL]);

    const { data: ud, error: ue } = await admin.auth.admin.createUser({
      email: FIXTURE_EMAIL, password: PW, email_confirm: true,
      user_metadata: { name: 'Delete Contact Verify', sports: ['running'] },
    });
    if (ue) throw ue;
    uid = ud.user.id;
    ids.users.push(uid); save();

    // ── Cascade fixtures (activity_likes + profiles) ──
    // The fixture's own activity (explicitly swept; its received like must
    // die with it via the activity_id FK cascade).
    const { data: actMine, error: actErr } = await admin.from('activities').insert(
      { user_id: uid, sport: 'running', title: 'Cascade Proof Run', distance: '5 km', duration: '30:00', date: new Date().toISOString() }
    ).select('id').single();
    if (actErr) throw actErr;
    ids.activities = [actMine.id]; save();
    // Borrow an existing activity owned by someone ELSE: the like the fixture
    // gives on it is touched by NOTHING in the sweep — only the auth-user FK
    // cascade can remove it. (Direct DB inserts: no notification fan-out.)
    const { data: hostRows } = await admin.from('activities')
      .select('id, user_id').neq('user_id', uid).limit(1);
    const host = (hostRows || [])[0] || null;
    // MANDATORY: without a host both like proofs would silently not run and
    // "zero rows" would pass vacuously — that must be a failure, not a skip.
    if (!host) throw new Error('no borrowable host activity found — cascade proofs cannot run');
    ids.likes = [];
    const { error: giveErr } = await admin.from('activity_likes')
      .insert({ activity_id: host.id, user_id: uid });
    if (giveErr) throw giveErr;
    ids.likes.push({ activity_id: host.id, user_id: uid });
    const { error: recvErr } = await admin.from('activity_likes')
      .insert({ activity_id: actMine.id, user_id: host.user_id });
    if (recvErr) throw recvErr;
    ids.likes.push({ activity_id: actMine.id, user_id: host.user_id });
    save();

    // profiles FK capability probe: an insert with a guaranteed-nonexistent
    // auth UUID must fail with SQLSTATE 23503 (profiles_id_fkey). This pins
    // that the post-delete disappearance below is the FK cascade, not some
    // other mechanism. If the probe insert ever SUCCEEDS, the row is removed
    // immediately and the assertion fails loudly.
    const orphanId = require('crypto').randomUUID();
    const { error: probeErr } = await admin.from('profiles').insert({ id: orphanId, name: 'fk probe' });
    if (!probeErr) await admin.from('profiles').delete().eq('id', orphanId);
    ok(!!probeErr && probeErr.code === '23503', 'profiles has an FK to auth.users (orphan insert fails 23503)', probeErr ? probeErr.code : 'insert succeeded');

    spawned = await spawnNoKeyServer(19919, { CONTACT_RATE_MAX: '100' });
    const cookie = await login(spawned.base, FIXTURE_EMAIL);

    // Logged-in submission → row with user_id.
    const r1 = await postContact(spawned.base, { email: FIXTURE_EMAIL, subject: 'logged-in msg', message: 'body' }, cookie);
    ok(r1.status >= 500, 'logged-in submission recorded (5xx expected — no RESEND key on spawn)', 'got ' + r1.status);
    // Logged-out submission, DIFFERENT letter-case → row with user_id null.
    const r2 = await postContact(spawned.base, { email: FIXTURE_MIXEDCASE, subject: 'logged-out msg', message: 'body' });
    ok(r2.status >= 500, 'logged-out mixed-case submission recorded', 'got ' + r2.status);

    // Control rows that must SURVIVE the deletion.
    const { data: trapRow, error: trapErr } = await admin.from('contact_messages')
      .insert({ from_email: LIKE_TRAP_EMAIL, subject: 'like-trap', message: 'must survive', user_id: null, send_status: 'failed_config' })
      .select('id').single();
    if (trapErr) throw trapErr;
    ids.messages.push(trapRow.id); save();
    const { data: ctrlRow, error: ctrlErr } = await admin.from('contact_messages')
      .insert({ from_email: CONTROL_EMAIL, subject: 'control', message: 'must survive', user_id: null, send_status: 'failed_config' })
      .select('id').single();
    if (ctrlErr) throw ctrlErr;
    ids.messages.push(ctrlRow.id); save();

    // Preconditions: both fixture rows exist, matched the way deletion must match.
    const { data: preUid } = await admin.from('contact_messages').select('id').eq('user_id', uid);
    ok((preUid || []).length === 1, 'precondition: 1 row matched by user_id', String((preUid || []).length));
    for (const r of (preUid || [])) { ids.messages.push(r.id); } save();
    const escaped = FIXTURE_EMAIL.replace(/[\\%_]/g, (m) => '\\' + m);
    const { data: preMail } = await admin.from('contact_messages').select('id, user_id').ilike('from_email', escaped);
    ok((preMail || []).length === 2, 'precondition: 2 rows matched case-insensitively by from_email', String((preMail || []).length));
    ok((preMail || []).some((r) => r.user_id === null), 'precondition: the logged-out row carries no user_id');
    for (const r of (preMail || [])) { if (!ids.messages.includes(r.id)) ids.messages.push(r.id); } save();
    // Cascade preconditions: both like directions present, profiles row exists.
    const { data: preGiven } = await admin.from('activity_likes').select('activity_id').eq('user_id', uid);
    ok((preGiven || []).length === 1, 'precondition: like GIVEN by fixture exists', String((preGiven || []).length));
    const { data: preRecv } = await admin.from('activity_likes').select('user_id').eq('activity_id', actMine.id);
    ok((preRecv || []).length === 1, 'precondition: like RECEIVED on fixture activity exists', String((preRecv || []).length));
    const { data: preProf } = await admin.from('profiles').select('id').eq('id', uid);
    ok((preProf || []).length === 1, 'precondition: profiles row exists for fixture user', String((preProf || []).length));

    // Delete the account through the real endpoint.
    const del = await fetch(spawned.base + '/api/account/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    ok(del.status === 200, 'account delete returns 200', 'got ' + del.status);

    // The PROOF: query the table directly, both match dimensions.
    const { data: postUid } = await admin.from('contact_messages').select('id').eq('user_id', uid);
    ok((postUid || []).length === 0, 'zero rows remain matched by user_id', String((postUid || []).length));
    const { data: postMail } = await admin.from('contact_messages').select('id').ilike('from_email', escaped);
    ok((postMail || []).length === 0, 'zero rows remain matched case-insensitively by from_email', String((postMail || []).length));

    // Survivors: the LIKE-trap and the unrelated control row.
    const { data: trapAfter } = await admin.from('contact_messages').select('id').eq('id', trapRow.id);
    ok((trapAfter || []).length === 1, 'LIKE-trap row survived (underscores were escaped, not wildcards)');
    const { data: ctrlAfter } = await admin.from('contact_messages').select('id').eq('id', ctrlRow.id);
    ok((ctrlAfter || []).length === 1, 'unrelated control row survived');

    // Cascade proofs. The GIVEN like sits on a surviving activity the sweep
    // never touches — zero rows here proves the auth-user FK cascade holds.
    const { data: postGiven } = await admin.from('activity_likes').select('activity_id').eq('user_id', uid);
    ok((postGiven || []).length === 0, 'zero activity_likes remain GIVEN by the deleted user (auth-user FK cascade)', String((postGiven || []).length));
    const { data: postRecv } = await admin.from('activity_likes').select('user_id').eq('activity_id', actMine.id);
    ok((postRecv || []).length === 0, 'zero activity_likes remain RECEIVED on the deleted user\'s activities', String((postRecv || []).length));
    const { data: hostStill } = await admin.from('activities').select('id').eq('id', host.id);
    ok((hostStill || []).length === 1, 'borrowed host activity itself survived (only the like was cascaded)');
    const { data: postProf } = await admin.from('profiles').select('id').eq('id', uid);
    ok((postProf || []).length === 0, 'profiles row is gone (profiles_id_fkey cascade)', String((postProf || []).length));

    // Auth user is really gone.
    const { data: gone } = await admin.auth.admin.getUserById(uid);
    ok(!gone || !gone.user, 'auth user is gone');
  } finally {
    if (spawned) { try { spawned.proc.kill('SIGKILL'); } catch (e) { /* already dead */ } }
    // Manifest-driven cleanup: every seeded row/user verified gone or removed.
    try {
      const { error } = await admin.from('contact_messages').delete().in('from_email',
        [FIXTURE_EMAIL, FIXTURE_MIXEDCASE, LIKE_TRAP_EMAIL, CONTROL_EMAIL]);
      if (error) { cleanupFails++; console.log('cleanup fail rows:', error.message); }
    } catch (e) { cleanupFails++; console.log('cleanup fail rows:', e.message); }
    // Cascade fixtures: likes first (PK pair — no id column), then activities.
    for (const l of (ids.likes || [])) {
      try {
        const { error } = await admin.from('activity_likes').delete()
          .eq('activity_id', l.activity_id).eq('user_id', l.user_id);
        if (error) { cleanupFails++; console.log('cleanup fail like:', error.message); }
      } catch (e) { cleanupFails++; console.log('cleanup fail like:', e.message); }
    }
    for (const id of (ids.activities || [])) {
      try {
        const { error } = await admin.from('activities').delete().eq('id', id);
        if (error) { cleanupFails++; console.log('cleanup fail activity', id, error.message); }
      } catch (e) { cleanupFails++; console.log('cleanup fail activity', id, e.message); }
    }
    for (const id of ids.users) {
      try {
        const { data } = await admin.auth.admin.getUserById(id);
        if (data && data.user) await admin.auth.admin.deleteUser(id);
      } catch (e) { /* already gone — expected */ }
    }
    // Manifest residue check for cascade fixtures too.
    try {
      if ((ids.activities || []).length) {
        const { data: aRes } = await admin.from('activities').select('id').in('id', ids.activities);
        if ((aRes || []).length) { cleanupFails++; console.log('CLEANUP RESIDUE activities:', JSON.stringify(aRes)); }
      }
      for (const l of (ids.likes || [])) {
        const { data: lRes } = await admin.from('activity_likes').select('user_id')
          .eq('activity_id', l.activity_id).eq('user_id', l.user_id);
        if ((lRes || []).length) { cleanupFails++; console.log('CLEANUP RESIDUE like:', JSON.stringify(l)); }
      }
    } catch (e) { cleanupFails++; console.log('cleanup residue check (cascade fixtures) failed:', e.message); }
    // Verify against the manifest: nothing seeded may remain.
    try {
      const { data: residue } = await admin.from('contact_messages').select('id').in('id', ids.messages);
      if ((residue || []).length) { cleanupFails++; console.log('CLEANUP RESIDUE rows:', JSON.stringify(residue)); }
    } catch (e) { cleanupFails++; console.log('cleanup residue check failed:', e.message); }
    if (cleanupFails) console.log('CLEANUP RESIDUE — see /tmp/verify-account-delete-contact-manifest.json');
  }
  console.log(fails || cleanupFails ? (fails + cleanupFails) + ' FAILURE(S)' : 'ALL PASS');
  process.exit(fails || cleanupFails ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
