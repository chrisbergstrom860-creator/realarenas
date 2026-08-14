// Permanent overlay-behavior verifier (Overlay migration Batch A onward).
//
// Config-table driven: each OVERLAYS entry pins one migrated overlay. Later
// batches EXTEND the table — never copy this script. For every configured
// overlay it opens via the page's real trigger and asserts the arenasOverlay
// contract:
//   - panel has role=dialog and aria-modal=true
//   - body scroll locked while open, and the PRE-OPEN value restored on close
//     (a sentinel inline value is set first, so restore-to-'' fails)
//   - Escape closes; backdrop click closes; explicit ✕ closes
//   - focus lands inside the overlay on open, returns to the trigger on close
//   - overlay is re-openable after each close path
// expectsBeforeClose entries additionally assert Escape/backdrop are blocked
// while the page reports dirty state (none in Batch A — all tier-1).
//
// Screenshot mode: SHOTS=<tag> saves /tmp/overlay-<id>-<tag>-<width>.png with
// each overlay open at both widths (used for before/after visual deltas).
//
// Seeds its own coach/member + club + event(+RSVP) + challenge(+participants);
// cleanup in finally. Run with the dev server up:
//   node artifacts/html-arenas/scripts/verify-overlay-behavior.js

import { createClient } from '@supabase/supabase-js';
import { launchBrowser } from './lib/mobile-geometry.js';

const BASE = 'http://localhost:80/html';
const DOMAIN = 'localhost';
const PW = 'OverlayTest!234';
const SHOTS = process.env.SHOTS || '';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail ? ' — ' + String(detail).slice(0, 300) : '')); }
}

const emails = {
  coach: 'ovl-coach@arenas-test.dev',
  member: 'ovl-member@arenas-test.dev',
  extra: 'ovl-extra@arenas-test.dev' // followed-but-uninvited → evx picker row
};
const users = {};
const seeded = { userIds: [], clubs: [], events: [], challenges: [] };

async function createUser(key, name) {
  await admin.auth.admin.createUser({ email: emails[key], password: PW, email_confirm: true, user_metadata: { name } })
    .then(({ data, error }) => {
      if (error) throw new Error('createUser ' + key + ': ' + error.message);
      users[key] = { id: data.user.id };
      seeded.userIds.push(data.user.id);
    });
}

