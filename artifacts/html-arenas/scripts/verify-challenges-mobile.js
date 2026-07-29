// Seeded mobile-layout verification for the challenges page.
//
// Why this exists: the old 380px checks (testing-agent runs) asserted element
// PRESENCE and no PAGE-LEVEL horizontal scroll. Neither detects (a) content
// clipped inside an overflow:hidden card, nor (b) two text elements drawn on
// top of each other. This script measures real rendered geometry in headless
// Chromium and fails on exactly those defect classes:
//   1. no page-level horizontal scroll                       (kept from before)
//   2. no element clipped by an overflow-hidden/auto ancestor (catches clipped Delete)
//   3. no two text leaves' bounding boxes overlap             (catches days-left/title)
//   4. every action button fully inside the viewport width
//   5. the creator Delete… button is hit-testable (elementFromPoint)
//   6. zero console/page errors
// Matrix: 2 users (creator / non-creator) × 2 tabs (mine / discover)
//        × 3 viewports (360, 380, 414) — long AND short titles seeded.
//
// Usage: node scripts/verify-challenges-mobile.js   (seeds, checks, sweeps own data)
//        --keep  to skip cleanup (for debugging)
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BASE = `https://${process.env.REPLIT_DEV_DOMAIN}/html`;
const PW = 'ArenasTest!234';
const emails = {
  creator: 'chmob-creator@arenas-test.dev',
  member: 'chmob-member@arenas-test.dev'
};
const LONG_TITLE = 'Late Autumn Ultra-Distance Trail Running Consistency and Elevation Gain Challenge';
const VIEWPORTS = [360, 380, 414];

let failures = 0, assertions = 0;
const check = (name, ok, detail) => {
  assertions++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  → ' + JSON.stringify(detail).slice(0, 400)}`);
  if (!ok) failures++;
};

