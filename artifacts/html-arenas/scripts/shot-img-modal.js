// Screenshots the events image manager open at 1280px and 380px.
//   node scripts/shot-img-modal.js <label>   → screenshots/img-modal-<label>-{1280,380}.png
import { launchBrowser } from './lib/mobile-geometry.js';

const BASE = 'http://localhost:80/html';
const label = process.argv[2] || 'shot';
const browser = await launchBrowser();
for (const width of [1280, 380]) {
  const page = await (await browser.newContext({ viewport: { width, height: 800 } })).newPage();
  await page.goto(BASE + '/landing', { waitUntil: 'domcontentloaded' });
  for (const s of ['arenas-overlay.js', 'arenas-crop.js', 'arenas-event-form.js']) {
    await page.addScriptTag({ url: BASE + '/' + s }).catch(() => {});
  }
  await page.evaluate(() => window.arenasEventForm.manageImage({ id: '00000000-0000-4000-8000-000000000000', image: null }, {}));
  await page.waitForSelector('#evx-img-modal');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `screenshots/img-modal-${label}-${width}.png` });
  console.log(`saved screenshots/img-modal-${label}-${width}.png`);
}
await browser.close();
