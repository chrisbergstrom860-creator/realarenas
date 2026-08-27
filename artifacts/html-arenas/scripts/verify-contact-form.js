// Pins the /contact form's honesty and leak boundaries:
//   1. The served page (both chrome variants) and its inline JS never contain
//      the CONTACT_INBOX address or the retired support@realarenas.com.
//   2. Neither success nor failure API responses leak the inbox.
//   3. Server-side validation rejects empty and oversized fields (reject, not
//      truncate).
//   4. The honeypot silently discards: success-shaped response, no row stored.
//   5. With RESEND_API_KEY absent the endpoint returns a REAL failure (never
//      false success) and the row is recorded as failed_config — proven on a
//      spawned server instance with the key stripped from its env.
//   6. Per-IP rate limiting: 6th hit inside the window is 429 (spawned server,
//      so the live limiter map is never polluted).
//   7. Logged-in prefill: session email injected + "Back to app" chrome; the
//      raw file's null sentinel replaced.
// No support address may ever reappear in served HTML/JS — grep-level guard
// included for every marketing/legal page footer.
const { spawn } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BASE = 'http://localhost:80/html';
const PW = 'Probe-1234!';
const INBOX = process.env.CONTACT_INBOX || '';
let fails = 0, cleanupFails = 0;
const ok = (c, l, x) => { console.log((c ? '  ok  ' : '  FAIL ') + l + (x ? ' — ' + x : '')); if (!c) fails++; };
const noLeak = (s, label) => ok(!(INBOX && String(s).includes(INBOX)) && !String(s).includes('support@realarenas'), label + ' contains no inbox address');

const FIXTURE_EMAIL = 'contact-form-verify@arenas-test.dev';
const MANIFEST_PATH = '/tmp/verify-contact-form-manifest.json';
const manifest = {
  users: [],
  messages: [],
  messageEmails: ['verify-nokey@arenas-test.dev', 'hp@spam.dev', 'a@b.co'],
  preexistingMessageIds: []
};
const saveManifest = () => fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
const cleanupOk = (condition, label, detail) => {
  console.log((condition ? '  CLEAN ' : '  CLEANUP FAIL ') + label + (detail ? ' — ' + detail : ''));
  if (!condition) cleanupFails++;
};
async function precleanFixtureUser() {
  try {
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
    const stale = (data.users || []).find((u) => u.email === FIXTURE_EMAIL);
    if (stale) { await admin.auth.admin.deleteUser(stale.id); console.log('  info: pre-cleaned stale fixture user'); }
  } catch (e) { console.log('  info: fixture pre-clean skipped —', e.message); }
}

async function login(email) {
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password: PW }), redirect: 'manual',
  });
  const raw = r.headers.getSetCookie();
  if (!raw.length) throw new Error('login failed');
  return raw.map((c) => c.split(';')[0]).join('; ');
}

const post = (base, body, headers) => fetch(base + '/api/contact', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(headers || {}) }, body: JSON.stringify(body),
});

// Spawn a second server instance with RESEND_API_KEY stripped (and a fresh
// rate-limiter map). Returns { proc, base } once it's listening.
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

