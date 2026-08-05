// E2E for activity notes on main-feed cards:
//  - Notes render on the follower's feed, escaped via escFeedAct (XSS attempt
//    stays text — the injected <img onerror> must NOT create an element).
//  - Line breaks survive (white-space: pre-line on .fa-notes).
//  - Long notes (>220 chars) clamp to 3 lines with a working Show more /
//    Show less toggle; short notes get no toggle.
//  - Note-less activities render exactly as before — no .fa-notes block.
//  - Server-side 500-char cap on POST /api/activities/create (independent of
//    the textarea maxlength).
//  - Account-level "Activity feed visible" off still suppresses the author's
//    activities entirely from the follower's feed.
//  - Widths 1280 / 360 / 380 / 414, zero console errors. Cleanup in finally.
import { launchBrowser } from './lib/mobile-geometry.js';
import { createClient } from '@supabase/supabase-js';

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DOMAIN = process.env.REPLIT_DEV_DOMAIN;
const BASE_URL = `https://${DOMAIN}/html`;
const AUTHOR = 'vfn-author@arenas-test.dev';
const VIEWER = 'vfn-viewer@arenas-test.dev';
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

const LONG_NOTE = ('Long interval session out on the river loop. ' +
  'Legs felt heavy for the first two reps but the rhythm came back once I settled into the cadence. ' +
  'Negative-split the last three and finished with a controlled float. ').repeat(2) +
  'Fueling worked well; repeat next week.'; // > 220 chars, single paragraph
const MULTILINE_NOTE = 'Warmup 15min easy\nMain set: 4x8min threshold\nCooldown jog\nFelt strong on rep 3';
const XSS_NOTE = `<img src=x onerror="window.__xssFired=true"> <script>window.__xssFired=true</script> "quoted" & 'single'`;
const SHORT_NOTE = 'Quick spin, легкий день 🚴';

