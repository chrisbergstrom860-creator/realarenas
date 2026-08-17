// Verification for Plausible analytics: the snippet is injected exactly once
// into EVERY served HTML page (app-shell, marketing, legal, raw-sendFile and
// read-and-substitute pages), is hostname-gated so the Plausible script never
// loads outside realarenas.com (dev/verifier traffic sends nothing), non-page
// responses (sw.js, fragments, JSON) are untouched, the is_first flag on
// activity creation is server-correct, and every custom-event call site is
// wired to a server-confirmed outcome.
// Run: node artifacts/html-arenas/scripts/verify-analytics.js
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const BASE_URL = 'http://localhost:80/html';
const HTML_DIR = path.join(__dirname, '..', 'html');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SCRIPT_ID = 'pa-HP_G3pZi3T9xQ23D1nWTb.js';

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

function countTag(html) {
  return html.split(SCRIPT_ID).length - 1;
}

async function deleteUserByEmail(email) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of (data && data.users) || []) {
    if (u.email === email) {
      await admin.from('activities').delete().eq('user_id', u.id);
      await admin.from('notifications').delete().eq('user_id', u.id);
      await admin.from('memberships').delete().eq('user_id', u.id);
      await admin.auth.admin.deleteUser(u.id);
    }
  }
}

async function login(email, password) {
  const r = await fetch(BASE_URL + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }), redirect: 'manual'
  });
  return (r.headers.getSetCookie ? r.headers.getSetCookie() : [])
    .map((c) => c.split(';')[0]).join('; ');
}

