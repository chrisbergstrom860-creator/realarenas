#!/usr/bin/env node
'use strict';

// Live browser proof, intentionally separate from node --test and geometry
// guards because it owns the shared fixture manifest until finally cleanup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startMobileFixture } = require('./lib/challenges-equivalence');

async function main() {
  let fixture;
  let browser;
  let releaseRail = () => {};
  try {
    fixture = await startMobileFixture();
    const cookies = await fixture.loginCreator();
    const { launchBrowser } = await import('./lib/mobile-geometry.js');
    browser = await launchBrowser();
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.addCookies(cookies);
    const base = `https://${process.env.REPLIT_DEV_DOMAIN}/html`;
    const railURL = '**/api/challenges/friends-rail';
    const page = await context.newPage();
    const railGate = new Promise((resolve) => { releaseRail = resolve; });
    let desktopRequests = 0;
    await page.route(railURL, async (route) => {
      desktopRequests++;
      const response = await route.fetch();
      await railGate;
      await route.fulfill({ response });
    });
    const began = Date.now();
    await page.goto(base + '/challenges', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#tab-mine .challenge-card', { timeout: 20000 });
    const cardsMs = Date.now() - began;
    assert.match(await page.locator('#friends-body').innerText(), /Loading/);
    assert.equal(await page.locator('#friends-body .friend-row').count(), 0);
    fs.mkdirSync('/tmp/challenges-lazy-proof', { recursive: true });
    await page.screenshot({ path: '/tmp/challenges-lazy-proof/cards-first.jpg' });
    releaseRail();
    await page.waitForSelector('#friends-body .friend-row', { timeout: 20000 });
    const railMs = Date.now() - began;
    assert.equal(desktopRequests, 1);
    assert.ok(railMs >= cardsMs);
    await page.screenshot({ path: '/tmp/challenges-lazy-proof/rail-loaded.jpg' });
    console.log(`PASS desktop 1280: cards visible at ${cardsMs} ms; rail released/rendered at ${railMs} ms; one rail request (response deliberately held for screenshot)`);

    const mobile = await context.newPage();
    await mobile.setViewportSize({ width: 768, height: 1000 });
    let mobileRequests = 0;
    mobile.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/api/challenges/friends-rail')) mobileRequests++;
    });
    await mobile.goto(base + '/challenges', { waitUntil: 'networkidle' });
    await mobile.waitForSelector('#tab-mine .challenge-card');
    assert.equal(mobileRequests, 0, 'hidden rail must not request data at 768px');
    await mobile.setViewportSize({ width: 1280, height: 1000 });
    await mobile.waitForSelector('#friends-body .friend-row', { timeout: 20000 });
    assert.equal(mobileRequests, 1);
    await mobile.setViewportSize({ width: 700, height: 1000 });
    await mobile.setViewportSize({ width: 1280, height: 1000 });
    await mobile.waitForTimeout(150);
    assert.equal(mobileRequests, 1, 'resize must not fetch an already loaded rail');
    console.log('PASS mobile/resize: zero rail requests at 768px; one on becoming visible; no repeat');

    const failed = await context.newPage();
    await failed.route(railURL, (route) => route.fulfill({
      status: 503, contentType: 'application/json', body: '{"error":"test rail failure"}'
    }));
    await failed.goto(base + '/challenges', { waitUntil: 'networkidle' });
    await failed.waitForSelector('#tab-mine .challenge-card');
    assert.equal(await failed.locator('#friends-body .friend-row').count(), 0);
    assert.match(await failed.locator('#friends-body').innerText(), /Follow other athletes|No one you follow/);
    assert.ok(await failed.locator('#tab-mine .challenge-card').count());
    console.log('PASS failure: existing rail empty state; primary challenge cards remain rendered');
  } finally {
    releaseRail();
    if (browser) await browser.close();
    if (fixture) {
      await fixture.cleanup();
      console.log('fixture cleanup: complete');
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}