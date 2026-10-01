// Browser behavior contract using only the isolated real-feed harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './lib/mobile-geometry.js';
import { sources, setProofPage, activities } from './lib/activity-card-proof.js';

test('feed/preview notes expand and collapse; feed kudos action retains its route and state', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    const source = sources();
    await setProofPage(page, source, 414);
    const start = source.feed.indexOf('async function likeActivity(');
    const end = source.feed.indexOf('// Posts are injected server-side', start);
    assert.ok(start >= 0 && end > start);
    await page.addScriptTag({ content: source.feed.slice(start, end) });
    await page.evaluate(() => {
      window.__requests = [];
      window.showToast = message => { throw new Error(message); };
      window.fetch = async (url, options) => {
        window.__requests.push({ url, method: options.method });
        return { json: async () => ({ liked: window.__requests.length > 1 }) };
      };
    });
    const kudos = page.locator('.pn-action').first();
    await kudos.click();
    await page.waitForFunction(() => document.querySelector('.pn-action').textContent === '👍 6 kudos');
    assert.equal(await kudos.evaluate(el => el.classList.contains('liked')), false);
    await kudos.click();
    await page.waitForFunction(() => document.querySelector('.pn-action').textContent === '👍 7 kudos');
    assert.equal(await kudos.evaluate(el => el.classList.contains('liked')), true);
    assert.deepEqual(await page.evaluate(() => window.__requests), [
      { url: '/html/api/activities/run/like', method: 'POST' },
      { url: '/html/api/activities/run/like', method: 'POST' }
    ]);
    for (const preview of [false, true]) {
      if (preview) {
        await page.evaluate(activity => {
          document.getElementById('feed-items').innerHTML = window.activityCardHtml(activity, { preview: true });
        }, activities[1]);
        assert.equal(await page.locator('#feed-items [data-athlete-link], #feed-items a, #feed-items .pn-footer').count(), 0);
        assert.ok((await page.locator('#feed-items').innerText()).includes('Just now · Swimming'));
      }
      const toggle = page.locator('.fa-notes-toggle').first();
      await toggle.click();
      assert.equal(await toggle.innerText(), 'Show less');
      assert.equal(await toggle.evaluate(el => el.previousElementSibling.classList.contains('clamped')), false);
      await toggle.click();
      assert.equal(await toggle.innerText(), 'Show more');
      assert.equal(await toggle.evaluate(el => el.previousElementSibling.classList.contains('clamped')), true);
    }
  } finally {
    await browser.close();
  }
});