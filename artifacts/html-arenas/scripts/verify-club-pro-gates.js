// Production-style Club Pro entitlement verifier.
//
// Unlike the ordinary Replit workflow, this script spawns its own server with
// CLUB_PLAN_GATES_ENABLED=1. It proves the free/paid contract, admin/coach
// parity, live subscription transitions, and the locked dashboard UI without
// changing the development environment default.
//
// Run:
//   node artifacts/html-arenas/scripts/verify-club-pro-gates.js

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const PORT = 19923;
const BASE = `http://localhost:${PORT}/html`;
const MANIFEST = '/tmp/verify-club-pro-gates-manifest.json';
const PASSWORD = 'ClubProGateVerify!123';
const FIXTURE = 'Club Pro Gate Verify';
const emails = {
  admin: 'club-pro-gate-admin@arenas-test.dev',
  coach: 'club-pro-gate-coach@arenas-test.dev',
  member: 'club-pro-gate-member@arenas-test.dev'
};
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const records = [];
let failures = 0;
let spawned = null;

function check(name, condition, detail) {
  if (condition) console.log('  ok  ' + name);
  else {
    failures++;
    const suffix = detail == null ? '' : ' — ' +
      String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500);
    console.log('FAIL  ' + name + suffix);
  }
}

function saveManifest(entry) {
  records.push(entry);
  const tmp = MANIFEST + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ records }, null, 2));
  fs.renameSync(tmp, MANIFEST);
}

async function deleteUserRows(id) {
  const refs = [
    ['activity_likes', 'user_id'], ['post_likes', 'user_id'],
    ['post_comments', 'user_id'], ['posts', 'user_id'],
    ['follows', 'follower_id'], ['follows', 'following_id'],
    ['event_rsvps', 'user_id'], ['challenge_participants', 'user_id'],
    ['challenge_invites', 'invitee_id'], ['challenge_invites', 'inviter_id'],
    ['club_join_requests', 'user_id'], ['club_invites', 'invited_by'],
    ['notifications', 'actor_id'], ['notifications', 'user_id'],
    ['goals', 'user_id'], ['achievements', 'user_id'],
    ['planned_sessions', 'user_id'], ['contact_messages', 'user_id'],
    ['memberships', 'user_id'], ['activities', 'user_id'], ['profiles', 'id']
  ];
  for (const [table, column] of refs) await admin.from(table).delete().eq(column, id);
}

async function cleanup(entries) {
  const clubIds = [...new Set(entries.filter((r) => r.type === 'club').map((r) => r.id))];
  const userIds = [...new Set(entries.filter((r) => r.type === 'user').map((r) => r.id))];
  for (const clubId of clubIds) {
    await admin.from('notifications').delete().eq('entity_id', clubId);
    await admin.from('memberships').delete().eq('club_id', clubId);
    await admin.from('subscriptions').delete().eq('owner_type', 'club').eq('owner_id', clubId);
    await admin.from('clubs').delete().eq('id', clubId);
  }
  for (const userId of userIds) {
    await deleteUserRows(userId);
    await admin.auth.admin.deleteUser(userId);
  }
}

async function recoverStaleManifest() {
  if (!fs.existsSync(MANIFEST)) return;
  const stale = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  console.log('  ok  recovering stale manifest');
  await cleanup(Array.isArray(stale.records) ? stale.records : []);
  fs.rmSync(MANIFEST, { force: true });
}

async function preclean() {
  await admin.from('subscriptions').delete().like('stripe_customer_id', 'cus_club_pro_gate_verify%');
  const { data: clubs } = await admin.from('clubs').select('id').eq('name', FIXTURE);
  for (const club of clubs || []) {
    await admin.from('notifications').delete().eq('entity_id', club.id);
    await admin.from('memberships').delete().eq('club_id', club.id);
    await admin.from('subscriptions').delete().eq('owner_type', 'club').eq('owner_id', club.id);
    await admin.from('clubs').delete().eq('id', club.id);
  }
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of (data && data.users) || []) {
    if (!Object.values(emails).includes(user.email)) continue;
    await deleteUserRows(user.id);
    await admin.auth.admin.deleteUser(user.id);
  }
}

function spawnGatedServer() {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PORT: String(PORT),
      BASE_PATH: '/html',
      CLUB_PLAN_GATES_ENABLED: '1'
    };
    const proc = spawn('node', ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env
    });
    let output = '';
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (err) {}
      reject(new Error('gated server never listened: ' + output.slice(-1000)));
    }, 30000);
    const capture = (data) => {
      output += String(data);
      if (output.includes('Server listening')) {
        clearTimeout(timer);
        resolve({ proc, output: () => output });
      }
    };
    proc.stdout.on('data', capture);
    proc.stderr.on('data', capture);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (!output.includes('Server listening')) reject(new Error('gated server exited ' + code + ': ' + output.slice(-1000)));
    });
  });
}

