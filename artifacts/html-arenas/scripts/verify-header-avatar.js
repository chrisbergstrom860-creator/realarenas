// E2E for the enlarged profile header avatar (LinkedIn-scale):
//  - .hero-av renders 152px @1280 and 112px @360/380/414 (initials 50/38px).
//  - No collision/overflow of name/handle/stats beside the avatar (long-name
//    seed), no page-level horizontal overflow at any phone width, header does
//    not push content down excessively on mobile (tab bar reachable in one
//    viewport-ish scroll).
//  - Upload + replace still work from the header (photo modal); stored file
//    is now 512x512 WebP (pipeline raised from 256).
//  - Scope: shared avatar surfaces (topbar circle, feed rows) UNCHANGED.
// Fixture: one user, seeding in try, full cleanup in finally.
import { launchBrowser } from './lib/mobile-geometry.js';
import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const sharp = require_(path.join(__dirname, '..', 'node_modules', 'sharp'));

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DOMAIN = process.env.REPLIT_DEV_DOMAIN;
const BASE_URL = `https://${DOMAIN}/html`;
const EMAIL = 'vha-header@arenas-test.dev';
const PW = 'ArenasTest!234';

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

async function loginCookies(email) {
  const r = await fetch(BASE_URL + '/auth/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(PW)}`
  });
  const setC = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  const raw = (setC || []).filter(Boolean).map((c) => c.split(';')[0]);
  if (r.status !== 302 || !raw.length) throw new Error('login failed for ' + email);
  return raw.map((pair) => {
    const i = pair.indexOf('=');
    return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: DOMAIN, path: '/' };
  });
}

(async () => {
  let uid = null; let browser = null;
  try {
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of (data && data.users) || []) if (u.email === EMAIL) await admin.auth.admin.deleteUser(u.id);
    const { data: c, error } = await admin.auth.admin.createUser({
      email: EMAIL, password: PW, email_confirm: true,
      user_metadata: { name: 'Verylongfirstname Extraordinarilylongsurname', handle: 'vha_header_test', sports: ['tennis'] }
    });
    if (error) throw new Error('createUser: ' + error.message);
    uid = c.user.id;

    browser = await launchBrowser();
    const cookies = await loginCookies(EMAIL);
    const openAt = async (width, height) => {
      const context = await browser.newContext({ viewport: { width, height: height || 900 } });
      await context.addCookies(cookies);
      const page = await context.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`https://${DOMAIN}/html/profile`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.hero-av');
      return { context, page, errors };
    };

    // ── Size + layout at each required width ──
    const expectations = [[1280, 152, '50px'], [360, 112, '38px'], [380, 112, '38px'], [414, 112, '38px']];
    for (const [w, size, font] of expectations) {
      const { context, page, errors } = await openAt(w);
      const box = await page.locator('.hero-av').boundingBox();
      check(`@${w}: .hero-av is ${size}px`, Math.round(box.width) === size && Math.round(box.height) === size, `${box.width}x${box.height}`);
      const fs = await page.locator('.hero-av').evaluate((el) => getComputedStyle(el).fontSize);
      check(`@${w}: initials font-size ${font}`, fs === font, fs);
      const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`@${w}: no horizontal overflow`, overflowX <= 1, String(overflowX));
      // Name/handle/stats must not intersect the avatar (desktop row layout).
      if (w === 1280) {
        const av = box;
        for (const sel of ['.hero-name', '.hero-handle', '.hero-stats']) {
          const b = await page.locator(sel).first().boundingBox();
          const overlap = b && !(b.x >= av.x + av.width || b.x + b.width <= av.x || b.y >= av.y + av.height || b.y + b.height <= av.y);
          check(`@1280: ${sel} does not collide with avatar`, !overlap, JSON.stringify(b));
        }
      } else {
        // Mobile: useful content must not be pushed down excessively — the
        // tab bar (start of page content) should sit within ~1.6 viewports.
        const tabTop = await page.locator('.hero-tab-bar').evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
        check(`@${w}: tab bar within reach (top=${Math.round(tabTop)})`, tabTop < 900 * 1.6, String(tabTop));
      }
      check(`@${w}: zero console errors`, errors.length === 0, errors.join(' | '));
      await context.close();
    }

    // ── Scope: shared surfaces untouched ──
    {
      const { context, page } = await openAt(1280);
      const topbar = await page.evaluate(() => {
        const el = document.querySelector('[onclick*="userMenu"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return Math.round(r.width);
      });
      check('scope: topbar avatar circle still ≤48px', topbar !== null && topbar <= 48, String(topbar));
      await context.close();
    }

    // ── Upload + replace from the header; stored file is 512px ──
    {
      const { context, page, errors } = await openAt(1280);
      const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 30, b: 90 } } }).png().toBuffer();
      const doUpload = async (buf, fname) => {
        // The modal stays open after an upload — open it only if closed
        // (Escape doesn't close this overlay). Real-click when closed.
        const isOpen = await page.evaluate(() => document.querySelector('#modal-avatar-photo').classList.contains('open'));
        if (!isOpen) {
          await page.locator('.hero-av').click();
          await page.waitForSelector('#modal-avatar-photo.open', { state: 'attached' });
        }
        const [chooser] = await Promise.all([
          page.waitForEvent('filechooser'),
          page.locator('#ep-avatar-upload').click()
        ]);
        await chooser.setFiles({ name: fname, mimeType: 'image/png', buffer: buf });
        await page.waitForFunction(() => {
          const img = document.querySelector('.hero-av img');
          return img && img.src.includes('/avatars/');
        }, null, { timeout: 20000 });
      };
      await doUpload(png, 'first.png');
      const url1 = await page.locator('.hero-av img').getAttribute('src');
      check('upload: header shows uploaded photo', /\/avatars\/users\//.test(url1), url1);
      const meta1 = await sharp(Buffer.from(await (await fetch(url1)).arrayBuffer())).metadata();
      check('upload: stored file is 512x512 webp', meta1.width === 512 && meta1.height === 512 && meta1.format === 'webp', `${meta1.width}x${meta1.height} ${meta1.format}`);
      // Replace
      const png2 = await sharp({ create: { width: 700, height: 700, channels: 3, background: { r: 20, g: 120, b: 200 } } }).png().toBuffer();
      await doUpload(png2, 'second.png');
      await page.waitForFunction((old) => {
        const img = document.querySelector('.hero-av img');
        return img && img.src !== old;
      }, url1, { timeout: 20000 });
      const url2 = await page.locator('.hero-av img').getAttribute('src');
      check('replace: new versioned URL', url2 !== url1 && /\/avatars\/users\//.test(url2), url2);
      check('upload/replace: zero console errors', errors.length === 0, errors.join(' | '));
      await context.close();
    }
  } catch (e) {
    failures++;
    console.log('  FAIL (exception) ' + e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (uid) {
      const { data: objs } = await admin.storage.from('avatars').list('users/' + uid).catch(() => ({ data: null }));
      if (objs && objs.length) await admin.storage.from('avatars').remove(objs.map((o) => 'users/' + uid + '/' + o.name));
      await admin.from('activities').delete().eq('user_id', uid);
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
  }
  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})();
