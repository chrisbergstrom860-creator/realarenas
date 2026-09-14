// In-memory browser lifecycle contract for the mobile AI Insights sheet.
// It uses the production overlay, Insights module, sheet script, and shared
// stylesheet, but never opens the application server or creates fixture data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './lib/mobile-geometry.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = resolve(root, 'html');
const css = readFileSync(resolve(html, 'arenas.css'), 'utf8');
const overlaySource = readFileSync(resolve(html, 'arenas-overlay.js'), 'utf8');
const insightsSource = readFileSync(resolve(html, 'arenas-insights.js'), 'utf8');
const sheetSource = readFileSync(resolve(html, 'arenas-insights-sheet.js'), 'utf8');

function fixtureMarkup(profile) {
  return `<!doctype html>
<html><head><style>${css}</style></head>
<body>
  <main style="height:1600px">Fixture page content</main>
  <nav class="bottom-nav" aria-label="Bottom navigation"></nav>
  <button type="button" class="bn-fab bn-fab-ai" aria-label="Ask AI Insights">✦</button>
  ${profile ? `<div class="htab" id="htab-insights" onclick="setTab('insights')">AI Insights</div>
  <section id="tab-insights"></section>` : ''}
</body></html>`;
}

async function installFixture(page, { profile = false, deferredInitial = false, visualViewport } = {}) {
  await page.setContent(fixtureMarkup(profile));
  await page.evaluate(({ deferredInitial: holdStatus, visualViewport: syntheticViewport }) => {
    window.__sheetMounts = 0;
    window.__statusRequests = 0;
    window.__answerRequests = 0;
    window.__holdStatus = holdStatus;
    window.__resolveStatus = null;
    window.__resolveAnswer = null;

    if (syntheticViewport) {
      const target = new EventTarget();
      target.height = syntheticViewport.height;
      target.offsetTop = syntheticViewport.offsetTop;
      target.emit = (type) => target.dispatchEvent(new Event(type));
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: target });
    } else if (syntheticViewport === null) {
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
    }

    const response = (data) => new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    const status = {
      used: 0, limit: 30, remaining: 30, resetDate: '2027-01-01'
    };
    const hero = {
      stats: [],
      suggestions: [{ category: 'Training', icon: 'hours', question: 'How much have I trained?' }]
    };
    window.fetch = (url, init = {}) => {
      const path = new URL(String(url), 'http://sheet-fixture.test').pathname;
      if (path.endsWith('/ai-insights/status')) {
        window.__statusRequests += 1;
        if (window.__holdStatus) {
          return new Promise((resolve) => {
            window.__resolveStatus = () => resolve(response(status));
          });
        }
        return Promise.resolve(response(status));
      }
      if (path.endsWith('/ai-insights/hero-stats')) return Promise.resolve(response(hero));
      if (path.endsWith('/ai-insights')) {
        window.__answerRequests += 1;
        return new Promise((resolve) => {
          window.__resolveAnswer = () => resolve(response({
            answer: 'The response arrived after the sheet was closed.',
            historyTurn: { question: 'Pending response', answer: 'The response arrived after the sheet was closed.', token: 'sheet-test' },
            usage: { used: 1, limit: 30, remaining: 29, resetDate: '2027-01-01' }
          }));
        });
      }
      throw new Error('Unexpected fixture request: ' + String(url) + ' ' + String(init.method || 'GET'));
    };
  }, { deferredInitial, visualViewport });

  await page.addScriptTag({ content: overlaySource });
  await page.addScriptTag({ content: insightsSource });
  await page.evaluate(() => {
    const realMount = window.ArenasInsights.mount;
    window.ArenasInsights.mount = function () {
      window.__sheetMounts += 1;
      return realMount.apply(this, arguments);
    };
    if (document.getElementById('htab-insights')) {
      window.__profileSetTabCalls = 0;
      window.__profileLazyLoads = 0;
      window.__profilePanelScrolls = 0;
      window.setTab = function (tab) {
        if (tab === 'insights') window.__profileSetTabCalls += 1;
      };
      document.getElementById('tab-insights').scrollIntoView = function () {
        window.__profilePanelScrolls += 1;
      };
      document.getElementById('htab-insights').addEventListener('click', function () {
        window.__profileLazyLoads += 1;
        window.ArenasInsights.mount(document.getElementById('tab-insights'), {
          base: '',
          proEntitled: true
        });
      });
    }
  });
  await page.addScriptTag({ content: sheetSource });
}

