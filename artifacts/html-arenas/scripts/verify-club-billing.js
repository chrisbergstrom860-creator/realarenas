// Verify: club billing (Club Pro checkout + Stripe portal) is admin-or-owner,
// NOT manager-level — Task #79. No existing verifier covered the billing
// routes at all (verify-club-delete only proves subscription teardown), so
// this is the dedicated billing-authority verifier.
//
// Proves, without creating any real Stripe object:
//   1. A coach is refused on club checkout AND club portal — 403 with the
//      explanatory refusal copy — with zero effect (subscriptions unchanged).
//   2. A plain member gets the same 403.
//   3. An admin passes the guard: checkout on an already-Pro club → 409
//      "already subscribed" (guard passed, no Stripe call); portal on a
//      sub-less club → 404 "No subscription found for this club".
//   4. An owner who SELF-DEMOTED below admin (membership role 'member')
//      still passes both guards the same way.
//   5. A coach can still USE a Pro feature on a Pro club: GET
//      /api/clubs/:id/training-load → 200 (plan gates read the club plan,
//      never the caller's billing authority).
//   6. The /billing page is server-decided: coach sees managedClubs [] (no
//      upgrade/portal controls at all); admin sees both clubs; demoted owner
//      sees both with role 'owner'.
//   7. No-id checkout (marketing CTA route) for a coach-only user →
//      {redirect:'/for-clubs'}, never a club they merely coach.
//
// Seeds: club "Billing Verify Pro Club" (fake active club_pro row with dummy
// Stripe ids — never touches real Stripe) + "Billing Verify Free Club", both
// owned by the demoted owner; one admin; one coach; one member. Cleans up.
//
// Run with the dev server up: node artifacts/html-arenas/scripts/verify-club-billing.js

const { createClient } = require('@supabase/supabase-js');

const BASE_URL = 'http://localhost:80/html';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const REFUSAL = 'Only a club admin or the club owner can manage this club\u2019s billing. ' +
  'Coaches can use Club Pro features, but only an admin or the owner can start or change the subscription.';

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

async function post(pathname, cookie) {
  const r = await fetch(BASE_URL + pathname, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: '{}'
  });
  let body = null;
  try { body = await r.json(); } catch (e) { /* non-JSON */ }
  return { status: r.status, body };
}