(async () => {
  let spawned = null;
  try {
    const baselineMessages = await admin.from('contact_messages').select('id').in('from_email', manifest.messageEmails);
    if (baselineMessages.error) throw baselineMessages.error;
    manifest.preexistingMessageIds = (baselineMessages.data || []).map((row) => row.id);
    saveManifest();

    // ── 1. Served pages leak nothing ──
    const loggedOut = await (await fetch(BASE + '/contact')).text();
    noLeak(loggedOut, 'logged-out /contact HTML+JS');
    ok(loggedOut.includes('window.ARENAS_CONTACT_EMAIL = null;'), 'logged-out page keeps the null prefill sentinel');
    ok(loggedOut.includes('Sign up free'), 'logged-out page shows marketing chrome');
    for (const p of ['/landing', '/about', '/terms', '/privacy', '/how-points-work', '/for-clubs']) {
      const html = await (await fetch(BASE + p)).text();
      ok(!html.includes('mailto:') && !html.includes('support@realarenas'), `${p} has no mailto/support address`);
    }

    // ── 7. Logged-in prefill ──
    await precleanFixtureUser();
    const { data: ud, error: ue } = await admin.auth.admin.createUser({
      email: FIXTURE_EMAIL, password: PW, email_confirm: true,
      user_metadata: { name: 'Contact Verify', sports: ['running'] },
    });
    if (ue) throw ue;
    manifest.users.push({ id: ud.user.id, email: FIXTURE_EMAIL }); saveManifest();
    const cookie = await login(FIXTURE_EMAIL);
    const loggedIn = await (await fetch(BASE + '/contact', { headers: { Cookie: cookie } })).text();
    ok(loggedIn.includes('window.ARENAS_CONTACT_EMAIL = ' + JSON.stringify(FIXTURE_EMAIL)), 'logged-in page injects session email for prefill');
    ok(loggedIn.includes('Back to app'), 'logged-in page shows app chrome');
    noLeak(loggedIn, 'logged-in /contact HTML+JS');

    // ── 3. Validation rejects (reject, not truncate) ──
    // Run against spawn A (raised limiter cap + no RESEND key) so validation
    // cases can't trip the live server's per-IP limiter or send real mail.
    spawned = await spawnNoKeyServer(19917, { CONTACT_RATE_MAX: '100' });
    const cases = [
      [{ email: 'not-an-email', subject: 's', message: 'm' }, 'invalid email'],
      [{ email: 'a@b.co', subject: '', message: 'm' }, 'empty subject'],
      [{ email: 'a@b.co', subject: '   ', message: 'm' }, 'whitespace subject'],
      [{ email: 'a@b.co', subject: 's', message: '' }, 'empty message'],
      [{ email: 'a@b.co', subject: 'x'.repeat(201), message: 'm' }, 'oversized subject (201)'],
      [{ email: 'a@b.co', subject: 's', message: 'x'.repeat(5001) }, 'oversized message (5001)'],
    ];
    for (const [body, label] of cases) {
      const r = await post(spawned.base, body);
      const j = await r.text();
      ok(r.status === 400, `rejects ${label} with 400`, 'got ' + r.status);
      noLeak(j, `${label} error response`);
    }

    // ── 4. Honeypot discards silently ──
    const before = await admin.from('contact_messages').select('id', { count: 'exact', head: true });
    const hp = await post(spawned.base, { email: 'hp@spam.dev', subject: 'spam', message: 'spam', website: 'http://spam' });
    const hpBody = await hp.text();
    ok(hp.status === 200 && JSON.parse(hpBody).ok === true, 'honeypot response is success-shaped (reveals nothing)');
    noLeak(hpBody, 'honeypot response');
    const after = await admin.from('contact_messages').select('id', { count: 'exact', head: true });
    ok(after.count === before.count, 'honeypot stored no row', `${before.count} -> ${after.count}`);

    // ── 5. Missing RESEND_API_KEY = real failure (still on spawn A) ──
    const real = await post(spawned.base, { email: 'verify-nokey@arenas-test.dev', subject: 'No-key honesty check', message: 'Must fail, not fake success.' });
    const realBody = await real.text();
    ok(real.status >= 500, 'missing RESEND_API_KEY yields failure status, never false success', 'got ' + real.status);
    ok(!JSON.parse(realBody).ok, 'failure body carries no ok:true');
    noLeak(realBody, 'no-key failure response');
    const { data: rec } = await admin.from('contact_messages').select('id, send_status').eq('from_email', 'verify-nokey@arenas-test.dev').order('created_at', { ascending: false }).limit(1);
    ok(rec && rec.length === 1 && rec[0].send_status === 'failed_config', 'message still recorded with send_status failed_config', rec && rec[0] && rec[0].send_status);
    if (rec && rec[0]) {
      manifest.messages.push({ id: rec[0].id, from_email: 'verify-nokey@arenas-test.dev' });
      saveManifest();
    }
    try { spawned.proc.kill('SIGKILL'); } catch (e) { /* ignore */ }
    spawned = null;

    // ── 6. Rate limit: spawn B with the DEFAULT cap (5) and a fresh map ──
    spawned = await spawnNoKeyServer(19918);
    // 5 invalid posts consume the window (limiter runs before validation, so
    // the 400s store nothing); the 6th hit must be 429.
    for (let i = 0; i < 5; i++) await post(spawned.base, { email: 'bad', subject: '', message: '' });
    const sixth = await post(spawned.base, { email: 'a@b.co', subject: 's', message: 'm' });
    const sixthBody = await sixth.text();
    ok(sixth.status === 429, '6th hit from one IP inside the window is 429', 'got ' + sixth.status);
    noLeak(sixthBody, 'rate-limit response');
    // Forwarded-IP isolation: trust proxy = 1 hop, so distinct X-Forwarded-For
    // clients must get distinct buckets — a different forwarded IP is NOT 429
    // even though the exhausted one still is.
    const otherIp = await post(spawned.base, { email: 'bad', subject: '', message: '' }, { 'X-Forwarded-For': '203.0.113.77' });
    ok(otherIp.status === 400, 'different forwarded client IP gets its own bucket (400, not 429)', 'got ' + otherIp.status);
    const sameIp = await post(spawned.base, { email: 'a@b.co', subject: 's', message: 'm' });
    ok(sameIp.status === 429, 'exhausted IP stays rate-limited', 'got ' + sameIp.status);
  } finally {
    if (spawned) { try { spawned.proc.kill('SIGKILL'); } catch (e) { /* already dead */ } }
    const leaveOne = process.env.VERIFY_CLEANUP_LEAVE_ONE === 'contact-message';
    try {
      const generated = await admin.from('contact_messages').select('id,from_email')
        .in('from_email', manifest.messageEmails);
      cleanupOk(!generated.error, 'capture generated contact messages', generated.error && generated.error.message);
      if (!generated.error) {
        const baseline = new Set(manifest.preexistingMessageIds);
        for (const row of generated.data || []) {
          if (!baseline.has(row.id) && !manifest.messages.some((item) => item.id === row.id)) {
            manifest.messages.push(row);
          }
        }
        saveManifest();
      }
    } catch (e) {
      cleanupOk(false, 'capture generated contact messages', e.message);
    }
    for (const row of manifest.messages) {
      if (leaveOne && row.id === manifest.messages[0]?.id) {
        console.log('  FAULT INJECTION deliberately retaining contact message ' + row.id);
        continue;
      }
      try {
        const { error } = await admin.from('contact_messages').delete().eq('id', row.id);
        cleanupOk(!error, 'delete contact message ' + row.id, error && error.message);
      } catch (e) { cleanupOk(false, 'delete contact message ' + row.id, e.message); }
    }
    for (const row of manifest.users) {
      try {
        const deleted = await admin.auth.admin.deleteUser(row.id);
        cleanupOk(!deleted.error, 'delete auth user ' + row.email, deleted.error && deleted.error.message);
      } catch (e) { cleanupOk(false, 'delete auth user ' + row.email, e.message); }
    }
    try {
      const messageIds = manifest.messages.map((row) => row.id);
      const byId = messageIds.length
        ? await admin.from('contact_messages').select('id,from_email').in('id', messageIds)
        : { data: [], error: null };
      cleanupOk(!byId.error && !(byId.data || []).length,
        'manifest contact messages absent', byId.error ? byId.error.message : JSON.stringify(byId.data || []));
      const byEmail = await admin.from('contact_messages').select('id,from_email').in('from_email', manifest.messageEmails);
      const unexpected = (byEmail.data || []).filter((row) => !manifest.preexistingMessageIds.includes(row.id));
      cleanupOk(!byEmail.error && !unexpected.length,
        'contact-message set restored to pre-run baseline',
        byEmail.error ? byEmail.error.message : JSON.stringify(unexpected));
      if (leaveOne && manifest.messages.length) {
        const retainedId = manifest.messages[0].id;
        const remediated = await admin.from('contact_messages').delete().eq('id', retainedId);
        cleanupOk(!remediated.error, 'fault-injected contact message remediation',
          remediated.error && remediated.error.message);
      }
    } catch (e) {
      cleanupOk(false, 'contact-message residue query', e.message);
    }
    try {
      const authRows = [];
      for (let page = 1; ; page++) {
        const listed = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (listed.error) throw listed.error;
        authRows.push(...listed.data.users);
        if (listed.data.users.length < 200) break;
      }
      const userIds = manifest.users.map((row) => row.id);
      const authResidue = authRows.filter((row) =>
        userIds.includes(row.id) || manifest.users.some((item) => item.email === row.email));
      cleanupOk(authResidue.length === 0, 'manifest auth users absent',
        JSON.stringify(authResidue.map((row) => ({ id: row.id, email: row.email }))));
    } catch (e) {
      cleanupOk(false, 'auth-user residue query', e.message);
    }
    if (cleanupFails) console.log('CLEANUP RESIDUE — see ' + MANIFEST_PATH);
  }
  console.log(fails || cleanupFails ? (fails + cleanupFails) + ' FAILURE(S)' : 'ALL PASS');
  process.exit(fails || cleanupFails ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