async function login(key) {
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(emails[key])}&password=${encodeURIComponent(PW)}`
  });
  const setC = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  const cookies = (setC || []).filter(Boolean).map((c) => {
    const [pair] = c.split(';'); const i = pair.indexOf('=');
    return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: DOMAIN, path: '/' };
  });
  if (r.status !== 302 || !cookies.length) throw new Error('login failed: ' + key);
  users[key].cookies = cookies;
}

async function seed() {
  await createUser('coach', 'Ovl Coach');
  await createUser('member', 'Ovl Member');
  const { data: club, error: cErr } = await admin.from('clubs').insert({
    name: 'Overlay Club', handle: 'overlay-club', sport: 'running', owner_id: users.coach.id, visibility: 'public'
  }).select().single();
  if (cErr) throw new Error('club: ' + cErr.message);
  seeded.clubs.push(club.id);
  const { error: mErr } = await admin.from('memberships').insert([
    { club_id: club.id, user_id: users.coach.id, role: 'coach' },
    { club_id: club.id, user_id: users.member.id, role: 'member' }
  ]);
  if (mErr) throw new Error('memberships: ' + mErr.message);
  const { data: ev, error: eErr } = await admin.from('events').insert({
    title: 'Overlay Event', sport: 'running', date: new Date(Date.now() + 3 * 864e5).toISOString(),
    location: 'Testville', created_by: users.coach.id, club_id: club.id, visibility: 'public'
  }).select().single();
  if (eErr) throw new Error('event: ' + eErr.message);
  seeded.events.push(ev.id);
  const { error: rErr } = await admin.from('event_rsvps').insert({ event_id: ev.id, user_id: users.member.id, status: 'going' });
  if (rErr) throw new Error('rsvp: ' + rErr.message);
  const { data: ch, error: chErr } = await admin.from('challenges').insert({
    title: 'Overlay Challenge', sport: 'any', goal_type: 'distance', goal_target: 50, goal_unit: 'km',
    start_date: new Date(Date.now() - 864e5).toISOString(), end_date: new Date(Date.now() + 7 * 864e5).toISOString(),
    created_by: users.coach.id, club_id: club.id, visibility: 'club'
  }).select().single();
  if (chErr) throw new Error('challenge: ' + chErr.message);
  seeded.challenges.push(ch.id);
  const { error: cpErr } = await admin.from('challenge_participants').insert([
    { challenge_id: ch.id, user_id: users.coach.id },
    { challenge_id: ch.id, user_id: users.member.id }
  ]);
  if (cpErr) throw new Error('participants: ' + cpErr.message);
  // Batch B: private event owned by coach, one PENDING invite (member) for the
  // revoke path, and coach→extra follow so "Invite more" has an eligible row.
  await createUser('extra', 'Ovl Extra');
  const { data: evPriv, error: pErr } = await admin.from('events').insert({
    title: 'Overlay Private Event', sport: 'running',
    date: new Date(Date.now() + 5 * 864e5).toISOString(),
    location: 'Testville', created_by: users.coach.id, visibility: 'private'
  }).select().single();
  if (pErr) throw new Error('private event: ' + pErr.message);
  seeded.events.push(evPriv.id);
  const { error: iErr } = await admin.from('event_invites').insert({
    event_id: evPriv.id, invitee_id: users.member.id, inviter_id: users.coach.id
  });
  if (iErr) throw new Error('event invite: ' + iErr.message);
  const { error: fErr } = await admin.from('follows').insert({
    follower_id: users.coach.id, following_id: users.extra.id
  });
  if (fErr) throw new Error('follow: ' + fErr.message);
  return { club, ev, ch, evPriv };
}

async function cleanup() {
  for (const id of seeded.challenges) {
    await admin.from('challenge_participants').delete().eq('challenge_id', id);
    await admin.from('challenges').delete().eq('id', id);
  }
  for (const id of seeded.events) {
    await admin.from('event_rsvps').delete().eq('event_id', id);
    await admin.from('event_invites').delete().eq('event_id', id);
    await admin.from('events').delete().eq('id', id);
  }
  for (const id of seeded.userIds) {
    await admin.from('follows').delete().eq('follower_id', id);
    await admin.from('follows').delete().eq('following_id', id);
  }
  for (const id of seeded.clubs) {
    await admin.from('club_invites').delete().eq('club_id', id);
    await admin.from('memberships').delete().eq('club_id', id);
    await admin.from('clubs').delete().eq('id', id);
  }
  for (const id of seeded.userIds) await admin.auth.admin.deleteUser(id).catch(() => {});
}

// ── Generic per-overlay audit ────────────────────────────────────────────────
// cfg: { name, user, page, overlayId, focusSel (trigger element to focus
//        before opening), trigger (async page fn source, string), closeSel
//        (✕ inside overlay), extraCloses: [{label, sel}], expectsBeforeClose,
//        tier }
async function isOpen(pg, overlayId) {
  return pg.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el || !document.body.contains(el)) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
  }, overlayId);
}

async function openOverlay(pg, cfg) {
  const focused = await pg.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.focus();
    return el ? (document.activeElement === el) : false;
  }, cfg.focusSel);
  if (!focused) console.log('WARN  ' + cfg.name + ': focusSel did not take focus (' + cfg.focusSel + ')');
  await pg.evaluate(cfg.trigger);
  await pg.waitForFunction((id) => {
    const el = document.getElementById(id);
    return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
  }, cfg.overlayId, { timeout: 8000 });
  // Some overlays finish populating async (e.g. the evx invite picker loads
  // over fetch) — wait for the marker before dirty-state interactions.
  if (cfg.readySel) await pg.waitForSelector(cfg.readySel, { timeout: 8000 });
}

async function waitClosed(pg, overlayId) {
  await pg.waitForFunction((id) => {
    const el = document.getElementById(id);
    return !el || getComputedStyle(el).display === 'none' || !document.body.contains(el);
  }, overlayId, { timeout: 4000 }).catch(() => {});
  return !(await isOpen(pg, overlayId));
}

async function auditOverlay(browser, cfg, widths) {
  for (const width of widths) {
    // Some scenarios consume seeded state (evx revoke deletes the invite row);
    // beforeWidth re-seeds so each width starts from the same fixture.
    if (cfg.beforeWidth) await cfg.beforeWidth();
    const label = cfg.name + ' @' + width;
    const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 800 : 820 } });
    await ctx.addCookies(users[cfg.user].cookies);
    const pg = await ctx.newPage();
    const pageErrors = [];
    pg.on('pageerror', (e) => pageErrors.push(String(e)));
    // Guard prompts are window.confirm — dismiss (= "stay") and count them, so
    // we can assert both that they fire when dirty and that they DON'T when clean.
    const dialogs = [];
    pg.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
    try {
      await pg.goto(BASE + cfg.page, { waitUntil: 'networkidle' });
      // Sentinel: restore must reinstate this exact value, not reset to ''.
      await pg.evaluate(() => { document.body.style.overflow = 'scroll'; });

      // 1. Open + aria + lock + focus-in
      await openOverlay(pg, cfg);
      const state = await pg.evaluate((id) => {
        const ov = document.getElementById(id);
        const panel = ov && ov.firstElementChild;
        return {
          role: panel ? panel.getAttribute('role') : null,
          ariaModal: panel ? panel.getAttribute('aria-modal') : null,
          bodyOverflow: document.body.style.overflow,
          focusInside: !!(ov && ov.contains(document.activeElement))
        };
      }, cfg.overlayId);
      check(label + ': panel role=dialog', state.role === 'dialog', 'got ' + state.role);
      check(label + ': aria-modal=true', state.ariaModal === 'true', 'got ' + state.ariaModal);
      check(label + ': body scroll locked while open', state.bodyOverflow === 'hidden', 'got "' + state.bodyOverflow + '"');
      check(label + ': focus lands inside overlay', state.focusInside);
      if (SHOTS) {
        await pg.screenshot({ path: '/tmp/overlay-' + cfg.overlayId + '-' + SHOTS + '-' + width + '.png' });
      }

      // Tier C: window-level teardown spy. Default counter is the event-form
      // module's __aefTeardowns; C2 photo modals set cfg.spyName to their own
      // onClose counters. Every close path must add exactly 1.
      const spyName = cfg.spyName || '__aefTeardowns';
      const spy = () => pg.evaluate((n) => window[n] || 0, spyName);
      const spyCheck = async (what, s0) => {
        if (!cfg.teardownSpy) return;
        const s1 = await spy();
        check(label + ': teardown fired exactly once on ' + what, s1 === s0 + 1, s0 + ' → ' + s1);
      };

      // 2. Escape closes + restore + focus return
      let s0 = await spy();
      await pg.keyboard.press('Escape');
      const escClosed = await waitClosed(pg, cfg.overlayId);
      check(label + ': Escape closes', escClosed);
      await spyCheck('Escape', s0);
      const after = await pg.evaluate((sel) => {
        const ae = document.activeElement;
        return {
          overflow: document.body.style.overflow,
          focusOnTrigger: ae === document.querySelector(sel),
          aeDesc: ae ? ae.tagName + (ae.id ? '#' + ae.id : '') + (ae.className ? '.' + String(ae.className).split(' ')[0] : '') : 'none'
        };
      }, cfg.focusSel);
      check(label + ': scroll restored to prior value (not "")', after.overflow === 'scroll', 'got "' + after.overflow + '"');
      check(label + ': focus returns to trigger', after.focusOnTrigger, 'activeElement is ' + after.aeDesc);
      if (cfg.expectsBeforeClose) {
        check(label + ': clean untouched form — Escape closed with NO prompt', dialogs.length === 0, dialogs.join(' | '));
      }

      // 3. Backdrop click closes (reopen first)
      await openOverlay(pg, cfg);
      s0 = await spy();
      await pg.mouse.click(8, 8);
      check(label + ': backdrop click closes', await waitClosed(pg, cfg.overlayId));
      await spyCheck('backdrop', s0);

      // 4. Explicit ✕ closes (reopen first)
      await openOverlay(pg, cfg);
      s0 = await spy();
      await pg.evaluate((sel) => { const b = document.querySelector(sel); if (b) b.click(); }, cfg.closeSel);
      check(label + ': ✕ closes', await waitClosed(pg, cfg.overlayId));
      await spyCheck('✕', s0);

      // 5. Extra close paths (e.g. Done / View pending buttons)
      for (const extra of cfg.extraCloses || []) {
        await openOverlay(pg, cfg);
        s0 = await spy();
        await pg.evaluate((sel) => { const b = document.querySelector(sel); if (b) b.click(); }, extra.sel);
        check(label + ': ' + extra.label + ' closes', await waitClosed(pg, cfg.overlayId));
        await spyCheck(extra.label, s0);
      }

      // 6. beforeClose dirty-guard (Batch B onward). Dialogs are auto-dismissed
      // (= user chooses "stay"), so a firing guard keeps the overlay open.
      if (cfg.expectsBeforeClose) {
        const d0 = dialogs.length;
        await openOverlay(pg, cfg);
        await pg.evaluate(cfg.makeDirty);
        await pg.keyboard.press('Escape');
        await pg.waitForTimeout(150);
        check(label + ': dirty — Escape prompts', dialogs.length === d0 + 1, dialogs.length - d0 + ' dialog(s)');
        check(label + ': dirty — Escape (dismissed) keeps it open', await isOpen(pg, cfg.overlayId));
        await pg.mouse.click(8, 8);
        await pg.waitForTimeout(150);
        check(label + ': dirty — backdrop prompts', dialogs.length === d0 + 2, dialogs.length - d0 + ' dialog(s)');
        check(label + ': dirty — backdrop (dismissed) keeps it open', await isOpen(pg, cfg.overlayId));
        await pg.evaluate((sel) => { const b = document.querySelector(sel); if (b) b.click(); }, cfg.closeSel);
        check(label + ': dirty — explicit ✕ closes without prompting', (await waitClosed(pg, cfg.overlayId)) && dialogs.length === d0 + 2);
      }

      // 7. Overlay-specific scenario (e.g. evx revoke path, delete-account no-guard)
      if (cfg.postAudit) {
        await cfg.postAudit(pg, label, { dialogs, check, isOpen: () => isOpen(pg, cfg.overlayId), waitClosed: () => waitClosed(pg, cfg.overlayId), openOverlay: () => openOverlay(pg, cfg) });
      }

      check(label + ': zero page errors', pageErrors.length === 0, pageErrors.join(' | '));
    } catch (e) {
      check(label + ': audit ran', false, e.message);
    } finally {
      await ctx.close();
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
const widths = [1280, 380];
let browser;
try {
  const { club, ev, ch, evPriv } = await seed();
  await login('coach');
  await login('member');
  browser = await launchBrowser();

  const OVERLAYS = [
    { // Athletes directory quick-view (static panel, node-mode)
      name: 'athletes #modal-profile', tier: 1, user: 'member',
      page: '/athletes', overlayId: 'modal-profile',
      focusSel: '#search-input',
      trigger: `(() => { openAthleteModal('${users.coach.id}'); })()`,
      closeSel: '#modal-profile .modal-close-btn'
    },
    { // Club-invite success summary (static panel, node-mode; real bulk send)
      name: 'club-invite #modal-success', tier: 1, user: 'coach',
      page: '/clubs/invite?club=' + club.id, overlayId: 'modal-success',
      // NOTE: not the email input — the success path rebuilds #invite-rows,
      // detaching it; focus-return is only observable on a surviving element.
      focusSel: 'button[onclick="sendInvites()"]',
      trigger: `(() => {
        const e = document.querySelector('#invite-rows input[type=email]');
        e.value = 'ovl-invitee@arenas-test.dev';
        sendInvites();
      })()`,
      closeSel: '#modal-success .modal-close',
      extraCloses: [{ label: 'Done button', sel: '#modal-success .modal-footer .btn-ghost' }]
    },
    { // Club-dashboard RSVP list (dynamic)
      name: 'dashboard #rsvp-modal-overlay', tier: 1, user: 'coach',
      page: '/clubs/dashboard?club=' + club.id, overlayId: 'rsvp-modal-overlay',
      focusSel: 'button[onclick*="switchToTabAndCreate"]',
      trigger: `(() => { viewEventRsvps('${ev.id}'); })()`,
      closeSel: '#rsvp-modal-overlay button'
    },
    { // Club-dashboard challenge leaderboard (dynamic)
      name: 'dashboard #ch-lb-overlay', tier: 1, user: 'coach',
      page: '/clubs/dashboard?club=' + club.id, overlayId: 'ch-lb-overlay',
      focusSel: 'button[onclick*="switchToTabAndCreate"]',
      trigger: `(() => { viewChallengeLeaderboard('${ch.id}'); })()`,
      closeSel: '#ch-lb-overlay button'
    },
    // ── Batch B: the four form overlays ─────────────────────────────────────
    { // Goal form (static panel, node-mode; snapshot-at-open dirty guard)
      name: 'profile #modal-goal', tier: 2, user: 'member',
      page: '/profile', overlayId: 'modal-goal',
      focusSel: '#hero-banner-btn',
      trigger: `(() => { openGoalForm(); })()`,
      closeSel: '#modal-goal .modal-close',
      extraCloses: [{ label: 'Cancel button', sel: '#modal-goal .modal-footer .btn-ghost' }],
      expectsBeforeClose: true,
      makeDirty: `(() => { document.getElementById('g-target').value = '123'; })()`
    },
    { // Delete-account (static panel, node-mode; deliberately NO dirty guard)
      name: 'profile #modal-delete-account', tier: 2, user: 'member',
      page: '/profile', overlayId: 'modal-delete-account',
      focusSel: '#hero-banner-btn',
      trigger: `(() => { openDeleteModal(); })()`,
      closeSel: '#modal-delete-account .modal-close',
      extraCloses: [{ label: 'Cancel button', sel: '#modal-delete-account .modal-footer .btn-ghost' }],
      // Typed confirmation must be droppable with no prompt: fill "DELETE",
      // Escape → closes, zero dialogs. NEVER clicks the confirm button.
      postAudit: async (pg, label, h) => {
        const d0 = h.dialogs.length;
        await h.openOverlay();
        await pg.evaluate(() => {
          const i = document.getElementById('del-confirm-input');
          i.value = 'DELETE'; i.dispatchEvent(new Event('input'));
        });
        await pg.keyboard.press('Escape');
        h.check(label + ': typed DELETE — Escape closes with NO prompt',
          (await h.waitClosed()) && h.dialogs.length === d0, h.dialogs.slice(d0).join(' | '));
      }
    },
    { // Club-challenge create form (dynamic; snapshot-at-open dirty guard)
      name: 'dashboard #create-club-challenge-overlay', tier: 2, user: 'coach',
      page: '/clubs/dashboard?club=' + club.id, overlayId: 'create-club-challenge-overlay',
      focusSel: 'button[onclick*="switchToTabAndCreate"]',
      trigger: `(() => { openCreateClubChallenge(); })()`,
      closeSel: '#create-club-challenge-overlay button',
      extraCloses: [{ label: 'Cancel button', sel: '#cch-cancel' }],
      expectsBeforeClose: true,
      makeDirty: `(() => { document.getElementById('cch-title').value = 'Dirty title'; })()`
    },
    { // Event invite manager (dynamic; live checked-but-unsent dirty guard)
      name: 'events #evx-inv-modal', tier: 2, user: 'coach',
      page: '/events', overlayId: 'evx-inv-modal',
      focusSel: 'button[onclick*="manageInvites"]',
      trigger: `(() => { ARENAS_EVENTS.manageInvites('${evPriv.id}'); })()`,
      readySel: '#evx-inv-pick input',
      beforeWidth: async () => {
        await admin.from('event_invites').upsert(
          { event_id: evPriv.id, invitee_id: users.member.id, inviter_id: users.coach.id },
          { onConflict: 'event_id,invitee_id', ignoreDuplicates: true });
      },
      closeSel: '#evx-inv-modal [data-evx-close], #evx-inv-modal div[onclick*="remove"]',
      expectsBeforeClose: true,
      makeDirty: `(() => { const c = document.querySelector('#evx-inv-pick input'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); })()`,
      // Approved sequence: check a box, revoke a pending invitee → the list
      // reload wipes the checkboxes, and the LIVE guard must read clean again.
      postAudit: async (pg, label, h) => {
        const d0 = h.dialogs.length;
        await h.openOverlay();
        await pg.evaluate(() => {
          const c = document.querySelector('#evx-inv-pick input');
          c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await pg.evaluate(() => { const b = document.querySelector('#evx-inv-list [data-revoke]'); b.click(); });
        // Reload done = the revoked row's button is gone and the picker re-rendered.
        await pg.waitForFunction(() => !document.querySelector('#evx-inv-list [data-revoke]') &&
          document.querySelector('#evx-inv-pick input'), null, { timeout: 8000 });
        const checked = await pg.evaluate(() => document.querySelectorAll('#evx-inv-pick input:checked').length);
        h.check(label + ': revoke reload clears checked boxes', checked === 0, checked + ' still checked');
        await pg.keyboard.press('Escape');
        h.check(label + ': post-revoke Escape closes with NO prompt',
          (await h.waitClosed()) && h.dialogs.length === d0, h.dialogs.slice(d0).join(' | '));
      }
    },
    // ── Batch C1: the four arenasEventForm hosts ────────────────────────────
    // Shared crop scenario for the two create forms (only they have the
    // inline image field). Proves, per the approved plan:
    //   a) stacking: crop overlay opens OVER the host; Escape closes the crop
    //      first, host survives underneath with scroll still locked;
    //   b) the user's point-1 sequence: typed text + staged image → Escape
    //      (crop closes, its cancel clears the image) → Escape again MUST
    //      still prompt off the text fields — no silent discard;
    //   c) host close with the crop still open kills both (teardown cancels
    //      the crop) and restores scroll.
    ...(() => {
      const cropAudit = (px, xSel) => async (pg, label, h) => {
        const CROP = 'arenas-crop-overlay';
        const cropOpen = () => pg.waitForFunction((id) => {
          const el = document.getElementById(id);
          return !!el && el.getBoundingClientRect().width > 0;
        }, CROP, { timeout: 8000 });
        const d0 = h.dialogs.length;
        await h.openOverlay();
        await pg.evaluate((p) => {
          const t = document.getElementById(p + '-title');
          t.value = 'Typed before staging an image';
          t.dispatchEvent(new Event('input', { bubbles: true }));
        }, px);
        await pg.setInputFiles('#' + px + '-image', 'public/opengraph.jpg');
        await cropOpen();
        const stacked = await pg.evaluate(() => document.body.style.overflow === 'hidden');
        h.check(label + ': crop opens over host, scroll still locked', stacked && await h.isOpen());
        await pg.keyboard.press('Escape');
        await pg.waitForFunction((id) => !document.getElementById(id), CROP, { timeout: 4000 });
        h.check(label + ': Escape closes the CROP first — host still open, no prompt yet',
          (await h.isOpen()) && h.dialogs.length === d0, h.dialogs.slice(d0).join(' | '));
        await pg.keyboard.press('Escape');
        await pg.waitForTimeout(150);
        h.check(label + ': second Escape still prompts off typed text (image gone ≠ clean)',
          h.dialogs.length === d0 + 1 && await h.isOpen(), h.dialogs.length - d0 + ' dialog(s)');
        let s0 = await pg.evaluate(() => window.__aefTeardowns || 0);
        await pg.evaluate((sel) => { document.querySelector(sel).click(); }, xSel);
        h.check(label + ': dirty — explicit ✕ closes, teardown fired',
          (await h.waitClosed()) && (await pg.evaluate(() => window.__aefTeardowns || 0)) === s0 + 1);
        // b2) crop-ONLY dirt: no typed text, accept the crop (#ac-use →
        // cropState 'ready') — Escape on the HOST must prompt purely off the
        // staged image; proves cropState contributes to isDirty on its own.
        await h.openOverlay();
        await pg.setInputFiles('#' + px + '-image', 'public/opengraph.jpg');
        await cropOpen();
        await pg.evaluate(() => { document.getElementById('ac-use').click(); });
        await pg.waitForFunction((id) => !document.getElementById(id), CROP, { timeout: 8000 });
        const dAcc = h.dialogs.length;
        await pg.keyboard.press('Escape');
        await pg.waitForTimeout(150);
        h.check(label + ': accepted crop ALONE makes the guard prompt on Escape',
          h.dialogs.length === dAcc + 1 && await h.isOpen(), (h.dialogs.length - dAcc) + ' dialog(s)');
        await pg.evaluate((sel) => { document.querySelector(sel).click(); }, xSel);
        await h.waitClosed();
        // c) crop OPEN when the host ✕ is clicked → both die, scroll restored.
        await h.openOverlay();
        await pg.setInputFiles('#' + px + '-image', 'public/opengraph.jpg');
        await cropOpen();
        const dPre = h.dialogs.length;
        await pg.evaluate((sel) => { document.querySelector(sel).click(); }, xSel);
        await h.waitClosed();
        const endState = await pg.evaluate((id) => ({
          crop: !!document.getElementById(id), overflow: document.body.style.overflow
        }), CROP);
        h.check(label + ': host ✕ with crop open — both closed, scroll restored',
          !endState.crop && endState.overflow === 'scroll' && h.dialogs.length === dPre,
          JSON.stringify(endState) + ' dialogs+' + (h.dialogs.length - dPre));
      };
      return [
        { // Events page create (prefix evx)
          name: 'events #evx-modal', tier: 3, user: 'coach',
          page: '/events', overlayId: 'evx-modal', teardownSpy: true,
          focusSel: '#create-event-btn',
          trigger: `(() => { openCreateEvent(); })()`,
          closeSel: '#evx-close',
          expectsBeforeClose: true,
          makeDirty: `(() => { const t = document.getElementById('evx-title'); t.value = 'Dirty'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`,
          postAudit: cropAudit('evx', '#evx-close')
        },
        { // Events page self-edit (prefix eev) — opens PREFILLED; the generic
          // clean-Escape check proves an untouched edit form reads clean.
          name: 'events #eev-modal', tier: 3, user: 'coach',
          page: '/events', overlayId: 'eev-modal', teardownSpy: true,
          focusSel: '#create-event-btn',
          trigger: `(() => { ARENAS_EVENTS.edit('${ev.id}'); })()`,
          closeSel: '#eev-close',
          expectsBeforeClose: true,
          makeDirty: `(() => { const t = document.getElementById('eev-title'); t.value = 'Dirty edit'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`
        },
        { // Dashboard edit (prefix edit-ev) — prefilled; Cancel is a real path.
          name: 'dashboard #edit-event-overlay', tier: 3, user: 'coach',
          page: '/clubs/dashboard?club=' + club.id, overlayId: 'edit-event-overlay', teardownSpy: true,
          focusSel: 'button[onclick*="switchToTabAndCreate"]',
          trigger: `(() => { editClubEvent('${ev.id}'); })()`,
          closeSel: '#edit-ev-x',
          extraCloses: [{ label: 'Cancel button', sel: '#edit-ev-cancel' }],
          expectsBeforeClose: true,
          makeDirty: `(() => { const t = document.getElementById('edit-ev-title'); t.value = 'Dirty edit'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`
        },
        { // Dashboard create (prefix cev)
          name: 'dashboard #create-club-event-overlay', tier: 3, user: 'coach',
          page: '/clubs/dashboard?club=' + club.id, overlayId: 'create-club-event-overlay', teardownSpy: true,
          focusSel: 'button[onclick*="switchToTabAndCreate"]',
          trigger: `(() => { openCreateClubEvent(); })()`,
          closeSel: '#cev-x',
          extraCloses: [{ label: 'Cancel button', sel: '#cev-cancel' }],
          expectsBeforeClose: true,
          makeDirty: `(() => { const t = document.getElementById('cev-title'); t.value = 'Dirty'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`,
          postAudit: cropAudit('cev', '#cev-x')
        }
      ];
    })(),
    // ── Batch C2: the three photo modals (NO dirty guards by design — §3
    // approved: upload is immediate on file select for logo/avatar, and the
    // banner stages nothing that survives a crop cancel). The spy counters
    // prove onClose (and for the banner, token+cancel cleanup) fire exactly
    // once from EVERY path — Escape and backdrop included.
    { // Club logo (club-dashboard) — trigger is the real pencil affordance.
      name: 'dashboard #modal-club-logo', tier: 3, user: 'coach',
      page: '/clubs/dashboard?club=' + club.id, overlayId: 'modal-club-logo',
      teardownSpy: true, spyName: '__photoModalCloses',
      focusSel: 'button[onclick*="switchToTabAndCreate"]',
      trigger: `(() => { document.querySelector('.club-logo-edit').click(); })()`,
      closeSel: '#modal-club-logo .modal-close',
      extraCloses: [{ label: 'Close button', sel: '#modal-club-logo .modal-footer .btn-ghost' }]
    },
    { // Avatar photo (my-profile)
      name: 'profile #modal-avatar-photo', tier: 3, user: 'member',
      page: '/profile', overlayId: 'modal-avatar-photo',
      teardownSpy: true, spyName: '__photoModalCloses',
      focusSel: '#hero-banner-btn',
      trigger: `(() => { document.querySelector('.hero-av-edit').click(); })()`,
      closeSel: '#modal-avatar-photo .modal-close',
      extraCloses: [{ label: 'Done button', sel: '#modal-avatar-photo .modal-footer .btn-ghost' }]
    },
    { // Banner photo (my-profile) — carries the mid-decode orphan fix; its
      // spy counts bannerCleanup() (token++ / cropHandle.cancel / input clear).
      name: 'profile #modal-banner-photo', tier: 3, user: 'member',
      page: '/profile', overlayId: 'modal-banner-photo',
      teardownSpy: true, spyName: '__bannerCleanups',
      focusSel: '#hero-banner-btn',
      trigger: `(() => { document.getElementById('hero-banner-btn').click(); })()`,
      closeSel: '#modal-banner-photo .modal-close',
      extraCloses: [{ label: 'Done button', sel: '#modal-banner-photo .modal-footer .btn-ghost' }],
      postAudit: async (pg, label, h) => {
        const CROP = 'arenas-crop-overlay';
        const cropOpen = () => pg.waitForFunction((id) => {
          const el = document.getElementById(id);
          return !!el && el.getBoundingClientRect().width > 0;
        }, CROP, { timeout: 8000 });
        const cleanups = () => pg.evaluate(() => window.__bannerCleanups || 0);
        // §5 crop stacking, observed: pick file → 4:1 crop opens over host.
        const d0 = h.dialogs.length;
        await h.openOverlay();
        await pg.setInputFiles('#bn-file', 'public/opengraph.jpg');
        await cropOpen();
        const stacked = await pg.evaluate(() => document.body.style.overflow === 'hidden');
        h.check(label + ': crop opens over host, scroll still locked', stacked && await h.isOpen());
        await pg.keyboard.press('Escape');
        await pg.waitForFunction((id) => !document.getElementById(id), CROP, { timeout: 4000 });
        h.check(label + ': Escape closes the CROP only — host still open',
          (await h.isOpen()) && h.dialogs.length === d0);
        // §5 approved divergence from C1: second Escape closes the host
        // SILENTLY — the crop cancel already unstaged everything (onCancel
        // cleared the input), so there is genuinely nothing to lose.
        let s0 = await cleanups();
        await pg.keyboard.press('Escape');
        h.check(label + ': second Escape closes host silently (nothing staged, zero dialogs)',
          (await h.waitClosed()) && h.dialogs.length === d0);
        h.check(label + ': cleanup still fired on that close', (await cleanups()) === s0 + 1);
        // Host ✕ with the crop STILL OPEN: both die, token+cancel run once,
        // the shared file input is cleared, scroll restored.
        await h.openOverlay();
        await pg.setInputFiles('#bn-file', 'public/opengraph.jpg');
        await cropOpen();
        s0 = await cleanups();
        await pg.evaluate(() => { document.querySelector('#modal-banner-photo .modal-close').click(); });
        await h.waitClosed();
        const end = await pg.evaluate((id) => ({
          crop: !!document.getElementById(id),
          overflow: document.body.style.overflow,
          input: document.getElementById('bn-file').value
        }), CROP);
        h.check(label + ': host ✕ with crop open — both closed, input cleared, scroll restored',
          !end.crop && end.overflow === 'scroll' && end.input === '' && (await cleanups()) === s0 + 1,
          JSON.stringify(end));
      }
    }
  ];

  for (const cfg of OVERLAYS) await auditOverlay(browser, cfg, widths);
} catch (e) {
  failures++;
  console.log('FAIL  setup — ' + e.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  await cleanup();
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