async function clickFab(page) {
  await page.evaluate(() => document.querySelector('.bn-fab-ai').click());
}

async function waitForOpen(page) {
  await page.waitForFunction(() => {
    const overlay = document.getElementById('ai-insights-sheet');
    return !!overlay && overlay.classList.contains('ai-sheet-backdrop') &&
      !!overlay.querySelector('.ai-sheet');
  });
}

async function closeSheet(page) {
  await page.locator('.ai-sheet-close').click();
  await page.waitForFunction(() => !document.getElementById('ai-insights-sheet'));
}

test('mobile Insights sheet mounts visibly once, retains pending work, and owns focus lifecycle', async () => {
  let browser;
  try {
    browser = await launchBrowser();
    const context = await browser.newContext({ viewport: { width: 414, height: 840 } });
    const page = await context.newPage();
    await installFixture(page, { deferredInitial: true });

    assert.equal(await page.evaluate(() => window.__sheetMounts), 0, 'sheet is not created or mounted before the FAB is used');
    await clickFab(page);
    await waitForOpen(page);
    assert.equal(await page.evaluate(() => window.__sheetMounts), 1, 'first mobile open creates one visible mount');
    assert.equal(await page.evaluate(() => document.querySelector('.ai-sheet').parentElement.id), 'ai-insights-sheet',
      'the node is adopted into the overlay before mounting');

    await closeSheet(page);
    await page.waitForFunction(() => document.activeElement === document.querySelector('.bn-fab-ai'));
    await page.evaluate(() => window.__resolveStatus());
    await page.waitForTimeout(40);
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.bn-fab-ai')), true,
      'a delayed initial response cannot steal focus after close');

    await clickFab(page);
    await waitForOpen(page);
    await page.locator('.ai-sheet textarea').waitFor();
    await page.waitForFunction(() => document.activeElement === document.querySelector('.ai-sheet textarea'));
    assert.equal(await page.evaluate(() => window.__sheetMounts), 1, 'reopen reuses the original Insights mount');

    // Tab wraps in both directions, including when focus starts outside the
    // sheet (the browser can do this through assistive technology or scripts).
    const forward = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.ai-sheet button, .ai-sheet textarea')]
        .filter((node) => node.getClientRects().length > 0 && !node.disabled);
      window.__sheetFirst = nodes[0];
      window.__sheetLast = nodes[nodes.length - 1];
      window.__sheetLast.focus();
      return nodes.length > 1;
    });
    assert.equal(forward, true, 'fixture exposes more than one visible sheet control');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement === window.__sheetFirst), true, 'forward Tab wraps to first visible control');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement === window.__sheetLast), true, 'backward Tab wraps to last visible control');
    await page.evaluate(() => document.querySelector('.bn-fab-ai').focus());
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement === window.__sheetFirst), true,
      'Tab entering from outside is trapped at the first visible sheet control');

    await page.locator('.ai-sheet textarea').fill('Pending response');
    await page.locator('.ai-sheet form').evaluate((form) => form.requestSubmit());
    await page.waitForFunction(() => window.__answerRequests === 1);
    await closeSheet(page);
    await page.waitForFunction(() => document.activeElement === document.querySelector('.bn-fab-ai'));
    await page.evaluate(() => window.__resolveAnswer());
    await page.waitForTimeout(40);
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.bn-fab-ai')), true,
      'a pending answer rendered while closed does not take focus');

    await clickFab(page);
    await page.locator('.ai-sheet').getByText('The response arrived after the sheet was closed.').waitFor();
    assert.equal(await page.evaluate(() => window.__sheetMounts), 1, 'answer retention does not remount the module');
    await closeSheet(page);
    await page.waitForFunction(() => document.activeElement === document.querySelector('.bn-fab-ai'));
    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