async function createUser(key, name) {
  const { data, error } = await admin.auth.admin.createUser({
    email: emails[key],
    password: PASSWORD,
    email_confirm: true,
    user_metadata: {
      name,
      handle: 'cpg_' + key,
      timezone: 'America/Los_Angeles',
      sports: ['running']
    }
  });
  if (error) throw error;
  saveManifest({ type: 'user', id: data.user.id, email: emails[key] });
  return data.user.id;
}

async function login(email) {
  const response = await fetch(BASE + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
    redirect: 'manual'
  });
  const cookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  if (!cookie) throw new Error('login failed for ' + email);
  return cookie;
}

async function request(cookie, method, pathname, body) {
  const response = await fetch(BASE + pathname, {
    method,
    redirect: 'manual',
    headers: {
      Cookie: cookie,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const raw = await response.text();
  let json = null;
  try { json = JSON.parse(raw); } catch (err) {}
  return { status: response.status, body: json, raw };
}

const features = (clubId, targetId) => [
  {
    name: 'training-load',
    feature: 'club_training_load',
    method: 'GET',
    path: `/api/clubs/${clubId}/training-load`
  },
  {
    name: 'check-in',
    feature: 'club_training_load',
    method: 'POST',
    path: `/api/clubs/${clubId}/checkin`,
    body: { userId: targetId }
  },
  {
    name: 'at-risk nudge',
    feature: 'club_at_risk',
    method: 'POST',
    path: `/api/clubs/${clubId}/nudge-atrisk`
  },
  {
    name: 'report',
    feature: 'club_report',
    method: 'GET',
    path: `/api/clubs/${clubId}/report`
  }
];

async function expectLocked(cookie, clubId, targetId, label) {
  for (const item of features(clubId, targetId)) {
    const result = await request(cookie, item.method, item.path, item.body);
    const expected = {
      error: 'club_pro_required',
      feature: item.feature,
      upgrade: '/billing'
    };
    check(`${label}: ${item.name} has exact Club Pro refusal`,
      result.status === 403 && JSON.stringify(result.body) === JSON.stringify(expected),
      { status: result.status, body: result.body });
  }
}

async function expectUnlocked(cookie, clubId, targetId, label) {
  for (const item of features(clubId, targetId)) {
    const result = await request(cookie, item.method, item.path, item.body);
    check(`${label}: ${item.name} is entitled`,
      result.status === 200 && result.body && !result.body.error,
      { status: result.status, body: result.body });
  }
}

function parseArenasData(html) {
  const match = html.match(/window\.ARENAS_DATA\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
  return match ? JSON.parse(match[1]) : null;
}

async function verifyLockedUi(cookie, clubId, memberName) {
  const pageResponse = await request(cookie, 'GET', `/clubs/dashboard?club=${clubId}`);
  const injected = parseArenasData(pageResponse.raw);
  check('free dashboard injects clubProLocked=true',
    pageResponse.status === 200 && injected && injected.gating &&
    injected.gating.clubProLocked === true,
    injected && injected.gating);

  const { chromium } = await import('playwright-core');
  const executablePath = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    execSync('command -v chromium || command -v chromium-browser').toString().trim();
  const browser = await chromium.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.setExtraHTTPHeaders({ Cookie: cookie });
    const page = await context.newPage();
    const requests = [];
    const errors = [];
    page.on('request', (req) => {
      const pathname = new URL(req.url()).pathname;
      if (/\/api\/clubs\/[^/]+\/(training-load|report)/.test(pathname)) requests.push(pathname);
    });
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(BASE + `/clubs/dashboard?club=${clubId}`, { waitUntil: 'networkidle' });
    check('locked Overview makes no training-load request',
      !requests.some((pathname) => pathname.endsWith('/training-load')),
      requests);
    const overview = await page.evaluate((name) => ({
      locked: window.ARENAS_DATA && window.ARENAS_DATA.gating &&
        window.ARENAS_DATA.gating.clubProLocked,
      attentionText: document.getElementById('ov-attention-items')?.textContent || '',
      inactiveNames: (window._ovInactiveMembers || []).map((member) => member.name),
      memberExposed: document.getElementById('ov-attention-items')?.textContent.includes(name) || false
    }), memberName);
    check('locked Overview exposes no named at-risk/training member',
      overview.locked === true && !overview.memberExposed &&
      overview.inactiveNames.length === 0,
      overview);

    await page.evaluate(() => setTab('training', document.querySelector('[onclick*="training"]')));
    await page.waitForFunction(() => document.body.textContent.includes('Training load is a Club Pro feature'));
    check('Training load renders locked panel copy',
      await page.locator('#tab-training').getByText('Training load is a Club Pro feature', { exact: true }).count() === 1);

    await page.evaluate(() => setTab('reports', document.querySelector('[onclick*="reports"]')));
    await page.waitForFunction(() => document.body.textContent.includes('Club reports are a Club Pro feature'));
    check('Reports renders locked panel copy',
      await page.locator('#tab-reports').getByText('Club reports are a Club Pro feature', { exact: true }).count() === 1);
    check('locked tabs make no gated data requests',
      !requests.some((pathname) => pathname.endsWith('/training-load') || pathname.endsWith('/report')),
      requests);
    check('locked dashboard renders without browser errors before bypass probe',
      errors.length === 0, errors);

    const bypass = await page.evaluate(async (id) => {
      const response = await fetch((window.BASE || '') + `/api/clubs/${id}/training-load`);
      return { status: response.status, body: await response.json() };
    }, clubId);
    check('locked UI cannot bypass gate with direct authenticated API call',
      bypass.status === 403 && bypass.body &&
      bypass.body.error === 'club_pro_required' &&
      bypass.body.feature === 'club_training_load',
      bypass);
    check('direct bypass produces no unexpected browser errors',
      errors.every((message) => message.includes('403 (Forbidden)')), errors);
  } finally {
    await browser.close();
  }
}

async function verifyClean() {
  const { data: clubs } = await admin.from('clubs').select('id').eq('name', FIXTURE);
  const { data: authData } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const leftovers = ((authData && authData.users) || []).filter((user) =>
    Object.values(emails).includes(user.email));
  const { data: subs } = await admin.from('subscriptions').select('id')
    .like('stripe_customer_id', 'cus_club_pro_gate_verify%');
  check('cleanup: fixture clubs absent', (clubs || []).length === 0, clubs);
  check('cleanup: fixture users absent', leftovers.length === 0, leftovers.map((user) => user.email));
  check('cleanup: fixture subscriptions absent', (subs || []).length === 0, subs);
}

(async () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  try {
    await recoverStaleManifest();
    await preclean();
    spawned = await spawnGatedServer();
    check('spawned server is explicitly production-gated', true);

    const users = {
      admin: await createUser('admin', 'Gate Verify Admin'),
      coach: await createUser('coach', 'Gate Verify Coach'),
      member: await createUser('member', 'Gate Verify Named Member')
    };
    const { data: club, error: clubError } = await admin.from('clubs').insert({
      name: FIXTURE,
      handle: 'club-pro-gate-verify',
      sport: 'running',
      owner_id: users.admin
    }).select('id').single();
    if (clubError) throw clubError;
    saveManifest({ type: 'club', id: club.id });
    const { error: membershipError } = await admin.from('memberships').insert([
      { user_id: users.admin, club_id: club.id, role: 'admin' },
      { user_id: users.coach, club_id: club.id, role: 'coach' },
      { user_id: users.member, club_id: club.id, role: 'member' }
    ]);
    if (membershipError) throw membershipError;

    const cookies = {
      admin: await login(emails.admin),
      coach: await login(emails.coach)
    };

    // Free state: exact API contract plus server/browser lock behavior.
    await expectLocked(cookies.admin, club.id, users.member, 'free admin');
    await expectLocked(cookies.coach, club.id, users.member, 'free coach');
    await verifyLockedUi(cookies.admin, club.id, 'Gate Verify Named Member');

    // The same running server and same club become entitled only after this row
    // appears, proving the gate is connected to the live subscription lookup.
    const { data: subscription, error: subscriptionError } = await admin.from('subscriptions').insert({
      owner_type: 'club',
      owner_id: club.id,
      plan: 'club_pro',
      status: 'active',
      stripe_customer_id: 'cus_club_pro_gate_verify',
      stripe_subscription_id: 'sub_club_pro_gate_verify'
    }).select('id').single();
    if (subscriptionError) throw subscriptionError;
    saveManifest({ type: 'subscription', id: subscription.id });
    await expectUnlocked(cookies.admin, club.id, users.member, 'active subscription admin');
    await expectUnlocked(cookies.coach, club.id, users.member, 'active subscription coach');
    const unlockedPage = await request(cookies.admin, 'GET', `/clubs/dashboard?club=${club.id}`);
    const unlockedData = parseArenasData(unlockedPage.raw);
    check('same club dashboard transitions from locked to unlocked',
      unlockedPage.status === 200 && unlockedData && unlockedData.gating &&
      unlockedData.gating.clubProLocked === false,
      unlockedData && unlockedData.gating);

    const { error: cancelError } = await admin.from('subscriptions')
      .update({ status: 'canceled' }).eq('id', subscription.id);
    if (cancelError) throw cancelError;
    await expectLocked(cookies.admin, club.id, users.member, 'cancelled subscription');

    const { error: invalidError } = await admin.from('subscriptions')
      .update({ status: 'incomplete', plan: 'club_pro' }).eq('id', subscription.id);
    if (invalidError) throw invalidError;
    await expectLocked(cookies.admin, club.id, users.member, 'invalid subscription');
  } catch (err) {
    failures++;
    console.log('FAIL  fatal — ' + err.message);
    if (spawned) console.log(spawned.output().slice(-1500));
  } finally {
    if (spawned) {
      try { spawned.proc.kill('SIGKILL'); } catch (err) {}
    }
    try {
      await cleanup(records.slice());
      fs.rmSync(MANIFEST, { force: true });
      await verifyClean();
    } catch (err) {
      failures++;
      console.log('FAIL  cleanup — ' + err.message);
    }
    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
    process.exit(failures ? 1 : 0);
  }
})();