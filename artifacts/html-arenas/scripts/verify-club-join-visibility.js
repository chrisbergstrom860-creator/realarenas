// Club-join manager-visibility verification.
// Proves:
// - compact directory and public-profile disclosures for free + Club Pro
// - full invite acceptance disclosure for free + Club Pro
// - approval resolves plan at approval time (request free, upgrade, approve)
// - invite correction: no notification when unchanged; exactly one for
//   free→Pro and Pro→free between page render and acceptance
// - screenshots at 1280 and 380 for directory cards, public profiles, and
//   invite acceptance pages
// - standard manifest cleanup

const crypto = require('crypto');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const BASE = 'http://localhost:80/html';
const PASSWORD = 'JoinVisibility!234';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const nonce = Date.now().toString(36);
const screenshots = 'screenshots';
const emails = {
  owner: `joinvis-owner-${nonce}@arenas-test.dev`,
  requester: `joinvis-requester-${nonce}@arenas-test.dev`,
  freeSame: `joinvis-free-same-${nonce}@arenas-test.dev`,
  proSame: `joinvis-pro-same-${nonce}@arenas-test.dev`,
  freeToPro: `joinvis-free-pro-${nonce}@arenas-test.dev`,
  proToFree: `joinvis-pro-free-${nonce}@arenas-test.dev`
};

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else {
    failures++;
    console.log('FAIL  ' + name + (detail ? ' — ' + String(detail).slice(0, 500) : ''));
  }
}

function injected(html, name) {
  const marker = 'window.' + name + ' = ';
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const jsonStart = start + marker.length;
  const end = html.indexOf(';</script>', jsonStart);
  if (end < 0) return null;
  try { return JSON.parse(html.slice(jsonStart, end)); } catch (err) { return null; }
}

async function makeUser(key, name) {
  const { data, error } = await admin.auth.admin.createUser({
    email: emails[key],
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name, handle: `joinvis_${key}_${nonce}`, timezone: 'UTC' }
  });
  if (error) throw error;
  return data.user;
}

