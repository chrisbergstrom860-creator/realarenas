// Club training analytics opt-out verification.
// Proves the successful JSON contract, stale-page check-in/nudge races,
// aggregate/ranking preservation, report name suppression, and cleanup.

const { createClient } = require('@supabase/supabase-js');

const BASE = 'http://localhost:80/html';
const PASSWORD = 'TrainingOptout!234';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const nonce = Date.now().toString(36);
const users = {};
let clubId = null;
let subscriptionId = null;
let secondClubId = null;
let secondSubscriptionId = null;
let failures = 0;

function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else {
    failures++;
    console.log('FAIL  ' + name + (detail ? ' — ' + String(detail).slice(0, 700) : ''));
  }
}

async function makeUser(key, name, prefs) {
  const email = `training-optout-${key}-${nonce}@arenas-test.dev`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: {
      name,
      handle: `tr_${key}_${nonce}`.slice(0, 20),
      timezone: 'UTC',
      prefs: prefs || {}
    }
  });
  if (error) throw error;
  users[key] = { id: data.user.id, email };
}

async function login(key) {
  const response = await fetch(BASE + '/auth/login', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(users[key].email)}&password=${encodeURIComponent(PASSWORD)}`
  });
  const raw = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')];
  const cookieHeader = (raw || []).filter(Boolean).map(value => String(value).split(';')[0]).join('; ');
  const browserCookies = (raw || []).filter(Boolean).map(value => {
    const pair = String(value).split(';')[0];
    const split = pair.indexOf('=');
    return { name: pair.slice(0, split), value: pair.slice(split + 1), url: 'http://localhost:80' };
  });
  if (response.status !== 302 || !cookieHeader) throw new Error('login failed for ' + key);
  return { cookieHeader, browserCookies };
}

async function api(loginState, method, path, body) {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      Cookie: loginState.cookieHeader,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({}))
  };
}

async function setTrainingVisible(loginState, value) {
  return api(loginState, 'POST', '/api/profile/prefs', {
    key: 'club_training_analytics_visible',
    value
  });
}

async function notificationCount(userId) {
  const { count, error } = await admin.from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('entity_id', clubId)
    .eq('title', 'Check-in from your coach');
  if (error) throw error;
  return count || 0;
}

(async () => {
  let browser = null;
  try {
    await makeUser('manager', 'Training Manager');
    await makeUser('active', 'Active Optout Member');
    await makeUser('inactive', 'Inactive Optout Member');
    const logins = {
      manager: await login('manager'),
      active: await login('active'),
      inactive: await login('inactive')
    };

    const club = await admin.from('clubs').insert({
      owner_id: users.manager.id,
      name: 'Training Optout Club ' + nonce,
      handle: ('tr-optout-' + nonce).slice(0, 20),
      sport: 'running',
      city: 'Portland',
      headline: 'Opt-out verification club',
      description: 'Temporary focused verification fixture.',
      visibility: 'public'
    }).select('id').single();
    if (club.error) throw club.error;
    clubId = club.data.id;

    const memberships = await admin.from('memberships').insert([
      { user_id: users.manager.id, club_id: clubId, role: 'admin' },
      { user_id: users.active.id, club_id: clubId, role: 'member' },
      { user_id: users.inactive.id, club_id: clubId, role: 'member' }
    ]);
    if (memberships.error) throw memberships.error;

    const sub = await admin.from('subscriptions').insert({
      owner_type: 'club',
      owner_id: clubId,
      plan: 'club_pro',
      status: 'active',
      stripe_customer_id: 'cus_tropt_' + nonce,
      stripe_subscription_id: 'sub_tropt_' + nonce,
      ever_paid: true,
      last_paid_subscription_id: 'sub_tropt_' + nonce,
      cancel_at_period_end: false
    }).select('id').single();
    if (sub.error) throw sub.error;
    subscriptionId = sub.data.id;

    const secondClub = await admin.from('clubs').insert({
      owner_id: users.manager.id,
      name: 'Second Training Optout Club ' + nonce,
      handle: ('tr-optout-2-' + nonce).slice(0, 20),
      sport: 'running',
      city: 'Seattle',
      headline: 'Global preference verification club',
      description: 'Temporary second-club verification fixture.',
      visibility: 'public'
    }).select('id').single();
    if (secondClub.error) throw secondClub.error;
    secondClubId = secondClub.data.id;
    const secondMemberships = await admin.from('memberships').insert([
      { user_id: users.manager.id, club_id: secondClubId, role: 'admin' },
      { user_id: users.active.id, club_id: secondClubId, role: 'member' }
    ]);
    if (secondMemberships.error) throw secondMemberships.error;
    const secondSub = await admin.from('subscriptions').insert({
      owner_type: 'club',
      owner_id: secondClubId,
      plan: 'club_pro',
      status: 'active',
      stripe_customer_id: 'cus_tropt2_' + nonce,
      stripe_subscription_id: 'sub_tropt2_' + nonce,
      ever_paid: true,
      last_paid_subscription_id: 'sub_tropt2_' + nonce,
      cancel_at_period_end: false
    }).select('id').single();
    if (secondSub.error) throw secondSub.error;
    secondSubscriptionId = secondSub.data.id;

    const now = new Date();
    now.setUTCHours(12, 0, 0, 0);
    const activities = await admin.from('activities').insert([
      {
        user_id: users.manager.id,
        sport: 'running',
        title: 'Manager aggregate session',
        date: now.toISOString(),
        duration: '1h',
        distance: '10 km'
      },
      {
        user_id: users.active.id,
        sport: 'running',
        title: 'Private aggregate session one',
        date: now.toISOString(),
        duration: '2h',
        distance: '8 km'
      },
      {
        user_id: users.active.id,
        sport: 'running',
        title: 'Private aggregate session two',
        date: new Date(now.getTime() - 3600000).toISOString(),
        duration: '3h',
        distance: '12 km'
      }
    ]);
    if (activities.error) throw activities.error;

    console.log('MANIFEST', JSON.stringify({
      users: Object.fromEntries(Object.entries(users).map(([key, value]) => [key, value.id])),
      clubId,
      subscriptionId,
      secondClubId,
      secondSubscriptionId
    }));

    // Load the manager's data while both members are still opted in. The
    // inactive member is visibly at-risk and the active member has a check-in
    // button in this stale page state.
    const initialTraining = await api(logins.manager, 'GET', `/api/clubs/${clubId}/training-load?weeks=6`);
    check('initial Training Load response succeeds', initialTraining.status === 200 && !initialTraining.body.error, JSON.stringify(initialTraining));
    check('active member initially has individual metrics', !!(initialTraining.body.members || []).find((m) => m.userId === users.active.id && Array.isArray(m.weeklyHours)));
    const initialLeaderboard = await api(logins.manager, 'GET', `/api/leaderboard/club-dashboard?period=week&clubId=${clubId}`);
    check('initial at-risk response succeeds', initialLeaderboard.status === 200 && !initialLeaderboard.body.error, JSON.stringify(initialLeaderboard));
    check('inactive member initially appears at-risk', (initialLeaderboard.body.atRisk || []).some((m) => m.userId === users.inactive.id));

    const { launchBrowser } = await import('./lib/mobile-geometry.js');
    browser = await launchBrowser();
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.addCookies(logins.manager.browserCookies);
    const page = await context.newPage();
    const browserErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
    page.on('pageerror', (error) => browserErrors.push(String(error)));
    await page.goto(BASE + `/clubs/dashboard?club=${clubId}`, { waitUntil: 'networkidle' });

    // Manager opens Training Load and expands the active member BEFORE that
    // member opts out, leaving a real stale check-in button in the DOM.
    await page.locator('.nav-item', { hasText: 'Training load' }).click();
    const activeRow = page.locator(`[onclick*="${users.active.id}"]`).first();
    await activeRow.waitFor({ state: 'visible' });
    await activeRow.click();
    const staleCheckinButton = page.locator(`button[onclick*="sendTlCheckin('${users.active.id}'"]`);
    await staleCheckinButton.waitFor({ state: 'visible' });

    const activePref = await setTrainingVisible(logins.active, false);
    check('active member opts out through real preference endpoint', activePref.status === 200 && activePref.body.ok === true, JSON.stringify(activePref));
    const activeNotifBefore = await notificationCount(users.active.id);
    const checkinResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST' && response.url().includes(`/api/clubs/${clubId}/checkin`)
    );
    await staleCheckinButton.click();
    const staleCheckinResponse = await checkinResponsePromise;
    const staleCheckinBody = await staleCheckinResponse.json();
    const activeNotifAfter = await notificationCount(users.active.id);
    check('stale check-in click returns 409', staleCheckinResponse.status() === 409, JSON.stringify(staleCheckinBody));
    check('stale check-in returns explicit opt-out error', staleCheckinBody.error === 'This member has opted out of individual training analytics.', JSON.stringify(staleCheckinBody));
    check('stale check-in creates no notification', activeNotifAfter === activeNotifBefore, `${activeNotifBefore} -> ${activeNotifAfter}`);

    // Reload the manager's Leaderboard while the inactive member is still
    // opted in, preserving a stale "Nudge all" control and named at-risk row.
    await page.reload({ waitUntil: 'networkidle' });
    const leaderboardResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'GET' && response.url().includes('/api/leaderboard/club-dashboard')
    );
    await page.locator('.nav-item', { hasText: 'Leaderboard' }).click();
    await leaderboardResponsePromise;
    await page.locator('#lb-atrisk-names', { hasText: 'Inactive Optout Member' }).waitFor({ state: 'visible' });
    const staleNudgeButton = page.getByRole('button', { name: 'Send check-in nudge' });
    await staleNudgeButton.waitFor({ state: 'visible' });

    const inactivePref = await setTrainingVisible(logins.inactive, false);
    check('inactive member opts out through real preference endpoint', inactivePref.status === 200 && inactivePref.body.ok === true, JSON.stringify(inactivePref));
    const inactiveNotifBefore = await notificationCount(users.inactive.id);
    const nudgeResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST' && response.url().includes(`/api/clubs/${clubId}/nudge-atrisk`)
    );
    await staleNudgeButton.click();
    const staleNudgeResponse = await nudgeResponsePromise;
    const staleNudgeBody = await staleNudgeResponse.json();
    const inactiveNotifAfter = await notificationCount(users.inactive.id);
    check('stale Nudge all request succeeds safely', staleNudgeResponse.status() === 200 && staleNudgeBody.success === true, JSON.stringify(staleNudgeBody));
    check('stale Nudge all recomputes to zero recipients', staleNudgeBody.nudged === 0, JSON.stringify(staleNudgeBody));
    check('stale Nudge all creates no notification', inactiveNotifAfter === inactiveNotifBefore, `${inactiveNotifBefore} -> ${inactiveNotifAfter}`);

    // Reload after both opt-outs and prove the identity-only rows have no
    // expansion affordance or hidden check-in control.
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.nav-item', { hasText: 'Training load' }).click();
    const hiddenRows = page.locator('[data-training-analytics-hidden="opted-out"]');
    await hiddenRows.first().waitFor({ state: 'visible' });
    check('Training Load renders both opted-out identity rows', await hiddenRows.count() === 2, await page.locator('#tl-member-rows').innerText());
    check('opted-out UI uses exact row copy', (await hiddenRows.allTextContents()).every((text) => text.includes('Individual training analytics off') && text.includes('Opted out')));
    check('opted-out UI rows have no click handler', await hiddenRows.evaluateAll((rows) => rows.every((row) => !row.hasAttribute('onclick'))));
    check('opted-out UI rows contain no check-in button', await hiddenRows.locator('button').count() === 0);
    const unexpectedBrowserErrors = browserErrors.filter((message) =>
      !/Failed to load resource: the server responded with a status of 409 \(Conflict\)/.test(message)
    );
    check('race browser has no unexpected console/page errors', unexpectedBrowserErrors.length === 0, unexpectedBrowserErrors.join(' | '));
    await context.close();
    await browser.close();
    browser = null;

    // Payload assertion is deliberately against a successful response and the
    // exact actual JSON keys—not the rendered DOM, not an error body.
    const hiddenTraining = await api(logins.manager, 'GET', `/api/clubs/${clubId}/training-load?weeks=6`);
    check('post-opt-out Training Load response succeeds non-vacuously', hiddenTraining.status === 200 && !hiddenTraining.body.error && Array.isArray(hiddenTraining.body.members), JSON.stringify(hiddenTraining));
    const activeHidden = hiddenTraining.body.members.find((m) => m.userId === users.active.id);
    const inactiveHidden = hiddenTraining.body.members.find((m) => m.userId === users.inactive.id);
    const expectedHiddenKeys = ['avatar_url', 'name', 'optedOut', 'userId'];
    for (const [label, row] of [['active', activeHidden], ['inactive', inactiveHidden]]) {
      check(`${label} opted-out row exists in successful JSON`, !!row, JSON.stringify(hiddenTraining.body.members));
      check(
        `${label} opted-out row has identity-only exact key set`,
        !!row && JSON.stringify(Object.keys(row).sort()) === JSON.stringify(expectedHiddenKeys),
        row && JSON.stringify(row)
      );
      check(`${label} opted-out row carries no metrics in serialized JSON`, !!row && !/(weeklyHours|thisWeek|avg|trend|status|sessions|km|restDays|sports|handle)/.test(JSON.stringify(row)), row && JSON.stringify(row));
    }
    const visibleManager = hiddenTraining.body.members.find((m) => m.userId === users.manager.id);
    check('visible manager row still carries metrics', !!visibleManager && Array.isArray(visibleManager.weeklyHours) && visibleManager.thisWeek === 1, JSON.stringify(visibleManager));
    check('two opted-out members are counted', hiddenTraining.body.stats.optedOutCount === 2, JSON.stringify(hiddenTraining.body.stats));
    check('whole-club aggregate hours stay at 6h', hiddenTraining.body.stats.clubThisWeek === 6, JSON.stringify(hiddenTraining.body.stats));
    check('whole-club aggregate sessions stay at 3', hiddenTraining.body.stats.sessionsThisWeek === 3, JSON.stringify(hiddenTraining.body.stats));
    check('whole-club aggregate distance stays at 30 km', hiddenTraining.body.stats.kmThisWeek === 30, JSON.stringify(hiddenTraining.body.stats));
    check('membership total stays at three', hiddenTraining.body.stats.totalMembers === 3, JSON.stringify(hiddenTraining.body.stats));

    const secondClubTraining = await api(logins.manager, 'GET', `/api/clubs/${secondClubId}/training-load?weeks=6`);
    const secondClubActiveRow = (secondClubTraining.body.members || []).find((m) => m.userId === users.active.id);
    check('account opt-out applies in a second club', secondClubTraining.status === 200 && secondClubActiveRow && secondClubActiveRow.optedOut === true, JSON.stringify(secondClubTraining));
    check('second-club opted-out row is also identity-only', JSON.stringify(Object.keys(secondClubActiveRow || {}).sort()) === JSON.stringify(expectedHiddenKeys), JSON.stringify(secondClubActiveRow));

    const hiddenLeaderboard = await api(logins.manager, 'GET', `/api/leaderboard/club-dashboard?period=week&clubId=${clubId}`);
    check('post-opt-out leaderboard response succeeds', hiddenLeaderboard.status === 200 && !hiddenLeaderboard.body.error, JSON.stringify(hiddenLeaderboard));
    check('opted-out members are absent from named at-risk response', !(hiddenLeaderboard.body.atRisk || []).some((m) => [users.active.id, users.inactive.id].includes(m.userId)), JSON.stringify(hiddenLeaderboard.body.atRisk));
    check('at-risk count excludes opted-out members', hiddenLeaderboard.body.stats.atRiskCount === 0, JSON.stringify(hiddenLeaderboard.body.stats));
    check('training opt-out does not remove active member from distance ranking', (hiddenLeaderboard.body.byDistance || []).some((m) => m.userId === users.active.id && m.totalKm === 20), JSON.stringify(hiddenLeaderboard.body.byDistance));
    check('training opt-out does not remove active member from session ranking', (hiddenLeaderboard.body.bySessions || []).some((m) => m.userId === users.active.id && m.sessionCount === 2), JSON.stringify(hiddenLeaderboard.body.bySessions));
    check('leaderboard aggregate distance stays at 30 km', hiddenLeaderboard.body.stats.totalKm === 30, JSON.stringify(hiddenLeaderboard.body.stats));
    check('leaderboard aggregate sessions stay at 3', hiddenLeaderboard.body.stats.totalSessions === 3, JSON.stringify(hiddenLeaderboard.body.stats));

    const month = now.toISOString().slice(0, 7);
    const report = await api(logins.manager, 'GET', `/api/clubs/${clubId}/report?month=${month}`);
    check('report response succeeds', report.status === 200 && !report.body.error, JSON.stringify(report));
    check('report aggregate hours include opted-out activity', report.body.engagement.totalHours === 6, JSON.stringify(report.body.engagement));
    check('report aggregate sessions include opted-out activity', report.body.engagement.sessions === 3, JSON.stringify(report.body.engagement));
    check('report aggregate distance includes opted-out activity', report.body.engagement.totalKm === 30, JSON.stringify(report.body.engagement));
    check('most-active member excludes opted-out athlete', report.body.engagement.topMember && report.body.engagement.topMember.name === 'Training Manager' && report.body.engagement.topMember.sessions === 1, JSON.stringify(report.body.engagement.topMember));

    const activeOwnProfile = await api(logins.active, 'GET', '/api/profile/overview');
    check('opted-out member own profile overview still succeeds', activeOwnProfile.status === 200 && !activeOwnProfile.body.error, JSON.stringify(activeOwnProfile));
    check('opted-out member own profile still includes their activities', Array.isArray(activeOwnProfile.body.recentActivities) && activeOwnProfile.body.recentActivities.length === 2, JSON.stringify(activeOwnProfile.body));

    // Concrete small-club inference: 6h/3 sessions/30km aggregate minus the
    // sole visible 1h/1 session/10km row reveals the two opt-outs' combined
    // 5h/2 sessions/20km, but not the split without auxiliary knowledge.
    check(
      'three-member aggregate subtraction exposes opted-outs combined totals',
      hiddenTraining.body.stats.clubThisWeek - visibleManager.thisWeek === 5
        && hiddenTraining.body.stats.sessionsThisWeek - visibleManager.sessionsThisWeek === 2
        && hiddenTraining.body.stats.kmThisWeek - visibleManager.kmThisWeek === 20
    );
  } catch (error) {
    failures++;
    console.error('FATAL', error && error.stack ? error.stack : error);
  } finally {
    if (browser) await browser.close().catch(() => {});
    try {
      const ids = Object.values(users).map((user) => user.id);
      if (ids.length) {
        await admin.from('notifications').delete().in('user_id', ids);
        await admin.from('activities').delete().in('user_id', ids);
      }
      if (subscriptionId) await admin.from('subscriptions').delete().eq('id', subscriptionId);
      if (secondSubscriptionId) await admin.from('subscriptions').delete().eq('id', secondSubscriptionId);
      for (const id of [clubId, secondClubId].filter(Boolean)) {
        await admin.from('memberships').delete().eq('club_id', id);
        await admin.from('clubs').delete().eq('id', id);
      }
      for (const user of Object.values(users)) await admin.auth.admin.deleteUser(user.id);
      console.log('cleanup complete');
    } catch (cleanupError) {
      failures++;
      console.error('cleanup failed', cleanupError);
    }
  }
  if (failures) {
    console.error(`\n${failures} FAILURE(S)`);
    process.exitCode = 1;
  } else {
    console.log('\nALL CHECKS PASSED');
  }
})();