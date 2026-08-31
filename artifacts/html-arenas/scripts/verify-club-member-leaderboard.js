#!/usr/bin/env node
// Focused integration verification for explicit club manager dashboards and the
// membership-gated club leaderboard. Run with the app listening on localhost:80.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const BASE_URL = 'http://localhost:80/html';
const TASK89_BASELINE = process.env.TASK89_BASELINE === '1';
const MANIFEST = '/tmp/verify-club-member-leaderboard-manifest.json';
const PW = 'ArenasTest!234';
const TZ = 'America/Los_Angeles';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const emails = {
  manager: 'club-lb-manager@arenas-test.dev',
  viewer: 'club-lb-viewer@arenas-test.dev',
  active: 'club-lb-active@arenas-test.dev',
  opted: 'club-lb-opted@arenas-test.dev',
  prejoin: 'club-lb-prejoin@arenas-test.dev',
  departed: 'club-lb-departed@arenas-test.dev',
  outsider: 'club-lb-outsider@arenas-test.dev'
};
const users = {};
const records = [];
let failures = 0;

function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else {
    failures++;
    const suffix = detail == null ? '' : ' — ' +
      String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 350);
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
  for (const [table, column] of refs) {
    await admin.from(table).delete().eq(column, id);
  }
}

async function removeStorage(id) {
  const bucket = admin.storage.from('avatars');
  const { data } = await bucket.list('users/' + id, { limit: 1000 });
  if (data && data.length) {
    await bucket.remove(data.map((f) => 'users/' + id + '/' + f.name));
  }
}

async function listAllAuthUsers() {
  const all = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error('list auth users: ' + error.message);
    all.push(...((data && data.users) || []));
    if (!data || data.users.length < 200) break;
    if (page > 100) throw new Error('auth user pagination runaway');
  }
  return all;
}

async function cleanupEntries(entries) {
  const activityIds = entries.filter((x) => x.type === 'activity').map((x) => x.id);
  const subscriptionIds = entries.filter((x) => x.type === 'subscription').map((x) => x.id);
  const postIds = entries.filter((x) => x.type === 'post').map((x) => x.id);
  const eventIds = entries.filter((x) => x.type === 'event').map((x) => x.id);
  const challengeIds = entries.filter((x) => x.type === 'challenge').map((x) => x.id);
  const clubIds = [...new Set(entries.filter((x) => x.type === 'club').map((x) => x.id))];
  const userIds = [...new Set(entries.filter((x) => x.type === 'user').map((x) => x.id))];

  if (activityIds.length) await admin.from('activities').delete().in('id', activityIds);
  if (subscriptionIds.length) await admin.from('subscriptions').delete().in('id', subscriptionIds);
  if (postIds.length) await admin.from('posts').delete().in('id', postIds);
  if (eventIds.length) await admin.from('events').delete().in('id', eventIds);
  if (challengeIds.length) {
    await admin.from('challenge_participants').delete().in('challenge_id', challengeIds);
    await admin.from('challenges').delete().in('id', challengeIds);
  }
  for (const clubId of clubIds) {
    await admin.from('notifications').delete().eq('entity_id', clubId);
    await admin.from('club_join_requests').delete().eq('club_id', clubId);
    await admin.from('club_invites').delete().eq('club_id', clubId);
    await admin.from('memberships').delete().eq('club_id', clubId);
    await admin.from('subscriptions').delete().eq('owner_type', 'club').eq('owner_id', clubId);
    await admin.from('clubs').delete().eq('id', clubId);
  }
  for (const id of userIds) {
    await deleteUserRows(id);
    await removeStorage(id);
    await admin.auth.admin.deleteUser(id);
  }
}

async function recoverStaleManifest() {
  if (!fs.existsSync(MANIFEST)) return;
  let stale;
  try {
    stale = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } catch (err) {
    throw new Error('cannot parse stale manifest: ' + err.message);
  }
  console.log('  ok  recovering stale manifest');
  await cleanupEntries(Array.isArray(stale.records) ? stale.records : []);
  fs.rmSync(MANIFEST, { force: true });
}

async function createUser(key, name, extraMeta) {
  const { data, error } = await admin.auth.admin.createUser({
    email: emails[key],
    password: PW,
    email_confirm: true,
    user_metadata: {
      name,
      handle: 'clb_' + key,
      timezone: TZ,
      sports: ['running'],
      ...(extraMeta || {})
    }
  });
  if (error) throw new Error('create user ' + key + ': ' + error.message);
  users[key] = { id: data.user.id };
  saveManifest({ type: 'user', id: data.user.id, email: emails[key] });
}

