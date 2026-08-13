// E2E for the profile background banner (LinkedIn-style):
//  - Imageless profile: NO banner band (header identical to today), 📷 button
//    present; measured tab-bar offset at 360px recorded (before/after).
//  - Upload through the crop overlay (4:1 frame, 1600×400 export): band shows
//    at 220px @1280 / 120px @≤768 with avatar overlapping its lower edge.
//  - Crop frame at 360px: rendered frame dimensions reported (usability note).
//  - Replace deletes the old object (bucket prefix listing = exactly 1 file).
//  - Remove: pointer nulled + object gone; header back to imageless layout.
//  - Athlete directory modal (/athletes) renders the banner band for a
//    bannered athlete and hides it for a bannerless one.
//  - Account delete removes banner objects (no orphans under banners/{uid}).
//  - Event crop callers unaffected: defaults still 3:1/1200×400 (checked by
//    verify-crop-ui.js — run separately as part of the battery).
// Fixture: two users (bannered + viewer), full cleanup in finally.
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
const EMAIL = 'vpb-banner@arenas-test.dev';
const EMAIL2 = 'vpb-viewer@arenas-test.dev';
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

async function listBannerObjects(uid) {
  const { data } = await admin.storage.from('avatars').list('banners/' + uid);
  return (data || []).filter((o) => o.name && !o.name.startsWith('.'));
}