(async () => {
  const EMAIL = 'analytics-verify@arenas-test.dev';
  const EMAIL2 = 'analytics-verify-b@arenas-test.dev';
  const PASS = 'Analytics!Verify1';
  await deleteUserByEmail(EMAIL);
  await deleteUserByEmail(EMAIL2);
  await admin.from('clubs').delete().eq('handle', 'analyticsvfy');

  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: EMAIL, password: PASS, email_confirm: true,
    user_metadata: { name: 'Analytics Verify' }
  });
  if (cErr) { console.log('FATAL seed user: ' + cErr.message); process.exit(1); }
  const userId = created.user.id;
  const { data: club, error: clErr } = await admin.from('clubs')
    .insert({ name: 'Analytics Verify Club', handle: 'analyticsvfy', sport: 'running', owner_id: userId })
    .select().single();
  if (clErr) { console.log('FATAL seed club: ' + clErr.message); process.exit(1); }
  await admin.from('memberships').insert({ user_id: userId, club_id: club.id, role: 'admin' });
  // Second user: /athletes/:userId redirects when viewing yourself, so the
  // visitor-page check needs someone else to look at.
  const { data: created2, error: c2Err } = await admin.auth.admin.createUser({
    email: EMAIL2, password: PASS, email_confirm: true,
    user_metadata: { name: 'Analytics Verify B' }
  });
  if (c2Err) { console.log('FATAL seed user B: ' + c2Err.message); process.exit(1); }
  const userBId = created2.user.id;

  const cookie = await login(EMAIL, PASS);
  check('login produced a session cookie', !!cookie);

  // ── 1. Tag present exactly once on every served HTML page ──
  const PUBLIC_PAGES = ['/landing', '/about', '/terms', '/privacy', '/contact',
    '/for-clubs', '/offline', '/forgot-password', '/reset-password', '/how-points-work'];
  const AUTHED_PAGES = ['/feed', '/athletes', '/clubs', '/events', '/leaderboards',
    '/challenges', '/profile', '/calendar', '/log', '/billing', '/billing/canceled',
    '/clubs/dashboard?club=' + club.id, '/clubs/member/' + club.id,
    '/clubs/invite?club=' + club.id, '/athletes/' + userBId];
  for (const p of PUBLIC_PAGES) {
    const r = await fetch(BASE_URL + p);
    const html = await r.text();
    check('public ' + p + ' → 200 + tag exactly once', r.status === 200 && countTag(html) === 1,
      'status ' + r.status + ', count ' + countTag(html));
  }
  for (const p of AUTHED_PAGES) {
    const r = await fetch(BASE_URL + p, { headers: { cookie }, redirect: 'manual' });
    const html = await r.text();
    check('authed ' + p + ' → 200 + tag exactly once', r.status === 200 && countTag(html) === 1,
      'status ' + r.status + ', count ' + countTag(html));
  }

  // ── 2. Non-page responses untouched ──
  const sw = await (await fetch(BASE_URL + '/sw.js')).text();
  check('sw.js has no analytics tag', countTag(sw) === 0);
  const frag = await (await fetch(BASE_URL + '/how-points-work?fragment=1', { headers: { cookie } })).text();
  check('how-points-work fragment has no analytics tag', countTag(frag) === 0);
  const css = await (await fetch(BASE_URL + '/arenas.css')).text();
  check('arenas.css untouched', countTag(css) === 0 && css.startsWith('/*'));
  const api = await (await fetch(BASE_URL + '/api/notifications', { headers: { cookie } })).text();
  check('JSON API response untouched', countTag(api) === 0);

  // ── 3. Hostname gate: script only loads on realarenas.com ──
  const page = await (await fetch(BASE_URL + '/landing')).text();
  const snippetStart = page.indexOf('Privacy-friendly analytics by Plausible');
  const snippet = page.slice(snippetStart, page.indexOf('</script>', snippetStart));
  check('snippet gates on realarenas.com hostname regex',
    snippet.includes('realarenas\\.com$') && snippet.includes('location.hostname'));
  check('no unconditional <script src> tag for Plausible (loads via gated createElement only)',
    !/<script[^>]*src=["']https:\/\/plausible\.io/.test(page) && snippet.includes("document.createElement('script')"));
  check('dev branch provides no-op plausible + arenasTrack (event calls never throw)',
    snippet.includes('window.plausible=function(){}') && snippet.split('arenasTrack').length - 1 >= 2);
  check('prod branch has queue stub + init + arenasTrack flush helper',
    snippet.includes('plausible.q=plausible.q||[]') && snippet.includes('plausible.init()') &&
    snippet.includes('setTimeout(fin,400)'));

  // ── 4. Signup Completed wiring: signed one-time server marker, set only by
  //       the two account-creation success paths, consumed on /feed render ──
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  check('setSignupMarker called exactly twice (signup + confirm) and marker is a signed cookie',
    server.split('setSignupMarker(res);').length - 1 === 2 && /signed: true, httpOnly: true/.test(server));
  check('/feed consumes the marker server-side and injects the flag',
    server.includes('consumeSignupMarker(req, res)') && server.includes('window.ARENAS_SIGNUP_COMPLETED = true;'));
  const feedSrc = fs.readFileSync(path.join(HTML_DIR, 'arenas-feed.html'), 'utf8');
  check('/feed fires Signup Completed only on the server-injected flag',
    feedSrc.includes('window.ARENAS_SIGNUP_COMPLETED && window.arenasTrack') &&
    feedSrc.includes("arenasTrack('Signup Completed')") &&
    !feedSrc.includes('ARENAS_SIGNUP_COMPLETED = true')); // flag comes from server, never the page source
  // Spoof attempt: a URL param (the old, rejected design) must do nothing.
  // (the page source legitimately contains the flag NAME in its listener;
  // only the server-injected `= true` assignment actually fires the event)
  const spoofed = await (await fetch(BASE_URL + '/feed?signup=1', { headers: { cookie } })).text();
  check('GET /feed?signup=1 (spoof) does NOT inject the signup flag',
    !spoofed.includes('ARENAS_SIGNUP_COMPLETED = true'));

  // ── 5. Other custom-event call sites: server-confirmed outcomes only ──
  const src = (f) => fs.readFileSync(path.join(HTML_DIR, f), 'utf8');
  const forClubs = src('arenas-for-clubs.html');
  check("Club Creation Started fires in /for-clubs openSignup()",
    forClubs.includes("arenasTrack('Club Creation Started')"));
  const clubCreate = src('arenas-club-create.js');
  check('Club Creation Started fires in in-app modal open()',
    clubCreate.includes("arenasTrack('Club Creation Started')"));
  check('Club Created fires in shared submit success branch (after r.ok && d.redirect)',
    /r\.ok && d\.redirect[\s\S]{0,400}arenasTrack\('Club Created'/.test(clubCreate));
  const cards = src('arenas-club-cards.js');
  check('Club Join Requested fires only in the status-200 success branch',
    /r\.status === 200 && r\.body && r\.body\.success[\s\S]{0,200}arenasTrack\('Club Join Requested'\)/.test(cards));
  const dash = src('arenas-club-dashboard.html');
  check('Club Join Approved fires only on approve success',
    /res\.status === 200 && res\.body && res\.body\.success[\s\S]{0,200}action === 'approve' && window\.arenasTrack\) window\.arenasTrack\('Club Join Approved'\)/.test(dash));
  const billing = src('arenas-billing.html');
  check('Pro Checkout Started (billing page) fires only when server returned Stripe url, pro only',
    /r\.ok && d\.url[\s\S]{0,300}kind === 'pro'[\s\S]{0,120}arenasTrack\('Pro Checkout Started'/.test(billing));
  const landing = src('arenas-landing-login.html');
  check('Pro Checkout Started (marketing CTA) fires only when server returned Stripe url, pro only',
    /r\.ok && d\.url[\s\S]{0,300}kind === 'pro'[\s\S]{0,120}arenasTrack\('Pro Checkout Started'/.test(landing));
  const logSrc = src('arenas-log.html');
  check('First Activity Logged fires only on server is_first flag',
    logSrc.includes("result.is_first && window.arenasTrack") &&
    logSrc.includes("arenasTrack('First Activity Logged', goAfterSave)"));

  // ── 6. is_first is server-truth: true on first activity only ──
  async function createActivity(title) {
    const r = await fetch(BASE_URL + '/api/activities/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ sport: 'running', title, date: '2026-08-17', distance: '5 km' })
    });
    return r.json();
  }
  const a1 = await createActivity('Analytics verify run 1');
  check('first activity → is_first true', a1.success === true && a1.is_first === true, JSON.stringify(a1).slice(0, 120));
  const a2 = await createActivity('Analytics verify run 2');
  check('second activity → is_first false', a2.success === true && a2.is_first === false, JSON.stringify(a2).slice(0, 120));

  // ── 6b. User content containing the script URL can NOT suppress injection ──
  const a3 = await createActivity('Sneaky ' + SCRIPT_ID + ' title');
  check('seeded activity with script-URL literal in title', a3.success === true);
  const feedWithSneaky = await (await fetch(BASE_URL + '/feed', { headers: { cookie } })).text();
  check('feed still gets the real snippet despite user content containing the script URL',
    feedWithSneaky.includes('plausible.init()') &&
    /Privacy-friendly analytics by Plausible[\s\S]{0,1500}<\/head>/.test(feedWithSneaky));

  // ── 7. Privacy page: accurate Plausible paragraph, no consent banner ──
  const privacy = await (await fetch(BASE_URL + '/privacy')).text();
  check('privacy page names Plausible, cookieless, no personal data',
    privacy.includes('Plausible') && privacy.includes('cookieless') &&
    privacy.includes('does not collect or store any personal data'));
  check('no consent banner added', !/consent banner|cookie banner|cookie-consent/i.test(privacy));
  check('stale "obtain your consent before using" analytics sentence removed',
    !privacy.includes('consent before using non-essential cookies'));

  // ── cleanup ──
  await admin.from('activities').delete().eq('user_id', userId);
  await admin.from('memberships').delete().eq('club_id', club.id);
  await admin.from('clubs').delete().eq('id', club.id);
  await deleteUserByEmail(EMAIL);
  await deleteUserByEmail(EMAIL2);

  if (failures) { console.log(failures + ' FAILURE(S)'); process.exit(1); }
  console.log('ALL PASS');
})().catch((e) => { console.log('FATAL: ' + e.message); process.exit(1); });
