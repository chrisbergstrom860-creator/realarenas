// In-memory lifecycle contract for the extracted Insights module.  This is a
// Node test rather than a seeded/live verifier: it only loads the real browser
// module and deterministic Response fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './lib/mobile-geometry.js';
import {
  currentCss,
  currentModule,
  proofFixtures,
  setProofPage,
  submitProofFixture
} from './lib/insights-proof.js';

test('ArenasInsights shares page history and ignores an in-flight result after unmount', async (t) => {
  let browser;
  try {
    const moduleSource = currentModule();
    const css = currentCss();
    browser = await launchBrowser();
    const page = await browser.newPage();

    await setProofPage(page, { css, moduleSource, width: 414 });
    await submitProofFixture(page, proofFixtures.daily);

    await page.evaluate((source) => {
      const second = document.createElement('div');
      second.id = 'second-insights-proof-host';
      document.body.append(second);
      window.ArenasInsights.mount(second, { base: '', proEntitled: true });
    }, moduleSource);
    const second = page.locator('#second-insights-proof-host');
    await second.locator('textarea').waitFor();
    await page.evaluate((fixture) => { window.__insightsProofFixture = fixture; }, proofFixtures.stackedWeekly);
    await second.locator('textarea').fill(proofFixtures.stackedWeekly.question);
    await second.locator('form').evaluate((form) => form.requestSubmit());
    // The shared first turn is rendered on mount; the second SVG proves the
    // second mount's own submission completed.
    await second.locator('svg[role="img"]').last().waitFor();
    const requests = await page.evaluate(() => window.__insightsProofRequests);
    assert.equal(requests.length, 2, 'one request must be made by each mount');
    assert.equal(requests[1].history.length, 1,
      'the second mount must submit the first mount’s signed in-page history');

    await page.evaluate(() => {
      const host = document.getElementById('second-insights-proof-host');
      window.__inflightStarted = false;
      window.__inflightResolve = null;
      window.fetch = async (url, init = {}) => {
        if (new URL(String(url), 'http://insights-proof.invalid').pathname.endsWith('/ai-insights')) {
          window.__inflightStarted = true;
          return new Promise((resolve) => {
            window.__inflightResolve = () => resolve(new Response(JSON.stringify({
              answer: 'This must not render after unmount.',
              historyTurn: { question: 'late', answer: 'late', token: 'late' },
              usage: { used: 4, limit: 30, remaining: 26, resetDate: '2026-10-01' }
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
          });
        }
        throw new Error(`Unexpected lifecycle request: ${url}`);
      };
      host.querySelector('textarea').value = 'Keep this response in flight.';
      host.querySelector('form').requestSubmit();
    });
    await page.waitForFunction(() => window.__inflightStarted === true);
    const beforeUnmount = await second.innerHTML();
    await page.evaluate(() => {
      window.ArenasInsights.unmount(document.getElementById('second-insights-proof-host'));
      window.__inflightResolve();
    });
    await page.waitForTimeout(25);
    assert.equal(await second.innerHTML(), beforeUnmount,
      'an in-flight response must not mutate an unmounted container');
    await page.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});