(async () => {
  let authorId = null, viewerId = null, browser = null;
  try {
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of (data && data.users) || []) if ([AUTHOR, VIEWER].includes(u.email)) await admin.auth.admin.deleteUser(u.id);
    const mk = async (email, name, handle) => {
      const { data: c, error } = await admin.auth.admin.createUser({
        email, password: PW, email_confirm: true,
        user_metadata: { name, handle, sports: ['running'] }
      });
      if (error) throw new Error('createUser: ' + error.message);
      return c.user.id;
    };
    authorId = await mk(AUTHOR, 'Feed Notes Author', 'vfn_author');
    viewerId = await mk(VIEWER, 'Feed Notes Viewer', 'vfn_viewer');
    const { error: fErr } = await admin.from('follows').insert({ follower_id: viewerId, following_id: authorId });
    if (fErr) throw new Error('follows: ' + fErr.message);

    const now = new Date().toISOString();
    const acts = [
      { user_id: authorId, sport: 'running', title: 'VFN long note run', duration: '00:45:00', notes: LONG_NOTE, date: now },
      { user_id: authorId, sport: 'running', title: 'VFN multiline run', duration: '00:40:00', notes: MULTILINE_NOTE, date: now },
      { user_id: authorId, sport: 'running', title: 'VFN xss run', duration: '00:30:00', notes: XSS_NOTE, date: now },
      { user_id: authorId, sport: 'cycling', title: 'VFN short note ride', duration: '01:00:00', notes: SHORT_NOTE, date: now },
      { user_id: authorId, sport: 'running', title: 'VFN noteless run', duration: '00:20:00', notes: null, date: now }
    ];
    const { error: aErr } = await admin.from('activities').insert(acts);
    if (aErr) throw new Error('activities: ' + aErr.message);

    // ---- Server-side length cap (author's own session, raw fetch) ----
    const aCookies = await loginCookies(AUTHOR);
    const aCookieHeader = aCookies.map((c) => c.name + '=' + c.value).join('; ');
    const overRes = await (await fetch(BASE_URL + '/api/activities/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: aCookieHeader },
      body: JSON.stringify({ sport: 'running', title: 'VFN overlength', duration: '00:10:00', notes: 'x'.repeat(501) })
    })).json();
    check('server: 501-char notes rejected', !!overRes.error && /500/.test(overRes.error), JSON.stringify(overRes));
    const { data: overRows } = await admin.from('activities').select('id').eq('user_id', authorId).eq('title', 'VFN overlength');
    check('server: over-length activity NOT inserted', (overRows || []).length === 0, String((overRows || []).length));
    const atRes = await (await fetch(BASE_URL + '/api/activities/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: aCookieHeader },
      body: JSON.stringify({ sport: 'running', title: 'VFN atcap', duration: '00:10:00', notes: 'y'.repeat(500) })
    })).json();
    check('server: exactly-500-char notes accepted', !atRes.error, JSON.stringify(atRes));

    // ---- Feed rendering as the follower ----
    browser = await launchBrowser();
    const vCookies = await loginCookies(VIEWER);
    const widths = [1280, 360, 380, 414];
    for (const width of widths) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      await ctx.addCookies(vCookies);
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(BASE_URL + '/feed', { waitUntil: 'networkidle' });
      const w = '@' + width;

      const r = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.feed-item-wrap'));
        const byTitle = (t) => cards.find((c) => c.textContent.includes(t)) || null;
        const info = (t) => {
          const c = byTitle(t);
          if (!c) return null;
          const n = c.querySelector('.fa-notes');
          const btn = c.querySelector('.fa-notes-toggle');
          return {
            hasNotes: !!n,
            text: n ? n.textContent : '',
            clamped: !!(n && n.classList.contains('clamped')),
            clampedOverflow: n ? n.scrollHeight > n.clientHeight + 1 : false,
            whiteSpace: n ? getComputedStyle(n).whiteSpace : '',
            hasToggle: !!btn,
            toggleText: btn ? btn.textContent : '',
            injectedImg: !!(n && n.querySelector('img')),
            cardWidth: c.getBoundingClientRect().width
          };
        };
        return {
          long: info('VFN long note run'),
          multi: info('VFN multiline run'),
          xss: info('VFN xss run'),
          short: info('VFN short note ride'),
          noteless: info('VFN noteless run'),
          xssFired: !!window.__xssFired,
          docW: document.documentElement.scrollWidth,
          winW: window.innerWidth
        };
      });

      check('long note renders ' + w, !!(r.long && r.long.hasNotes && r.long.text.includes('Negative-split')), JSON.stringify(r.long));
      check('long note clamped + overflow hidden ' + w, !!(r.long && r.long.clamped && r.long.clampedOverflow), JSON.stringify(r.long));
      check('long note has Show more ' + w, !!(r.long && r.long.hasToggle && r.long.toggleText === 'Show more'));
      check('multiline pre-line + breaks kept ' + w, !!(r.multi && r.multi.whiteSpace === 'pre-line' && r.multi.text.includes('Warmup 15min easy\nMain set')), JSON.stringify(r.multi));
      check('xss note rendered as text ' + w, !!(r.xss && r.xss.text.includes('<img src=x') && !r.xss.injectedImg && !r.xssFired), JSON.stringify(r.xss));
      check('short note renders, no toggle ' + w, !!(r.short && r.short.hasNotes && !r.short.hasToggle && r.short.text.includes('легкий день')), JSON.stringify(r.short));
      check('noteless card has NO notes block ' + w, !!(r.noteless && !r.noteless.hasNotes), JSON.stringify(r.noteless));
      check('no horizontal overflow ' + w, r.docW <= r.winW + 1, r.docW + ' vs ' + r.winW);

      // Toggle expands and collapses (desktop pass only — same DOM everywhere).
      if (width === 1280) {
        const t = await page.evaluate(() => {
          const cards = Array.from(document.querySelectorAll('.feed-item-wrap'));
          const c = cards.find((x) => x.textContent.includes('VFN long note run'));
          const n = c.querySelector('.fa-notes'); const btn = c.querySelector('.fa-notes-toggle');
          const before = n.clientHeight;
          btn.click();
          const afterOpen = { h: n.clientHeight, clamped: n.classList.contains('clamped'), label: btn.textContent };
          btn.click();
          const afterClose = { clamped: n.classList.contains('clamped'), label: btn.textContent };
          return { before, afterOpen, afterClose };
        });
        check('Show more expands (taller, unclamped, label flips)', t.afterOpen.h > t.before && !t.afterOpen.clamped && t.afterOpen.label === 'Show less', JSON.stringify(t));
        check('Show less re-clamps', t.afterClose.clamped && t.afterClose.label === 'Show more', JSON.stringify(t));
      }
      check('zero console errors ' + w, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }

    // ---- Privacy: author turns Activity feed visible OFF → cards vanish ----
    const { data: aUser } = await admin.auth.admin.getUserById(authorId);
    const meta = (aUser && aUser.user && aUser.user.user_metadata) || {};
    await admin.auth.admin.updateUserById(authorId, { user_metadata: { ...meta, prefs: { ...(meta.prefs || {}), activity_feed_visible: false } } });
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await ctx.addCookies(vCookies);
      const page = await ctx.newPage();
      await page.goto(BASE_URL + '/feed', { waitUntil: 'networkidle' });
      const gone = await page.evaluate(() => !Array.from(document.querySelectorAll('.feed-item-wrap')).some((c) => c.textContent.includes('VFN ')));
      check('privacy off: author activities fully suppressed', gone);
      await ctx.close();
    }
  } catch (err) {
    failures++;
    console.log('  FAIL script error — ' + (err && err.stack || err));
  } finally {
    if (browser) await browser.close().catch(() => {});
    for (const id of [authorId, viewerId]) {
      if (!id) continue;
      await admin.from('activities').delete().eq('user_id', id).then(() => {});
      await admin.from('follows').delete().or(`follower_id.eq.${id},following_id.eq.${id}`).then(() => {});
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  }
  console.log(failures ? `\n${failures} FAILURES` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