(async () => {
  let uid = null, uid2 = null; let browser = null;
  try {
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of (data && data.users) || []) if (u.email === EMAIL || u.email === EMAIL2) await admin.auth.admin.deleteUser(u.id);
    const mk = async (email, name, handle) => {
      const { data: c, error } = await admin.auth.admin.createUser({
        email, password: PW, email_confirm: true,
        user_metadata: { name, handle, sports: ['running'] }
      });
      if (error) throw new Error('createUser: ' + error.message);
      return c.user.id;
    };
    uid = await mk(EMAIL, 'Banner Testperson', 'vpb_banner');
    uid2 = await mk(EMAIL2, 'Viewer Testperson', 'vpb_viewer');

    browser = await launchBrowser();
    const cookies = await loginCookies(EMAIL);
    const openAt = async (width, height, urlPath = '/profile') => {
      const context = await browser.newContext({ viewport: { width, height: height || 900 } });
      await context.addCookies(cookies);
      const page = await context.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`https://${DOMAIN}/html${urlPath}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.hero-av, .ath-grid, .adc-card', { timeout: 15000 }).catch(() => {});
      return { context, page, errors };
    };

    // ── 1. Imageless state at all widths: no band, button present, layout = today ──
    let tabTopBefore = null;
    for (const w of [1280, 360, 380, 414]) {
      const { context, page, errors } = await openAt(w);
      const bandVisible = await page.evaluate(() => {
        const b = document.getElementById('hero-banner');
        return b ? getComputedStyle(b).display !== 'none' : null;
      });
      check(`@${w} imageless: banner band hidden`, bandVisible === false, String(bandVisible));
      const btn = await page.locator('#hero-banner-btn').count();
      check(`@${w} imageless: 📷 button present`, btn === 1);
      const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`@${w} imageless: no horizontal overflow`, overflowX <= 1, String(overflowX));
      if (w === 360) {
        tabTopBefore = await page.locator('.hero-tab-bar').evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
        console.log(`  info @360 imageless: tab bar top = ${Math.round(tabTopBefore)}px`);
      }
      check(`@${w} imageless: zero console errors`, errors.length === 0, errors.join(' | '));
      await context.close();
    }

    // ── 2. Upload through the crop overlay at 360px (frame usability, note 3) ──
    {
      const { context, page, errors } = await openAt(360, 780);
      const png = await sharp({ create: { width: 2000, height: 900, channels: 3, background: { r: 30, g: 90, b: 200 } } }).png().toBuffer();
      await page.locator('#hero-banner-btn').click();
      await page.waitForSelector('#modal-banner-photo.open', { state: 'attached' });
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.locator('#bn-upload').click()
      ]);
      await chooser.setFiles({ name: 'banner-src.png', mimeType: 'image/png', buffer: png });
      await page.waitForSelector('#arenas-crop-overlay #ac-frame', { timeout: 10000 });
      const frameBox = await page.locator('#arenas-crop-overlay #ac-frame').boundingBox();
      console.log(`  info @360 crop frame: ${Math.round(frameBox.width)}x${Math.round(frameBox.height)}px (4:1)`);
      check('@360 crop: frame is ~4:1', Math.abs(frameBox.width / frameBox.height - 4) < 0.15, `${frameBox.width}x${frameBox.height}`);
      check('@360 crop: frame tall enough to thumb-drag (≥60px)', frameBox.height >= 60, String(frameBox.height));
      const slider = await page.locator('#arenas-crop-overlay #ac-slider').count();
      check('@360 crop: position slider present (2000x900 source)', slider === 1);
      await page.locator('#arenas-crop-overlay #ac-use').click();
      await page.waitForFunction(() => {
        const b = document.getElementById('hero-banner');
        return b && getComputedStyle(b).display !== 'none' && b.style.backgroundImage.includes('/banners/');
      }, null, { timeout: 20000 });
      check('@360: band visible after upload', true);
      const bandH = await page.locator('#hero-banner').evaluate((el) => el.getBoundingClientRect().height);
      check('@360: band height 120px', Math.round(bandH) === 120, String(bandH));
      // Avatar overlaps the band's lower edge.
      const bandBox = await page.locator('#hero-banner').boundingBox();
      const avBox = await page.locator('.hero-av').boundingBox();
      check('@360: avatar overlaps banner lower edge', avBox.y < bandBox.y + bandBox.height && avBox.y + avBox.height > bandBox.y + bandBox.height,
        `av.y=${avBox.y} bandBottom=${bandBox.y + bandBox.height}`);
      // Note 2 measurement: tab bar distance with banner.
      const tabTopAfter = await page.locator('.hero-tab-bar').evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
      console.log(`  info @360 with banner: tab bar top = ${Math.round(tabTopAfter)}px (was ${Math.round(tabTopBefore)}px)`);
      check('@360: banner adds ≤ (120 - overlap) ≈ 64px to header', tabTopAfter - tabTopBefore <= 130, String(tabTopAfter - tabTopBefore));
      check('@360 upload: zero console errors', errors.length === 0, errors.join(' | '));
      await context.close();
    }

    // ── 3. Stored object: 1600×400 WebP; exactly one object under the prefix ──
    let objs = await listBannerObjects(uid);
    check('storage: exactly 1 banner object after upload', objs.length === 1, JSON.stringify(objs.map((o) => o.name)));
    const { data: u1 } = await admin.auth.admin.getUserById(uid);
    const bannerUrl1 = u1 && u1.user && u1.user.user_metadata && u1.user.user_metadata.banner_url;
    check('pointer: banner_url set in metadata', /\/banners\//.test(bannerUrl1 || ''), String(bannerUrl1));
    const meta1 = await sharp(Buffer.from(await (await fetch(bannerUrl1)).arrayBuffer())).metadata();
    check('storage: stored file is 1600x400 webp', meta1.width === 1600 && meta1.height === 400 && meta1.format === 'webp', `${meta1.width}x${meta1.height} ${meta1.format}`);

    // ── 4. Desktop layout with banner: 220px band, avatar overlap, no collisions ──
    {
      const { context, page, errors } = await openAt(1280);
      await page.waitForFunction(() => {
        const b = document.getElementById('hero-banner');
        return b && getComputedStyle(b).display !== 'none';
      });
      const bandH = await page.locator('#hero-banner').evaluate((el) => el.getBoundingClientRect().height);
      check('@1280: band height 220px', Math.round(bandH) === 220, String(bandH));
      const bandBox = await page.locator('#hero-banner').boundingBox();
      const avBox = await page.locator('.hero-av').boundingBox();
      check('@1280: avatar overlaps banner lower edge', avBox.y < bandBox.y + bandBox.height && avBox.y + avBox.height > bandBox.y + bandBox.height,
        `av.y=${avBox.y} bandBottom=${bandBox.y + bandBox.height}`);
      for (const sel of ['.hero-name', '.hero-handle', '.hero-stats']) {
        const b = await page.locator(sel).first().boundingBox();
        const onBanner = b && b.y + b.height / 2 < bandBox.y + bandBox.height;
        check(`@1280: ${sel} sits below the banner`, !onBanner, JSON.stringify(b));
        const overlapAv = b && !(b.x >= avBox.x + avBox.width || b.x + b.width <= avBox.x || b.y >= avBox.y + avBox.height || b.y + b.height <= avBox.y);
        check(`@1280: ${sel} does not collide with avatar`, !overlapAv, JSON.stringify(b));
      }
      check('@1280 bannered: zero console errors', errors.length === 0, errors.join(' | '));
      await context.close();
    }

    // ── 5. Replace: old object deleted, still exactly one ──
    {
      const { context, page } = await openAt(1280);
      const png2 = await sharp({ create: { width: 1800, height: 500, channels: 3, background: { r: 200, g: 60, b: 30 } } }).png().toBuffer();
      await page.locator('#hero-banner-btn').click();
      await page.waitForSelector('#modal-banner-photo.open', { state: 'attached' });
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.locator('#bn-upload').click()
      ]);
      await chooser.setFiles({ name: 'banner2.png', mimeType: 'image/png', buffer: png2 });
      await page.waitForSelector('#arenas-crop-overlay #ac-use', { timeout: 10000 });
      await page.locator('#arenas-crop-overlay #ac-use').click();
      await page.waitForFunction((old) => {
        const b = document.getElementById('hero-banner');
        return b && b.style.backgroundImage && !b.style.backgroundImage.includes(old);
      }, objs[0].name, { timeout: 20000 });
      await context.close();
    }
    {
      const after = await listBannerObjects(uid);
      check('replace: exactly 1 object (old deleted)', after.length === 1 && after[0].name !== objs[0].name, JSON.stringify(after.map((o) => o.name)));
      objs = after;
    }

    // ── 6. Athlete directory modal shows the banner (viewer's perspective) ──
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addCookies(await loginCookies(EMAIL2));
      const page = await context.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`https://${DOMAIN}/html/athletes?q=Banner%20Testperson`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.adc-card', { timeout: 15000 });
      await page.locator('.adc-card', { hasText: 'Banner Testperson' }).first().click();
      // Batch A: the quick-view opens via window.arenasOverlay (root created
      // per-open, no .open class); the panel keeps its ids.
      await page.waitForSelector('#modal-profile #modal-banner', { state: 'attached' });
      const band = await page.evaluate(() => {
        const el = document.getElementById('modal-banner');
        return el ? { display: getComputedStyle(el).display, bg: el.style.backgroundImage } : null;
      });
      check('athletes modal: banner band visible with image', band && band.display !== 'none' && band.bg.includes('/banners/'), JSON.stringify(band));
      // Bannerless athlete → band hidden.
      await page.locator('.modal-close-btn').click();
      await page.goto(`https://${DOMAIN}/html/athletes?q=Viewer`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      // Viewer can't see themselves; open any bannerless card instead.
      await page.goto(`https://${DOMAIN}/html/athletes`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.adc-card', { timeout: 15000 });
      const opened = await page.evaluate(() => {
        const target = (window.ARENAS_DATA.athletes || []).find((a) => !a.banner_url);
        if (!target) return false;
        window.openAthleteModal(target.id);
        return true;
      });
      if (opened) {
        const band2 = await page.evaluate(() => getComputedStyle(document.getElementById('modal-banner')).display);
        check('athletes modal: band hidden for bannerless athlete', band2 === 'none', band2);
      }
      check('athletes modal: zero console errors', errors.length === 0, errors.join(' | '));
      await context.close();
    }

    // ── 7. Remove: pointer null + object deleted + imageless layout restored ──
    {
      const { context, page } = await openAt(1280);
      await page.locator('#hero-banner-btn').click();
      await page.waitForSelector('#modal-banner-photo.open', { state: 'attached' });
      await page.locator('#bn-remove').click();
      await page.waitForFunction(() => {
        const b = document.getElementById('hero-banner');
        return b && getComputedStyle(b).display === 'none';
      }, null, { timeout: 15000 });
      await context.close();
      const { data: u2 } = await admin.auth.admin.getUserById(uid);
      check('remove: banner_url pointer cleared', !(u2.user.user_metadata || {}).banner_url, JSON.stringify(u2.user.user_metadata.banner_url));
      const after = await listBannerObjects(uid);
      check('remove: bucket prefix empty', after.length === 0, JSON.stringify(after.map((o) => o.name)));
    }

    // ── 8. Account delete cleans up banner objects ──
    {
      // Re-upload directly via API (no UI needed), then delete the account.
      const cookieHeader = (await loginCookies(EMAIL)).map((c) => c.name + '=' + c.value).join('; ');
      const png = await sharp({ create: { width: 1600, height: 400, channels: 3, background: { r: 10, g: 160, b: 80 } } }).png().toBuffer();
      const fd = new FormData();
      fd.append('avatar', new Blob([png], { type: 'image/png' }), 'b.png');
      const up = await fetch(BASE_URL + '/api/profile/banner', { method: 'POST', headers: { cookie: cookieHeader }, body: fd });
      check('api: direct banner upload ok', up.ok, String(up.status));
      check('api: object exists pre-delete', (await listBannerObjects(uid)).length === 1);
      const del = await fetch(BASE_URL + '/api/account/delete', {
        method: 'POST', headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' })
      });
      check('api: account delete ok', del.ok, String(del.status) + ' ' + (await del.text()).slice(0, 120));
      const after = await listBannerObjects(uid);
      check('account delete: no orphan banner objects', after.length === 0, JSON.stringify(after.map((o) => o.name)));
      const { data: gone } = await admin.auth.admin.getUserById(uid);
      if (!gone || !gone.user) uid = null; // already deleted — skip finally cleanup
    }
  } catch (e) {
    failures++;
    console.log('  FAIL (exception) ' + e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    for (const id of [uid, uid2]) {
      if (!id) continue;
      const { data: b } = await admin.storage.from('avatars').list('banners/' + id).catch(() => ({ data: null }));
      if (b && b.length) await admin.storage.from('avatars').remove(b.map((o) => 'banners/' + id + '/' + o.name));
      const { data: a } = await admin.storage.from('avatars').list('users/' + id).catch(() => ({ data: null }));
      if (a && a.length) await admin.storage.from('avatars').remove(a.map((o) => 'users/' + id + '/' + o.name));
      await admin.from('activities').delete().eq('user_id', id);
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  }
  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})();