async function login(key) {
  const response = await fetch(BASE_URL + '/auth/login', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: emails[key], password: PW }).toString()
  });
  const rawCookies = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')];
  const cookie = rawCookies.map((c) => c && String(c).split(';')[0]).filter(Boolean).join('; ');
  if (!cookie) throw new Error('login failed for ' + key + ' (' + response.status + ')');
  users[key].cookie = cookie;
}

async function api(key, method, route, body) {
  const response = await fetch(BASE_URL + '/api' + route, {
    method,
    redirect: 'manual',
    headers: {
      Cookie: users[key].cookie,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const raw = await response.text();
  let json = null;
  try { json = JSON.parse(raw); } catch (err) {}
  return { status: response.status, raw, body: json, location: response.headers.get('location') };
}

async function page(key, route) {
  const response = await fetch(BASE_URL + route, {
    redirect: 'manual',
    headers: { Cookie: users[key].cookie }
  });
  return { status: response.status, raw: await response.text(), location: response.headers.get('location') };
}

async function createClub(name, handle) {
  const result = await api('manager', 'POST', '/clubs/create', {
    name, handle, sport: 'running', city: 'Test City'
  });
  const id = result.body && result.body.redirect &&
    new URL(result.body.redirect, BASE_URL).searchParams.get('club');
  if (!id) throw new Error('create club failed: ' + result.raw);
  saveManifest({ type: 'club', id });
  return id;
}

async function createActivity(userId, title, date, distance) {
  const { data, error } = await admin.from('activities').insert({
    user_id: userId,
    sport: 'running',
    title,
    distance: distance || '1 km',
    duration: '00:10:00',
    date
  }).select('id').single();
  if (error) throw new Error('create activity ' + title + ': ' + error.message);
  saveManifest({ type: 'activity', id: data.id });
  return data.id;
}

function zonedParts(date, zone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
}

function monthBoundaryUtc(zone) {
  const now = new Date();
  const here = zonedParts(now, zone);
  const target = Date.UTC(here.year, here.month - 1, 1, 0, 0, 0);
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const seen = zonedParts(new Date(guess), zone);
    const represented = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
    guess += target - represented;
  }
  return guess;
}

function rowFor(payload, id) {
  return ((payload && payload.leaderboard) || []).find((row) => row.userId === id);
}

async function verifyMemberShellInBrowser(clubId) {
  const { chromium } = await import('playwright-core');
  const executablePath = process.env.CHROMIUM_BIN ||
    execSync('command -v chromium || command -v chromium-browser').toString().trim();
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const styleReport = {};
  try {
    for (const width of [1280, 380]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const cookiePairs = users.viewer.cookie.split(';').map((part) => part.trim()).filter(Boolean);
      await context.addCookies(cookiePairs.map((pair) => {
        const split = pair.indexOf('=');
        return { name: pair.slice(0, split), value: pair.slice(split + 1), url: BASE_URL };
      }));
      styleReport[width] = {};
      for (const cfg of [
        { key: 'member-home', route: '/clubs/member/' + clubId, wait: '#cm-sec-overview:not([hidden])' },
        { key: 'member-leaderboard', route: '/clubs/member/' + clubId + '/leaderboard', wait: '.lb-table-wrap' }
      ]) {
        const p = await context.newPage();
        const browserErrors = [];
        p.on('console', (message) => {
          if (message.type() === 'error') browserErrors.push('console: ' + message.text());
        });
        p.on('pageerror', (error) => browserErrors.push('pageerror: ' + error.message));
        await p.goto(BASE_URL + cfg.route, { waitUntil: 'domcontentloaded' });
        await p.waitForSelector(cfg.wait);
        styleReport[width][cfg.key] = await p.evaluate(() => {
          const take = (selector) => {
            const el = document.querySelector(selector);
            if (!el) return null;
            const s = getComputedStyle(el);
            return {
              width: s.width, height: s.height, borderRadius: s.borderRadius,
              overflow: s.overflow, backgroundColor: s.backgroundColor,
              display: s.display, objectFit: s.objectFit
            };
          };
          return {
            topbarTile: take('.tc-icon'),
            topbarImage: take('.tc-icon img'),
            sidebarTile: take('.club-sb-icon'),
            sidebarImage: take('.club-sb-icon img'),
            headerTile: take('.club-member-identity-tile'),
            headerImage: take('.club-member-identity-tile img'),
            tabs: take('.club-member-tabs')
          };
        });
        const phase = TASK89_BASELINE ? 'before' : 'after';
        await p.screenshot({ path: `/tmp/task89-${phase}-${cfg.key}-${width}.png`, fullPage: true });
        check(`8: ${cfg.key} has no browser errors at ${width}`, browserErrors.length === 0, browserErrors);
        await p.close();
      }
      if (!TASK89_BASELINE) {
        check('8: shared shell computed logo styles match at ' + width,
          JSON.stringify(styleReport[width]['member-home']) === JSON.stringify(styleReport[width]['member-leaderboard']),
          styleReport[width]);
        check('8: both logo wrappers clip rounded corners at ' + width,
          ['member-home', 'member-leaderboard'].every((key) => {
            const styles = styleReport[width][key];
            return styles.topbarTile.overflow === 'hidden' && styles.topbarTile.borderRadius === '5px' &&
              styles.sidebarTile.overflow === 'hidden' && styles.sidebarTile.borderRadius === '8px' &&
              styles.headerTile.overflow === 'hidden' && styles.headerTile.borderRadius === '12px';
          }), styleReport[width]);
      }
      await context.close();
    }
    fs.writeFileSync(
      `/tmp/task89-${TASK89_BASELINE ? 'before' : 'after'}-computed-styles.json`,
      JSON.stringify(styleReport, null, 2)
    );

    if (TASK89_BASELINE) return;
    const context = await browser.newContext({ viewport: { width: 1280, height: 500 } });
    const cookiePairs = users.viewer.cookie.split(';').map((part) => part.trim()).filter(Boolean);
    await context.addCookies(cookiePairs.map((pair) => {
      const split = pair.indexOf('=');
      return { name: pair.slice(0, split), value: pair.slice(split + 1), url: BASE_URL };
    }));
    const p = await context.newPage();
    const browserErrors = [];
    p.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push('console: ' + message.text());
    });
    p.on('pageerror', (error) => browserErrors.push('pageerror: ' + error.message));
    const sectionCases = [
      ['overview', '', '#cm-sec-overview'],
      ['announcements', '/announcements', '#cm-sec-feed'],
      ['leaderboard', '/leaderboard', '.lb-table-wrap'],
      ['challenges', '/challenges', '#cm-sec-challenges'],
      ['events', '/events', '#cm-sec-events'],
      ['members', '/members', '#cm-sec-members']
    ];
    await p.goto(BASE_URL + '/clubs/member/' + clubId);
    for (const [section, suffix, target] of sectionCases) {
      await p.click('#club-tab-' + section);
      await p.waitForURL('**/clubs/member/' + clubId + suffix);
      await p.waitForSelector(target + (section === 'leaderboard' ? '' : ':not([hidden])'));
      const state = await p.evaluate(({ section, target }) => {
        const active = document.querySelector('.club-member-tab.active');
        const visibleFallback = Array.from(document.querySelectorAll('#cm-content [id^="cm-sec-"]'))
          .filter((el) => !el.hidden).map((el) => el.id);
        return {
          active: active && active.id,
          targetVisible: !!document.querySelector(target) &&
            getComputedStyle(document.querySelector(target)).display !== 'none',
          visibleFallback
        };
      }, { section, target });
      check('8: canonical ' + section + ' route focuses its section',
        state.active === 'club-tab-' + section && state.targetVisible &&
        (section === 'leaderboard' || state.visibleFallback.length === 1),
        state);
    }
    await p.goBack();
    await p.waitForURL('**/clubs/member/' + clubId + '/events');
    const backActive = await p.locator('.club-member-tab.active').getAttribute('id');
    await p.goForward();
    await p.waitForURL('**/clubs/member/' + clubId + '/members');
    const forwardActive = await p.locator('.club-member-tab.active').getAttribute('id');
    check('8: browser back and forward restore active route tabs',
      backActive === 'club-tab-events' && forwardActive === 'club-tab-members',
      { backActive, forwardActive });
    await p.goto(BASE_URL + '/clubs/member/' + clubId + '/members#announcements');
    await p.waitForSelector('#cm-sec-members:not([hidden])');
    const conflictingHash = await p.evaluate(() => ({
      active: document.querySelector('.club-member-tab.active')?.id,
      membersHidden: document.getElementById('cm-sec-members')?.hidden,
      announcementsHidden: document.getElementById('cm-sec-feed')?.hidden
    }));
    check('8: canonical section overrides a conflicting legacy hash',
      conflictingHash.active === 'club-tab-members' &&
      conflictingHash.membersHidden === false &&
      conflictingHash.announcementsHidden === true,
      conflictingHash);
    const sticky = await p.evaluate(() => {
      const main = document.querySelector('.main');
      const identity = document.querySelector('.club-member-identity');
      const tabs = document.querySelector('.club-member-tabs');
      const spacer = document.createElement('div');
      spacer.style.height = '1200px';
      spacer.setAttribute('data-test-scroll-spacer', '');
      main.appendChild(spacer);
      main.scrollTop = main.scrollHeight;
      const mainRect = main.getBoundingClientRect();
      const identityRect = identity.getBoundingClientRect();
      const tabsRect = tabs.getBoundingClientRect();
      const scroller = tabs.querySelector('.club-member-tabs-scroll');
      return {
        identityScrolled: identityRect.bottom < mainRect.top,
        tabsStuck: Math.abs(tabsRect.top - mainRect.top) <= 2,
        tabOverflow: scroller.scrollWidth > scroller.clientWidth,
        scrollTop: main.scrollTop,
        mainTop: mainRect.top,
        tabsTop: tabsRect.top
      };
    });
    check('8: banner scrolls away while route tabs stick below topbar',
      sticky.scrollTop > 0 && sticky.identityScrolled && sticky.tabsStuck, sticky);
    check('8: canonical route navigation has no browser errors',
      browserErrors.length === 0, browserErrors);
    await context.close();
  } finally {
    await browser.close();
  }
}