test('sheet uses visualViewport geometry, innerHeight fallback, and closes on desktop resize', async () => {
  let browser;
  try {
    browser = await launchBrowser();
    const context = await browser.newContext({ viewport: { width: 414, height: 840 } });
    const page = await context.newPage();
    await installFixture(page, { visualViewport: { height: 420, offsetTop: 30 } });
    await clickFab(page);
    await page.locator('.ai-sheet textarea').waitFor();
    await page.waitForTimeout(30);
    const syntheticGeometry = await page.evaluate(() => {
      const sheet = document.querySelector('.ai-sheet');
      const body = document.querySelector('.ai-sheet-body');
      const form = body.querySelector('form');
      const formRect = form.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      return {
        maxHeight: sheet.style.maxHeight,
        bottom: sheet.style.bottom,
        composerBottom: formRect.bottom,
        visibleBottom: Math.min(bodyRect.bottom, 450)
      };
    });
    assert.equal(syntheticGeometry.maxHeight, '420px', 'max height follows the synthetic visual viewport');
    assert.equal(syntheticGeometry.bottom, '390px', 'bottom follows layoutHeight - visualViewport offset and height');
    assert.ok(syntheticGeometry.composerBottom <= syntheticGeometry.visibleBottom + 1,
      'the complete composer, including Ask, remains inside the body and visual viewport');

    await page.setViewportSize({ width: 769, height: 840 });
    await page.waitForFunction(() => !document.getElementById('ai-insights-sheet'));
    await context.close();

    const fallbackContext = await browser.newContext({ viewport: { width: 414, height: 840 } });
    const fallback = await fallbackContext.newPage();
    await installFixture(fallback, { visualViewport: null });
    await clickFab(fallback);
    await fallback.locator('.ai-sheet textarea').waitFor();
    await fallback.evaluate(() => window.dispatchEvent(new Event('resize')));
    await fallback.waitForTimeout(30);
    const fallbackGeometry = await fallback.evaluate(() => {
      const sheet = document.querySelector('.ai-sheet');
      return { maxHeight: sheet.style.maxHeight, bottom: sheet.style.bottom };
    });
    assert.equal(fallbackGeometry.maxHeight, '772.8px', 'without visualViewport max height uses innerHeight');
    assert.equal(fallbackGeometry.bottom, '0px', 'without visualViewport the sheet remains layout-bottom aligned');
    await fallbackContext.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

test('desktop FAB is a no-op and profile FAB uses the existing tab click path', async () => {
  let browser;
  try {
    browser = await launchBrowser();
    const desktop = await browser.newContext({ viewport: { width: 900, height: 840 } });
    const desktopPage = await desktop.newPage();
    await installFixture(desktopPage);
    const before = await desktopPage.url();
    await clickFab(desktopPage);
    await desktopPage.waitForTimeout(25);
    assert.equal(await desktopPage.url(), before, 'desktop click does not invent navigation');
    assert.equal(await desktopPage.evaluate(() => !!document.querySelector('.ai-sheet')), false, 'desktop click does not create a sheet');
    assert.equal(await desktopPage.evaluate(() => window.__sheetMounts), 0, 'desktop click does not mount Insights');
    await desktop.close();

    const profile = await browser.newContext({ viewport: { width: 414, height: 840 } });
    const profilePage = await profile.newPage();
    await installFixture(profilePage, { profile: true });
    await clickFab(profilePage);
    await profilePage.waitForFunction(() => window.__profileLazyLoads === 1);
    await profilePage.waitForTimeout(25);
    const profileState = await profilePage.evaluate(() => ({
      setTab: window.__profileSetTabCalls,
      lazy: window.__profileLazyLoads,
      scrolls: window.__profilePanelScrolls,
      mounts: window.__sheetMounts,
      sheet: !!document.querySelector('.ai-sheet')
    }));
    assert.deepEqual(profileState, { setTab: 1, lazy: 1, scrolls: 1, mounts: 1, sheet: false },
      'profile activates inline setTab plus its lazy tab listener, without a sheet/direct mount');
    await profile.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});