async function login(email) {
  const response = await fetch(BASE + '/auth/login', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(PASSWORD)}`
  });
  const raw = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')];
  const cookieHeader = (raw || []).filter(Boolean).map(value => String(value).split(';')[0]).join('; ');
  const browserCookies = (raw || []).filter(Boolean).map(value => {
    const pair = String(value).split(';')[0];
    const split = pair.indexOf('=');
    return { name: pair.slice(0, split), value: pair.slice(split + 1), url: 'http://localhost:80' };
  });
  if (response.status !== 302 || !cookieHeader) throw new Error('login failed for ' + email);
  return { cookieHeader, browserCookies };
}

async function createClub(ownerId, name, handle) {
  const { data, error } = await admin.from('clubs').insert({
    owner_id: ownerId,
    name,
    handle,
    sport: 'running',
    city: 'Portland',
    headline: 'Weekly sessions for every pace',
    description: 'A compact public club profile used to verify join visibility.',
    visibility: 'public'
  }).select('id').single();
  if (error) throw error;
  const { error: membershipError } = await admin.from('memberships').insert({
    user_id: ownerId,
    club_id: data.id,
    role: 'admin'
  });
  if (membershipError) throw membershipError;
  return data.id;
}

async function setClubPro(clubId, enabled) {
  await admin.from('subscriptions').delete().eq('owner_type', 'club').eq('owner_id', clubId);
  if (!enabled) return;
  const suffix = clubId.replace(/-/g, '').slice(0, 20);
  const { error } = await admin.from('subscriptions').insert({
    owner_type: 'club',
    owner_id: clubId,
    plan: 'club_pro',
    status: 'active',
    stripe_customer_id: 'cus_joinvis_' + suffix,
    stripe_subscription_id: 'sub_joinvis_' + suffix,
    ever_paid: true,
    last_paid_subscription_id: 'sub_joinvis_' + suffix,
    cancel_at_period_end: false
  });
  if (error) throw error;
}

async function seedInvite(clubId, ownerId, email) {
  const token = crypto.randomBytes(32).toString('hex');
  const { data, error } = await admin.from('club_invites').insert({
    club_id: clubId,
    invited_by: ownerId,
    email,
    role: 'member',
    token,
    status: 'pending',
    expires_at: new Date(Date.now() + 14 * 864e5).toISOString()
  }).select('id').single();
  if (error) throw error;
  return { id: data.id, token };
}

async function joinPage(token) {
  const response = await fetch(BASE + '/join/' + token);
  const html = await response.text();
  return { status: response.status, html, data: injected(html, 'JOIN_DATA') };
}

async function acceptInvite(token, loginState, rendered) {
  const response = await fetch(BASE + '/auth/join/' + token + '/existing', {
    method: 'POST',
    headers: { Cookie: loginState.cookieHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      renderedPlan: rendered.plan,
      renderedPlanProof: rendered.planProof
    })
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function correctiveRows(userId) {
  const { data, error } = await admin.from('notifications')
    .select('title, body, link, source_key')
    .eq('user_id', userId)
    .like('source_key', 'invite-plan-change:%');
  if (error) throw error;
  return data || [];
}

async function screenshotSurface(browser, options) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: options.width, height: options.width === 380 ? 900 : 1000 }
  });
  if (options.cookies) await context.addCookies(options.cookies);
  const page = await context.newPage();
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(BASE + options.path, { waitUntil: 'networkidle' });
  const locator = page.locator(options.selector);
  await locator.waitFor({ state: 'visible' });
  await locator.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await page.waitForTimeout(100);
  const text = (await locator.innerText()).replace(/\s+/g, ' ').trim();
  await locator.screenshot({ path: options.output });
  check(options.label + ' has zero console errors', errors.length === 0, errors.join(' | '));
  await context.close();
  return text;
}

(async () => {
  const users = {};
  const clubIds = [];
  const inviteIds = [];
  fs.mkdirSync(screenshots, { recursive: true });
  let browser = null;
  try {
    for (const [key, name] of [
      ['owner', 'Join Visibility Owner'],
      ['requester', 'Join Visibility Requester'],
      ['freeSame', 'Free Same Invitee'],
      ['proSame', 'Pro Same Invitee'],
      ['freeToPro', 'Free To Pro Invitee'],
      ['proToFree', 'Pro To Free Invitee']
    ]) users[key] = await makeUser(key, name);
    const logins = {};
    for (const key of Object.keys(users)) logins[key] = await login(emails[key]);

    const freeClub = await createClub(users.owner.id, 'Compact Free Club ' + nonce, 'compact-free-' + nonce);
    const proClub = await createClub(users.owner.id, 'Compact Pro Club ' + nonce, 'compact-pro-' + nonce);
    clubIds.push(freeClub, proClub);
    await setClubPro(proClub, true);
    console.log('MANIFEST', JSON.stringify({
      users: Object.fromEntries(Object.entries(users).map(([key, user]) => [key, user.id])),
      clubs: { freeClub, proClub }
    }));

    const freeSameInvite = await seedInvite(freeClub, users.owner.id, emails.freeSame);
    const proSameInvite = await seedInvite(proClub, users.owner.id, emails.proSame);
    const freeToProInvite = await seedInvite(freeClub, users.owner.id, emails.freeToPro);
    const proToFreeInvite = await seedInvite(proClub, users.owner.id, emails.proToFree);
    const loggedOutRetryInvite = await seedInvite(freeClub, users.owner.id, 'open-invite@realarenas.com');
    inviteIds.push(freeSameInvite.id, proSameInvite.id, freeToProInvite.id, proToFreeInvite.id, loggedOutRetryInvite.id);

    const freeSameRender = await joinPage(freeSameInvite.token);
    const proSameRender = await joinPage(proSameInvite.token);
    const freeToProRender = await joinPage(freeToProInvite.token);
    const proToFreeRender = await joinPage(proToFreeInvite.token);
    check('free invite page resolves free plan', freeSameRender.data && freeSameRender.data.plan === 'free');
    check('Pro invite page resolves Club Pro plan', proSameRender.data && proSameRender.data.plan === 'club_pro');
    check('invite pages carry signed render-time plan proofs',
      [freeSameRender, proSameRender, freeToProRender, proToFreeRender]
        .every(page => page.data && /^[a-f0-9]{64}$/.test(page.data.planProof || '')));

    const { launchBrowser } = await import('./lib/mobile-geometry.js');
    browser = await launchBrowser();
    for (const width of [1280, 380]) {
      const suffix = width + '.png';
      const freeDirectoryText = await screenshotSurface(browser, {
        width,
        cookies: logins.requester.browserCookies,
        path: '/clubs',
        selector: `.ccd-card[data-club-id="${freeClub}"]`,
        output: `${screenshots}/club-join-visibility-directory-free-${suffix}`,
        label: `free directory card @${width}`
      });
      check(`free directory card @${width} exact compact disclosure`,
        freeDirectoryText.includes('Club managers can see the activity you log while you’re a member. Full visibility policy.'));
      const proDirectoryText = await screenshotSurface(browser, {
        width,
        cookies: logins.requester.browserCookies,
        path: '/clubs',
        selector: `.ccd-card[data-club-id="${proClub}"]`,
        output: `${screenshots}/club-join-visibility-directory-pro-${suffix}`,
        label: `Pro directory card @${width}`
      });
      check(`Pro directory card @${width} exact compact disclosure`,
        proDirectoryText.includes('including weekly training hours and inactivity'));

      const freeProfileText = await screenshotSurface(browser, {
        width,
        path: '/clubs/' + freeClub,
        selector: '.cp-header-wrap',
        output: `${screenshots}/club-join-visibility-profile-free-${suffix}`,
        label: `free public profile @${width}`
      });
      check(`free public profile @${width} exact compact disclosure`,
        freeProfileText.includes('Club managers can see the activity you log while you’re a member. Full visibility policy.'));
      const proProfileText = await screenshotSurface(browser, {
        width,
        path: '/clubs/' + proClub,
        selector: '.cp-header-wrap',
        output: `${screenshots}/club-join-visibility-profile-pro-${suffix}`,
        label: `Pro public profile @${width}`
      });
      check(`Pro public profile @${width} exact compact disclosure`,
        proProfileText.includes('including weekly training hours and inactivity'));

      const freeInviteText = await screenshotSurface(browser, {
        width,
        path: '/join/' + freeSameInvite.token,
        selector: '#card',
        output: `${screenshots}/club-join-visibility-invite-free-${suffix}`,
        label: `free invite page @${width}`
      });
      check(`free invite page @${width} carries long disclosure`,
        freeInviteText.includes('does not currently have Club Pro') &&
        freeInviteText.includes('leaderboard and activity-feed settings do not limit'));
      const proInviteText = await screenshotSurface(browser, {
        width,
        path: '/join/' + proSameInvite.token,
        selector: '#card',
        output: `${screenshots}/club-join-visibility-invite-pro-${suffix}`,
        label: `Pro invite page @${width}`
      });
      check(`Pro invite page @${width} carries long disclosure`,
        proInviteText.includes('currently has Club Pro') &&
        proInviteText.includes('periods of inactivity'));
    }

    let unreviewed = await fetch(BASE + '/auth/join/' + freeSameInvite.token + '/existing', {
      method: 'POST',
      headers: { Cookie: logins.freeSame.cookieHeader, 'Content-Type': 'application/json' },
      body: '{}'
    });
    check('invite cannot be accepted without reviewed signed plan state', unreviewed.status === 409);
    const { data: unreviewedMembership } = await admin.from('memberships')
      .select('user_id')
      .eq('user_id', users.freeSame.id)
      .eq('club_id', freeClub)
      .maybeSingle();
    check('missing signed plan state has zero membership effect', !unreviewedMembership);

    const loggedInRecoveryContext = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 900 }
    });
    await loggedInRecoveryContext.addCookies(logins.freeSame.browserCookies);
    const loggedInRecoveryPage = await loggedInRecoveryContext.newPage();
    await loggedInRecoveryPage.goto(BASE + '/join/' + freeSameInvite.token, { waitUntil: 'networkidle' });
    await loggedInRecoveryPage.evaluate(() => { window.JOIN_DATA.planProof = 'invalid-proof'; });
    await Promise.all([
      loggedInRecoveryPage.waitForNavigation({ waitUntil: 'networkidle' }),
      loggedInRecoveryPage.locator('#join-btn').click()
    ]);
    const loggedInRecovered = await loggedInRecoveryPage.evaluate(() => ({
      proof: window.JOIN_DATA && window.JOIN_DATA.planProof,
      buttonEnabled: !document.getElementById('join-btn').disabled,
      url: window.location.pathname
    }));
    check('logged-in invalid proof automatically reloads the canonical invite review',
      loggedInRecovered.url.endsWith('/join/' + freeSameInvite.token) &&
      /^[a-f0-9]{64}$/.test(loggedInRecovered.proof || '') &&
      loggedInRecovered.buttonEnabled,
      JSON.stringify(loggedInRecovered));
    await loggedInRecoveryContext.close();

    const retryName = 'Preserved Invite Name';
    const retryEmail = `joinvis-retry-${nonce}@arenas-test.dev`;
    const loggedOutRecoveryContext = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 900 }
    });
    const loggedOutRecoveryPage = await loggedOutRecoveryContext.newPage();
    await loggedOutRecoveryPage.goto(BASE + '/join/' + loggedOutRetryInvite.token, { waitUntil: 'networkidle' });
    await loggedOutRecoveryPage.locator('input[name="name"]').fill(retryName);
    await loggedOutRecoveryPage.locator('input[name="email"]:not([type="hidden"])').fill(retryEmail);
    await loggedOutRecoveryPage.locator('input[name="password"]').fill(PASSWORD);
    await loggedOutRecoveryPage.locator('input[name="rendered_plan_proof"]').evaluate(input => {
      input.value = 'invalid-proof';
    });
    await Promise.all([
      loggedOutRecoveryPage.waitForNavigation({ waitUntil: 'networkidle' }),
      loggedOutRecoveryPage.locator('#join-form button[type="submit"]').click()
    ]);
    const loggedOutRecovered = await loggedOutRecoveryPage.evaluate(() => ({
      name: document.querySelector('input[name="name"]').value,
      email: document.querySelector('input[name="email"]:not([type="hidden"])').value,
      password: document.querySelector('input[name="password"]').value,
      proof: window.JOIN_DATA && window.JOIN_DATA.planProof,
      url: window.location.pathname
    }));
    check('logged-out invalid proof reload preserves name and email but not password',
      loggedOutRecovered.url.endsWith('/join/' + loggedOutRetryInvite.token) &&
      loggedOutRecovered.name === retryName &&
      loggedOutRecovered.email === retryEmail &&
      loggedOutRecovered.password === '' &&
      /^[a-f0-9]{64}$/.test(loggedOutRecovered.proof || ''),
      JSON.stringify(loggedOutRecovered));
    const { data: retryAccount } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    check('logged-out invalid proof creates no account',
      !(retryAccount && retryAccount.users || []).some(user => user.email === retryEmail));
    await loggedOutRecoveryContext.close();

    const panelSource = fs.readFileSync('artifacts/html-arenas/html/arenas-notifications-panel.js', 'utf8');
    check('notification panel routes pending invites through review page',
      panelSource.includes('Review &amp; join') && !panelSource.includes('acceptClubInvite'));

    // Unchanged render→acceptance states produce no corrective notification.
    let accepted = await acceptInvite(freeSameInvite.token, logins.freeSame, freeSameRender.data);
    check('unchanged free invite acceptance succeeds', accepted.status === 200 && accepted.body.success);
    check('unchanged free produces no corrective notification',
      (await correctiveRows(users.freeSame.id)).length === 0);
    accepted = await acceptInvite(proSameInvite.token, logins.proSame, proSameRender.data);
    check('unchanged Pro invite acceptance succeeds', accepted.status === 200 && accepted.body.success);
    check('unchanged Pro produces no corrective notification',
      (await correctiveRows(users.proSame.id)).length === 0);

    // Request while free, then upgrade before approval: approval must use Pro.
    let response = await fetch(BASE + '/api/clubs/' + freeClub + '/join-request', {
      method: 'POST',
      headers: { Cookie: logins.requester.cookieHeader }
    });
    check('request submitted while club is free', response.status === 200);
    await setClubPro(freeClub, true);
    response = await fetch(BASE + '/api/clubs/' + freeClub + '/join-requests/' + users.requester.id + '/approve', {
      method: 'POST',
      headers: { Cookie: logins.owner.cookieHeader }
    });
    check('approval succeeds after upgrade', response.status === 200);
    const { data: approvalRows, error: approvalError } = await admin.from('notifications')
      .select('title, body, link')
      .eq('user_id', users.requester.id)
      .eq('title', 'Request approved');
    if (approvalError) throw approvalError;
    check('approval notification uses Club Pro plan at approval time',
      approvalRows && approvalRows.length === 1 &&
      approvalRows[0].body.includes('currently has Club Pro') &&
      approvalRows[0].body.includes('weekly training hours') &&
      approvalRows[0].body.includes('periods of inactivity') &&
      approvalRows[0].link === '/privacy#club-manager-visibility',
      JSON.stringify(approvalRows));

    // Free at render, Pro at acceptance → exactly one Pro correction.
    accepted = await acceptInvite(freeToProInvite.token, logins.freeToPro, freeToProRender.data);
    check('free→Pro invite acceptance succeeds', accepted.status === 200 && accepted.body.success);
    let corrections = await correctiveRows(users.freeToPro.id);
    check('free→Pro produces exactly one corrective notification',
      corrections.length === 1 &&
      corrections[0].body.includes('currently has Club Pro') &&
      corrections[0].link === '/privacy#club-manager-visibility',
      JSON.stringify(corrections));

    // Pro at render, free at acceptance → exactly one free correction.
    await setClubPro(proClub, false);
    accepted = await acceptInvite(proToFreeInvite.token, logins.proToFree, proToFreeRender.data);
    check('Pro→free invite acceptance succeeds', accepted.status === 200 && accepted.body.success);
    corrections = await correctiveRows(users.proToFree.id);
    check('Pro→free produces exactly one corrective notification',
      corrections.length === 1 &&
      corrections[0].body.includes('does not currently have Club Pro') &&
      corrections[0].link === '/privacy#club-manager-visibility',
      JSON.stringify(corrections));

    // Logged-out Privacy anchor remains public.
    response = await fetch(BASE + '/privacy');
    const privacyHtml = await response.text();
    check('Privacy page works logged out and contains manager anchor',
      response.status === 200 && privacyHtml.includes('id="club-manager-visibility"'));
  } finally {
    if (browser) await browser.close();
    if (clubIds.length) {
      await admin.from('notifications').delete().in('entity_id', clubIds);
      await admin.from('subscriptions').delete().eq('owner_type', 'club').in('owner_id', clubIds);
      await admin.from('club_invites').delete().in('club_id', clubIds);
      await admin.from('club_join_requests').delete().in('club_id', clubIds);
      await admin.from('memberships').delete().in('club_id', clubIds);
      await admin.from('clubs').delete().in('id', clubIds);
    }
    for (const user of Object.values(users)) {
      await admin.from('notifications').delete().eq('user_id', user.id);
      await admin.from('notifications').delete().eq('actor_id', user.id);
      await admin.auth.admin.deleteUser(user.id);
    }
    console.log('      manifest cleanup complete');
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(error => {
  console.error('FATAL', error);
  process.exit(1);
});