async function verifyClean(created) {
  const ids = created.filter((x) => x.type === 'user').map((x) => x.id);
  const clubs = created.filter((x) => x.type === 'club').map((x) => x.id);
  const acts = created.filter((x) => x.type === 'activity').map((x) => x.id);
  let authUsers = [];
  let authError = null;
  try { authUsers = await listAllAuthUsers(); } catch (err) { authError = err; }
  check('cleanup: seeded auth users absent',
    !authError && !authUsers.some((u) => Object.values(emails).includes(u.email)),
    authError && authError.message);
  if (clubs.length) {
    const { data } = await admin.from('clubs').select('id').in('id', clubs);
    check('cleanup: seeded clubs absent', (data || []).length === 0, data);
    const { data: subs } = await admin.from('subscriptions').select('id').in('owner_id', clubs);
    check('cleanup: seeded subscriptions absent', (subs || []).length === 0, subs);
  }
  if (acts.length) {
    const { data } = await admin.from('activities').select('id').in('id', acts);
    check('cleanup: seeded activities absent', (data || []).length === 0, data);
  }
  let storageCount = 0;
  for (const id of ids) {
    const { data } = await admin.storage.from('avatars').list('users/' + id, { limit: 1 });
    storageCount += (data || []).length;
  }
  check('cleanup: seeded user storage absent', storageCount === 0, storageCount);
}

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  await recoverStaleManifest();

  await createUser('manager', 'Club LB Manager');
  await createUser('viewer', 'Club LB Viewer');
  await createUser('active', 'Club LB Active');
  await createUser('opted', 'Club LB Opted', { prefs: { show_on_leaderboards: false } });
  await createUser('prejoin', 'Club LB Prejoin');
  await createUser('departed', 'Club LB Departed');
  await createUser('outsider', 'Club LB Outsider');
  for (const key of Object.keys(users)) await login(key);

  // A is deliberately older than B. Any latest-membership fallback therefore
  // points at B, while every meaningful seeded statistic belongs to A.
  const clubA = await createClub('Club LB Explicit Alpha', 'clblbalpha');
  const clubB = await createClub('Club LB Latest Beta', 'clblbbeta');
  // Opaque corner markers make missing wrapper clipping immediately visible:
  // the yellow/blue squares occupy the SVG's extreme corners.
  const cornerLogo = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#ef4444"/><rect width="14" height="14" fill="#fde047"/><rect x="50" y="50" width="14" height="14" fill="#2563eb"/></svg>'
  );
  const { error: logoError } = await admin.from('clubs').update({ logo_url: cornerLogo }).eq('id', clubA);
  if (logoError) throw new Error('set corner-visible club logo: ' + logoError.message);

  const { data: subscription, error: subscriptionError } = await admin.from('subscriptions').insert({
    owner_type: 'club',
    owner_id: clubA,
    plan: 'club_pro',
    status: 'active',
    stripe_customer_id: 'cus_club_lb_test',
    stripe_subscription_id: 'sub_club_lb_test'
  }).select('id').single();
  if (subscriptionError) throw new Error('create club pro subscription: ' + subscriptionError.message);
  saveManifest({ type: 'subscription', id: subscription.id });

  const joined = [
    { user_id: users.viewer.id, club_id: clubA, role: 'member' },
    { user_id: users.active.id, club_id: clubA, role: 'member' },
    { user_id: users.opted.id, club_id: clubA, role: 'member' },
    { user_id: users.prejoin.id, club_id: clubA, role: 'member' },
    { user_id: users.departed.id, club_id: clubA, role: 'member' }
  ];
  const { error: membershipError } = await admin.from('memberships').insert(joined);
  if (membershipError) throw new Error('create memberships: ' + membershipError.message);

  const { data: shellPost, error: shellPostError } = await admin.from('posts').insert({
    user_id: users.manager.id, club_id: clubA, content: 'Shell navigation announcement'
  }).select('id').single();
  if (shellPostError) throw new Error('create shell announcement: ' + shellPostError.message);
  saveManifest({ type: 'post', id: shellPost.id });
  const { data: shellEvent, error: shellEventError } = await admin.from('events').insert({
    created_by: users.manager.id, club_id: clubA, title: 'Shell navigation club event',
    sport: 'running', event_type: 'training', visibility: 'club',
    date: new Date(Date.now() + 7 * 86400000).toISOString(), location: 'Test track'
  }).select('id').single();
  if (shellEventError) throw new Error('create shell event: ' + shellEventError.message);
  saveManifest({ type: 'event', id: shellEvent.id });
  const { data: shellChallenge, error: shellChallengeError } = await admin.from('challenges').insert({
    created_by: users.manager.id, club_id: clubA, title: 'Shell navigation challenge',
    visibility: 'club', sport: 'running', goal_type: 'distance', goal_target: 10,
    goal_unit: 'km', start_date: new Date(Date.now() - 86400000).toISOString(),
    end_date: new Date(Date.now() + 14 * 86400000).toISOString()
  }).select('id').single();
  if (shellChallengeError) throw new Error('create shell challenge: ' + shellChallengeError.message);
  saveManifest({ type: 'challenge', id: shellChallenge.id });

  const boundary = monthBoundaryUtc(TZ);
  await createActivity(users.viewer.id, 'LB just before viewer month', new Date(boundary - 60000).toISOString(), '2 km');
  await createActivity(users.viewer.id, 'LB just inside viewer month', new Date(boundary + 60000).toISOString(), '3 km');
  await createActivity(users.active.id, 'LB recent active', new Date().toISOString(), '4 km');
  await createActivity(users.opted.id, 'LB opted old aggregate', new Date(Date.now() - 10 * 86400000).toISOString(), '5 km');
  await createActivity(users.prejoin.id, 'LB prejoin history', new Date(boundary - 40 * 86400000).toISOString(), '6 km');
  await createActivity(users.departed.id, 'LB departed history', new Date(boundary - 20 * 86400000).toISOString(), '7 km');
  await createActivity(users.viewer.id, 'LB future date excluded', new Date(Date.now() + 10 * 86400000).toISOString(), '9 km');
  await createActivity(users.opted.id, 'LB opted future does not suppress nudge', new Date(Date.now() + 10 * 86400000).toISOString(), '11 km');
  await admin.from('memberships').delete().eq('club_id', clubA).eq('user_id', users.departed.id);

  // 1: explicit manager scope, no fallback, all manager periods retained.
  const dashA = await api('manager', 'GET', '/leaderboard/club-dashboard?clubId=' + clubA + '&period=all');
  const dashB = await api('manager', 'GET', '/leaderboard/club-dashboard?clubId=' + clubB + '&period=all');
  const dashNone = await api('manager', 'GET', '/leaderboard/club-dashboard?period=all');
  check('1: explicit older club selected (not latest membership)',
    dashA.status === 200 && dashA.body && dashA.body.stats.totalMembers === 5 &&
    dashA.body.stats.totalSessions === 5 && dashB.body && dashB.body.stats.totalMembers === 1 &&
    dashB.body.stats.totalSessions === 0,
    { alpha: dashA.body && dashA.body.stats, beta: dashB.body && dashB.body.stats });
  check('1: missing clubId has no latest-membership fallback',
    dashNone.status === 200 && dashNone.raw === JSON.stringify({ error: 'Not authorised' }), dashNone);
  for (const period of ['week', 'month', 'all']) {
    const result = await api('manager', 'GET', '/leaderboard/club-dashboard?clubId=' + clubA + '&period=' + period);
    check('1: manager period ' + period + ' remains supported',
      result.status === 200 && result.body && result.body.period === period && !result.body.error, result);
  }

  // 2 and 3: zero-leak gates and member period contract.
  const fakeId = '00000000-0000-4000-8000-000000000321';
  const inaccessibleApi = await api('outsider', 'GET', '/clubs/' + clubA + '/leaderboard');
  const missingApi = await api('outsider', 'GET', '/clubs/' + fakeId + '/leaderboard');
  check('2: member API inaccessible/nonexistent is byte-identical',
    inaccessibleApi.status === missingApi.status && inaccessibleApi.raw === missingApi.raw, { inaccessibleApi, missingApi });
  const inaccessiblePage = await page('outsider', '/clubs/member/' + clubA + '/leaderboard');
  const missingPage = await page('outsider', '/clubs/member/' + fakeId + '/leaderboard');
  check('2: member page inaccessible/nonexistent is byte-identical',
    inaccessiblePage.status === missingPage.status && inaccessiblePage.raw === missingPage.raw,
    { inaccessible: inaccessiblePage.status + ':' + inaccessiblePage.raw, missing: missingPage.status + ':' + missingPage.raw });
  const softHome = await api('outsider', 'GET', '/clubs/' + clubA + '/member-home');
  check('2: member-home nonmember keeps HTTP 200 soft error',
    softHome.status === 200 && softHome.raw === JSON.stringify({ error: 'Not a member of this club' }), softHome);

  const defaultBoard = await api('viewer', 'GET', '/clubs/' + clubA + '/leaderboard');
  const monthBoard = await api('viewer', 'GET', '/clubs/' + clubA + '/leaderboard?period=month');
  const allBoard = await api('viewer', 'GET', '/clubs/' + clubA + '/leaderboard?period=all');
  const weekBoard = await api('viewer', 'GET', '/clubs/' + clubA + '/leaderboard?period=week');
  check('3: member API defaults to month', defaultBoard.status === 200 && defaultBoard.body.period === 'month', defaultBoard);
  check('3: member API accepts month and all',
    monthBoard.status === 200 && allBoard.status === 200 &&
    monthBoard.body.period === 'month' && allBoard.body.period === 'all', { month: monthBoard.body, all: allBoard.body });
  check('3: member API rejects week',
    weekBoard.status === 400 && weekBoard.raw === JSON.stringify({ error: 'Invalid period' }), weekBoard);

  // 4: viewer-local month cut, current-roster all-time semantics.
  const viewerMonth = rowFor(monthBoard.body, users.viewer.id);
  const viewerAll = rowFor(allBoard.body, users.viewer.id);
  const prejoinAll = rowFor(allBoard.body, users.prejoin.id);
  check('4: month boundary follows viewer timezone',
    viewerMonth && viewerMonth.activityCount === 1 && viewerAll && viewerAll.activityCount === 2,
    { month: viewerMonth, all: viewerAll, boundary: new Date(boundary).toISOString() });
  check('4: future-dated activity is excluded from month and all-time',
    viewerMonth && viewerMonth.points === 30 && viewerAll && viewerAll.points === 50,
    { month: viewerMonth, all: viewerAll });
  check('4: all-time includes pre-join activity for current members',
    prejoinAll && prejoinAll.activityCount === 1, prejoinAll);
  check('4: departed members disappear',
    !rowFor(monthBoard.body, users.departed.id) && !rowFor(allBoard.body, users.departed.id), allBoard.body.leaderboard);

  // 5 and 6: opt-out affects rankings, never private management aggregates/risk.
  const optedHome = await api('opted', 'GET', '/clubs/' + clubA + '/member-home');
  check('5: opted-out member absent from member boards',
    !rowFor(monthBoard.body, users.opted.id) && !rowFor(allBoard.body, users.opted.id), allBoard.body.leaderboard);
  check('5: opted-out viewer has no member-home standing',
    optedHome.status === 200 && optedHome.body && optedHome.body.standing.rank === null &&
    optedHome.body.standing.total === 4 && optedHome.body.standing.points === 0, optedHome.body && optedHome.body.standing);
  check('5: opted-out member absent from manager distance/session rows',
    !((dashA.body.byDistance || []).some((r) => r.userId === users.opted.id)) &&
    !((dashA.body.bySessions || []).some((r) => r.userId === users.opted.id)), dashA.body);
  check('6: manager aggregates still include opted-out activity',
    dashA.body.stats.totalMembers === 5 && dashA.body.stats.totalSessions === 5 &&
    dashA.body.stats.totalKm === 20, dashA.body.stats);
  check('6: manager rankings and aggregates exclude future activities',
    dashA.body.stats.totalSessions === 5 && dashA.body.stats.totalKm === 20 &&
    (dashA.body.byDistance || []).find((r) => r.userId === users.viewer.id).totalKm === 5,
    dashA.body);
  check('6: opted-out inactive member remains at-risk',
    (dashA.body.atRisk || []).some((r) => r.userId === users.opted.id), dashA.body.atRisk);
  const nudge = await api('manager', 'POST', '/clubs/' + clubA + '/nudge-atrisk');
  const { data: optedNudges } = await admin.from('notifications')
    .select('id').eq('user_id', users.opted.id).eq('entity_id', clubA).eq('type', 'club');
  check('6: nudge includes opted-out inactive member',
    nudge.status === 200 && nudge.body && nudge.body.success && (optedNudges || []).length === 1,
    { nudge: nudge.body, optedNudges });

  // 7: member home consumes the canonical month board result.
  const viewerHome = await api('viewer', 'GET', '/clubs/' + clubA + '/member-home');
  check('7: member-home standing equals month board viewer result',
    viewerHome.status === 200 && viewerHome.body && monthBoard.body.viewer &&
    viewerHome.body.standing.rank === monthBoard.body.viewer.rank &&
    viewerHome.body.standing.total === monthBoard.body.viewer.total &&
    viewerHome.body.standing.points === monthBoard.body.viewer.points &&
    viewerHome.body.standing.period === 'month', { home: viewerHome.body && viewerHome.body.standing, board: monthBoard.body.viewer });

  // 8: verify the actual membership-gated HTML, not merely the source template.
  const currentPage = await page('viewer', '/clubs/member/' + clubA + '/leaderboard');
  const count = (text, needle) => (text.match(new RegExp(needle, 'g')) || []).length;
  check('8: current-member page has exactly month/all and no week',
    currentPage.status === 200 &&
    count(currentPage.raw, '>This month<') === 1 &&
    count(currentPage.raw, '>All time<') === 1 &&
    count(currentPage.raw, '>This week<') === 0,
    { status: currentPage.status, month: count(currentPage.raw, '>This month<'), all: count(currentPage.raw, '>All time<'), week: count(currentPage.raw, '>This week<') });
  const currentHome = await page('viewer', '/clubs/member/' + clubA);
  const expectedOrder = ['club-tab-overview', 'club-tab-announcements', 'club-tab-leaderboard', 'club-tab-challenges', 'club-tab-events', 'club-tab-members'];
  const orderIn = (raw) => expectedOrder.map((id) => raw.indexOf('id="' + id + '"'));
  const strictlyOrdered = (indexes) => indexes.every((value, i) => value >= 0 && (i === 0 || value > indexes[i - 1]));
  if (!TASK89_BASELINE) {
    check('8: both pages use one complete ordered route-tab navigation',
      strictlyOrdered(orderIn(currentHome.raw)) && strictlyOrdered(orderIn(currentPage.raw)) &&
      currentHome.raw.includes('id="club-tab-overview"') &&
      currentHome.raw.includes('id="club-tab-overview" href="/html/clubs/member/') &&
      currentPage.raw.includes('club-member-tab active" id="club-tab-leaderboard"') &&
      !currentHome.raw.includes('id="nav-overview"') &&
      !currentPage.raw.includes('id="nav-leaderboard"') &&
      !currentHome.raw.includes('<!-- CLUB_MEMBER_') && !currentPage.raw.includes('<!-- CLUB_MEMBER_'),
      { home: orderIn(currentHome.raw), leaderboard: orderIn(currentPage.raw) });
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const occurrences = (source, text) => source.split(text).length - 1;
    check('8: one dispatcher and one nav-state read serve all six routes',
      occurrences(serverSource, 'function loadClubMemberNavState(') === 1 &&
      occurrences(serverSource, 'await loadClubMemberNavState(club.id)') === 1 &&
      serverSource.includes("BASE + '/clubs/member/:clubId/:section'") &&
      occurrences(serverSource, "app.get(BASE + '/clubs/member/:clubId/leaderboard'") === 0,
      {
        definitions: occurrences(serverSource, 'function loadClubMemberNavState('),
        routeCalls: occurrences(serverSource, 'await loadClubMemberNavState(club.id)')
      });
    const routeStart = serverSource.indexOf("BASE + '/clubs/member/:clubId/:section'");
    const routeEnd = serverSource.indexOf("// ── CLUB MEMBER HOME DATA", routeStart);
    const finalMembershipCheck = 'if (!await getCurrentClubMembership(req.user.id, req.params.clubId))';
    check('8: dispatcher revalidates membership after async shell reads',
      occurrences(serverSource.slice(routeStart, routeEnd), finalMembershipCheck) === 1,
      { rechecks: occurrences(serverSource.slice(routeStart, routeEnd), finalMembershipCheck) });
    check('8: both existing mobile member nav variants keep their item sets',
      serverSource.includes("bnItem(activeKey, 'overview'") &&
      serverSource.includes("bnItem(activeKey, 'announcements'") &&
      serverSource.includes("bnItem(activeKey, 'challenges'") &&
      serverSource.includes("bnItem(activeKey, 'events'") &&
      serverSource.includes("bnItem(activeKey, 'members'") &&
      serverSource.includes("bnItem(null, 'club', \"nav('/clubs/member/'") &&
      serverSource.includes("bnItem('ranks', 'ranks', \"nav('/clubs/member/'"),
      null);
    const emptyHome = await page('manager', '/clubs/member/' + clubB);
    const emptyBoard = await page('manager', '/clubs/member/' + clubB + '/leaderboard');
    const emptyAnnouncements = await page('manager', '/clubs/member/' + clubB + '/announcements');
    const emptyChallenges = await page('manager', '/clubs/member/' + clubB + '/challenges');
    const emptyEvents = await page('manager', '/clubs/member/' + clubB + '/events');
    const hasOnlyRequiredMemberNav = (raw) =>
      raw.includes('id="club-tab-overview"') &&
      raw.includes('id="club-tab-leaderboard"') &&
      raw.includes('id="club-tab-members"') &&
      !raw.includes('id="club-tab-announcements"') &&
      !raw.includes('id="club-tab-challenges"') &&
      !raw.includes('id="club-tab-events"');
    check('8: shared false-state hides all optional tabs on both pages',
      hasOnlyRequiredMemberNav(emptyHome.raw) && hasOnlyRequiredMemberNav(emptyBoard.raw),
      { homeStatus: emptyHome.status, boardStatus: emptyBoard.status });
    check('8: direct unavailable optional routes redirect to Overview',
      [emptyAnnouncements, emptyChallenges, emptyEvents].every((result) =>
        result.status === 302 && result.location === '/html/clubs/member/' + clubB),
      [emptyAnnouncements, emptyChallenges, emptyEvents].map((r) => ({ status: r.status, location: r.location })));
  }
  await verifyMemberShellInBrowser(clubA);
  await admin.from('memberships').delete().eq('club_id', clubA).eq('user_id', users.viewer.id);
  const removedApi = await api('viewer', 'GET', '/clubs/' + clubA + '/leaderboard');
  const removedPage = await page('viewer', '/clubs/member/' + clubA + '/leaderboard');
  const removedHome = await page('viewer', '/clubs/member/' + clubA);
  check('8: removed member fails closed on API and page',
    removedApi.status === 404 && removedPage.status === 404,
    { api: removedApi.status + ':' + removedApi.raw, page: removedPage.status + ':' + removedPage.raw });
  check('8: removed member cannot receive member-home shell',
    removedHome.status === 302 && removedHome.location === '/html/feed',
    { status: removedHome.status, location: removedHome.location });

  // 9: guard the independent overall board and server's canonical branch.
  const htmlRoot = path.join(__dirname, '..');
  const globalSource = fs.readFileSync(path.join(htmlRoot, 'html', 'arenas-leaderboards.html'), 'utf8');
  const serverSource = fs.readFileSync(path.join(htmlRoot, 'server.js'), 'utf8');
  check('9: global leaderboard is platform-only with week/month/all periods',
    /state\s*=\s*\{\s*period:\s*'week'\s*\}/.test(globalSource) &&
    globalSource.includes("setPeriod('week', this)") &&
    globalSource.includes("setPeriod('month', this)") &&
    globalSource.includes("setPeriod('alltime', this)") &&
    globalSource.includes('/api/leaderboard/platform?') &&
    !globalSource.includes('/api/leaderboard/following') &&
    !globalSource.includes('/api/leaderboard/club'), null);
  check('9: canonical server period branch and future cap still exist',
    serverSource.includes("if (period === 'week')") &&
    serverSource.includes('weekStartKey(now, zone)') &&
    serverSource.includes("fetchActivitiesForUsers(") &&
    serverSource.includes("{ capAtNow: true }") &&
    !serverSource.includes("app.get(BASE + '/api/leaderboard/following'") &&
    !serverSource.includes("app.get(BASE + '/api/leaderboard/club'"), null);
  const apiStart = serverSource.indexOf("app.get(BASE + '/api/clubs/:clubId/leaderboard'");
  const apiEnd = serverSource.indexOf("// Club dashboard leaderboard", apiStart);
  const pageStart = serverSource.indexOf("BASE + '/clubs/member/:clubId/:section'");
  const pageEnd = serverSource.indexOf("// ── CLUB MEMBER HOME DATA", pageStart);
  const countMembershipChecks = (source) => (source.match(/getCurrentClubMembership\(/g) || []).length;
  check('9: member API and page revalidate membership before send',
    countMembershipChecks(serverSource.slice(apiStart, apiEnd)) === 2 &&
    countMembershipChecks(serverSource.slice(pageStart, pageEnd)) === 2, null);
}

(async () => {
  let created = [];
  try {
    await run();
  } catch (err) {
    failures++;
    console.log('FAIL  fatal — ' + err.message);
  } finally {
    created = records.slice();
    for (const user of Object.values(users)) {
      if (!user.cookie) continue;
      try {
        await fetch(BASE_URL + '/auth/logout', {
          redirect: 'manual',
          headers: { Cookie: user.cookie }
        });
      } catch (err) {}
    }
    try {
      await cleanupEntries(created);
      fs.rmSync(MANIFEST, { force: true });
      await verifyClean(created);
    } catch (err) {
      failures++;
      console.log('FAIL  cleanup — ' + err.message);
    }
    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
    process.exitCode = failures ? 1 : 0;
  }
})();