async function getBillingData(cookie) {
  const r = await fetch(BASE_URL + '/billing', { headers: { cookie } });
  const html = await r.text();
  const m = html.match(/window\.ARENAS_DATA\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
  if (!m) return { status: r.status, billing: null };
  try { return { status: r.status, billing: JSON.parse(m[1]).billing }; }
  catch (e) { return { status: r.status, billing: null }; }
}

(async () => {
  const password = 'Billingcheck!12345';
  const emails = {
    owner: 'billing-verify-owner@arenas-test.dev',
    admin: 'billing-verify-admin@arenas-test.dev',
    coach: 'billing-verify-coach@arenas-test.dev',
    member: 'billing-verify-member@arenas-test.dev'
  };
  const proClubName = 'Billing Verify Pro Club';
  const freeClubName = 'Billing Verify Free Club';

  for (const e of Object.values(emails)) await deleteUserByEmail(e);
  await admin.from('subscriptions').delete().eq('stripe_customer_id', 'cus_billing_verify_fake');
  await admin.from('clubs').delete().in('name', [proClubName, freeClubName]);

  const mk = (email, name, handle) => admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { name, handle }
  });
  const users = {};
  for (const [k, email] of Object.entries(emails)) {
    const { data, error } = await mk(email, 'Billing ' + k, 'billv' + k);
    if (error) { check('create user ' + k, false, error.message); process.exit(1); }
    users[k] = data.user.id;
  }

  let proClubId = null, freeClubId = null;
  try {
    const mkClub = (name, handle) => admin.from('clubs')
      .insert({ name, handle, sport: 'running', owner_id: users.owner }).select().single();
    const { data: proClub, error: e1 } = await mkClub(proClubName, 'billing-verify-pro');
    const { data: freeClub, error: e2 } = await mkClub(freeClubName, 'billing-verify-free');
    if (e1 || e2) { check('create clubs', false, (e1 || e2).message); throw new Error('setup'); }
    proClubId = proClub.id; freeClubId = freeClub.id;

    // Owner SELF-DEMOTED below admin (role 'member') in both clubs.
    const { error: mErr } = await admin.from('memberships').insert([
      { user_id: users.owner, club_id: proClubId, role: 'member' },
      { user_id: users.owner, club_id: freeClubId, role: 'member' },
      { user_id: users.admin, club_id: proClubId, role: 'admin' },
      { user_id: users.admin, club_id: freeClubId, role: 'admin' },
      { user_id: users.coach, club_id: proClubId, role: 'coach' },
      { user_id: users.coach, club_id: freeClubId, role: 'coach' },
      { user_id: users.member, club_id: proClubId, role: 'member' }
    ]);
    if (mErr) { check('create memberships', false, mErr.message); throw new Error('setup'); }

    // Fake active club_pro sub for the pro club (dummy ids; NOT NULL columns).
    const { error: sErr } = await admin.from('subscriptions').insert({
      owner_type: 'club', owner_id: proClubId, plan: 'club_pro', status: 'active',
      stripe_customer_id: 'cus_billing_verify_fake',
      stripe_subscription_id: 'sub_billing_verify_fake'
    });
    if (sErr) { check('create fake sub', false, sErr.message); throw new Error('setup'); }

    const cookies = {};
    for (const [k, email] of Object.entries(emails)) {
      cookies[k] = await login(email, password);
      check('login ' + k, !!cookies[k]);
    }

    const subsSnapshot = async () => {
      const { data } = await admin.from('subscriptions').select('id, status, plan')
        .in('owner_id', [proClubId, freeClubId]);
      return JSON.stringify((data || []).sort((a, b) => a.id < b.id ? -1 : 1));
    };
    const before = await subsSnapshot();

    // 1+2. Coach and member refused on checkout + portal, both clubs' worth.
    for (const who of ['coach', 'member']) {
      const co = await post('/api/billing/checkout/club/' + freeClubId, cookies[who]);
      check(who + ' checkout → 403', co.status === 403, 'got ' + co.status);
      check(who + ' checkout refusal copy', co.body && co.body.error === REFUSAL,
        JSON.stringify(co.body));
      const po = await post('/api/billing/portal/club/' + proClubId, cookies[who]);
      check(who + ' portal → 403', po.status === 403, 'got ' + po.status);
      check(who + ' portal refusal copy', po.body && po.body.error === REFUSAL,
        JSON.stringify(po.body));
    }
    check('refusals had zero effect on subscriptions', (await subsSnapshot()) === before);

    // 3+4. Admin and demoted owner pass the guard.
    for (const who of ['admin', 'owner']) {
      const co = await post('/api/billing/checkout/club/' + proClubId, cookies[who]);
      check(who + ' checkout passes guard (409 already subscribed)',
        co.status === 409 && co.body && co.body.error === 'already subscribed',
        co.status + ' ' + JSON.stringify(co.body));
      const po = await post('/api/billing/portal/club/' + freeClubId, cookies[who]);
      check(who + ' portal passes guard (404 no sub)',
        po.status === 404 && po.body && /No subscription found/.test(po.body.error || ''),
        po.status + ' ' + JSON.stringify(po.body));
    }

    // 5. Coach still USES a Pro feature on the Pro club.
    const tl = await fetch(BASE_URL + '/api/clubs/' + proClubId + '/training-load',
      { headers: { cookie: cookies.coach } });
    check('coach training-load on Pro club → 200', tl.status === 200, 'got ' + tl.status);

    // 6. /billing page is server-decided per role.
    const coachPage = await getBillingData(cookies.coach);
    check('coach /billing renders', coachPage.status === 200 && !!coachPage.billing);
    check('coach sees NO club billing cards',
      coachPage.billing && Array.isArray(coachPage.billing.managedClubs) &&
      coachPage.billing.managedClubs.length === 0,
      JSON.stringify(coachPage.billing && coachPage.billing.managedClubs));
    const adminPage = await getBillingData(cookies.admin);
    const adminIds = ((adminPage.billing || {}).managedClubs || []).map(c => c.id).sort();
    check('admin sees both clubs', JSON.stringify(adminIds) === JSON.stringify([proClubId, freeClubId].sort()),
      JSON.stringify(adminIds));
    const ownerPage = await getBillingData(cookies.owner);
    const ownerRows = (ownerPage.billing || {}).managedClubs || [];
    check('demoted owner sees both clubs as owner',
      ownerRows.length === 2 && ownerRows.every(c => c.role === 'owner'),
      JSON.stringify(ownerRows));
    const memberPage = await getBillingData(cookies.member);
    check('plain member sees NO club billing cards',
      memberPage.billing && memberPage.billing.managedClubs.length === 0);

    // 7. No-id checkout: coach-only caller is routed to club creation, never
    // billed for a club they merely coach.
    const auto = await post('/api/billing/checkout/club', cookies.coach);
    check('coach no-id checkout → redirect /for-clubs',
      auto.status === 200 && auto.body && auto.body.redirect === '/html/for-clubs',
      auto.status + ' ' + JSON.stringify(auto.body));
  } catch (err) {
    if (err.message !== 'setup') { failures++; console.log('FAIL  unexpected: ' + err.message); }
  } finally {
    await admin.from('subscriptions').delete().eq('stripe_customer_id', 'cus_billing_verify_fake');
    if (proClubId) await admin.from('memberships').delete().eq('club_id', proClubId);
    if (freeClubId) await admin.from('memberships').delete().eq('club_id', freeClubId);
    await admin.from('clubs').delete().in('name', [proClubName, freeClubName]);
    for (const e of Object.values(emails)) await deleteUserByEmail(e);
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
