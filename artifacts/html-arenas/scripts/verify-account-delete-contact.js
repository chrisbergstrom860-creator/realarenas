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
    for (const id of ids.users) {
      try {
        const { data } = await admin.auth.admin.getUserById(id);
        if (data && data.user) await admin.auth.admin.deleteUser(id);
      } catch (e) { /* already gone — expected */ }
    }
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