const users = {};
async function mkUser(key) {
  const { data, error } = await admin.auth.admin.createUser({
    email: emails[key], password: PW, email_confirm: true,
    user_metadata: { name: 'Chmob ' + key, handle: 'chmob_' + key }
  });
  if (error) throw new Error(key + ': ' + error.message);
  users[key] = { id: data.user.id };
}
async function login(key) {
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(emails[key])}&password=${encodeURIComponent(PW)}`
  });
  const setC = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  const cookies = (setC || []).filter(Boolean).map((c) => {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: process.env.REPLIT_DEV_DOMAIN, path: '/' };
  });
  if (r.status !== 302 || !cookies.length) throw new Error('login failed for ' + key);
  users[key].cookies = cookies;
}
const day = 86400000;
const iso = (d) => new Date(Date.now() + d * day).toISOString();
async function mkChallenge(fields, participantIds) {
  const { data, error } = await admin.from('challenges').insert({
    sport: 'running', goal_type: 'distance', goal_target: 100, goal_unit: 'km',
    description: null, club_id: null, ...fields
  }).select().single();
  if (error) throw new Error(error.message);
  for (const uid of participantIds) {
    await admin.from('challenge_participants').insert({ challenge_id: data.id, user_id: uid });
  }
  return data;
}

// ── seed ──
for (const k of Object.keys(emails)) { await mkUser(k); await login(k); }
const C = users.creator.id, M = users.member.id;
console.log('MANIFEST users:', JSON.stringify({ creator: C, member: M }));
const seeded = [];
// Creator's private solo w/ pending invite → the FULL 5-button action row
// (View leaderboard / Log activity / Invites · 1 pending / Edit / Delete…),
// with a long multi-word title to stress the head row.
const chPriv = await mkChallenge({ created_by: C, title: LONG_TITLE, start_date: iso(-1), end_date: iso(20), visibility: 'private' }, [C]);
await admin.from('challenge_invites').insert({ challenge_id: chPriv.id, inviter_id: C, invitee_id: M });
// Short-title public by creator; member is JOINED non-creator (Leave row).
const chShort = await mkChallenge({ created_by: C, title: '5K Blitz', start_date: iso(-1), end_date: iso(9), visibility: 'public' }, [C, M]);
// Long-title public by creator; member NOT joined → member's Discover card.
const chPubLong = await mkChallenge({ created_by: C, title: LONG_TITLE + ' II', start_date: iso(-1), end_date: iso(15), visibility: 'public' }, [C]);
// Public by member; creator NOT joined → creator's Discover card.
const chPubM = await mkChallenge({ created_by: M, title: 'Dawn Patrol', start_date: iso(-1), end_date: iso(7), visibility: 'public' }, [M]);
seeded.push(chPriv.id, chShort.id, chPubLong.id, chPubM.id);
console.log('MANIFEST challenges:', JSON.stringify(seeded));

// ── measure ──
const CHROMIUM = process.env.CHROMIUM_BIN
  || execSync('command -v chromium || command -v chromium-browser').toString().trim();
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

// Geometry audit run inside the page. Returns violation lists.
const AUDIT = (rootSel) => `(() => {
  const T = 1.5; // px tolerance for antialiasing/rounding
  const root = document.querySelector('${rootSel}');
  if (!root) return { missing: true };
  const out = { missing: false, clipped: [], overlaps: [], offscreenButtons: [], cards: root.querySelectorAll('.challenge-card').length };
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = (el) => (el.tagName + ':' + (el.textContent || '').trim().slice(0, 40));
  // 2. clipping: element vs nearest overflow-clipping ancestor
  for (const el of root.querySelectorAll('*')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    let a = el.parentElement;
    while (a && a !== document.body) {
      const s = getComputedStyle(a);
      if (/(hidden|auto|scroll|clip)/.test(s.overflow + s.overflowX)) {
        const ar = a.getBoundingClientRect();
        const clipR = s.overflowX === 'auto' || s.overflowX === 'scroll' ? ar.left + a.scrollWidth : ar.right;
        if (r.right > clipR + T || r.left < ar.left - T) out.clipped.push(label(el) + ' vs ' + label(a));
        break;
      }
      a = a.parentElement;
    }
  }
  // 3. text-leaf overlap (excluding ancestor/descendant pairs)
  const leaves = [...root.querySelectorAll('*')].filter((el) => vis(el)
    && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
    const a = leaves[i], b = leaves[j];
    if (a.contains(b) || b.contains(a)) continue;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
    const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (ox > 3 && oy > 3) out.overlaps.push(label(a) + ' ⇄ ' + label(b));
  }
  // 4. buttons fully inside viewport width
  for (const b of root.querySelectorAll('button')) {
    if (!vis(b)) continue;
    const r = b.getBoundingClientRect();
    if (r.right > window.innerWidth + T || r.left < -T) out.offscreenButtons.push(label(b));
  }
  return out;
})()`;

for (const key of ['creator', 'member']) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  await ctx.addCookies(users[key].cookies);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const w of VIEWPORTS) {
    await page.setViewportSize({ width: w, height: 840 });
    await page.goto(BASE + '/challenges', { waitUntil: 'networkidle' });
    await page.waitForSelector('#tab-mine .challenge-card', { timeout: 15000 });
    const tag = `${key}@${w}px`;
    // page-level horizontal scroll (the OLD assertion, kept)
    const hscroll = await page.evaluate('document.documentElement.scrollWidth - window.innerWidth');
    check(`${tag} mine: no page-level horizontal scroll`, hscroll <= 1, { hscroll });
    // Mine tab
    const mine = await page.evaluate(AUDIT('#tab-mine'));
    check(`${tag} mine: cards rendered (${mine.cards})`, !mine.missing && mine.cards >= 2, mine);
    check(`${tag} mine: no content clipped inside a container`, mine.clipped.length === 0, mine.clipped);
    check(`${tag} mine: no text bounding boxes overlap`, mine.overlaps.length === 0, mine.overlaps);
    check(`${tag} mine: all action buttons inside the viewport`, mine.offscreenButtons.length === 0, mine.offscreenButtons);
    if (key === 'creator') {
      const del = await page.evaluate(`(() => {
        const btn = [...document.querySelectorAll('#tab-mine button')].find((b) => b.textContent.trim().startsWith('Delete'));
        if (!btn) return { found: false };
        const r = btn.getBoundingClientRect();
        btn.scrollIntoView({ block: 'center' });
        const r2 = btn.getBoundingClientRect();
        const hit = document.elementFromPoint(r2.left + r2.width / 2, r2.top + r2.height / 2);
        return { found: true, inViewportX: r.right <= window.innerWidth + 1.5 && r.left >= -1.5,
                 hitTestOk: !!hit && (hit === btn || btn.contains(hit)), rect: { l: r.left, r: r.right } };
      })()`);
      check(`${tag} mine: Delete… reachable (visible + hit-testable)`, del.found && del.inViewportX && del.hitTestOk, del);
    }
    // Discover tab
    await page.click('#tab-btn-discover');
    await page.waitForSelector('#discover-grid .challenge-card', { timeout: 10000 });
    const disc = await page.evaluate(AUDIT('#discover-grid'));
    check(`${tag} discover: cards rendered (${disc.cards})`, !disc.missing && disc.cards >= 1, disc);
    check(`${tag} discover: no content clipped inside a container`, disc.clipped.length === 0, disc.clipped);
    check(`${tag} discover: no text bounding boxes overlap`, disc.overlaps.length === 0, disc.overlaps);
    check(`${tag} discover: all action buttons inside the viewport`, disc.offscreenButtons.length === 0, disc.offscreenButtons);
    const dScroll = await page.evaluate('document.documentElement.scrollWidth - window.innerWidth');
    check(`${tag} discover: no page-level horizontal scroll`, dScroll <= 1, { dScroll });
  }
  check(`${key}: zero console/page errors across all viewports`, errors.length === 0, errors.slice(0, 5));
  await ctx.close();
}
await browser.close();

// ── cleanup (own seeds only; full sweep still recommended) ──
if (!process.argv.includes('--keep')) {
  for (const id of seeded) {
    await admin.from('challenge_invites').delete().eq('challenge_id', id);
    await admin.from('challenge_participants').delete().eq('challenge_id', id);
    await admin.from('challenges').delete().eq('id', id);
  }
  for (const k of Object.keys(users)) await admin.auth.admin.deleteUser(users[k].id);
  console.log('cleanup: seeds removed');
}

console.log(failures ? `\n${failures} FAILURE(S) of ${assertions} assertions` : `\nALL PASS (${assertions} assertions)`);
process.exit(failures ? 1 : 0);
