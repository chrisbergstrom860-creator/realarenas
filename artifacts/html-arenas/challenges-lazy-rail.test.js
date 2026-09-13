'use strict';

// Offline contract tests for the lazy Friends-in-challenges rail. These tests
// exercise the production client guard and inspect the production route source;
// no server, browser, auth session, or Supabase connection is required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const htmlSource = fs.readFileSync(
  path.join(__dirname, 'html/arenas-challenges.html'),
  'utf8'
);
const serverSource = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

function railClientSource() {
  const start = htmlSource.indexOf('  function friendsRailIsVisible()');
  const end = htmlSource.indexOf('  window.loadChallenges = async function ()', start);
  assert.ok(start >= 0 && end > start, 'lazy rail client block must exist');
  return htmlSource.slice(start, end);
}

function makeRailHarness(width, fetchImpl) {
  const listeners = {};
  const renders = [];
  const context = {
    B: '/html',
    fetch: fetchImpl,
    renderFriendsCard(result) { renders.push(result); },
    window: {
      innerWidth: width,
      addEventListener(type, listener) { listeners[type] = listener; }
    }
  };
  vm.runInNewContext(`
    let friendsRailLoaded = false;
    let friendsRailInflight = false;
    let primaryChallengesRendered = true;
    ${railClientSource()}
    this.runFriendsRail = loadFriendsRail;
  `, context);
  return { context, listeners, renders };
}

function okResponse(body) {
  return {
    ok: true,
    async json() { return body; }
  };
}

test('mobile viewport never requests the hidden rail', async () => {
  let requests = 0;
  const harness = makeRailHarness(768, async () => {
    requests++;
    return okResponse({ friendsInChallenges: [], followsAnyone: false });
  });

  await harness.context.runFriendsRail();
  assert.equal(requests, 0);
  assert.equal(harness.renders.length, 0, 'mobile keeps the initial loading placeholder');
});

test('resizing from mobile to desktop performs exactly one rail load', async () => {
  let requests = 0;
  const harness = makeRailHarness(600, async (url) => {
    requests++;
    assert.equal(url, '/html/api/challenges/friends-rail');
    return okResponse({ friendsInChallenges: [], followsAnyone: true });
  });

  await harness.context.runFriendsRail();
  harness.context.window.innerWidth = 769;
  harness.listeners.resize();
  // The resize listener intentionally does not return its async work.
  await new Promise((resolve) => setImmediate(resolve));
  harness.listeners.resize();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(requests, 1);
  assert.equal(harness.renders.length, 1);
  assert.equal(harness.renders[0].followsAnyone, true);
});

test('desktop rail rendering waits for its endpoint while primary cards remain independent', async () => {
  let resolveFetch;
  const pending = new Promise((resolve) => { resolveFetch = resolve; });
  const harness = makeRailHarness(1280, () => pending);
  const railPromise = harness.context.runFriendsRail();

  assert.equal(harness.renders.length, 0, 'rail must not render before its response');
  resolveFetch(okResponse({ friendsInChallenges: [{ id: 'friend' }], followsAnyone: true }));
  await railPromise;
  assert.deepEqual(harness.renders, [{ friendsInChallenges: [{ id: 'friend' }], followsAnyone: true }]);

  const primaryStart = htmlSource.indexOf('  window.loadChallenges = async function ()');
  const primary = htmlSource.slice(primaryStart, htmlSource.indexOf('  // ── JOIN / LEAVE / LEADERBOARD', primaryStart));
  assert.ok(primary.indexOf('renderSidebar(result);') < primary.indexOf('primaryChallengesRendered = true;'));
  assert.ok(primary.indexOf('primaryChallengesRendered = true;') < primary.indexOf('loadFriendsRail();'));
});

test('rail failure renders its empty state and never becomes a main-column error or duplicate request', async () => {
  let requests = 0;
  const harness = makeRailHarness(1280, async () => {
    requests++;
    throw new Error('rail unavailable');
  });

  await harness.context.runFriendsRail();
  harness.listeners.resize();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(requests, 1);
  assert.equal(harness.renders.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.renders[0])), {});
});

test('main route removes the rail keys and follows read; authenticated endpoint reuses the rail helper', () => {
  const mainStart = serverSource.indexOf("app.get(BASE + '/api/challenges', requireAuth");
  const railStart = serverSource.indexOf("app.get(BASE + '/api/challenges/friends-rail', requireAuth");
  const createStart = serverSource.indexOf("app.post(BASE + '/api/challenges/create", railStart);
  assert.ok(mainStart >= 0 && railStart > mainStart && createStart > railStart);

  const main = serverSource.slice(mainStart, railStart);
  const rail = serverSource.slice(railStart, createStart);
  assert.doesNotMatch(main, /\bfriendsInChallenges\b|\bfollowsAnyone\b/);
  assert.doesNotMatch(main, /\.from\('follows'\)/);
  assert.match(rail, /requireAuth/);
  assert.match(rail, /buildFriendsInChallengesRail\(/);
  assert.match(rail, /readFollowing:/);
  assert.match(rail, /return res\.json\(\{ friendsInChallenges: \[\], followsAnyone: false \}\)/);
  assert.match(rail, /return res\.json\(rail\)/);
});