require('dotenv').config();

console.log('Starting server...');
console.log('PORT env var:', process.env.PORT);
console.log('All env vars:', Object.keys(process.env).filter(k => !k.includes('KEY') && !k.includes('SECRET')));

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
const { subscriptionPriceLabel, PRICE_FALLBACK_LABEL } = require('./billing-price');
// Single source of truth for everything sport-shaped (ids, labels, emoji,
// colors, scoring, distance-goal eligibility). SPORT_POINTS / KNOWN_SPORTS /
// DISTANCE_SPORTS are DERIVED there and equivalence-tested in sports.test.js.
const { SPORTS, SPORT_POINTS, KNOWN_SPORTS, DISTANCE_SPORTS, SPORT_ICONS, LEGACY_SPORT_EMOJI } = require('./sports');
const { COUNTRIES, COUNTRY_NAMES, US_STATES, US_STATE_NAMES } = require('./countries');
const {
  isValidTimezone, getUserTimezone, dateParts, dayKey, keyToEpochDays,
  addDaysToKey, keyToUtcDate, weekStartKey, monthKey, zoneMidnightUtc,
  computeStreaks
} = require('./tzdate');

const app = express();
// One reverse-proxy hop in every deployment (Replit artifact router in dev,
// Railway's edge in prod), so req.ip must come from X-Forwarded-For's last
// entry — otherwise the contact-form rate limiter buckets every visitor under
// the proxy's socket address. Exactly ONE hop is trusted, so clients can't
// spoof their way out of the bucket.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const BASE = (process.env.BASE_PATH || '').replace(/\/$/, '');
const HTML = path.join(__dirname, 'html');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Server-only admin client (service role bypasses RLS). NEVER expose this key
// to the browser — it is used exclusively for trusted server-side writes.
const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : null;

// ── STRIPE ──
// Deliberate exception to the plain-fetch pattern (cf. sendEmail): we use the
// official SDK because stripe.webhooks.constructEvent is needed for webhook
// signature verification. Test mode only for now. Degrades gracefully like
// Resend: with no STRIPE_SECRET_KEY, `stripe` is null and every caller must
// no-op (never crash) — check `if (!stripe)` before use.
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  const Stripe = require('stripe');
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
} else {
  console.log('[stripe skipped: no STRIPE_SECRET_KEY] Billing features disabled');
}

// ── EMAIL (Resend) ──
// Sender identity uses the verified Resend domain (send.realarenas.com).
const EMAIL_FROM = 'Arenas <noreply@send.realarenas.com>';

// Minimal HTML escape for values interpolated into email markup. Club names and
// inviter names are user-controlled, so they must be escaped.
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// One shared email sender. Uses global fetch (Node 24, no SDK) to POST Resend's
// REST API. Degrades gracefully: with no RESEND_API_KEY it logs instead of
// sending, so dev works without a key. It NEVER throws or rejects — it returns
// { ok, skipped?, status?, error? } so callers can fire-and-forget and a failed
// email can never break the surrounding request (e.g. invite-row creation).
async function sendEmail({ to, subject, html, text, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log('[email skipped: no RESEND_API_KEY] To:', to, '| Subject:', subject);
    return { ok: false, skipped: true };
  }
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        ...(text ? { text } : {}),
        ...(replyTo ? { reply_to: replyTo } : {})
      })
    });
    if (!resp.ok) {
      let detail = '';
      try { detail = await resp.text(); } catch (e) { /* ignore */ }
      console.error('[email failed]', resp.status, '| To:', to, '| Subject:', subject, '|', detail.slice(0, 500));
      return { ok: false, status: resp.status, error: detail };
    }
    let id = null;
    try { const j = await resp.json(); id = j && j.id; } catch (e) { /* ignore */ }
    console.log('[email sent]', id || '(no id)', '| To:', to, '| Subject:', subject);
    return { ok: true, id };
  } catch (err) {
    console.error('[email error]', (err && err.message) || err, '| To:', to, '| Subject:', subject);
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

// Build the club-invite email (shared by single / bulk / resend). Returns
// { subject, html, text }. All interpolated user values are HTML-escaped.
function buildInviteEmail({ clubName, inviterName, joinUrl, role }) {
  const clubRaw = clubName || 'a club';
  const club = escapeHtml(clubRaw);
  const url = escapeHtml(joinUrl);
  const intro = inviterName
    ? `${escapeHtml(inviterName)} invited you to join <strong>${club}</strong> on Arenas.`
    : `You've been invited to join <strong>${club}</strong> on Arenas.`;
  const roleLine = role && role !== 'member'
    ? `<p style="margin:0 0 18px;color:#52525b;font-size:14px;line-height:1.5">You'll join as <strong>${escapeHtml(role)}</strong>.</p>`
    : '';
  const subject = `You're invited to join ${clubRaw} on Arenas`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e4e4e7">
        <tr><td style="background:#18181b;padding:22px 28px">
          <span style="color:#fde047;font-size:20px;font-weight:800;letter-spacing:-.02em">🏆 Arenas</span>
        </td></tr>
        <tr><td style="padding:28px">
          <h1 style="margin:0 0 14px;font-size:20px;color:#18181b">You're invited 🎉</h1>
          <p style="margin:0 0 16px;color:#3f3f46;font-size:15px;line-height:1.55">${intro}</p>
          ${roleLine}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 22px">
            <tr><td style="border-radius:10px;background:#fde047">
              <a href="${url}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;color:#18181b;text-decoration:none">Join ${club} &rarr;</a>
            </td></tr>
          </table>
          <p style="margin:0 0 6px;color:#71717a;font-size:13px">Or paste this link into your browser:</p>
          <p style="margin:0;word-break:break-all"><a href="${url}" style="color:#2563eb;font-size:13px">${url}</a></p>
        </td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #e4e4e7;background:#fafafa">
          <p style="margin:0;color:#a1a1aa;font-size:12px;line-height:1.5">Arenas &mdash; every sport, one community. If you weren't expecting this invite, you can safely ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
  </body></html>`;
  const text = [
    inviterName ? `${inviterName} invited you to join ${clubRaw} on Arenas.` : `You've been invited to join ${clubRaw} on Arenas.`,
    role && role !== 'member' ? `You'll join as ${role}.` : '',
    '',
    `Join here: ${joinUrl}`,
    '',
    `Arenas — every sport, one community. If you weren't expecting this invite, you can safely ignore this email.`
  ].filter(Boolean).join('\n');
  return { subject, html, text };
}

// Build the subscription-confirmation email sent after a successful checkout.
// Written for California Automatic Renewal Law (ARL) compliance: it confirms
// the exact plan and price, states plainly that the subscription auto-renews
// monthly and continues until canceled, and gives clear self-serve cancel
// instructions (Billing → Manage billing → Stripe portal). planLabel/priceLabel
// are server-derived constants, not user input, but everything interpolated is
// escaped defensively. Returns { subject, html, text }.
function buildSubscriptionConfirmationEmail({ planLabel, priceLabel, manageUrl }) {
  const plan = escapeHtml(planLabel);
  const price = escapeHtml(priceLabel);
  const url = escapeHtml(manageUrl);
  const subject = 'Your Arenas Pro subscription is confirmed';
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e4e4e7">
        <tr><td style="background:#18181b;padding:22px 28px">
          <span style="color:#fde047;font-size:20px;font-weight:800;letter-spacing:-.02em">🏆 Arenas</span>
        </td></tr>
        <tr><td style="padding:28px">
          <h1 style="margin:0 0 14px;font-size:20px;color:#18181b">You're all set 🎉</h1>
          <p style="margin:0 0 16px;color:#3f3f46;font-size:15px;line-height:1.55">Thanks for subscribing. Your <strong>${plan}</strong> subscription is now active at <strong>${price}</strong>.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#fafafa;border:1px solid #e4e4e7;border-radius:10px">
            <tr><td style="padding:14px 16px;color:#3f3f46;font-size:14px;line-height:1.55">
              <strong>Automatic renewal:</strong> This subscription renews automatically every month at ${price} and continues until you cancel.
            </td></tr>
          </table>
          <p style="margin:0 0 8px;color:#18181b;font-size:15px;line-height:1.55"><strong>How to cancel</strong></p>
          <p style="margin:0 0 18px;color:#3f3f46;font-size:14px;line-height:1.55">You can cancel anytime — log in to Arenas, open <strong>Billing</strong>, and click <strong>Manage billing</strong>. That opens a secure Stripe portal where you can cancel your subscription.</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 4px">
            <tr><td style="border-radius:10px;background:#fde047">
              <a href="${url}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;color:#18181b;text-decoration:none">Go to Billing &rarr;</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #e4e4e7;background:#fafafa">
          <p style="margin:0;color:#a1a1aa;font-size:12px;line-height:1.5">Arenas &mdash; every sport, one community. You're receiving this because you started a subscription on Arenas.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
  </body></html>`;
  const text = [
    `Thanks for subscribing. Your ${planLabel} subscription is now active at ${priceLabel}.`,
    '',
    `Automatic renewal: This subscription renews automatically every month at ${priceLabel} and continues until you cancel.`,
    '',
    `How to cancel: You can cancel anytime — log in to Arenas, open Billing, and click Manage billing. That opens a secure Stripe portal where you can cancel your subscription.`,
    '',
    `Manage your subscription: ${manageUrl}`,
    '',
    `Arenas — every sport, one community. You're receiving this because you started a subscription on Arenas.`
  ].join('\n');
  return { subject, html, text };
}

// ── STRIPE WEBHOOK RAW BODY ──
// stripe.webhooks.constructEvent verifies the signature over the EXACT raw
// request bytes, so this one path must get express.raw BEFORE the global
// JSON/urlencoded parsers below (they would consume and re-serialize the
// body, breaking verification). body-parser marks the request as parsed
// (req._body), so the global parsers skip it afterwards.
app.use(BASE + '/api/stripe/webhook', express.raw({ type: 'application/json' }));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser(process.env.SESSION_SECRET));

if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    next();
  });
}

// Shared app-shell stylesheet (public, no auth). Served at both the Replit
// (/html) and Railway (root) base paths so the in-page href resolves in both.
app.get(['/html/arenas.css', '/arenas.css'], (req, res) => {
  res.sendFile(path.join(HTML, 'arenas.css'));
});

// Shared in-place notifications dropdown logic (public, no auth). Served at both
// the Replit (/html) and Railway (root) base paths, like the stylesheet above.
app.get(['/html/arenas-notifications-panel.js', '/arenas-notifications-panel.js'], (req, res) => {
  res.sendFile(path.join(HTML, 'arenas-notifications-panel.js'));
});
// Shared in-app "How points work" modal (loaded by app-shell pages with
// scoring links). Dual route like the panel JS so a static /html-prefixed
// src works in both environments.
app.get(['/html/arenas-hpw-modal.js', '/arenas-hpw-modal.js'], (req, res) => {
  res.sendFile(path.join(HTML, 'arenas-hpw-modal.js'));
});
// Shared overlay/modal primitive (backdrop, Escape, scroll lock, focus
// restore). Must load BEFORE arenas-hpw-modal.js and the challenges page's
// modal code — both build on window.arenasOverlay.
app.get(['/html/arenas-overlay.js', '/arenas-overlay.js'], (req, res) => {
  res.sendFile(path.join(HTML, 'arenas-overlay.js'));
});
// Shared 3:1 cover-image cropper (events page create form + Image action).
// Builds on window.arenasOverlay — load order matters on consumer pages.
app.get(['/html/arenas-crop.js', '/arenas-crop.js'], (req, res) => {
  res.sendFile(path.join(HTML, 'arenas-crop.js'));
});

// Shared event create/edit form module (events page + club dashboard).
app.get(['/html/arenas-event-form.js', '/arenas-event-form.js'], (req, res) => {
  res.sendFile(path.join(HTML, 'arenas-event-form.js'));
});

// Shared activity stat-tile builder (feed + my-profile Activities tab render
// the same boxed tiles from this one file). Dual-path like the panel above.
app.get(['/html/arenas-activity-card.js', '/arenas-activity-card.js'], (req, res) => {
  res.sendFile(path.join(HTML, 'arenas-activity-card.js'));
});

app.get(['/html/arenas-post-image.js', '/arenas-post-image.js'], (req, res) => {
  res.sendFile(path.join(HTML, 'arenas-post-image.js'));
});

app.get(['/html/arenas-stat-tiles.js', '/arenas-stat-tiles.js'], (req, res) => {
  res.sendFile(path.join(HTML, 'arenas-stat-tiles.js'));
});
app.get(['/html/arenas-club-post-header.js', '/arenas-club-post-header.js'], (req, res) => {
  res.sendFile(path.join(HTML, 'arenas-club-post-header.js'));
});

// Shared "By sport" three-chart builder (Stats & PRs tab + verify harness).
// Dual-path as above. (Replaced arenas-pie.js — its arc + largest-remainder
// logic moved into this module.)
app.get(['/html/arenas-sport-charts.js', '/arenas-sport-charts.js'], (req, res) => {
  res.sendFile(path.join(HTML, 'arenas-sport-charts.js'));
});

// Shared "Weekly activity" stacked-column builder (Stats & PRs tab + visual
// harness). Dual-path as above.
app.get(['/html/arenas-stack.js', '/arenas-stack.js'], (req, res) => {
  res.sendFile(path.join(HTML, 'arenas-stack.js'));
});

// Shared relative-time helper ("X ago" buckets). One implementation for the
// feed, my-profile, club-member, and club-dashboard pages. Dual-path as above.
app.get(['/html/arenas-time.js', '/arenas-time.js'], (req, res) => {
  res.sendFile(path.join(HTML, 'arenas-time.js'));
});

// Shared athlete-directory card renderer + follow controller — one template
// for the /athletes page and the my-profile "Athletes" tab (component CSS in
// arenas.css under the adc- prefix). Dual-path as above.
app.get(['/html/arenas-athlete-link.js', '/arenas-athlete-link.js'], (req, res) => {
  res.sendFile(path.join(HTML, 'arenas-athlete-link.js'));
});
app.get(['/html/arenas-athlete-cards.js', '/arenas-athlete-cards.js'], (req, res) => {
  res.sendFile(path.join(HTML, 'arenas-athlete-cards.js'));
});

// Shared club-directory card renderer + request controller — /clubs page
// (component CSS in arenas.css under the ccd- prefix). Dual-path as above.
app.get(['/html/arenas-club-cards.js', '/arenas-club-cards.js'], (req, res) => {
  res.sendFile(path.join(HTML, 'arenas-club-cards.js'));
});

// for the rounding-regression verification. Remove after that round.

// Shared club-creation contract layer + in-app club-setup modal. The
// /for-clubs wizard and the sidebar "+ Create club" modal both submit through
// this one file so validation and error mapping can't drift. Dual-path as
// above.
app.get(['/html/arenas-club-create.js', '/arenas-club-create.js'], (req, res) => {
  res.sendFile(path.join(HTML, 'arenas-club-create.js'));
});

// ── PWA: manifest, icons, service worker, offline fallback ──
// Dual-path (literal /html + root) like the shared assets above: pages
// reference these with the /html prefix, which the head helper strips on
// Railway for [href] — and pages without the helper still resolve because
// both paths are mounted.
const PWA_THEME_COLOR = '#FFD21E'; // brand yellow (the topbar mark)
const PWA_BG_COLOR = '#F9FAFB';    // --gray-50, the app's body background —
                                   // splash matches first paint, no white flash

app.get(['/html/manifest.webmanifest', '/manifest.webmanifest'], (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('application/manifest+json').send(JSON.stringify({
    id: (BASE || '') + '/',
    name: 'Arenas',
    short_name: 'Arenas',
    description: 'Log training, join clubs, and climb the leaderboards with your team.',
    // Logged-out standalone opens land on /feed and ride requirePageAuth's
    // redirect to /landing — both inside scope, so the chain stays in-app.
    start_url: BASE + '/feed',
    scope: (BASE || '') + '/',
    display: 'standalone',
    background_color: PWA_BG_COLOR,
    theme_color: PWA_THEME_COLOR,
    icons: [
      { src: BASE + '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: BASE + '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: BASE + '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  }, null, 2));
});

const PWA_ICON_FILES = new Set(['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']);
app.get(['/html/icons/:file', '/icons/:file'], (req, res) => {
  if (!PWA_ICON_FILES.has(req.params.file)) return res.status(404).end();
  if (process.env.NODE_ENV === 'production') res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(HTML, 'icons', req.params.file));
});

// Brand mark (vector — doubles as the SVG favicon and the topbar <img>) and
// the multi-size favicon.ico. Same dual-path convention as the icons above.
app.get(['/html/arenas-icon.svg', '/arenas-icon.svg'], (req, res) => {
  if (process.env.NODE_ENV === 'production') res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(HTML, 'arenas-icon.svg'));
});
app.get(['/html/favicon.ico', '/favicon.ico'], (req, res) => {
  if (process.env.NODE_ENV === 'production') res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(HTML, 'favicon.ico'));
});

// The worker itself. no-cache so browsers re-check it promptly (the byte
// diff is what triggers the update flow). The Supabase project host is
// substituted in at serve time so avatar URLs (timestamped filenames) can be
// cache-first; the host is public information — it is in every avatar URL.
app.get(['/html/sw.js', '/sw.js'], (req, res) => {
  let js = fs.readFileSync(path.join(HTML, 'sw.js'), 'utf8');
  let supaHost = '';
  try { supaHost = new URL(process.env.SUPABASE_URL).hostname; } catch (err) { /* placeholder stays; avatars just aren't cached */ }
  js = js.replace("'__SUPABASE_HOST__'", JSON.stringify(supaHost));
  res.set('Cache-Control', 'no-cache');
  res.type('application/javascript').send(js);
});

app.get(['/html/arenas-pwa.js', '/arenas-pwa.js'], (req, res) => {
  res.sendFile(path.join(HTML, 'arenas-pwa.js'));
});

// Offline fallback page (public; precached by the service worker at install,
// served by it when a navigation misses both network and cache).
app.get(BASE + '/offline', (req, res) => {
  res.sendFile(path.join(HTML, 'arenas-offline.html'));
});

// ── AUTH (Supabase) ──
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  signed: true,
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000
};

function setSession(res, session) {
  res.cookie('sb_access_token', session.access_token, COOKIE_OPTS);
  res.cookie('sb_refresh_token', session.refresh_token, COOKIE_OPTS);
}

app.post(BASE + '/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data || !data.session) {
      return res.redirect(BASE + '/landing?error=invalid');
    }
    setSession(res, data.session);
    // Auto-capture the browser timezone (hidden `tz` field) on EVERY login so
    // travelers self-heal, unless the user set a manual override in Settings
    // (timezone_source === 'manual' wins until cleared). Garbage zone names are
    // rejected silently — keep the old value, never block the login.
    try {
      const tz = typeof req.body.tz === 'string' ? req.body.tz.trim() : '';
      const meta = (data.user && data.user.user_metadata) || {};
      if (tz && supabaseAdmin && isValidTimezone(tz) &&
          meta.timezone_source !== 'manual' && meta.timezone !== tz) {
        await supabaseAdmin.auth.admin.updateUserById(data.user.id, {
          user_metadata: { timezone: tz, timezone_source: 'auto' }
        });
      }
    } catch (tzErr) {
      console.log('Login tz capture error (ignored):', tzErr.message);
    }
    // Optional same-app return path (used by /for-clubs' "log in to create
    // your club" link). Only absolute paths under BASE are honored; anything
    // else — external URLs, protocol-relative, backslash tricks — falls
    // through to the default destination.
    const next = typeof req.body.next === 'string' ? req.body.next.trim() : '';
    if (next && next.startsWith(BASE + '/') && !next.startsWith('//') &&
        !next.includes('://') && !next.includes('\\')) {
      return res.redirect(next);
    }
    // Everyone lands on the athlete feed after login. Club admins/coaches are
    // NOT special-cased to a dashboard: with multiple managed clubs there is
    // no "the" dashboard (the old redirect picked the most recently created
    // club, silently teleporting managers), and their clubs are one tap away
    // via the sidebar "My clubs" list and the avatar "Clubs you manage" menu.
    return res.redirect(BASE + '/feed');
  } catch (err) {
    return res.redirect(BASE + '/landing?error=invalid');
  }
});

// Email sent to an EXISTING address when someone tries to sign up with it.
// Enumeration-safe honest pattern: the on-page response stays identical to a
// fresh signup ("check your inbox"), but instead of silence the real owner
// gets this note — so a legitimate returning user learns to log in or reset,
// and a stranger probing the form learns nothing from the page.
function buildExistingEmailSignupEmail({ loginUrl, resetUrl }) {
  const lUrl = escapeHtml(loginUrl);
  const rUrl = escapeHtml(resetUrl);
  const subject = 'Someone tried to sign up with your email on Arenas';
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e4e4e7">
        <tr><td style="background:#18181b;padding:22px 28px">
          <span style="color:#fde047;font-size:20px;font-weight:800;letter-spacing:-.02em">🏆 Arenas</span>
        </td></tr>
        <tr><td style="padding:28px">
          <h1 style="margin:0 0 14px;font-size:20px;color:#18181b">You already have an account</h1>
          <p style="margin:0 0 16px;color:#3f3f46;font-size:15px;line-height:1.55">Someone (probably you) just tried to sign up on Arenas with this email address &mdash; but it already has an account. No new account was created.</p>
          <p style="margin:0 0 16px;color:#3f3f46;font-size:15px;line-height:1.55">If that was you, just log in. Forgot your password? Reset it below.</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 12px">
            <tr><td style="border-radius:10px;background:#fde047">
              <a href="${lUrl}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;color:#18181b;text-decoration:none">Log in &rarr;</a>
            </td></tr>
          </table>
          <p style="margin:0 0 22px"><a href="${rUrl}" style="color:#2563eb;font-size:14px">Reset your password</a></p>
          <p style="margin:0;color:#71717a;font-size:13px;line-height:1.5">If this wasn't you, you can safely ignore this email &mdash; your account is unchanged and no one gained access to it.</p>
        </td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #e4e4e7;background:#fafafa">
          <p style="margin:0;color:#a1a1aa;font-size:12px;line-height:1.5">Arenas &mdash; every sport, one community.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
  </body></html>`;
  const text = [
    'Someone (probably you) just tried to sign up on Arenas with this email address — but it already has an account. No new account was created.',
    '',
    `If that was you, just log in: ${loginUrl}`,
    `Forgot your password? Reset it here: ${resetUrl}`,
    '',
    "If this wasn't you, you can safely ignore this email — your account is unchanged and no one gained access to it."
  ].join('\n');
  return { subject, html, text };
}

app.post(BASE + '/auth/signup', async (req, res) => {
  const email = (req.body.email || '').trim();
  const password = req.body.password;
  // The signup form combines first + last name into a single `name` field, but
  // fall back to first/last parts or the email local-part just in case.
  const name =
    (req.body.name || '').trim() ||
    ((req.body.firstName || '') + ' ' + (req.body.lastName || '')).trim() ||
    (email ? email.split('@')[0] : '');
  console.log('Signup attempt:', email, '| name:', name);
  if (!email || !password) {
    console.log('Signup missing email or password');
    return res.redirect(BASE + '/landing?error=missing_fields');
  }
  // Browser timezone from the hidden `tz` field — stored only when it is a
  // real IANA zone (garbage is dropped silently; the login refresh heals it).
  const signupTz = typeof req.body.tz === 'string' && isValidTimezone(req.body.tz.trim())
    ? req.body.tz.trim() : null;
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: signupTz ? { name, timezone: signupTz, timezone_source: 'auto' } : { name },
        emailRedirectTo: publicBaseUrl(req) + '/auth/confirm'
      }
    });
    console.log('Signup result - user:', data && data.user && data.user.id);
    console.log('Signup result - session:', !!(data && data.session));
    console.log('Signup result - error:', error && error.message);
    if (error || !data || !data.user) {
      console.log('Signup failed:', error && error.message);
      return res.redirect(BASE + '/landing?error=signup_failed');
    }
    // EXISTING email: Supabase (confirmations on) returns an obfuscated user
    // with an EMPTY identities array and sends nothing — the person would wait
    // forever for a confirmation email. Honest enumeration-safe pattern: the
    // on-page outcome below stays byte-identical to a fresh signup, but the
    // real owner gets a "someone tried to sign up with your email" email via
    // the shared Resend sender. Fire-and-forget (not awaited) so the response
    // timing matches the new-user branch and a failed send can't break signup.
    if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      console.log('Signup on existing email — sending already-registered notice');
      const origin = publicBaseUrl(req);
      const notice = buildExistingEmailSignupEmail({
        loginUrl: origin + '/landing',
        resetUrl: origin + '/forgot-password'
      });
      sendEmail({ to: email, subject: notice.subject, html: notice.html, text: notice.text });
      return res.redirect(BASE + '/landing?error=confirm_email');
    }
    if (!data.session) {
      // No session means Supabase requires email confirmation before sign-in,
      // so there is no cookie to set and /feed would just bounce to /landing.
      console.log('No session - email confirmation may be required');
      return res.redirect(BASE + '/landing?error=confirm_email');
    }
    setSession(res, data.session);
    console.log('Signup success for:', email);
    return res.redirect(BASE + '/feed');
  } catch (err) {
    console.log('Signup exception:', err.message);
    return res.redirect(BASE + '/landing?error=signup_failed');
  }
});

app.post(BASE + '/auth/signup-club', async (req, res) => {
  // Identity-fork guard: a logged-in user must never create a SECOND account
  // through the club wizard (it would silently overwrite their session).
  // Route them to the session-aware shortened flow instead.
  if (await getOptionalUser(req)) {
    return res.redirect(BASE + '/for-clubs?create=1');
  }
  const { email, password, name, club_name, handle, sport, city } = req.body;
  try {
    if (!supabaseAdmin) {
      return res.redirect(BASE + '/for-clubs?error=server');
    }

    // Create the user with the admin client so the email is auto-confirmed and
    // no confirmation step is required. Same hidden-field timezone capture as
    // the athlete signup (invalid values silently dropped).
    const clubTz = typeof req.body.tz === 'string' && isValidTimezone(req.body.tz.trim())
      ? req.body.tz.trim() : null;
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: clubTz ? { name, timezone: clubTz, timezone_source: 'auto' } : { name }
    });
    if (error || !data || !data.user) {
      return res.redirect(BASE + '/for-clubs?error=signup');
    }

    const userId = data.user.id;

    // Sign the new user in to obtain a session for the cookie.
    const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    if (signInErr || !signInData || !signInData.session) {
      // Roll back the just-created account so the email can be retried.
      const { error: rbErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (rbErr) console.error('Club signup rollback FAILED — orphan auth user %s (%s) blocks email retry (manual remediation needed):', userId, email, rbErr.message);
      return res.redirect(BASE + '/for-clubs?error=confirm');
    }

    // Create the club with the service-role client (bypasses RLS).
    const { data: club, error: clubErr } = await supabaseAdmin
      .from('clubs')
      .insert({ name: club_name, handle, sport, city, owner_id: userId })
      .select('id')
      .single();
    if (clubErr || !club) {
      // Roll back the just-created account so the email can be retried.
      const { error: rbErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (rbErr) console.error('Club signup rollback FAILED — orphan auth user %s (%s) blocks email retry (manual remediation needed):', userId, email, rbErr.message);
      // The DB's unique index on lower(handle) rejecting the insert is the
      // real duplicate gate — surface it as the friendly wizard error, not a
      // generic failure. Rollback above already ran: no half-created account.
      if (clubErr && clubErr.code === '23505') {
        return res.redirect(BASE + '/for-clubs?error=handle_taken');
      }
      return res.redirect(BASE + '/for-clubs?error=club');
    }

    // Link the user to the club as admin.
    const { error: memErr } = await supabaseAdmin
      .from('memberships')
      .insert({ user_id: userId, club_id: club.id, role: 'admin' });
    if (memErr) {
      // Compensating cleanup so we don't leave an orphaned club or account.
      // Order matters (same rule as the invite rollback): only delete the
      // auth user after the club rollback succeeds, or the club would be
      // orphaned with a dangling owner_id.
      const { error: rbClubErr } = await supabaseAdmin.from('clubs').delete().eq('id', club.id);
      if (rbClubErr) {
        console.error('Club signup rollback FAILED — orphan club %s owned by %s (%s) (manual remediation needed):', club.id, userId, email, rbClubErr.message);
      } else {
        const { error: rbUserErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
        if (rbUserErr) console.error('Club signup rollback FAILED — orphan auth user %s (%s) blocks email retry (manual remediation needed):', userId, email, rbUserErr.message);
      }
      return res.redirect(BASE + '/for-clubs?error=membership');
    }

    // Send any member invites queued in the signup wizard. Best-effort: the
    // club is already created, so invite failures must never fail the signup.
    try {
      let queued = [];
      try { queued = JSON.parse(req.body.invites || '[]'); } catch (err) { queued = []; }
      if (Array.isArray(queued) && queued.length > 0) {
        queued = queued.slice(0, 50);
        const userByEmail = {};
        (await listAllAuthUsers()).forEach(u => { if (u.email) userByEmail[u.email.toLowerCase()] = u; });
        const inviter = displayFromUser(data.user);
        for (const inv of queued) {
          await createClubInviteRecord({
            clubId: club.id,
            inviterUser: data.user,
            email: inv && inv.email,
            role: inv && inv.role,
            req,
            userByEmail,
            clubName: club_name,
            inviterName: inviter.name
          });
        }
      }
    } catch (err) {
      // Invites are best-effort during signup — never block the redirect.
    }

    setSession(res, signInData.session);
    // Land on the dashboard of the club that was JUST created — explicit id,
    // never "whatever club resolves as most recent".
    return res.redirect(BASE + '/clubs/dashboard?club=' + club.id);
  } catch (err) {
    return res.redirect(BASE + '/for-clubs?error=signup');
  }
});

// Pre-flight email check for the club wizard's account step, so "this email
// already has an account" surfaces at the step where the email is typed
// instead of a dead redirect after the whole wizard. Uses the paged admin
// list (supabase-js v2 has no getUserByEmail) — fine at prototype scale.
app.post(BASE + '/auth/email-check', async (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !supabaseAdmin) {
    return res.json({ exists: false });
  }
  try {
    const users = await listAllAuthUsers();
    const exists = users.some(u => (u.email || '').toLowerCase() === email);
    return res.json({ exists });
  } catch (err) {
    return res.json({ exists: false });
  }
});

// Authenticated club creation for EXISTING users (the shortened /for-clubs
// wizard). Same invariants as /auth/signup-club minus the account step: one
// clubs row owned by the caller + one admin membership row, then best-effort
// invites. JSON in/out (unlike the form-POST signup path) so the wizard can
// surface field errors inline. Deliberately a NEW endpoint rather than a
// session-aware retrofit — the signup handler's form/redirect + account
// rollback semantics serve the public funnel and stay untouched.
const OWNED_CLUB_LIMIT = 3;
app.post(BASE + '/api/clubs/create', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'server' });
  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const handle = typeof body.handle === 'string' ? body.handle.trim().toLowerCase() : '';
  const sport = typeof body.sport === 'string' ? body.sport.trim() : '';
  const city = typeof body.city === 'string' ? body.city.trim().slice(0, 80) : '';
  if (!name || name.length > 80) return res.status(400).json({ error: 'invalid_name' });
  if (!/^[a-z0-9]{2,20}$/.test(handle)) return res.status(400).json({ error: 'invalid_handle' });
  if (!SPORTS.some(s => s.id === sport)) return res.status(400).json({ error: 'invalid_sport' });
  // Directory listing, wizard-only field. When present it must be a valid
  // value; when absent the insert omits the column and the DB default
  // ('private') applies — non-wizard create paths stay byte-identical.
  let visibility;
  if (body.visibility !== undefined) {
    if (body.visibility !== 'public' && body.visibility !== 'private') {
      return res.status(400).json({ error: 'invalid_visibility' });
    }
    visibility = body.visibility;
  }
  try {
    // Soft anti-abuse cap on clubs OWNED per account (handle squatting and
    // invite spam scale with free club creation). Memberships in other
    // people's clubs are unaffected — this counts owned clubs only.
    const { count: ownedCount } = await supabaseAdmin
      .from('clubs')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', req.user.id);
    if ((ownedCount || 0) >= OWNED_CLUB_LIMIT) {
      return res.status(403).json({ error: 'club_limit', limit: OWNED_CLUB_LIMIT });
    }

    // Friendly handle dedupe pre-check, case-insensitive to match the DB's
    // unique index on lower(handle). (`ilike` is safe here: the handle regex
    // above guarantees no wildcard characters.) The index below is the real
    // gate — this just answers fast for the common case.
    const { data: taken } = await supabaseAdmin
      .from('clubs')
      .select('id')
      .ilike('handle', handle)
      .limit(1);
    if (Array.isArray(taken) && taken.length > 0) {
      return res.status(409).json({ error: 'handle_taken' });
    }

    const { data: club, error: clubErr } = await supabaseAdmin
      .from('clubs')
      .insert(visibility !== undefined
        ? { name, handle, sport, city, owner_id: req.user.id, visibility }
        : { name, handle, sport, city, owner_id: req.user.id })
      .select('id')
      .single();
    if (clubErr || !club) {
      // Unique-index rejection (e.g. a race the pre-check missed) is still a
      // duplicate handle — same friendly 409 as the pre-check, never a 500.
      if (clubErr && clubErr.code === '23505') {
        return res.status(409).json({ error: 'handle_taken' });
      }
      return res.status(500).json({ error: 'club' });
    }

    const { error: memErr } = await supabaseAdmin
      .from('memberships')
      .insert({ user_id: req.user.id, club_id: club.id, role: 'admin' });
    if (memErr) {
      // Compensating cleanup — never leave an orphaned club row.
      const { error: rbErr } = await supabaseAdmin.from('clubs').delete().eq('id', club.id);
      if (rbErr) console.error('Club create rollback FAILED — orphan club %s owned by %s (manual remediation needed):', club.id, req.user.id, rbErr.message);
      return res.status(500).json({ error: 'membership' });
    }

    // Queued invites, best-effort exactly like the signup path — the club is
    // already created, so invite failures must never fail the request.
    try {
      const queued = Array.isArray(body.invites) ? body.invites.slice(0, 50) : [];
      if (queued.length > 0) {
        const userByEmail = {};
        (await listAllAuthUsers()).forEach(u => { if (u.email) userByEmail[u.email.toLowerCase()] = u; });
        const inviter = displayFromUser(req.user);
        for (const inv of queued) {
          await createClubInviteRecord({
            clubId: club.id,
            inviterUser: req.user,
            email: inv && inv.email,
            role: inv && inv.role,
            req,
            userByEmail,
            clubName: name,
            inviterName: inviter.name
          });
        }
      }
    } catch (err) {
      // Best-effort only.
    }

    return res.json({ redirect: BASE + '/clubs/dashboard?club=' + club.id });
  } catch (err) {
    console.log('Club create error:', err.message);
    return res.status(500).json({ error: 'server' });
  }
});

app.get(BASE + '/auth/logout', async (req, res) => {
  try {
    await supabase.auth.signOut();
  } catch (err) {
    // ignore — clear cookies regardless
  }
  res.clearCookie('sb_access_token');
  res.clearCookie('sb_refresh_token');
  return res.redirect(BASE + '/landing');
});

// ── PASSWORD RESET (server-side token_hash + verifyOtp) ──
// The "Forgot password?" form posts here. We ALWAYS respond with the same
// success redirect whether or not the email exists, to prevent account
// enumeration. Supabase emails the recovery link via the configured SMTP; its
// action URL is built from redirectTo and carries ?token_hash=...&type=recovery
// back to /reset-password (see the Supabase email-template config).
app.get(BASE + '/forgot-password', (req, res) =>
  res.sendFile(path.join(HTML, 'arenas-forgot-password.html')));

app.post(BASE + '/auth/forgot-password', async (req, res) => {
  const email = (req.body.email || '').trim();
  if (!email) return res.redirect(BASE + '/forgot-password?error=missing');
  try {
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: publicBaseUrl(req) + '/reset-password'
    });
  } catch (err) {
    // Swallow — the response must not reveal whether the email exists.
  }
  return res.redirect(BASE + '/landing?msg=reset_sent');
});

// The reset page reads token_hash from the query and posts it back with the new
// password. We verify the recovery OTP here (single-use) and, on success, set
// the new password with the service-role admin client by user id. No
// browser-side supabase-js: the OTP is verified server-side, not in the page.
app.get(BASE + '/reset-password', (req, res) =>
  res.sendFile(path.join(HTML, 'arenas-reset-password.html')));

app.post(BASE + '/reset-password', async (req, res) => {
  const token_hash = (req.body.token_hash || '').trim();
  const password = req.body.password || '';
  if (!token_hash) return res.redirect(BASE + '/reset-password?error=invalid');
  if (password.length < 8) {
    // Token not yet consumed — bounce back with it so the user can retry.
    return res.redirect(BASE + '/reset-password?token_hash=' +
      encodeURIComponent(token_hash) + '&type=recovery&error=weak');
  }
  if (!supabaseAdmin) return res.redirect(BASE + '/reset-password?error=server');
  try {
    const { data, error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash });
    if (error || !data || !data.user) {
      return res.redirect(BASE + '/reset-password?error=expired');
    }
    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(
      data.user.id, { password }
    );
    if (updErr) return res.redirect(BASE + '/reset-password?error=server');
    // Don't auto-login after a reset — send them to log in with the new password.
    return res.redirect(BASE + '/landing?msg=reset_ok');
  } catch (err) {
    return res.redirect(BASE + '/reset-password?error=expired');
  }
});

// ── EMAIL CONFIRMATION (server-side verifyOtp → auto-login) ──
// signUp sets emailRedirectTo to this route. Supabase's confirm link carries
// ?token_hash=...&type=signup; we verify it server-side, set the session cookie
// and drop the now-confirmed user straight into the app.
app.get(BASE + '/auth/confirm', async (req, res) => {
  const token_hash = (req.query.token_hash || '').toString();
  const type = (req.query.type || 'signup').toString();
  // Only signup confirmation may auto-login here. Reject any other OTP type
  // (notably 'recovery') so a password-reset token cannot be replayed against
  // this endpoint to bypass the "reset does not auto-login" policy.
  if (!token_hash || type !== 'signup') {
    return res.redirect(BASE + '/landing?msg=confirm_failed');
  }
  try {
    const { data, error } = await supabase.auth.verifyOtp({ type: 'signup', token_hash });
    if (error || !data || !data.session) {
      return res.redirect(BASE + '/landing?msg=confirm_failed');
    }
    setSession(res, data.session);
    return res.redirect(BASE + '/feed');
  } catch (err) {
    return res.redirect(BASE + '/landing?msg=confirm_failed');
  }
});

// ── AUTH GUARD (validates the signed Supabase access-token cookie) ──
async function requireAuth(req, res, next) {
  const token = req.signedCookies && req.signedCookies.sb_access_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data || !data.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    req.user = data.user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
}

// ── PAGE AUTH GUARD (redirects browsers to landing instead of a JSON 401) ──
async function requirePageAuth(req, res, next) {
  const token = req.signedCookies && req.signedCookies.sb_access_token;
  if (!token) return res.redirect(BASE + '/landing');
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data || !data.user) {
      return res.redirect(BASE + '/landing');
    }
    req.user = data.user;
    next();
  } catch (err) {
    return res.redirect(BASE + '/landing');
  }
}

// Honest error page for authenticated app pages. Served when live data cannot
// be loaded (Supabase unavailable or a route threw). NEVER fall back to the raw
// prototype HTML files — they contain placeholder personas ("Jamie King",
// "Hackney Running Club") that must not be shown to real users.
const PAGE_ERROR_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Arenas — Something went wrong</title>
<style>
  body{margin:0;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#F7F7F5;color:#111827;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{text-align:center;padding:40px 28px;max-width:420px}
  .mark{font-size:40px;margin-bottom:12px}
  h1{font-size:20px;margin:0 0 8px;font-weight:800}
  p{font-size:14px;color:#6B7280;line-height:1.5;margin:0 0 20px}
  a.btn{display:inline-block;background:#FFD21E;color:#111827;font-weight:700;font-size:14px;padding:10px 22px;border-radius:8px;text-decoration:none}
</style></head><body>
<div class="card">
  <div class="mark">🏟</div>
  <h1>Something went wrong</h1>
  <p>Arenas couldn’t load this page right now. Your data is safe — please try again in a moment.</p>
  <a class="btn" href="${BASE}/feed">Try again</a>
</div>
</body></html>`;
function sendPageError(res) {
  // X-Arenas-App-Error tells the service worker this 503 is an app-generated
  // error page (render it), not an edge/gateway failure (offline fallback).
  // no-store so no intermediary or browser ever retains a transient failure.
  res.status(503)
    .set('Cache-Control', 'no-store')
    .set('Retry-After', '30')
    .set('X-Arenas-App-Error', '1')
    .type('html')
    .send(PAGE_ERROR_HTML);
}

// Resolve the session user when a valid cookie is present, or null. For
// surfaces that render differently for logged-in visitors but must stay
// public (e.g. /for-clubs). Never throws, never blocks the request.
async function getOptionalUser(req) {
  const token = req.signedCookies && req.signedCookies.sb_access_token;
  if (!token) return null;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data || !data.user) return null;
    return data.user;
  } catch (err) {
    return null;
  }
}

// There is no `profiles` table in this project, so resolve a user's display
// name/handle from the Supabase auth user metadata (falling back to the email
// local part) — the same source the posts API uses.
function displayFromUser(user) {
  const meta = (user && user.user_metadata) || {};
  const emailLocal = user && user.email ? user.email.split('@')[0] : null;
  return {
    name: meta.name || emailLocal || 'Athlete',
    handle: meta.handle || emailLocal || 'athlete',
    avatar_url: meta.avatar_url || null,
    location: meta.location || null,
    // Structured place (additive; codes stored, names resolved from the
    // registry so an unknown/legacy code degrades to null, never garbage).
    country: meta.country || null,
    countryName: COUNTRY_NAMES[meta.country] || null,
    state: meta.state || null,
    stateName: US_STATE_NAMES[meta.state] || null,
    // Whether /athletes/:id renders for this user — the leaderboard opt-out
    // 404s the public profile (zero-leak), so surfaces must not link
    // opted-out names/avatars. Centralised here so every author/actor map
    // (buildUserDisplayMap, enrichActivities, notifications) carries it.
    profilePublic: !(meta.prefs && meta.prefs.show_on_leaderboards === false)
  };
}

// ── USER PREFERENCES (Settings toggles) ────────────────────────────────────
// Stored as an object under user_metadata.prefs. A missing key means TRUE
// (default-on): nobody's experience changes until they explicitly opt out.
// NOTE: updateUserById merges top-level metadata keys but replaces nested
// objects wholesale — writers must read-merge-write the prefs object.
const PREF_KEYS = [
  'show_on_leaderboards',  // off = excluded from rankings (leaderboards page all scopes + feed club-rank)
  'activity_feed_visible', // off = activities hidden from followers' feeds + no follower fan-out notifs
  'notify_kudos',          // gates type 'like'
  'notify_comments',       // gates type 'comment'
  'notify_followers',      // gates type 'follow'
  'notify_challenges',     // gates type 'challenge' (invites + reminders)
  'notify_events'          // gates type 'event' (invites, RSVPs, friend-going)
];

// Profile tabs whose header badges show "new since last viewed" counts.
// Per-tab last-seen timestamps live server-side in user_metadata.tab_seen
// (same account-level home as prefs — survives devices/browsers, unlike
// localStorage which would silo the cleared state per browser).
const TAB_SEEN_KEYS = ['activities', 'achievements', 'clubs', 'following'];
function prefsFromMeta(meta) {
  const stored = (meta && meta.prefs) || {};
  const out = {};
  PREF_KEYS.forEach((k) => { out[k] = stored[k] !== false; });
  return out;
}
// Which recipient preference gates each notification type. Types not listed
// ('club', 'achievement', 'activity') have no toggle and are never gated here
// — 'activity' fan-out is gated ACTOR-side by activity_feed_visible instead.
const NOTIF_PREF_BY_TYPE = {
  like: 'notify_kudos',
  comment: 'notify_comments',
  follow: 'notify_followers',
  challenge: 'notify_challenges',
  // Challenge invites are their own type so the notifications panel can attach
  // a live Join-pill state to them (and ONLY them — nudges/reminders stay type
  // 'challenge'). Same recipient toggle gates both.
  challenge_invite: 'notify_challenges',
  event: 'notify_events'
};

// Safely inject a server-built data object into an HTML page as
// window.ARENAS_DATA, escaping `<` so club/member names can't break out of the
// <script> tag.
function injectArenasData(html, dataObj) {
  const json = JSON.stringify(dataObj).replace(/</g, '\\u003c');
  return html.replace('</head>', `<script>window.ARENAS_DATA = ${json};</script></head>`);
}

// Mobile bottom navigation. Single server-side source of truth injected before
// </body> on shell pages so the markup is not duplicated across the static HTML.
// It is hidden on desktop and only shown <=768px (see arenas.css). The athlete
// variant mirrors the sidebar's nav() targets across the 7 athlete-facing pages;
// activeKey receives the bn-active class (challenges/athletes/notifications have
// no matching item, so nothing is active there — that is intentional).
function bnItem(activeKey, key, onclick, icon, label, primary) {
  const cls = 'bn-item' + (primary ? ' bn-primary' : '') + (activeKey === key ? ' bn-active' : '');
  return `<a class="${cls}" onclick="${onclick}"><span class="bn-icon">${icon}</span><span class="bn-label">${label}</span></a>`;
}
function athleteBottomNav(activeKey) {
  return '<nav class="bottom-nav" aria-label="Primary">'
    + bnItem(activeKey, 'feed', "nav('/feed')", '🏠', 'Feed', false)
    + bnItem(activeKey, 'events', "nav('/events')", '🎟️', 'Events', false)
    + bnItem(activeKey, 'log', "nav('/log')", '➕', 'Log', true)
    + bnItem(activeKey, 'calendar', "nav('/calendar')", '🗓️', 'Cal', false)
    + bnItem(activeKey, 'ranks', "nav('/leaderboards')", '🏆', 'Ranks', false)
    + bnItem(activeKey, 'profile', "nav('/profile')", '👤', 'Profile', false)
    + '</nav>';
}
const ATHLETE_NAV_ACTIVE = { feed: 'feed', profile: 'profile', events: 'events', log: 'log', calendar: 'calendar', leaderboards: 'ranks', challenges: null, athletes: null, clubs: null, notifications: null, billing: null };

// Club pages (coach dashboard + member home) navigate by switching tabs/sections
// in place via setTab(), not by loading a new URL, so their bottom nav calls
// cbnTab(): it runs setTab() and moves the bn-active highlight itself, since
// there is no page load to refresh the server-rendered active state. The helper
// script is injected once alongside the nav.
const CLUB_BN_SCRIPT = '<script>function cbnTab(e,id){try{setTab(id,null);}catch(_){}'
  + 'var n=document.querySelectorAll(".bottom-nav .bn-item");for(var i=0;i<n.length;i++){n[i].classList.remove("bn-active");}'
  + 'if(e&&e.currentTarget){e.currentTarget.classList.add("bn-active");}}</script>';
function clubBnItem(activeKey, key, tabId, icon, label) {
  const cls = 'bn-item' + (activeKey === key ? ' bn-active' : '');
  return `<a class="${cls}" onclick="cbnTab(event,'${tabId}')"><span class="bn-icon">${icon}</span><span class="bn-label">${label}</span></a>`;
}
function clubDashboardBottomNav(activeKey) {
  return '<nav class="bottom-nav" aria-label="Primary">'
    + clubBnItem(activeKey, 'overview', 'overview', '📊', 'Overview')
    + clubBnItem(activeKey, 'members', 'members', '👥', 'Members')
    + clubBnItem(activeKey, 'training', 'training', '📈', 'Load')
    + clubBnItem(activeKey, 'leaderboard', 'leaderboard', '🏆', 'Ranks')
    + clubBnItem(activeKey, 'feed', 'feed', '🏃', 'Feed')
    + '</nav>' + CLUB_BN_SCRIPT;
}
function clubMemberBottomNav(activeKey) {
  return '<nav class="bottom-nav" aria-label="Primary">'
    + clubBnItem(activeKey, 'overview', 'overview', '📊', 'Overview')
    + clubBnItem(activeKey, 'feed', 'feed', '📣', 'News')
    + clubBnItem(activeKey, 'challenges', 'challenges', '⚡', 'Goals')
    + clubBnItem(activeKey, 'events', 'events', '🎟️', 'Events')
    + clubBnItem(activeKey, 'members', 'members', '👥', 'Members')
    + '</nav>' + CLUB_BN_SCRIPT;
}
function bottomNavFor(pageKey) {
  if (pageKey === 'club-dashboard') return clubDashboardBottomNav('overview');
  if (pageKey === 'club-member') return clubMemberBottomNav('overview');
  if (Object.prototype.hasOwnProperty.call(ATHLETE_NAV_ACTIVE, pageKey)) return athleteBottomNav(ATHLETE_NAV_ACTIVE[pageKey]);
  return '';
}
// Avatar dropdown enhancement: a "Clubs you manage" section injected at the top
// of #userMenu, populated client-side from window.ARENAS_DATA.clubs. Gives
// admins/coaches a one-tap path to each club's dashboard from any shell page.
// The topbar (and its avatar menu) is visible on mobile, so this is the mobile
// route to the dashboard now that the sidebar is hidden <=768px. No-ops for pure
// athletes (no admin/coach membership) and for pages without ARENAS_DATA. Club
// names are written via textContent, so they cannot inject markup.
const MANAGED_CLUBS_MENU_SCRIPT = `<script>(function buildManagedClubsMenu(){
  try {
    var d = window.ARENAS_DATA;
    var clubs = (d && d.clubs) || [];
    var managed = clubs.filter(function(c){ return c.role === 'admin' || c.role === 'coach'; });
    if (!managed.length) return;
    var menu = document.getElementById('userMenu');
    if (!menu || menu.querySelector('.menu-club-item')) return;
    var icons = window.ARENAS_SPORT_ICONS || {};
    var bgs = {};
    (window.ARENAS_SPORTS || []).forEach(function(s){ bgs[s.id] = s.colors.bg; });
    var section = document.createElement('div');
    var lab = document.createElement('div');
    lab.style.cssText = 'font-size:10px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.05em;padding:9px 14px 5px';
    lab.textContent = 'Clubs you manage';
    section.appendChild(lab);
    managed.forEach(function(c){
      var item = document.createElement('div');
      item.className = 'menu-club-item';
      item.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer';
      item.onclick = function(){ if (typeof nav === 'function') nav('/clubs/dashboard?club=' + encodeURIComponent(c.id)); };
      var ic = document.createElement('div');
      ic.style.cssText = 'width:26px;height:26px;border-radius:7px;background:' + (bgs[c.sport] || '#FFF7ED') + ';display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;overflow:hidden';
      if (window.clubTileHtml) { ic.innerHTML = window.clubTileHtml.content(c.logo_url || null, c.sport); }
      else { ic.textContent = icons[c.sport] || '🏟'; }
      item.appendChild(ic);
      var mid = document.createElement('div');
      mid.style.cssText = 'flex:1;min-width:0';
      var nm = document.createElement('div');
      nm.style.cssText = 'font-size:13px;font-weight:600;color:var(--gray-900);line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      nm.textContent = c.name || 'Club';
      var sub = document.createElement('div');
      sub.style.cssText = 'font-size:10px;color:#854D0E';
      sub.textContent = 'Coach dashboard';
      mid.appendChild(nm); mid.appendChild(sub);
      item.appendChild(mid);
      var bdg = document.createElement('span');
      bdg.style.cssText = 'font-size:9px;font-weight:600;padding:2px 8px;border-radius:20px;background:#FAEEDA;color:#633806;flex-shrink:0';
      bdg.textContent = 'Manage';
      item.appendChild(bdg);
      item.addEventListener('mouseenter', function(){ item.style.background = 'var(--gray-50)'; });
      item.addEventListener('mouseleave', function(){ item.style.background = 'transparent'; });
      section.appendChild(item);
    });
    var dv = document.createElement('div');
    dv.style.cssText = 'height:0.5px;background:var(--gray-200);margin:4px 0';
    section.appendChild(dv);
    menu.insertBefore(section, menu.firstChild);
  } catch (e) {}
})();</script>`;

// ── SHARED AVATAR / CLUB TILE HELPERS ──
// One rendering source of truth for every avatar circle and club tile in the
// app. Injected into <head> (before any page inline script runs) so page
// renderers can call window.avatarHtml/clubTileHtml directly.
//   avatarHtml(url, name, sizeClass[, style])  → full wrapper div
//   clubTileHtml(url, sport, sizeClass[, style]) → full wrapper div
//   avatarHtml.content(url, name) / clubTileHtml.content(url, sport)
//     → inner markup only, for DOM-built sites that already own the wrapper
//       element (topbar .user-av keeps its inline onclick, sidebar IIFE, etc.)
// Markup pattern: hidden <span> fallback (initials or sport emoji) + an <img>
// that fills the wrapper (object-fit:cover, border-radius:inherit). On load
// error the img reveals the span and removes itself; with no URL only the
// fallback renders — so every surface keeps its exact current look as the
// fallback. All interpolated values are escaped.
const AVATAR_HELPERS_SCRIPT = `<script>(function arenasAvatarHelpers(){
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); };
  // Sports registry (sports.js) — the client-side single source of truth every
  // page's sport maps/pickers derive from. ARENAS_SPORT_ICONS is kept as a
  // derived alias (registry emoji + legacy entries for drifted stored values).
  window.ARENAS_SPORTS = ${JSON.stringify(SPORTS)};
  window.ARENAS_SPORT_ICONS = ${JSON.stringify(Object.assign({}, SPORT_ICONS, LEGACY_SPORT_EMOJI))};
  var sportsById = {};
  window.ARENAS_SPORTS.forEach(function (s) { sportsById[s.id] = s; });
  window.ARENAS_SPORTS_BY_ID = sportsById;
  // "🏃 Running" for registry sports; legacy icon + Title-case for known
  // drifted values (🔱 Triathlon); plain Title-case text for anything else —
  // existing stored data always keeps rendering (graceful fallback, no 🏅 spam).
  window.arenasSportTag = function (id) {
    var s = sportsById[id];
    if (s) return s.emoji + ' ' + s.label;
    var t = String(id == null ? '' : id);
    if (!t) return '';
    var label = t.charAt(0).toUpperCase() + t.slice(1);
    var icon = window.ARENAS_SPORT_ICONS[t];
    return icon ? icon + ' ' + label : label;
  };
  var IMG_STYLE = 'display:block;width:100%;height:100%;object-fit:cover;border-radius:inherit';
  var ONERR = "var s=this.previousElementSibling;if(s)s.style.display='';this.remove()";
  function inner(url, fallback) {
    if (!url) return esc(fallback);
    return '<span style="display:none">' + esc(fallback) + '</span>'
      + '<img src="' + esc(url) + '" alt="" style="' + IMG_STYLE + '" onerror="' + ONERR + '">';
  }
  function initialsOf(name) {
    var t = String(name || '').trim();
    if (!t) return 'A';
    return t.split(/\\s+/).map(function (n) { return n.charAt(0); }).join('').slice(0, 2).toUpperCase() || 'A';
  }
  window.avatarHtml = function (url, name, sizeClass, style) {
    return '<div class="' + esc(sizeClass || '') + '"' + (style ? ' style="' + esc(style) + '"' : '') + '>' + inner(url, initialsOf(name)) + '</div>';
  };
  window.avatarHtml.content = function (url, name) { return inner(url, initialsOf(name)); };
  window.clubTileHtml = function (url, sport, sizeClass, style) {
    return '<div class="' + esc(sizeClass || '') + '"' + (style ? ' style="' + esc(style) + '"' : '') + '>' + inner(url, window.ARENAS_SPORT_ICONS[sport] || '🏟') + '</div>';
  };
  window.clubTileHtml.content = function (url, sport) { return inner(url, window.ARENAS_SPORT_ICONS[sport] || '🏟'); };
})();</script>`;
function injectAvatarHelpers(html) {
  if (html.indexOf('arenasAvatarHelpers') !== -1) return html;
  return html.replace('</head>', AVATAR_HELPERS_SCRIPT + '</head>');
}

// Shared topbar/sidebar-footer identity renderer. Replaces the retired per-page
// per-page hardcoded-initials rewrite pattern: reads the viewer's profile (name +
// avatar_url now in displayFromUser output) from ARENAS_DATA (INVITE_DATA on
// the invite console) and renders the topbar avatar ([onclick*="userMenu"],
// same selector AVATAR_MENU_SCRIPT uses — the element keeps its inline onclick
// because only innerHTML changes) and every standardized sidebar-footer .sf-av.
// Injected at body end so it runs after the static markup exists; no-ops
// gracefully on pages without profile data.
const TOPBAR_IDENTITY_SCRIPT = `<script>(function arenasTopbarIdentity(){
  try {
    var d = window.ARENAS_DATA || window.INVITE_DATA;
    var p = d && d.profile;
    if (!p || !window.avatarHtml) return;
    var content = window.avatarHtml.content(p.avatar_url || null, p.name || 'Athlete');
    var top = document.querySelector('[onclick*="userMenu"]');
    if (top) top.innerHTML = content;
    document.querySelectorAll('.sf-av').forEach(function (el) { el.innerHTML = content; });
  } catch (e) {}
})();</script>`;

// Shared avatar-dropdown behaviour: open on avatar click, close on click-OUTSIDE
// (mirroring the notifications bell panel), replacing the fragile per-page
// onmouseleave that closed the menu the instant the cursor crossed the 8px gap
// between the avatar and the menu. One source of truth for every shell page that
// carries the avatar menu; the inline onclick toggle on the avatar is left as-is.
// Targets the menu by #userMenu and the avatar by [onclick*="userMenu"] so it
// works regardless of per-page wrapper classes (e.g. blog's topbar-user/avatar-sm).
// Coexists with the bell: each dropdown's own click-outside listener treats a
// click on the other trigger as "outside", so opening one closes the other.
const AVATAR_MENU_SCRIPT = `<script>(function avatarMenuBehaviour(){
  try {
    var menu = document.getElementById('userMenu');
    if (!menu) return;
    var wrap = menu.parentElement;
    if (wrap) { wrap.removeAttribute('onmouseleave'); wrap.onmouseleave = null; }
    document.addEventListener('click', function (e) {
      var m = document.getElementById('userMenu');
      if (!m || m.style.display === 'none') return;
      var avatar = document.querySelector('[onclick*="userMenu"]');
      if (m.contains(e.target)) return;
      if (avatar && avatar.contains(e.target)) return;
      m.style.display = 'none';
    });
  } catch (e) {}
})();</script>`;

// Shared in-place notifications dropdown. Markup is the club dashboard's panel;
// the behaviour lives in the served arenas-notifications-panel.js. For any page
// whose bell still navigates to the (now retired) /notifications page, rebuild
// the bell exactly like the dashboard: wrap it in a position:relative box with
// the panel as a SIBLING (never a child — a nested panel would bubble its own
// clicks up into the bell's onclick and toggle itself shut). Works for both
// .notif-btn and .icon-btn. Atomic and self-guarding: no-ops on the dashboard
// (its panel id already exists) and on any page without the bell, and only
// injects the panel script when the bell actually matched (otherwise the bell
// simply keeps redirecting to /feed rather than becoming a dead button).
const NOTIF_PANEL_MARKUP = `<div id="notifications-panel" style="display:none;position:absolute;top:calc(100% + 8px);right:0;width:360px;max-height:480px;background:white;border:var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);z-index:300;overflow:hidden;flex-direction:column">
        <div style="padding:12px 16px;border-bottom:var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
          <div style="font-size:14px;font-weight:600;color:var(--gray-900)">Notifications</div>
          <div style="display:flex;align-items:center;gap:8px">
            <button onclick="markAllNotificationsRead()" style="font-size:12px;color:var(--gray-500);background:none;border:none;cursor:pointer">Mark all read</button>
            <a href="#" id="notif-see-all" onclick="showAllNotifications();return false;" style="font-size:12px;color:var(--gray-500);text-decoration:none;display:none">See all →</a>
          </div>
        </div>
        <div id="notifications-panel-list" style="overflow-y:auto;flex:1;max-height:400px">
          <div style="text-align:center;padding:32px;font-size:13px;color:var(--gray-400)">Loading notifications…</div>
        </div>
      </div>`;
// Append the shared avatar-dropdown behaviour script once, only on pages that
// actually have the avatar menu. Idempotent (guards on the IIFE name).
function injectAvatarMenu(html) {
  if (html.indexOf('id="userMenu"') === -1) return html;
  if (html.indexOf('avatarMenuBehaviour') !== -1) return html;
  return html.replace('</body>', AVATAR_MENU_SCRIPT + '</body>');
}
function injectNotificationsPanel(html) {
  // The avatar-dropdown fix is independent of the bell panel and must run on
  // every shell page that has the avatar menu — including the club dashboard,
  // whose notifications panel is already inline (so the bell block below no-ops
  // there, but the avatar fix still needs to apply).
  let out = injectAvatarHelpers(injectAvatarMenu(html));
  // Shared topbar/sidebar-footer identity (photo avatar or initials) — every
  // shell page gets it; no-ops without profile data.
  if (out.indexOf('arenasTopbarIdentity') === -1) {
    out = out.replace('</body>', TOPBAR_IDENTITY_SCRIPT + '</body>');
  }
  if (out.indexOf('id="notifications-panel"') === -1) {
    const withBell = out.replace(
      /<div class="(notif-btn|icon-btn)" onclick="nav\('\/notifications'\)">(.*?)<div class="notif-dot"><\/div><\/div>/,
      '<div style="position:relative"><div class="$1" onclick="toggleNotificationsPanel()">$2<div class="notif-dot"></div></div>' + NOTIF_PANEL_MARKUP + '</div>'
    );
    out = (withBell !== out)
      ? withBell.replace('</body>', '<script src="' + BASE + '/arenas-notifications-panel.js"></script></body>')
      : withBell;
  }
  return out;
}
function injectBottomNav(html, pageKey) {
  let out = html;
  if (!out.includes('class="bottom-nav"')) {
    const nav = bottomNavFor(pageKey);
    if (nav) out = out.replace('</body>', nav + '</body>');
  }
  // Shared avatar-dropdown "Clubs you manage" enhancement (one source of truth
  // for all shell pages; self-guards against double injection and no-ops for
  // pure athletes / pages without ARENAS_DATA).
  if (out.indexOf('buildManagedClubsMenu') === -1) {
    out = out.replace('</body>', MANAGED_CLUBS_MENU_SCRIPT + '</body>');
  }
  out = injectNotificationsPanel(out);
  return out;
}

// ── PRO BADGE ──
// Server-side "PRO" badge for Individual Pro subscribers. Driven by the real
// subscription (getUserPlan), deliberately NOT by PLAN_GATES_ENABLED — a paying
// user sees their status even while gates are off. Free users' pages contain
// zero badge markup (nothing client-guessed, no flash of wrong state). Targets:
//   1. the sidebar "My profile" nav item (athlete shell pages + billing),
//   2. the avatar-dropdown "My profile" row (every shell page; the only profile
//      entry point on the club dashboard, and the mobile path to the profile —
//      the bottom nav's cramped icon pills stay badge-free on purpose).
const PRO_BADGE_HTML = '<span class="pro-badge">PRO</span>';
// Club plan variant — same .pro-badge pill, longer label for the dashboard
// footer identity block where the plan name has room to read unambiguously.
const CLUB_PRO_BADGE_HTML = '<span class="pro-badge">CLUB PRO</span>';
function injectProBadge(html, isPro) {
  if (!isPro) return html;
  let out = html.replaceAll(
    '👤</span> My profile</div>',
    '👤</span> My profile ' + PRO_BADGE_HTML + '</div>'
  );
  out = out.replaceAll(
    'text-decoration:none">My profile</a>',
    'text-decoration:none">My profile ' + PRO_BADGE_HTML + '</a>'
  );
  return out;
}

// ── NOTIFICATIONS ──
// Insert a notification row for a recipient. Best-effort: failures are logged
// but never bubble up, so the triggering action (like/comment/follow) still
// succeeds. Uses the shared supabaseAdmin singleton.
async function createNotification({ userId, type, title, body, link, actorId, entityId }) {
  if (!supabaseAdmin || !userId) return;
  // Respect the recipient's notification preferences for gated types. Fail
  // OPEN: if the lookup errors we deliver (current behavior), never drop.
  const prefKey = NOTIF_PREF_BY_TYPE[type];
  if (prefKey) {
    try {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (u && u.user && !prefsFromMeta(u.user.user_metadata)[prefKey]) return;
    } catch (err) {
      // Lookup failure → deliver.
    }
  }
  try {
    const { error } = await supabaseAdmin.from('notifications').insert({
      user_id: userId,
      type,
      title,
      body,
      link,
      actor_id: actorId,
      entity_id: entityId,
      read: false
    });
    if (error) console.log('Notification creation error:', error.message);
  } catch (err) {
    console.log('Notification creation error:', err.message);
  }
}

// Attach actor display info to notifications. There is no `profiles` table, so
// resolve each distinct actor's name/handle from auth metadata (one lookup per
// unique actor) instead of an FK embed.
async function enrichNotifications(notifications) {
  const list = notifications || [];
  const ids = [...new Set(list.map(n => n.actor_id).filter(Boolean))];
  const actorMap = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
      if (u && u.user) actorMap[id] = displayFromUser(u.user);
    } catch (err) {
      // Ignore individual lookup failures; the card falls back to defaults.
    }
  }));
  return list.map(n => {
    const actor = actorMap[n.actor_id] || null;
    // Serve-time remap (links are stored at creation time): a follow
    // notification's most useful destination is the follower's public
    // profile. Only when reachable — an opted-out actor's profile 404s, so
    // those keep their stored link.
    const link = (n.type === 'follow' && n.actor_id && actor && actor.profilePublic !== false)
      ? '/athletes/' + n.actor_id
      : n.link;
    return { ...n, link, actor };
  });
}

// Resolve a set of user IDs to their display info (name/handle) from auth
// metadata. There is no `profiles` table, so this mirrors enrichNotifications:
// one getUserById lookup per unique ID. Returns a map keyed by user ID.
async function buildUserDisplayMap(ids) {
  const map = {};
  if (!supabaseAdmin) return map;
  const unique = [...new Set((ids || []).filter(Boolean))];
  await Promise.all(unique.map(async (id) => {
    try {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
      if (u && u.user) map[id] = displayFromUser(u.user);
    } catch (err) {
      // Ignore individual lookup failures; callers fall back to defaults.
    }
  }));
  return map;
}

// Fetch every Supabase auth user across all pages. listUsers is paginated
// (default/most 1000 per page), so a single call would misclassify users beyond
// the first page as "new". Capped at 50 pages as a safety bound.
async function listAllAuthUsers() {
  const all = [];
  if (!supabaseAdmin) return all;
  const perPage = 1000;
  for (let page = 1; page <= 50; page++) {
    try {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error) break;
      const users = (data && data.users) || [];
      all.push(...users);
      if (users.length < perPage) break;
    } catch (err) {
      console.log('listUsers error:', err.message);
      break;
    }
  }
  return all;
}

// ── CLUB INVITES (helpers) ──
// Sentinel email stored on shareable "open" invite links that aren't tied to a
// specific recipient, so the admin UI can tell open links apart from personal
// email invites.
const OPEN_INVITE_EMAIL = 'open-invite@realarenas.com';
// Personal email invites live 14 days; open shareable links live 30 days.
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const OPEN_INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Random, unguessable invite token (256 bits of entropy, hex-encoded).
function generateInviteToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Absolute base URL for building shareable join links. Derived from the
// incoming request (honoring the proxy's forwarded protocol and the artifact
// BASE path) instead of a hard-coded domain, so links are correct on both the
// Replit (/html) preview and the Railway (root) deployment.
function publicBaseUrl(req) {
  // Prefer an explicit canonical origin when configured. This closes a
  // Host/x-forwarded-proto spoofing vector now that absolute links (esp. invite
  // emails) go out from a trusted sender. Falls back to request-derived host so
  // dev and any environment without PUBLIC_BASE_URL set keep working unchanged.
  const override = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (override) return `${override}${BASE}`;
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  return `${proto}://${req.get('host')}${BASE}`;
}

// Look up a user's role within a specific club (or null if they aren't a
// member). Used to authorize invite/member management so one club's manager
// can't read or mutate another club's data.
async function getClubRole(userId, clubId) {
  if (!supabaseAdmin || !userId || !clubId) return null;
  try {
    const { data } = await supabaseAdmin
      .from('memberships')
      .select('role')
      .eq('user_id', userId)
      .eq('club_id', clubId)
      .order('created_at', { ascending: false })
      .limit(1);
    return (Array.isArray(data) && data[0]) || null;
  } catch (err) {
    return null;
  }
}

function isClubManagerRole(role) {
  return role === 'admin' || role === 'coach';
}

// ── PLAN RESOLUTION (subscriptions table) ──
// A subscription row counts as paid only while status is 'active' or
// 'past_due' (grace window while Stripe retries a failed payment). No row,
// any other status, or any error resolves to the free plan — plan lookups
// must never break a request.
const PAID_SUB_STATUSES = ['active', 'past_due'];

async function getPaidSubscription(ownerType, ownerId) {
  if (!supabaseAdmin || !ownerId) return null;
  try {
    const { data } = await supabaseAdmin
      .from('subscriptions')
      .select('plan, status')
      .eq('owner_type', ownerType)
      .eq('owner_id', ownerId)
      .limit(1);
    const row = (Array.isArray(data) && data[0]) || null;
    return row && PAID_SUB_STATUSES.includes(row.status) ? row : null;
  } catch (err) {
    return null;
  }
}

// Returns 'pro' or 'free'.
async function getUserPlan(userId) {
  const sub = await getPaidSubscription('user', userId);
  return sub && sub.plan === 'pro' ? 'pro' : 'free';
}

// Returns 'club_pro' or 'free'.
async function getClubPlan(clubId) {
  const sub = await getPaidSubscription('club', clubId);
  return sub && sub.plan === 'club_pro' ? 'club_pro' : 'free';
}

// ── PLAN GATING (master switch) ──
// Everything below gates ONLY when PLAN_GATES_ENABLED is truthy. Unset/false =>
// zero gating anywhere. Set alongside Stripe live mode to enforce the Pro tier
// (live in production).
const PLAN_GATES_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.PLAN_GATES_ENABLED || '').trim());

// Express middleware factory: gate an individual-scoped route behind the Pro
// plan. Mirrors the requireEventManager / requireChallengeManager authorization
// style (applied per route). When the flag is off it is a pure pass-through, so
// behaviour is byte-identical to today. When on, a free user gets a structured
// 403 the client turns into an honest upgrade affordance. Must run AFTER
// requireAuth so req.user exists.
function requireProPlan(feature) {
  return async function (req, res, next) {
    if (!PLAN_GATES_ENABLED) return next();
    const plan = await getUserPlan(req.user.id);
    if (plan !== 'free') return next();
    return res.status(403).json({ error: 'pro_required', feature, upgrade: '/billing' });
  };
}

// True when this request's user should see Pro features rendered as locked (flag
// on AND free plan). Pages inject this so the client shows honest locked states
// instead of calling endpoints that would 403. Only queries the plan when the
// flag is on; never throws (any error resolves to unlocked = today's behaviour).
async function computeProLocked(userId) {
  if (!PLAN_GATES_ENABLED) return false;
  try { return (await getUserPlan(userId)) === 'free'; }
  catch (err) { return false; }
}

// ── CLUB PLAN GATING (separate master switch) ──
// Club Pro enforcement has its OWN flag so it can deploy fully dormant while
// the athlete-side PLAN_GATES_ENABLED is already live in production. Parsed
// identically; unset/false => pure pass-through everywhere (zero club gating).
const CLUB_PLAN_GATES_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.CLUB_PLAN_GATES_ENABLED || '').trim());

// Inline club-plan gate for the Club Pro feature routes. These routes resolve
// manager authz INLINE (a memberships query → 403), not via middleware, so the
// plan check is a helper called immediately AFTER that existing 403 — authz
// first, plan second (the codified layering order). Returns true when it has
// already sent the 403 (caller must `return`).
async function clubProGateBlocked(res, clubId, feature) {
  if (!CLUB_PLAN_GATES_ENABLED) return false;
  if ((await getClubPlan(clubId)) !== 'free') return false;
  res.status(403).json({ error: 'club_pro_required', feature, upgrade: '/billing' });
  return true;
}

// True when this club's Pro features should render locked (flag on AND free
// plan). Mirrors computeProLocked: only queries the plan when the flag is on;
// never throws (any error resolves to unlocked = today's behaviour). Injected
// into the club-dashboard page as gating.clubProLocked — no UI consumes it yet
// (Session 2's hook).
async function computeClubProLocked(clubId) {
  if (!CLUB_PLAN_GATES_ENABLED || !clubId) return false;
  try { return (await getClubPlan(clubId)) === 'free'; }
  catch (err) { return false; }
}

// Inject a server-built object into a page as window.<varName>, escaping `<`
// so club/member names can't break out of the <script> tag. Mirrors
// injectArenasData but supports page-specific variable names.
function injectNamedData(html, varName, dataObj) {
  const json = JSON.stringify(dataObj).replace(/</g, '\\u003c');
  return html.replace('</head>', `<script>window.${varName} = ${json};</script></head>`);
}

// ── POSTS API (training notes) ──
// Mounted under BASE so the shared proxy routes them to this artifact
// (the separate api-server owns the bare "/api" path).
// Create a post — accepts BOTH shapes through one route: JSON (text-only,
// the original contract) and multipart/form-data with an optional 'image'
// file. Atomic: the image is processed and uploaded FIRST, the row inserted
// with image_url; if the insert fails the just-uploaded object is rolled
// back. There is never a created post waiting on a failed upload, and never
// an orphaned object referenced by nothing.
app.post(BASE + '/api/posts/create', requireAuth, (req, res) => {
  postImageUploadSingle(req, res, async () => {
    const { content, sport, feeling } = req.body || {};
    const text = (content || '').trim();
    const hasImage = !!(req.file && req.file.buffer);
    // Image-without-text is a valid post; empty-both is not.
    if (!text && !hasImage) {
      return res.json({ error: 'Content is required' });
    }
    if (text.length > 280) {
      return res.json({ error: 'Post must be 280 characters or less' });
    }
    if (!supabaseAdmin) return res.json({ error: 'Server is not configured for posting' });

    const lockKey = 'post:' + req.user.id;
    if (hasImage && avatarUploadsInFlight.has(lockKey)) {
      return res.status(429).json({ error: 'An upload is already in progress — give it a second' });
    }
    if (hasImage) avatarUploadsInFlight.add(lockKey);
    let imageUrl = null;
    let inserted = false;
    try {
      let objectPath = null;
      if (hasImage) {
        let meta;
        try { meta = await sharp(req.file.buffer).metadata(); } catch (err) { meta = null; }
        if (!meta || !['jpeg', 'png', 'webp'].includes(meta.format)) {
          return res.status(400).json({ error: 'That file is not a supported image — upload a JPG, PNG or WebP' });
        }
        // .rotate() applies the EXIF orientation then Sharp drops ALL
        // metadata on re-encode (EXIF/GPS stripped). fit:'inside' preserves
        // the source aspect ratio — no crop, no upscale.
        const webp = await sharp(req.file.buffer).rotate()
          .resize(1440, 1440, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 }).toBuffer();
        objectPath = 'posts/' + req.user.id + '/' + Date.now() + '.webp';
        const { error: upErr } = await supabaseAdmin.storage
          .from(POST_IMAGE_BUCKET)
          .upload(objectPath, webp, { contentType: 'image/webp', upsert: false });
        if (upErr) {
          console.log('Post image storage upload error:', upErr.message);
          return res.status(500).json({ error: 'Could not store the image — please try again' });
        }
        imageUrl = supabaseAdmin.storage.from(POST_IMAGE_BUCKET).getPublicUrl(objectPath).data.publicUrl;
      }
      const { data, error } = await supabaseAdmin
        .from('posts')
        .insert({
          user_id: req.user.id,
          content: text,
          sport: sport || null,
          feeling: feeling || null,
          image_url: imageUrl
        })
        .select()
        .single();
      if (error) {
        // Row insert failed after the object went up — roll the object back
        // so it never becomes an orphan nobody references.
        if (imageUrl) await deletePostImageObject(imageUrl, req.user.id);
        return res.json({ error: error.message });
      }
      inserted = true;
      res.json({ success: true, post: data });
    } catch (err) {
      console.log('Post create error:', err.message);
      // Compensation must also cover THROWN failures after the upload (SDK
      // or network exceptions), not just returned insert errors — otherwise
      // the uploaded object is orphaned.
      if (imageUrl && !inserted) {
        try { await deletePostImageObject(imageUrl, req.user.id); } catch (e2) { /* best-effort */ }
      }
      res.status(500).json({ error: 'Could not create the post' });
    } finally {
      if (hasImage) avatarUploadsInFlight.delete(lockKey);
    }
  });
});

// NOTE: there is deliberately NO "GET /api/posts" list route. A legacy one
// served EVERY post to any authenticated user with no follower filter; it
// was dead code (nothing called it — feed posts are server-injected via
// buildFeedPosts, which scopes to follows + self) and was removed rather
// than scoped. Do not reintroduce an unscoped post list.

app.post(BASE + '/api/posts/:id/like', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for posting' });
  const { data: existing } = await supabaseAdmin
    .from('post_likes')
    .select('post_id')
    .eq('post_id', req.params.id)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (existing) {
    const { error: unlikeErr } = await supabaseAdmin.from('post_likes').delete()
      .eq('post_id', req.params.id)
      .eq('user_id', req.user.id);
    if (unlikeErr) return res.status(500).json({ error: 'Could not remove kudos' });
    return res.json({ liked: false });
  }
  const { error } = await supabaseAdmin.from('post_likes').insert({
    post_id: req.params.id,
    user_id: req.user.id
  });
  if (error) return res.json({ error: error.message });
  // Notify the post author that someone gave them kudos (skip self-likes).
  try {
    const { data: post } = await supabaseAdmin
      .from('posts')
      .select('user_id, content')
      .eq('id', req.params.id)
      .maybeSingle();
    if (post && post.user_id !== req.user.id) {
      const liker = displayFromUser(req.user);
      const text = post.content || '';
      await createNotification({
        userId: post.user_id,
        type: 'like',
        title: 'New kudos',
        body: `${liker.name} gave kudos on your training note: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`,
        link: '/feed',
        actorId: req.user.id,
        entityId: req.params.id
      });
    }
  } catch (err) {
    console.log('Like notification error:', err.message);
  }
  // Award any newly earned badges (e.g. "Good Sport") without blocking.
  checkAchievements(req.user.id, getUserTimezone(req.user)).catch(() => {});
  res.json({ liked: true });
});

app.post(BASE + '/api/posts/:id/comment', requireAuth, async (req, res) => {
  const { content } = req.body;
  if (!content || content.trim().length === 0) {
    return res.json({ error: 'Comment cannot be empty' });
  }
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for posting' });
  const { data, error } = await supabaseAdmin
    .from('post_comments')
    .insert({
      post_id: req.params.id,
      user_id: req.user.id,
      content: content.trim()
    })
    .select()
    .single();
  if (error) return res.json({ error: error.message });
  // Notify the post author that someone commented (skip self-comments).
  try {
    const { data: post } = await supabaseAdmin
      .from('posts')
      .select('user_id, content')
      .eq('id', req.params.id)
      .maybeSingle();
    if (post && post.user_id !== req.user.id) {
      const commenter = displayFromUser(req.user);
      const text = content.trim();
      await createNotification({
        userId: post.user_id,
        type: 'comment',
        title: 'New comment',
        body: `${commenter.name} commented: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`,
        link: '/feed',
        actorId: req.user.id,
        entityId: req.params.id
      });
    }
  } catch (err) {
    console.log('Comment notification error:', err.message);
  }
  res.json({ success: true, comment: data });
});

// Delete a post. Authorization = canManagePost: the author always; for a club
// announcement (club_id set) ALSO a current admin/coach of that club — the
// club owns that speech, matching who may announce. Personal posts stay
// author-only. Club deletion cascades posts via the club_id FK
// (ON DELETE CASCADE) — the app never double-handles that.
// Historical note (pre club_id):
// so there is no club context giving a manager authority (matches the
// activity rule, not the event one).
// Zero-leak: the row is fetched first and a non-author answers byte-identically
// to a nonexistent id (404 "Post not found") — NOT the filtered-delete-
// returns-success shape.
// Cascade order: likes → comments → notifications → post row → image object.
// Row before object, best-effort object cleanup (same as avatars/events), so
// a storage failure can never block the delete.
app.delete(BASE + '/api/posts/:id', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Server is not configured for posting' });
  try {
    const { data: post } = await supabaseAdmin
      .from('posts')
      .select('id, user_id, club_id, image_url')
      .eq('id', req.params.id)
      .maybeSingle();
    // Zero-leak: denial is byte-identical to a nonexistent id (no existence
    // oracle). canManagePost = author, or admin/coach of the announcement's club.
    if (!post || !(await canManagePost(post, req.user.id))) {
      return res.status(404).json({ error: 'Post not found' });
    }
    const { error: likeErr } = await supabaseAdmin.from('post_likes').delete().eq('post_id', post.id);
    if (likeErr) return res.status(500).json({ error: 'Could not delete the post' });
    const { error: comErr } = await supabaseAdmin.from('post_comments').delete().eq('post_id', post.id);
    if (comErr) return res.status(500).json({ error: 'Could not delete the post' });
    // Like/comment notifications reference the post via entity_id. This is a
    // required row cascade like likes/comments — a returned error blocks the
    // delete (only the storage object cleanup below is best-effort).
    const { error: notifErr } = await supabaseAdmin.from('notifications').delete()
      .eq('entity_id', post.id)
      .in('type', ['like', 'comment']);
    if (notifErr) {
      console.log('Post notification sweep failed:', notifErr.message);
      return res.status(500).json({ error: 'Could not delete the post' });
    }
    const { error } = await supabaseAdmin.from('posts').delete().eq('id', post.id);
    if (error) return res.status(500).json({ error: 'Could not delete the post' });
    if (post.image_url) await deletePostImageObject(post.image_url, post.user_id);
    res.json({ success: true });
  } catch (err) {
    console.log('Post delete error:', err.message);
    res.status(500).json({ error: 'Could not delete the post' });
  }
});

// ── FOLLOWS API ──
// Follow a user. Idempotent — a duplicate follow (unique-constraint 23505) is
// treated as success so the button stays consistent.
app.post(BASE + '/api/follow/:userId', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for following' });
  const targetId = req.params.userId;
  if (!targetId || targetId === req.user.id) {
    return res.json({ error: 'You cannot follow yourself' });
  }
  const { error } = await supabaseAdmin
    .from('follows')
    .insert({ follower_id: req.user.id, following_id: targetId });
  if (error && error.code !== '23505') return res.json({ error: error.message });
  // Notify the followed user (skip on duplicate follow so we don't double-notify).
  if (!error) {
    try {
      const follower = displayFromUser(req.user);
      await createNotification({
        userId: targetId,
        type: 'follow',
        title: 'New follower',
        body: `${follower.name} started following you`,
        link: '/athletes',
        actorId: req.user.id,
        entityId: req.user.id
      });
    } catch (err) {
      console.log('Follow notification error:', err.message);
    }
  }
  // Award any newly earned badges (e.g. "Social Starter") without blocking.
  checkAchievements(req.user.id, getUserTimezone(req.user)).catch(() => {});
  res.json({ success: true, following: true });
});

// Unfollow a user.
app.delete(BASE + '/api/follow/:userId', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for following' });
  const { error } = await supabaseAdmin
    .from('follows')
    .delete()
    .eq('follower_id', req.user.id)
    .eq('following_id', req.params.userId);
  if (error) return res.json({ error: error.message });
  res.json({ success: true, following: false });
});

// Check whether the viewer follows a user.
app.get(BASE + '/api/follow/:userId', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ following: false });
  const { data, error } = await supabaseAdmin
    .from('follows')
    .select('follower_id')
    .eq('follower_id', req.user.id)
    .eq('following_id', req.params.userId)
    .maybeSingle();
  if (error) return res.json({ following: false });
  res.json({ following: !!data });
});

// ── ACTIVITIES API (manual training log) ──
// Legacy column scrubber: activities.ai_insight held server-canned "Coach's
// note" strings (fabricated coach persona, removed by user decision). The
// column stays in the DB (no DDL / no data loss) but must never leave the
// server — apply this to every activity row that reaches a payload built
// from select('*').
function stripLegacyInsight(row) {
  if (row && typeof row === 'object') delete row.ai_insight;
  return row;
}

// Attach author display info (name/handle) to a list of activities. There is no
// `profiles` table, so resolve each distinct user's identity from auth metadata
// (one lookup per unique user, same approach as buildFeedPosts/enrichNotifications).
async function enrichActivities(activities) {
  const list = activities || [];
  if (!supabaseAdmin || !list.length) return list.map(a => ({ ...a, author: { name: 'Athlete', handle: 'athlete' } }));
  const ids = [...new Set(list.map(a => a.user_id).filter(Boolean))];
  const map = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
      if (u && u.user) map[id] = displayFromUser(u.user);
    } catch (err) {
      // Ignore individual lookup failures; the card falls back to defaults.
    }
  }));
  return list.map(a => ({ ...a, author: map[a.user_id] || { name: 'Athlete', handle: 'athlete' } }));
}

// Recent activities from people the viewer follows (plus their own), enriched
// with author display info, for the feed. Mirrors buildFeedPosts' follow logic.
async function buildFeedActivities(limit, currentUserId) {
  if (!supabaseAdmin) return [];
  let followingIds = [];
  if (currentUserId) {
    const { data: following } = await supabaseAdmin
      .from('follows')
      .select('following_id')
      .eq('follower_id', currentUserId);
    followingIds = (following || []).map(f => f.following_id).filter(Boolean);
  }
  // "Activity feed visible" off = the author's activities are hidden from
  // FOLLOWERS' feeds. The viewer's own activities always stay in their own
  // feed (the preference hides you from others, never from yourself). Club
  // feeds are intentionally untouched — club membership is its own opt-in
  // sharing context. Fail open: a failed lookup keeps the author visible.
  if (followingIds.length) {
    const authorProfiles = await buildUserProfileMap(followingIds);
    followingIds = followingIds.filter((id) => !(authorProfiles[id] && authorProfiles[id].prefs && !authorProfiles[id].prefs.activity_feed_visible));
  }
  const feedUserIds = [...new Set([...followingIds, currentUserId].filter(Boolean))];
  if (!feedUserIds.length) return [];
  // Ordered by created_at (when the activity was LOGGED), not the activity's
  // `date` field: the feed sorts by the social moment, so an activity logged
  // today for last Tuesday must be inside the fetch window at today's position.
  const { data, error } = await supabaseAdmin
    .from('activities')
    .select('*')
    .in('user_id', feedUserIds)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  data.forEach(stripLegacyInsight);
  const enriched = await enrichActivities(data);
  const likeRows = await fetchActivityLikes(enriched.map((a) => a.id));
  return enriched.map((a) => {
    const likes = likeRows.filter((l) => l.activity_id === a.id);
    return {
      ...a,
      likeCount: likes.length,
      likedByMe: likes.some((l) => l.user_id === currentUserId)
    };
  });
}

// Kudos rows for a set of activities. `activity_likes` mirrors `post_likes`
// (keyed by (activity_id, user_id), no `id` column) and — like `activities`
// and `achievements` — must be created by the USER in the Supabase SQL editor
// (service role cannot run DDL). Degrade to zero-counts until it exists so
// every surface keeps rendering.
async function fetchActivityLikes(activityIds) {
  if (!supabaseAdmin || !activityIds.length) return [];
  try {
    const { data, error } = await supabaseAdmin
      .from('activity_likes')
      .select('activity_id, user_id')
      .in('activity_id', activityIds);
    if (error) return [];
    return data || [];
  } catch (err) {
    return [];
  }
}

// Recent "going" RSVPs from people the viewer follows, surfaced in the feed.
// Names come from auth metadata (no `profiles` table); events are joined in JS
// rather than via a PostgREST embed so this works regardless of FK metadata.
async function buildFeedRsvps(currentUserId) {
  if (!supabaseAdmin || !currentUserId) return [];
  try {
    const { data: follows } = await supabaseAdmin
      .from('follows').select('following_id').eq('follower_id', currentUserId);
    const followingIds = [...new Set((follows || []).map(f => f.following_id).filter(Boolean))];
    if (!followingIds.length) return [];
    const { data: rsvpRows } = await supabaseAdmin
      .from('event_rsvps')
      .select('id, event_id, user_id, status, created_at')
      .in('user_id', followingIds)
      .eq('status', 'going')
      .order('created_at', { ascending: false })
      .limit(10);
    if (!rsvpRows || !rsvpRows.length) return [];
    const eventIds = [...new Set(rsvpRows.map(r => r.event_id).filter(Boolean))];
    const eventMap = {};
    if (eventIds.length) {
      const { data: evs } = await supabaseAdmin
        .from('events')
        .select('id, title, date, location, sport, event_type, visibility, club_id, created_by, image_path')
        .in('id', eventIds);
      // Visibility gate: a followed athlete's RSVP to a private/club event the
      // VIEWER can't see must not surface that event's title in their feed.
      const visibleEvs = await visibleEventsFilter(currentUserId, evs || []);
      visibleEvs.forEach(e => {
        eventMap[e.id] = { id: e.id, title: e.title, date: e.date, location: e.location, sport: e.sport, event_type: e.event_type, image: eventImageVersion(e.image_path) };
      });
    }
    const nameMap = await buildUserDisplayMap(rsvpRows.map(r => r.user_id));
    return rsvpRows
      .map(r => ({
        id: r.id,
        user_id: r.user_id,
        created_at: r.created_at || null,
        author: nameMap[r.user_id] || { name: 'Athlete', handle: 'athlete' },
        event: eventMap[r.event_id] || null
      }))
      .filter(r => r.event);
  } catch (err) {
    console.log('Feed RSVP build error:', err.message);
    return [];
  }
}

// Create an activity for the logged-in user and notify
// the user's followers (best-effort). The full activities schema must exist in
// Supabase (applied via the SQL editor) — until then inserts return an error.
app.post(BASE + '/api/activities/create', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for logging activities' });
  const b = req.body || {};
  if (!b.sport) return res.json({ error: 'Please select a sport' });
  if (!b.title || !b.title.trim()) return res.json({ error: 'Please enter an activity title' });
  // Notes are public (feed + club feeds); cap length server-side — the log
  // form's maxlength is UX only, not a security boundary. 500 chars matches
  // the planned-session notes limit.
  if (b.notes && String(b.notes).length > 500) {
    return res.json({ error: 'Notes must be 500 characters or less' });
  }
  // Golf's numeric column gets real bounds validation (the other per-sport
  // fields are free-form text columns). Distinct from swimming's `stroke`
  // column — different name, different config, zero interaction.
  let golfStrokes = null;
  if (b.golf_strokes != null && String(b.golf_strokes).trim() !== '') {
    const n = Number(b.golf_strokes);
    if (!Number.isInteger(n) || n < 1 || n > 300) {
      return res.json({ error: 'Strokes must be a whole number between 1 and 300' });
    }
    golfStrokes = n;
  }
  const golfCourse = (b.golf_course && String(b.golf_course).trim()) ? String(b.golf_course).trim().slice(0, 120) : null;
  // "Log this" handoff from the calendar: an optional plan_id links the new
  // activity to one of the CALLER'S OWN planned sessions. Ownership is checked
  // BEFORE the insert — a forged plan_id belonging to another user is a hard
  // 403 (never a cross-user write); a stale/deleted plan_id is ignored so a
  // plan deleted in another tab can't block honest activity logging.
  let linkPlan = null;
  if (b.plan_id != null && String(b.plan_id).trim() !== '') {
    try {
      const { data: planRow } = await supabaseAdmin
        .from('planned_sessions').select('id, user_id')
        .eq('id', String(b.plan_id).trim()).maybeSingle();
      if (planRow && planRow.user_id !== req.user.id) {
        return res.status(403).json({ error: 'forbidden' });
      }
      linkPlan = planRow || null;
    } catch (err) {
      console.log('Plan link lookup error (ignoring link):', err.message);
    }
  }
  const activityData = {
    user_id: req.user.id,
    sport: b.sport,
    title: b.title.trim(),
    date: b.date || new Date().toISOString(),
    duration: b.duration || null,
    notes: b.notes || null,
    feeling: b.feeling || null,
    distance: b.distance || null,
    pace: b.pace || null,
    avg_hr: b.avg_hr || null,
    elevation: b.elevation || null,
    cadence: b.cadence || null,
    run_type: b.run_type || null,
    avg_power: b.avg_power || null,
    avg_speed: b.avg_speed || null,
    ride_type: b.ride_type || null,
    top_grade: b.top_grade || null,
    project_grade: b.project_grade || null,
    problems_count: b.problems_count || null,
    climbing_style: b.climbing_style || null,
    climb_location: b.climb_location || null,
    swim_pace: b.swim_pace || null,
    pool_type: b.pool_type || null,
    stroke: b.stroke || null,
    session_type: b.session_type || null,
    position: b.position || null,
    session_focus: b.session_focus || null,
    total_volume: b.total_volume || null,
    top_lift: b.top_lift || null,
    sets_completed: b.sets_completed || null,
    rpe: b.rpe || null,
    trail: b.trail || null,
    terrain: b.terrain || null,
    pack_weight: b.pack_weight || null,
    yoga_style: b.yoga_style || null,
    yoga_format: b.yoga_format || null,
    focus_area: b.focus_area || null,
    instructor: b.instructor || null,
    golf_strokes: golfStrokes,
    golf_course: golfCourse
  };
  const { data, error } = await supabaseAdmin
    .from('activities')
    .insert(activityData)
    .select()
    .single();
  if (error) return res.json({ error: error.message });
  // Close out the linked plan in the same request: set activity_id + done.
  // Self-only by construction (linkPlan ownership was verified above); the
  // .eq('user_id', …) filter is defense-in-depth.
  // A failed link is reported, not hidden: the activity itself saved (rolling
  // it back over a bookkeeping link would lose the user's data), but the
  // response says planLinkFailed so the client can land the user where the
  // still-pending plan is visible instead of silently pretending no link was
  // requested.
  let planCompleted = false;
  let planLinkFailed = false;
  if (linkPlan) {
    try {
      const { error: linkErr } = await supabaseAdmin
        .from('planned_sessions')
        .update({ activity_id: data.id, status: 'done', updated_at: new Date().toISOString() })
        .eq('id', linkPlan.id).eq('user_id', req.user.id);
      if (linkErr) {
        planLinkFailed = true;
        console.error('Plan link update FAILED (plan %s, activity %s, user %s) — activity saved but plan still pending:', linkPlan.id, data.id, req.user.id, linkErr.message);
      } else planCompleted = true;
    } catch (err) {
      planLinkFailed = true;
      console.error('Plan link update FAILED (plan %s, activity %s, user %s) — activity saved but plan still pending:', linkPlan.id, data.id, req.user.id, err.message);
    }
  }
  // Notify followers (best-effort). The actor name comes from auth metadata
  // (no `profiles` table), not a DB join. Gated ACTOR-side by the logger's
  // "Activity feed visible" preference: if their activities are hidden from
  // followers' feeds, the "X logged a new activity" fan-out would leak the
  // same information, so it is skipped too.
  try {
    const { data: followers } = (prefsFromMeta(req.user.user_metadata).activity_feed_visible)
      ? await supabaseAdmin
          .from('follows')
          .select('follower_id')
          .eq('following_id', req.user.id)
      : { data: [] };
    const actor = displayFromUser(req.user);
    for (const f of (followers || [])) {
      await createNotification({
        userId: f.follower_id,
        type: 'activity',
        title: 'New activity',
        body: `${actor.name} logged a new ${data.sport} activity: "${data.title}"`,
        link: '/profile',
        actorId: req.user.id,
        entityId: data.id
      });
    }
  } catch (err) {
    console.log('Activity notification error:', err.message);
  }
  // Award any newly earned badges (volume/distance/streak/feats) without blocking.
  checkAchievements(req.user.id, getUserTimezone(req.user)).catch(() => {});
  res.json({ success: true, activity: data, planCompleted, planLinkFailed });
});

// Recent activities for a given user (used by the profile Activities tab).
// Self-only: the Activities tab only ever requests the logged-in user's own
// list, and activities are surfaced to followers via the feed endpoint instead.
// Scoping to self here prevents reading another user's history by guessing IDs.
app.get(BASE + '/api/activities/:userId', requireAuth, async (req, res) => {
  if (req.params.userId !== req.user.id) return res.status(403).json({ error: 'Not allowed' });
  if (!supabaseAdmin) return res.json({ activities: [] });
  const { data, error } = await supabaseAdmin
    .from('activities')
    .select('*')
    .eq('user_id', req.params.userId)
    .order('date', { ascending: false })
    .limit(50);
  if (error) return res.json({ error: error.message });
  // Kudos counts for the profile Activities tab — count-only (no give-button
  // there): the owner sees appreciation on their own training; giving kudos
  // happens where OTHERS' activities appear, i.e. the feed.
  const rows = (data || []).map(stripLegacyInsight);
  const likeRows = await fetchActivityLikes(rows.map((a) => a.id));
  const activities = rows.map((a) => ({
    ...a,
    likeCount: likeRows.filter((l) => l.activity_id === a.id).length
  }));
  res.json({ activities });
});

// Toggle kudos on an activity — exact mirror of POST /api/posts/:id/like.
// One kudos per user per activity is enforced server-side by the table's
// (activity_id, user_id) primary key; self-kudos is allowed (same as posts)
// but never notified.
app.post(BASE + '/api/activities/:id/like', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured' });
  const { data: existing, error: selErr } = await supabaseAdmin
    .from('activity_likes')
    .select('activity_id')
    .eq('activity_id', req.params.id)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (selErr) return res.json({ error: selErr.message });
  if (existing) {
    const { error: unlikeErr } = await supabaseAdmin.from('activity_likes').delete()
      .eq('activity_id', req.params.id)
      .eq('user_id', req.user.id);
    if (unlikeErr) return res.status(500).json({ error: 'Could not remove kudos' });
    return res.json({ liked: false });
  }
  const { error } = await supabaseAdmin.from('activity_likes').insert({
    activity_id: req.params.id,
    user_id: req.user.id
  });
  if (error) return res.json({ error: error.message });
  // Notify the activity's owner (skip self-kudos). Type 'like' is recipient-
  // gated by the "Kudos on activities" preference (notify_kudos) inside
  // createNotification.
  try {
    const { data: activity } = await supabaseAdmin
      .from('activities')
      .select('user_id, title')
      .eq('id', req.params.id)
      .maybeSingle();
    if (activity && activity.user_id !== req.user.id) {
      const liker = displayFromUser(req.user);
      const title = activity.title || 'a training session';
      await createNotification({
        userId: activity.user_id,
        type: 'like',
        title: 'New kudos',
        body: `${liker.name} gave kudos on your activity: "${String(title).slice(0, 60)}${String(title).length > 60 ? '...' : ''}"`,
        link: '/feed',
        actorId: req.user.id,
        entityId: req.params.id
      });
    }
  } catch (err) {
    console.log('Activity like notification error:', err.message);
  }
  // Award any newly earned badges (e.g. "Good Sport") without blocking.
  checkAchievements(req.user.id, getUserTimezone(req.user)).catch(() => {});
  res.json({ liked: true });
});

// Delete one of the viewer's own activities. Zero-leak: fetch first — a
// non-author and a nonexistent id answer byte-identically (404 "Activity not
// found"). The old shape (filtered delete + unconditional success) told a
// non-author their delete worked when zero rows matched.
app.delete(BASE + '/api/activities/:id', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured' });
  const { data: row } = await supabaseAdmin
    .from('activities')
    .select('id, user_id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!row || row.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Activity not found' });
  }
  const { error } = await supabaseAdmin
    .from('activities')
    .delete()
    .eq('id', row.id)
    .eq('user_id', req.user.id);
  if (error) return res.json({ error: error.message });
  res.json({ success: true });
});

// Activities from followed users for the feed (JSON variant; the /feed page also
// injects these server-side via window.ARENAS_DATA.feedActivities).
app.get(BASE + '/api/feed/activities', requireAuth, async (req, res) => {
  const activities = await buildFeedActivities(20, req.user.id);
  res.json({ activities });
});

// ── LEADERBOARDS ──
// Points per sport (SPORT_POINTS) come from the sports registry (sports.js):
// distance-based sports score per km; the rest score per session. The derived
// map is asserted identical to the historic literal in sports.test.js.

// THE canonical distance parser — every km figure in the app (points scoring,
// profile hero + Stats & PRs, weekly km, club rollups/reports, challenges,
// goals, achievement badges) must go through this. `distance` is a free-form
// string with the unit inside it (no unit column), so this converts to real
// km: "km" as-is, "mi"/miles ×1.609, bare "m"/metres ÷1000, no unit → assume
// km. Strips thousands separators first so "2,000m" parses as 2000 m → 2 km.
// HISTORY: a unit-blind parseDistanceKm (numeral-only, "10mi" read as 10 km,
// swim metres inflated ~1000×) used to power display totals; it was retired
// app-wide when the profile hero (unit-aware) and Stats & PRs (unit-blind)
// visibly disagreed on the same all-time total. Do not reintroduce a second
// distance parser.
function parseDistanceKmUnitAware(distance) {
  if (distance == null) return 0;
  const raw = String(distance).toLowerCase().replace(/,/g, '');
  const n = parseFloat(raw.replace(/[^0-9.]/g, ''));
  if (isNaN(n) || n <= 0) return 0;
  if (raw.includes('km')) return n;
  if (raw.includes('mi')) return n * 1.609;
  if (raw.includes('m')) return n / 1000;
  return n;
}

// Total leaderboard points for a set of activities. Distance is UNIT-AWARE:
// "10 mi" credits 16.09 km, "2,000m" credits 2 km (parseDistanceKmUnitAware) —
// this is the exact math documented on the public /how-points-work page, so
// any change here must stay in sync with that page's worked examples.
function calculatePoints(activities) {
  let total = 0;
  (activities || []).forEach((a) => {
    const cfg = SPORT_POINTS[a.sport];
    if (!cfg) { total += 20; return; } // unknown sport: flat per-session credit
    if (cfg.per === 'km') {
      const dist = parseDistanceKmUnitAware(a.distance);
      total += dist > 0 ? dist * cfg.rate : cfg.rate * 2; // logged-but-no-distance fallback
    } else {
      total += cfg.rate;
    }
  });
  return Math.round(total);
}

// ISO bounds for a leaderboard period, resolved in the VIEWER's timezone:
// 'week' starts Monday 00:00 in `tz` (matching the feed/profile Monday-week
// stats and the leaderboards page copy), 'month' starts on the 1st of the
// current calendar month in `tz` (matching the challenges header "pts this
// month"). 'rolling7' is a plain instant window 7×24h back — used ONLY for
// the at-risk 5-day check, which must never clip at a Monday boundary.
// 'all' returns a null start (no lower bound) — callers must branch on it
// and skip the `.gte` filter.
function getDateRange(period, tz) {
  const zone = isValidTimezone(tz) ? tz : 'UTC';
  const now = new Date();
  if (period === 'week') {
    return { start: zoneMidnightUtc(weekStartKey(now, zone), zone).toISOString(), end: now.toISOString() };
  }
  if (period === 'month') {
    return { start: zoneMidnightUtc(monthKey(now, zone) + '-01', zone).toISOString(), end: now.toISOString() };
  }
  if (period === 'rolling7') {
    return { start: new Date(now.getTime() - 7 * 86400000).toISOString(), end: now.toISOString() };
  }
  return { start: null, end: now.toISOString() };
}

// Fetch activities for a set of users within a period (one query — callers
// bucket by user_id; never query per-user). Sport is optional. `tz` is the
// requesting VIEWER's zone (window boundaries follow the viewer, per the
// timezone boundary policy).
async function fetchActivitiesForUsers(userIds, period, sport, tz) {
  if (!supabaseAdmin || !userIds.length) return [];
  const { start } = getDateRange(period, tz);
  let q = supabaseAdmin
    .from('activities')
    .select('user_id, sport, distance, date')
    .in('user_id', userIds);
  if (start) q = q.gte('date', start);
  if (sport && sport !== 'all') q = q.eq('sport', sport);
  const { data, error } = await q;
  if (error) return [];
  return data || [];
}

// Group an activity list by user_id.
function bucketActivities(activities) {
  const byUser = {};
  (activities || []).forEach((a) => {
    (byUser[a.user_id] = byUser[a.user_id] || []).push(a);
  });
  return byUser;
}

// Resolve user IDs to richer display info (name/handle/sports/location) from auth
// metadata. There is no `profiles` table, so this mirrors buildUserDisplayMap but
// also returns sports/location. One getUserById per unique id (small sets only).
async function buildUserProfileMap(ids) {
  const map = {};
  if (!supabaseAdmin) return map;
  const unique = [...new Set((ids || []).filter(Boolean))];
  await Promise.all(unique.map(async (id) => {
    try {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
      if (u && u.user) {
        const m = u.user.user_metadata || {};
        const disp = displayFromUser(u.user);
        map[id] = {
          name: disp.name,
          handle: disp.handle,
          avatar_url: disp.avatar_url || null,
          sports: Array.isArray(m.sports) ? m.sports : [],
          location: m.location || null,
          // Stored zone (validated at read time by consumers via
          // isValidTimezone; absent for users who predate capture).
          timezone: m.timezone || null,
          // Resolved preference booleans (default-on) — additive, used by
          // ranking surfaces to exclude leaderboard opt-outs. A failed lookup
          // leaves the entry absent → callers default to include.
          prefs: prefsFromMeta(m),
          // Whether /athletes/:id renders for this user (leaderboard opt-out
          // 404s the public profile). Surfaces use this to decide if a
          // name/avatar becomes a link — opted-out users are never linked.
          profilePublic: prefsFromMeta(m).show_on_leaderboards !== false
        };
      }
    } catch (err) {
      // Ignore individual lookup failures; callers fall back to defaults.
    }
  }));
  return map;
}

// Platform-wide leaderboard. Enumerates all auth users (name/handle/sports read
// straight from metadata — no per-user lookups) and scores their activities in
// the period. Only users with activity are shown.
app.get(BASE + '/api/leaderboard/platform', requireAuth, async (req, res) => {
  const period = req.query.period || 'week';
  const sport = req.query.sport || 'all';
  if (!supabaseAdmin) return res.json({ leaderboard: [], period, sport });
  try {
    // "Show on leaderboards" opt-outs are excluded for EVERY viewer, including
    // themselves — a self-only rank that nobody else sees would be a lie. The
    // opted-out user can still browse the boards; they just hold no rank.
    const users = (await listAllAuthUsers())
      .filter((u) => prefsFromMeta(u.user_metadata).show_on_leaderboards);
    const userIds = users.map((u) => u.id);
    const byUser = bucketActivities(await fetchActivitiesForUsers(userIds, period, sport, getUserTimezone(req.user)));
    const leaderboard = users.map((u) => {
      const m = u.user_metadata || {};
      const disp = displayFromUser(u);
      const acts = byUser[u.id] || [];
      return {
        userId: u.id,
        name: disp.name,
        handle: disp.handle,
        avatar_url: disp.avatar_url || null,
        sports: Array.isArray(m.sports) ? m.sports : [],
        location: m.location || null,
        points: calculatePoints(acts),
        activityCount: acts.length,
        isMe: u.id === req.user.id
      };
    })
      .filter((u) => u.activityCount > 0)
      .sort((a, b) => b.points - a.points)
      .map((u, i) => ({ ...u, rank: i + 1 }));
    res.json({ leaderboard, period, sport });
  } catch (err) {
    console.log('Platform leaderboard error:', err.message);
    res.json({ leaderboard: [], period, sport });
  }
});

// Leaderboard across the people the viewer follows (plus themselves). The full
// curated set is shown even at zero points so the viewer always sees their circle.
app.get(BASE + '/api/leaderboard/following', requireAuth, async (req, res) => {
  const period = req.query.period || 'week';
  const sport = req.query.sport || 'all';
  if (!supabaseAdmin) return res.json({ leaderboard: [], period, sport });
  try {
    const { data: following } = await supabaseAdmin
      .from('follows').select('following_id').eq('follower_id', req.user.id);
    const allIds = [...new Set([...(following || []).map((f) => f.following_id), req.user.id].filter(Boolean))];
    const profileMap = await buildUserProfileMap(allIds);
    // Leaderboard opt-outs drop out here too (universal exclusion — including
    // the viewer's own row if THEY opted out). Failed lookups stay ranked.
    const userIds = allIds.filter((id) => !(profileMap[id] && profileMap[id].prefs && !profileMap[id].prefs.show_on_leaderboards));
    const byUser = bucketActivities(await fetchActivitiesForUsers(userIds, period, sport, getUserTimezone(req.user)));
    const leaderboard = userIds.map((id) => {
      const p = profileMap[id] || { name: 'Athlete', handle: 'athlete', sports: [], location: null };
      const acts = byUser[id] || [];
      return {
        userId: id, name: p.name, handle: p.handle, avatar_url: p.avatar_url || null, sports: p.sports, location: p.location,
        points: calculatePoints(acts), activityCount: acts.length, isMe: id === req.user.id
      };
    })
      .sort((a, b) => b.points - a.points)
      .map((u, i) => ({ ...u, rank: i + 1 }));
    res.json({ leaderboard, period, sport });
  } catch (err) {
    console.log('Following leaderboard error:', err.message);
    res.json({ leaderboard: [], period, sport });
  }
});

// Leaderboard across the viewer's club members. Returns an empty board (no club)
// for athletes without a membership.
app.get(BASE + '/api/leaderboard/club', requireAuth, async (req, res) => {
  const period = req.query.period || 'week';
  const sport = req.query.sport || 'all';
  if (!supabaseAdmin) return res.json({ leaderboard: [], clubName: null, period, sport });
  try {
    const { data: membership } = await supabaseAdmin
      .from('memberships')
      .select('club_id, clubs:club_id (name)')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!membership || !membership.club_id) return res.json({ leaderboard: [], clubName: null, period, sport });
    const club = Array.isArray(membership.clubs) ? membership.clubs[0] : membership.clubs;
    const { data: members } = await supabaseAdmin
      .from('memberships').select('user_id').eq('club_id', membership.club_id);
    const allMemberIds = [...new Set((members || []).map((m) => m.user_id).filter(Boolean))];
    const profileMap = await buildUserProfileMap(allMemberIds);
    // Same universal opt-out exclusion as the platform/following scopes.
    const memberIds = allMemberIds.filter((id) => !(profileMap[id] && profileMap[id].prefs && !profileMap[id].prefs.show_on_leaderboards));
    const byUser = bucketActivities(await fetchActivitiesForUsers(memberIds, period, sport, getUserTimezone(req.user)));
    const leaderboard = memberIds.map((id) => {
      const p = profileMap[id] || { name: 'Member', handle: 'member', sports: [], location: null };
      const acts = byUser[id] || [];
      return {
        userId: id, name: p.name, handle: p.handle, avatar_url: p.avatar_url || null, sports: p.sports, location: p.location,
        points: calculatePoints(acts), activityCount: acts.length, isMe: id === req.user.id
      };
    })
      .sort((a, b) => b.points - a.points)
      .map((u, i) => ({ ...u, rank: i + 1 }));
    res.json({ leaderboard, clubName: (club && club.name) || 'Your club', period, sport });
  } catch (err) {
    console.log('Club leaderboard error:', err.message);
    res.json({ leaderboard: [], clubName: null, period, sport });
  }
});

// Club dashboard leaderboard (coach/admin only): distance & session rankings plus
// at-risk members (no activity in 5+ days, computed from the full roster so
// zero-activity members are included).
app.get(BASE + '/api/leaderboard/club-dashboard', requireAuth, async (req, res) => {
  const period = req.query.period || 'week';
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured' });
  try {
    const { data: membership } = await supabaseAdmin
      .from('memberships')
      .select('club_id')
      .eq('user_id', req.user.id)
      .in('role', ['admin', 'coach'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!membership || !membership.club_id) return res.json({ error: 'Not authorised' });
    const { data: members } = await supabaseAdmin
      .from('memberships').select('user_id').eq('club_id', membership.club_id);
    const memberIds = [...new Set((members || []).map((m) => m.user_id).filter(Boolean))];
    const acts = await fetchActivitiesForUsers(memberIds, period, 'all', getUserTimezone(req.user));
    const byUser = bucketActivities(acts);
    const profileMap = await buildUserProfileMap(memberIds);

    // At-risk: no activity in the last 5 days, regardless of the selected period.
    // Always a rolling instant window — a Monday-bound 'week' would clip to
    // less than 5 days early in the week and mark active members at-risk.
    const recent = await fetchActivitiesForUsers(memberIds, 'rolling7', 'all');
    const fiveDaysAgo = new Date(); fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const recentUserIds = new Set((recent || []).filter((a) => new Date(a.date) >= fiveDaysAgo).map((a) => a.user_id));
    const atRisk = memberIds
      .filter((id) => !recentUserIds.has(id) && id !== req.user.id) // exclude the viewing coach (matches the nudge recipient set)
      .map((id) => ({ userId: id, name: (profileMap[id] && profileMap[id].name) || 'Member', avatar_url: (profileMap[id] && profileMap[id].avatar_url) || null, daysInactive: 5 }));

    const stats = memberIds.map((id) => {
      const a = byUser[id] || [];
      let totalKm = 0; a.forEach((x) => { totalKm += parseDistanceKmUnitAware(x.distance); });
      return {
        userId: id,
        name: (profileMap[id] && profileMap[id].name) || 'Member',
        handle: (profileMap[id] && profileMap[id].handle) || 'member',
        avatar_url: (profileMap[id] && profileMap[id].avatar_url) || null,
        totalKm,
        sessionCount: a.length
      };
    });
    const byDistance = [...stats].sort((a, b) => b.totalKm - a.totalKm);
    const bySessions = [...stats].sort((a, b) => b.sessionCount - a.sessionCount);
    const totalKm = Math.round(stats.reduce((s, u) => s + u.totalKm, 0));
    const totalSessions = stats.reduce((s, u) => s + u.sessionCount, 0);
    const activeCount = stats.filter((u) => u.sessionCount > 0).length;
    // Mixed endpoint: Starter rankings AND the Pro at-risk data share this
    // response, so a locked club is NEVER 403'd here — the Pro fields (atRisk
    // + stats.atRiskCount) are simply omitted and the rankings stay untouched.
    // The client's `if (atRisk.length)` guard no-ops safely on the omission.
    // Both branches spell out the full payload so the unlocked shape stays
    // byte-identical to today (key order preserved).
    const clubLocked = await computeClubProLocked(membership.club_id);
    res.json(clubLocked ? {
      byDistance,
      bySessions,
      stats: { totalMembers: memberIds.length, activeCount, totalKm, totalSessions },
      period
    } : {
      byDistance,
      bySessions,
      atRisk,
      stats: { totalMembers: memberIds.length, activeCount, totalKm, totalSessions, atRiskCount: atRisk.length },
      period
    });
  } catch (err) {
    console.log('Club dashboard leaderboard error:', err.message);
    res.json({ error: 'Could not load leaderboard' });
  }
});

// Send a check-in nudge to the club's at-risk members. The recipient set is
// recomputed SERVER-SIDE from memberships + recent activity — never trust
// client-supplied IDs, so this can't spam arbitrary users.
app.post(BASE + '/api/clubs/:clubId/nudge-atrisk', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured' });
  const clubId = req.params.clubId;
  try {
    const { data: membership } = await supabaseAdmin
      .from('memberships')
      .select('club_id')
      .eq('user_id', req.user.id)
      .eq('club_id', clubId)
      .in('role', ['admin', 'coach'])
      .maybeSingle();
    if (!membership) return res.status(403).json({ error: 'Not authorised' });
    if (await clubProGateBlocked(res, clubId, 'club_at_risk')) return;
    const { data: members } = await supabaseAdmin
      .from('memberships').select('user_id').eq('club_id', clubId);
    const memberIds = [...new Set((members || []).map((m) => m.user_id).filter(Boolean))];
    const recent = await fetchActivitiesForUsers(memberIds, 'rolling7', 'all');
    const fiveDaysAgo = new Date(); fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const recentUserIds = new Set((recent || []).filter((a) => new Date(a.date) >= fiveDaysAgo).map((a) => a.user_id));
    const atRiskIds = memberIds.filter((id) => !recentUserIds.has(id) && id !== req.user.id);
    const coach = displayFromUser(req.user);
    for (const userId of atRiskIds) {
      await createNotification({
        userId,
        type: 'club',
        title: 'Check-in from your coach',
        body: `${coach.name} noticed you haven't logged any activity recently — how are you getting on? Jump back in when you're ready.`,
        link: '/profile',
        actorId: req.user.id,
        entityId: clubId
      });
    }
    res.json({ success: true, nudged: atRiskIds.length });
  } catch (err) {
    console.log('Nudge at-risk error:', err.message);
    res.json({ error: 'Could not send nudges' });
  }
});

// ── TRAINING LOAD ──
// Parse an activity's logged duration into hours. Handles "45", "45 min",
// "1h 30m" and "1:30" formats. A bare number > 12 is treated as minutes,
// otherwise as hours (members tend to log short sessions in minutes).
function parseDurationHours(duration) {
  if (!duration) return 0;
  const str = String(duration).toLowerCase().trim();
  if (str.includes(':')) {
    const parts = str.split(':');
    const a = parseFloat(parts[0]) || 0;
    const b = parseFloat(parts[1]) || 0;
    // The log form steers users to "45:00" (MM:SS) for short sessions, but "1:30"
    // means 1h30m. Treat a first segment > 12 as minutes:seconds, else hours:minutes.
    return a > 12 ? a / 60 + b / 3600 : a + b / 60;
  }
  const hMatch = str.match(/(\d+(?:\.\d+)?)\s*h/);
  const mMatch = str.match(/(\d+(?:\.\d+)?)\s*m/);
  if (hMatch || mMatch) {
    return (parseFloat(hMatch && hMatch[1]) || 0) + (parseFloat(mMatch && mMatch[1]) || 0) / 60;
  }
  const num = parseFloat(str.replace(/[^0-9.]/g, ''));
  if (isNaN(num)) return 0;
  return num > 12 ? num / 60 : num;
}

// Week-grid boundaries now come from weekStartKey (tzdate.js) in the viewing
// coach's zone — the old server-local getWeekStart helper is gone with them.

// Shared streak computation now lives in tzdate.js (computeStreaks) and takes
// the user's zone: distinct active days come from per-zone day keys instead of
// server-local toDateString buckets. Old-vs-new equivalence for tz='UTC' was
// verified over a randomized case set before the swap (the server runs UTC, so
// UTC keys reproduce the legacy buckets exactly).

// Weekly training-load breakdown for a coach's club dashboard. Load is derived
// from logged activity duration (there is no wearable/HR data). Names/handles/
// sports come from auth metadata (no `profiles` table). Admin/coach of the
// :clubId only.
app.get(BASE + '/api/clubs/:clubId/training-load', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured' });
  const clubId = req.params.clubId;
  // `weeks` is whitelisted to the switcher's range options (6/12/24 — same
  // precedent as the profile stats chart); anything else falls back to the
  // page's historic 6. The window is computed on-read from the same
  // zone-aware per-member bucketing below regardless of length.
  const wq = parseInt(req.query.weeks, 10);
  const weeks = wq === 6 || wq === 12 || wq === 24 ? wq : 6;
  try {
    const { data: membership } = await supabaseAdmin
      .from('memberships')
      .select('club_id')
      .eq('user_id', req.user.id)
      .eq('club_id', clubId)
      .in('role', ['admin', 'coach'])
      .maybeSingle();
    if (!membership) return res.status(403).json({ error: 'Not authorised' });
    if (await clubProGateBlocked(res, clubId, 'club_training_load')) return;

    const { data: members } = await supabaseAdmin
      .from('memberships').select('user_id').eq('club_id', clubId);
    const memberIds = [...new Set((members || []).map((m) => m.user_id).filter(Boolean))];
    const profileMap = await buildUserProfileMap(memberIds);

    // Week grid boundaries come from the requesting COACH's zone (boundary
    // policy rule 2); each member's activities bucket into that grid by their
    // OWN local day keys (rule 1). Keys are plain calendar dates, so the two
    // compose directly. Oldest week first.
    const coachTz = getUserTimezone(req.user);
    const weekKeys = [];
    for (let i = weeks - 1; i >= 0; i--) weekKeys.push(weekStartKey(new Date(), coachTz, i));
    const periodStartKey = weekKeys[0];
    const thisWeekKey = weekKeys[weekKeys.length - 1];

    // Every activity in the window (need `duration` for load). Fetched one
    // day wider than the grid window so a member whose zone is ahead of UTC
    // still contributes their full local days — the per-member key filters
    // below re-cut the exact buckets. Paged in 1000-row chunks: PostgREST
    // caps a single response at 1000 rows, and a 24-week window on an active
    // club can exceed that — without paging the older weeks would silently
    // read as zero. Row order doesn't matter (weekly sums are commutative).
    let activities = [];
    if (memberIds.length) {
      const sinceIso = keyToUtcDate(addDaysToKey(periodStartKey, -1)).toISOString();
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabaseAdmin
          .from('activities')
          .select('user_id, sport, distance, duration, date')
          .in('user_id', memberIds)
          .gte('date', sinceIso)
          .order('date', { ascending: false })
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        activities = activities.concat(data);
        if (data.length < PAGE) break;
      }
    }
    const byUser = bucketActivities(activities);

    const memberData = memberIds.map((id) => {
      const prof = profileMap[id] || {};
      const memberTz = memberZone(prof);
      // Each activity's local day key in the MEMBER's zone, computed once.
      const acts = (byUser[id] || []).map((a) => ({ ...a, _k: dayKey(a.date, memberTz) }));
      const weeklyHours = weekKeys.map((weekKey) => {
        const weekEndKey = addDaysToKey(weekKey, 7);
        const sum = acts
          .filter((a) => a._k >= weekKey && a._k < weekEndKey)
          .reduce((s, a) => s + parseDurationHours(a.duration), 0);
        return Math.round(sum * 10) / 10;
      });
      const thisWeek = weeklyHours[weeklyHours.length - 1];
      const prevWeeks = weeklyHours.slice(Math.max(0, weeklyHours.length - 5), weeklyHours.length - 1);
      const avg = prevWeeks.length
        ? Math.round((prevWeeks.reduce((s, h) => s + h, 0) / prevWeeks.length) * 10) / 10
        : 0;
      const thisWeekActs = acts.filter((a) => a._k >= thisWeekKey);
      const kmThisWeek = Math.round(thisWeekActs.reduce((s, a) => s + parseDistanceKmUnitAware(a.distance), 0) * 10) / 10;
      // Rest days are a per-member day count over the member's OWN current
      // local week (how far they are into it vs distinct active days).
      const mWeekStartK = weekStartKey(new Date(), memberTz);
      const memberActiveDays = new Set(
        acts.filter((a) => a._k >= mWeekStartK).map((a) => a._k)
      ).size;
      const restDays = Math.max(0, Math.min(7, dateParts(new Date(), memberTz).weekday) - memberActiveDays);

      let status, trend;
      if (thisWeek === 0 && avg === 0) { status = 'inactive'; trend = 0; }
      else if (thisWeek === 0) { status = 'inactive'; trend = -100; }
      else if (avg === 0) { status = 'ontrack'; trend = 0; }
      else {
        trend = Math.round(((thisWeek - avg) / avg) * 100);
        if (trend >= 50) status = 'overdoing';
        else if (trend <= -40) status = 'behind';
        else status = 'ontrack';
      }
      return {
        userId: id,
        name: prof.name || 'Member',
        handle: prof.handle || 'member',
        avatar_url: prof.avatar_url || null,
        sports: Array.isArray(prof.sports) ? prof.sports : [],
        weeklyHours, thisWeek, avg, trend, status,
        sessionsThisWeek: thisWeekActs.length,
        kmThisWeek, restDays
      };
    });

    const statusOrder = { overdoing: 0, behind: 1, ontrack: 2, inactive: 3 };
    memberData.sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || b.thisWeek - a.thisWeek);

    const clubWeekly = weekKeys.map((_, i) =>
      Math.round(memberData.reduce((s, m) => s + (m.weeklyHours[i] || 0), 0) * 10) / 10);
    const clubThisWeek = clubWeekly[clubWeekly.length - 1];
    const clubPrev = clubWeekly.slice(Math.max(0, clubWeekly.length - 5), clubWeekly.length - 1);
    const clubAvg = clubPrev.length
      ? Math.round((clubPrev.reduce((s, h) => s + h, 0) / clubPrev.length) * 10) / 10
      : 0;

    res.json({
      members: memberData,
      clubWeekly,
      weekLabels: weekKeys.map((k) => keyToUtcDate(k)
        .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })),
      stats: {
        clubThisWeek,
        clubAvg,
        clubDelta: Math.round((clubThisWeek - clubAvg) * 10) / 10,
        activeCount: memberData.filter((m) => m.thisWeek > 0).length,
        totalMembers: memberData.length,
        overdoingCount: memberData.filter((m) => m.status === 'overdoing').length,
        behindCount: memberData.filter((m) => m.status === 'behind').length
      }
    });
  } catch (err) {
    console.log('Training load error:', err.message);
    res.json({ error: 'Could not load training load' });
  }
});

// Send a personal check-in to ONE club member. The target must belong to the
// :clubId and the caller must be its admin/coach — so this can't notify
// arbitrary users (same anti-spam stance as nudge-atrisk).
app.post(BASE + '/api/clubs/:clubId/checkin', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured' });
  const clubId = req.params.clubId;
  const targetId = req.body && req.body.userId;
  if (!targetId) return res.status(400).json({ error: 'Missing member' });
  try {
    const { data: membership } = await supabaseAdmin
      .from('memberships')
      .select('club_id')
      .eq('user_id', req.user.id)
      .eq('club_id', clubId)
      .in('role', ['admin', 'coach'])
      .maybeSingle();
    if (!membership) return res.status(403).json({ error: 'Not authorised' });
    // Check-in rides under the training-load feature (it's the Training tab's
    // per-member action), so it shares that feature name.
    if (await clubProGateBlocked(res, clubId, 'club_training_load')) return;
    const { data: target } = await supabaseAdmin
      .from('memberships')
      .select('user_id')
      .eq('club_id', clubId)
      .eq('user_id', targetId)
      .maybeSingle();
    if (!target) return res.status(404).json({ error: 'Member not found' });
    const coach = displayFromUser(req.user);
    await createNotification({
      userId: targetId,
      type: 'club',
      title: 'Check-in from your coach',
      body: `${coach.name} checked in on your training — keep it going, and reach out any time.`,
      link: '/profile',
      actorId: req.user.id,
      entityId: clubId
    });
    res.json({ success: true });
  } catch (err) {
    console.log('Check-in error:', err.message);
    res.json({ error: 'Could not send check-in' });
  }
});

// ── CLUB OVERVIEW: RECENT ACTIVITY ──
// Merges members' latest logged activities, recent "going" RSVPs to club events,
// and recent joins into one chronological feed for the overview tab. The
// user-supplied snippet embedded `profiles:user_id(name)` and ordered activities
// by `created_at`, but this app has no usable profiles table (names come from
// auth metadata via buildUserProfileMap) and `activities`/`memberships` have no
// `joined_at` — joins use `created_at`, activities use their `date` timestamp.
// Admin/coach of the :clubId only.
app.get(BASE + '/api/clubs/:clubId/recent-activity', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ feed: [] });
  const clubId = req.params.clubId;
  try {
    const { data: membership } = await supabaseAdmin
      .from('memberships')
      .select('club_id')
      .eq('user_id', req.user.id)
      .eq('club_id', clubId)
      .in('role', ['admin', 'coach'])
      .maybeSingle();
    if (!membership) return res.status(403).json({ error: 'Not authorised' });

    const { data: members } = await supabaseAdmin
      .from('memberships')
      .select('user_id, created_at')
      .eq('club_id', clubId);
    const memberIds = [...new Set((members || []).map((m) => m.user_id).filter(Boolean))];
    const safeIds = memberIds.length ? memberIds : ['00000000-0000-0000-0000-000000000000'];

    // Latest logged activities. Ordered/stamped by `created_at` (the logged
    // moment) — `date` is the local-noon training-day anchor, so using it in
    // "X ago" lines shows hours-since-noon instead of time since logging.
    const { data: recentActivities } = await supabaseAdmin
      .from('activities')
      .select('user_id, sport, distance, duration, date, created_at')
      .in('user_id', safeIds)
      .order('created_at', { ascending: false })
      .limit(8);

    // Latest "going" RSVPs to this club's events.
    const { data: clubEvents } = await supabaseAdmin
      .from('events')
      .select('id, title')
      .eq('club_id', clubId);
    const eventTitleMap = {};
    (clubEvents || []).forEach((e) => { eventTitleMap[e.id] = e.title; });
    const eventIds = (clubEvents || []).map((e) => e.id);
    let recentRsvps = [];
    if (eventIds.length) {
      const { data: rsvpRows } = await supabaseAdmin
        .from('event_rsvps')
        .select('user_id, event_id, status, created_at')
        .in('event_id', eventIds)
        .eq('status', 'going')
        .order('created_at', { ascending: false })
        .limit(5);
      recentRsvps = rsvpRows || [];
    }

    // Recent joins: membership rows created in the last 14 days.
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    const recentJoins = (members || [])
      .filter((m) => m.created_at && (Date.now() - new Date(m.created_at).getTime()) < fourteenDaysMs)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 3);

    // One batched auth-metadata lookup for every name we need.
    const nameMap = await buildUserProfileMap([
      ...(recentActivities || []).map((a) => a.user_id),
      ...recentRsvps.map((r) => r.user_id),
      ...recentJoins.map((m) => m.user_id)
    ]);
    const nameOf = (id) => (nameMap[id] && nameMap[id].name) || 'A member';
    const avatarOf = (id) => (nameMap[id] && nameMap[id].avatar_url) || null;

    const sportLabels = {
      running: 'run', cycling: 'ride', climbing: 'climb', swimming: 'swim',
      football: 'football session', weightlifting: 'weights session', hiking: 'hike', yoga: 'yoga session'
    };

    const feed = [];
    (recentActivities || []).forEach((a) => {
      const dist = a.distance ? `${a.distance} ` : '';
      feed.push({
        type: 'activity',
        name: nameOf(a.user_id),
        avatarUrl: avatarOf(a.user_id),
        text: `logged a ${dist}${sportLabels[a.sport] || a.sport || 'session'}`,
        timestamp: a.created_at || a.date
      });
    });
    recentRsvps.forEach((r) => {
      feed.push({
        type: 'rsvp',
        name: nameOf(r.user_id),
        avatarUrl: avatarOf(r.user_id),
        text: `RSVP'd going to ${eventTitleMap[r.event_id] || 'an event'}`,
        timestamp: r.created_at
      });
    });
    recentJoins.forEach((m) => {
      feed.push({
        type: 'join',
        name: nameOf(m.user_id),
        avatarUrl: avatarOf(m.user_id),
        text: 'joined the club',
        timestamp: m.created_at
      });
    });
    feed.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json({ feed: feed.slice(0, 10) });
  } catch (err) {
    console.log('Recent activity error:', err.message);
    res.json({ feed: [] });
  }
});

// Club feed — merged content from every club member (posts, logged activities,
// "going" RSVPs, recent joins, and challenge milestones). Adapted to this app's
// real schema: there is NO `profiles` table (name/handle/sports resolved from
// auth metadata via buildUserProfileMap), `memberships` has no `joined_at`
// (joins use `created_at`), and `activities` have no `created_at` (ordered by
// their `date` timestamp). Any member of the club may read its feed.
app.get(BASE + '/api/clubs/:clubId/feed', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ feed: [], memberCount: 0 });
  const clubId = req.params.clubId;
  try {
    const { data: membership } = await supabaseAdmin
      .from('memberships')
      .select('role')
      .eq('user_id', req.user.id)
      .eq('club_id', clubId)
      .maybeSingle();
    if (!membership) return res.status(403).json({ error: 'Not authorised' });

    // Club members + roles. No `profiles` join — names come from auth metadata.
    const { data: members } = await supabaseAdmin
      .from('memberships')
      .select('user_id, role, created_at')
      .eq('club_id', clubId);
    const memberIds = [...new Set((members || []).map((m) => m.user_id).filter(Boolean))];
    const safeIds = memberIds.length ? memberIds : ['00000000-0000-0000-0000-000000000000'];
    const roleMap = {};
    (members || []).forEach((m) => { roleMap[m.user_id] = m.role; });
    const profileMap = await buildUserProfileMap(memberIds);
    const prof = (id) => profileMap[id] || {};

    const feed = [];

    // Club identity for announcement cards (logo + name are the PRIMARY
    // identity on club-owned posts; sport drives the no-logo tile fallback).
    const { data: clubRow } = await supabaseAdmin
      .from('clubs').select('id, name, sport, logo_url').eq('id', clubId).maybeSingle();

    // 1a. Personal posts from current members (club_id NULL — a coach's
    //     personal post is a personal post; classification is the stored
    //     club_id, never the author's role).
    // post_likes has no `id` column — it is keyed by (post_id, user_id).
    const { data: personalPosts } = await supabaseAdmin
      .from('posts')
      .select('id, user_id, club_id, content, sport, image_url, created_at')
      .is('club_id', null)
      .in('user_id', safeIds)
      .order('created_at', { ascending: false })
      .limit(20);
    // 1b. This club's announcements — by club_id, NOT author roster, so
    //     club-owned speech survives the author leaving or changing roles.
    const { data: annPosts } = await supabaseAdmin
      .from('posts')
      .select('id, user_id, club_id, content, sport, image_url, created_at')
      .eq('club_id', clubId)
      .order('created_at', { ascending: false })
      .limit(20);
    const posts = [...(personalPosts || []), ...(annPosts || [])]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 20);
    // Departed announcement authors are not in the roster profile map.
    const extraAuthorIds = [...new Set((annPosts || []).map((p) => p.user_id))]
      .filter((id) => id && !profileMap[id]);
    if (extraAuthorIds.length) {
      Object.assign(profileMap, await buildUserProfileMap(extraAuthorIds));
    }
    const postIds = (posts || []).map((p) => p.id);
    let likes = [];
    let commentRows = [];
    if (postIds.length) {
      const { data: likeRows } = await supabaseAdmin
        .from('post_likes')
        .select('post_id, user_id')
        .in('post_id', postIds);
      likes = likeRows || [];
      const { data: comRows } = await supabaseAdmin
        .from('post_comments')
        .select('post_id')
        .in('post_id', postIds);
      commentRows = comRows || [];
    }
    const viewerIsMgr = roleMap[req.user.id] === 'admin' || roleMap[req.user.id] === 'coach';
    (posts || []).forEach((p) => {
      const postLikes = likes.filter((l) => l.post_id === p.id);
      const isAnnouncement = p.club_id === clubId;
      feed.push({
        // Manager delete affordance — server-decided so the shared delete
        // fragment never guesses roles. Announcements only; the author case
        // stays the client-side owner check. Server re-enforces regardless.
        canDelete: isAnnouncement && viewerIsMgr,
        type: isAnnouncement ? 'announcement' : 'post',
        id: p.id,
        userId: p.user_id,
        name: prof(p.user_id).name || 'Member',
        handle: prof(p.user_id).handle || 'member',
        avatarUrl: prof(p.user_id).avatar_url || null,
        profilePublic: prof(p.user_id).profilePublic !== false,
        role: roleMap[p.user_id] || null,
        clubId: isAnnouncement ? clubId : null,
        clubName: isAnnouncement ? ((clubRow && clubRow.name) || 'Club') : null,
        clubLogoUrl: isAnnouncement ? ((clubRow && clubRow.logo_url) || null) : null,
        clubSport: isAnnouncement ? ((clubRow && clubRow.sport) || null) : null,
        content: p.content,
        sport: p.sport,
        image_url: p.image_url || null,
        likeCount: postLikes.length,
        commentCount: commentRows.filter((c) => c.post_id === p.id).length,
        likedByMe: postLikes.some((l) => l.user_id === req.user.id),
        timestamp: p.created_at
      });
    });

    // 2. Activities from members. Ordered/stamped by `created_at` (logged
    // moment) so "X ago" reflects when it was logged, not the local-noon
    // training-day anchor stored in `date`.
    // Payload CONVERGED with the main feed's activity shape: the full raw
    // activity row is spread in (the shared card builder + stat tiles read
    // the same columns everywhere — a projected subset here is exactly the
    // hidden divergence that produced the old `notes || title` title-loss
    // bug). Header fields (name/avatarUrl/...) stay flattened on top.
    const { data: activities } = await supabaseAdmin
      .from('activities')
      .select('*')
      .in('user_id', safeIds)
      .order('created_at', { ascending: false })
      .limit(20);
    (activities || []).forEach((a) => {
      stripLegacyInsight(a);
      feed.push({
        type: 'activity',
        ...a,
        userId: a.user_id,
        name: prof(a.user_id).name || 'Member',
        handle: prof(a.user_id).handle || 'member',
        avatarUrl: prof(a.user_id).avatar_url || null,
        profilePublic: prof(a.user_id).profilePublic !== false,
        content: a.title || '', // kept title-only for compatibility
        timestamp: a.created_at || a.date
      });
    });

    // 3. "Going" RSVPs to this club's upcoming events.
    const { data: clubEvents } = await supabaseAdmin
      .from('events')
      .select('id, title, date, location')
      .eq('club_id', clubId)
      .gte('date', new Date().toISOString());
    const eventMap = {};
    (clubEvents || []).forEach((e) => { eventMap[e.id] = e; });
    const eventIds = Object.keys(eventMap);
    let rsvps = [];
    if (eventIds.length) {
      const { data: rsvpRows } = await supabaseAdmin
        .from('event_rsvps')
        .select('id, user_id, event_id, status, created_at')
        .in('event_id', eventIds)
        .eq('status', 'going')
        .order('created_at', { ascending: false })
        .limit(10);
      rsvps = rsvpRows || [];
    }
    const goingCounts = {};
    rsvps.forEach((r) => { goingCounts[r.event_id] = (goingCounts[r.event_id] || 0) + 1; });
    rsvps.slice(0, 8).forEach((r) => {
      const event = eventMap[r.event_id];
      if (!event) return;
      feed.push({
        type: 'rsvp',
        id: r.id,
        userId: r.user_id,
        name: prof(r.user_id).name || 'Member',
        handle: prof(r.user_id).handle || 'member',
        avatarUrl: prof(r.user_id).avatar_url || null,
        profilePublic: prof(r.user_id).profilePublic !== false,
        eventTitle: event.title,
        eventDate: event.date,
        eventLocation: event.location,
        goingCount: goingCounts[r.event_id] || 1,
        timestamp: r.created_at
      });
    });

    // 4. New member joins in the last 14 days (memberships.created_at).
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    (members || [])
      .filter((m) => m.created_at && (Date.now() - new Date(m.created_at).getTime()) < fourteenDaysMs)
      .forEach((m) => {
        feed.push({
          type: 'join',
          id: 'join-' + m.user_id,
          userId: m.user_id,
          name: prof(m.user_id).name || 'New member',
          handle: prof(m.user_id).handle || 'member',
          avatarUrl: prof(m.user_id).avatar_url || null,
        profilePublic: prof(m.user_id).profilePublic !== false,
          sports: prof(m.user_id).sports || [],
          timestamp: m.created_at
        });
      });

    // 5. Challenge milestones — members who crossed a club challenge goal in the
    // recent window. Progress accumulates over each participant's matching
    // activities; completion is timestamped at the crossing activity's `date`.
    const { data: clubChallenges } = await supabaseAdmin
      .from('challenges')
      .select('id, title, goal_type, goal_target, goal_unit, sport, start_date, end_date')
      .eq('club_id', clubId)
      .gte('end_date', new Date(Date.now() - fourteenDaysMs).toISOString());
    for (const challenge of (clubChallenges || [])) {
      const { data: participants } = await supabaseAdmin
        .from('challenge_participants')
        .select('user_id')
        .eq('challenge_id', challenge.id);
      for (const participant of (participants || []).slice(0, 20)) {
        // Fetch a day wide, then cut to the PARTICIPANT'S local challenge
        // window (boundary policy; non-member participants fall back UTC).
        const range = challengeFetchRange(challenge);
        const { data: rawActs } = await supabaseAdmin
          .from('activities')
          .select('sport, distance, duration, date')
          .eq('user_id', participant.user_id)
          .gte('date', range.gteIso)
          .lte('date', range.lteIso)
          .order('date', { ascending: true });
        const acts = actsInChallengeWindow(rawActs, challenge, memberZone(prof(participant.user_id)));
        let progress = 0;
        let completedAt = null;
        // Streak ("Active days") must count DISTINCT days here exactly like
        // computeChallengeProgress — one-per-activity would announce
        // milestones early for multi-activity days.
        const zone = memberZone(prof(participant.user_id));
        const seenDays = new Set();
        for (const a of (acts || [])) {
          if (challenge.sport !== 'any' && a.sport !== challenge.sport) continue;
          if (challenge.goal_type === 'distance') {
            const dist = parseDistanceKmUnitAware(a.distance);
            if (!isNaN(dist)) progress += dist;
          } else if (challenge.goal_type === 'duration') {
            progress += parseDurationHours(a.duration);
          } else if (challenge.goal_type === 'streak') {
            seenDays.add(dayKey(a.date, zone));
            progress = seenDays.size;
          } else {
            progress += 1;
          }
          if (challenge.goal_target > 0 && progress >= challenge.goal_target && !completedAt) completedAt = a.date;
        }
        if (completedAt) {
          feed.push({
            type: 'milestone',
            id: 'milestone-' + challenge.id + '-' + participant.user_id,
            userId: participant.user_id,
            name: prof(participant.user_id).name || 'Member',
            handle: prof(participant.user_id).handle || 'member',
            avatarUrl: prof(participant.user_id).avatar_url || null,
        profilePublic: prof(participant.user_id).profilePublic !== false,
            challengeTitle: challenge.title,
            goalTarget: challenge.goal_target,
            goalUnit: challenge.goal_unit,
            timestamp: completedAt
          });
        }
      }
    }

    feed.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json({ feed: feed.slice(0, 30), memberCount: (members || []).length, viewerId: req.user.id });
  } catch (err) {
    console.log('Club feed error:', err.message);
    res.json({ feed: [], memberCount: 0 });
  }
});

// Monthly club report (admin/coach only). Aggregates real membership,
// engagement, events and challenge data for a YYYY-MM month, plus the previous
// month for deltas and a rolling 6-month trend. The original spec assumed a
// `profiles` table and a `memberships.joined_at` column — neither exists here:
// member names come from auth metadata (buildUserProfileMap) and join dates come
// from `memberships.created_at`.
app.get(BASE + '/api/clubs/:clubId/report', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured' });
  const clubId = req.params.clubId;
  try {
    // Requester must be an admin or coach of this club.
    const { data: membership } = await supabaseAdmin
      .from('memberships')
      .select('role')
      .eq('user_id', req.user.id)
      .eq('club_id', clubId)
      .in('role', ['admin', 'coach'])
      .maybeSingle();
    if (!membership) return res.status(403).json({ error: 'Not authorised' });
    // One gate covers BOTH report modes (?month and ?mode=year) — same route.
    if (await clubProGateBlocked(res, clubId, 'club_report')) return;

    // Window boundaries follow the requesting COACH's calendar (boundary
    // policy rule 2): club-level instants (joins, events, challenge overlap)
    // are the coach's local midnights. Month arithmetic is integer YYYY-MM
    // math — never Date→toISOString round-trips, which skew a day in non-UTC
    // zones. Two report modes:
    //   ?month=YYYY-MM        (default — the original monthly report)
    //   ?mode=year&year=YYYY  (computed on-read: the current year is YTD,
    //                          Jan 1 → today inclusive in the coach's zone;
    //                          past years cover the full calendar year)
    const coachTz = getUserTimezone(req.user);
    // First-of-month day key for calendar month `m` (1-based, may be out of
    // 1..12 range — normalized by integer math).
    const monthFirstKey = (y, m) => {
      const total = y * 12 + (m - 1);
      const ny = Math.floor(total / 12);
      const nm = (total % 12) + 1;
      return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-01`;
    };
    const todayKey = dayKey(new Date(), coachTz);
    const nowYear = Number(todayKey.slice(0, 4));
    const yearMode = req.query.mode === 'year';

    let monthParam = null;
    let reportYear = null;
    let isYtd = false;
    let winStartKey, winEndKey, prevWinStartKey, prevWinEndKey;
    // Month buckets for the two trend charts: [{ s, e }] day-key ranges.
    let trendBuckets;
    if (yearMode) {
      const yRaw = String(req.query.year || '');
      reportYear = /^\d{4}$/.test(yRaw) && Number(yRaw) <= nowYear ? Number(yRaw) : nowYear;
      isYtd = reportYear === nowYear;
      winStartKey = `${reportYear}-01-01`;
      winEndKey = isYtd ? addDaysToKey(todayKey, 1) : `${reportYear + 1}-01-01`;
      // "vs last year" compares like for like: YTD → the SAME Jan-1→today
      // window of the prior year (Feb 29 falls back to Feb 28); a completed
      // year → the full prior year.
      prevWinStartKey = `${reportYear - 1}-01-01`;
      if (isYtd) {
        const md = todayKey.slice(5) === '02-29' ? '02-28' : todayKey.slice(5);
        prevWinEndKey = addDaysToKey(`${reportYear - 1}-${md}`, 1);
      } else {
        prevWinEndKey = winStartKey;
      }
      // Honesty rule: the current year charts only ELAPSED months (future
      // months haven't happened — zero bars for them would be false); past
      // years chart all 12. The last YTD bucket is cut at the window end so
      // the chart total always matches the cards.
      const lastMonth = isYtd ? Number(todayKey.slice(5, 7)) : 12;
      trendBuckets = [];
      for (let mm = 1; mm <= lastMonth; mm++) {
        trendBuckets.push({
          s: monthFirstKey(reportYear, mm),
          e: (isYtd && mm === lastMonth) ? winEndKey : monthFirstKey(reportYear, mm + 1)
        });
      }
    } else {
      monthParam = (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month))
        ? req.query.month : monthKey(new Date(), coachTz);
      const [year, month] = monthParam.split('-').map(Number);
      winStartKey = monthFirstKey(year, month);
      winEndKey = monthFirstKey(year, month + 1);
      prevWinStartKey = monthFirstKey(year, month - 1);
      prevWinEndKey = winStartKey;
      // Six trailing months ending at the report month.
      trendBuckets = [];
      for (let i = 5; i >= 0; i--) {
        trendBuckets.push({ s: monthFirstKey(year, month - i), e: monthFirstKey(year, month - i + 1) });
      }
    }
    const winStart = zoneMidnightUtc(winStartKey, coachTz);
    const winEnd = zoneMidnightUtc(winEndKey, coachTz);
    const prevStart = zoneMidnightUtc(prevWinStartKey, coachTz);
    const prevEnd = zoneMidnightUtc(prevWinEndKey, coachTz);

    // All members with their join dates (created_at — no profiles table / joined_at).
    const { data: members } = await supabaseAdmin
      .from('memberships')
      .select('user_id, created_at')
      .eq('club_id', clubId);
    const memberIds = (members || []).map(m => m.user_id);
    const safeIds = memberIds.length ? memberIds : ['00000000-0000-0000-0000-000000000000'];
    const joinedAt = (m) => m.created_at;
    // Profiles (names + zones) for every member: zones drive per-member
    // activity bucketing below (boundary policy rule 1).
    const profileMap = await buildUserProfileMap(memberIds);

    // Membership metrics (a member with no join date is treated as pre-existing).
    const newJoins = (members || []).filter(m =>
      joinedAt(m) && new Date(joinedAt(m)) >= winStart && new Date(joinedAt(m)) < winEnd
    ).length;
    const prevJoins = (members || []).filter(m =>
      joinedAt(m) && new Date(joinedAt(m)) >= prevStart && new Date(joinedAt(m)) < prevEnd
    ).length;
    const membersAtWinEnd = (members || []).filter(m =>
      !joinedAt(m) || new Date(joinedAt(m)) < winEnd
    ).length;
    // Comparison baseline = member count at the END of the previous window
    // (month mode: prevEnd === winStart, identical to before; YTD: the same
    // date last year; past year: Jan 1 of the report year).
    const membersAtPrevEnd = (members || []).filter(m =>
      !joinedAt(m) || new Date(joinedAt(m)) < prevEnd
    ).length;

    // Member count trend — the count at the end of each trend bucket
    // (coach-zone month boundaries, matching the header instants above).
    const memberTrend = trendBuckets.map((b) => {
      const trendEnd = zoneMidnightUtc(b.e, coachTz);
      return (members || []).filter(m =>
        !joinedAt(m) || new Date(joinedAt(m)) < trendEnd
      ).length;
    });

    // Activities: ONE wide PAGED fetch spanning the trend window AND the
    // previous comparison window, widened a day each side so members in any
    // zone contribute their full local days. PostgREST silently caps a single
    // response at 1000 rows — a year window (or an active club's 6-month
    // span) can exceed that — so page in 1000-row chunks like the
    // training-load tab (the id tiebreaker makes page boundaries
    // deterministic). Each activity then buckets by its day key in the
    // MEMBER'S zone (boundary policy rule 1); the window/prev/trend slices
    // below are all key-range cuts of this list.
    const fetchStartKey = trendBuckets[0].s < prevWinStartKey ? trendBuckets[0].s : prevWinStartKey;
    let allActs = [];
    {
      const gteIso = keyToUtcDate(addDaysToKey(fetchStartKey, -1)).toISOString();
      const ltIso = keyToUtcDate(addDaysToKey(winEndKey, 1)).toISOString();
      const PAGE = 1000;
      let rows = [];
      for (let from = 0; ; from += PAGE) {
        const { data } = await supabaseAdmin
          .from('activities')
          .select('user_id, sport, distance, duration, date')
          .in('user_id', safeIds)
          .gte('date', gteIso)
          .lt('date', ltIso)
          .order('date', { ascending: false })
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (!data || data.length === 0) break;
        rows = rows.concat(data);
        if (data.length < PAGE) break;
      }
      allActs = rows.map((a) => ({
        ...a,
        _k: dayKey(a.date, memberZone(profileMap[a.user_id]))
      }));
    }
    const actsInKeyRange = (fromKey, toKey) =>
      allActs.filter((a) => a._k >= fromKey && a._k < toKey);
    const windowActivities = actsInKeyRange(winStartKey, winEndKey);
    const prevActivities = actsInKeyRange(prevWinStartKey, prevWinEndKey);

    function summarizeActivities(acts) {
      const activeUsers = new Set((acts || []).map(a => a.user_id));
      let totalHours = 0, totalKm = 0;
      const sportCounts = {};
      const userStats = {};
      (acts || []).forEach(a => {
        totalHours += parseDurationHours(a.duration);
        const dist = parseDistanceKmUnitAware(a.distance);
        if (!isNaN(dist)) totalKm += dist;
        sportCounts[a.sport] = (sportCounts[a.sport] || 0) + 1;
        if (!userStats[a.user_id]) userStats[a.user_id] = { sessions: 0, hours: 0, km: 0 };
        userStats[a.user_id].sessions++;
        userStats[a.user_id].hours += parseDurationHours(a.duration);
        if (!isNaN(dist)) userStats[a.user_id].km += dist;
      });
      return {
        sessions: (acts || []).length,
        activeCount: activeUsers.size,
        totalHours: Math.round(totalHours * 10) / 10,
        totalKm: Math.round(totalKm),
        sportCounts,
        userStats
      };
    }

    const curWin = summarizeActivities(windowActivities);
    const prevWin = summarizeActivities(prevActivities);

    // Most popular sport / most active member over the report window. (Names
    // come from the member-wide profileMap fetched above.)
    const topSport = Object.entries(curWin.sportCounts).sort((a, b) => b[1] - a[1])[0];
    const topMember = Object.entries(curWin.userStats).sort((a, b) => b[1].sessions - a[1].sessions)[0];

    // Training hours trend — total logged hours per trend bucket. Month cuts
    // of the same member-zone-keyed activity list as above.
    const hoursTrend = trendBuckets.map((b) => {
      const tActs = actsInKeyRange(b.s, b.e);
      return Math.round(tActs.reduce((s, a) => s + parseDurationHours(a.duration), 0) * 10) / 10;
    });

    // Events in the report window + the previous window, with "going" RSVP counts.
    const { data: windowEvents } = await supabaseAdmin
      .from('events')
      .select('id, title, date')
      .eq('club_id', clubId)
      .gte('date', winStart.toISOString())
      .lt('date', winEnd.toISOString());
    const { data: prevEvents } = await supabaseAdmin
      .from('events')
      .select('id')
      .eq('club_id', clubId)
      .gte('date', prevStart.toISOString())
      .lt('date', prevEnd.toISOString());
    const eventIds = (windowEvents || []).map(e => e.id);
    const { data: eventRsvps } = await supabaseAdmin
      .from('event_rsvps')
      .select('event_id, status')
      .in('event_id', eventIds.length ? eventIds : ['00000000-0000-0000-0000-000000000000'])
      .eq('status', 'going');
    const eventAttendance = (windowEvents || []).map(e => {
      const going = (eventRsvps || []).filter(r => r.event_id === e.id).length;
      return {
        title: e.title,
        date: e.date,
        going,
        rate: membersAtWinEnd > 0 ? Math.round((going / membersAtWinEnd) * 100) : 0
      };
    }).sort((a, b) => b.going - a.going);
    const avgAttendees = eventAttendance.length > 0
      ? Math.round(eventAttendance.reduce((s, e) => s + e.going, 0) / eventAttendance.length) : 0;
    const avgAttendanceRate = eventAttendance.length > 0
      ? Math.round(eventAttendance.reduce((s, e) => s + e.rate, 0) / eventAttendance.length) : 0;

    // Challenges overlapping the report window (a challenge spanning a
    // window boundary counts in BOTH periods — same overlap semantics as the
    // monthly report; progress is computed over the challenge's own
    // per-participant window, not clipped to the report window).
    const { data: windowChallenges } = await supabaseAdmin
      .from('challenges')
      .select('id, title, goal_type, goal_target, goal_unit, sport, start_date, end_date')
      .eq('club_id', clubId)
      .lt('start_date', winEnd.toISOString())
      .gte('end_date', winStart.toISOString());
    let challengeStats = { count: 0, participationRate: 0, completionRate: 0, highlights: [] };
    if ((windowChallenges || []).length > 0) {
      let totalParticipants = 0, totalCompleted = 0, totalPossible = 0;
      for (const ch of windowChallenges) {
        const { data: parts } = await supabaseAdmin
          .from('challenge_participants')
          .select('user_id')
          .eq('challenge_id', ch.id);
        const partCount = (parts || []).length;
        totalParticipants += partCount;
        totalPossible += membersAtWinEnd;
        let completed = 0;
        for (const p of (parts || [])) {
          // Fetch a day wide, then cut to the PARTICIPANT'S local challenge
          // window (boundary policy; non-member participants fall back UTC).
          const range = challengeFetchRange(ch);
          const { data: rawActs } = await supabaseAdmin
            .from('activities')
            .select('sport, distance, duration, date')
            .eq('user_id', p.user_id)
            .gte('date', range.gteIso)
            .lte('date', range.lteIso);
          const pZone = memberZone(profileMap[p.user_id]);
          const acts = actsInChallengeWindow(rawActs, ch, pZone);
          // Shared helper: keeps all four goal types (incl. duration hours and
          // distinct-active-day streaks) consistent with every other surface.
          const progress = computeChallengeProgress(ch, acts, pZone);
          // Guard against legacy challenges with a 0/null target, which would
          // otherwise count as "completed" for every participant.
          if (ch.goal_target > 0 && progress >= ch.goal_target) completed++;
        }
        totalCompleted += completed;
        challengeStats.highlights.push({
          title: ch.title,
          participants: partCount,
          completed,
          completionRate: partCount > 0 ? Math.round((completed / partCount) * 100) : 0
        });
      }
      challengeStats.count = windowChallenges.length;
      challengeStats.participationRate = totalPossible > 0
        ? Math.round((totalParticipants / totalPossible) * 100) : 0;
      challengeStats.completionRate = totalParticipants > 0
        ? Math.round((totalCompleted / totalParticipants) * 100) : 0;
    }

    // Prior-window presence gate for the year view: when the previous year
    // window has NO club presence at all (no members yet, no activities, no
    // events), "vs last year" lines are suppressed client-side rather than
    // shown as misleading jumps from zero. Month mode keeps its existing
    // always-on deltas (the client only consults this flag in year mode).
    const prevHasData = membersAtPrevEnd > 0 || prevActivities.length > 0 || (prevEvents || []).length > 0;

    // Health headline — template based.
    const activePct = membersAtWinEnd > 0
      ? Math.round((curWin.activeCount / membersAtWinEnd) * 100) : 0;
    const prevActivePct = membersAtPrevEnd > 0
      ? Math.round((prevWin.activeCount / membersAtPrevEnd) * 100) : 0;
    // Labels render the window KEY on the UTC calendar — winStart is a
    // coach-zone instant, which lands in the previous UTC day for zones
    // ahead of UTC and would mislabel the month.
    const periodName = yearMode
      ? (isYtd ? `${reportYear} so far` : String(reportYear))
      : keyToUtcDate(winStartKey).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
    const periodLabel = yearMode
      ? (isYtd ? `${reportYear} · Year to date` : String(reportYear))
      : keyToUtcDate(winStartKey).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const prevPeriodNoun = yearMode ? 'the year before' : 'the month before';
    const growthPct = membersAtPrevEnd > 0
      ? Math.round(((membersAtWinEnd - membersAtPrevEnd) / membersAtPrevEnd) * 100) : 0;
    let headline = '';
    let headlineTone = 'good';
    if (curWin.sessions === 0 && newJoins === 0) {
      headline = yearMode && isYtd
        ? `${reportYear} has been quiet so far — no activities have been logged. Time to rally the club with a challenge or event.`
        : `${periodName} was quiet — no activities were logged. Time to rally the club with a challenge or event.`;
      headlineTone = 'warn';
    } else {
      const parts = [];
      if (newJoins > 0) parts.push(`Membership grew ${growthPct > 0 ? growthPct + '%' : 'by ' + newJoins} to ${membersAtWinEnd} members`);
      if (activePct > 0) parts.push(`${activePct}% of members trained at least once${prevHasData && prevActivePct > 0 && activePct !== prevActivePct ? ` — ${activePct > prevActivePct ? 'up' : 'down'} from ${prevActivePct}% ${prevPeriodNoun}` : ''}`);
      if (avgAttendanceRate > 0) parts.push(`event attendance averaged ${avgAttendanceRate}%`);
      if (challengeStats.participationRate > 0) parts.push(`challenge participation hit ${challengeStats.participationRate}%`);
      headline = parts.join('. ') + '.';
      headlineTone = (growthPct >= 0 && activePct >= prevActivePct) ? 'good' : 'neutral';
    }

    res.json({
      mode: yearMode ? 'year' : 'month',
      month: monthParam,
      year: reportYear,
      ytd: isYtd,
      prevHasData,
      monthLabel: periodLabel,
      headline: { text: headline, tone: headlineTone, title: `${periodName} at a glance` },
      membership: {
        total: membersAtWinEnd,
        totalDelta: membersAtWinEnd - membersAtPrevEnd,
        newJoins,
        newJoinsDelta: newJoins - prevJoins,
        departures: 0,
        retention: 100,
        trend: memberTrend
      },
      engagement: {
        activePct,
        activePctDelta: activePct - prevActivePct,
        totalHours: curWin.totalHours,
        hoursDelta: Math.round((curWin.totalHours - prevWin.totalHours) * 10) / 10,
        sessions: curWin.sessions,
        sessionsDelta: curWin.sessions - prevWin.sessions,
        sessionsPerActive: curWin.activeCount > 0
          ? Math.round((curWin.sessions / curWin.activeCount) * 10) / 10 : 0,
        totalKm: curWin.totalKm,
        topSport: topSport ? {
          name: topSport[0],
          count: topSport[1],
          pct: curWin.sessions > 0 ? Math.round((topSport[1] / curWin.sessions) * 100) : 0
        } : null,
        topMember: topMember ? {
          name: (profileMap[topMember[0]] && profileMap[topMember[0]].name) || 'Member',
          sessions: topMember[1].sessions,
          hours: Math.round(topMember[1].hours * 10) / 10,
          km: Math.round(topMember[1].km)
        } : null,
        hoursTrend
      },
      events: {
        count: (windowEvents || []).length,
        countDelta: (windowEvents || []).length - (prevEvents || []).length,
        avgAttendanceRate,
        avgAttendees,
        best: eventAttendance[0] || null,
        worst: eventAttendance.length > 1 ? eventAttendance[eventAttendance.length - 1] : null
      },
      challenges: challengeStats
    });
  } catch (err) {
    console.log('Club report error:', err.message);
    res.json({ error: 'Could not generate report' });
  }
});

// Coach/admin posts an announcement to the whole club. The announcement is a
// `posts` row with `club_id` set — THE durable signal that this is club-owned
// speech (renderers show the club logo + name as the primary identity, with
// the author secondary). Personal posts never carry a club_id. The old
// author-role inference is retired: role changes no longer retroactively
// reclassify posts. Every other member is notified.
app.post(BASE + '/api/clubs/:clubId/announce', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for posting' });
  const clubId = req.params.clubId;
  const raw = (req.body && req.body.content) || '';
  if (!raw.trim()) return res.json({ error: 'Announcement cannot be empty' });

  const { data: membership } = await supabaseAdmin
    .from('memberships')
    .select('role')
    .eq('user_id', req.user.id)
    .eq('club_id', clubId)
    .in('role', ['admin', 'coach'])
    .maybeSingle();
  if (!membership) return res.status(403).json({ error: 'Only coaches can post announcements' });

  const content = raw.trim().slice(0, 280);
  const { data: post, error } = await supabaseAdmin
    .from('posts')
    .insert({ user_id: req.user.id, content, club_id: clubId })
    .select()
    .single();
  if (error) return res.json({ error: error.message });

  const { data: annClub } = await supabaseAdmin
    .from('clubs').select('name').eq('id', clubId).maybeSingle();

  // Notify every other club member. Actor name from auth metadata (no profiles).
  try {
    const actor = displayFromUser(req.user);
    const { data: recipients } = await supabaseAdmin
      .from('memberships')
      .select('user_id')
      .eq('club_id', clubId)
      .neq('user_id', req.user.id);
    for (const m of (recipients || [])) {
      await createNotification({
        userId: m.user_id,
        type: 'club',
        title: 'Club announcement',
        body: `${annClub && annClub.name ? annClub.name + ' · ' : ''}${actor.name}: ${content.slice(0, 120)}${content.length > 120 ? '…' : ''}`,
        link: '/feed',
        actorId: req.user.id,
        entityId: post.id
      });
    }
  } catch (err) {
    console.log('Announcement notification error:', err.message);
  }
  res.json({ success: true, post });
});

// ── CHALLENGES API ──
// Compute a participant's progress toward a challenge goal from their logged
// activities. `distance` sums numeric distance values; `sessions` counts
// matching activities; `streak` counts distinct active days. Other goal types
// report 0 (no logged-activity signal to derive them from yet).
// ── TIMEZONE BOUNDARY POLICY (multi-user rollups) ──
// One rule, applied everywhere a rollup mixes users:
//   1. Each member's activities bucket on that member's OWN local days —
//      dayKey(activity.date, memberTz). Their July-31 evening run is their
//      July; their Sunday-evening run is their Sunday.
//   2. The rollup's WINDOW boundaries (which week/month is "current", the
//      report month, the training-load week grid) come from the REQUESTING
//      VIEWER's zone — weekStartKey/monthKey(now, viewerTz). A coach's
//      dashboard follows the coach's calendar.
// Both sides are calendar day KEYS ('YYYY-MM-DD'), so a member's local day
// slots directly into the viewer's key window — no instant conversion at the
// comparison point, and all-UTC clubs reproduce the legacy output exactly.
// Challenge windows are the one instant-based case: legacy stored start/end
// as UTC midnights and filtered instants INCLUSIVELY (gte/lte), so each
// participant's window is [zoneMidnightUtc(startKey, memberTz),
// zoneMidnightUtc(endKey, memberTz)] inclusive — identical for UTC users,
// local-midnight-aligned for everyone else.

// Resolve a member's zone from a buildUserProfileMap entry (validated; users
// who predate capture fall back to UTC, preserving their legacy buckets).
function memberZone(prof) {
  return prof && isValidTimezone(prof.timezone) ? prof.timezone : 'UTC';
}

// A challenge's window for one participant, per the policy above. Start/end
// keys come from the stored UTC-midnight timestamps; the instants are those
// calendar days' midnights in the PARTICIPANT'S zone, compared inclusively
// exactly like the legacy gte/lte pair.
function challengeWindowFor(challenge, tz) {
  // ASSUMPTION: challenge start/end_date are stored as UTC-midnight instants
  // (all creation paths do this today). dayKey(.., 'UTC') snaps any
  // non-midnight timestamp to its UTC day — if a creation path ever stores a
  // non-midnight instant, UTC-user parity with the legacy gte/lte window
  // breaks for that row.
  const startKey = dayKey(challenge.start_date, 'UTC');
  const endKey = dayKey(challenge.end_date, 'UTC');
  return {
    startMs: zoneMidnightUtc(startKey, tz).getTime(),
    endMs: zoneMidnightUtc(endKey, tz).getTime()
  };
}
function actsInChallengeWindow(activities, challenge, tz) {
  const w = challengeWindowFor(challenge, tz);
  return (activities || []).filter((a) => {
    const t = new Date(a.date).getTime();
    return t >= w.startMs && t <= w.endMs;
  });
}
// DB fetch bounds for challenge activities: the stored UTC window widened by
// one day each side so every zone's local window (UTC-12 … UTC+14) is covered;
// actsInChallengeWindow re-filters exactly per participant.
function challengeFetchRange(challenge) {
  return {
    gteIso: new Date(new Date(challenge.start_date).getTime() - 86400000).toISOString(),
    lteIso: new Date(new Date(challenge.end_date).getTime() + 86400000).toISOString()
  };
}

// Challenge goal types. Stored values are FROZEN ('streak' rows keep working
// untouched) — 'streak' is presented as "Active days" everywhere, because
// that is what the computation has always measured (distinct active days in
// the window, no consecutiveness check).
const CHALLENGE_GOAL_TYPES = ['distance', 'duration', 'sessions', 'streak'];
function challengeGoalPhrase(ch) {
  const t = Number(ch.goal_target) || ch.goal_target;
  if (ch.goal_type === 'distance') return `${t} ${ch.goal_unit || 'km'}`;
  if (ch.goal_type === 'duration') return `${t} hours`;
  if (ch.goal_type === 'sessions') return `${t} sessions`;
  if (ch.goal_type === 'streak') return `${t} active days`;
  return `${t} ${ch.goal_unit || ''} ${ch.goal_type}`.trim();
}

function computeChallengeProgress(challenge, activities, tz) {
  const acts = activities || [];
  const zone = tz || 'UTC';
  const matches = (a) => challenge.sport === 'any' || a.sport === challenge.sport;
  let progress = 0;
  if (challenge.goal_type === 'distance') {
    acts.forEach((a) => {
      if (!matches(a)) return;
      const dist = parseDistanceKmUnitAware(a.distance);
      if (!isNaN(dist)) progress += dist;
    });
  } else if (challenge.goal_type === 'duration') {
    acts.forEach((a) => {
      if (matches(a)) progress += parseDurationHours(a.duration);
    });
  } else if (challenge.goal_type === 'sessions') {
    progress = acts.filter(matches).length;
  } else if (challenge.goal_type === 'streak') {
    // Distinct active days in the PARTICIPANT'S zone (policy rule 1).
    const dates = [...new Set(acts.filter(matches).map((a) => dayKey(a.date, zone)))];
    progress = dates.length;
  }
  return Math.round(progress * 10) / 10;
}

// ── ACHIEVEMENTS ──
// Real badge system for the athlete profile. Stats are derived from the user's
// own activities plus social/community counts; earned badges persist one row per
// user+badge in the `achievements` table. That table is created out of band via
// SQL, so every read/write here degrades gracefully if it is missing — the tab
// still shows live progress before the table exists.
const BADGES = [
  // Getting started
  { id: 'first_steps', cat: 'starter', icon: '👟', name: 'First Steps', desc: 'Log your first activity', check: s => s.activityCount >= 1, progress: s => [Math.min(s.activityCount, 1), 1] },
  { id: 'joined_club', cat: 'starter', icon: '🏟', name: 'Joined the Club', desc: 'Become a club member', check: s => s.clubCount >= 1, progress: s => [Math.min(s.clubCount, 1), 1] },
  { id: 'social_starter', cat: 'starter', icon: '👥', name: 'Social Starter', desc: 'Follow your first athlete', check: s => s.followingCount >= 1, progress: s => [Math.min(s.followingCount, 1), 1] },
  { id: 'good_sport', cat: 'starter', icon: '👍', name: 'Good Sport', desc: 'Give your first kudos', check: s => s.kudosGiven >= 1, progress: s => [Math.min(s.kudosGiven, 1), 1] },
  // Volume
  { id: 'ten_spot', cat: 'volume', icon: '🔟', name: 'Ten Spot', desc: 'Log 10 activities', check: s => s.activityCount >= 10, progress: s => [s.activityCount, 10] },
  { id: 'half_century', cat: 'volume', icon: '⭐', name: 'Half Century', desc: 'Log 50 activities', check: s => s.activityCount >= 50, progress: s => [s.activityCount, 50] },
  { id: 'centurion', cat: 'volume', icon: '💯', name: 'Centurion', desc: 'Log 100 activities', check: s => s.activityCount >= 100, progress: s => [s.activityCount, 100] },
  { id: 'club_250', cat: 'volume', icon: '🎖', name: '250 Club', desc: 'Log 250 activities', check: s => s.activityCount >= 250, progress: s => [s.activityCount, 250] },
  { id: 'machine', cat: 'volume', icon: '🤖', name: 'Machine', desc: 'Log 500 activities', check: s => s.activityCount >= 500, progress: s => [s.activityCount, 500] },
  // Distance
  { id: 'first_100', cat: 'distance', icon: '🗺', name: 'First 100', desc: '100km lifetime distance', check: s => s.totalKm >= 100, progress: s => [Math.round(s.totalKm), 100], unit: 'km' },
  { id: 'club_500', cat: 'distance', icon: '🛣', name: '500 Club', desc: '500km lifetime distance', check: s => s.totalKm >= 500, progress: s => [Math.round(s.totalKm), 500], unit: 'km' },
  { id: 'thousand', cat: 'distance', icon: '🌍', name: 'Thousand', desc: '1,000km lifetime distance', check: s => s.totalKm >= 1000, progress: s => [Math.round(s.totalKm), 1000], unit: 'km' },
  // Streaks
  { id: 'hat_trick', cat: 'streak', icon: '3️⃣', name: 'Hat Trick', desc: '3-day training streak', check: s => s.longestStreak >= 3, progress: s => [s.longestStreak, 3], unit: 'days' },
  { id: 'week_warrior', cat: 'streak', icon: '🔥', name: 'Week Warrior', desc: '7-day training streak', check: s => s.longestStreak >= 7, progress: s => [s.longestStreak, 7], unit: 'days' },
  { id: 'fortnight', cat: 'streak', icon: '⚡', name: 'Fortnight', desc: '14-day training streak', check: s => s.longestStreak >= 14, progress: s => [s.longestStreak, 14], unit: 'days' },
  { id: 'iron_month', cat: 'streak', icon: '🛡', name: 'Iron Month', desc: '30-day training streak', check: s => s.longestStreak >= 30, progress: s => [s.longestStreak, 30], unit: 'days' },
  // Sport feats
  { id: 'half_hero', cat: 'feat', icon: '🏃', name: 'Half Hero', desc: 'Run 21.1km+ in one activity', check: s => s.longestRun >= 21.1, progress: s => [Math.round(s.longestRun * 10) / 10, 21.1], unit: 'km' },
  { id: 'century_rider', cat: 'feat', icon: '🚴', name: 'Century Rider', desc: 'Ride 100km+ in one activity', check: s => s.longestRide >= 100, progress: s => [Math.round(s.longestRide), 100], unit: 'km' },
  { id: 'multi_athlete', cat: 'feat', icon: '🎯', name: 'Multi-Athlete', desc: 'Log 3+ different sports', check: s => s.sportCount >= 3, progress: s => [s.sportCount, 3], unit: 'sports' },
  { id: 'early_bird', cat: 'feat', icon: '🌅', name: 'Early Bird', desc: 'Log an activity before 6am', check: s => s.hasEarlyBird, progress: s => [s.hasEarlyBird ? 1 : 0, 1] },
  // Community
  { id: 'challenger', cat: 'community', icon: '⚡', name: 'Challenger', desc: 'Complete your first challenge', check: s => s.challengesCompleted >= 1, progress: s => [s.challengesCompleted, 1] },
  { id: 'serial_challenger', cat: 'community', icon: '🏆', name: 'Serial Challenger', desc: 'Complete 5 challenges', check: s => s.challengesCompleted >= 5, progress: s => [s.challengesCompleted, 5] },
  { id: 'regular', cat: 'community', icon: '🎟️', name: 'Regular', desc: 'RSVP going to 10 events', check: s => s.eventsAttended >= 10, progress: s => [s.eventsAttended, 10] },
  { id: 'popular', cat: 'community', icon: '🌟', name: 'Popular', desc: 'Reach 25 followers', check: s => s.followerCount >= 25, progress: s => [s.followerCount, 25] }
];

// Parse a distance string ("12.3 km") into a number of kilometres — thin
// wrapper over the canonical unit-aware parser so badge thresholds count
// real km ("10mi" = 16.09, "2,000m" = 2), same as every other km surface.
function badgeKm(a) {
  return parseDistanceKmUnitAware(a.distance);
}

// Gather every stat the badge checks need for one user, via the global
// service-role client. NOTE: the `activities` table has no `created_at` column,
// so all time-based logic reads the activity `date`.
async function gatherBadgeStats(userId, tz) {
  const { data: acts } = await supabaseAdmin
    .from('activities')
    .select('sport, distance, duration, date')
    .eq('user_id', userId);
  const activities = acts || [];
  const totalKm = activities.reduce((s, a) => s + badgeKm(a), 0);
  const runs = activities.filter(a => a.sport === 'running');
  const rides = activities.filter(a => a.sport === 'cycling');
  const longestRun = runs.length ? Math.max(...runs.map(badgeKm)) : 0;
  const longestRide = rides.length ? Math.max(...rides.map(badgeKm)) : 0;
  const sportCount = new Set(activities.map(a => a.sport).filter(Boolean)).size;
  // Early bird only counts when the stored date carries a real time component
  // (an ISO timestamp). Date-only values are skipped so midnight can't qualify.
  // The hour is evaluated in the USER'S zone: a real-time 5:45 AM Pacific log
  // (12:45Z) earns it, while a noon-stamped /log entry (stored as local noon)
  // never does — the badge rewards actually being up early, wherever you are.
  const hasEarlyBird = activities.some(a => {
    const ds = String(a.date || '');
    if (ds.length <= 10 || !ds.includes('T')) return false;
    const p = dateParts(ds, tz);
    return !!p && p.hour < 6;
  });
  // Longest streak of consecutive active days in the user's zone (shared helper).
  const { longestStreak } = computeStreaks(activities, tz);
  // Social + community counts (head:true → count only, no rows transferred).
  const { count: followingCount } = await supabaseAdmin
    .from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', userId);
  const { count: followerCount } = await supabaseAdmin
    .from('follows').select('*', { count: 'exact', head: true }).eq('following_id', userId);
  // "Good Sport" counts kudos GIVEN on both posts and activities. The
  // activity_likes count degrades to 0 until the user-created table exists.
  const { count: postKudosGiven } = await supabaseAdmin
    .from('post_likes').select('*', { count: 'exact', head: true }).eq('user_id', userId);
  let activityKudosGiven = 0;
  try {
    const { count, error: alErr } = await supabaseAdmin
      .from('activity_likes').select('*', { count: 'exact', head: true }).eq('user_id', userId);
    if (!alErr) activityKudosGiven = count || 0;
  } catch (err) { /* table not created yet — degrade */ }
  const kudosGiven = (postKudosGiven || 0) + activityKudosGiven;
  const { count: clubCount } = await supabaseAdmin
    .from('memberships').select('*', { count: 'exact', head: true }).eq('user_id', userId);
  const { count: eventsAttended } = await supabaseAdmin
    .from('event_rsvps').select('*', { count: 'exact', head: true })
    .eq('user_id', userId).eq('status', 'going');
  // Challenges completed: reuse computeChallengeProgress so the badge agrees
  // with the leaderboard's notion of completion. Avoid PostgREST FK embeds by
  // fetching the joined challenge rows directly.
  let challengesCompleted = 0;
  const { data: cps } = await supabaseAdmin
    .from('challenge_participants').select('challenge_id').eq('user_id', userId);
  const challengeIds = [...new Set((cps || []).map(c => c.challenge_id).filter(Boolean))];
  if (challengeIds.length) {
    const { data: chs } = await supabaseAdmin
      .from('challenges')
      .select('id, goal_type, goal_target, sport, start_date, end_date')
      .in('id', challengeIds);
    for (const ch of (chs || [])) {
      if (!(Number(ch.goal_target) > 0)) continue;
      // Window + streak days in the badge owner's zone (boundary policy).
      const inRange = actsInChallengeWindow(activities, ch, tz);
      if (computeChallengeProgress(ch, inRange, tz) >= Number(ch.goal_target)) challengesCompleted++;
    }
  }
  return {
    activityCount: activities.length,
    totalKm, longestRun, longestRide, sportCount, hasEarlyBird, longestStreak,
    followingCount: followingCount || 0,
    followerCount: followerCount || 0,
    kudosGiven: kudosGiven || 0,
    clubCount: clubCount || 0,
    eventsAttended: eventsAttended || 0,
    challengesCompleted
  };
}

// Check the user's stats against every badge and award newly earned ones,
// notifying the user once per badge. Safe to call fire-and-forget from action
// routes; no-ops cleanly if the `achievements` table is missing/unreadable.
async function checkAchievements(userId, tz) {
  if (!supabaseAdmin || !userId) return [];
  try {
    const stats = await gatherBadgeStats(userId, tz);
    const { data: earned, error: earnedErr } = await supabaseAdmin
      .from('achievements').select('badge_id').eq('user_id', userId);
    if (earnedErr) return [];
    const earnedIds = new Set((earned || []).map(e => e.badge_id));
    const newBadges = [];
    for (const badge of BADGES) {
      if (earnedIds.has(badge.id)) continue;
      if (!badge.check(stats)) continue;
      const { error } = await supabaseAdmin
        .from('achievements')
        .insert({ user_id: userId, badge_id: badge.id });
      if (!error) {
        newBadges.push(badge);
        await createNotification({
          userId,
          type: 'achievement',
          title: 'Achievement unlocked!',
          body: `🏅 You earned "${badge.name}" — ${badge.desc}`,
          link: '/profile'
        });
      }
    }
    return newBadges;
  } catch (err) {
    console.log('checkAchievements error:', err.message);
    return [];
  }
}

// Achievements data for the profile tab. Runs a fresh check first, then returns
// every badge with earned/progress state. Stays functional (earned 0, progress
// shown) even before the `achievements` table is created.
app.get(BASE + '/api/profile/achievements', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Server is not configured for achievements' });
  try {
    const achTz = getUserTimezone(req.user);
    await checkAchievements(req.user.id, achTz);
    const stats = await gatherBadgeStats(req.user.id, achTz);
    let earned = [];
    const { data: earnedRows, error: earnedErr } = await supabaseAdmin
      .from('achievements')
      .select('badge_id, earned_at')
      .eq('user_id', req.user.id)
      .order('earned_at', { ascending: false });
    if (!earnedErr && earnedRows) earned = earnedRows;
    const earnedMap = {};
    earned.forEach(e => { earnedMap[e.badge_id] = e.earned_at; });
    const badges = BADGES.map(b => {
      const [current, target] = b.progress(stats);
      return {
        id: b.id, cat: b.cat, icon: b.icon, name: b.name, desc: b.desc,
        earned: !!earnedMap[b.id],
        earnedAt: earnedMap[b.id] || null,
        current: Math.min(current, target),
        target,
        unit: b.unit || ''
      };
    });
    const latestBadge = earned.length > 0 ? badges.find(b => b.id === earned[0].badge_id) : null;
    // "Earned this month" in the OWNER's zone (boundary policy) — earned_at
    // is a timestamp, so bucket it by the achiever's local month.
    const nowMonth = monthKey(new Date(), achTz);
    const thisMonthCount = earned.filter(e => monthKey(e.earned_at, achTz) === nowMonth).length;
    res.json({
      badges,
      earnedCount: earned.length,
      totalCount: BADGES.length,
      latest: latestBadge ? { ...latestBadge, earnedAt: earned[0].earned_at } : null,
      thisMonthCount
    });
  } catch (err) {
    console.log('Achievements error:', err.message);
    res.status(500).json({ error: 'Could not load achievements' });
  }
});

// Profile overview — consolidated "this week" summary, day strip, current
// streak, recent activities, active challenges, and upcoming RSVPs for the
// logged-in athlete. Reuses the shared scoring/duration/progress helpers so the
// numbers agree with the leaderboard and challenges pages. Self-only via
// req.user.id. FK embeds aren't used in this codebase, so joined challenge/event
// rows are fetched separately via .in(). Recent activities are deliberately
// ordered by `date` (the training-day anchor, rendered as Today/Yesterday day
// buckets client-side) — not `created_at`, which is the logged moment.
app.get(BASE + '/api/profile/overview', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Server is not configured for overview' });
  try {
    const userId = req.user.id;
    const tz = getUserTimezone(req.user);
    const now = new Date();
    // Week bounds in the USER'S zone: the Monday-00:00 local instant is the
    // exact query cutoff, so a Sunday-6PM-Pacific activity (Monday 02:00 UTC)
    // stays in the Pacific user's previous week.
    const weekStartK = weekStartKey(now, tz);
    const weekStartInstant = zoneMidnightUtc(weekStartK, tz);

    // This week's activities.
    const { data: weekActs } = await supabaseAdmin
      .from('activities')
      .select('sport, distance, duration, date')
      .eq('user_id', userId)
      .gte('date', weekStartInstant.toISOString());
    const acts = weekActs || [];
    const weekKm = Math.round(acts.reduce((s, a) => s + parseDistanceKmUnitAware(a.distance), 0) * 10) / 10;
    const weekHours = Math.round(acts.reduce((s, a) => s + parseDurationHours(a.duration), 0) * 10) / 10;
    const weekPoints = calculatePoints(acts);

    // Day strip — which weekdays (Mon=0) had activity this week, in the
    // user's zone.
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const activeDaySet = new Set(acts.map(a => {
      const p = dateParts(a.date, tz);
      return p ? p.weekday - 1 : -1;
    }));
    const todayIdx = dateParts(now, tz).weekday - 1;
    const dayStrip = dayLabels.map((label, i) => ({
      label,
      state: i === todayIdx && !activeDaySet.has(i) ? 'today'
        : activeDaySet.has(i) ? 'active'
        : i < todayIdx ? 'rest' : 'future'
    }));

    // Current streak — consecutive active days (user's zone) ending today or
    // yesterday (shared helper).
    const { data: allActs } = await supabaseAdmin
      .from('activities').select('date').eq('user_id', userId);
    const { currentStreak } = computeStreaks(allActs || [], tz);

    // Recent activities (last 3) — deliberately ordered by training-day `date`
    // (the client renders Today/Yesterday day buckets from it).
    const { data: recentActs } = await supabaseAdmin
      .from('activities')
      .select('id, sport, title, distance, duration, pace, date')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(3);

    // My active challenges. Fetch joined challenge rows via .in() (no FK embeds),
    // then compute progress with the shared helper so it matches the rest of the
    // app. Each per-challenge query is sequential but bounded by joined count.
    const { data: parts } = await supabaseAdmin
      .from('challenge_participants').select('challenge_id').eq('user_id', userId);
    const challengeIds = [...new Set((parts || []).map(p => p.challenge_id).filter(Boolean))];
    const activeChallenges = [];
    if (challengeIds.length) {
      const { data: chRows } = await supabaseAdmin
        .from('challenges')
        .select('id, title, sport, goal_type, goal_target, goal_unit, start_date, end_date')
        .in('id', challengeIds);
      for (const ch of (chRows || [])) {
        if (new Date(ch.end_date) < now) continue;
        // Fetch a day wide, then cut to the VIEWER'S local challenge window
        // (boundary policy — this is the viewer's own progress).
        const range = challengeFetchRange(ch);
        const { data: chActs } = await supabaseAdmin
          .from('activities')
          .select('sport, distance, date')
          .eq('user_id', userId)
          .gte('date', range.gteIso)
          .lte('date', range.lteIso);
        const progress = computeChallengeProgress(ch, actsInChallengeWindow(chActs, ch, tz), tz);
        const { count: totalParticipants } = await supabaseAdmin
          .from('challenge_participants')
          .select('*', { count: 'exact', head: true })
          .eq('challenge_id', ch.id);
        const target = Number(ch.goal_target) || 0;
        const daysLeft = Math.max(0, Math.ceil((new Date(ch.end_date) - now) / 86400000));
        const pct = target > 0 ? Math.min(100, Math.round((progress / target) * 100)) : 0;
        const totalDays = Math.max(1, (new Date(ch.end_date) - new Date(ch.start_date)) / 86400000);
        const elapsedDays = Math.max(0, (now - new Date(ch.start_date)) / 86400000);
        const expectedPct = Math.round((elapsedDays / totalDays) * 100);
        let statusText, statusColor;
        if (pct >= 100) { statusText = 'Goal achieved ✓'; statusColor = '#10B981'; }
        else if (ch.goal_type === 'streak') {
          const remaining = target - progress;
          statusText = `${remaining} more active day${remaining !== 1 ? 's' : ''} to go`;
          statusColor = '#854D0E';
        }
        else if (pct >= expectedPct) { statusText = 'On pace'; statusColor = '#10B981'; }
        else { statusText = 'Behind pace — push on'; statusColor = '#854D0E'; }
        activeChallenges.push({
          id: ch.id, title: ch.title, sport: ch.sport,
          progress, target, unit: ch.goal_unit || '',
          pct, daysLeft, statusText, statusColor,
          totalParticipants: totalParticipants || 0
        });
      }
    }

    // My upcoming RSVPs (going/interested). Fetch event rows separately, then
    // the going-count per upcoming event.
    const { data: rsvps } = await supabaseAdmin
      .from('event_rsvps')
      .select('event_id, status')
      .eq('user_id', userId)
      .in('status', ['going', 'interested']);
    const statusByEvent = {};
    (rsvps || []).forEach(r => { statusByEvent[r.event_id] = r.status; });
    const eventIds = [...new Set((rsvps || []).map(r => r.event_id).filter(Boolean))];
    let upcomingRsvps = [];
    if (eventIds.length) {
      const { data: evRows } = await supabaseAdmin
        .from('events')
        .select('id, title, date, location, visibility, club_id, created_by')
        .in('id', eventIds);
      // Same visibility gate as everywhere: own RSVP is not an access grant.
      const visibleRows = await visibleEventsFilter(userId, evRows || []);
      upcomingRsvps = visibleRows
        .filter(ev => new Date(ev.date) >= now)
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .slice(0, 3)
        .map(ev => ({ status: statusByEvent[ev.id], ...ev }));
      for (const ev of upcomingRsvps) {
        const { count } = await supabaseAdmin
          .from('event_rsvps')
          .select('*', { count: 'exact', head: true })
          .eq('event_id', ev.id)
          .eq('status', 'going');
        ev.goingCount = count || 0;
      }
    }

    res.json({
      week: { activities: acts.length, km: weekKm, hours: weekHours, points: weekPoints },
      dayStrip,
      currentStreak,
      recentActivities: recentActs || [],
      activeChallenges,
      upcomingRsvps
    });
  } catch (err) {
    console.log('Overview error:', err.message);
    res.status(500).json({ error: 'Could not load overview' });
  }
});

// All challenges relevant to the logged-in user: ones they created or joined,
// challenges from clubs they belong to, and public challenges to discover.
// Creator/club names are resolved from auth metadata + the clubs table (no
// `profiles` table, no FK embeds).
app.get(BASE + '/api/challenges', requireAuth, async (req, res) => {
  if (!supabaseAdmin) {
    return res.json({ myChallenges: [], friendsChallenges: [], publicChallenges: [], publicCount: 0, myJoinedIds: [], pointsThisMonth: 0, longestStreak: 0, currentStreak: 0, pointsBySport: [], weekGrid: [], friendsInChallenges: [], followsAnyone: false });
  }
  const userId = req.user.id;
  const PLACEHOLDER = '00000000-0000-0000-0000-000000000000';
  try {
    const { data: myParticipations } = await supabaseAdmin
      .from('challenge_participants').select('challenge_id').eq('user_id', userId);
    const myIds = [...new Set((myParticipations || []).map((p) => p.challenge_id).filter(Boolean))];

    // My challenges = ones I created + ones I joined. Split into two queries to
    // sidestep Supabase .or() quirks with UUID id.in lists.
    const { data: createdChallenges } = await supabaseAdmin
      .from('challenges').select('*')
      .eq('created_by', userId)
      .order('created_at', { ascending: false });
    const createdIds = new Set((createdChallenges || []).map((c) => c.id));
    const joinedIds = myIds.filter((id) => !createdIds.has(id));
    let joinedChallenges = [];
    if (joinedIds.length) {
      const { data } = await supabaseAdmin
        .from('challenges').select('*')
        .in('id', joinedIds)
        .order('created_at', { ascending: false });
      joinedChallenges = data || [];
    }
    const myChallenges = [...(createdChallenges || []), ...joinedChallenges];

    // Pending invites RECEIVED by the viewer (the real private-challenge rails).
    // Any lookup failure (e.g. the challenge_invites table not provisioned yet)
    // degrades to "no invites" — never a 500, never fabricated state.
    let receivedInviteRows = [];
    try {
      const { data: invRows, error: invErr } = await supabaseAdmin
        .from('challenge_invites').select('challenge_id, invitee_id, inviter_id')
        .eq('invitee_id', userId);
      if (!invErr) receivedInviteRows = invRows || [];
    } catch (e) { /* degrade to none */ }
    // Dropping self-created ids is input sanity (self-invites don't exist);
    // the pending verdict itself comes from the ONE shared pendingInvites rule.
    const pendingInviteRows = pendingInvites(
      receivedInviteRows.filter((r) => !createdIds.has(r.challenge_id)),
      myIds.map((id) => ({ challenge_id: id, user_id: userId }))
    );
    // Only live private solo challenges — an ended or malformed invite target
    // must not surface as an actionable invitation.
    let invitedChallenges = [];
    if (pendingInviteRows.length) {
      const { data } = await supabaseAdmin
        .from('challenges').select('*')
        .in('id', [...new Set(pendingInviteRows.map((r) => r.challenge_id))])
        .eq('visibility', 'private').is('club_id', null)
        .gt('end_date', new Date().toISOString())
        .order('created_at', { ascending: false });
      invitedChallenges = data || [];
    }

    // Discover = public, non-expired challenges the user neither created nor
    // joined. Skip the .not() filter entirely when there's nothing to exclude.
    //
    // applyDiscoverFilters is the SINGLE definition of the three filter
    // conditions shared by both queries below. Editing conditions here
    // affects both; there is no second copy that could drift.
    const excludeFromDiscover = [...new Set([...myChallenges.map((c) => c.id), ...myIds])];
    const discoverNowIso = new Date().toISOString();
    function applyDiscoverFilters(q) {
      let query = q.eq('visibility', 'public').gt('end_date', discoverNowIso);
      if (excludeFromDiscover.length) {
        query = query.not('id', 'in', `(${excludeFromDiscover.join(',')})`);
      }
      return query;
    }

    // Run an exact head-count (no row data transferred) and the 20-row grid
    // fetch in parallel. Both use applyDiscoverFilters so the filter set is
    // guaranteed to be identical.
    const [countResult, gridResult] = await Promise.all([
      applyDiscoverFilters(supabaseAdmin.from('challenges').select('*', { count: 'exact', head: true })),
      applyDiscoverFilters(supabaseAdmin.from('challenges').select('*'))
        .order('created_at', { ascending: false }).limit(20)
    ]);
    const publicChallenges = gridResult.data || [];
    // publicCount: exact total of joinable public challenges (always ≥ grid
    // length). Falls back to the grid length when the count query errors so
    // the header stat can never silently understate or show zero.
    const publicCount = (!countResult.error && countResult.count != null)
      ? countResult.count
      : publicChallenges.length;

    // De-duplicate the full set so we only look up each challenge once.
    const allChallenges = [];
    const seen = new Set();
    [myChallenges || [], invitedChallenges || [], publicChallenges || []].forEach((list) => {
      list.forEach((c) => { if (!seen.has(c.id)) { seen.add(c.id); allChallenges.push(c); } });
    });
    const allIds = allChallenges.map((c) => c.id);

    const { data: allParticipants } = await supabaseAdmin
      .from('challenge_participants').select('challenge_id, user_id')
      .in('challenge_id', allIds.length ? allIds : [PLACEHOLDER]);

    // Pending-invite counts for private solo challenges the viewer created —
    // powers the owner's "Invites · N pending" affordance. Error-tolerant:
    // before the invites table exists this stays empty (chip simply absent).
    const ownedPrivateIds = (createdChallenges || [])
      .filter((c) => c.visibility === 'private' && !c.club_id).map((c) => c.id);
    const pendingCountByChallenge = {};
    if (ownedPrivateIds.length) {
      try {
        const { data: sentRows, error: sentErr } = await supabaseAdmin
          .from('challenge_invites').select('challenge_id, invitee_id')
          .in('challenge_id', ownedPrivateIds);
        if (!sentErr) {
          pendingInvites(sentRows, allParticipants || []).forEach((r) => {
            pendingCountByChallenge[r.challenge_id] = (pendingCountByChallenge[r.challenge_id] || 0) + 1;
          });
        }
      } catch (e) { /* degrade to no counts */ }
    }

    // Progress for each challenge the user has joined — the viewer's own
    // activities, cut to their local challenge window (boundary policy).
    const viewerTz = getUserTimezone(req.user);
    const progressMap = {};
    for (const challengeId of myIds) {
      const challenge = allChallenges.find((c) => c.id === challengeId);
      if (!challenge) continue;
      const range = challengeFetchRange(challenge);
      const { data: activities } = await supabaseAdmin
        .from('activities').select('distance, duration, sport, date')
        .eq('user_id', userId)
        .gte('date', range.gteIso).lte('date', range.lteIso);
      progressMap[challengeId] =
        computeChallengeProgress(challenge, actsInChallengeWindow(activities, challenge, viewerTz), viewerTz);
    }

    // Creator display names (auth metadata) and club names (clubs table).
    const creatorMap = await buildUserDisplayMap([
      ...allChallenges.map((c) => c.created_by),
      ...pendingInviteRows.map((r) => r.inviter_id)
    ]);
    const challengeClubIds = [...new Set(allChallenges.map((c) => c.club_id).filter(Boolean))];
    const clubNameMap = {};
    if (challengeClubIds.length) {
      const { data: clubs } = await supabaseAdmin.from('clubs').select('id, name').in('id', challengeClubIds);
      (clubs || []).forEach((c) => { clubNameMap[c.id] = c.name; });
    }

    const now = Date.now();
    const viewerTzEnrich = getUserTimezone(req.user);
    const enrich = (list) => (list || []).map((c) => {
      const end = new Date(c.end_date).getTime();
      const goalTarget = parseFloat(c.goal_target) || 0;
      const progress = parseFloat(progressMap[c.id]) || 0;
      // Safe percentage — never divide by zero/null goal_target.
      const pct = goalTarget > 0 ? Math.min(100, Math.round((progress / goalTarget) * 100)) : 0;
      // image_path is server-only; clients get the version token `image`.
      const { image_path, ...cPub } = c;
      return {
        ...cPub,
        image: challengeImageVersion(image_path),
        goal_target: goalTarget,
        participantCount: (allParticipants || []).filter((p) => p.challenge_id === c.id).length,
        isJoined: myIds.includes(c.id) || c.created_by === userId,
        progress,
        pct,
        daysLeft: Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24))),
        isExpired: challengeHasEnded(c, viewerTzEnrich),
        // Only complete when there's a real positive target that's been reached.
        isComplete: goalTarget > 0 && progress >= goalTarget,
        isOwner: c.created_by === userId,
        creator: creatorMap[c.created_by] || null,
        clubName: c.club_id ? (clubNameMap[c.club_id] || null) : null,
        // Owner-only affordance data; 0/absent for everyone else.
        pendingInvites: c.created_by === userId ? (pendingCountByChallenge[c.id] || 0) : 0
      };
    });

    // "With friends" = the viewer's private social scope: challenges they were
    // invited to (pending, actionable) + every ACTIVE private solo challenge
    // they created or joined. Ended ones live in Completed via myChallenges.
    const inviterByChallenge = {};
    pendingInviteRows.forEach((r) => { inviterByChallenge[r.challenge_id] = r.inviter_id; });
    const friendsChallenges = [
      ...enrich(invitedChallenges).map((c) => ({
        ...c,
        myInviteState: 'invited',
        inviterName: ((creatorMap[inviterByChallenge[c.id]] || creatorMap[c.created_by] || {}).name) || null
      })),
      ...enrich(myChallenges.filter(
        (c) => c.visibility === 'private' && !c.club_id && new Date(c.end_date).getTime() > now
      ))
    ];

    // ── Header + sidebar stats for the signed-in user (real data, same load) ──
    // Best-effort: a failure here must never break the challenges payload, so it
    // degrades to honest zeros/empties rather than throwing.
    let pointsThisMonth = 0, longestStreak = 0, currentStreak = 0;
    let pointsBySport = [], weekGrid = [];
    try {
      const { data: userActs } = await supabaseAdmin
        .from('activities').select('sport, distance, date')
        .eq('user_id', userId);
      const acts = userActs || [];
      const hdrTz = getUserTimezone(req.user);
      const mNow = new Date();
      const nowMonth = monthKey(mNow, hdrTz);
      const monthActs = acts.filter((a) => monthKey(a.date, hdrTz) === nowMonth);
      // "pts earned this month" — same SPORT_POINTS model used by leaderboards
      // and profile stats, over the user's-zone current calendar month.
      pointsThisMonth = calculatePoints(monthActs);
      // Per-sport breakdown of that exact monthly total (only sports with points).
      const bySport = {};
      monthActs.forEach((a) => { const s = a.sport || 'other'; (bySport[s] = bySport[s] || []).push(a); });
      pointsBySport = Object.keys(bySport)
        .map((sport) => ({ sport, points: calculatePoints(bySport[sport]) }))
        .filter((x) => x.points > 0)
        .sort((a, b) => b.points - a.points);
      // Distinct active days (user-zone day keys) still drive the week grid;
      // both streak numbers now come from the shared helper (same semantics).
      const daySet = new Set(acts.map((a) => dayKey(a.date, hdrTz)));
      ({ currentStreak, longestStreak } = computeStreaks(acts, hdrTz));
      // This week's grid (Mon→Sun) in the user's zone: active day, today, and
      // future (unfilled) cells — key comparisons, no server-local Dates.
      const todayK = dayKey(mNow, hdrTz);
      const mondayK = weekStartKey(mNow, hdrTz);
      for (let i = 0; i < 7; i++) {
        const k = addDaysToKey(mondayK, i);
        weekGrid.push({ active: daySet.has(k), isToday: k === todayK, isFuture: k > todayK });
      }
    } catch (statErr) {
      console.log('Challenge header stats error:', statErr.message);
    }

    // ── "Friends in challenges" — people the viewer follows who have joined a
    // PUBLIC challenge (private/club titles are never leaked). Honest empty when
    // the viewer follows no one or none of them are in a public challenge. ──
    let friendsInChallenges = [], followsAnyone = false;
    try {
      const { data: follows } = await supabaseAdmin
        .from('follows').select('following_id').eq('follower_id', userId);
      const followingIds = [...new Set((follows || []).map((f) => f.following_id).filter(Boolean))];
      followsAnyone = followingIds.length > 0;
      if (followingIds.length) {
        const { data: fParts } = await supabaseAdmin
          .from('challenge_participants').select('challenge_id, user_id')
          .in('user_id', followingIds);
        const fChallengeIds = [...new Set((fParts || []).map((p) => p.challenge_id).filter(Boolean))];
        if (fChallengeIds.length) {
          const { data: pubCh } = await supabaseAdmin
            .from('challenges').select('id, title, sport')
            .in('id', fChallengeIds).eq('visibility', 'public');
          const pubMap = {};
          (pubCh || []).forEach((c) => { pubMap[c.id] = c; });
          const byUser = {};
          (fParts || []).forEach((p) => {
            const ch = pubMap[p.challenge_id];
            if (ch) { (byUser[p.user_id] = byUser[p.user_id] || []).push(ch); }
          });
          const fNameMap = await buildUserDisplayMap(Object.keys(byUser));
          friendsInChallenges = Object.keys(byUser).map((uid) => ({
            id: uid,
            name: (fNameMap[uid] || {}).name || 'Athlete',
            avatar_url: (fNameMap[uid] || {}).avatar_url || null,
            profilePublic: fNameMap[uid] ? fNameMap[uid].profilePublic !== false : true,
            sport: byUser[uid][0].sport,
            challengeTitle: byUser[uid][0].title,
            moreCount: byUser[uid].length - 1
          })).slice(0, 6);
        }
      }
    } catch (frErr) {
      console.log('Challenge friends error:', frErr.message);
    }

    res.json({
      myChallenges: enrich(myChallenges),
      friendsChallenges,
      publicChallenges: enrich(publicChallenges),
      publicCount,
      myJoinedIds: myIds,
      pointsThisMonth,
      longestStreak,
      currentStreak,
      pointsBySport,
      weekGrid,
      friendsInChallenges,
      followsAnyone
    });
  } catch (err) {
    console.log('Challenges list error:', err.message);
    res.json({ error: err.message });
  }
});

// Create a challenge, auto-join the creator, and notify invited followers.
app.post(BASE + '/api/challenges/create', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for challenges' });
  const b = req.body || {};
  const { title, description, sport, goal_type, goal_target, goal_unit, start_date, end_date, visibility, invitees, club_id } = b;
  // Authorization (UNCONDITIONAL — independent of PLAN_GATES_ENABLED). Creating a
  // challenge scoped to a club is a club-management action, so the caller must be
  // an admin/coach of THAT club. This is access control, not plan gating, so it
  // must run whether or not the plan gates are enabled. It also stops anyone from
  // tagging a challenge into a club they don't belong to (namespace spoofing).
  let isClubMgr = false;
  if (club_id) {
    const clubRole = await getClubRole(req.user.id, club_id);
    isClubMgr = !!(clubRole && isClubManagerRole(clubRole.role));
    if (!isClubMgr) {
      return res.status(403).json({ error: 'not_club_manager' });
    }
  }
  // Individual Pro gate (dormant unless PLAN_GATES_ENABLED). Club challenges are
  // a club-scoped feature, NOT the individual Pro tier, so a club admin/coach
  // (already verified above) is exempt; only individual creates require Pro.
  // Flag off => this block is skipped and behaviour is identical to today.
  if (PLAN_GATES_ENABLED && !isClubMgr) {
    if ((await getUserPlan(req.user.id)) === 'free') {
      return res.status(403).json({ error: 'pro_required', feature: 'challenge_create', upgrade: '/billing' });
    }
  }
  if (!title || !goal_type || !goal_target || !start_date || !end_date) {
    return res.json({ error: 'Missing required fields' });
  }
  // Exactly the four supported types — anything else is a 400, not a stored
  // mystery value ('streak' remains the stored spelling of "Active days").
  if (!CHALLENGE_GOAL_TYPES.includes(goal_type)) {
    return res.status(400).json({ error: 'invalid_goal_type', message: 'Goal type must be distance, duration, sessions or active days.' });
  }
  console.log('Creating challenge with goal_target:', goal_target, typeof goal_target);
  const goalTargetNum = parseFloat(goal_target) || 0;
  // Reject malformed/non-positive targets so we never store 0/NaN (which would
  // otherwise feed the divide-by-zero / false-completion path).
  if (!(goalTargetNum > 0)) return res.json({ error: 'Goal target must be a positive number' });
  const { data: challenge, error } = await supabaseAdmin
    .from('challenges').insert({
      created_by: req.user.id,
      club_id: club_id || null,
      title: String(title).trim(),
      description: description || null,
      sport: sport || 'any',
      goal_type,
      goal_target: goalTargetNum,
      goal_unit: goal_unit || null,
      start_date,
      end_date,
      visibility: visibility || 'public'
    }).select().single();
  if (error) return res.json({ error: error.message });
  // Auto-join the creator. MUST-BLOCK, not best-effort: a challenge whose
  // creator is not a participant is broken (leaderboards, coach rollups and
  // delete-aloneness all assume it), so a failed join rolls the challenge back.
  const { error: joinErr } = await supabaseAdmin.from('challenge_participants')
    .insert({ challenge_id: challenge.id, user_id: req.user.id });
  if (joinErr) {
    console.error('Challenge create: creator auto-join failed (challenge %s, user %s):', challenge.id, req.user.id, joinErr.message);
    const { error: rbErr } = await supabaseAdmin.from('challenges').delete().eq('id', challenge.id);
    if (rbErr) console.error('Challenge create rollback FAILED — orphan challenge %s without creator participant (manual remediation needed):', challenge.id, rbErr.message);
    return res.status(500).json({ error: 'Could not create the challenge' });
  }
  // Invite rails (private solo only). Validate against the creator's FOLLOWERS —
  // the picker offers exactly those, and followers opted in to hearing from the
  // creator (you can't follow someone in order to invite them; THEY follow YOU).
  // Cap 50. Each invitee gets a RECORD (which authorizes joining and drives all
  // invite UI state) plus an actionable notification. No record ⇒ no
  // notification: if the insert fails (e.g. challenge_invites not provisioned
  // yet) we return an honest warning instead of recreating the old dead-end.
  let invitedCount = 0;
  let inviteWarning = null;
  const isPrivateSolo = challenge.visibility === 'private' && !challenge.club_id;
  if (isPrivateSolo && Array.isArray(invitees) && invitees.length) {
    const { data: followRows } = await supabaseAdmin
      .from('follows').select('follower_id').eq('following_id', req.user.id);
    const followerSet = new Set((followRows || []).map((f) => f.follower_id));
    const validInvitees = [...new Set(invitees)]
      .filter((id) => id && typeof id === 'string' && followerSet.has(id) && id !== req.user.id)
      .slice(0, 50);
    if (validInvitees.length) {
      const { error: invErr } = await supabaseAdmin.from('challenge_invites').insert(
        validInvitees.map((id) => ({ challenge_id: challenge.id, invitee_id: id, inviter_id: req.user.id }))
      );
      if (invErr) {
        console.log('Challenge invite insert failed (degrading):', invErr.message);
        inviteWarning = 'invites_unavailable';
      } else {
        invitedCount = validInvitees.length;
        // Actor name from auth metadata (no profiles table).
        const actor = displayFromUser(req.user);
        for (const inviteeId of validInvitees) {
          await createNotification({
            userId: inviteeId,
            type: 'challenge_invite',
            title: 'Challenge invite',
            body: `${actor.name} invited you to a challenge: "${challenge.title}" — ${challengeGoalPhrase(challenge)}`.replace(/\s+/g, ' ').trim(),
            link: '/challenges#friends',
            actorId: req.user.id,
            entityId: challenge.id
          });
        }
      }
    }
  }
  res.json({ success: true, challenge: challengePublicRow(challenge), invitedCount, inviteWarning });
});

// Join a challenge (adds the viewer as a participant).
app.post(BASE + '/api/challenges/:id/join', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for challenges' });
  const { data: ch } = await supabaseAdmin
    .from('challenges').select('id, club_id, visibility, created_by, end_date')
    .eq('id', req.params.id).maybeSingle();
  // Canonical visibility gate (2026-08-07). This subsumes the old inline
  // private-solo invite check AND closes the club hole: private CLUB
  // challenges now require membership to join. Denial is the byte-identical
  // "Challenge not found" a nonexistent id gets — the old distinct
  // `invite_required` 403 was an existence oracle. Participant is a grant
  // (invite rows are retained-on-accept, so leave-and-rejoin also works).
  if (!ch || !(await canUserSeeChallenge(req.user.id, ch))) {
    return res.json({ error: 'Challenge not found' });
  }
  // Ended challenges can't be joined — the invite pill/card degrade honestly
  // instead of inserting a participant into a finished contest.
  if (ch.end_date && new Date(ch.end_date).getTime() < Date.now()) {
    return res.json({ error: 'This challenge has ended' });
  }
  // Individual Pro gate (dormant unless PLAN_GATES_ENABLED). Joining a club's own
  // challenge is a club-scoped feature, so club challenges are exempt; only
  // individual/public challenges require Pro. Flag off => skipped entirely.
  if (PLAN_GATES_ENABLED) {
    if (!ch.club_id && (await getUserPlan(req.user.id)) === 'free') {
      return res.status(403).json({ error: 'pro_required', feature: 'challenge_join', upgrade: '/billing' });
    }
  }
  const { error } = await supabaseAdmin
    .from('challenge_participants').insert({ challenge_id: req.params.id, user_id: req.user.id });
  // Duplicate-join is idempotent success (participant is a visibility grant
  // now, so a current participant can reach this insert) — same precedent as
  // unfollow. Any other insert failure is still surfaced.
  if (error && error.code !== '23505') return res.json({ error: error.message });
  // Award any newly earned challenge badges without blocking.
  checkAchievements(req.user.id, getUserTimezone(req.user)).catch(() => {});
  res.json({ success: true });
});

// Leave a challenge. The user_id filter enforces self-only removal even though
// the service role bypasses RLS. Deliberately NOT behind the Pro gate: leaving
// is an exit action, so gating it would trap a downgraded user in a challenge.
app.delete(BASE + '/api/challenges/:id/leave', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for challenges' });
  const { error: leaveErr } = await supabaseAdmin.from('challenge_participants').delete()
    .eq('challenge_id', req.params.id).eq('user_id', req.user.id);
  if (leaveErr) return res.status(500).json({ error: 'Could not leave the challenge' });
  res.json({ success: true });
});

// ── Challenge invites (private solo challenges; creator-managed) ────────────
// List invites for a challenge (creator only): who is still pending. Powers the
// owner's Manage-invites modal. invitedIds includes joined-via-invite users so
// the invite-more picker can exclude them.
app.get(BASE + '/api/challenges/:id/invites', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for challenges' });
  const { data: ch } = await supabaseAdmin
    .from('challenges').select('id, created_by').eq('id', req.params.id).maybeSingle();
  // Non-creators (including strangers probing ids) get the same "not found".
  if (!ch || ch.created_by !== req.user.id) return res.json({ error: 'Challenge not found' });
  try {
    const [invitesResult, partsResult] = await Promise.all([
      supabaseAdmin.from('challenge_invites').select('challenge_id, invitee_id, created_at').eq('challenge_id', ch.id),
      supabaseAdmin.from('challenge_participants').select('challenge_id, user_id').eq('challenge_id', ch.id)
    ]);
    if (invitesResult.error) return res.json({ error: 'invites_unavailable' });
    const joined = new Set((partsResult.data || []).map((p) => p.user_id));
    // Pending verdict comes from the ONE shared pendingInvites rule — never
    // re-derived inline (this route was the last inline copy).
    const pendingRows = pendingInvites(invitesResult.data || [], partsResult.data || []);
    const map = await buildUserDisplayMap(pendingRows.map((r) => r.invitee_id));
    res.json({
      pending: pendingRows.map((r) => ({
        id: r.invitee_id,
        name: (map[r.invitee_id] || {}).name || 'Athlete',
        avatar_url: (map[r.invitee_id] || {}).avatar_url || null,
        location: (map[r.invitee_id] || {}).location || null,
        invitedAt: r.created_at
      })),
      participantIds: [...joined],
      invitedIds: (invitesResult.data || []).map((r) => r.invitee_id)
    });
  } catch (err) {
    res.json({ error: 'invites_unavailable' });
  }
});

// Invite more followers after creation (creator only; same follower validation,
// cap, record + notification rails as create-time invites).
app.post(BASE + '/api/challenges/:id/invites', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for challenges' });
  // Canonical body key: `invitees` — same key as create-time invites. (Aligned
  // 2026-07: the old create=`invitees` / invite-more=`userIds` mismatch caused
  // a batch of false test failures for one concept in one feature.)
  const invitees = Array.isArray((req.body || {}).invitees) ? req.body.invitees : [];
  const { data: ch } = await supabaseAdmin
    .from('challenges').select('id, title, created_by, club_id, visibility, end_date, goal_target, goal_unit, goal_type')
    .eq('id', req.params.id).maybeSingle();
  if (!ch || ch.created_by !== req.user.id) return res.json({ error: 'Challenge not found' });
  if (!(ch.visibility === 'private' && !ch.club_id)) return res.json({ error: 'Only private challenges use invites' });
  if (ch.end_date && challengeHasEnded(ch)) return res.json({ error: 'This challenge has ended' });
  const { data: followRows } = await supabaseAdmin
    .from('follows').select('follower_id').eq('following_id', req.user.id);
  const followerSet = new Set((followRows || []).map((f) => f.follower_id));
  const valid = [...new Set(invitees)]
    .filter((id) => id && typeof id === 'string' && followerSet.has(id) && id !== req.user.id)
    .slice(0, 50);
  if (!valid.length) return res.json({ error: 'No valid followers to invite' });
  try {
    const { data: parts } = await supabaseAdmin
      .from('challenge_participants').select('user_id').eq('challenge_id', ch.id);
    const joined = new Set((parts || []).map((p) => p.user_id));
    const toInvite = valid.filter((id) => !joined.has(id));
    if (!toInvite.length) return res.json({ success: true, invitedCount: 0 });
    // ignoreDuplicates makes re-sends a no-op for still-pending invitees (no
    // duplicate row, no re-notification), while a revoked-then-reinvited
    // follower gets a fresh row + fresh notification. .select() returns ONLY
    // the genuinely inserted rows, which is exactly the notify set.
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('challenge_invites')
      .upsert(
        toInvite.map((id) => ({ challenge_id: ch.id, invitee_id: id, inviter_id: req.user.id })),
        { onConflict: 'challenge_id,invitee_id', ignoreDuplicates: true }
      )
      .select('invitee_id');
    if (insErr) return res.json({ error: 'invites_unavailable' });
    const actor = displayFromUser(req.user);
    for (const row of (inserted || [])) {
      await createNotification({
        userId: row.invitee_id,
        type: 'challenge_invite',
        title: 'Challenge invite',
        body: `${actor.name} invited you to a challenge: "${ch.title}" — ${challengeGoalPhrase(ch)}`.replace(/\s+/g, ' ').trim(),
        link: '/challenges#friends',
        actorId: req.user.id,
        entityId: ch.id
      });
    }
    res.json({ success: true, invitedCount: (inserted || []).length });
  } catch (err) {
    res.json({ error: 'invites_unavailable' });
  }
});

// Revoke a PENDING invite (creator only). Never ejects a participant — if the
// invitee already joined, revoke refuses (member removal is a different, out-
// of-scope action). The old notification row is left in place: its pill state
// recomputes to 'revoked' server-side, which is the honest degradation.
app.delete(BASE + '/api/challenges/:id/invites/:userId', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for challenges' });
  const { data: ch } = await supabaseAdmin
    .from('challenges').select('id, created_by').eq('id', req.params.id).maybeSingle();
  if (!ch || ch.created_by !== req.user.id) return res.json({ error: 'Challenge not found' });
  const { data: part } = await supabaseAdmin
    .from('challenge_participants').select('user_id')
    .eq('challenge_id', ch.id).eq('user_id', req.params.userId).maybeSingle();
  if (part) return res.json({ error: 'already_joined' });
  try {
    const { error } = await supabaseAdmin.from('challenge_invites').delete()
      .eq('challenge_id', ch.id).eq('invitee_id', req.params.userId);
    if (error) return res.json({ error: 'invites_unavailable' });
    res.json({ success: true });
  } catch (err) {
    res.json({ error: 'invites_unavailable' });
  }
});

// Leaderboard for a challenge: each participant's progress, ranked. Participant
// names come from auth metadata (no profiles join).
app.get(BASE + '/api/challenges/:id/leaderboard', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for challenges' });
  try {
    const { data: challenge } = await supabaseAdmin
      .from('challenges').select('*').eq('id', req.params.id).single();
    if (!challenge) return res.json({ error: 'Challenge not found' });
    // Canonical visibility gate — a ranked roster of names/avatars is exactly
    // what a non-public challenge must protect. Strangers (including
    // NON-MEMBERS on a private CLUB challenge — hole closed 2026-08-07) get
    // the same "not found" as a nonexistent id (no existence leak).
    if (!(await canUserSeeChallenge(req.user.id, challenge))) {
      return res.json({ error: 'Challenge not found' });
    }
    const { data: participants } = await supabaseAdmin
      .from('challenge_participants').select('user_id').eq('challenge_id', req.params.id);
    // Profile map (not display map): also carries each participant's zone so
    // progress windows/streak days follow the PARTICIPANT (boundary policy).
    const nameMap = await buildUserProfileMap((participants || []).map((p) => p.user_id));
    const target = Number(challenge.goal_target) || 0;
    const range = challengeFetchRange(challenge);
    const leaderboard = [];
    for (const participant of (participants || [])) {
      const pTz = memberZone(nameMap[participant.user_id]);
      const { data: activities } = await supabaseAdmin
        .from('activities').select('distance, duration, sport, date')
        .eq('user_id', participant.user_id)
        .gte('date', range.gteIso).lte('date', range.lteIso);
      const progress = computeChallengeProgress(challenge, actsInChallengeWindow(activities, challenge, pTz), pTz);
      const disp = nameMap[participant.user_id] || {};
      leaderboard.push({
        userId: participant.user_id,
        name: disp.name || 'Athlete',
        handle: disp.handle || 'athlete',
        avatar_url: disp.avatar_url || null,
        profilePublic: disp.profilePublic !== false,
        progress,
        percentage: target ? Math.min(100, Math.round((progress / target) * 100)) : 0
      });
    }
    leaderboard.sort((a, b) => b.progress - a.progress);
    leaderboard.forEach((entry, i) => { entry.rank = i + 1; });
    res.json({ leaderboard, challenge: challengePublicRow(challenge) });
  } catch (err) {
    console.log('Leaderboard error:', err.message);
    res.json({ error: err.message });
  }
});

// Authorize a club challenge action: the caller must be an admin/coach of the
// challenge's club. Mirrors requireEventManager. Returns the challenge row (with
// the requested columns) when authorized, otherwise null.
async function requireChallengeManager(challengeId, userId, columns = '*') {
  if (!supabaseAdmin) return null;
  const { data: challenge } = await supabaseAdmin
    .from('challenges').select(columns).eq('id', challengeId).maybeSingle();
  if (!challenge || !challenge.club_id) return null;
  const { data: mgr } = await supabaseAdmin
    .from('memberships').select('role')
    .eq('club_id', challenge.club_id).eq('user_id', userId)
    .in('role', ['admin', 'coach']).maybeSingle();
  return mgr ? challenge : null;
}

// Nudge club members who haven't joined a challenge yet (coach/admin only).
app.post(BASE + '/api/challenges/:id/nudge-join', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for challenges' });
  const challenge = await requireChallengeManager(req.params.id, req.user.id, '*');
  if (!challenge) return res.json({ error: 'Challenge not found' });

  const { data: members } = await supabaseAdmin
    .from('memberships').select('user_id').eq('club_id', challenge.club_id);
  const { data: participants } = await supabaseAdmin
    .from('challenge_participants').select('user_id').eq('challenge_id', req.params.id);
  const joinedIds = new Set((participants || []).map(p => p.user_id));
  const actor = displayFromUser(req.user);
  const notJoined = (members || []).filter(m => !joinedIds.has(m.user_id) && m.user_id !== req.user.id);
  const daysLeft = Math.max(0, Math.ceil((new Date(challenge.end_date) - new Date()) / (1000 * 60 * 60 * 24)));
  for (const member of notJoined) {
    await createNotification({
      userId: member.user_id, type: 'challenge', title: 'Challenge reminder',
      body: `${actor.name} wants you to join "${challenge.title}" — ${daysLeft} days left to join and start tracking your progress!`,
      link: '/challenges', actorId: req.user.id, entityId: challenge.id
    });
  }
  res.json({ success: true, nudged: notJoined.length });
});

// Post a challenge to the club feed and notify members (coach/admin only).
app.post(BASE + '/api/challenges/:id/post-to-feed', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for challenges' });
  const challenge = await requireChallengeManager(req.params.id, req.user.id, '*');
  if (!challenge) return res.json({ error: 'Challenge not found' });

  const actor = displayFromUser(req.user);
  const daysLeft = Math.max(0, Math.ceil((new Date(challenge.end_date) - new Date()) / (1000 * 60 * 60 * 24)));
  const { error: postErr } = await supabaseAdmin.from('posts').insert({
    user_id: req.user.id,
    content: `⚡ Club challenge: ${challenge.title} — ${challengeGoalPhrase(challenge)} goal. ${daysLeft} days left to join! Find it in the Challenges tab.`.replace(/\s+/g, ' ').trim(),
    sport: challenge.sport === 'any' ? null : challenge.sport
  });
  if (postErr) return res.json({ error: postErr.message });

  const { data: members } = await supabaseAdmin
    .from('memberships').select('user_id').eq('club_id', challenge.club_id).neq('user_id', req.user.id);
  for (const m of (members || [])) {
    await createNotification({
      userId: m.user_id, type: 'challenge', title: 'Challenge reminder',
      body: `${actor.name} posted about "${challenge.title}" — check the feed for details`,
      link: '/feed', actorId: req.user.id, entityId: challenge.id
    });
  }
  res.json({ success: true });
});

// Duplicate a challenge one month later, auto-joining the creator (coach/admin only).
app.post(BASE + '/api/challenges/:id/duplicate', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for challenges' });
  const challenge = await requireChallengeManager(req.params.id, req.user.id, '*');
  if (!challenge) return res.json({ error: 'Challenge not found' });

  const startDate = new Date(challenge.start_date);
  const endDate = new Date(challenge.end_date);
  startDate.setMonth(startDate.getMonth() + 1);
  endDate.setMonth(endDate.getMonth() + 1);
  const { data: newChallenge, error } = await supabaseAdmin
    .from('challenges').insert({
      created_by: req.user.id,
      club_id: challenge.club_id,
      title: challenge.title,
      description: challenge.description,
      sport: challenge.sport,
      goal_type: challenge.goal_type,
      goal_target: challenge.goal_target,
      goal_unit: challenge.goal_unit,
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      visibility: challenge.visibility
    }).select().single();
  if (error) return res.json({ error: error.message });
  // Same must-block rule as create: no creator participant → roll back.
  const { error: joinErr } = await supabaseAdmin.from('challenge_participants')
    .insert({ challenge_id: newChallenge.id, user_id: req.user.id });
  if (joinErr) {
    console.error('Challenge duplicate: creator auto-join failed (challenge %s, user %s):', newChallenge.id, req.user.id, joinErr.message);
    const { error: rbErr } = await supabaseAdmin.from('challenges').delete().eq('id', newChallenge.id);
    if (rbErr) console.error('Challenge duplicate rollback FAILED — orphan challenge %s without creator participant (manual remediation needed):', newChallenge.id, rbErr.message);
    return res.status(500).json({ error: 'Could not duplicate the challenge' });
  }
  res.json({ success: true, challenge: challengePublicRow(newChallenge) });
});

// ── CHALLENGE CREATOR EDIT/DELETE (2026-07-28) ──────────────────────────────
// Authorization for challenge management: creator OR (club-scoped challenge +
// club admin/coach). Pure authorization — deliberately NEVER consults
// PLAN_GATES_ENABLED: exit and correction actions are not plan-gated (same
// precedent as /leave). Zero-leak rule: unauthorized callers on a PRIVATE SOLO
// challenge get the same "Challenge not found" as a missing id.
async function requireChallengeEditor(challengeId, userId) {
  if (!supabaseAdmin) return { fail: { error: 'Server is not configured for challenges' } };
  const { data: ch } = await supabaseAdmin
    .from('challenges').select('*').eq('id', challengeId).maybeSingle();
  if (!ch) return { fail: { error: 'Challenge not found' } };
  if (ch.created_by === userId) return { challenge: ch };
  if (ch.club_id) {
    const { data: mgr } = await supabaseAdmin
      .from('memberships').select('role')
      .eq('club_id', ch.club_id).eq('user_id', userId)
      .in('role', ['admin', 'coach']).maybeSingle();
    if (mgr) return { challenge: ch };
  }
  if (ch.visibility === 'private' && !ch.club_id) return { fail: { error: 'Challenge not found' } };
  return { fail: { status: 403, error: 'not_authorized' } };
}

// ── CANONICAL CHALLENGE VISIBILITY ──────────────────────────────────────────
// THE single "may this user see this challenge?" rule. Visibility wins over
// club scope (clubs can run open challenges — Discover already lists public
// club challenges platform-wide), private is enforced:
//   • visibility='public'            → any authenticated user
//   • creator or current participant → yes
//   • private + club_id              → member of that club (any role)
//   • private solo                   → holder of a challenge_invites row
//     (rows are retained-on-accept, so leave-and-rejoin keeps access; rows on
//     ended challenges still grant VIEW — completed contests stay readable)
// Any lookup failure DENIES — obscurity is not authorization. Callers must
// answer a denial with the byte-identical "Challenge not found" body they use
// for a nonexistent id (no existence oracle).
async function canUserSeeChallenge(userId, ch) {
  if (!supabaseAdmin || !ch || !userId) return false;
  if (ch.visibility === 'public') return true;
  if (ch.created_by === userId) return true;
  try {
    const { data: part, error: pErr } = await supabaseAdmin
      .from('challenge_participants').select('challenge_id')
      .eq('challenge_id', ch.id).eq('user_id', userId).maybeSingle();
    if (!pErr && part) return true;
  } catch (e) { /* fall through to the remaining grants */ }
  if (ch.club_id) {
    try {
      const { data: mem, error: mErr } = await supabaseAdmin
        .from('memberships').select('role')
        .eq('club_id', ch.club_id).eq('user_id', userId).maybeSingle();
      return !mErr && !!mem;
    } catch (e) { return false; }
  }
  try {
    const { data: inv, error: invErr } = await supabaseAdmin
      .from('challenge_invites').select('challenge_id')
      .eq('challenge_id', ch.id).eq('invitee_id', userId).maybeSingle();
    return !invErr && !!inv;
  } catch (e) { return false; }
}

// TWO DISTINCT "done" CONCEPTS — never conflate them again:
//   • challengeHasEnded(ch)  — CHALLENGE-LEVEL: end_date has passed. This is
//     the ONLY notion authorization may consult (edit lock, end-early
//     refusal). It is the same for every user.
//   • per-viewer completion (`isComplete` in GET /api/challenges enrichment,
//     a.k.a. viewerHasCompleted) — DISPLAY ONLY: derived from the requesting
//     user's own activities (Completed tab, cards, badges, progress). A
//     creator who personally hits the goal early must still be able to edit
//     and end a challenge that is live for everyone else; a creator with no
//     activities gets no extra edit rights on a genuinely expired one.
// The edit-lock rationale (extending end_date resurrecting a Completed
// challenge) is fully served by the challenge-level check, since end_date is
// the only extendable field.
const challengeStarted = (ch) => new Date(ch.start_date).getTime() <= Date.now();
// Ended = the end DAY is fully over, compared as day keys — the same boundary
// family the progress window uses (which admits activities dated on the end
// day). The old raw `new Date(end_date) < now` flipped "Ended" at the START
// of the end day, while end-day activities still counted. Authorization
// callers use the UTC day key (challenge-level, identical for every user);
// display paths may pass a viewer zone so the badge flips at the viewer's
// own midnight.
const challengeHasEnded = (ch, tz) =>
  dayKey(new Date().toISOString(), tz || 'UTC') > dayKey(ch.end_date, 'UTC');

// Grandfather existing non-creator participants when a solo challenge goes
// public→private: mint invite rows so the private join gate recognizes them —
// they stay in, AND can leave and rejoin later. Rows are retained-on-accept by
// design, so upsert-ignore is idempotent. No notifications: participants are
// already in (pending = row ∧ ¬participant stays false — no dead pills).
// Returns { error } — MUST-BLOCK for callers: if these invite rows are not
// minted, existing non-creator participants of a now-private challenge lose
// access (the zero-leak rule hands them "Challenge not found"). Callers revert
// the visibility flip and fail the route rather than strand participants.
async function mintGrandfatherInvites(ch) {
  if (ch.club_id) return {}; // club visibility is governed by membership, not invites
  const { data: parts, error: pErr } = await supabaseAdmin
    .from('challenge_participants').select('user_id').eq('challenge_id', ch.id);
  if (pErr) return { error: pErr };
  const rows = (parts || [])
    .filter((p) => p.user_id !== ch.created_by)
    .map((p) => ({ challenge_id: ch.id, invitee_id: p.user_id, inviter_id: ch.created_by }));
  if (!rows.length) return {};
  const { error } = await supabaseAdmin.from('challenge_invites')
    .upsert(rows, { onConflict: 'challenge_id,invitee_id', ignoreDuplicates: true });
  return { error };
}

// Mint-FIRST wrapper for the two public→private flips above the grandfather
// rule: invites are minted while the challenge is STILL PUBLIC, so a failure
// at either step can never strand participants — a failed mint aborts before
// any visibility change, and a failed flip leaves the challenge public with
// harmless extra invite rows (they only grant access the public state already
// implies). No compensating write exists, so there is no revert to fail.
// Returns true when the caller may proceed to flip visibility.
async function mintGrandfatherOrFail(res, ch, label) {
  const { error: gfErr } = await mintGrandfatherInvites(ch);
  if (!gfErr) return true;
  console.error('%s: grandfather-invite mint failed (challenge %s) — aborting BEFORE the visibility flip, challenge stays public:', label, ch.id, gfErr.message);
  res.status(500).json({ error: 'Could not update the challenge' });
  return false;
}

// Fan-out to every participant except the actor. Type 'challenge' — the
// notifications panel already renders it, and createNotification enforces the
// recipient's notify_challenges pref at creation time.
async function notifyChallengeParticipants(ch, actorUser, title, body) {
  const { data: parts } = await supabaseAdmin
    .from('challenge_participants').select('user_id').eq('challenge_id', ch.id);
  const targets = [...new Set((parts || []).map((p) => p.user_id))]
    .filter((id) => id !== actorUser.id);
  for (const userId of targets) {
    await createNotification({
      userId, type: 'challenge', title, body,
      link: '/challenges', actorId: actorUser.id, entityId: ch.id
    });
  }
}

// Edit a challenge. Field whitelist keyed on start_date, enforced HERE (never
// just hidden in the UI): before start every field is editable; after start
// ONLY title/description — any material key in the body is rejected outright.
// Fully locked once derived-done (extending end_date would resurrect a
// Completed challenge and corrupt the honest Completed count).
// Visibility here is pre-start only; the post-start accidental-public escape
// hatch is the separate one-directional /remove-from-discover route below.
app.patch(BASE + '/api/challenges/:id', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for challenges' });
  const { challenge, fail } = await requireChallengeEditor(req.params.id, req.user.id);
  if (fail) return res.status(fail.status || 200).json({ error: fail.error });
  if (challengeHasEnded(challenge)) return res.json({ error: 'challenge_ended' });

  const b = req.body || {};
  const MATERIAL = ['sport', 'goal_type', 'goal_target', 'goal_unit', 'start_date', 'end_date', 'visibility'];
  const started = challengeStarted(challenge);
  if (started) {
    const locked = MATERIAL.filter((k) => k in b);
    if (locked.length) return res.json({ error: 'field_locked', fields: locked });
  }

  const updates = {};
  if ('title' in b) {
    const t = String(b.title || '').trim();
    if (!t) return res.json({ error: 'Title is required' });
    updates.title = t;
  }
  if ('description' in b) updates.description = b.description ? String(b.description) : null;
  if (!started) {
    if ('sport' in b) updates.sport = b.sport || 'any';
    if ('goal_type' in b) {
      if (!CHALLENGE_GOAL_TYPES.includes(b.goal_type)) {
        return res.json({ error: 'Invalid goal type' });
      }
      updates.goal_type = b.goal_type;
    }
    if ('goal_target' in b) {
      const n = Number(b.goal_target);
      if (!(n > 0)) return res.json({ error: 'Goal target must be a positive number' });
      updates.goal_target = n;
    }
    if ('goal_unit' in b) updates.goal_unit = b.goal_unit || null;
    if ('start_date' in b || 'end_date' in b) {
      const s = new Date('start_date' in b ? b.start_date : challenge.start_date);
      const e = new Date('end_date' in b ? b.end_date : challenge.end_date);
      if (isNaN(s.getTime()) || isNaN(e.getTime())) return res.json({ error: 'Invalid dates' });
      if (e <= s) return res.json({ error: 'End date must be after start date' });
      if ('start_date' in b) updates.start_date = s.toISOString();
      if ('end_date' in b) updates.end_date = e.toISOString();
    }
    if ('visibility' in b) {
      if (!['public', 'private'].includes(b.visibility)) return res.json({ error: 'Invalid visibility' });
      updates.visibility = b.visibility;
    }
  }
  if (!Object.keys(updates).length) return res.json({ error: 'Nothing to update' });

  const materialChanged = MATERIAL.filter(
    (k) => k in updates && String(updates[k]) !== String(challenge[k] ?? ''));
  // Mint-first: grandfather invites are written BEFORE the visibility flip
  // (see mintGrandfatherOrFail), so no failure ordering can strand
  // participants of a going-private challenge.
  if (challenge.visibility === 'public' && updates.visibility === 'private') {
    if (!(await mintGrandfatherOrFail(res, challenge, 'Challenge edit'))) return;
  }
  const { data: updated, error } = await supabaseAdmin
    .from('challenges').update(updates).eq('id', challenge.id).select().single();
  if (error) return res.json({ error: error.message });
  // Material pre-start edits notify OTHER participants (if any exist);
  // title/description edits notify nobody. That is the complete fan-out set.
  if (materialChanged.length) {
    await notifyChallengeParticipants(updated, req.user, 'Challenge updated',
      `${displayFromUser(req.user).name} changed the details of “${updated.title}”.`);
  }
  res.json({ success: true, challenge: challengePublicRow(updated) });
});

// End a challenge early: set end_date to 24h ago so the derived Completed
// state (isExpired) flips everywhere at once — no status column exists.
// Standings are NOT frozen: they remain live-recomputed from activities as of
// the new end date (no rank snapshot exists; UI copy must never claim
// "final" or "preserved" standings).
app.post(BASE + '/api/challenges/:id/end-early', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for challenges' });
  const { challenge, fail } = await requireChallengeEditor(req.params.id, req.user.id);
  if (fail) return res.status(fail.status || 200).json({ error: fail.error });
  if (challengeHasEnded(challenge)) return res.json({ error: 'already_ended' });
  if (!challengeStarted(challenge)) return res.json({ error: 'not_started' }); // pre-start: edit dates or delete instead — an end<start row would be nonsense
  const newEnd = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: updated, error } = await supabaseAdmin
    .from('challenges').update({ end_date: newEnd }).eq('id', challenge.id).select().single();
  if (error) return res.json({ error: error.message });
  await notifyChallengeParticipants(updated, req.user, 'Challenge ended early',
    `${displayFromUser(req.user).name} ended “${updated.title}” early. Standings are as of the end date, recomputed from activities.`);
  res.json({ success: true, challenge: challengePublicRow(updated) });
});

// One-directional public→private escape hatch — THE accidental-public fix.
// Deliberately a distinct route, NOT general visibility editing: it works at
// any time (including after start, where PATCH locks visibility), only ever
// goes public→private, and grandfathers current participants via minted
// invite rows. private→public after start stays impossible.
app.post(BASE + '/api/challenges/:id/remove-from-discover', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for challenges' });
  const { challenge, fail } = await requireChallengeEditor(req.params.id, req.user.id);
  if (fail) return res.status(fail.status || 200).json({ error: fail.error });
  if (challenge.visibility !== 'public') return res.json({ error: 'already_private' });
  // Mint-first (see mintGrandfatherOrFail): a failed mint aborts while still
  // public; a failed flip leaves harmless invite rows on a public challenge.
  if (!(await mintGrandfatherOrFail(res, challenge, 'Remove-from-discover'))) return;
  const { data: updated, error } = await supabaseAdmin
    .from('challenges').update({ visibility: 'private' }).eq('id', challenge.id).select().single();
  if (error) return res.json({ error: error.message });
  res.json({ success: true, challenge: challengePublicRow(updated) });
});

// Delete a challenge — branches on ALONENESS, not doneness: hard delete only
// when the creator is alone (no other participants AND no derived-pending
// invites), regardless of expired/complete state. Anyone else involved →
// refused server-side ('not_alone'); the UI then offers End early / Remove
// from Discover. Authorization: creator OR club manager (this route used to
// be club-manager-only, which left solo creators with no delete path).
// Cascade: participants deleted in code, invites via DB FK cascade,
// notifications orphan into the existing muted 'gone' degradation.
app.delete(BASE + '/api/challenges/:id', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for challenges' });
  const { challenge, fail } = await requireChallengeEditor(req.params.id, req.user.id);
  if (fail) return res.status(fail.status || 200).json({ error: fail.error });
  const { data: parts } = await supabaseAdmin
    .from('challenge_participants').select('user_id, challenge_id').eq('challenge_id', challenge.id);
  const others = (parts || []).filter((p) => p.user_id !== challenge.created_by);
  const { data: inviteRows } = await supabaseAdmin
    .from('challenge_invites').select('challenge_id, invitee_id').eq('challenge_id', challenge.id);
  const pending = pendingInvites(inviteRows || [], parts || []);
  if (others.length || pending.length) {
    return res.json({ error: 'not_alone', participants: others.length, pendingInvites: pending.length });
  }
  await supabaseAdmin.from('challenge_participants').delete().eq('challenge_id', challenge.id);
  const { error } = await supabaseAdmin.from('challenges').delete().eq('id', challenge.id);
  if (error) return res.json({ error: error.message });
  // Rows first, storage object second — best-effort, never blocking.
  await deleteChallengeImageObject(challenge.image_path, challenge.id);
  res.json({ success: true });
});

// Root: send new visitors to the landing page, logged-in users to their feed.
app.get(BASE === '' ? '/' : BASE, async (req, res) => {
  const token = req.signedCookies && req.signedCookies.sb_access_token;
  if (!token) return res.redirect(BASE + '/landing');
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data || !data.user) return res.redirect(BASE + '/landing');
    // Same policy as the login redirect: everyone lands on the athlete feed
    // (no manager special-case — it teleported multi-club managers to the
    // most recently created club's dashboard).
    return res.redirect(BASE + '/feed');
  } catch (err) {
    return res.redirect(BASE + '/landing');
  }
});

// Build an enriched, render-ready list of recent posts for server-side feed
// injection. Author names come from auth user metadata (there is no `profiles`
// table), and userLiked reflects whether the current viewer liked each post.
async function buildFeedPosts(limit, currentUserId) {
  if (!supabaseAdmin) return { posts: [], followsNobody: false };

  // Only show posts from people the viewer follows, plus their own posts. If
  // the follows lookup fails, fall back to a self-only feed rather than 500.
  let followingIds = [];
  let followLookupOk = false;
  if (currentUserId) {
    const { data: following, error: followErr } = await supabaseAdmin
      .from('follows')
      .select('following_id')
      .eq('follower_id', currentUserId);
    if (followErr) {
      console.log('Follows lookup error:', followErr.message);
    } else if (Array.isArray(following)) {
      followLookupOk = true;
      followingIds = following.map(f => f.following_id).filter(Boolean);
    }
  }
  // Only show the empty-state nudge when we actually confirmed zero follows —
  // not when the lookup failed and we fell back to a self-only feed.
  const followsNobody = followLookupOk && followingIds.length === 0;
  const feedUserIds = [...new Set([...followingIds, currentUserId].filter(Boolean))];
  if (!feedUserIds.length) return { posts: [], followsNobody };

  // Two eligible sets, merged newest-first:
  //   1. PERSONAL posts (club_id IS NULL) from followed authors + self.
  //   2. Club ANNOUNCEMENTS from clubs the VIEWER belongs to — club-owned
  //      speech is scoped by the viewer's membership, never by following the
  //      author. A non-member following a coach must NOT receive club
  //      announcements through /feed.
  const { data: myClubRows } = await supabaseAdmin
    .from('memberships')
    .select('club_id, role')
    .eq('user_id', currentUserId || '00000000-0000-0000-0000-000000000000');
  const myClubIds = [...new Set((myClubRows || []).map((m) => m.club_id).filter(Boolean))];
  const managedClubIds = new Set((myClubRows || [])
    .filter((m) => m.role === 'admin' || m.role === 'coach')
    .map((m) => m.club_id));
  const [personalRes, annRes] = await Promise.all([
    supabaseAdmin
      .from('posts')
      .select('id, content, sport, feeling, image_url, created_at, user_id, club_id, post_likes (count), post_comments (count)')
      .is('club_id', null)
      .in('user_id', feedUserIds)
      .order('created_at', { ascending: false })
      .limit(limit),
    myClubIds.length
      ? supabaseAdmin
          .from('posts')
          .select('id, content, sport, feeling, image_url, created_at, user_id, club_id, post_likes (count), post_comments (count)')
          .in('club_id', myClubIds)
          .order('created_at', { ascending: false })
          .limit(limit)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (personalRes.error || !personalRes.data) return { posts: [], followsNobody };
  const posts = [...personalRes.data, ...((annRes && annRes.data) || [])]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);
  const ids = [...new Set(posts.map(p => p.user_id).filter(Boolean))];
  const profileMap = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
      const user = u && u.user;
      // displayFromUser (not a hand-rolled subset) so the entry carries
      // profilePublic — the flag the feed forwards as authorProfilePublic.
      if (user) profileMap[id] = displayFromUser(user);
    } catch (err) {
      // Ignore individual lookup failures; the card falls back to defaults.
    }
  }));
  let likedSet = new Set();
  if (currentUserId && posts.length) {
    const { data: myLikes } = await supabaseAdmin
      .from('post_likes')
      .select('post_id')
      .eq('user_id', currentUserId)
      .in('post_id', posts.map(p => p.id));
    likedSet = new Set((myLikes || []).map(l => l.post_id));
  }
  // Club identity for announcements (posts carrying a club_id): logo + name
  // render as the primary identity, author demotes to "posted by".
  const clubIds = [...new Set(posts.map(p => p.club_id).filter(Boolean))];
  const clubMap = {};
  if (clubIds.length) {
    const { data: clubRows } = await supabaseAdmin
      .from('clubs').select('id, name, sport, logo_url').in('id', clubIds);
    (clubRows || []).forEach((c) => { clubMap[c.id] = c; });
  }
  const enriched = posts.map(p => ({
    id: p.id,
    content: p.content,
    sport: p.sport,
    feeling: p.feeling,
    image_url: p.image_url || null,
    created_at: p.created_at,
    user_id: p.user_id,
    authorName: (profileMap[p.user_id] && profileMap[p.user_id].name) || 'Athlete',
    authorHandle: (profileMap[p.user_id] && profileMap[p.user_id].handle) || 'athlete',
    authorAvatarUrl: (profileMap[p.user_id] && profileMap[p.user_id].avatar_url) || null,
    // Absent lookup → treat as linkable; the profile route is the real gate.
    authorProfilePublic: profileMap[p.user_id] ? profileMap[p.user_id].profilePublic !== false : true,
    clubId: p.club_id || null,
    canDelete: !!(p.club_id && managedClubIds.has(p.club_id)),
    clubName: (p.club_id && clubMap[p.club_id] && clubMap[p.club_id].name) || null,
    clubLogoUrl: (p.club_id && clubMap[p.club_id] && clubMap[p.club_id].logo_url) || null,
    clubSport: (p.club_id && clubMap[p.club_id] && clubMap[p.club_id].sport) || null,
    likeCount: (p.post_likes && p.post_likes[0] && p.post_likes[0].count) || 0,
    commentCount: (p.post_comments && p.post_comments[0] && p.post_comments[0].count) || 0,
    userLiked: likedSet.has(p.id)
  }));
  return { posts: enriched, followsNobody };
}

// Feed requires authentication; unauthenticated visitors are sent to landing.
// Inject the logged-in user's real name/handle plus recent posts so the feed
// shows live data instead of the hardcoded "Jamie King" placeholder.
// Viewer's real club memberships for the sidebar "My clubs" section, shared by
// every athlete-facing page so the sidebar is identical everywhere. There is no
// `status` column on `memberships` — every row is an active membership, ordered
// by `created_at`.
async function getSidebarClubs(userId) {
  if (!supabaseAdmin || !userId) return [];
  try {
    const { data } = await supabaseAdmin
      .from('memberships')
      .select('role, clubs:club_id (id, name, handle, sport, logo_url)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    const clubs = (data || []).map(m => {
      const c = Array.isArray(m.clubs) ? m.clubs[0] : m.clubs;
      return c ? Object.assign({}, c, { role: m.role }) : null;
    }).filter(Boolean);
    // Additive plan field for the sidebar PRO badge: resolved server-side from
    // the real subscription (getClubPlan — deliberately independent of the
    // CLUB_PLAN_GATES_ENABLED flag, same rule as the individual PRO badge).
    // Free clubs' objects stay untouched (no field), so their rendered rows
    // carry zero badge markup and the client never guesses.
    await Promise.all(clubs.map(async c => {
      if ((await getClubPlan(c.id)) === 'club_pro') c.plan = 'club_pro';
    }));
    return clubs;
  } catch (e) {
    return [];
  }
}

// Right-rail sidebar data for the feed page: this-week distance + day strip,
// current streak, this-week club rank, and follow suggestions. Every value is
// real (no fabricated content); the widgets fall back to honest empty/low-data
// states client-side when these are zero/empty.
async function buildFeedSidebar(userId, tz) {
  const sidebar = { week: { activities: 0, km: 0 }, dayStrip: [], currentStreak: 0, clubRank: null, followSuggestions: [] };
  if (!supabaseAdmin || !userId) return sidebar;
  try {
    // Week bounds — Monday 00:00 in the VIEWER'S zone (matches
    // /api/profile/overview). Key comparisons bucket activities; the exact
    // local-midnight instant below also scopes the club-rank query so the
    // rank and the km above it always describe the same period.
    const now = new Date();
    const viewerTz = tz || 'UTC';
    const weekStartK = weekStartKey(now, viewerTz);
    const weekStartInstant = zoneMidnightUtc(weekStartK, viewerTz);
    const todayIdx = dateParts(now, viewerTz).weekday - 1;

    // One query for the user's own activities → weekly km, day strip, streak.
    const { data: allActs } = await supabaseAdmin
      .from('activities')
      .select('sport, distance, date')
      .eq('user_id', userId);
    const acts = allActs || [];
    const weekActs = acts.filter(a => dayKey(a.date, viewerTz) >= weekStartK);
    const weekKm = Math.round(weekActs.reduce((s, a) => s + parseDistanceKmUnitAware(a.distance), 0) * 10) / 10;
    sidebar.week = { activities: weekActs.length, km: weekKm };

    // Day strip — which weekdays (Mon=0) had activity this week (viewer zone).
    const activeDaySet = new Set(weekActs.map(a => {
      const p = dateParts(a.date, viewerTz);
      return p ? p.weekday - 1 : -1;
    }));
    const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    sidebar.dayStrip = dayLabels.map((label, i) => ({
      label,
      name: dayNames[i],
      state: activeDaySet.has(i) ? 'active'
        : i === todayIdx ? 'today'
        : i < todayIdx ? 'rest'
        : 'future'
    }));

    // Current streak — consecutive active days (viewer zone) ending today or
    // yesterday (shared helper).
    sidebar.currentStreak = computeStreaks(acts, viewerTz).currentStreak;

    // This-week club rank — viewer's most recent club, ranked by week points.
    // A rank number needs no names, so we skip the per-member metadata lookups.
    const { data: membership } = await supabaseAdmin
      .from('memberships')
      .select('club_id, clubs:club_id (name)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (membership && membership.club_id) {
      const club = Array.isArray(membership.clubs) ? membership.clubs[0] : membership.clubs;
      const { data: members } = await supabaseAdmin
        .from('memberships').select('user_id').eq('club_id', membership.club_id);
      const allMemberIds = [...new Set((members || []).map(m => m.user_id).filter(Boolean))];
      // Leaderboard opt-outs leave the ranking pool here too (this widget IS a
      // club ranking). Metadata lookups are now required for the prefs — the
      // sets are club-sized, so per-member lookups stay acceptable. An
      // opted-out VIEWER gets no rank widget at all (idx === -1 below).
      const memberProfiles = await buildUserProfileMap(allMemberIds);
      const memberIds = allMemberIds.filter((id) => !(memberProfiles[id] && memberProfiles[id].prefs && !memberProfiles[id].prefs.show_on_leaderboards));
      if (memberIds.length) {
        // Rank by points earned since the same viewer-zone Monday-midnight
        // instant used for the viewer's "this week" km — NOT the rolling-7-day
        // leaderboard window, so the rank and the distance above it always
        // describe the same period. (Per-member zones are a rollup concern —
        // one consistent window per widget for now.)
        const { data: memberActs } = await supabaseAdmin
          .from('activities')
          .select('user_id, sport, distance, date')
          .in('user_id', memberIds)
          .gte('date', weekStartInstant.toISOString());
        const byUser = bucketActivities(memberActs || []);
        const ranked = memberIds
          .map(id => ({ id, points: calculatePoints(byUser[id] || []) }))
          .sort((a, b) => b.points - a.points);
        const idx = ranked.findIndex(r => r.id === userId);
        if (idx >= 0) sidebar.clubRank = { rank: idx + 1, total: ranked.length, clubName: (club && club.name) || 'your club' };
      }
    }

    // Follow suggestions — hybrid: club-mates the viewer doesn't follow first,
    // then other real users not yet followed. Excludes self + already-followed.
    const { data: following } = await supabaseAdmin
      .from('follows').select('following_id').eq('follower_id', userId);
    const followingIds = new Set((following || []).map(f => f.following_id).filter(Boolean));
    const { data: myMems } = await supabaseAdmin
      .from('memberships').select('club_id').eq('user_id', userId);
    const myClubIds = [...new Set((myMems || []).map(m => m.club_id).filter(Boolean))];
    let clubMateIds = new Set();
    if (myClubIds.length) {
      const { data: mates } = await supabaseAdmin
        .from('memberships').select('user_id').in('club_id', myClubIds);
      clubMateIds = new Set((mates || []).map(m => m.user_id).filter(Boolean));
    }
    const allUsers = await listAllAuthUsers();
    const candidates = allUsers
      .filter(u => u.id !== userId && !followingIds.has(u.id))
      .sort((a, b) => (clubMateIds.has(a.id) ? 0 : 1) - (clubMateIds.has(b.id) ? 0 : 1));
    sidebar.followSuggestions = candidates.slice(0, 3).map(u => {
      const meta = u.user_metadata || {};
      const disp = displayFromUser(u);
      const initials = (disp.name || 'A').split(/\s+/).map(n => n[0]).join('').slice(0, 2).toUpperCase();
      const metaBits = [];
      if (Array.isArray(meta.sports) && meta.sports.length) {
        const sport = meta.sports[0];
        metaBits.push(sport.charAt(0).toUpperCase() + sport.slice(1));
      }
      if (meta.location) metaBits.push(meta.location);
      if (clubMateIds.has(u.id)) metaBits.push('Club-mate');
      return { id: u.id, name: disp.name, initials, avatar_url: disp.avatar_url || null, meta: metaBits.join(' · ') };
    });
  } catch (err) {
    console.log('Feed sidebar error:', err.message);
  }
  return sidebar;
}

app.get(BASE + '/feed', requirePageAuth, async (req, res) => {
  try {
    const { posts, followsNobody } = await buildFeedPosts(20, req.user.id);
    const feedActivities = await buildFeedActivities(10, req.user.id);
    const followingRsvps = await buildFeedRsvps(req.user.id);
    // Viewer's real club memberships for the sidebar "My clubs" section — shared
    // helper so every athlete-facing page shows the exact same clubs.
    const userClubs = await getSidebarClubs(req.user.id);
    // Real right-rail widget data (weekly km, streak, club rank, follow suggestions).
    const sidebar = await buildFeedSidebar(req.user.id, getUserTimezone(req.user));
    // The viewer's profile sports (user_metadata) drive the feed's sport
    // filter pills + composer chips — pages fall back to a curated set when
    // the user hasn't picked sports yet.
    const feedMeta = req.user.user_metadata || {};
    const userSports = Array.isArray(feedMeta.sports) ? feedMeta.sports.filter(Boolean) : [];
    const userData = { profile: displayFromUser(req.user), userId: req.user.id, sports: userSports, posts, followsNobody, feedActivities, followingRsvps, clubs: userClubs, week: sidebar.week, dayStrip: sidebar.dayStrip, currentStreak: sidebar.currentStreak, clubRank: sidebar.clubRank, followSuggestions: sidebar.followSuggestions };
    const html = injectProBadge(injectBottomNav(injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-feed.html'), 'utf8'), userData), 'feed'), (await getUserPlan(req.user.id)) === 'pro');
    res.type('html').send(html);
  } catch (err) {
    console.log('Feed data error:', err.message);
    sendPageError(res);
  }
});
// Athletes directory. Lists real signed-up users (resolved from auth metadata,
// since this project has no usable `profiles` table) with follower/post counts
// and the viewer's follow status, so the page shows the live community instead
// of the hardcoded demo athletes.
// Shared athlete-directory builder: the /athletes page and the my-profile
// "Athletes" tab (GET /api/athletes/directory) render the same cards through
// arenas-athlete-cards.js — ONE builder so the two surfaces can never drift
// on shape or content.
async function buildAthleteDirectory(viewerId) {
  if (!supabaseAdmin) return { athletes: [], followingIds: [] };
  // Pull all users via the admin API and drop the viewer themselves.
  const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 100 });
  const others = ((list && list.users) || [])
    .filter(u => u.id !== viewerId)
    // Leaderboard opt-out = undiscoverable: excluded from the directory (and
    // the /athletes/:userId profile page 404s for them — same boundary).
    .filter(u => prefsFromMeta(u.user_metadata || {}).show_on_leaderboards)
    .slice(0, 50);
  const athleteIds = others.map(u => u.id);

  // Who the viewer already follows.
  const { data: following } = await supabaseAdmin
    .from('follows')
    .select('following_id')
    .eq('follower_id', viewerId);
  const followingIds = (following || []).map(f => f.following_id).filter(Boolean);

  // Post and follower counts for the listed athletes (one query each).
  let postRows = [];
  let followerRows = [];
  if (athleteIds.length) {
    const [pc, fc] = await Promise.all([
      supabaseAdmin.from('posts').select('user_id').in('user_id', athleteIds),
      supabaseAdmin.from('follows').select('following_id').in('following_id', athleteIds)
    ]);
    postRows = pc.data || [];
    followerRows = fc.data || [];
  }

  const athletes = others.map(u => {
    const meta = u.user_metadata || {};
    const disp = displayFromUser(u);
    const initials = (disp.name || 'A')
      .split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    return {
      id: u.id,
      name: disp.name,
      handle: disp.handle,
      avatar_url: disp.avatar_url || null,
      banner_url: meta.banner_url || null,
      bio: meta.bio || null,
      location: meta.location || null,
      // Structured place for the client-side search text (country/state
      // display names + state code all match; cards still render city-only).
      country: disp.country,
      countryName: disp.countryName,
      state: disp.state,
      stateName: disp.stateName,
      sports: Array.isArray(meta.sports) ? meta.sports : [],
      level: meta.level || null,
      initials,
      createdAt: u.created_at || null,
      postCount: postRows.filter(p => p.user_id === u.id).length,
      followerCount: followerRows.filter(f => f.following_id === u.id).length,
      isFollowing: followingIds.includes(u.id)
    };
  });
  return { athletes, followingIds };
}

// Directory feed for the my-profile "Athletes" tab (lazy-loaded on first
// open). Same builder as the /athletes page above.
app.get(BASE + '/api/athletes/directory', requireAuth, async (req, res) => {
  try {
    const dir = await buildAthleteDirectory(req.user.id);
    res.json({ athletes: dir.athletes });
  } catch (err) {
    console.log('Athlete directory error:', err.message);
    res.status(500).json({ error: 'Could not load athletes' });
  }
});

app.get(BASE + '/athletes', requirePageAuth, async (req, res) => {
  let athleteData = {
    athletes: [],
    profile: displayFromUser(req.user),
    userId: req.user.id,
    followingIds: [],
    clubs: []
  };
  try {
    if (supabaseAdmin) {
      const dir = await buildAthleteDirectory(req.user.id);
      athleteData = {
        athletes: dir.athletes,
        profile: displayFromUser(req.user),
        userId: req.user.id,
        followingIds: dir.followingIds,
        clubs: await getSidebarClubs(req.user.id)
      };
    }
  } catch (err) {
    console.log('Athletes data error:', err.message);
  }
  try {
    const html = injectProBadge(injectBottomNav(injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-athletes.html'), 'utf8'), athleteData), 'athletes'), (await getUserPlan(req.user.id)) === 'pro');
    res.type('html').send(html);
  } catch (err) {
    console.log('Athletes render error:', err.message);
    sendPageError(res);
  }
});
// ── PUBLIC ATHLETE PROFILE ──────────────────────────────────────────────────
// /athletes/:userId — the page one athlete visits to see another's profile.
// Access rules (all enforced HERE, never client-side):
//   - Zero-leak: a nonexistent id, a deleted account and a leaderboard
//     opt-out (show_on_leaderboards=false — the toggle that already removes
//     the athlete from the directory, i.e. from every path to this page) all
//     return the byte-identical 404 below. One constant, one send path.
//   - activity_feed_visible=false hides the activity sections AND every
//     activity-derived stat (totals/streak/breakdown). Identity, trophy
//     case, public clubs and follow counts still render — same boundary as
//     the followers' feed rule that toggle already governs.
//   - Private club memberships are NEVER included (visibility='public'
//     only) — listing one would breach the club directory's zero-leak
//     guarantee.
//   - No PRs, no progress toward unearned badges, no Pro-gated computation.
const ATHLETE_NOT_FOUND_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Arenas — Athlete not found</title><link rel="icon" href="/html/arenas-icon.svg" type="image/svg+xml">
<style>body{font-family:'Source Sans 3',-apple-system,sans-serif;background:#F8F9FA;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{text-align:center;padding:48px 32px}.box .ic{font-size:44px;margin-bottom:14px}
.box h1{font-size:19px;font-weight:700;color:#111827;margin:0 0 8px}
.box p{font-size:14px;color:#6B7280;margin:0 0 20px}
.box a{display:inline-block;background:#FFD21E;color:#111827;font-weight:600;font-size:13px;padding:9px 22px;border-radius:8px;text-decoration:none}</style></head>
<body><div class="box"><div class="ic">👤</div><h1>Athlete not found</h1>
<p>This profile does not exist or is not available.</p>
<a href="javascript:void(0)" onclick="location.href=(location.pathname.indexOf('/html')===0?'/html':'')+'/athletes'">Browse athletes</a></div></body></html>`;
function sendAthleteNotFound(res) {
  res.status(404).set('Cache-Control', 'no-store').type('html').send(ATHLETE_NOT_FOUND_HTML);
}

// Public (visitor-safe) stats — deliberately SEPARATE from the Pro-gated
// /api/profile/stats computation so that route's gate decision never leaks
// onto a viewer. Shares the canonical underlying helpers with it rather
// than reimplementing them: parseDistanceKmUnitAware (the one unit-aware km
// parser) and computeStreaks (tzdate.js), with day-math in the ATHLETE's
// zone (owner-bucket boundary policy). All-time only; no windows, no
// points, no PRs.
function computePublicAthleteStats(acts, tz) {
  const totalKm = Math.round(acts.reduce((s, a) => s + parseDistanceKmUnitAware(a.distance), 0) * 10) / 10;
  const { currentStreak } = computeStreaks(acts, tz);
  const bySport = {};
  for (const a of acts) {
    if (!a.sport) continue;
    if (!bySport[a.sport]) bySport[a.sport] = { sessions: 0, hours: 0 };
    bySport[a.sport].sessions += 1;
    // Same canonical parser + same tenths rounding as the owner's
    // /api/profile/stats sportBreakdown, so the two surfaces cannot disagree.
    bySport[a.sport].hours += parseDurationHours(a.duration);
  }
  const sportsBreakdown = Object.keys(bySport)
    .map((sport) => ({ sport, sessions: bySport[sport].sessions, hours: Math.round(bySport[sport].hours * 10) / 10 }))
    .sort((x, y) => y.sessions - x.sessions);
  return { totalActivities: acts.length, totalKm, currentStreak, sportsBreakdown };
}

app.get(BASE + '/athletes/:userId', requirePageAuth, async (req, res) => {
  try {
    if (!supabaseAdmin) return sendPageError(res);
    const targetId = req.params.userId;
    // Your own profile lives at /profile (owner chrome, edit affordances).
    if (targetId === req.user.id) return res.redirect(BASE + '/profile');

    let target = null;
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(targetId);
      target = (data && data.user) || null;
    } catch (err) { target = null; }
    // Nonexistent / malformed id / deleted account → identical not-found.
    if (!target) return sendAthleteNotFound(res);
    const targetPrefs = prefsFromMeta(target.user_metadata || {});
    // Leaderboard opt-out = undiscoverable everywhere, including here.
    if (!targetPrefs.show_on_leaderboards) return sendAthleteNotFound(res);

    const meta = target.user_metadata || {};
    const tDisp = displayFromUser(target);
    const feedVisible = targetPrefs.activity_feed_visible;
    const targetTz = getUserTimezone(target);

    const [followerRes, followingRes, isFollowingRes, followEdgesRes, achRes, memberRes, actsRes] = await Promise.all([
      supabaseAdmin.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', targetId),
      supabaseAdmin.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', targetId),
      supabaseAdmin.from('follows').select('follower_id').eq('follower_id', req.user.id).eq('following_id', targetId).limit(1),
      supabaseAdmin.from('follows').select('following_id').eq('follower_id', targetId).limit(60),
      // User-provisioned table — degrade to no badges on error, never break.
      supabaseAdmin.from('achievements').select('badge_id, earned_at').eq('user_id', targetId).order('earned_at', { ascending: false }),
      supabaseAdmin.from('memberships').select('clubs:club_id (id, name, sport, city, logo_url, visibility)').eq('user_id', targetId),
      // Activities fetched only when the athlete broadcasts training at all;
      // the private branch never reads the table (nothing to accidentally leak).
      feedVisible
        ? supabaseAdmin.from('activities').select('*').eq('user_id', targetId).order('date', { ascending: false }).limit(1000)
        : Promise.resolve({ data: null })
    ]);

    // Trophy case: EARNED badges only, joined to the server-side catalog.
    // No progress state — that would leak activity volume in the private case.
    const badgeById = {};
    BADGES.forEach((b) => { badgeById[b.id] = b; });
    const badges = ((achRes && achRes.data) || []).map((r) => {
      const b = badgeById[r.badge_id];
      return b ? { id: b.id, cat: b.cat, icon: b.icon, name: b.name, desc: b.desc, earnedAt: r.earned_at } : null;
    }).filter(Boolean);

    // Public clubs only — private memberships are indistinguishable from
    // no membership (same standard as the club directory's zero-leak 404s).
    const athleteClubs = ((memberRes && memberRes.data) || []).map((m) => {
      const c = Array.isArray(m.clubs) ? m.clubs[0] : m.clubs;
      return c && c.visibility === 'public'
        ? { id: c.id, name: c.name, sport: c.sport, city: c.city, logo_url: c.logo_url }
        : null;
    }).filter(Boolean);

    // "Their following" list — every listed person is directory-visible;
    // resolved via auth metadata like the my-profile Following tab.
    const followingIds = ((followEdgesRes && followEdgesRes.data) || []).map((r) => r.following_id).filter(Boolean);
    const fUserMap = {};
    await Promise.all(followingIds.map(async (id) => {
      try {
        const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
        const user = u && u.user;
        if (!user) return;
        const fm = user.user_metadata || {};
        const fd = displayFromUser(user);
        fUserMap[id] = {
          id,
          name: fd.name,
          avatar_url: fd.avatar_url || null,
          location: fm.location || null,
          sports: Array.isArray(fm.sports) ? fm.sports : []
        };
      } catch (err) { /* omitted row */ }
    }));
    const followingList = followingIds.map((id) => fUserMap[id]).filter(Boolean);

    // Activity payloads: scrub ai_insight server-side (same rule as the
    // shared activity-card surfaces — the fake "Coach's note" never ships).
    const acts = feedVisible ? ((actsRes && actsRes.data) || []) : null;
    const cleanActs = feedVisible
      ? acts.slice(0, 30).map((a) => { const c = Object.assign({}, a); delete c.ai_insight; return c; })
      : null;

    // Union of declared sports + sports actually logged (visible case only —
    // in the private case, activity-derived sports would leak training).
    let heroSports = Array.isArray(meta.sports) ? meta.sports.slice() : [];
    if (feedVisible) {
      for (const a of acts) { if (a.sport && !heroSports.includes(a.sport)) heroSports.push(a.sport); }
    }

    const data = {
      userId: req.user.id,
      profile: displayFromUser(req.user),
      clubs: await getSidebarClubs(req.user.id),
      athlete: {
        id: targetId,
        name: tDisp.name,
        avatar_url: tDisp.avatar_url,
        banner_url: meta.banner_url || null,
        bio: meta.bio || '',
        location: tDisp.location,
        countryName: tDisp.countryName,
        stateName: tDisp.stateName,
        sports: heroSports,
        level: meta.level || null,
        memberSince: target.created_at || null,
        pro: (await getUserPlan(targetId)) === 'pro'
      },
      isFollowing: !!(isFollowingRes.data && isFollowingRes.data.length),
      followerCount: followerRes.count || 0,
      followingCount: followingRes.count || 0,
      followingList,
      badges,
      athleteClubs,
      trainingPrivate: !feedVisible,
      stats: feedVisible ? computePublicAthleteStats(acts, targetTz) : null,
      activities: cleanActs
    };

    const html = injectProBadge(
      injectBottomNav(injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-athlete-profile.html'), 'utf8'), data), 'athletes'),
      (await getUserPlan(req.user.id)) === 'pro'
    );
    res.type('html').send(html);
  } catch (err) {
    console.log('Athlete profile error:', err.message);
    sendPageError(res);
  }
});

// ── CLUB DIRECTORY ──────────────────────────────────────────────────────────
// Public-club discovery + request-and-approve join flow.
//   - Only clubs with visibility='public' are EVER listed or reachable through
//     the request endpoints. Private clubs return the byte-identical
//     404 {error:'Club not found'} used for nonexistent ids (zero-leak, same
//     standard as events/challenges).
//   - Decline → 7-day cooldown (server-enforced from resolved_at) before the
//     same user may re-request; re-request reuses the same row (PK club+user).
//   - Club going private deletes its pending requests (checked write).
//   - Direct invite acceptance deletes any pending request for that club/user.
const JOIN_REQUEST_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const CLUB_NOT_FOUND = { error: 'Club not found' };

function joinRequestCooldownUntil(row) {
  if (!row || row.status !== 'declined' || !row.resolved_at) return null;
  const until = new Date(row.resolved_at).getTime() + JOIN_REQUEST_COOLDOWN_MS;
  return until > Date.now() ? new Date(until).toISOString() : null;
}

// Fetch a club ONLY if it is publicly listed. Returns null for both
// "does not exist" and "exists but private" — callers must respond
// identically for the two cases.
async function getPublicClub(clubId) {
  if (!supabaseAdmin || !clubId) return null;
  const { data } = await supabaseAdmin
    .from('clubs')
    .select('id, name, handle, sport, city, logo_url, description, visibility, created_at')
    .eq('id', clubId)
    .eq('visibility', 'public')
    .maybeSingle();
  return data || null;
}

async function buildClubDirectory(viewerId) {
  if (!supabaseAdmin) return { clubs: [] };
  const { data: clubRows, error } = await supabaseAdmin
    .from('clubs')
    .select('id, name, handle, sport, city, logo_url, description, created_at')
    .eq('visibility', 'public')
    .order('name', { ascending: true })
    .limit(100);
  if (error) throw new Error('club directory: ' + error.message);
  const clubs = clubRows || [];
  const clubIds = clubs.map(c => c.id);

  let countRows = [];
  let myMemberships = [];
  let myRequests = [];
  if (clubIds.length) {
    const [mc, mm, mr] = await Promise.all([
      supabaseAdmin.from('memberships').select('club_id').in('club_id', clubIds),
      supabaseAdmin.from('memberships').select('club_id, role').eq('user_id', viewerId).in('club_id', clubIds),
      supabaseAdmin.from('club_join_requests').select('club_id, status, resolved_at').eq('user_id', viewerId).in('club_id', clubIds)
    ]);
    countRows = mc.data || [];
    myMemberships = mm.data || [];
    myRequests = mr.data || [];
  }
  const roleByClub = {};
  for (const m of myMemberships) roleByClub[m.club_id] = m.role;
  const reqByClub = {};
  for (const r of myRequests) reqByClub[r.club_id] = r;

  const out = [];
  for (const c of clubs) {
    const req = reqByClub[c.id] || null;
    const cooldownUntil = joinRequestCooldownUntil(req);
    // Server-decided viewer state — the client renders it, never re-derives.
    let viewerState = 'none';
    if (roleByClub[c.id]) viewerState = 'member';
    else if (req && req.status === 'pending') viewerState = 'pending';
    else if (cooldownUntil) viewerState = 'cooldown';
    out.push({
      id: c.id,
      name: c.name,
      handle: c.handle,
      sport: c.sport,
      city: c.city || null,
      logo_url: c.logo_url || null,
      description: c.description || null,
      createdAt: c.created_at || null,
      memberCount: countRows.filter(m => m.club_id === c.id).length,
      plan: (await getClubPlan(c.id)) === 'club_pro' ? 'club_pro' : undefined,
      viewerState,
      viewerRole: roleByClub[c.id] || null,
      cooldownUntil
    });
  }
  return { clubs: out };
}

app.get(BASE + '/api/clubs/directory', requireAuth, async (req, res) => {
  try {
    const dir = await buildClubDirectory(req.user.id);
    res.json({ clubs: dir.clubs });
  } catch (err) {
    console.log('Club directory error:', err.message);
    res.status(500).json({ error: 'Could not load clubs' });
  }
});

app.get(BASE + '/clubs', requirePageAuth, async (req, res) => {
  let pageData = {
    clubsDirectory: [],
    profile: displayFromUser(req.user),
    userId: req.user.id,
    clubs: []
  };
  try {
    if (supabaseAdmin) {
      const dir = await buildClubDirectory(req.user.id);
      pageData.clubsDirectory = dir.clubs;
      pageData.clubs = await getSidebarClubs(req.user.id);
    }
  } catch (err) {
    console.log('Clubs page data error:', err.message);
  }
  try {
    const html = injectProBadge(injectBottomNav(injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-clubs.html'), 'utf8'), pageData), 'clubs'), (await getUserPlan(req.user.id)) === 'pro');
    res.type('html').send(html);
  } catch (err) {
    console.log('Clubs page render error:', err.message);
    sendPageError(res);
  }
});

// Request to join a public club. Zero-leak: private/nonexistent ids are
// indistinguishable. Re-request reuses the existing row.
app.post(BASE + '/api/clubs/:clubId/join-request', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
  try {
    const club = await getPublicClub(req.params.clubId);
    if (!club) return res.status(404).json(CLUB_NOT_FOUND);

    const existingRole = await getClubRole(req.user.id, club.id);
    if (existingRole) return res.status(409).json({ error: 'already_member' });

    const { data: existing } = await supabaseAdmin
      .from('club_join_requests')
      .select('club_id, user_id, status, resolved_at')
      .eq('club_id', club.id)
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (existing && existing.status === 'pending') {
      return res.status(409).json({ error: 'request_pending' });
    }
    const cooldownUntil = joinRequestCooldownUntil(existing);
    if (cooldownUntil) {
      return res.status(409).json({ error: 'request_cooldown', retryAt: cooldownUntil });
    }

    if (existing) {
      // Declined past cooldown, or a stale 'approved' row after the user left
      // the club — flip the same row back to pending.
      const { error } = await supabaseAdmin
        .from('club_join_requests')
        .update({ status: 'pending', created_at: new Date().toISOString(), resolved_at: null, resolved_by: null })
        .eq('club_id', club.id)
        .eq('user_id', req.user.id);
      if (error) return res.status(500).json({ error: 'Could not send request' });
    } else {
      const { error } = await supabaseAdmin
        .from('club_join_requests')
        .insert({ club_id: club.id, user_id: req.user.id, status: 'pending' });
      if (error) return res.status(500).json({ error: 'Could not send request' });
    }

    // Notify the club's managers (admins + coaches — the same set that can
    // approve). Best-effort, like every other notification fan-out.
    try {
      const { data: mgrs } = await supabaseAdmin
        .from('memberships').select('user_id').eq('club_id', club.id).in('role', ['admin', 'coach']);
      const requester = displayFromUser(req.user);
      await Promise.all((mgrs || []).map(m => createNotification({
        userId: m.user_id,
        type: 'join_request',
        title: 'New join request',
        body: `${requester.name} requested to join ${club.name}`,
        link: '/clubs/dashboard?club=' + club.id,
        actorId: req.user.id,
        entityId: club.id
      })));
    } catch (err) {
      console.log('Join request notification error:', err.message);
    }

    res.json({ success: true, status: 'pending' });
  } catch (err) {
    console.log('Join request error:', err.message);
    res.status(500).json({ error: 'Could not send request' });
  }
});

// Cancel the caller's own pending request. Conditional delete → empty result
// means "nothing to cancel" (race-free honesty, same rule as other DELETEs).
app.delete(BASE + '/api/clubs/:clubId/join-request', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
  try {
    const { data: gone, error } = await supabaseAdmin
      .from('club_join_requests')
      .delete()
      .eq('club_id', req.params.clubId)
      .eq('user_id', req.user.id)
      .eq('status', 'pending')
      .select('club_id');
    if (error) return res.status(500).json({ error: 'Could not cancel request' });
    if (!gone || !gone.length) return res.status(404).json({ error: 'Request not found' });
    res.json({ success: true });
  } catch (err) {
    console.log('Join request cancel error:', err.message);
    res.status(500).json({ error: 'Could not cancel request' });
  }
});

// Approve / decline a pending request. Manager-gated via isClubManager (the
// same authority set as invites). Non-managers and nonexistent clubs get the
// byte-identical 404.
async function resolveJoinRequestRoute(req, res, action) {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
  const { clubId, userId } = req.params;
  try {
    if (!(await isClubManager(clubId, req.user.id))) {
      return res.status(404).json(CLUB_NOT_FOUND);
    }
    const { data: row } = await supabaseAdmin
      .from('club_join_requests')
      .select('club_id, user_id, status')
      .eq('club_id', clubId)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .maybeSingle();
    if (!row) return res.status(404).json({ error: 'Request not found' });

    if (action === 'approve') {
      // Already a member (e.g. accepted an invite in a race) → just resolve
      // the row; otherwise create the membership first.
      const already = await getClubRole(userId, clubId);
      if (!already) {
        const { error: memErr } = await supabaseAdmin
          .from('memberships')
          .insert({ user_id: userId, club_id: clubId, role: 'member' });
        if (memErr) return res.status(500).json({ error: 'Could not approve request' });
      }
      const { error: markErr } = await supabaseAdmin
        .from('club_join_requests')
        .update({ status: 'approved', resolved_at: new Date().toISOString(), resolved_by: req.user.id })
        .eq('club_id', clubId)
        .eq('user_id', userId)
        .eq('status', 'pending');
      if (markErr) {
        // Membership without a resolved row would let the same request be
        // approved twice — roll the membership back (mirror invite-accept).
        if (!already) {
          const { error: rbErr } = await supabaseAdmin.from('memberships').delete()
            .eq('user_id', userId).eq('club_id', clubId);
          if (rbErr) console.log('Join approve rollback failed:', rbErr.message);
        }
        return res.status(500).json({ error: 'Could not approve request' });
      }
      try {
        const { data: clubRow } = await supabaseAdmin.from('clubs').select('name').eq('id', clubId).maybeSingle();
        await createNotification({
          userId,
          type: 'join_request',
          title: 'Request approved',
          body: `You're in — welcome to ${(clubRow && clubRow.name) || 'the club'}`,
          link: '/clubs/member/' + clubId,
          actorId: req.user.id,
          entityId: clubId
        });
      } catch (err) {
        console.log('Join approve notification error:', err.message);
      }
      return res.json({ success: true, status: 'approved' });
    }

    // Decline: quiet (no notification — the requester sees the cooldown state
    // in the directory). Starts the 7-day cooldown via resolved_at.
    const { error } = await supabaseAdmin
      .from('club_join_requests')
      .update({ status: 'declined', resolved_at: new Date().toISOString(), resolved_by: req.user.id })
      .eq('club_id', clubId)
      .eq('user_id', userId)
      .eq('status', 'pending');
    if (error) return res.status(500).json({ error: 'Could not decline request' });
    res.json({ success: true, status: 'declined' });
  } catch (err) {
    console.log('Join request resolve error:', err.message);
    res.status(500).json({ error: 'Could not update request' });
  }
}
app.post(BASE + '/api/clubs/:clubId/join-requests/:userId/approve', requireAuth, (req, res) => resolveJoinRequestRoute(req, res, 'approve'));
app.post(BASE + '/api/clubs/:clubId/join-requests/:userId/decline', requireAuth, (req, res) => resolveJoinRequestRoute(req, res, 'decline'));

// Club directory settings (visibility + description). Admin-only — listing a
// club publicly is an owner-level decision, stricter than the manager set
// that handles requests. Zero-leak 404 for non-admins/nonexistent clubs.
app.patch(BASE + '/api/clubs/:clubId/settings', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
  try {
    const role = await getClubRole(req.user.id, req.params.clubId);
    if (!role || role.role !== 'admin') return res.status(404).json(CLUB_NOT_FOUND);

    const body = req.body || {};
    const update = {};
    if (body.visibility !== undefined) {
      if (body.visibility !== 'public' && body.visibility !== 'private') {
        return res.status(400).json({ error: 'invalid_visibility' });
      }
      update.visibility = body.visibility;
    }
    if (body.description !== undefined) {
      const desc = String(body.description || '').trim();
      if (desc.length > 500) return res.status(400).json({ error: 'description_too_long', max: 500 });
      update.description = desc || null;
    }
    if (!Object.keys(update).length) return res.status(400).json({ error: 'nothing_to_update' });

    const { data: updated, error } = await supabaseAdmin
      .from('clubs')
      .update(update)
      .eq('id', req.params.clubId)
      .select('id, visibility, description');
    if (error || !updated || !updated.length) {
      return res.status(500).json({ error: 'Could not save settings' });
    }

    // Going private voids pending requests — the club is no longer
    // discoverable, so a pending request would dangle unanswerable. Checked
    // write: a failure here must fail the route so state can't silently
    // diverge (the visibility change itself stands — safe direction: club is
    // hidden, and any surviving pending rows are unreachable via the
    // manager UI only until this is retried).
    if (update.visibility === 'private') {
      const { error: prErr } = await supabaseAdmin
        .from('club_join_requests')
        .delete()
        .eq('club_id', req.params.clubId)
        .eq('status', 'pending');
      if (prErr) {
        console.log('Pending request purge failed:', prErr.message);
        return res.status(500).json({ error: 'saved_but_requests_not_cleared', message: 'Visibility saved, but pending requests could not be cleared. Save again to retry.' });
      }
    }

    res.json({ success: true, visibility: updated[0].visibility, description: updated[0].description });
  } catch (err) {
    console.log('Club settings error:', err.message);
    res.status(500).json({ error: 'Could not save settings' });
  }
});

// ── EVENTS API ──
// Mounted under BASE so the shared proxy routes them here (the separate
// api-server owns the bare "/api"). Display names come from auth metadata (no
// `profiles` table); related rows are joined in JS, not via PostgREST embeds.

// ── Event access — THE single rule. ──
// Every route that reads or returns an event row must decide visibility through
// canUserSeeEvent / visibleEventsFilter — never through per-route query shapes
// (that's how the pre-2026-07 RSVP/calendar leak happened).
//   public                → anyone (club_id or not; a public club event is public)
//   club_id set (non-public) → members of that club (creator always)
//   private (no club_id)  → creator ∨ invite row (event_invites)
//   anything else         → creator only (fail closed)
// NOTE deliberately NO "RSVP row ⇒ visible" clause: invites are retained on
// accept and revoke refuses once RSVP'd, so an RSVP without an invite row can
// only be a pre-gate leak artifact — admitting it would carry the leak forward.
const EVENT_VISIBILITIES = ['public', 'club', 'private'];

function canUserSeeEvent(userId, event, ctx) {
  if (!event || !userId) return false;
  if (event.created_by === userId) return true;
  if (event.visibility === 'public') return true;
  if (event.club_id) return ctx.memberClubs.has(event.club_id);
  if (event.visibility === 'private') return ctx.invitedEvents.has(event.id);
  return false;
}

// Batched context: one memberships + one event_invites lookup for a whole list.
async function buildEventAccessCtx(userId, events) {
  const ctx = { memberClubs: new Set(), invitedEvents: new Set() };
  const clubIds = [...new Set(events.map(e => e.club_id).filter(Boolean))];
  const privateIds = events
    .filter(e => e.visibility === 'private' && !e.club_id && e.created_by !== userId)
    .map(e => e.id);
  const [memRes, invRes] = await Promise.all([
    clubIds.length
      ? supabaseAdmin.from('memberships').select('club_id')
          .eq('user_id', userId).in('club_id', clubIds)
      : Promise.resolve({ data: [] }),
    privateIds.length
      ? supabaseAdmin.from('event_invites').select('event_id')
          .eq('invitee_id', userId).in('event_id', privateIds)
      : Promise.resolve({ data: [] })
  ]);
  (memRes.data || []).forEach(m => ctx.memberClubs.add(m.club_id));
  // A failed invite lookup (e.g. table missing) degrades to "not invited" —
  // fail closed, never open.
  (invRes.data || []).forEach(r => ctx.invitedEvents.add(r.event_id));
  return ctx;
}

// Filter a list of event rows down to what userId may see (batched lookups).
async function visibleEventsFilter(userId, events) {
  const list = (events || []).filter(Boolean);
  if (!list.length) return [];
  const ctx = await buildEventAccessCtx(userId, list);
  return list.filter(e => canUserSeeEvent(userId, e, ctx));
}

// THE single write-authorization rule for an event: its creator, OR — for
// club events — an admin/coach of that club. Takes an already-fetched event
// row (needs created_by + club_id). PATCH, DELETE and the image routes all
// call this; never re-inline the rule (this project has repeatedly grown
// four and five inline copies of checks that were meant to be identical).
// Response shape stays per-route: PATCH/DELETE give a visible caller a
// distinct permission message, image routes answer byte-identical not-found.
// THE membership manager check — is userId currently an admin or coach of
// clubId? Shared by canManageEvent and the club-announcement delete rule
// (canManagePost); never re-inline this membership query.
async function isClubManager(clubId, userId) {
  if (!clubId || !userId) return false;
  const { data: mgr } = await supabaseAdmin
    .from('memberships').select('role')
    .eq('club_id', clubId).eq('user_id', userId)
    .in('role', ['admin', 'coach']).maybeSingle();
  return !!mgr;
}

// Delete rule for posts: the author always; for a club announcement
// (club_id set) ALSO a current admin/coach of that club — the club owns that
// speech, and this matches exactly who may post announcements. Personal posts
// (club_id null) remain author-only. Mirrors the canManageEvent shape.
async function canManagePost(post, userId) {
  if (!post) return false;
  if (post.user_id === userId) return true;
  if (!post.club_id) return false;
  return isClubManager(post.club_id, userId);
}

async function canManageEvent(event, userId) {
  if (!event) return false;
  if (event.created_by === userId) return true;
  if (!event.club_id) return false;
  return isClubManager(event.club_id, userId);
}

// Single-event read gate. Returns the event row when userId may see it, and
// null BOTH when the id doesn't exist and when access is denied — callers must
// answer with the identical not-found body in both cases (zero-leak standard,
// matching private challenges: no existence oracle).
async function getVisibleEvent(userId, eventId, columns = '*') {
  const { data: event } = await supabaseAdmin
    .from('events').select(columns).eq('id', eventId).maybeSingle();
  if (!event) return null;
  const visible = await visibleEventsFilter(userId, [event]);
  return visible.length ? event : null;
}

app.get(BASE + '/api/events', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ upcomingEvents: [], clubEvents: [], myCreatedEvents: [], myRsvps: [] });
  try {
    const userId = req.user.id;
    const nowIso = new Date().toISOString();
    const { data: memberships } = await supabaseAdmin
      .from('memberships').select('club_id, role').eq('user_id', userId);
    const clubIds = (memberships || []).map(m => m.club_id).filter(Boolean);
    // Clubs the viewer manages (admin/coach) — drives the canManage flag so
    // the UI can show the Image action wherever the server would allow it.
    const managedClubIds = new Set((memberships || [])
      .filter(m => m.club_id && ['admin', 'coach'].includes(m.role))
      .map(m => m.club_id));
    const { data: following } = await supabaseAdmin
      .from('follows').select('following_id').eq('follower_id', userId);
    const followingIds = (following || []).map(f => f.following_id).filter(Boolean);

    const [upcomingRes, clubRes, createdRes, inviteRes] = await Promise.all([
      supabaseAdmin.from('events').select('*').eq('visibility', 'public')
        .gte('date', nowIso).order('date', { ascending: true }).limit(50),
      clubIds.length
        ? supabaseAdmin.from('events').select('*').in('club_id', clubIds)
            .gte('date', nowIso).order('date', { ascending: true })
        : Promise.resolve({ data: [] }),
      supabaseAdmin.from('events').select('*').eq('created_by', userId)
        .order('date', { ascending: true }),
      supabaseAdmin.from('event_invites').select('event_id').eq('invitee_id', userId)
    ]);
    const upcomingEvents = upcomingRes.data || [];
    const clubEvents = clubRes.data || [];
    const myCreatedEvents = createdRes.data || [];

    // Private events the viewer is invited to (the invite row IS the access
    // grant — see canUserSeeEvent). Missing table degrades to none.
    const invitedIds = [...new Set((inviteRes.data || []).map(r => r.event_id).filter(Boolean))];
    let invitedEvents = [];
    if (invitedIds.length) {
      const { data: invEvs } = await supabaseAdmin
        .from('events').select('*').in('id', invitedIds)
        .gte('date', nowIso).order('date', { ascending: true });
      invitedEvents = invEvs || [];
    }

    const allEvents = [...upcomingEvents, ...clubEvents, ...myCreatedEvents, ...invitedEvents];
    const allEventIds = [...new Set(allEvents.map(e => e.id))];

    let allRsvps = [];
    if (allEventIds.length) {
      const { data } = await supabaseAdmin
        .from('event_rsvps').select('event_id, user_id, status').in('event_id', allEventIds);
      allRsvps = data || [];
    }

    // The viewer's own RSVPs, with their events joined in JS.
    const { data: myRsvpRows } = await supabaseAdmin
      .from('event_rsvps').select('event_id, status').eq('user_id', userId);
    const myRsvpEventIds = [...new Set((myRsvpRows || []).map(r => r.event_id).filter(Boolean))];
    const myRsvpEventMap = {};
    if (myRsvpEventIds.length) {
      // Access columns fetched so the visibility gate can run; a pre-gate RSVP
      // to an event the viewer can no longer see must NOT resurface it here.
      const { data: evs } = await supabaseAdmin
        .from('events').select('id, title, date, location, sport, visibility, club_id, created_by')
        .in('id', myRsvpEventIds);
      const visibleEvs = await visibleEventsFilter(userId, evs || []);
      visibleEvs.forEach(e => {
        myRsvpEventMap[e.id] = { id: e.id, title: e.title, date: e.date, location: e.location, sport: e.sport };
      });
    }
    const myRsvps = (myRsvpRows || [])
      .map(r => ({ event_id: r.event_id, status: r.status, events: myRsvpEventMap[r.event_id] || null }))
      .filter(r => r.events);

    // Resolve creator + RSVP author names from auth metadata in one batch.
    const nameMap = await buildUserDisplayMap([
      ...allEvents.map(e => e.created_by),
      ...allRsvps.map(r => r.user_id)
    ]);

    // Resolve club names for any club-attached events.
    const eventClubIds = [...new Set(allEvents.map(e => e.club_id).filter(Boolean))];
    const clubMap = {};
    if (eventClubIds.length) {
      const { data: clubsData } = await supabaseAdmin
        .from('clubs').select('id, name').in('id', eventClubIds);
      (clubsData || []).forEach(c => { clubMap[c.id] = c; });
    }

    function enrichEvent(event) {
      const eventRsvps = allRsvps.filter(r => r.event_id === event.id);
      const goingCount = eventRsvps.filter(r => r.status === 'going').length;
      const interestedCount = eventRsvps.filter(r => r.status === 'interested').length;
      const myRsvp = eventRsvps.find(r => r.user_id === userId);
      const followersGoing = eventRsvps
        .filter(r => r.status === 'going' && followingIds.includes(r.user_id))
        .map(r => ({
          name: (nameMap[r.user_id] || {}).name || 'Athlete',
          handle: (nameMap[r.user_id] || {}).handle || 'athlete'
        }));
      const creator = nameMap[event.created_by] || {};
      // The storage object path is server-side only: payloads carry the
      // version token (the timestamp segment), never the path or any URL.
      const { image_path, ...eventPublic } = event;
      return {
        ...eventPublic,
        image: eventImageVersion(image_path),
        creatorName: creator.name || 'Athlete',
        creatorHandle: creator.handle || 'athlete',
        clubs: (event.club_id && clubMap[event.club_id]) ? { name: clubMap[event.club_id].name } : null,
        goingCount,
        interestedCount,
        myRsvpStatus: myRsvp ? myRsvp.status : null,
        followersGoing,
        isOwner: event.created_by === userId,
        // Mirrors server-side canManageEvent: creator OR admin/coach of the
        // event's club. UI-affordance only — routes re-check for real.
        canManage: event.created_by === userId || (event.club_id ? managedClubIds.has(event.club_id) : false)
      };
    }

    res.json({
      upcomingEvents: upcomingEvents.map(enrichEvent),
      clubEvents: clubEvents.map(enrichEvent),
      myCreatedEvents: myCreatedEvents.map(enrichEvent),
      invitedEvents: invitedEvents.map(enrichEvent),
      myRsvps
    });
  } catch (err) {
    console.log('Events fetch error:', err.message);
    res.json({ error: err.message });
  }
});

// Create an event, auto-RSVP the creator as going, and notify invited followers
// (restricted to people the caller follows) plus club members if club-posted.
app.post(BASE + '/api/events/create', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for events' });
  const b = req.body || {};
  const { title, sport, event_type, date, location, distance, max_participants,
    entry_fee, level, description, visibility, club_id, invitees } = b;
  if (!title || !sport || !date || !location) {
    return res.json({ error: 'Missing required fields' });
  }
  const eventDate = new Date(date);
  if (isNaN(eventDate.getTime())) return res.json({ error: 'Invalid date' });
  // Visibility is a real access model now — enum-validate it instead of
  // storing arbitrary strings, and enforce the shape each state requires:
  // 'club' is meaningless without a club, 'private' implies NO club scope
  // (club events are member-visible by definition, never invite-gated).
  const vis = visibility || 'public';
  if (!EVENT_VISIBILITIES.includes(vis)) return res.json({ error: 'Invalid visibility' });
  if (vis === 'club' && !club_id) return res.json({ error: 'Club-only events need a club' });
  if (vis === 'private' && club_id) return res.json({ error: 'Private events cannot be posted to a club' });
  // If posting to a club, the caller must actually be a member of it — otherwise
  // anyone could create events in arbitrary clubs and trigger club-wide notifs.
  if (club_id) {
    const { data: membership } = await supabaseAdmin
      .from('memberships').select('club_id')
      .eq('club_id', club_id).eq('user_id', req.user.id).maybeSingle();
    if (!membership) return res.json({ error: 'You are not a member of that club' });
  }
  const { data: event, error } = await supabaseAdmin
    .from('events').insert({
      created_by: req.user.id,
      club_id: club_id || null,
      title: String(title).trim(),
      sport,
      event_type: event_type || null,
      date: eventDate.toISOString(),
      location: String(location).trim(),
      distance: distance || null,
      max_participants: max_participants ? parseInt(max_participants) : null,
      entry_fee: entry_fee || null,
      level: level || null,
      description: description || null,
      visibility: vis
    }).select().single();
  if (error) return res.json({ error: error.message });
  // Auto-RSVP the creator as going. SHOULD-LOG: an event without the
  // creator's RSVP is degraded, not broken — they can RSVP from the event
  // card — so the create still succeeds, but the failure is logged with ids.
  const { error: rsvpErr } = await supabaseAdmin.from('event_rsvps')
    .insert({ event_id: event.id, user_id: req.user.id, status: 'going' });
  if (rsvpErr) console.error('Event create: creator auto-RSVP failed (event %s, user %s) — creator must RSVP manually:', event.id, req.user.id, rsvpErr.message);

  const actor = displayFromUser(req.user);
  const dateLabel = eventDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  // Restrict invites to people the creator follows (the modal only offers
  // those), reject self-invite, and cap the count, so the endpoint can't spam
  // arbitrary user IDs with notifications.
  let validInvitees = [];
  if (Array.isArray(invitees) && invitees.length) {
    const { data: follows } = await supabaseAdmin
      .from('follows').select('following_id').eq('follower_id', req.user.id);
    const followingSet = new Set((follows || []).map(f => f.following_id));
    validInvitees = [...new Set(invitees)]
      .filter(id => id && typeof id === 'string' && followingSet.has(id) && id !== req.user.id)
      .slice(0, 50);
  }
  // On a PRIVATE event the checked list is the ACCESS list: insert the invite
  // rows FIRST (challenge-invite rails — record before notification), and only
  // notify the rows that actually inserted. On public/club events the same
  // list is a heads-up with no access implication (no rows).
  if (vis === 'private' && validInvitees.length) {
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('event_invites')
      .upsert(
        validInvitees.map(id => ({ event_id: event.id, invitee_id: id, inviter_id: req.user.id })),
        { onConflict: 'event_id,invitee_id', ignoreDuplicates: true }
      )
      .select('invitee_id');
    if (insErr) {
      console.log('Event invite insert error:', insErr.message);
      validInvitees = []; // record failed → no access → don't promise it in a notif
    } else {
      validInvitees = (inserted || []).map(r => r.invitee_id);
    }
  }
  for (const inviteeId of validInvitees) {
    await createNotification({
      userId: inviteeId, type: 'event', title: 'Event invite',
      body: `${actor.name} invited you to "${event.title}" on ${dateLabel} at ${event.location}`,
      link: '/events', actorId: req.user.id, entityId: event.id
    });
  }
  if (club_id) {
    const { data: clubMembers } = await supabaseAdmin
      .from('memberships').select('user_id').eq('club_id', club_id).neq('user_id', req.user.id);
    for (const m of (clubMembers || [])) {
      await createNotification({
        userId: m.user_id, type: 'club', title: 'New club event',
        body: `${actor.name} created a new event: "${event.title}" on ${dateLabel}`,
        link: '/events', actorId: req.user.id, entityId: event.id
      });
    }
  }
  res.json({ success: true, event });
});

// RSVP to an event (going / interested / cancelled). Notifies the organiser and
// the viewer's followers when they mark "going".
app.post(BASE + '/api/events/:id/rsvp', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for events' });
  const { status } = req.body || {};
  if (!['going', 'interested', 'cancelled'].includes(status)) {
    return res.json({ error: 'Invalid status' });
  }
  // Visibility gate — an RSVP is an acceptance, so it must pass the same rule
  // as reading the event. Denied and nonexistent get the IDENTICAL body (zero-
  // leak standard; deliberately no invite_required variant — events have no
  // discover surface where a non-invitee could legitimately hold an id).
  const gatedEvent = await getVisibleEvent(req.user.id, req.params.id);
  if (!gatedEvent) return res.json({ error: 'Event not found' });
  const { data: existing } = await supabaseAdmin
    .from('event_rsvps').select('event_id, status')
    .eq('event_id', req.params.id).eq('user_id', req.user.id).maybeSingle();
  const wasGoing = !!(existing && existing.status === 'going');
  // Every RSVP write checks the returned error — a failed write must fail the
  // route BEFORE the notification fan-out below, or the organiser gets told
  // about an RSVP that never landed and the caller sees false success.
  let rsvpErr = null;
  if (existing) {
    if (status === 'cancelled') {
      ({ error: rsvpErr } = await supabaseAdmin.from('event_rsvps').delete()
        .eq('event_id', req.params.id).eq('user_id', req.user.id));
    } else {
      ({ error: rsvpErr } = await supabaseAdmin.from('event_rsvps').update({ status })
        .eq('event_id', req.params.id).eq('user_id', req.user.id));
    }
  } else if (status !== 'cancelled') {
    ({ error: rsvpErr } = await supabaseAdmin.from('event_rsvps')
      .insert({ event_id: req.params.id, user_id: req.user.id, status }));
  }
  if (rsvpErr) {
    console.log('RSVP write error:', rsvpErr.message);
    return res.status(500).json({ error: 'Could not save your RSVP' });
  }
  // Only fan out notifications on the transition *into* going, so repeatedly
  // clicking "Going" can't spam the organiser or the viewer's followers.
  if (status === 'going' && !wasGoing) {
    try {
      const event = gatedEvent; // already fetched (and access-checked) above
      const actor = displayFromUser(req.user);
      if (event && event.created_by !== req.user.id) {
        await createNotification({
          userId: event.created_by, type: 'event', title: 'New RSVP',
          body: `${actor.name} is going to your event "${event.title}"`,
          link: '/events', actorId: req.user.id, entityId: req.params.id
        });
      }
      const { data: followers } = await supabaseAdmin
        .from('follows').select('follower_id').eq('following_id', req.user.id);
      let fanout = (followers || []).map(f => f.follower_id);
      // Private event: the title must not fan out to followers who can't see
      // the event — restrict to followers who are themselves invited (or the
      // creator, notified above).
      if (event && event.visibility === 'private') {
        const { data: invRows } = await supabaseAdmin
          .from('event_invites').select('invitee_id').eq('event_id', req.params.id);
        const invited = new Set((invRows || []).map(r => r.invitee_id));
        fanout = fanout.filter(id => invited.has(id));
      }
      for (const followerId of fanout) {
        await createNotification({
          userId: followerId, type: 'event', title: 'Friend going to an event',
          body: `${actor.name} is going to "${event ? event.title : 'an event'}" — are you in?`,
          link: '/events', actorId: req.user.id, entityId: req.params.id
        });
      }
    } catch (err) {
      console.log('RSVP notification error:', err.message);
    }
  }
  // Award community badges (e.g. "Regular") on a going RSVP, without blocking.
  if (status === 'going') checkAchievements(req.user.id, getUserTimezone(req.user)).catch(() => {});
  res.json({ success: true, status });
});

// Delete one of the viewer's own events (the created_by filter enforces
// ownership even though the service role bypasses RLS).
app.delete(BASE + '/api/events/:id', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for events' });
  // Allow the event creator OR a club admin/coach to delete. Without this, the
  // dashboard "Cancel" button (shown to coaches) would delete 0 rows yet still
  // report success, so the event reappears on reload.
  // Zero-leak: an event the caller can't SEE answers exactly like a
  // nonexistent id; only a visible-but-unauthorized caller gets the distinct
  // permission message.
  const event = await getVisibleEvent(req.user.id, req.params.id, 'id, created_by, club_id, visibility, image_path');
  if (!event) return res.json({ error: 'Event not found' });
  if (!(await canManageEvent(event, req.user.id))) return res.json({ error: 'You do not have permission to cancel this event' });
  const { error } = await supabaseAdmin.from('events').delete().eq('id', req.params.id);
  if (error) return res.json({ error: error.message });
  // Row first, storage object second (best-effort, failures logged and
  // ignored) — object cleanup must never be able to block an event delete.
  await deleteEventImageObject(event.image_path, event.id);
  res.json({ success: true });
});

// List a private event's invitees with live pending/joined state (creator
// only). Nonexistent and non-creator answer identically (zero-leak standard).
app.get(BASE + '/api/events/:id/invites', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for events' });
  const { data: event } = await supabaseAdmin
    .from('events').select('id, created_by, visibility').eq('id', req.params.id).maybeSingle();
  if (!event || event.created_by !== req.user.id) return res.json({ error: 'Event not found' });
  if (event.visibility !== 'private') return res.json({ error: 'Only private events use invites' });
  try {
    const [invRes, rsvpRes] = await Promise.all([
      supabaseAdmin.from('event_invites').select('event_id, invitee_id, created_at')
        .eq('event_id', event.id).order('created_at', { ascending: true }),
      supabaseAdmin.from('event_rsvps').select('event_id, user_id')
        .eq('event_id', event.id).neq('status', 'cancelled')
    ]);
    if (invRes.error) return res.json({ error: 'invites_unavailable' });
    const inviteRows = invRes.data || [];
    // THE shared pending rule (see pendingInvites): row ∧ no accepted RSVP.
    const pendingSet = new Set(
      pendingInvites(inviteRows, rsvpRes.data || [], 'event_id').map(r => r.invitee_id)
    );
    const nameMap = await buildUserDisplayMap(inviteRows.map(r => r.invitee_id));
    res.json({
      invitees: inviteRows.map(r => ({
        id: r.invitee_id,
        name: (nameMap[r.invitee_id] || {}).name || 'Athlete',
        avatar_url: (nameMap[r.invitee_id] || {}).avatar_url || null,
        state: pendingSet.has(r.invitee_id) ? 'pending' : 'joined'
      }))
    });
  } catch (err) {
    res.json({ error: 'invites_unavailable' });
  }
});

// Invite MORE people to an existing private event (creator only). Mirrors the
// challenge invite-more route: canonical `invitees` body key, upsert with
// ignoreDuplicates (re-sending to a still-pending invitee is a no-op with no
// duplicate notification; a revoked-then-reinvited person gets a fresh row +
// fresh notification), notify only the genuinely inserted rows. Differences
// from challenges, both deliberate: the basis is people the creator FOLLOWS
// (same set the event create form offers), and the 50 cap is on the event's
// TOTAL invite count across batches — over-cap is an explicit error with the
// remaining headroom, never a silent truncation. New invitees gain access via
// their event_invites row through the same canUserSeeEvent rule as create-time
// invitees — there is no second access path.
app.post(BASE + '/api/events/:id/invites', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for events' });
  const invitees = Array.isArray((req.body || {}).invitees) ? req.body.invitees : [];
  const { data: event } = await supabaseAdmin
    .from('events').select('id, title, date, location, created_by, visibility, club_id')
    .eq('id', req.params.id).maybeSingle();
  if (!event || event.created_by !== req.user.id) return res.json({ error: 'Event not found' });
  if (event.visibility !== 'private') return res.json({ error: 'Only private events use invites' });
  if (event.date && new Date(event.date).getTime() < Date.now()) {
    return res.json({ error: 'This event has already happened' });
  }
  const { data: followRows } = await supabaseAdmin
    .from('follows').select('following_id').eq('follower_id', req.user.id);
  const followingSet = new Set((followRows || []).map(f => f.following_id));
  const valid = [...new Set(invitees)]
    .filter(id => id && typeof id === 'string' && followingSet.has(id) && id !== req.user.id);
  if (!valid.length) return res.json({ error: 'No valid people to invite' });
  try {
    const [invRes, rsvpRes] = await Promise.all([
      supabaseAdmin.from('event_invites').select('invitee_id').eq('event_id', event.id),
      supabaseAdmin.from('event_rsvps').select('user_id')
        .eq('event_id', event.id).neq('status', 'cancelled')
    ]);
    if (invRes.error) return res.json({ error: 'invites_unavailable' });
    const existing = new Set((invRes.data || []).map(r => r.invitee_id));
    const rsvpd = new Set((rsvpRes.data || []).map(r => r.user_id));
    // Already-invited → no-op (also enforced by ignoreDuplicates); already
    // RSVP'd (shouldn't exist without a row, but pre-gate legacy rows might) →
    // excluded: they're in, an invite row would only confuse the pending rule.
    const toInvite = valid.filter(id => !existing.has(id) && !rsvpd.has(id));
    if (!toInvite.length) return res.json({ success: true, invitedCount: 0 });
    const remaining = 50 - existing.size;
    if (toInvite.length > remaining) {
      return res.json({
        error: 'invite_limit',
        message: remaining > 0
          ? `Events allow 50 invites — you can add ${remaining} more.`
          : 'Events allow 50 invites — this event is at the limit.'
      });
    }
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('event_invites')
      .upsert(
        toInvite.map(id => ({ event_id: event.id, invitee_id: id, inviter_id: req.user.id })),
        { onConflict: 'event_id,invitee_id', ignoreDuplicates: true }
      )
      .select('invitee_id');
    if (insErr) return res.json({ error: 'invites_unavailable' });
    // Concurrency backstop for the TOTAL cap: the pre-check above is
    // read-then-write, so two overlapping creator requests could both pass it.
    // Re-count after insert; on overshoot, compensate by deleting exactly THIS
    // batch's rows (their PKs are known) before anyone is notified. Worst case
    // both racers roll back — the cap is never silently exceeded.
    const insertedIds = (inserted || []).map(r => r.invitee_id);
    if (insertedIds.length) {
      const { count } = await supabaseAdmin.from('event_invites')
        .select('invitee_id', { count: 'exact', head: true }).eq('event_id', event.id);
      if (typeof count === 'number' && count > 50) {
        await supabaseAdmin.from('event_invites').delete()
          .eq('event_id', event.id).in('invitee_id', insertedIds);
        return res.json({ error: 'invite_limit', message: 'Events allow 50 invites — this event is at the limit.' });
      }
    }
    const actor = displayFromUser(req.user);
    // Same notification shape as create-time invites (type 'event', location
    // included) — invitees can't tell which batch they were in, nor should they.
    const when = new Date(event.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    for (const row of (inserted || [])) {
      await createNotification({
        userId: row.invitee_id, type: 'event', title: 'Event invite',
        body: `${actor.name} invited you to "${event.title}" on ${when} at ${event.location}`,
        link: '/events', actorId: req.user.id, entityId: event.id
      });
    }
    res.json({ success: true, invitedCount: (inserted || []).length });
  } catch (err) {
    res.json({ error: 'invites_unavailable' });
  }
});

// Revoke a PENDING event invite (creator only). Mirrors the challenge-invite
// rule: never ejects someone who already RSVP'd — revoke refuses with
// already_joined (a cancelled RSVP returns the invitee to pending, so it does
// not block revoke). Nonexistent and non-creator answer identically.
app.delete(BASE + '/api/events/:id/invites/:userId', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for events' });
  const { data: event } = await supabaseAdmin
    .from('events').select('id, created_by').eq('id', req.params.id).maybeSingle();
  if (!event || event.created_by !== req.user.id) return res.json({ error: 'Event not found' });
  const { data: rsvp } = await supabaseAdmin
    .from('event_rsvps').select('user_id, status')
    .eq('event_id', event.id).eq('user_id', req.params.userId)
    .neq('status', 'cancelled').maybeSingle();
  if (rsvp) return res.json({ error: 'already_joined' });
  try {
    const { error } = await supabaseAdmin.from('event_invites').delete()
      .eq('event_id', event.id).eq('invitee_id', req.params.userId);
    if (error) return res.json({ error: 'invites_unavailable' });
    res.json({ success: true });
  } catch (err) {
    res.json({ error: 'invites_unavailable' });
  }
});

// Confirm the caller manages (admin/coach) the club an event belongs to. Used by
// the coach-only event actions below so they can't be triggered for arbitrary
// clubs. Returns the event row on success, or null.
async function requireEventManager(eventId, userId, columns = '*') {
  const { data: event } = await supabaseAdmin
    .from('events').select(columns).eq('id', eventId).maybeSingle();
  if (!event || !event.club_id) return null;
  const { data: mgr } = await supabaseAdmin
    .from('memberships').select('role')
    .eq('club_id', event.club_id).eq('user_id', userId)
    .in('role', ['admin', 'coach']).maybeSingle();
  return mgr ? event : null;
}

// Nudge club members who haven't RSVP'd to an event yet (coach/admin only).
app.post(BASE + '/api/events/:id/nudge', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for events' });
  const event = await requireEventManager(req.params.id, req.user.id, 'id, club_id, title, date');
  if (!event) return res.json({ error: 'Event not found' });

  const { data: members } = await supabaseAdmin
    .from('memberships').select('user_id').eq('club_id', event.club_id);
  const { data: rsvps } = await supabaseAdmin
    .from('event_rsvps').select('user_id').eq('event_id', event.id);
  const responded = new Set((rsvps || []).map(r => r.user_id));
  const actor = displayFromUser(req.user);
  const eventDate = new Date(event.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const nonResponders = (members || []).filter(m => !responded.has(m.user_id) && m.user_id !== req.user.id);
  for (const m of nonResponders) {
    await createNotification({
      userId: m.user_id, type: 'club', title: 'RSVP reminder',
      body: `${actor.name} is asking — are you coming to "${event.title}" on ${eventDate}? Please RSVP so they can plan ahead.`,
      link: '/events', actorId: req.user.id, entityId: event.id
    });
  }
  res.json({ success: true, nudged: nonResponders.length });
});

// Post an event to the club feed and notify members (coach/admin only).
app.post(BASE + '/api/events/:id/post-to-feed', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for events' });
  const event = await requireEventManager(req.params.id, req.user.id, 'id, club_id, title, date, location, sport');
  if (!event) return res.json({ error: 'Event not found' });

  const actor = displayFromUser(req.user);
  const eventDate = new Date(event.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const { error: postErr } = await supabaseAdmin.from('posts').insert({
    user_id: req.user.id,
    content: `🎟️ Club event: ${event.title} — ${eventDate} at ${event.location}. Come join us! RSVP on the Events page.`,
    sport: event.sport || null
  });
  if (postErr) return res.json({ error: postErr.message });

  const { data: members } = await supabaseAdmin
    .from('memberships').select('user_id').eq('club_id', event.club_id).neq('user_id', req.user.id);
  for (const m of (members || [])) {
    await createNotification({
      userId: m.user_id, type: 'club', title: 'Event reminder',
      body: `${actor.name} posted about "${event.title}" — check the feed for details`,
      link: '/feed', actorId: req.user.id, entityId: event.id
    });
  }
  res.json({ success: true });
});

// Duplicate an event one week later (coach/admin only).
app.post(BASE + '/api/events/:id/duplicate', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for events' });
  const event = await requireEventManager(req.params.id, req.user.id, '*');
  if (!event) return res.json({ error: 'Event not found' });

  const newDate = new Date(event.date);
  newDate.setDate(newDate.getDate() + 7);
  const { data: newEvent, error } = await supabaseAdmin
    .from('events').insert({
      created_by: req.user.id,
      club_id: event.club_id,
      title: event.title,
      sport: event.sport,
      event_type: event.event_type,
      date: newDate.toISOString(),
      location: event.location,
      distance: event.distance,
      max_participants: event.max_participants,
      entry_fee: event.entry_fee,
      level: event.level,
      description: event.description,
      visibility: event.visibility
    }).select().single();
  if (error) return res.json({ error: error.message });
  res.json({ success: true, event: newEvent });
});

// List an event's RSVPs for the coach RSVP modal (admin/coach of the event's
// club only). Names come from auth metadata — there is no usable profiles table.
app.get(BASE + '/api/events/:id/rsvps', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for events' });
  const event = await requireEventManager(req.params.id, req.user.id, 'id, title, club_id');
  if (!event) return res.json({ error: 'Event not found' });
  const { data: rsvpData } = await supabaseAdmin
    .from('event_rsvps')
    .select('status, user_id, created_at')
    .eq('event_id', req.params.id)
    .order('created_at', { ascending: true });
  const nameMap = await buildUserDisplayMap((rsvpData || []).map(r => r.user_id));
  const rsvps = (rsvpData || [])
    .filter(r => r.status === 'going' || r.status === 'interested')
    .map(r => ({
      status: r.status,
      userId: r.user_id,
      name: (nameMap[r.user_id] || {}).name || 'Member',
      handle: (nameMap[r.user_id] || {}).handle || 'member',
      avatar_url: (nameMap[r.user_id] || {}).avatar_url || null,
      profilePublic: nameMap[r.user_id] ? nameMap[r.user_id].profilePublic !== false : true
    }));
  res.json({ event, rsvps });
});

// Update an event (creator OR club admin/coach). A created_by-only filter would
// silently update 0 rows for a managing coach yet still report success.
app.patch(BASE + '/api/events/:id', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for events' });
  // Same zero-leak gate as delete: not-visible === nonexistent.
  // date/location/title are fetched for material-change detection + the
  // notification copy below, not for authorization.
  const event = await getVisibleEvent(req.user.id, req.params.id, 'id, created_by, club_id, visibility, title, date, location');
  if (!event) return res.json({ error: 'Event not found' });
  if (!(await canManageEvent(event, req.user.id))) return res.json({ error: 'You do not have permission to edit this event' });

  const { title, event_type, date, location, distance, level, description, entry_fee, max_participants } = req.body;
  if (date !== undefined && isNaN(new Date(date).getTime())) {
    return res.json({ error: 'Invalid date' });
  }
  const updates = {};
  if (title !== undefined) updates.title = title;
  if (event_type !== undefined) updates.event_type = event_type;
  if (date !== undefined) updates.date = date;
  if (location !== undefined) updates.location = location;
  if (distance !== undefined) updates.distance = distance;
  if (level !== undefined) updates.level = level;
  if (description !== undefined) updates.description = description;
  if (entry_fee !== undefined) updates.entry_fee = entry_fee;
  if (max_participants !== undefined) updates.max_participants = max_participants;
  if (Object.keys(updates).length === 0) {
    return res.json({ error: 'No fields to update' });
  }
  const { error } = await supabaseAdmin.from('events').update(updates).eq('id', req.params.id);
  if (error) return res.json({ error: error.message });

  // Material-change fan-out (BOTH hosts — this is the single code path):
  // when the date or location ACTUALLY changed, notify everyone with a live
  // going/interested RSVP so nobody shows up at the wrong place or time.
  // Cosmetic edits (title/type/level/distance/fee/max/description) stay
  // silent. Date compares as an instant (the form re-composes the ISO string,
  // so string equality would false-positive); location compares trimmed.
  // Recipient prefs (notify_events) are enforced inside createNotification.
  try {
    const dateChanged = updates.date !== undefined &&
      new Date(updates.date).getTime() !== new Date(event.date).getTime();
    const normLoc = (v) => (v == null ? '' : String(v).trim());
    const locationChanged = updates.location !== undefined &&
      normLoc(updates.location) !== normLoc(event.location);
    if (dateChanged || locationChanged) {
      const { data: rsvps } = await supabaseAdmin
        .from('event_rsvps').select('user_id, status')
        .eq('event_id', event.id).in('status', ['going', 'interested']);
      const recipients = [...new Set((rsvps || []).map(r => r.user_id))]
        .filter(id => id && id !== req.user.id);
      if (recipients.length) {
        const actor = displayFromUser(req.user);
        const newDate = updates.date !== undefined ? updates.date : event.date;
        const newLoc = updates.location !== undefined ? updates.location : event.location;
        const when = new Date(newDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
        const what = dateChanged && locationChanged ? 'the date and location'
          : dateChanged ? 'the date' : 'the location';
        const title = updates.title !== undefined ? updates.title : event.title;
        for (const uid of recipients) {
          await createNotification({
            userId: uid, type: 'event', title: 'Event updated',
            body: `${actor.name} changed ${what} of "${title}" — now ${when} at ${newLoc}`,
            link: '/events', actorId: req.user.id, entityId: event.id
          });
        }
      }
    }
  } catch (err) {
    // Fan-out must never fail the edit itself.
    console.log('Event edit notification error:', err.message);
  }
  res.json({ success: true });
});

// Events page: inject the viewer's identity, the people they follow, and their
// clubs so the create modal and rendering can use real data. There is no
// `profiles` table, so names come from auth metadata.
app.get(BASE + '/events', requirePageAuth, async (req, res) => {
  try {
    if (!supabaseAdmin) return sendPageError(res);
    const userId = req.user.id;
    const { data: follows } = await supabaseAdmin
      .from('follows').select('following_id').eq('follower_id', userId);
    const followingIds = [...new Set((follows || []).map(f => f.following_id).filter(Boolean))];
    const nameMap = await buildUserDisplayMap(followingIds);
    const followingList = followingIds.map(id => ({
      id,
      name: (nameMap[id] || {}).name || 'Athlete',
      handle: (nameMap[id] || {}).handle || 'athlete',
      avatar_url: (nameMap[id] || {}).avatar_url || null,
      location: (nameMap[id] || {}).location || null
    }));
    const clubs = await getSidebarClubs(userId);
    const eventData = { userId, profile: displayFromUser(req.user), following: followingList, clubs };
    const html = injectProBadge(injectBottomNav(injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-events.html'), 'utf8'), eventData), 'events'), (await getUserPlan(req.user.id)) === 'pro');
    res.type('html').send(html);
  } catch (err) {
    console.log('Events page error:', err.message);
    sendPageError(res);
  }
});
// Leaderboards page. Injects the viewer's identity + club name so the client can
// highlight "you" and label the club scope. There is no `profiles` table, so the
// name comes from auth metadata.
app.get(BASE + '/leaderboards', requirePageAuth, async (req, res) => {
  try {
    if (!supabaseAdmin) return sendPageError(res);
    let clubName = null;
    const { data: membership } = await supabaseAdmin
      .from('memberships')
      .select('clubs:club_id (name)')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (membership && membership.clubs) {
      const c = Array.isArray(membership.clubs) ? membership.clubs[0] : membership.clubs;
      clubName = (c && c.name) || null;
    }
    const clubs = await getSidebarClubs(req.user.id);
    const lbData = {
      userId: req.user.id, profile: displayFromUser(req.user), clubName, clubs,
      // Viewer's own profile sports — the sport tab row derives from these
      // (Session ② pattern from the feed pills), so new registry sports show
      // up automatically for the athletes who actually do them.
      sports: Array.isArray((req.user.user_metadata || {}).sports) ? req.user.user_metadata.sports : []
    };
    const html = injectProBadge(injectBottomNav(injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-leaderboards.html'), 'utf8'), lbData), 'leaderboards'), (await getUserPlan(req.user.id)) === 'pro');
    res.type('html').send(html);
  } catch (err) {
    console.log('Leaderboards page error:', err.message);
    sendPageError(res);
  }
});
app.get(BASE + '/challenges', requirePageAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    // Invite picker source = the creator's FOLLOWERS (people who chose to
    // follow them — they opted in, so an invite is welcome, and the form label
    // "challenge the followers you pick" is literally true). The old injection
    // fed people the creator FOLLOWS, which contradicted every label and let a
    // follow-spammer invite strangers.
    let followers = [];
    if (supabaseAdmin) {
      const { data: followRows } = await supabaseAdmin
        .from('follows').select('follower_id').eq('following_id', userId);
      const ids = [...new Set((followRows || []).map((f) => f.follower_id).filter(Boolean))];
      const map = await buildUserDisplayMap(ids);
      followers = ids.map((id) => ({
        id,
        name: (map[id] && map[id].name) || 'Athlete',
        handle: (map[id] && map[id].handle) || 'athlete',
        avatar_url: (map[id] && map[id].avatar_url) || null,
        location: (map[id] && map[id].location) || null
      })).sort((a, b) => a.name.localeCompare(b.name));
    }
    const clubs = await getSidebarClubs(userId);
    const gating = { proLocked: await computeProLocked(userId) };
    const meta = req.user.user_metadata || {};
    const sports = Array.isArray(meta.sports) ? meta.sports.filter(Boolean) : [];
    const challengeData = { userId, profile: displayFromUser(req.user), followers, clubs, gating, sports };
    const html = injectProBadge(injectBottomNav(injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-challenges.html'), 'utf8'), challengeData), 'challenges'), (await getUserPlan(userId)) === 'pro');
    res.send(html);
  } catch (err) {
    console.log('Challenges page error:', err.message);
    sendPageError(res);
  }
});
// My profile requires authentication. Inject the user's real identity, post/
// follower/following counts, recent posts, and club membership so the page shows
// live data instead of the hardcoded "Jamie King" placeholders. There is no
// `profiles` table, so name/handle/bio/location come from auth user metadata.
app.get(BASE + '/profile', requirePageAuth, async (req, res) => {
  try {
    if (!supabaseAdmin) return sendPageError(res);
    const meta = req.user.user_metadata || {};
    const display = displayFromUser(req.user);

    const [postCountRes, followerRes, followingRes, postsRes, clubsRes, followingListRes, followerListRes, activitiesRes, activityCountRes] = await Promise.all([
      supabaseAdmin.from('posts').select('*', { count: 'exact', head: true }).eq('user_id', req.user.id),
      supabaseAdmin.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', req.user.id),
      supabaseAdmin.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', req.user.id),
      supabaseAdmin.from('posts').select('id, content, sport, feeling, created_at').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(10),
      // All clubs the viewer belongs to (hero club pills + My Clubs tab). No
      // `status` column on memberships — every row is an active membership.
      supabaseAdmin.from('memberships').select('role, clubs:club_id (id, name, handle, sport, city, logo_url)').eq('user_id', req.user.id).order('created_at', { ascending: false }),
      // Raw follow edges (no `created_at` ordering — not guaranteed on this table).
      supabaseAdmin.from('follows').select('following_id').eq('follower_id', req.user.id),
      supabaseAdmin.from('follows').select('follower_id').eq('following_id', req.user.id),
      // Lifetime distance source + hero sport tags source. The `activities` table is
      // user-provisioned and may not exist yet — supabase-js returns { data: null }
      // rather than throwing, so a missing table degrades kmLogged to 0 and
      // activitySports to [] instead of breaking the whole page.
      supabaseAdmin.from('activities').select('sport, distance, date').eq('user_id', req.user.id),
      // Real count of the user's activities for the "Activities" hero stat + tab
      // badge. Counted from the activities table (NOT posts) so it matches the
      // Activities list and the Stats & PRs tab. Missing table → count null → 0.
      supabaseAdmin.from('activities').select('*', { count: 'exact', head: true }).eq('user_id', req.user.id)
    ]);

    // Flatten all memberships into a clubs[] array (joined club + the viewer's role).
    const userClubs = (clubsRes.data || []).map(m => {
      const c = Array.isArray(m.clubs) ? m.clubs[0] : m.clubs;
      return c ? Object.assign({}, c, { role: m.role }) : null;
    }).filter(Boolean);
    // Same additive plan field as getSidebarClubs (this route builds its own
    // clubs list because the My Clubs tab also needs `city`): real subscription
    // via getClubPlan, flag-independent; free clubs' objects stay untouched.
    await Promise.all(userClubs.map(async c => {
      if ((await getClubPlan(c.id)) === 'club_pro') c.plan = 'club_pro';
    }));

    // Resolve the people the viewer follows / who follow them into display info.
    // There is no `profiles` table, so map each follow edge to its auth metadata
    // (one lookup per unique user, same approach as enrichNotifications).
    const followingIds = (followingListRes.data || []).map(r => r.following_id).filter(Boolean);
    const followerIds = (followerListRes.data || []).map(r => r.follower_id).filter(Boolean);
    const uniqueIds = [...new Set([...followingIds, ...followerIds])];
    const userMap = {};
    await Promise.all(uniqueIds.map(async (id) => {
      try {
        const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
        const user = u && u.user;
        if (!user) return;
        const m = user.user_metadata || {};
        const disp = displayFromUser(user);
        userMap[id] = {
          id,
          name: disp.name,
          handle: disp.handle,
          // Real photo for the Following/Followers cards — the client renders
          // via avatarHtml(a.avatar_url), which was silently falling back to
          // initials because this payload never carried the field.
          avatar_url: disp.avatar_url || null,
          bio: m.bio || null,
          location: m.location || null,
          sports: Array.isArray(m.sports) ? m.sports : [],
          level: m.level || null
        };
      } catch (err) {
        // Ignore individual lookup failures; the row is simply omitted.
      }
    }));
    const followingList = followingIds.map(id => userMap[id]).filter(Boolean);
    const followerList = followerIds.map(id => userMap[id]).filter(Boolean);

    // Total km logged across all activities, rounded to 1 decimal. Unit-aware so
    // swimming (logged in metres) and miles convert to real km; non-distance
    // sessions (yoga, weights) contribute 0. No activities → 0.
    const kmLogged = Math.round(
      (activitiesRes.data || []).reduce((s, a) => s + parseDistanceKmUnitAware(a.distance), 0) * 10
    ) / 10;

    // Distinct sports across the user's logged activities, with per-sport count
    // and most recent date. Feeds the profile hero sport tags (client unions
    // these with post sports). Additive: the same query already fetches every
    // activity row for kmLogged, so this reuses it rather than adding a query.
    const activitySportMap = {};
    for (const a of (activitiesRes.data || [])) {
      if (!a.sport) continue;
      const entry = activitySportMap[a.sport] || { sport: a.sport, count: 0, lastDate: null };
      entry.count += 1;
      if (a.date && (!entry.lastDate || String(a.date) > String(entry.lastDate))) entry.lastDate = a.date;
      activitySportMap[a.sport] = entry;
    }
    const activitySports = Object.values(activitySportMap);

    // ── "New since last viewed" tab badges ──
    // Each counted tab's badge shows only items whose timestamp postdates the
    // stored per-tab last-seen (user_metadata.tab_seen). First run (or a tab
    // added later): everything predating the feature counts as seen — missing
    // keys are initialized to NOW and contribute zero, so an existing user
    // never logs in to a wall of old-news badges. Any error degrades to no
    // badge, never a fake count.
    const tabUnseen = { activities: 0, achievements: 0, clubs: 0, following: 0 };
    try {
      const storedSeen = (meta.tab_seen && typeof meta.tab_seen === 'object' && !Array.isArray(meta.tab_seen)) ? meta.tab_seen : {};
      const isTs = (v) => typeof v === 'string' && !isNaN(Date.parse(v));
      const missingSeen = TAB_SEEN_KEYS.filter((k) => !isTs(storedSeen[k]));
      if (missingSeen.length) {
        const nowIso = new Date().toISOString();
        const seeded = Object.assign({}, storedSeen);
        missingSeen.forEach((k) => { seeded[k] = nowIso; });
        // updateUserById merges top-level metadata keys, so this only touches
        // tab_seen. If the write fails the next page load simply re-seeds.
        await supabaseAdmin.auth.admin.updateUserById(req.user.id, { user_metadata: { tab_seen: seeded } });
      }
      // Unseen = rows newer than last-seen. Activities/achievements/clubs are
      // the viewer's own additions (activities.created_at, achievements
      // .earned_at, memberships.created_at); Following counts NEW FOLLOWERS
      // (follows where the viewer is the target) — the notable external event,
      // not people the viewer followed themselves.
      const unseenQueries = {
        activities: () => supabaseAdmin.from('activities').select('*', { count: 'exact', head: true }).eq('user_id', req.user.id).gt('created_at', storedSeen.activities),
        achievements: () => supabaseAdmin.from('achievements').select('*', { count: 'exact', head: true }).eq('user_id', req.user.id).gt('earned_at', storedSeen.achievements),
        clubs: () => supabaseAdmin.from('memberships').select('*', { count: 'exact', head: true }).eq('user_id', req.user.id).gt('created_at', storedSeen.clubs),
        following: () => supabaseAdmin.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', req.user.id).gt('created_at', storedSeen.following)
      };
      await Promise.all(TAB_SEEN_KEYS.filter((k) => isTs(storedSeen[k])).map(async (k) => {
        const { count, error } = await unseenQueries[k]();
        // Missing user-provisioned table (achievements) or any error → 0.
        if (!error && count) tabUnseen[k] = count;
      }));
    } catch (err) {
      console.log('Tab unseen error:', err.message);
    }

    const profileData = {
      profile: {
        name: display.name,
        handle: display.handle,
        bio: meta.bio || '',
        location: meta.location || '',
        // Structured place: stored codes + registry-resolved display names
        // (hero renders names; the settings selects pre-select from codes).
        country: display.country || '',
        countryName: display.countryName || '',
        state: display.state || '',
        stateName: display.stateName || '',
        avatar_url: meta.avatar_url || null,
        banner_url: meta.banner_url || null,
        // Saved "Your sports" selection (registry ids) — drives the settings
        // sport chips' initial .on state.
        sports: Array.isArray(meta.sports) ? meta.sports : [],
        // Timezone override state for the settings select: the stored zone and
        // whether it was set manually (manual survives login auto-refresh).
        timezone: isValidTimezone(meta.timezone) ? meta.timezone : '',
        timezoneSource: meta.timezone_source === 'manual' ? 'manual' : 'auto'
      },
      // Resolved Settings toggles (default-on) — drives the privacy/notification
      // toggles' initial on/off state, so a reload always shows the stored truth.
      prefs: prefsFromMeta(meta),
      // Full registries for the settings dropdowns — injected here rather than
      // into the shared shell script so only the profile page pays the ~7KB.
      countries: COUNTRIES,
      usStates: US_STATES,
      // IANA zone names for the timezone override select (runtime-provided).
      timezones: Intl.supportedValuesOf('timeZone'),
      userId: req.user.id,
      email: req.user.email,
      memberSince: req.user.created_at || null,
      postCount: postCountRes.count || 0,
      activityCount: activityCountRes.count || 0,
      kmLogged,
      followerCount: followerRes.count || 0,
      followingCount: followingRes.count || 0,
      posts: postsRes.data || [],
      activitySports,
      clubs: userClubs,
      followingList,
      followerList,
      // Per-tab "new since last viewed" counts for the header tab badges.
      // Zero = no badge rendered (never a "0" pill).
      tabUnseen,
      gating: { proLocked: await computeProLocked(req.user.id) }
    };

    const isProUser = (await getUserPlan(req.user.id)) === 'pro';
    let html = injectProBadge(injectBottomNav(injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-my-profile.html'), 'utf8'), profileData), 'profile'), isProUser);
    // Profile-header badge: the slot comment is stripped for everyone; only a
    // Pro subscriber's page ever contains the badge markup.
    html = html.replace('<!--PRO_BADGE_SLOT-->', isProUser ? PRO_BADGE_HTML : '');
    res.type('html').send(html);
  } catch (err) {
    console.log('Profile data error:', err.message);
    sendPageError(res);
  }
});
// Profile stats & PRs computed from the signed-in user's own `activities`.
// Hero stats and the sport breakdown respect the `period` filter; streaks,
// the 12-week chart, and personal records are always all-time (per spec).
app.get(BASE + '/api/profile/stats', requireAuth, requireProPlan('training_analytics'), async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
    const period = req.query.period === 'month' || req.query.period === 'year' ? req.query.period : 'all';
    const now = new Date();
    const statsTz = getUserTimezone(req.user);

    // All activities for streaks + PRs (PRs are always all-time).
    const { data: allActivities, error } = await supabaseAdmin
      .from('activities')
      .select('id, sport, title, distance, duration, date')
      .eq('user_id', req.user.id)
      .order('date', { ascending: true });
    if (error) {
      console.log('Profile stats query error:', error.message);
      return res.status(500).json({ error: 'Could not load stats' });
    }
    const acts = allActivities || [];
    // Period-filtered activities for hero stats and breakdowns. "This month" /
    // "this year" mean calendar membership in the USER'S zone (key comparisons),
    // so a late-evening Pacific activity stored after UTC midnight still counts
    // toward the Pacific user's current month. 'all' keeps the legacy epoch cut.
    let periodActs;
    if (period === 'month') {
      const nowMonth = monthKey(now, statsTz);
      periodActs = acts.filter((a) => monthKey(a.date, statsTz) === nowMonth);
    } else if (period === 'year') {
      const nowYear = dateParts(now, statsTz).y;
      periodActs = acts.filter((a) => { const p = dateParts(a.date, statsTz); return !!p && p.y === nowYear; });
    } else {
      // 'all' means ALL activities — the exact same set the profile hero's
      // "km logged" sums, so the two all-time totals can never diverge.
      periodActs = acts;
    }

    // Canonical unit-aware parser — the same one the profile hero uses.
    const km = (a) => parseDistanceKmUnitAware(a.distance);

    // ── Hero stats (period) ──
    // 1dp rounding matches the profile hero's kmLogged exactly.
    const totalKm = Math.round(periodActs.reduce((s, a) => s + km(a), 0) * 10) / 10;
    const totalHours = Math.round(periodActs.reduce((s, a) => s + parseDurationHours(a.duration), 0) * 10) / 10;
    const totalPoints = calculatePoints(periodActs);

    // ── Streaks (always all-time, shared helper, user's zone) ──
    const { currentStreak, longestStreak } = computeStreaks(acts, statsTz);
    // Avg sessions per week over the period (or since first activity in period).
    const firstDate = periodActs.length > 0 ? new Date(periodActs[0].date) : now;
    const weeksSpan = Math.max(1, (now - firstDate) / (7 * 86400000));
    const avgPerWeek = Math.round((periodActs.length / weeksSpan) * 10) / 10;

    // ── Weekly chart (last N weeks, always recent regardless of period).
    // `weeks` is whitelisted to the UI's range options; anything else falls
    // back to the historic 12. Computed on-read from the same all-time
    // activities query — no extra fetch, no stored aggregates. ──
    const wq = parseInt(req.query.weeks, 10);
    const chartWeeks = wq === 6 || wq === 12 || wq === 24 ? wq : 12;
    const weeklyChart = [];
    for (let i = chartWeeks - 1; i >= 0; i--) {
      // Week membership via user-zone day keys; the label renders the key at
      // UTC so it can never drift a day from the bucket it names.
      const wStartK = weekStartKey(now, statsTz, i);
      const wEndK = addDaysToKey(wStartK, 7);
      const wActs = acts.filter((a) => { const k = dayKey(a.date, statsTz); return k >= wStartK && k < wEndK; });
      // Per-sport hours for the stacked columns. Tenths are handed out by
      // largest remainder so the segments always sum EXACTLY to the labeled
      // weekly total (independent per-sport rounding could drift by 0.1h).
      const wTotalTenths = Math.round(wActs.reduce((s, a) => s + parseDurationHours(a.duration), 0) * 10);
      const wSportHours = {};
      wActs.forEach((a) => {
        const sp = a.sport || 'other';
        wSportHours[sp] = (wSportHours[sp] || 0) + parseDurationHours(a.duration);
      });
      const wEntries = Object.entries(wSportHours).map(([sport, h]) => ({ sport, exact: h * 10, tenths: Math.floor(h * 10) }));
      const wUsed = wEntries.reduce((s, e) => s + e.tenths, 0);
      wEntries.slice()
        .sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)))
        .slice(0, Math.max(0, wTotalTenths - wUsed))
        .forEach((e) => { e.tenths += 1; });
      weeklyChart.push({
        label: keyToUtcDate(wStartK).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(' ', ''),
        hours: wTotalTenths / 10,
        // Dominant sport first; zero-tenth slivers dropped (they'd render as
        // 0.0h segments — dishonest noise).
        bySport: wEntries.filter((e) => e.tenths > 0).sort((a, b) => b.tenths - a.tenths)
          .map((e) => ({ sport: e.sport, hours: e.tenths / 10 }))
      });
    }

    // ── Sport breakdown (period) ──
    const sportMap = {};
    periodActs.forEach((a) => {
      const sport = a.sport || 'other';
      if (!sportMap[sport]) sportMap[sport] = { sessions: 0, km: 0, hours: 0 };
      sportMap[sport].sessions++;
      sportMap[sport].km += km(a);
      sportMap[sport].hours += parseDurationHours(a.duration);
    });
    const sportBreakdown = Object.entries(sportMap).map(([sport, s]) => ({
      sport,
      sessions: s.sessions,
      km: Math.round(s.km * 10) / 10,
      hours: Math.round(s.hours * 10) / 10,
      pct: periodActs.length > 0 ? Math.round((s.sessions / periodActs.length) * 100) : 0
    })).sort((a, b) => b.sessions - a.sessions);

    // ── Personal records (always all-time) ──
    const prs = [];
    // PR dates render as the user's-zone calendar day of the activity instant.
    const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: statsTz });

    const runs = acts.filter((a) => a.sport === 'running' && km(a) > 0);
    if (runs.length) {
      const best = runs.reduce((m, a) => km(a) > km(m) ? a : m);
      prs.push({ icon: '🏃', label: 'Longest run', value: Math.round(km(best) * 10) / 10 + ' km', meta: fmtDate(best.date) + (best.title ? ' · ' + best.title : '') });
    }
    const pacedRuns = runs.filter((a) => km(a) >= 3 && parseDurationHours(a.duration) > 0);
    if (pacedRuns.length) {
      const withPace = pacedRuns.map((a) => ({ a, pace: (parseDurationHours(a.duration) * 60) / km(a) }));
      const best = withPace.reduce((m, x) => x.pace < m.pace ? x : m);
      const mins = Math.floor(best.pace);
      const secs = Math.round((best.pace - mins) * 60);
      prs.push({ icon: '⚡', label: 'Fastest pace · run', value: `${mins}:${String(secs).padStart(2, '0')} /km`, meta: fmtDate(best.a.date) + (best.a.title ? ' · ' + best.a.title : '') });
    }
    const rides = acts.filter((a) => a.sport === 'cycling' && km(a) > 0);
    if (rides.length) {
      const best = rides.reduce((m, a) => km(a) > km(m) ? a : m);
      prs.push({ icon: '🚴', label: 'Longest ride', value: Math.round(km(best) * 10) / 10 + ' km', meta: fmtDate(best.date) + (best.title ? ' · ' + best.title : '') });
    }
    const timed = acts.filter((a) => parseDurationHours(a.duration) > 0);
    if (timed.length) {
      const best = timed.reduce((m, a) => parseDurationHours(a.duration) > parseDurationHours(m.duration) ? a : m);
      const h = parseDurationHours(best.duration);
      const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
      const sportName = best.sport ? best.sport.charAt(0).toUpperCase() + best.sport.slice(1) : 'Activity';
      prs.push({ icon: '⏱', label: 'Longest activity', value: `${hh}h ${mm}m`, meta: fmtDate(best.date) + ' · ' + sportName });
    }
    if (acts.length) {
      const weekTotals = {};
      acts.forEach((a) => {
        // Bucket by the Monday key of the activity's week in the user's zone.
        const key = weekStartKey(a.date, statsTz);
        if (!weekTotals[key]) weekTotals[key] = { hours: 0, count: 0 };
        weekTotals[key].hours += parseDurationHours(a.duration);
        weekTotals[key].count++;
      });
      const bestWeek = Object.entries(weekTotals).reduce((m, x) => x[1].hours > m[1].hours ? x : m);
      prs.push({ icon: '📅', label: 'Biggest week', value: Math.round(bestWeek[1].hours * 10) / 10 + 'h', meta: 'Week of ' + keyToUtcDate(bestWeek[0]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) + ' · ' + bestWeek[1].count + ' activities' });

      const monthTotals = {};
      acts.forEach((a) => {
        const key = monthKey(a.date, statsTz);
        monthTotals[key] = (monthTotals[key] || 0) + km(a);
      });
      const bestMonth = Object.entries(monthTotals).reduce((m, x) => x[1] > m[1] ? x : m);
      prs.push({ icon: '📍', label: 'Biggest month', value: Math.round(bestMonth[1] * 10) / 10 + ' km', meta: keyToUtcDate(bestMonth[0]).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) + ' · across all sports' });
    }

    res.json({
      period,
      chartWeeks,
      hero: { activities: periodActs.length, totalKm, totalHours, totalPoints },
      streaks: { current: currentStreak, longest: longestStreak, avgPerWeek },
      weeklyChart,
      sportBreakdown,
      prs
    });
  } catch (err) {
    console.log('Profile stats error:', err.message);
    res.status(500).json({ error: 'Could not load stats' });
  }
});

// ── GOALS (individual Pro feature) ──
// Personal training goals computed on read from `activities` — no stored
// counters (the challenges enrich() pattern: the server computes progress/pct/
// isComplete/onTrack; clients must consume these, never recompute). Stored
// status is only 'active' | 'archived'; "completed"/"expired" are derived.
// Distance math uses the canonical unit-aware parser (parseDistanceKmUnitAware),
// same as challenges and every other km surface.
// Gating: creates/edits require the Pro plan; reads and archive/delete are
// requireAuth-only (self-only), so a lapsed subscriber keeps read access and
// can always archive — exit actions are never gated.

const GOAL_TYPES = ['distance', 'frequency', 'duration', 'streak'];
const GOAL_PERIODS = ['weekly', 'monthly', 'custom'];
const GOAL_UNITS = ['km', 'mi'];
// KNOWN_SPORTS (valid ids) and DISTANCE_SPORTS (sports where a distance goal
// makes sense; a sport=null distance goal only counts these) are derived from
// the sports registry (sports.js) and required at the top of this file.
const MAX_ACTIVE_GOALS = 5;
const MI_TO_KM = 1.609;

// Parse a 'YYYY-MM-DD' date column as a LOCAL date. new Date('YYYY-MM-DD')
// parses as UTC midnight, which shifts the day in non-UTC locales — the same
// bucketing rule the rest of the app follows (local date parts, never ISO).
function parseLocalDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

// The goal's evaluation window in the USER'S zone. weekly = current
// Monday-start week; monthly = current calendar month; custom = start_date
// through end_date INCLUSIVE (the window closes at the user's midnight after
// end_date). Weekly/monthly windows are always the current period, so only
// custom goals can expire. Returns both day-key bounds (activity bucketing —
// [startKey, endKeyExcl) string comparisons) and the exact UTC instants of
// those local midnights (deadline/pace math + windowStart/windowEnd ISO).
function goalWindow(goal, tz) {
  let startKey, endKeyExcl;
  if (goal.period === 'weekly') {
    startKey = weekStartKey(new Date(), tz);
    endKeyExcl = addDaysToKey(startKey, 7);
  } else if (goal.period === 'monthly') {
    const p = dateParts(new Date(), tz);
    startKey = `${p.y}-${String(p.m).padStart(2, '0')}-01`;
    endKeyExcl = p.m === 12
      ? `${p.y + 1}-01-01`
      : `${p.y}-${String(p.m + 1).padStart(2, '0')}-01`;
  } else {
    startKey = String(goal.start_date);
    endKeyExcl = addDaysToKey(goal.end_date || goal.start_date, 1);
  }
  return {
    startKey,
    endKeyExcl,
    start: zoneMidnightUtc(startKey, tz),
    end: zoneMidnightUtc(endKeyExcl, tz)
  };
}

// Server-computed goal enrichment. `activities` = ALL of the owner's activity
// rows (sport, distance, duration, date); `streaks` = computeStreaks output
// over those rows (streak goals measure the ALL-TIME current streak — their
// window is a review deadline only). Null-distance rows contribute 0 via the
// parser, never crash.
function enrichGoal(goal, activities, streaks, tz) {
  const now = new Date();
  const { startKey, endKeyExcl, start, end } = goalWindow(goal, tz);
  const target = Number(goal.target_value) || 0;
  // Comparison space: km for distance goals (target converted from mi once
  // here), otherwise the type's natural unit (sessions / hours / days).
  const targetCmp = goal.type === 'distance' && goal.unit === 'mi' ? target * MI_TO_KM : target;

  let progressCmp = 0;
  if (goal.type === 'streak') {
    // Sport-scoped streak = ALL-TIME current streak in that sport only
    // (window stays a deadline). Filter-before-call: computeStreaks itself is
    // untouched (six callers). No sport ever logged → empty array → 0, never
    // a fallback to the sport-blind number.
    progressCmp = goal.sport
      ? computeStreaks(activities.filter((a) => a.sport === goal.sport), tz).currentStreak
      : streaks.currentStreak;
  } else {
    // Window membership by user-zone day key, so a 6 PM Pacific activity
    // (next-day UTC) counts toward the Pacific day's window.
    const inWindow = activities.filter((a) => {
      const k = dayKey(a.date, tz);
      return k >= startKey && k < endKeyExcl;
    });
    const matches = inWindow.filter((a) => {
      if (goal.sport) return a.sport === goal.sport;
      if (goal.type === 'distance') return DISTANCE_SPORTS.includes(a.sport);
      return true;
    });
    if (goal.type === 'distance') {
      progressCmp = matches.reduce((s, a) => s + parseDistanceKmUnitAware(a.distance), 0);
    } else if (goal.type === 'frequency') {
      progressCmp = matches.length;
    } else if (goal.type === 'duration') {
      progressCmp = matches.reduce((s, a) => s + parseDurationHours(a.duration), 0);
    }
  }

  const pct = targetCmp > 0 ? Math.min(100, Math.round((progressCmp / targetCmp) * 100)) : 0;
  const isComplete = targetCmp > 0 && progressCmp >= targetCmp;
  const expired = !isComplete && now >= end;
  const daysRemaining = Math.max(0, Math.ceil((end - now) / 86400000));
  // Linear pace projection: on track when the completed fraction of the target
  // is at least the elapsed fraction of the window (complete = always on
  // track; expired-incomplete = off track).
  const elapsedFrac = Math.min(1, Math.max(0, (now - start) / (end - start || 1)));
  const progressFrac = targetCmp > 0 ? progressCmp / targetCmp : 0;
  const onTrack = isComplete || (!expired && progressFrac >= elapsedFrac);
  // Distance progress is reported back in the goal's own stored unit.
  const progress = goal.type === 'distance' && goal.unit === 'mi'
    ? Math.round((progressCmp / MI_TO_KM) * 100) / 100
    : Math.round(progressCmp * 100) / 100;

  return {
    id: goal.id,
    type: goal.type,
    sport: goal.sport || null,
    unit: goal.unit || null,
    period: goal.period,
    startDate: goal.start_date,
    endDate: goal.end_date || null,
    status: goal.status,
    createdAt: goal.created_at,
    target,
    progress,
    pct,
    isComplete,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    daysRemaining,
    onTrack,
    projection: 'linear',
    state: isComplete ? 'completed' : expired ? 'expired' : 'active'
  };
}

// Validate a full goal configuration (used by both create and edit — edits
// validate the MERGED result so a partial change can't leave an invalid
// combination). Returns { error, message } or null when valid.
function validateGoalConfig(g) {
  if (!GOAL_TYPES.includes(g.type)) {
    return { error: 'invalid_type', message: 'Goal type must be one of: ' + GOAL_TYPES.join(', ') };
  }
  const target = Number(g.target_value);
  if (!Number.isFinite(target) || target <= 0) {
    return { error: 'invalid_target', message: 'Target must be a number greater than 0.' };
  }
  if (!GOAL_PERIODS.includes(g.period)) {
    return { error: 'invalid_period', message: 'Period must be one of: ' + GOAL_PERIODS.join(', ') };
  }
  if (g.sport != null && !KNOWN_SPORTS.includes(g.sport)) {
    return { error: 'invalid_sport', message: 'Unknown sport.' };
  }
  if (g.type === 'distance') {
    if (g.sport != null && !DISTANCE_SPORTS.includes(g.sport)) {
      return { error: 'sport_not_distance', message: 'Distance goals are only available for: ' + DISTANCE_SPORTS.join(', ') + ' (or leave the sport blank for any of them).' };
    }
    if (!GOAL_UNITS.includes(g.unit)) {
      return { error: 'unit_required', message: 'Distance goals need a unit of km or mi.' };
    }
  } else if (g.unit != null) {
    return { error: 'unit_not_allowed', message: 'Only distance goals take a unit.' };
  }
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (g.start_date != null && !dateRe.test(String(g.start_date))) {
    return { error: 'invalid_start_date', message: 'Start date must be YYYY-MM-DD.' };
  }
  if (g.period === 'custom') {
    if (!g.end_date || !dateRe.test(String(g.end_date))) {
      return { error: 'end_date_required', message: 'Custom goals need an end date (YYYY-MM-DD).' };
    }
    if (g.start_date && parseLocalDate(g.end_date) < parseLocalDate(g.start_date)) {
      return { error: 'invalid_end_date', message: 'End date must be on or after the start date.' };
    }
  } else if (g.end_date != null) {
    return { error: 'end_date_not_allowed', message: 'Only custom goals take an end date.' };
  }
  return null;
}

// Fetch the owner's activities once and enrich a set of goal rows (all
// window/streak math in the owner's zone).
async function enrichGoalRows(userId, rows, tz) {
  const { data: acts } = await supabaseAdmin
    .from('activities').select('sport, distance, duration, date').eq('user_id', userId);
  const activities = acts || [];
  const streaks = computeStreaks(activities, tz);
  return rows.map((g) => enrichGoal(g, activities, streaks, tz));
}

// List the signed-in user's goals, enriched, active and archived separated.
// Ungated read (self-only): lapsed subscribers keep visibility of their goals.
// Degrades gracefully (log + empty) if the goals table doesn't exist yet.
app.get(BASE + '/api/goals', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Server is not configured for goals' });
  try {
    const { data: rows, error } = await supabaseAdmin
      .from('goals').select('*').eq('user_id', req.user.id)
      .order('created_at', { ascending: true });
    if (error) {
      console.log('Goals query error (degrading to empty):', error.message);
      return res.json({ active: [], archived: [], unavailable: true });
    }
    const goals = rows || [];
    if (!goals.length) return res.json({ active: [], archived: [] });
    const enriched = await enrichGoalRows(req.user.id, goals, getUserTimezone(req.user));
    res.json({
      active: enriched.filter((g) => g.status === 'active'),
      archived: enriched.filter((g) => g.status === 'archived')
    });
  } catch (err) {
    console.log('Goals list error:', err.message);
    res.status(500).json({ error: 'Could not load goals' });
  }
});

// Create a goal — Pro-gated. Validates the type/sport/unit/period pairing and
// enforces the 5-active-goal cap with a clear 400.
app.post(BASE + '/api/goals', requireAuth, requireProPlan('goals'), async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Server is not configured for goals' });
  try {
    const b = req.body || {};
    const config = {
      type: b.type,
      sport: b.sport || null,
      target_value: b.target_value,
      unit: b.unit || null,
      period: b.period,
      start_date: b.start_date || null,
      end_date: b.end_date || null
    };
    const invalid = validateGoalConfig(config);
    if (invalid) return res.status(400).json(invalid);

    // Soft cap: count-then-insert is racy under concurrent creates, which is
    // acceptable for a UX limit (worst case a user briefly exceeds 5 — nothing
    // breaks; the list just shows more goals).
    const { count: activeCount } = await supabaseAdmin
      .from('goals').select('*', { count: 'exact', head: true })
      .eq('user_id', req.user.id).eq('status', 'active');
    if ((activeCount || 0) >= MAX_ACTIVE_GOALS) {
      return res.status(400).json({
        error: 'goal_limit',
        message: `You can have up to ${MAX_ACTIVE_GOALS} active goals — archive one to add another.`
      });
    }

    const insert = {
      user_id: req.user.id,
      type: config.type,
      sport: config.sport,
      target_value: Number(config.target_value),
      unit: config.type === 'distance' ? config.unit : null,
      period: config.period,
      end_date: config.period === 'custom' ? config.end_date : null
    };
    if (config.start_date) insert.start_date = config.start_date;
    const { data: row, error } = await supabaseAdmin
      .from('goals').insert(insert).select().single();
    if (error) {
      console.log('Goal create error:', error.message);
      return res.status(500).json({ error: 'Could not create goal' });
    }
    const [enriched] = await enrichGoalRows(req.user.id, [row], getUserTimezone(req.user));
    res.json({ goal: enriched });
  } catch (err) {
    console.log('Goal create error:', err.message);
    res.status(500).json({ error: 'Could not create goal' });
  }
});

// Look up a goal row and enforce self-only ownership. Replies on res and
// returns null when the caller should stop.
async function loadOwnGoal(req, res) {
  const { data: row, error } = await supabaseAdmin
    .from('goals').select('*').eq('id', req.params.id).maybeSingle();
  if (error) {
    console.log('Goal lookup error:', error.message);
    res.status(500).json({ error: 'Could not load goal' });
    return null;
  }
  if (!row) { res.status(404).json({ error: 'not_found' }); return null; }
  if (row.user_id !== req.user.id) { res.status(403).json({ error: 'forbidden' }); return null; }
  return row;
}

// Edit a goal — Pro-gated, self-only, editable fields only (type and status
// are immutable here; archiving has its own ungated route). The merged result
// is re-validated so partial edits can't produce an invalid combination.
app.patch(BASE + '/api/goals/:id', requireAuth, requireProPlan('goals'), async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Server is not configured for goals' });
  try {
    const row = await loadOwnGoal(req, res);
    if (!row) return;
    const b = req.body || {};
    if (b.type !== undefined && b.type !== row.type) {
      return res.status(400).json({ error: 'immutable_field', message: 'A goal\'s type cannot change — archive it and create a new one.' });
    }
    if (b.status !== undefined) {
      return res.status(400).json({ error: 'immutable_field', message: 'Use the archive endpoint to change a goal\'s status.' });
    }
    const editable = ['target_value', 'sport', 'unit', 'period', 'start_date', 'end_date'];
    const updates = {};
    editable.forEach((f) => { if (b[f] !== undefined) updates[f] = b[f] === '' ? null : b[f]; });
    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'no_editable_fields', message: 'Nothing to update.' });
    }
    const merged = { ...row, ...updates };
    // Period changes away from custom drop the end date; distance stays the
    // only type carrying a unit.
    if (merged.period !== 'custom') merged.end_date = updates.end_date !== undefined ? updates.end_date : null;
    const invalid = validateGoalConfig(merged);
    if (invalid) return res.status(400).json(invalid);
    const { data: saved, error } = await supabaseAdmin
      .from('goals')
      .update({
        target_value: Number(merged.target_value),
        sport: merged.sport,
        unit: merged.type === 'distance' ? merged.unit : null,
        period: merged.period,
        start_date: merged.start_date,
        end_date: merged.period === 'custom' ? merged.end_date : null,
        updated_at: new Date().toISOString()
      })
      .eq('id', row.id).select().single();
    if (error) {
      console.log('Goal update error:', error.message);
      return res.status(500).json({ error: 'Could not update goal' });
    }
    const [enriched] = await enrichGoalRows(req.user.id, [saved], getUserTimezone(req.user));
    res.json({ goal: enriched });
  } catch (err) {
    console.log('Goal update error:', err.message);
    res.status(500).json({ error: 'Could not update goal' });
  }
});

// Archive a goal — ungated exit action (requireAuth + self-only): a lapsed
// subscriber must always be able to put their goals away.
app.post(BASE + '/api/goals/:id/archive', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Server is not configured for goals' });
  try {
    const row = await loadOwnGoal(req, res);
    if (!row) return;
    const { error } = await supabaseAdmin
      .from('goals')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) {
      console.log('Goal archive error:', error.message);
      return res.status(500).json({ error: 'Could not archive goal' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.log('Goal archive error:', err.message);
    res.status(500).json({ error: 'Could not archive goal' });
  }
});

// Delete a goal — ungated exit action (requireAuth + self-only), hard delete.
app.delete(BASE + '/api/goals/:id', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Server is not configured for goals' });
  try {
    const row = await loadOwnGoal(req, res);
    if (!row) return;
    const { error } = await supabaseAdmin.from('goals').delete().eq('id', row.id);
    if (error) {
      console.log('Goal delete error:', error.message);
      return res.status(500).json({ error: 'Could not delete goal' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.log('Goal delete error:', err.message);
    res.status(500).json({ error: 'Could not delete goal' });
  }
});

// ── PLANNED TRAINING (planned_sessions) ──
// Prospective sessions shown on the Calendar page. The table is user-provisioned
// (no DDL via service role) so every read degrades to empty if it's missing.
// Reads are free (the calendar view is free content); writes are Pro-gated via
// requireProPlan('training_plan') — dormant unless PLAN_GATES_ENABLED, exactly
// like goals. Plan dates are plain 'YYYY-MM-DD' local-date strings (goals
// convention, parseLocalDate rule) — never timestamps, so no timezone drift.
const PLAN_STATUSES = ['planned', 'done', 'skipped'];
const PLAN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Validate create/edit fields. `partial` allows PATCH to send a subset; the
// merged row is what gets checked. Returns an { error, message } or null.
function validatePlanFields(p) {
  if (!PLAN_DATE_RE.test(String(p.date || ''))) {
    return { error: 'invalid_date', message: 'Date must be YYYY-MM-DD.' };
  }
  const [y, m, d] = String(p.date).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    return { error: 'invalid_date', message: 'That date does not exist.' };
  }
  if (!KNOWN_SPORTS.includes(p.sport)) {
    return { error: 'invalid_sport', message: 'Unknown sport.' };
  }
  if (!PLAN_STATUSES.includes(p.status)) {
    return { error: 'invalid_status', message: 'Status must be planned, done or skipped.' };
  }
  if (p.title != null && String(p.title).length > 120) {
    return { error: 'title_too_long', message: 'Title must be 120 characters or fewer.' };
  }
  if (p.planned_duration != null && String(p.planned_duration).length > 20) {
    return { error: 'duration_too_long', message: 'Duration must be 20 characters or fewer.' };
  }
  if (p.notes != null && String(p.notes).length > 500) {
    return { error: 'notes_too_long', message: 'Notes must be 500 characters or fewer.' };
  }
  return null;
}

// Look up a plan row and enforce self-only ownership (loadOwnGoal pattern).
async function loadOwnPlan(req, res) {
  const { data: row, error } = await supabaseAdmin
    .from('planned_sessions').select('*').eq('id', req.params.id).maybeSingle();
  if (error) {
    console.log('Plan lookup error:', error.message);
    res.status(500).json({ error: 'Could not load plan' });
    return null;
  }
  if (!row) { res.status(404).json({ error: 'not_found' }); return null; }
  if (row.user_id !== req.user.id) { res.status(403).json({ error: 'forbidden' }); return null; }
  return row;
}

// List the viewer's plans — free, self-only. Optional ?month=YYYY-MM window
// (text comparison is safe on YYYY-MM-DD strings). Missing table → empty list.
app.get(BASE + '/api/plans', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ plans: [] });
  try {
    let q = supabaseAdmin.from('planned_sessions').select('*')
      .eq('user_id', req.user.id).order('date', { ascending: true });
    if (typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)) {
      const [y, m] = req.query.month.split('-').map(Number);
      const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
      q = q.gte('date', req.query.month + '-01').lt('date', next + '-01');
    }
    const { data, error } = await q;
    if (error) {
      console.log('Plans list error (degrading to empty):', error.message);
      return res.json({ plans: [] });
    }
    res.json({ plans: await attachPlanSeries(data || []) });
  } catch (err) {
    console.log('Plans list error:', err.message);
    res.json({ plans: [] });
  }
});

// ── Recurrence (plan_series + materialized occurrences) ──
// A recurring plan is a plan_series rule row plus ordinary planned_sessions
// rows materialized up front (one per occurrence, linked via series_id).
// Materialize-not-expand: every existing read/complete/skip/log path works on
// occurrences unchanged, and occurrence state (done/skipped/moved/linked)
// lives where it always lived. The horizon is a REQUIRED end date, capped
// server-side (the form's copy states the exact count being created).
const PLAN_FREQUENCIES = ['daily', 'weekly', 'biweekly'];
// All stepping is integer Y-M-D math on zone-less text dates (calendar
// convention) — never timestamp addition, so DST can't skew biweekly parity.
function planYmdAdd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}
// Inclusive expansion; caller has validated both dates. Hard row cap keeps a
// runaway range from mass-inserting (server truth — the form mirrors it).
const PLAN_MAX_OCCURRENCES = 100;
const PLAN_MAX_SPAN_DAYS = { daily: 92, weekly: 366, biweekly: 366 };
function expandRecurrence(startYmd, frequency, untilYmd) {
  const step = frequency === 'daily' ? 1 : frequency === 'weekly' ? 7 : 14;
  const dates = [];
  for (let d = startYmd; d <= untilYmd; d = planYmdAdd(d, step)) {
    dates.push(d);
    if (dates.length > PLAN_MAX_OCCURRENCES) break; // caller rejects; don't loop further
  }
  return dates;
}
function planSpanDays(startYmd, untilYmd) {
  const p = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(untilYmd) - p(startYmd)) / 86400000);
}

// Attach series summaries to plan rows: strips nothing, adds `series:
// {frequency, weekday, start_date, end_date}` when a row belongs to one (the
// day panel's "Part of a series" line + client delete choice). Missing
// plan_series table degrades to plain rows — never crashes a read.
async function attachPlanSeries(plans) {
  const ids = [...new Set((plans || []).map(p => p.series_id).filter(Boolean))];
  if (!ids.length) return plans;
  const { data, error } = await supabaseAdmin
    .from('plan_series').select('id, frequency, weekday, start_date, end_date').in('id', ids);
  if (error) { console.log('Plan series lookup (degrading):', error.message); return plans; }
  const byId = {};
  (data || []).forEach(s => { byId[s.id] = { frequency: s.frequency, weekday: s.weekday, start_date: s.start_date, end_date: s.end_date }; });
  plans.forEach(p => { if (p.series_id && byId[p.series_id]) p.series = byId[p.series_id]; });
  return plans;
}

// Create a plan — Pro-gated (dormant while PLAN_GATES_ENABLED is off).
// Optional `recurrence: {frequency, until}` creates a series: ONE gated create
// materializes every occurrence (single atomic batch insert; a failed batch
// rolls the series row back — never a silent partial series).
app.post(BASE + '/api/plans', requireAuth, requireProPlan('training_plan'), async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Server is not configured for plans' });
  try {
    const b = req.body || {};
    const fields = {
      date: b.date,
      sport: b.sport,
      title: b.title != null ? String(b.title).trim() || null : null,
      planned_duration: b.planned_duration != null ? String(b.planned_duration).trim() || null : null,
      notes: b.notes != null ? String(b.notes).trim() || null : null,
      status: 'planned' // creation always starts planned; done/skipped are transitions
    };
    const invalid = validatePlanFields(fields);
    if (invalid) return res.status(400).json(invalid);

    const rec = b.recurrence;
    if (rec == null || rec === 'none' || rec.frequency === 'none') {
      const { data: row, error } = await supabaseAdmin
        .from('planned_sessions').insert({ user_id: req.user.id, ...fields }).select().single();
      if (error) {
        console.log('Plan create error:', error.message);
        return res.status(500).json({ error: 'Could not create plan' });
      }
      return res.json({ plan: row });
    }

    // ── Recurring create ──
    if (typeof rec !== 'object' || !PLAN_FREQUENCIES.includes(rec.frequency)) {
      return res.status(400).json({ error: 'invalid_recurrence', message: 'Repeat must be daily, weekly or biweekly.' });
    }
    const until = String(rec.until || '');
    if (!PLAN_DATE_RE.test(until)) {
      return res.status(400).json({ error: 'invalid_recurrence', message: 'A recurring plan needs an end date.' });
    }
    if (until <= fields.date) {
      return res.status(400).json({ error: 'invalid_recurrence', message: 'The end date must be after the first session.' });
    }
    const span = planSpanDays(fields.date, until);
    if (span > PLAN_MAX_SPAN_DAYS[rec.frequency]) {
      return res.status(400).json({
        error: 'recurrence_too_long',
        message: rec.frequency === 'daily'
          ? 'Daily plans can run at most 3 months — shorten the end date.'
          : 'Recurring plans can run at most 12 months — shorten the end date.'
      });
    }
    const dates = expandRecurrence(fields.date, rec.frequency, until);
    if (dates.length > PLAN_MAX_OCCURRENCES) {
      return res.status(400).json({ error: 'recurrence_too_long', message: 'That would create more than ' + PLAN_MAX_OCCURRENCES + ' sessions — shorten the end date.' });
    }
    // Weekday convention: 0=Mon..6=Sun (Monday-week rule app-wide); null for daily.
    const [sy, sm, sd] = fields.date.split('-').map(Number);
    const weekday = rec.frequency === 'daily' ? null : (new Date(sy, sm - 1, sd).getDay() + 6) % 7;
    const { data: series, error: sErr } = await supabaseAdmin.from('plan_series').insert({
      user_id: req.user.id, frequency: rec.frequency, weekday,
      start_date: fields.date, end_date: until,
      sport: fields.sport, title: fields.title,
      planned_duration: fields.planned_duration, notes: fields.notes
    }).select().single();
    if (sErr) {
      console.log('Plan series create error:', sErr.message);
      return res.status(503).json({ error: 'recurrence_unavailable', message: 'Recurring plans are unavailable right now.' });
    }
    const { data: rows, error: oErr } = await supabaseAdmin.from('planned_sessions')
      .insert(dates.map(d => ({ user_id: req.user.id, ...fields, date: d, series_id: series.id })))
      .select();
    if (oErr) {
      console.log('Plan series occurrences error (rolling back series):', oErr.message);
      const { error: rbErr } = await supabaseAdmin.from('plan_series').delete().eq('id', series.id);
      if (rbErr) console.log('Plan series rollback error:', rbErr.message);
      return res.status(500).json({ error: 'Could not create the recurring plan' });
    }
    res.json({ plans: rows, count: rows.length, series: { id: series.id, frequency: series.frequency, weekday: series.weekday, end_date: series.end_date } });
  } catch (err) {
    console.log('Plan create error:', err.message);
    res.status(500).json({ error: 'Could not create plan' });
  }
});

// Edit a plan — Pro-gated for content edits, self-only. Editable: date, sport,
// title, duration, notes, status (whitelisted). activity_id is NOT
// client-writable — it is set server-side by the "Log this" flow so a plan can
// never claim an activity the user didn't log through it.
// STATUS-ONLY updates are exempt from the Pro gate (ungated-exit rule): a
// lapsed user must always be able to close out old plans (mark done/skipped) —
// marking done conceptually rides with activity logging, which is free. The
// gate applies only when the request edits anything beyond `status`.
app.patch(BASE + '/api/plans/:id', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Server is not configured for plans' });
  try {
    const b = req.body || {};
    const editedKeys = Object.keys(b).filter((k) => b[k] !== undefined);
    const statusOnly = editedKeys.length > 0 && editedKeys.every((k) => k === 'status');
    if (!statusOnly && PLAN_GATES_ENABLED) {
      const plan = await getUserPlan(req.user.id);
      if (plan === 'free') {
        return res.status(403).json({ error: 'pro_required', feature: 'training_plan', upgrade: '/billing' });
      }
    }
    const row = await loadOwnPlan(req, res);
    if (!row) return;
    const merged = {
      date: b.date !== undefined ? b.date : row.date,
      sport: b.sport !== undefined ? b.sport : row.sport,
      title: b.title !== undefined ? (b.title != null ? String(b.title).trim() || null : null) : row.title,
      planned_duration: b.planned_duration !== undefined ? (b.planned_duration != null ? String(b.planned_duration).trim() || null : null) : row.planned_duration,
      notes: b.notes !== undefined ? (b.notes != null ? String(b.notes).trim() || null : null) : row.notes,
      status: b.status !== undefined ? b.status : row.status
    };
    const invalid = validatePlanFields(merged);
    if (invalid) return res.status(400).json(invalid);
    // Detach ONLY on a date change: a moved occurrence genuinely no longer
    // matches the series pattern. Content edits (title/sport/duration/notes/
    // status) keep the row in its series — silent detachment there would make
    // "this and all future" mysteriously spare an edited session.
    const detached = !!(row.series_id && merged.date !== row.date);
    const patch = { ...merged, updated_at: new Date().toISOString() };
    if (detached) patch.series_id = null;
    const { data: updated, error } = await supabaseAdmin
      .from('planned_sessions')
      .update(patch)
      .eq('id', row.id).eq('user_id', req.user.id)
      .select().single();
    if (error) {
      console.log('Plan update error:', error.message);
      return res.status(500).json({ error: 'Could not update plan' });
    }
    res.json(detached ? { plan: updated, detached: true } : { plan: updated });
  } catch (err) {
    console.log('Plan update error:', err.message);
    res.status(500).json({ error: 'Could not update plan' });
  }
});

// Delete a plan — self-only, NEVER Pro-gated (ungated-exit rule, same as
// leaving a club: a lapsed user can always remove their own data).
// `?scope=future` on a series occurrence also removes every LATER attached
// occurrence that is still `planned` — done/skipped history is never
// destroyed, and date-moved occurrences have already detached (series_id
// null) so a future-delete can't touch them. When no attached rows remain,
// the series rule row is tidied away too.
app.delete(BASE + '/api/plans/:id', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Server is not configured for plans' });
  try {
    const row = await loadOwnPlan(req, res);
    if (!row) return;
    const future = req.query.scope === 'future' && !!row.series_id;
    let deleted = 0;
    if (future) {
      const { data: gone, error } = await supabaseAdmin
        .from('planned_sessions').delete()
        .eq('series_id', row.series_id).eq('user_id', req.user.id)
        .gte('date', row.date).eq('status', 'planned')
        .select('id');
      if (error) {
        console.log('Plan future-delete error:', error.message);
        return res.status(500).json({ error: 'Could not delete plans' });
      }
      deleted = (gone || []).length;
      // The anchor row itself might be done/skipped (user picked "this and
      // future" from a closed occurrence) — it still goes, explicitly.
      if (!(gone || []).some(g => g.id === row.id)) {
        const { error: aErr } = await supabaseAdmin
          .from('planned_sessions').delete().eq('id', row.id).eq('user_id', req.user.id);
        if (aErr) {
          console.log('Plan anchor-delete error:', aErr.message);
          return res.status(500).json({ error: 'Could not delete plans' });
        }
        deleted += 1;
      }
    } else {
      const { error } = await supabaseAdmin
        .from('planned_sessions').delete().eq('id', row.id).eq('user_id', req.user.id);
      if (error) {
        console.log('Plan delete error:', error.message);
        return res.status(500).json({ error: 'Could not delete plan' });
      }
      deleted = 1;
    }
    // Tidy the series rule when its last attached occurrence is gone
    // (best-effort — an orphan rule row is harmless and swept on account delete).
    if (row.series_id) {
      const { data: left, error: cErr } = await supabaseAdmin
        .from('planned_sessions').select('id').eq('series_id', row.series_id).limit(1);
      if (!cErr && (left || []).length === 0) {
        const { error: sErr } = await supabaseAdmin.from('plan_series').delete().eq('id', row.series_id);
        if (sErr) console.log('Plan series tidy error:', sErr.message);
      }
    }
    res.json({ ok: true, deleted });
  } catch (err) {
    console.log('Plan delete error:', err.message);
    res.status(500).json({ error: 'Could not delete plan' });
  }
});

// ── CALENDAR MONTH DATA ──
// Everything the calendar shows for one month, in ~5 queries: the viewer's
// club events + own-RSVP'd events windowed to the month, own activities, own
// plans. Month param is regex-validated YYYY-MM and all boundary math is
// integer year/month arithmetic (reports-tab precedent — never Date→toISOString
// month strings, which skew in non-UTC locales). The event/activity window is
// widened by one day on each side because timestamps are bucketed by LOCAL
// date parts on the client: a local-evening activity near a month boundary can
// live in the neighbouring UTC month. The client filters to the exact local
// month, so the overlap costs a few extra rows, never a wrong day.
app.get(BASE + '/api/calendar/month', requireAuth, async (req, res) => {
  const empty = { events: [], activities: [], plans: [] };
  // Default month: server-local today (client always passes its own).
  const now = new Date();
  const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthParam = (typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month))
    ? req.query.month : fallback;
  const [year, month] = monthParam.split('-').map(Number);
  if (month < 1 || month > 12) return res.status(400).json({ error: 'invalid_month' });
  if (!supabaseAdmin) return res.json({ month: monthParam, ...empty });
  try {
    const userId = req.user.id;
    // Window widened ±8 days: ±1 is required by the GRID itself (timestamps
    // are bucketed by local date parts — a local-evening item near a month
    // edge lives in the neighbouring UTC month); the WEEK VIEW additionally
    // needs the current week's overlap into a neighbor month (up to 6 days
    // for a Monday-start week) plus tz skew. The client still trims the grid
    // to the exact local month; the extra rows feed only the week view's
    // neighbour-month days (and the day panel opened from them).
    const winStart = new Date(year, month - 1, 1);
    winStart.setDate(winStart.getDate() - 8);
    const winEnd = new Date(year, month, 1);
    winEnd.setDate(winEnd.getDate() + 8);
    const startIso = winStart.toISOString();
    const endIso = winEnd.toISOString();
    // Plan window in plain YYYY-MM-DD text (lexicographic compare is safe),
    // widened ±7 days for the same week-overlap reason — local date math only,
    // never toISOString (UTC skew).
    const fmtYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const planStart = fmtYmd(new Date(year, month - 1, 1 - 7));
    const planEnd = fmtYmd(new Date(year, month, 1 + 7)); // exclusive upper bound

    const { data: memberships } = await supabaseAdmin
      .from('memberships').select('club_id').eq('user_id', userId);
    const clubIds = [...new Set((memberships || []).map(m => m.club_id).filter(Boolean))];

    const [clubEventsRes, myRsvpsRes, activitiesRes, plansRes] = await Promise.all([
      clubIds.length
        ? supabaseAdmin.from('events').select('*').in('club_id', clubIds)
            .gte('date', startIso).lt('date', endIso)
        : Promise.resolve({ data: [] }),
      supabaseAdmin.from('event_rsvps').select('event_id, status').eq('user_id', userId),
      supabaseAdmin.from('activities')
        .select('id, sport, title, distance, duration, date')
        .eq('user_id', userId).gte('date', startIso).lt('date', endIso),
      supabaseAdmin.from('planned_sessions').select('*').eq('user_id', userId)
        .gte('date', planStart).lt('date', planEnd)
    ]);

    const clubEvents = clubEventsRes.data || [];
    const myRsvpRows = myRsvpsRes.data || [];
    const rsvpByEvent = {};
    myRsvpRows.forEach(r => { if (r.event_id) rsvpByEvent[r.event_id] = r.status; });

    // Events the viewer RSVP'd to that are NOT club events already fetched
    // (public events, other clubs' events they were invited into, etc.).
    const clubEventIds = new Set(clubEvents.map(e => e.id));
    const extraIds = myRsvpRows
      .map(r => r.event_id)
      .filter(id => id && !clubEventIds.has(id) && rsvpByEvent[id] !== 'cancelled');
    let extraEvents = [];
    if (extraIds.length) {
      const { data } = await supabaseAdmin.from('events').select('*')
        .in('id', [...new Set(extraIds)]).gte('date', startIso).lt('date', endIso);
      // Visibility gate: a pre-gate RSVP must not keep resurfacing an event
      // the viewer can no longer see (THE event access rule, not query shape).
      extraEvents = await visibleEventsFilter(userId, data || []);
    }

    // Honesty partition: myStatus is 'going' / 'interested' for real RSVPs,
    // 'none' (Not responded) for club events the viewer never answered. A
    // CANCELLED RSVP never renders as a commitment: on a club event it falls
    // back to 'none' (the event still exists for the club); on a non-club
    // event the row is dropped entirely (the RSVP was its only link to the
    // viewer's calendar).
    const allEvents = [...clubEvents, ...extraEvents];
    const clubNameIds = [...new Set(allEvents.map(e => e.club_id).filter(Boolean))];
    const clubMap = {};
    if (clubNameIds.length) {
      const { data: clubsData } = await supabaseAdmin
        .from('clubs').select('id, name').in('id', clubNameIds);
      (clubsData || []).forEach(c => { clubMap[c.id] = c.name; });
    }
    const events = allEvents
      .map(e => {
        const raw = rsvpByEvent[e.id] || null;
        const myStatus = (raw === 'going' || raw === 'interested') ? raw : 'none';
        return {
          id: e.id, title: e.title, sport: e.sport, date: e.date,
          location: e.location || null, event_type: e.event_type || null,
          club_id: e.club_id || null, club_name: e.club_id ? (clubMap[e.club_id] || null) : null,
          image: eventImageVersion(e.image_path),
          myStatus
        };
      })
      .filter(e => !(e.myStatus === 'none' && !e.club_id));

    // Missing planned_sessions table degrades to empty, never crashes the page.
    if (plansRes.error) console.log('Calendar plans error (degrading to empty):', plansRes.error.message);

    res.json({
      month: monthParam,
      events,
      activities: activitiesRes.data || [],
      plans: await attachPlanSeries(plansRes.data || [])
    });
  } catch (err) {
    console.log('Calendar month error:', err.message);
    res.json({ month: monthParam, ...empty });
  }
});

// Calendar page — standard shell composition. Injects the sidebar clubs, the
// viewer's identity, and the proLocked gating flag (the read-only day panel is
// free; the flag is for Session ②'s plan-creation affordances).
app.get(BASE + '/calendar', requirePageAuth, async (req, res) => {
  try {
    if (!supabaseAdmin) return sendPageError(res);
    const data = {
      userId: req.user.id,
      profile: displayFromUser(req.user),
      clubs: await getSidebarClubs(req.user.id),
      gating: { proLocked: await computeProLocked(req.user.id) }
    };
    const html = injectProBadge(
      injectBottomNav(
        injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-calendar.html'), 'utf8'), data),
        'calendar'
      ),
      (await getUserPlan(req.user.id)) === 'pro'
    );
    res.type('html').send(html);
  } catch (err) {
    console.log('Calendar page error:', err.message);
    sendPageError(res);
  }
});

// Log-activity page — the standalone home of the activity entry form (moved
// out of the profile's Activities tab). Standard shell composition like
// /calendar. Logging is a free feature — plan-linking included — so no
// proLocked flag is injected here.
app.get(BASE + '/log', requirePageAuth, async (req, res) => {
  try {
    if (!supabaseAdmin) return sendPageError(res);
    const data = {
      userId: req.user.id,
      profile: displayFromUser(req.user),
      clubs: await getSidebarClubs(req.user.id)
    };
    const html = injectProBadge(
      injectBottomNav(
        injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-log.html'), 'utf8'), data),
        'log'
      ),
      (await getUserPlan(req.user.id)) === 'pro'
    );
    res.type('html').send(html);
  } catch (err) {
    console.log('Log page error:', err.message);
    sendPageError(res);
  }
});

// Persist a single Settings toggle preference. Flip = save (no separate save
// button). Whitelisted keys, boolean values only. updateUserById merges
// top-level metadata but replaces nested objects wholesale, so the prefs
// object is read (fresh via requireAuth's getUser) and merged here before the
// write — a key missing from this request keeps its stored value.
app.post(BASE + '/api/profile/prefs', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
  const key = req.body && req.body.key;
  const value = req.body && req.body.value;
  if (!PREF_KEYS.includes(key) || typeof value !== 'boolean') {
    return res.status(400).json({ error: 'Invalid preference' });
  }
  try {
    const current = (req.user.user_metadata && req.user.user_metadata.prefs) || {};
    const prefs = Object.assign({}, current, { [key]: value });
    const { error } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, {
      user_metadata: { prefs }
    });
    if (error) return res.status(500).json({ error: 'Could not save your setting' });
    res.json({ ok: true, prefs: prefsFromMeta({ prefs }) });
  } catch (err) {
    console.log('Prefs update error:', err.message);
    res.status(500).json({ error: 'Could not save your setting' });
  }
});

// Lightweight mark-seen for the profile tab badges: opening a counted tab
// stamps that tab's last-seen to NOW in user_metadata.tab_seen (read-merge-
// write, same pattern as prefs), which clears its "new since last viewed"
// badge across reloads AND other devices — the state is account-level, not
// per-browser.
app.post(BASE + '/api/profile/tab-seen', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
  const tab = req.body && req.body.tab;
  if (!TAB_SEEN_KEYS.includes(tab)) return res.status(400).json({ error: 'Invalid tab' });
  try {
    const current = (req.user.user_metadata && typeof req.user.user_metadata.tab_seen === 'object' && !Array.isArray(req.user.user_metadata.tab_seen)) ? req.user.user_metadata.tab_seen : {};
    const tab_seen = Object.assign({}, current, { [tab]: new Date().toISOString() });
    const { error } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, { user_metadata: { tab_seen } });
    if (error) return res.status(500).json({ error: 'Could not update' });
    res.json({ ok: true });
  } catch (err) {
    console.log('Tab seen error:', err.message);
    res.status(500).json({ error: 'Could not update' });
  }
});

// Persist profile edits. There is no `profiles` table, so changes are written to
// the user's auth metadata (name/handle/bio/location), merged over any existing
// metadata so unrelated keys are preserved. Returns JSON for the edit form fetch.
app.post(BASE + '/api/profile/update', requireAuth, async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
    const body = req.body || {};
    const meta = Object.assign({}, req.user.user_metadata || {});
    if (typeof body.name === 'string') {
      const name = body.name.trim();
      if (!name) return res.status(400).json({ error: 'Name cannot be empty' });
      if (name.length > 80) return res.status(400).json({ error: 'Name is too long' });
      meta.name = name;
    }
    if (typeof body.handle === 'string') {
      const handle = body.handle.trim().replace(/^@+/, '');
      if (handle.length > 40) return res.status(400).json({ error: 'Handle is too long' });
      meta.handle = handle;
    }
    if (typeof body.location === 'string') meta.location = body.location.trim().slice(0, 120);
    // Structured country/state. Codes only, validated against the registry.
    // Country is processed BEFORE state so the state guard sees the country
    // from this same payload. Empty string clears. State is US-only: any
    // country change away from 'US' auto-clears a stored state (the
    // "stale CA after moving to France" guard), and a state sent alongside a
    // non-US country is dropped rather than rejected.
    // Clears MUST be explicit nulls, never `delete`: updateUserById MERGES
    // user_metadata, so a key missing from the payload keeps its old value —
    // deleting from the local copy is a silent no-op against storage.
    if (typeof body.country === 'string') {
      const c = body.country.trim().toUpperCase();
      if (!c) {
        meta.country = null;
        meta.state = null;
      } else if (!COUNTRY_NAMES[c]) {
        return res.status(400).json({ error: 'Invalid country' });
      } else {
        meta.country = c;
        if (c !== 'US') meta.state = null;
      }
    }
    if (typeof body.state === 'string') {
      const s = body.state.trim().toUpperCase();
      if (!s || meta.country !== 'US') {
        meta.state = null;
      } else if (!US_STATE_NAMES[s]) {
        return res.status(400).json({ error: 'Invalid state' });
      } else {
        meta.state = s;
      }
    }
    // Timezone override. A zone name sets a MANUAL override (wins over the
    // per-login auto-capture until cleared); empty string returns to auto —
    // adopting the browser zone sent alongside (browserTz) immediately when
    // valid, otherwise keeping the stored zone until the next login refresh.
    // Invalid zone names are rejected, never silently stored.
    if (typeof body.timezone === 'string') {
      const zone = body.timezone.trim();
      if (!zone) {
        meta.timezone_source = 'auto';
        const btz = typeof body.browserTz === 'string' ? body.browserTz.trim() : '';
        if (btz && isValidTimezone(btz)) meta.timezone = btz;
      } else if (!isValidTimezone(zone)) {
        return res.status(400).json({ error: 'Invalid timezone' });
      } else {
        meta.timezone = zone;
        meta.timezone_source = 'manual';
      }
    }
    // Bio: 220-word limit (word = whitespace-separated token — trim, split on
    // /\s+/, count non-empty tokens; the Settings counter uses the identical
    // rule) plus a 2,000-char ceiling as a backstop against no-space abuse.
    // Over-limit input is REJECTED with a 400, never silently truncated (the
    // old .slice(0, 600) cap cut stored bios off mid-word). Existing stored
    // bios are never touched here — the limit applies only to new saves.
    if (typeof body.bio === 'string') {
      const bio = body.bio.trim();
      if (bio.length > 2000) return res.status(400).json({ error: 'Bio is too long (2,000 character max)' });
      const bioWords = bio ? bio.split(/\s+/).length : 0;
      if (bioWords > 220) return res.status(400).json({ error: 'Bio is too long (220 word max)' });
      meta.bio = bio;
    }
    // "Your sports" chips (settings). Only registry ids are accepted; deduped
    // and capped at the registry size (now 12). An empty array clears the list.
    if (Array.isArray(body.sports)) {
      const cleaned = [];
      for (const s of body.sports) {
        if (typeof s !== 'string') return res.status(400).json({ error: 'Invalid sports selection' });
        const id = s.trim().toLowerCase();
        if (!KNOWN_SPORTS.includes(id)) return res.status(400).json({ error: 'Invalid sports selection' });
        if (!cleaned.includes(id)) cleaned.push(id);
      }
      if (cleaned.length > KNOWN_SPORTS.length) return res.status(400).json({ error: 'Too many sports' });
      meta.sports = cleaned;
    }
    // Never carry the prefs subobject through this route. updateUserById merges
    // top-level keys but REPLACES nested objects, so including the (possibly
    // stale) prefs copy here would clobber a settings toggle flipped between
    // this request's auth lookup and its write. Omitting the key keeps the
    // stored prefs untouched; /api/profile/prefs is the only prefs writer.
    delete meta.prefs;
    const { error } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, { user_metadata: meta });
    if (error) {
      console.log('Profile update error:', error.message);
      return res.status(500).json({ error: error.message });
    }
    res.json({ success: true });
  } catch (err) {
    console.log('Profile update error:', err.message);
    res.status(500).json({ error: 'Update failed' });
  }
});

// ── ACCOUNT EXPORT & DELETION (Danger zone, real) ──

// Paged fetch so exports/deletes never silently truncate at PostgREST's
// default 1000-row page. Returns ALL matching rows.
async function fetchAllRows(table, applyFilters, columns) {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    // Explicit column lists on export reads: a future column addition must
    // never silently widen the export (third-party-data rule). '*' remains
    // only for internal (non-emitted) uses.
    let q = supabaseAdmin.from(table).select(columns || '*').range(from, from + PAGE - 1);
    q = applyFilters(q);
    const { data, error } = await q;
    if (error) throw new Error(table + ': ' + error.message);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

// Full-coverage data export. One structured JSON document, downloaded
// directly (no email queue — instant download is simpler and more honest).
// The avatar is included as its public URL rather than embedded bytes: the
// bucket is public, the URL is durable, and a single JSON file keeps the
// export dependency-free (no zip library, nothing to stream).
app.get(BASE + '/api/account/export', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
  const uid = req.user.id;
  const email = req.user.email || null;
  try {
    const meta = req.user.user_metadata || {};
    // ── EXPORT PRIVACY RULES (export_version 2) ──
    // 1. PROVENANCE: an email or identifier appears only if the requesting
    //    user supplied it. Their own email/account id stay; club-invite
    //    emails THEY typed stay (their own input). Anything the system would
    //    be revealing (another account's email, any address the user never
    //    typed) must never be emitted.
    // 2. PEOPLE: other people render as { name, handle } via
    //    buildUserProfileMap — never raw user ids, never emails.
    // 3. NO RAW UUIDs: internal row/entity ids are not the user's data and
    //    could be (or point at) other people — none are emitted. References
    //    render human-readable instead (club name+handle, challenge title,
    //    event title, post author). account.id is the single exception: it is
    //    the requester's own identifier.
    // 4. NO CAPABILITY SECRETS: club-invite tokens are live redemption
    //    secrets and are never exported.
    // Guard: scripts/verify-export-invites.js asserts all of this.
    const ownedClubs = await fetchAllRows('clubs', q => q.eq('owner_id', uid),
      'id, name, handle, sport, city, created_at, logo_url');
    const ownedClubIds = ownedClubs.map(c => c.id);
    const [
      activities, posts, postComments, postLikes,
      following, followers, goals, plannedSessions, planSeries, achievements,
      notificationsReceived, notificationsTriggered,
      eventRsvps, eventsCreated, challengesCreated, challengeParticipations,
      memberships, clubInvitesSent, userSubs
    ] = await Promise.all([
      fetchAllRows('activities', q => q.eq('user_id', uid),
        'sport, title, date, duration, notes, feeling, distance, pace, avg_hr, elevation, cadence, run_type, avg_power, avg_speed, ride_type, top_grade, project_grade, problems_count, climbing_style, climb_location, swim_pace, pool_type, stroke, session_type, position, session_focus, total_volume, top_lift, sets_completed, rpe, trail, terrain, pack_weight, yoga_style, yoga_format, focus_area, instructor, created_at, golf_strokes, golf_course'),
      fetchAllRows('posts', q => q.eq('user_id', uid), 'content, sport, feeling, created_at'),
      fetchAllRows('post_comments', q => q.eq('user_id', uid), 'post_id, content, created_at'),
      fetchAllRows('post_likes', q => q.eq('user_id', uid), 'post_id, created_at'),
      fetchAllRows('follows', q => q.eq('follower_id', uid), 'following_id, created_at'),
      fetchAllRows('follows', q => q.eq('following_id', uid), 'follower_id, created_at'),
      fetchAllRows('goals', q => q.eq('user_id', uid),
        'type, sport, target_value, unit, period, start_date, end_date, status, created_at, updated_at'),
      fetchAllRows('planned_sessions', q => q.eq('user_id', uid),
        'date, sport, title, planned_duration, notes, status, created_at, updated_at'),
      fetchAllRows('plan_series', q => q.eq('user_id', uid),
        'frequency, weekday, start_date, end_date, sport, title, planned_duration, notes, created_at'),
      fetchAllRows('achievements', q => q.eq('user_id', uid), 'badge_id, earned_at'),
      // Notification `link` is deliberately NOT selected: links embed entity
      // UUIDs (e.g. ?club=<id>), which would leak internal ids into the export.
      fetchAllRows('notifications', q => q.eq('user_id', uid),
        'type, title, body, read, actor_id, created_at'),
      fetchAllRows('notifications', q => q.eq('actor_id', uid),
        'type, title, body, user_id, created_at'),
      fetchAllRows('event_rsvps', q => q.eq('user_id', uid), 'event_id, status, created_at'),
      fetchAllRows('events', q => q.eq('created_by', uid),
        'club_id, title, sport, event_type, date, location, distance, max_participants, entry_fee, level, description, visibility, created_at'),
      fetchAllRows('challenges', q => q.eq('created_by', uid),
        'club_id, title, description, sport, goal_type, goal_target, goal_unit, start_date, end_date, visibility, created_at'),
      fetchAllRows('challenge_participants', q => q.eq('user_id', uid), 'challenge_id, joined_at'),
      fetchAllRows('memberships', q => q.eq('user_id', uid), 'club_id, role, created_at'),
      fetchAllRows('club_invites', q => q.eq('invited_by', uid),
        'club_id, email, role, status, expires_at, accepted_at, created_at'),
      fetchAllRows('subscriptions', q => q.eq('owner_type', 'user').eq('owner_id', uid),
        'plan, stripe_customer_id, stripe_subscription_id, status, current_period_end, cancel_at_period_end, created_at, updated_at')
    ]);
    const clubInvitesReceived = email
      ? await fetchAllRows('club_invites', q => q.eq('email', email),
        'club_id, invited_by, role, status, expires_at, accepted_at, created_at')
      : [];
    const clubSubs = ownedClubIds.length
      ? await fetchAllRows('subscriptions', q => q.eq('owner_type', 'club').in('owner_id', ownedClubIds),
        'owner_id, plan, stripe_customer_id, stripe_subscription_id, status, current_period_end, cancel_at_period_end, created_at, updated_at')
      : [];
    // Challenge invites, both directions. Pending is DERIVED (row exists ∧
    // invitee not a participant) via the shared pendingInvites() helper — the
    // export is its fifth caller; never reimplement the rule inline.
    let chInvitesSentRaw = [];
    let chInvitesReceivedRaw = [];
    try {
      [chInvitesSentRaw, chInvitesReceivedRaw] = await Promise.all([
        fetchAllRows('challenge_invites', q => q.eq('inviter_id', uid),
          'challenge_id, invitee_id, created_at'),
        fetchAllRows('challenge_invites', q => q.eq('invitee_id', uid),
          'challenge_id, invitee_id, inviter_id, created_at')
      ]);
    } catch (err) {
      // Same tolerance as account-delete: ONLY the table-not-provisioned case
      // degrades (to honest empty arrays); any other failure aborts the export.
      const tableMissing = /challenge_invites/i.test(err.message)
        && /find the table|schema cache|does not exist/i.test(err.message);
      if (!tableMissing) throw err;
    }
    const allInviteRows = chInvitesSentRaw.concat(chInvitesReceivedRaw);

    // ── Reference lookups (internal only — ids never reach the output) ──
    const clubIds = [...new Set([
      ...eventsCreated.map(r => r.club_id),
      ...challengesCreated.map(r => r.club_id),
      ...memberships.map(r => r.club_id),
      ...clubInvitesSent.map(r => r.club_id),
      ...clubInvitesReceived.map(r => r.club_id)
    ].filter(Boolean))];
    const clubById = {};
    ownedClubs.forEach(c => { clubById[c.id] = c; });
    const missingClubIds = clubIds.filter(id => !clubById[id]);
    if (missingClubIds.length) {
      const rows = await fetchAllRows('clubs', q => q.in('id', missingClubIds), 'id, name, handle');
      rows.forEach(c => { clubById[c.id] = c; });
    }
    const clubRef = (id) => {
      const c = id && clubById[id];
      return c ? { name: c.name, handle: c.handle || null } : null;
    };

    const challengeIds = [...new Set([
      ...challengeParticipations.map(r => r.challenge_id),
      ...allInviteRows.map(r => r.challenge_id)
    ].filter(Boolean))];
    const challengeTitleById = {};
    if (challengeIds.length) {
      const rows = await fetchAllRows('challenges', q => q.in('id', challengeIds), 'id, title');
      rows.forEach(c => { challengeTitleById[c.id] = c.title || null; });
    }

    const eventIds = [...new Set(eventRsvps.map(r => r.event_id).filter(Boolean))];
    const eventById = {};
    if (eventIds.length) {
      const rows = await fetchAllRows('events', q => q.in('id', eventIds), 'id, title, date');
      rows.forEach(e => { eventById[e.id] = e; });
    }

    const likedCommentedPostIds = [...new Set(
      postComments.map(r => r.post_id).concat(postLikes.map(r => r.post_id)).filter(Boolean)
    )];
    const postAuthorIdByPostId = {};
    if (likedCommentedPostIds.length) {
      const rows = await fetchAllRows('posts', q => q.in('id', likedCommentedPostIds), 'id, user_id');
      rows.forEach(p => { postAuthorIdByPostId[p.id] = p.user_id; });
    }

    // Pending derivation for challenge invites (shared helper — fifth caller).
    let invitePendingSet = new Set();
    if (allInviteRows.length) {
      const invitePartRows = await fetchAllRows('challenge_participants',
        q => q.in('challenge_id', [...new Set(allInviteRows.map(r => r.challenge_id))]),
        'challenge_id, user_id');
      invitePendingSet = new Set(pendingInvites(allInviteRows, invitePartRows)
        .map(r => r.challenge_id + ':' + r.invitee_id));
    }

    // One person map for every counterparty in the export.
    const personIds = [
      ...following.map(r => r.following_id),
      ...followers.map(r => r.follower_id),
      ...notificationsReceived.map(r => r.actor_id),
      ...notificationsTriggered.map(r => r.user_id),
      ...clubInvitesReceived.map(r => r.invited_by),
      ...chInvitesSentRaw.map(r => r.invitee_id),
      ...chInvitesReceivedRaw.map(r => r.inviter_id),
      ...Object.values(postAuthorIdByPostId)
    ].filter(id => id && id !== uid);
    const peopleMap = await buildUserProfileMap(personIds);
    const person = (id) => {
      if (!id) return null;
      if (id === uid) return { name: meta.name || 'You', handle: meta.handle || null, self: true };
      const p = peopleMap[id];
      // A failed lookup (deleted account, transient auth error) must be an
      // honest unknown — never a plausible-but-wrong synthetic identity.
      if (!p) return { name: null, handle: null, unavailable: true };
      return { name: p.name, handle: p.handle || null };
    };

    const chInviteOut = (r, counterpartyId) => ({
      challenge_title: challengeTitleById[r.challenge_id] || null,
      counterparty: person(counterpartyId),
      created_at: r.created_at,
      state: invitePendingSet.has(r.challenge_id + ':' + r.invitee_id) ? 'pending' : 'accepted'
    });
    const clubInviteBase = (r) => ({
      club: clubRef(r.club_id),
      role: r.role,
      status: r.status,
      expires_at: r.expires_at,
      accepted_at: r.accepted_at,
      created_at: r.created_at
    });

    const exportDoc = {
      export_version: 2,
      generated_at: new Date().toISOString(),
      account: {
        id: uid,
        email,
        created_at: req.user.created_at || null,
        profile: meta,
        preferences_resolved: prefsFromMeta(meta),
        avatar_url: meta.avatar_url || null
      },
      activities,
      posts,
      post_comments: postComments.map(r => ({
        content: r.content, created_at: r.created_at,
        post_author: person(postAuthorIdByPostId[r.post_id])
      })),
      post_likes: postLikes.map(r => ({
        created_at: r.created_at,
        post_author: person(postAuthorIdByPostId[r.post_id])
      })),
      follows: {
        following: following.map(r => ({ user: person(r.following_id), created_at: r.created_at })),
        followers: followers.map(r => ({ user: person(r.follower_id), created_at: r.created_at }))
      },
      goals,
      planned_sessions: plannedSessions,
      plan_series: planSeries,
      achievements,
      notifications: {
        received: notificationsReceived.map(r => ({
          type: r.type, title: r.title, body: r.body,
          read: r.read, actor: person(r.actor_id), created_at: r.created_at
        })),
        // Recipient read-state is THEIR activity, not the requester's — omitted.
        triggered: notificationsTriggered.map(r => ({
          type: r.type, title: r.title, body: r.body,
          recipient: person(r.user_id), created_at: r.created_at
        }))
      },
      events: {
        created: eventsCreated.map(({ club_id, ...rest }) => ({ ...rest, club: clubRef(club_id) })),
        rsvps: eventRsvps.map(r => ({
          event_title: (eventById[r.event_id] && eventById[r.event_id].title) || null,
          event_date: (eventById[r.event_id] && eventById[r.event_id].date) || null,
          status: r.status, created_at: r.created_at
        }))
      },
      challenges: {
        created: challengesCreated.map(({ club_id, ...rest }) => ({ ...rest, club: clubRef(club_id) })),
        participations: challengeParticipations.map(r => ({
          challenge_title: challengeTitleById[r.challenge_id] || null,
          joined_at: r.joined_at
        }))
      },
      challenge_invites: {
        sent: chInvitesSentRaw.map(r => chInviteOut(r, r.invitee_id)),
        received: chInvitesReceivedRaw.map(r => chInviteOut(r, r.inviter_id))
      },
      clubs: {
        owned: ownedClubs.map(({ id, ...rest }) => rest),
        memberships: memberships.map(r => ({ club: clubRef(r.club_id), role: r.role, created_at: r.created_at }))
      },
      club_invites: {
        // Sent: the email stays because the REQUESTER typed it (provenance
        // rule — their own input). Open-link invites carry the sentinel
        // address, which is system-internal, so they render as a flag instead.
        sent: clubInvitesSent.map(r => (r.email === OPEN_INVITE_EMAIL
          ? { open_link: true, ...clubInviteBase(r) }
          : { invited_email: r.email, ...clubInviteBase(r) })),
        // Received: matched by the requester's own address; the inviter is
        // another person → name + handle only.
        received: clubInvitesReceived.map(r => ({ inviter: person(r.invited_by), ...clubInviteBase(r) }))
      },
      subscriptions: {
        user: userSubs,
        owned_clubs: clubSubs.map(({ owner_id, ...rest }) => ({ club: clubRef(owner_id), ...rest }))
      }
    };
    const fname = 'arenas-export-' + new Date().toISOString().slice(0, 10) + '.json';
    res.setHeader('Content-Disposition', 'attachment; filename="' + fname + '"');
    res.type('application/json').send(JSON.stringify(exportDoc, null, 2));
  } catch (err) {
    console.log('Account export error:', err.message);
    res.status(500).json({ error: 'Export failed — please try again' });
  }
});

// Account deletion. Hard ordering rule: Stripe cancellation runs FIRST — any
// active/past_due subscription (the user's own, or a club sub on a club that
// dies with the account) is canceled via the API before a single row is
// touched, and a Stripe failure aborts the whole delete with nothing removed.
// A billing relationship must never outlive the account it bills.
//
// Club rules:
//  - sole admin of a club that still has OTHER members → deletion is blocked
//    (409) naming the club: transfer the admin role or delete the club first.
//  - sole member (no one else at all) of a club they admin/own → the club
//    dies with the account: its challenges/events/posts (+ children), invites,
//    memberships, logo, subscription row — everything.
//  - club survives (another admin exists): if this user is the stored
//    owner_id, ownership transfers to the longest-standing other admin so no
//    club ever points at a deleted owner.
app.post(BASE + '/api/account/delete', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
  const uid = req.user.id;
  const email = req.user.email || null;
  const meta = req.user.user_metadata || {};
  if ((req.body || {}).confirm !== 'DELETE') {
    return res.status(400).json({ error: 'confirm_mismatch', message: 'Type DELETE to confirm.' });
  }
  try {
    // ── Phase 1: club situation (pure reads; can block) ──
    const { data: adminMemberships, error: amErr } = await supabaseAdmin
      .from('memberships').select('club_id, role').eq('user_id', uid).eq('role', 'admin');
    if (amErr) throw new Error('memberships: ' + amErr.message);
    const { data: ownedClubRows, error: ocErr } = await supabaseAdmin
      .from('clubs').select('id, name, owner_id, logo_url').eq('owner_id', uid);
    if (ocErr) throw new Error('clubs: ' + ocErr.message);
    const relevantClubIds = [...new Set([
      ...(adminMemberships || []).map(m => m.club_id),
      ...(ownedClubRows || []).map(c => c.id)
    ])];
    const clubById = {};
    if (relevantClubIds.length) {
      const { data: clubRows } = await supabaseAdmin
        .from('clubs').select('id, name, owner_id, logo_url').in('id', relevantClubIds);
      for (const c of (clubRows || [])) clubById[c.id] = c;
    }
    const blocked = [];   // clubs that prevent deletion
    const dying = [];     // club rows that die with the account
    const transfers = []; // { clubId, newOwnerId } ownership hand-offs
    for (const clubId of relevantClubIds) {
      const club = clubById[clubId];
      if (!club) continue;
      const { data: members, error: mErr } = await supabaseAdmin
        .from('memberships').select('user_id, role, created_at').eq('club_id', clubId);
      if (mErr) throw new Error('memberships(club): ' + mErr.message);
      const others = (members || []).filter(m => m.user_id !== uid);
      const otherAdmins = others.filter(m => m.role === 'admin');
      if (!others.length) {
        dying.push(club);
      } else if (!otherAdmins.length) {
        blocked.push(club.name);
      } else if (club.owner_id === uid) {
        const sorted = otherAdmins.slice().sort((a, b) =>
          String(a.created_at || '').localeCompare(String(b.created_at || '')));
        transfers.push({ clubId, newOwnerId: sorted[0].user_id });
      }
    }
    if (blocked.length) {
      const names = blocked.join(', ');
      return res.status(409).json({
        error: 'sole_admin',
        clubs: blocked,
        message: `You are the only admin of ${names}. Transfer the admin role to another member, or delete the club first — then come back and delete your account.`
      });
    }

    // ── Phase 2: Stripe cancellation FIRST (abort on any failure) ──
    const subsToCancel = [];
    const { data: userSubRows } = await supabaseAdmin
      .from('subscriptions').select('*').eq('owner_type', 'user').eq('owner_id', uid);
    for (const s of (userSubRows || [])) {
      if (PAID_SUB_STATUSES.includes(s.status) && s.stripe_subscription_id) subsToCancel.push(s);
    }
    for (const club of dying) {
      const { data: clubSubRows } = await supabaseAdmin
        .from('subscriptions').select('*').eq('owner_type', 'club').eq('owner_id', club.id);
      for (const s of (clubSubRows || [])) {
        if (PAID_SUB_STATUSES.includes(s.status) && s.stripe_subscription_id) subsToCancel.push(s);
      }
    }
    const STRIPE_ABORT = {
      error: 'stripe_cancel_failed',
      message: "We couldn't cancel your subscription — nothing was deleted. Try again in a minute or contact support."
    };
    if (subsToCancel.length && !stripe) {
      console.log('Account delete aborted: paid subscription exists but Stripe is not configured');
      return res.status(502).json(STRIPE_ABORT);
    }
    for (const s of subsToCancel) {
      try {
        // Retrieve first: a sub Stripe verifiably shows as canceled is safe
        // to skip. ANY error — including "no such subscription" (a DB row
        // claiming active for a sub this Stripe account can't see is exactly
        // the suspicious case) — aborts the whole delete with nothing removed.
        const live = await stripe.subscriptions.retrieve(s.stripe_subscription_id);
        if (live && live.status === 'canceled') {
          console.log('Account delete: subscription already canceled in Stripe (ok):', s.stripe_subscription_id);
          continue;
        }
        await stripe.subscriptions.cancel(s.stripe_subscription_id);
        console.log('Account delete: canceled subscription', s.stripe_subscription_id);
      } catch (err) {
        console.log('Account delete aborted: Stripe cancel failed:', err.message);
        return res.status(502).json(STRIPE_ABORT);
      }
    }

    // ── Phase 3: the sweep (zero residue). Child rows before parents. ──
    const del = async (table, applyFilters) => {
      let q = supabaseAdmin.from(table).delete();
      q = applyFilters(q);
      const { error } = await q;
      if (error) throw new Error('delete ' + table + ': ' + error.message);
    };
    const idsOf = rows => (rows || []).map(r => r.id);

    // 3a. Dying clubs' full sub-cascade.
    for (const club of dying) {
      const cid = club.id;
      const { data: clubChallenges } = await supabaseAdmin.from('challenges').select('id, image_path').eq('club_id', cid);
      if (idsOf(clubChallenges).length) {
        await del('challenge_participants', q => q.in('challenge_id', idsOf(clubChallenges)));
        await del('challenges', q => q.in('id', idsOf(clubChallenges)));
        // Rows first, storage objects second — best-effort, never blocking.
        for (const ch of clubChallenges) await deleteChallengeImageObject(ch.image_path, ch.id);
      }
      const { data: clubEvents } = await supabaseAdmin.from('events').select('id, image_path').eq('club_id', cid);
      if (idsOf(clubEvents).length) {
        await del('event_rsvps', q => q.in('event_id', idsOf(clubEvents)));
        await del('events', q => q.in('id', idsOf(clubEvents)));
        // Rows first, storage objects second — best-effort, never blocking.
        for (const ev of clubEvents) await deleteEventImageObject(ev.image_path, ev.id);
      }
      // (posts are user-scoped — no club_id column; the club feed derives
      // from member activity — so there is no club-posts table to sweep)
      await del('club_invites', q => q.eq('club_id', cid));
      await del('club_join_requests', q => q.eq('club_id', cid));
      await del('memberships', q => q.eq('club_id', cid));
      await del('subscriptions', q => q.eq('owner_type', 'club').eq('owner_id', cid));
      if (club.logo_url) await deleteAvatarObject(club.logo_url, 'clubs/' + cid);
      await del('clubs', q => q.eq('id', cid));
    }

    // 3b. Ownership transfers for surviving clubs. If the surviving club has a
    // paid subscription it is still billed to the departed owner's card, so the
    // new owner MUST be told to update payment. actorId stays null so this
    // notification survives the actor_id sweep below.
    for (const t of transfers) {
      const { error } = await supabaseAdmin.from('clubs')
        .update({ owner_id: t.newOwnerId }).eq('id', t.clubId);
      if (error) throw new Error('owner transfer: ' + error.message);
      try {
        const { data: clubSub } = await supabaseAdmin.from('subscriptions')
          .select('status').eq('owner_type', 'club').eq('owner_id', t.clubId)
          .in('status', PAID_SUB_STATUSES).limit(1).maybeSingle();
        const clubName = (clubById[t.clubId] && clubById[t.clubId].name) || 'your club';
        await createNotification({
          userId: t.newOwnerId,
          type: 'billing',
          title: 'You are now the owner of ' + clubName,
          body: 'The previous owner deleted their account.' + (clubSub
            ? ' The club\'s subscription is still billed to their payment card — update the payment method in the club\'s billing settings to keep it active.'
            : ''),
          link: '/clubs/dashboard?club=' + t.clubId
        });
      } catch (err) {
        console.error('transfer notification failed (non-fatal):', err.message);
      }
    }

    // 3c. User-owned rows everywhere else.
    // Paged: accounts with >1000 posts must not leave rows/objects behind.
    const userPosts = await fetchAllRows('posts', q => q.eq('user_id', uid), 'id, image_url');
    if (idsOf(userPosts).length) {
      await del('post_likes', q => q.in('post_id', idsOf(userPosts)));
      await del('post_comments', q => q.in('post_id', idsOf(userPosts)));
    }
    await del('post_likes', q => q.eq('user_id', uid));
    await del('post_comments', q => q.eq('user_id', uid));
    if (idsOf(userPosts).length) await del('posts', q => q.in('id', idsOf(userPosts)));
    // Rows first, storage objects second — best-effort, never blocking
    // (same order as event covers).
    for (const p of (userPosts || [])) {
      if (p.image_url) await deletePostImageObject(p.image_url, uid);
    }

    const { data: userEvents } = await supabaseAdmin.from('events').select('id, image_path').eq('created_by', uid);
    if (idsOf(userEvents).length) {
      await del('event_rsvps', q => q.in('event_id', idsOf(userEvents)));
      await del('events', q => q.in('id', idsOf(userEvents)));
      // Rows first, storage objects second — best-effort, never blocking.
      for (const ev of userEvents) await deleteEventImageObject(ev.image_path, ev.id);
    }
    const { data: userChallenges } = await supabaseAdmin.from('challenges').select('id, image_path').eq('created_by', uid);
    if (idsOf(userChallenges).length) {
      await del('challenge_participants', q => q.in('challenge_id', idsOf(userChallenges)));
      await del('challenges', q => q.in('id', idsOf(userChallenges)));
      // Rows first, storage objects second — best-effort, never blocking.
      for (const ch of userChallenges) await deleteChallengeImageObject(ch.image_path, ch.id);
    }
    // Received challenge invites (invitee side). Creator-side rows die with
    // their challenges via the table's ON DELETE CASCADE FK. Tolerate ONLY the
    // table-not-provisioned case (nothing can linger in a table that doesn't
    // exist); any other failure still aborts — zero-residue rule.
    try {
      await del('challenge_invites', q => q.eq('invitee_id', uid));
    } catch (err) {
      const tableMissing = /challenge_invites/i.test(err.message)
        && /find the table|schema cache|does not exist/i.test(err.message);
      if (!tableMissing) throw err;
    }
    // Received event invites (invitee side) — same rule as challenge_invites:
    // creator-side rows die with their events via ON DELETE CASCADE; only the
    // table-not-provisioned case is tolerated.
    try {
      await del('event_invites', q => q.eq('invitee_id', uid));
    } catch (err) {
      const tableMissing = /event_invites/i.test(err.message)
        && /find the table|schema cache|does not exist/i.test(err.message);
      if (!tableMissing) throw err;
    }
    await del('notifications', q => q.eq('user_id', uid));
    await del('notifications', q => q.eq('actor_id', uid));
    await del('follows', q => q.eq('follower_id', uid));
    await del('follows', q => q.eq('following_id', uid));
    await del('activities', q => q.eq('user_id', uid));
    await del('goals', q => q.eq('user_id', uid));
    await del('planned_sessions', q => q.eq('user_id', uid));
    await del('plan_series', q => q.eq('user_id', uid));
    await del('achievements', q => q.eq('user_id', uid));
    await del('event_rsvps', q => q.eq('user_id', uid));
    await del('challenge_participants', q => q.eq('user_id', uid));
    await del('memberships', q => q.eq('user_id', uid));
    await del('club_join_requests', q => q.eq('user_id', uid));
    await del('club_invites', q => q.eq('invited_by', uid));
    if (email) await del('club_invites', q => q.eq('email', email));
    // Contact-form messages. Two matches are required: user_id covers
    // logged-in submissions, but logged-out submissions carry no user_id and
    // would leave the address (and message) behind — so also match the
    // account's email in from_email. from_email is stored as typed (only
    // trimmed) while auth emails are lowercased, hence case-insensitive
    // ilike with LIKE metacharacters escaped (_ is common in addresses).
    // NOTE: email must be read BEFORE auth.admin.deleteUser below — it is
    // (captured from the session at the top of this route).
    await del('contact_messages', q => q.eq('user_id', uid));
    if (email) {
      const pattern = email.replace(/[\\%_]/g, m => '\\' + m);
      await del('contact_messages', q => q.ilike('from_email', pattern));
    }
    await del('subscriptions', q => q.eq('owner_type', 'user').eq('owner_id', uid));

    // 3d. Storage avatar, then the auth user LAST.
    if (meta.avatar_url) await deleteAvatarObject(meta.avatar_url, 'users/' + uid);
    if (meta.banner_url) await deleteAvatarObject(meta.banner_url, 'banners/' + uid);
    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(uid);
    if (authErr) throw new Error('auth delete: ' + authErr.message);

    res.clearCookie('sb_access_token');
    res.clearCookie('sb_refresh_token');
    console.log('Account deleted:', uid, '| dying clubs:', dying.length, '| transfers:', transfers.length, '| subs canceled:', subsToCancel.length);
    res.json({ ok: true, redirect: BASE + '/landing' });
  } catch (err) {
    // Honest partial-failure report: by this point Stripe cancellation may
    // already have happened (that is the safe direction — a canceled sub
    // never bills a half-deleted account).
    console.log('Account delete error:', err.message);
    res.status(500).json({
      error: 'delete_failed',
      message: 'Something failed partway through deletion. Any paid subscription was already canceled. Please try again or contact support to finish removing your data.'
    });
  }
});

// ── AVATARS & CLUB LOGOS (Supabase Storage) ──
// One PUBLIC bucket, path-namespaced: users/{userId}/{ts}.webp and
// clubs/{clubId}/{ts}.webp. All writes are server-mediated via the service
// role (clients never touch Storage directly), so prefix separation is the
// only namespacing needed and no RLS policies are required.
const AVATAR_BUCKET = 'avatars';

// Idempotent bucket setup at startup: create-if-missing, never error if it
// already exists (Supabase returns a 409/"already exists" for duplicates).
(async () => {
  if (!supabaseAdmin) return;
  try {
    const { error } = await supabaseAdmin.storage.createBucket(AVATAR_BUCKET, { public: true });
    if (error && !/already exists|duplicate/i.test(error.message || '')) {
      console.log('Avatar bucket setup error:', error.message);
    }
  } catch (err) {
    console.log('Avatar bucket setup error:', err.message);
  }
})();

// ── EVENT IMAGES (Supabase Storage, PRIVATE bucket) ──
// One PRIVATE bucket, path-namespaced events/{eventId}/{ts}.webp. No public
// URL exists for any object; the ONLY read path is the authenticated proxy
// GET /api/events/:id/image, gated by getVisibleEvent (the single event
// access rule). The events.image_path column stores the object path — the
// path itself is server-side only and appears in no payload; clients get the
// timestamp segment as a version token (`image`) for cache busting.
const EVENT_IMAGE_BUCKET = 'event-images';
(async () => {
  if (!supabaseAdmin) return;
  try {
    const { error } = await supabaseAdmin.storage.createBucket(EVENT_IMAGE_BUCKET, { public: false });
    if (error && !/already exists|duplicate/i.test(error.message || '')) {
      console.log('Event image bucket setup error:', error.message);
    }
  } catch (err) {
    console.log('Event image bucket setup error:', err.message);
  }
})();

// ── POST IMAGES (Supabase Storage, PUBLIC bucket) ──
// Feed post photos use the AVATAR model, not the event model: posts have no
// per-post visibility gate (followers see them in the feed, club-mates in
// club feeds), so there is nothing to enforce at the object layer. Public
// bucket, CDN-served public URL stored in posts.image_url, timestamped
// unguessable filenames posts/{userId}/{ts}.webp, SW cache-first on the
// versioned path. Unlike event covers (banner slots, 3:1 cover-crop), a post
// photo is content: fit:'inside' preserves the source aspect ratio — the
// stored file is NEVER cropped.
const POST_IMAGE_BUCKET = 'post-images';
(async () => {
  if (!supabaseAdmin) return;
  try {
    const { error } = await supabaseAdmin.storage.createBucket(POST_IMAGE_BUCKET, { public: true });
    if (error && !/already exists|duplicate/i.test(error.message || '')) {
      console.log('Post image bucket setup error:', error.message);
    }
  } catch (err) {
    console.log('Post image bucket setup error:', err.message);
  }
})();

// Public URL → object path, prefix-checked against the owning user (defense
// in depth: a corrupted pointer can never delete another user's object).
function postImagePathFromUrl(url, userId) {
  if (!url || typeof url !== 'string') return null;
  const marker = `/storage/v1/object/public/${POST_IMAGE_BUCKET}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null;
  let p;
  try {
    p = decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
  } catch (err) {
    return null;
  }
  return p.startsWith('posts/' + userId + '/') ? p : null;
}

// Best-effort object cleanup — never blocks or fails the request running it.
async function deletePostImageObject(imageUrl, userId) {
  if (!supabaseAdmin) return;
  const objectPath = postImagePathFromUrl(imageUrl, userId);
  if (!objectPath) return;
  try {
    const { error } = await supabaseAdmin.storage.from(POST_IMAGE_BUCKET).remove([objectPath]);
    if (error) console.log('Post image cleanup failed (ignored):', error.message);
  } catch (err) {
    console.log('Post image cleanup failed (ignored):', err.message);
  }
}

// Multer stage for post images: same memory storage + 5 MiB cap + 413/400
// mapping as avatars, field name 'image'. Multer only parses
// multipart/form-data — a JSON create request passes straight through with
// req.body already parsed by express.json, so ONE route serves both shapes.
function postImageUploadSingle(req, res, next) {
  avatarUpload.single('image')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Image is too large — the maximum is 5 MB' });
      }
      console.log('Post image upload parse error:', err.message);
      return res.status(400).json({ error: 'Could not read the uploaded file' });
    }
    next();
  });
}

// The version token clients see: the timestamp segment of the stored object
// path. Same versioned-filename cache logic the avatars rely on — replacing
// an image changes the timestamp, which busts the ?v= URL naturally.
function eventImageVersion(imagePath) {
  const m = /^events\/[^/]+\/(\d+)\.webp$/.exec(imagePath || '');
  return m ? m[1] : null;
}

// Best-effort object cleanup. Prefix-checked (defense in depth: a corrupted
// pointer can never delete another event's object) and failures are logged
// and ignored — cleanup must never block or fail the request that runs it.
async function deleteEventImageObject(objectPath, eventId) {
  if (!objectPath || !supabaseAdmin) return;
  if (!objectPath.startsWith('events/' + eventId + '/')) return;
  try {
    const { error } = await supabaseAdmin.storage.from(EVENT_IMAGE_BUCKET).remove([objectPath]);
    if (error) console.log('Event image cleanup failed (ignored):', error.message);
  } catch (err) {
    console.log('Event image cleanup failed (ignored):', err.message);
  }
}

// Multer stage for event images: same memory storage + 5 MiB cap + error
// mapping as avatars, different field name.
function eventImageUploadSingle(req, res, next) {
  avatarUpload.single('image')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Image is too large — the maximum is 5 MB' });
      }
      console.log('Event image upload parse error:', err.message);
      return res.status(400).json({ error: 'Could not read the uploaded file' });
    }
    next();
  });
}

// Upload/replace an event's image. Creator OR club admin/coach — the same
// canManageEvent rule as PATCH/DELETE, so anyone who can edit/cancel an event
// can also fix its cover image. The check runs BEFORE multer touches the
// body: nonexistent id and non-manager answer with the byte-identical
// not-found body (zero-leak standard). Never
// plan-gated. Pipeline mirrors avatars: Sharp format validation, .rotate()
// EXIF apply+strip, 1200×400 cover-crop (center) WebP re-encode, timestamped
// filename, pointer-write rollback, best-effort old-object cleanup, per-event
// concurrency lock.
app.post(BASE + '/api/events/:id/image', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
  const { data: event } = await supabaseAdmin
    .from('events').select('id, created_by, club_id, image_path').eq('id', req.params.id).maybeSingle();
  if (!event || !(await canManageEvent(event, req.user.id))) return res.json({ error: 'Event not found' });
  eventImageUploadSingle(req, res, async () => {
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'No image file received' });
    const lockKey = 'event:' + event.id;
    if (avatarUploadsInFlight.has(lockKey)) {
      return res.status(429).json({ error: 'An upload is already in progress — give it a second' });
    }
    avatarUploadsInFlight.add(lockKey);
    try {
      let meta;
      try { meta = await sharp(req.file.buffer).metadata(); } catch (err) { meta = null; }
      if (!meta || !['jpeg', 'png', 'webp'].includes(meta.format)) {
        return res.status(400).json({ error: 'That file is not a supported image — upload a JPG, PNG or WebP' });
      }
      const webp = await sharp(req.file.buffer).rotate()
        .resize(1200, 400, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
      const objectPath = 'events/' + event.id + '/' + Date.now() + '.webp';
      const { error: upErr } = await supabaseAdmin.storage
        .from(EVENT_IMAGE_BUCKET)
        .upload(objectPath, webp, { contentType: 'image/webp', upsert: false });
      if (upErr) {
        console.log('Event image storage upload error:', upErr.message);
        return res.status(500).json({ error: 'Could not store the image — please try again' });
      }
      const { error: ptrErr } = await supabaseAdmin
        .from('events').update({ image_path: objectPath }).eq('id', event.id);
      if (ptrErr) {
        // Pointer write failed — remove the just-uploaded object so it never
        // becomes an orphan nobody references.
        console.log('Event image pointer write error:', ptrErr.message);
        await deleteEventImageObject(objectPath, event.id);
        return res.status(500).json({ error: 'Could not save the image' });
      }
      await deleteEventImageObject(event.image_path, event.id);
      res.json({ success: true, image: eventImageVersion(objectPath) });
    } catch (err) {
      console.log('Event image upload error:', err.message);
      res.status(500).json({ error: 'Upload failed' });
    } finally {
      avatarUploadsInFlight.delete(lockKey);
    }
  });
});

// Remove an event's image. Same canManageEvent gate as upload, same zero-leak
// not-found. Pointer cleared FIRST, then the object best-effort (avatar
// DELETE order).
app.delete(BASE + '/api/events/:id/image', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
  const { data: event } = await supabaseAdmin
    .from('events').select('id, created_by, club_id, image_path').eq('id', req.params.id).maybeSingle();
  if (!event || !(await canManageEvent(event, req.user.id))) return res.json({ error: 'Event not found' });
  const { error } = await supabaseAdmin
    .from('events').update({ image_path: null }).eq('id', event.id);
  if (error) return res.status(500).json({ error: 'Could not remove the image' });
  await deleteEventImageObject(event.image_path, event.id);
  res.json({ success: true });
});

// Authenticated image proxy — THE only read path for event images. The image
// is exactly as visible as the event: getVisibleEvent is the single gate, and
// nonexistent id, denied access and imageless event all answer with the
// byte-identical not-found body (no existence oracle). The ?v= query is
// deliberately IGNORED: stale or absent v serves the current object bytes —
// v exists purely so replacing an image changes the URL and busts caches.
// Cache-Control is private+immutable: browsers cache per-user, the SW never
// touches it (same-origin /api/* is network-only by SW rule 3).
app.get(BASE + '/api/events/:id/image', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(404).json({ error: 'Event not found' });
  try {
    const event = await getVisibleEvent(req.user.id, req.params.id,
      'id, created_by, visibility, club_id, image_path');
    if (!event || !event.image_path) return res.status(404).json({ error: 'Event not found' });
    const { data: blob, error } = await supabaseAdmin.storage
      .from(EVENT_IMAGE_BUCKET).download(event.image_path);
    if (error || !blob) return res.status(404).json({ error: 'Event not found' });
    const buf = Buffer.from(await blob.arrayBuffer());
    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(buf);
  } catch (err) {
    console.log('Event image proxy error:', err.message);
    res.status(404).json({ error: 'Event not found' });
  }
});

// ── CHALLENGE IMAGES (Supabase Storage, PRIVATE bucket) ────────────────────
// Same model as event covers: private bucket, challenges.image_path stores
// the object path SERVER-SIDE ONLY (appears in no payload — clients get the
// timestamp segment as a version token `image`), single authenticated proxy
// gated by canUserSeeChallenge (THE challenge visibility rule), byte-identical
// not-found for nonexistent/denied/imageless. Stored crop is 6:1 (1440×240):
// the card ribbon renders at aspect-ratio 6/1 at EVERY width, so the crop the
// creator chose is exactly what shows (no fixed-height double-crop).
const CHALLENGE_IMAGE_BUCKET = 'challenge-images';
(async () => {
  if (!supabaseAdmin) return;
  try {
    const { error } = await supabaseAdmin.storage.createBucket(CHALLENGE_IMAGE_BUCKET, { public: false });
    if (error && !/already exists|duplicate/i.test(error.message || '')) {
      console.log('Challenge image bucket setup error:', error.message);
    }
  } catch (err) {
    console.log('Challenge image bucket setup error:', err.message);
  }
})();

// Version token clients see: the timestamp segment of the stored object path.
function challengeImageVersion(imagePath) {
  const m = /^challenges\/[^/]+\/(\d+)\.webp$/.exec(imagePath || '');
  return m ? m[1] : null;
}

// Strip the server-only image_path from a raw challenge row and expose the
// version token instead. EVERY response that carries a challenge row (or a
// spread of one) must pass through this — never send image_path to a client.
function challengePublicRow(ch) {
  if (!ch || typeof ch !== 'object') return ch;
  const { image_path, ...pub } = ch;
  return { ...pub, image: challengeImageVersion(image_path) };
}

// Best-effort object cleanup. Prefix-checked (a corrupted pointer can never
// delete another challenge's object); failures logged and ignored — cleanup
// never blocks or fails the request that runs it. Rows first, objects second.
async function deleteChallengeImageObject(objectPath, challengeId) {
  if (!objectPath || !supabaseAdmin) return;
  if (!objectPath.startsWith('challenges/' + challengeId + '/')) return;
  try {
    const { error } = await supabaseAdmin.storage.from(CHALLENGE_IMAGE_BUCKET).remove([objectPath]);
    if (error) console.log('Challenge image cleanup failed (ignored):', error.message);
  } catch (err) {
    console.log('Challenge image cleanup failed (ignored):', err.message);
  }
}

// Multer stage for challenge images: same memory storage + 5 MiB cap + error
// mapping as avatars/events, field name 'image'.
function challengeImageUploadSingle(req, res, next) {
  avatarUpload.single('image')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Image is too large — the maximum is 5 MB' });
      }
      console.log('Challenge image upload parse error:', err.message);
      return res.status(400).json({ error: 'Could not read the uploaded file' });
    }
    next();
  });
}

// Upload/replace a challenge's image. requireChallengeEditor — the exact
// PATCH/DELETE rule (creator, or club admin/coach for club-scoped), so anyone
// who can edit a challenge can fix its image (the event-images lesson: never
// ship image auth narrower than edit auth). Auth runs BEFORE multer touches
// the body. Pipeline mirrors events: Sharp format validation, .rotate() EXIF
// apply+strip, 1440×240 (6:1) cover-crop WebP re-encode, timestamped
// filename, upload-then-pointer with rollback, best-effort old-object
// cleanup, per-challenge concurrency lock.
app.post(BASE + '/api/challenges/:id/image', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
  const { challenge, fail } = await requireChallengeEditor(req.params.id, req.user.id);
  if (fail) return res.status(fail.status || 200).json({ error: fail.error });
  challengeImageUploadSingle(req, res, async () => {
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'No image file received' });
    const lockKey = 'challenge:' + challenge.id;
    if (avatarUploadsInFlight.has(lockKey)) {
      return res.status(429).json({ error: 'An upload is already in progress — give it a second' });
    }
    avatarUploadsInFlight.add(lockKey);
    try {
      let meta;
      try { meta = await sharp(req.file.buffer).metadata(); } catch (err) { meta = null; }
      if (!meta || !['jpeg', 'png', 'webp'].includes(meta.format)) {
        return res.status(400).json({ error: 'That file is not a supported image — upload a JPG, PNG or WebP' });
      }
      const webp = await sharp(req.file.buffer).rotate()
        .resize(1440, 240, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
      const objectPath = 'challenges/' + challenge.id + '/' + Date.now() + '.webp';
      const { error: upErr } = await supabaseAdmin.storage
        .from(CHALLENGE_IMAGE_BUCKET)
        .upload(objectPath, webp, { contentType: 'image/webp', upsert: false });
      if (upErr) {
        console.log('Challenge image storage upload error:', upErr.message);
        return res.status(500).json({ error: 'Could not store the image — please try again' });
      }
      const { error: ptrErr } = await supabaseAdmin
        .from('challenges').update({ image_path: objectPath }).eq('id', challenge.id);
      if (ptrErr) {
        // Pointer write failed — remove the just-uploaded object so it never
        // becomes an orphan nobody references.
        console.log('Challenge image pointer write error:', ptrErr.message);
        await deleteChallengeImageObject(objectPath, challenge.id);
        return res.status(500).json({ error: 'Could not save the image' });
      }
      await deleteChallengeImageObject(challenge.image_path, challenge.id);
      res.json({ success: true, image: challengeImageVersion(objectPath) });
    } catch (err) {
      console.log('Challenge image upload error:', err.message);
      res.status(500).json({ error: 'Upload failed' });
    } finally {
      avatarUploadsInFlight.delete(lockKey);
    }
  });
});

// Remove a challenge's image. Same requireChallengeEditor gate as upload.
// Pointer cleared FIRST, then the object best-effort.
app.delete(BASE + '/api/challenges/:id/image', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
  const { challenge, fail } = await requireChallengeEditor(req.params.id, req.user.id);
  if (fail) return res.status(fail.status || 200).json({ error: fail.error });
  const { error } = await supabaseAdmin
    .from('challenges').update({ image_path: null }).eq('id', challenge.id);
  if (error) return res.status(500).json({ error: 'Could not remove the image' });
  await deleteChallengeImageObject(challenge.image_path, challenge.id);
  res.json({ success: true });
});

// Authenticated image proxy — THE only read path for challenge images. The
// image is exactly as visible as the challenge: canUserSeeChallenge is the
// single gate; nonexistent id, denied access and imageless challenge all
// answer with the byte-identical not-found body (no existence oracle). ?v= is
// deliberately IGNORED (cache-bust only). Cache-Control private+immutable;
// the SW never touches /api/*.
app.get(BASE + '/api/challenges/:id/image', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(404).json({ error: 'Challenge not found' });
  try {
    const { data: ch } = await supabaseAdmin
      .from('challenges').select('id, created_by, visibility, club_id, image_path')
      .eq('id', req.params.id).maybeSingle();
    if (!ch || !(await canUserSeeChallenge(req.user.id, ch)) || !ch.image_path) {
      return res.status(404).json({ error: 'Challenge not found' });
    }
    const { data: blob, error } = await supabaseAdmin.storage
      .from(CHALLENGE_IMAGE_BUCKET).download(ch.image_path);
    if (error || !blob) return res.status(404).json({ error: 'Challenge not found' });
    const buf = Buffer.from(await blob.arrayBuffer());
    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(buf);
  } catch (err) {
    console.log('Challenge image proxy error:', err.message);
    res.status(404).json({ error: 'Challenge not found' });
  }
});

// Multer stage: memory storage, 5 MB hard cap. The size cap maps to 413; any
// other multipart parse problem is a clean 400 — never an unhandled throw.
const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
function avatarUploadSingle(req, res, next) {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Image is too large — the maximum is 5 MB' });
      }
      console.log('Avatar upload parse error:', err.message);
      return res.status(400).json({ error: 'Could not read the uploaded file' });
    }
    next();
  });
}

// Concurrency choice: an in-flight lock per subject (user or club) rather than
// a timed cooldown — a second upload for the same subject while one is still
// processing gets a 429, but back-to-back sequential uploads are fine.
const avatarUploadsInFlight = new Set();

// Extract the object path from one of OUR public URLs, and only when it sits
// under the expected prefix — defense in depth so a corrupted stored URL can
// never make cleanup delete some other user's/club's object.
function avatarPathFromUrl(url, expectedPrefix) {
  if (!url || typeof url !== 'string') return null;
  const marker = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null;
  let p;
  try {
    p = decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
  } catch (err) {
    return null;
  }
  return p.startsWith(expectedPrefix + '/') ? p : null;
}

// Best-effort cleanup of a previous object. Tolerates every failure with a
// log — cleanup must never fail the request that triggered it.
async function deleteAvatarObject(url, expectedPrefix) {
  const p = avatarPathFromUrl(url, expectedPrefix);
  if (!p) return;
  try {
    const { error } = await supabaseAdmin.storage.from(AVATAR_BUCKET).remove([p]);
    if (error) console.log('Old avatar cleanup failed (ignored):', error.message);
  } catch (err) {
    console.log('Old avatar cleanup failed (ignored):', err.message);
  }
}

// The shared pipeline used by BOTH the user-avatar and club-logo endpoints.
// sharp decode is the real validation (extensions/mime lie; pixels don't):
// only jpeg/png/webp content passes, anything else is a clean 400. The
// re-encode to a 512×512 cover-cropped WebP strips all EXIF/GPS metadata
// (.rotate() first applies EXIF orientation so phone photos aren't sideways).
// The versioned filename is the cache-buster: Supabase public URLs are
// CDN/browser cached, so a new path per upload propagates instantly, then the
// previous object is deleted best-effort.
async function processAndStoreAvatar({ buffer, prefix, previousUrl, width = 512, height = 512 }) {
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch (err) {
    const e = new Error('That file is not a supported image — upload a JPG, PNG or WebP');
    e.status = 400;
    throw e;
  }
  if (!meta || !['jpeg', 'png', 'webp'].includes(meta.format)) {
    const e = new Error('That file is not a supported image — upload a JPG, PNG or WebP');
    e.status = 400;
    throw e;
  }
  const webp = await sharp(buffer).rotate().resize(width, height, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
  const objectPath = `${prefix}/${Date.now()}.webp`;
  const { error: upErr } = await supabaseAdmin.storage
    .from(AVATAR_BUCKET)
    .upload(objectPath, webp, { contentType: 'image/webp', upsert: false });
  if (upErr) {
    console.log('Avatar storage upload error:', upErr.message);
    const e = new Error('Could not store the image — please try again');
    e.status = 500;
    throw e;
  }
  const { data: pub } = supabaseAdmin.storage.from(AVATAR_BUCKET).getPublicUrl(objectPath);
  await deleteAvatarObject(previousUrl, prefix);
  return { publicUrl: pub.publicUrl, objectPath };
}

// Upload/replace the signed-in user's own profile photo. Self-only by
// construction: the storage prefix and metadata write both come from
// req.user.id — no client-supplied id is involved anywhere.
app.post(BASE + '/api/profile/avatar', requireAuth, avatarUploadSingle, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
  if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'No image file received' });
  const lockKey = 'user:' + req.user.id;
  if (avatarUploadsInFlight.has(lockKey)) {
    return res.status(429).json({ error: 'An upload is already in progress — give it a second' });
  }
  avatarUploadsInFlight.add(lockKey);
  try {
    const meta = Object.assign({}, req.user.user_metadata || {});
    const prefix = 'users/' + req.user.id;
    const { publicUrl } = await processAndStoreAvatar({
      buffer: req.file.buffer,
      prefix,
      previousUrl: meta.avatar_url
    });
    meta.avatar_url = publicUrl;
    const { error } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, { user_metadata: meta });
    if (error) {
      // The pointer write failed — remove the just-uploaded object so it
      // doesn't become an orphan nobody references.
      console.log('Avatar metadata write error:', error.message);
      await deleteAvatarObject(publicUrl, prefix).catch(() => {});
      return res.status(500).json({ error: 'Could not save the new photo' });
    }
    res.json({ success: true, avatar_url: publicUrl });
  } catch (err) {
    console.log('Avatar upload error:', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Upload failed' });
  } finally {
    avatarUploadsInFlight.delete(lockKey);
  }
});

// Remove the user's photo: clear the pointer first (the UI falls back to
// initials immediately), then best-effort delete the object.
app.delete(BASE + '/api/profile/avatar', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
  try {
    const meta = Object.assign({}, req.user.user_metadata || {});
    const oldUrl = meta.avatar_url;
    if (!oldUrl) return res.json({ success: true });
    meta.avatar_url = null;
    const { error } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, { user_metadata: meta });
    if (error) {
      console.log('Avatar remove error:', error.message);
      return res.status(500).json({ error: 'Could not remove the photo' });
    }
    await deleteAvatarObject(oldUrl, 'users/' + req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.log('Avatar remove error:', err.message);
    res.status(500).json({ error: 'Could not remove the photo' });
  }
});

// Upload/replace the signed-in user's profile BANNER (the wide header
// background). Same model as the avatar in every respect — public bucket,
// versioned filename, user_metadata pointer (banner_url), lock, rollback —
// only the prefix (banners/{uid}) and the 1600×400 4:1 output differ.
app.post(BASE + '/api/profile/banner', requireAuth, avatarUploadSingle, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
  if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'No image file received' });
  const lockKey = 'banner:' + req.user.id;
  if (avatarUploadsInFlight.has(lockKey)) {
    return res.status(429).json({ error: 'An upload is already in progress — give it a second' });
  }
  avatarUploadsInFlight.add(lockKey);
  try {
    const meta = Object.assign({}, req.user.user_metadata || {});
    const prefix = 'banners/' + req.user.id;
    const { publicUrl } = await processAndStoreAvatar({
      buffer: req.file.buffer,
      prefix,
      previousUrl: meta.banner_url,
      width: 1600,
      height: 400
    });
    meta.banner_url = publicUrl;
    const { error } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, { user_metadata: meta });
    if (error) {
      console.log('Banner metadata write error:', error.message);
      await deleteAvatarObject(publicUrl, prefix).catch(() => {});
      return res.status(500).json({ error: 'Could not save the new banner' });
    }
    res.json({ success: true, banner_url: publicUrl });
  } catch (err) {
    console.log('Banner upload error:', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Upload failed' });
  } finally {
    avatarUploadsInFlight.delete(lockKey);
  }
});

// Remove the banner: pointer null first, then best-effort object delete.
app.delete(BASE + '/api/profile/banner', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
  try {
    const meta = Object.assign({}, req.user.user_metadata || {});
    const oldUrl = meta.banner_url;
    if (!oldUrl) return res.json({ success: true });
    meta.banner_url = null;
    const { error } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, { user_metadata: meta });
    if (error) {
      console.log('Banner remove error:', error.message);
      return res.status(500).json({ error: 'Could not remove the banner' });
    }
    await deleteAvatarObject(oldUrl, 'banners/' + req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.log('Banner remove error:', err.message);
    res.status(500).json({ error: 'Could not remove the banner' });
  }
});

// Upload/replace a club's logo. Authorization (UNCONDITIONAL — independent of
// PLAN_GATES_ENABLED, per the codified pattern): admin/coach of THIS club only.
app.post(BASE + '/api/clubs/:clubId/logo', requireAuth, avatarUploadSingle, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
  const { clubId } = req.params;
  const role = await getClubRole(req.user.id, clubId);
  if (!isClubManagerRole(role && role.role)) return res.status(403).json({ error: 'Not authorized' });
  if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'No image file received' });
  const lockKey = 'club:' + clubId;
  if (avatarUploadsInFlight.has(lockKey)) {
    return res.status(429).json({ error: 'An upload is already in progress — give it a second' });
  }
  avatarUploadsInFlight.add(lockKey);
  try {
    const { data: clubRow } = await supabaseAdmin.from('clubs').select('id, logo_url').eq('id', clubId).maybeSingle();
    if (!clubRow) return res.status(404).json({ error: 'Club not found' });
    const prefix = 'clubs/' + clubId;
    const { publicUrl } = await processAndStoreAvatar({
      buffer: req.file.buffer,
      prefix,
      previousUrl: clubRow.logo_url
    });
    const { error } = await supabaseAdmin.from('clubs').update({ logo_url: publicUrl }).eq('id', clubId);
    if (error) {
      console.log('Club logo write error:', error.message);
      await deleteAvatarObject(publicUrl, prefix).catch(() => {});
      return res.status(500).json({ error: 'Could not save the new logo' });
    }
    res.json({ success: true, logo_url: publicUrl });
  } catch (err) {
    console.log('Club logo upload error:', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Upload failed' });
  } finally {
    avatarUploadsInFlight.delete(lockKey);
  }
});

// Remove a club's logo — same UNCONDITIONAL manager-only bar as the upload.
app.delete(BASE + '/api/clubs/:clubId/logo', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
  const { clubId } = req.params;
  const role = await getClubRole(req.user.id, clubId);
  if (!isClubManagerRole(role && role.role)) return res.status(403).json({ error: 'Not authorized' });
  try {
    const { data: clubRow } = await supabaseAdmin.from('clubs').select('id, logo_url').eq('id', clubId).maybeSingle();
    if (!clubRow) return res.status(404).json({ error: 'Club not found' });
    if (!clubRow.logo_url) return res.json({ success: true });
    const { error } = await supabaseAdmin.from('clubs').update({ logo_url: null }).eq('id', clubId);
    if (error) {
      console.log('Club logo remove error:', error.message);
      return res.status(500).json({ error: 'Could not remove the logo' });
    }
    await deleteAvatarObject(clubRow.logo_url, 'clubs/' + clubId);
    res.json({ success: true });
  } catch (err) {
    console.log('Club logo remove error:', err.message);
    res.status(500).json({ error: 'Could not remove the logo' });
  }
});

// Blog is moving to an external Ghost site (not live yet). Until then the in-app
// blog is unreachable: every in-app blog link has been removed and this route
// redirects to the landing page so stale bookmarks/links don't 404. The old
// arenas-blog.html mock (fabricated posts and a fictional feature-launch article)
// was deleted; a future blog will be built fresh or hosted on Ghost.
app.get(BASE + '/blog', (req, res) => res.redirect(BASE + '/landing'));
// The club-signup "Primary sport" select is server-rendered from the sports
// registry (lowercase ids as values, proper labels), so the marketing page —
// which gets no script injections — can never drift from the registry again.
const CLUB_SPORT_OPTIONS = '<option value="">Select a sport…</option>'
  + SPORTS.map((s) => `<option value="${s.id}">${s.label}</option>`).join('');
// The admin "Your primary sport" chips are likewise server-rendered from the
// registry (drift cleanup: the old markup offered a non-registry Triathlon
// chip and only 6 sports; now every registry sport, no Triathlon).
const ADMIN_SPORT_CHIPS = SPORTS.map((s) =>
  `<button type="button" class="sport-chip" onclick="toggleSport(this,'${s.id}')">${s.emoji} ${s.label}</button>`
).join('\n            ');
app.get(BASE + '/for-clubs', async (req, res) => {
  // Minimal session awareness for this public marketing page: logged-in
  // visitors get the shortened club wizard (no account step, authenticated
  // create), logged-out visitors get today's flow unchanged. Auth failures
  // never block the page — it just renders logged-out.
  let session = null;
  try {
    const user = await getOptionalUser(req);
    if (user) {
      const d = displayFromUser(user);
      session = { name: d.name, email: user.email || '' };
    }
  } catch (err) {
    session = null;
  }
  const sessionJson = JSON.stringify(session).replace(/</g, '\\u003c');
  const html = fs.readFileSync(path.join(HTML, 'arenas-for-clubs.html'), 'utf8')
    .replace(
      /(<select class="form-select" id="club-sport">)[\s\S]*?(<\/select>)/,
      `$1${CLUB_SPORT_OPTIONS}$2`
    )
    .replace(
      /(<div class="sport-chips" id="admin-sports">)[\s\S]*?(<\/div>)/,
      `$1${ADMIN_SPORT_CHIPS}$2`
    )
    .replace('</head>', `<script>window.ARENAS_SESSION = ${sessionJson};</script></head>`);
  res.type('html').send(html);
});
// About is a public marketing/content page (no auth), served raw like /for-clubs.
// Marketing/legal pages: static files, but the nav must be session-aware —
// signed-in users were seeing "Log in / Sign up free" chrome. A cheap cookie
// check swaps the auth CTAs for app links; logged-out output is byte-identical
// to the file. Because the response is now per-requester, these pages are
// excluded from SW runtime caching (isNeverCached in sw.js), same precedent
// as /how-points-work.
async function sendMarketingPage(req, res, file) {
  let authed = false;
  const token = req.signedCookies && req.signedCookies.sb_access_token;
  if (token) {
    try {
      const { data, error } = await supabase.auth.getUser(token);
      authed = !error && !!(data && data.user);
    } catch (e) { authed = false; }
  }
  if (!authed) return res.sendFile(path.join(HTML, file));
  let page = fs.readFileSync(path.join(HTML, file), 'utf8');
  page = page
    .replace('<a class="nav-link" href="/html/landing#login">Log in</a>',
      '<a class="nav-link" href="/html/feed">Back to app</a>')
    .replace('<a class="nav-cta yellow" href="/html/landing#login">Sign up free</a>',
      '<a class="nav-cta yellow" href="/html/feed">Open the app →</a>')
    .replace('<a class="btn-primary" href="/html/landing#login">Get started free →</a>',
      '<a class="btn-primary" href="/html/feed">Open the app →</a>');
  res.type('html').send(page);
}
app.get(BASE + '/about', (req, res) => sendMarketingPage(req, res, 'arenas-about.html'));
// Terms of Service is a public content page (no auth), served raw like /about.
app.get(BASE + '/terms', (req, res) => sendMarketingPage(req, res, 'arenas-terms.html'));
// Privacy Policy is a public content page (no auth), served raw like /terms.
app.get(BASE + '/privacy', (req, res) => sendMarketingPage(req, res, 'arenas-privacy.html'));
// Contact page — same session-aware pattern as /terms and /privacy (marketing
// chrome logged out, "Back to app" chrome logged in), plus the session email
// injected for prefill. Only the requester's OWN email is ever injected —
// never the support inbox (CONTACT_INBOX stays server-side only).
app.get(BASE + '/contact', async (req, res) => {
  let sessionEmail = null;
  const token = req.signedCookies && req.signedCookies.sb_access_token;
  if (token) {
    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data && data.user) sessionEmail = data.user.email || null;
    } catch (e) { sessionEmail = null; }
  }
  let page = fs.readFileSync(path.join(HTML, 'arenas-contact.html'), 'utf8');
  if (sessionEmail) {
    page = page
      .replace('window.ARENAS_CONTACT_EMAIL = null;',
        // \u003c-escape so a value containing "</script>" can never terminate
        // the inline script element (script-context XSS boundary).
        'window.ARENAS_CONTACT_EMAIL = ' + JSON.stringify(sessionEmail).replace(/</g, '\\u003c') + ';')
      .replace('<a class="nav-link" href="/html/landing#login">Log in</a>',
        '<a class="nav-link" href="/html/feed">Back to app</a>')
      .replace('<a class="nav-cta yellow" href="/html/landing#login">Sign up free</a>',
        '<a class="nav-cta yellow" href="/html/feed">Open the app →</a>');
  }
  res.type('html').send(page);
});

// ── CONTACT FORM SUBMISSION ──
// The app's first per-IP rate limiter (nothing shared existed to reuse — the
// other 429s are per-subject upload locks). Small in-memory sliding window:
// 5 submissions per IP per 10 minutes. Restart resets it, which is fine for
// abuse control on a contact form.
// CONTACT_RATE_MAX is a test hook (verify-contact-form.js spawns instances
// with a raised cap so validation cases don't trip the limiter); production
// never sets it, so the default 5 applies.
const CONTACT_RATE = { windowMs: 10 * 60 * 1000, max: Number(process.env.CONTACT_RATE_MAX) || 5 };
const contactHits = new Map(); // ip -> [timestamps]
function contactRateLimited(ip) {
  const now = Date.now();
  const hits = (contactHits.get(ip) || []).filter((t) => now - t < CONTACT_RATE.windowMs);
  if (hits.length >= CONTACT_RATE.max) { contactHits.set(ip, hits); return true; }
  hits.push(now);
  contactHits.set(ip, hits);
  // Opportunistic cleanup so the map can't grow unbounded.
  if (contactHits.size > 5000) {
    for (const [k, v] of contactHits) {
      if (!v.some((t) => now - t < CONTACT_RATE.windowMs)) contactHits.delete(k);
    }
  }
  return false;
}
const CONTACT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_FAIL_MSG = 'Your message could not be sent — please try again.';
app.post(BASE + '/api/contact', async (req, res) => {
  try {
    const body = req.body || {};
    // Honeypot: silently discard — respond exactly like success so bots learn
    // nothing, but nothing is stored or sent.
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      return res.json({ ok: true });
    }
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (contactRateLimited(ip)) {
      return res.status(429).json({ error: 'Too many messages — please wait a few minutes and try again.' });
    }
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!CONTACT_EMAIL_RE.test(email) || email.length > 320) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (!subject) return res.status(400).json({ error: 'Subject is required.' });
    if (subject.length > 200) return res.status(400).json({ error: 'Subject must be 200 characters or fewer.' });
    if (!message) return res.status(400).json({ error: 'Message is required.' });
    if (message.length > 5000) return res.status(400).json({ error: 'Message must be 5000 characters or fewer.' });

    // Attach the user id when the requester has a valid session (nullable).
    let userId = null;
    const token = req.signedCookies && req.signedCookies.sb_access_token;
    if (token) {
      try {
        const { data, error } = await supabase.auth.getUser(token);
        if (!error && data && data.user) userId = data.user.id;
      } catch (e) { userId = null; }
    }

    // Persist FIRST so a Resend failure still leaves the message recorded.
    const { data: row, error: insErr } = await supabaseAdmin
      .from('contact_messages')
      .insert({ from_email: email, subject, message, user_id: userId, send_status: 'pending' })
      .select('id')
      .single();
    if (insErr || !row) {
      console.error('[contact] insert failed:', insErr && insErr.message);
      return res.status(500).json({ error: CONTACT_FAIL_MSG });
    }

    // Config check AFTER persisting: the message is recorded either way, but
    // we never report success for mail that wasn't sent. The inbox address is
    // server-side only — it must never reach a response body or error string.
    const inbox = process.env.CONTACT_INBOX;
    if (!inbox || !process.env.RESEND_API_KEY) {
      await supabaseAdmin.from('contact_messages').update({ send_status: 'failed_config' }).eq('id', row.id);
      console.error('[contact] not sent — missing', !inbox ? 'CONTACT_INBOX' : 'RESEND_API_KEY');
      return res.status(500).json({ error: CONTACT_FAIL_MSG });
    }

    const sent = await sendEmail({
      to: inbox,
      replyTo: email,
      subject: `[Arenas contact] ${subject}`,
      html: `<!doctype html><html><body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;padding:24px">
  <p style="margin:0 0 4px;font-size:13px;color:#52525b">New contact form message</p>
  <p style="margin:0 0 2px;font-size:14px"><strong>From:</strong> ${escapeHtml(email)}</p>
  <p style="margin:0 0 16px;font-size:14px"><strong>Subject:</strong> ${escapeHtml(subject)}</p>
  <div style="font-size:14px;line-height:1.6;white-space:pre-wrap;border-top:1px solid #e4e4e7;padding-top:14px">${escapeHtml(message)}</div>
</body></html>`,
      text: `New contact form message\nFrom: ${email}\nSubject: ${subject}\n\n${message}`
    });
    await supabaseAdmin.from('contact_messages')
      .update({ send_status: sent.ok ? 'sent' : 'failed' })
      .eq('id', row.id);
    if (!sent.ok) return res.status(502).json({ error: CONTACT_FAIL_MSG });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[contact] error:', (err && err.message) || err);
    return res.status(500).json({ error: CONTACT_FAIL_MSG });
  }
});
// How points work is a PUBLIC content page (no auth), like /terms and /privacy:
// scoring transparency is a marketing asset and the page contains nothing
// personal. The sport table AND every worked-example number are rendered from
// the sports registry (sports.js) at request time — never hand-written — so
// the page can never drift from the scoring the leaderboards actually use.
// ONE renderer feeds BOTH surfaces: the full page and the in-app modal
// (?fragment=1 slices the marked content + CSS out of the same rendered HTML),
// so a registry change propagates everywhere with no second edit.
function renderHowPointsHtml() {
  const rows = SPORTS.map((s) => {
    const perKm = s.scoring.per === 'km';
    return `<tr><td class="pt-sport"><span class="pt-emoji">${s.emoji}</span>${s.label}</td>` +
      `<td>${perKm ? 'Per kilometre' : 'Per session'}</td>` +
      `<td class="pt-val">${s.scoring.rate} pts per ${perKm ? 'km' : 'session'}</td></tr>`;
  }).join('\n          ');
  // "Running and cycling" — the per-km sport list, derived so a future
  // distance sport shows up here automatically.
  const kmLabels = SPORTS.filter((s) => s.scoring.per === 'km').map((s) => s.label);
  const kmSentence = kmLabels.length > 1
    ? kmLabels.slice(0, -1).join(', ') + ' and ' + kmLabels[kmLabels.length - 1]
    : kmLabels.join('');
  // Worked examples — same math as calculatePoints (unit-aware distance,
  // one Math.round on the total). round1 keeps float noise out of the copy
  // (16.09 × 10 = 160.90000000000002 in IEEE 754).
  const round1 = (n) => Math.round(n * 10) / 10;
  const run = SPORT_POINTS.running.rate, ride = SPORT_POINTS.cycling.rate;
  const climb = SPORT_POINTS.climbing.rate, yoga = SPORT_POINTS.yoga.rate;
  const ex1a = round1(8 * run), ex1b = round1(5 * run), ex1c = round1(10 * 1.609 * run);
  const ex1raw = round1(ex1a + ex1b + ex1c), ex1total = Math.round(8 * run + 5 * run + 10 * 1.609 * run);
  const ex2a = round1(25 * ride), ex2total = Math.round(25 * ride + climb + yoga);
  const tokens = {
    KM_SPORTS_SENTENCE: kmSentence, RUN_RATE: run, RIDE_RATE: ride,
    CLIMB_RATE: climb, YOGA_RATE: yoga,
    EX1_A: ex1a, EX1_B: ex1b, EX1_C: ex1c, EX1_RAW: ex1raw, EX1_TOTAL: ex1total,
    EX2_A: ex2a, EX2_TOTAL: ex2total
  };
  let html = fs.readFileSync(path.join(HTML, 'arenas-how-points-work.html'), 'utf8')
    .replace('<!--SPORT_ROWS-->', rows);
  Object.keys(tokens).forEach((k) => { html = html.replace(new RegExp(`{{${k}}}`, 'g'), String(tokens[k])); });
  return html;
}
// Everything between two markers, or null if either is missing.
function sliceBetween(str, a, b) {
  const i = str.indexOf(a);
  const j = str.indexOf(b);
  return i !== -1 && j > i ? str.slice(i + a.length, j) : null;
}
// App-linking nav for authenticated visitors to the standalone page. Same
// .nav classes so the page's own CSS styles it; the page's head BASE-strip
// script rewrites the /html hrefs when the app is served from the root.
const HPW_APP_NAV = `<nav class="nav">
  <a class="nav-logo" href="/html/feed">
    <img class="nav-logo-icon" src="/html/arenas-icon.svg" alt="">
    <span class="nav-logo-text">Arenas</span>
  </a>
  <div class="nav-links">
    <a class="nav-link" href="/html/feed">Feed</a>
    <a class="nav-link" href="/html/leaderboards">Leaderboards</a>
    <a class="nav-link" href="/html/challenges">Challenges</a>
    <a class="nav-link" href="/html/profile">My profile</a>
    <a class="nav-cta yellow" href="/html/feed">Back to app</a>
  </div>
</nav>`;
app.get(BASE + '/how-points-work', async (req, res) => {
  const html = renderHowPointsHtml();
  if (req.query.fragment === '1') {
    // Modal fragment: the marked CSS slice + the marked content region of the
    // SAME rendered document. No chrome, no duplicated scoring content.
    const css = sliceBetween(html, '/*HPW_CSS_START*/', '/*HPW_CSS_END*/');
    const body = sliceBetween(html, '<!--HPW_CONTENT_START-->', '<!--HPW_CONTENT_END-->');
    if (css === null || body === null) {
      return res.status(500).type('html').send('<p>Content unavailable.</p>');
    }
    return res.type('html').send('<style>' + css + '</style>' + body);
  }
  // Chrome per requester: app nav for a valid session, marketing nav for
  // anonymous visitors. Page stays public either way (never blocks/redirects).
  const user = await getOptionalUser(req);
  const out = user
    ? html.replace(/<!--HPW_NAV_START-->[\s\S]*?<!--HPW_NAV_END-->/, HPW_APP_NAV)
    : html;
  res.type('html').send(out);
});
// Club dashboard requires authentication. Inject the coach's real club, member
// count, and recent members so the page shows live data instead of the
// hardcoded "Hackney Running Club" / "Rachel" placeholders.
app.get(BASE + '/clubs/dashboard', requirePageAuth, async (req, res) => {
  try {
    if (!supabaseAdmin) return sendPageError(res);

    // The club this user administers. Honor an explicit ?club=<id> when the
    // viewer is an admin/coach of it (so multi-club coaches land on the right
    // dashboard from the "My clubs" sidebar); otherwise default to their most
    // recent admin/coach membership. The role filter keeps this IDOR-safe — an
    // unmanaged or unknown id silently falls back to the default club.
    const requestedClubId = typeof req.query.club === 'string' ? req.query.club : null;
    const pickManagedMembership = async (clubFilter) => {
      let q = supabaseAdmin
        .from('memberships')
        .select('club_id, role, clubs (id, name, handle, sport, city, logo_url, visibility, description)')
        .eq('user_id', req.user.id)
        .in('role', ['admin', 'coach']);
      if (clubFilter) q = q.eq('club_id', clubFilter);
      const { data } = await q
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    };

    let membership = requestedClubId ? await pickManagedMembership(requestedClubId) : null;
    if (!membership) membership = await pickManagedMembership(null);

    const clubId = membership && membership.club_id;
    let memberCount = 0;
    let members = [];
    let pendingCount = 0;
    let pendingInvites = [];
    let upcomingEvents = [];
    let pastEvents = [];
    let eventStats = { upcomingCount: 0, totalRsvps: 0, totalNotResponded: 0, avgAttendance: 0 };
    let activeChallenges = [];
    let pastChallenges = [];
    let challengeStats = { activeCount: 0, totalParticipants: 0, totalNotJoined: 0, avgCompletion: 0 };

    if (clubId) {
      const { count } = await supabaseAdmin
        .from('memberships')
        .select('*', { count: 'exact', head: true })
        .eq('club_id', clubId);
      memberCount = count || 0;

      // `memberships` has no `joined_at`/`status` columns, so order by the real
      // `created_at` column and treat every membership row as active.
      const { data: rows } = await supabaseAdmin
        .from('memberships')
        .select('user_id, role, created_at')
        .eq('club_id', clubId)
        .order('created_at', { ascending: false })
        .limit(10);

      members = await Promise.all((rows || []).map(async (m) => {
        let display = { name: 'Member', handle: 'member' };
        try {
          const { data: u } = await supabaseAdmin.auth.admin.getUserById(m.user_id);
          if (u && u.user) display = displayFromUser(u.user);
        } catch (err) {
          // Ignore individual lookup failures; fall back to defaults.
        }
        return { user_id: m.user_id, role: m.role, joined_at: m.created_at, name: display.name, handle: display.handle, avatar_url: display.avatar_url || null };
      }));

      // Pending invitations for the overview "needs attention" panel + members
      // KPI. Expiry/open-link flags are derived here so the client can flag
      // soon-to-expire invites without re-deriving TTL rules.
      try {
        const { data: inviteRows } = await supabaseAdmin
          .from('club_invites')
          .select('id, email, status, expires_at')
          .eq('club_id', clubId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false });
        const inviteNow = Date.now();
        pendingInvites = (inviteRows || []).map((i) => ({
          id: i.id,
          email: i.email,
          status: i.status,
          expires_at: i.expires_at,
          isOpen: i.email === OPEN_INVITE_EMAIL,
          isExpired: i.expires_at ? new Date(i.expires_at).getTime() < inviteNow : false
        }));
        pendingCount = pendingInvites.length;
      } catch (e) {
        // Non-fatal: dashboard still renders without the pending invites.
      }

      // ── Club events + RSVP rollups for the Events tab. The user-supplied
      // snippet embedded `profiles:user_id(name,handle)`, but this app has no
      // usable profiles table — going-member names come from auth metadata via
      // buildUserDisplayMap. RSVP `status` values are 'going'/'interested'.
      try {
        const { data: clubEvents } = await supabaseAdmin
          .from('events')
          .select('*')
          .eq('club_id', clubId)
          .order('date', { ascending: true });

        const eventIds = (clubEvents || []).map(e => e.id);
        let eventRsvps = [];
        if (eventIds.length) {
          const { data: rsvpRows } = await supabaseAdmin
            .from('event_rsvps')
            .select('event_id, user_id, status')
            .in('event_id', eventIds);
          eventRsvps = rsvpRows || [];
        }

        // One batched auth lookup for every distinct "going" member.
        const goingUserIds = eventRsvps.filter(r => r.status === 'going').map(r => r.user_id);
        const nameMap = await buildUserDisplayMap(goingUserIds);

        const now = Date.now();
        const enriched = (clubEvents || []).map(event => {
          const rsvps = eventRsvps.filter(r => r.event_id === event.id);
          const goingCount = rsvps.filter(r => r.status === 'going').length;
          const interestedCount = rsvps.filter(r => r.status === 'interested').length;
          const notRespondedCount = Math.max(0, memberCount - rsvps.length);
          const goingMembers = rsvps
            .filter(r => r.status === 'going')
            .slice(0, 6)
            .map(r => ({
              name: (nameMap[r.user_id] && nameMap[r.user_id].name) || 'Member',
              handle: (nameMap[r.user_id] && nameMap[r.user_id].handle) || 'member',
              avatar_url: (nameMap[r.user_id] && nameMap[r.user_id].avatar_url) || null
            }));
          const attendancePct = memberCount > 0 ? Math.round((goingCount / memberCount) * 100) : 0;
          const eventTime = new Date(event.date).getTime();
          // Storage object paths are server-only (payload convention): strip
          // image_path and carry only the version token — the card stays
          // image-free, but the Image manage action needs the token for its
          // authed-proxy preview.
          const { image_path, ...eventPublic } = event;
          return {
            ...eventPublic,
            image: eventImageVersion(image_path),
            goingCount,
            interestedCount,
            notRespondedCount,
            goingMembers,
            attendancePct,
            isPast: eventTime < now,
            daysUntil: Math.ceil((eventTime - now) / (1000 * 60 * 60 * 24))
          };
        });

        upcomingEvents = enriched.filter(e => !e.isPast);
        pastEvents = enriched.filter(e => e.isPast).reverse();

        const totalRsvps = upcomingEvents.reduce((s, e) => s + e.goingCount, 0);
        const totalNotResponded = upcomingEvents.reduce((s, e) => s + e.notRespondedCount, 0);
        const avgAttendance = upcomingEvents.length > 0
          ? Math.round(upcomingEvents.reduce((s, e) => s + e.attendancePct, 0) / upcomingEvents.length)
          : 0;
        eventStats = {
          upcomingCount: upcomingEvents.length,
          totalRsvps,
          totalNotResponded,
          avgAttendance
        };
      } catch (e) {
        // Non-fatal: dashboard renders without the events rollup.
      }

      // ── Club challenges + participant rollups for the Challenges tab. As with
      // events, the snippet's `profiles:user_id(name,handle)` embed doesn't work
      // here (no usable profiles table) — participant names come from auth
      // metadata via buildUserDisplayMap, and progress reuses
      // computeChallengeProgress (the same helper the leaderboard route uses).
      try {
        const { data: clubChallenges } = await supabaseAdmin
          .from('challenges')
          .select('*')
          .eq('club_id', clubId)
          .order('created_at', { ascending: false });

        const challengeIds = (clubChallenges || []).map(c => c.id);
        let challengeParticipants = [];
        if (challengeIds.length) {
          const { data: cpRows } = await supabaseAdmin
            .from('challenge_participants')
            .select('challenge_id, user_id')
            .in('challenge_id', challengeIds);
          challengeParticipants = cpRows || [];
        }

        // One batched auth lookup for every distinct participant. Profile map
        // (not display map): also carries each participant's zone so progress
        // windows/streak days follow the PARTICIPANT (boundary policy).
        const chNameMap = await buildUserProfileMap(challengeParticipants.map(p => p.user_id));

        const nowMs = Date.now();
        const enrichedChallenges = [];
        for (const challenge of (clubChallenges || [])) {
          const parts = challengeParticipants.filter(p => p.challenge_id === challenge.id);
          const partIds = parts.map(p => p.user_id);
          const target = Number(challenge.goal_target) || 0;

          // Pull every participant's activities in one query (a day wide so
          // any zone's local window is covered), group by user, then cut each
          // group to that PARTICIPANT'S local window (boundary policy).
          const range = challengeFetchRange(challenge);
          let acts = [];
          if (partIds.length) {
            const { data: actRows } = await supabaseAdmin
              .from('activities')
              .select('user_id, distance, duration, sport, date')
              .in('user_id', partIds)
              .gte('date', range.gteIso)
              .lte('date', range.lteIso);
            acts = actRows || [];
          }
          const actsByUser = {};
          acts.forEach(a => { (actsByUser[a.user_id] = actsByUser[a.user_id] || []).push(a); });

          const leaderboard = partIds.map(uid => {
            const pTz = memberZone(chNameMap[uid]);
            const progress = computeChallengeProgress(
              challenge, actsInChallengeWindow(actsByUser[uid], challenge, pTz), pTz);
            const disp = chNameMap[uid] || {};
            return {
              userId: uid,
              name: disp.name || 'Athlete',
              handle: disp.handle || 'athlete',
              avatar_url: disp.avatar_url || null,
              progress,
              pct: target ? Math.min(100, Math.round((progress / target) * 100)) : 0,
              achieved: target > 0 && progress >= target
            };
          });
          leaderboard.sort((a, b) => b.progress - a.progress);
          leaderboard.forEach((entry, i) => { entry.rank = i + 1; });

          const participantCount = parts.length;
          const notJoinedCount = Math.max(0, memberCount - participantCount);
          const achievedCount = leaderboard.filter(e => e.achieved).length;
          const endMs = new Date(challenge.end_date).getTime();
          enrichedChallenges.push({
            ...challengePublicRow(challenge),
            participantCount,
            notJoinedCount,
            leaderboard,
            top3: leaderboard.slice(0, 3),
            achievedCount,
            successRate: participantCount > 0 ? Math.round((achievedCount / participantCount) * 100) : 0,
            isPast: challengeHasEnded(challenge),
            daysLeft: Math.max(0, Math.ceil((endMs - nowMs) / (1000 * 60 * 60 * 24))),
            participationPct: memberCount > 0 ? Math.round((participantCount / memberCount) * 100) : 0
          });
        }

        activeChallenges = enrichedChallenges.filter(c => !c.isPast);
        pastChallenges = enrichedChallenges.filter(c => c.isPast);

        const totalParticipants = activeChallenges.reduce((s, c) => s + c.participantCount, 0);
        const totalNotJoined = activeChallenges.reduce((s, c) => s + c.notJoinedCount, 0);
        const avgCompletion = activeChallenges.length > 0
          ? Math.round(activeChallenges.reduce((s, c) => s + c.participationPct, 0) / activeChallenges.length)
          : 0;
        challengeStats = {
          activeCount: activeChallenges.length,
          totalParticipants,
          totalNotJoined,
          avgCompletion
        };
      } catch (e) {
        // Non-fatal: dashboard renders without the challenges rollup.
      }
    }

    // Pending directory join requests for the Members tab queue. Names come
    // from auth metadata (no profiles table), same as the members list.
    let joinRequests = [];
    if (clubId) {
      try {
        const { data: jrRows } = await supabaseAdmin
          .from('club_join_requests')
          .select('user_id, created_at')
          .eq('club_id', clubId)
          .eq('status', 'pending')
          .order('created_at', { ascending: true });
        joinRequests = await Promise.all((jrRows || []).map(async (r) => {
          let display = { name: 'Athlete', handle: 'athlete' };
          try {
            const { data: u } = await supabaseAdmin.auth.admin.getUserById(r.user_id);
            if (u && u.user) display = displayFromUser(u.user);
          } catch (err) { /* fall back to defaults */ }
          return { user_id: r.user_id, created_at: r.created_at, name: display.name, handle: display.handle, avatar_url: display.avatar_url || null };
        }));
      } catch (e) {
        // Non-fatal: dashboard renders without the request queue.
      }
    }

    const clubData = {
      club: (membership && membership.clubs) || null,
      viewerRole: membership && membership.role,
      joinRequests,
      profile: displayFromUser(req.user),
      // The viewer's full membership list (with role) powers the "Clubs you
      // manage" section of the avatar dropdown on this page too, so multi-club
      // coaches can switch dashboards from here.
      clubs: await getSidebarClubs(req.user.id),
      memberCount,
      members,
      pendingCount,
      pendingInvites,
      upcomingEvents,
      pastEvents: pastEvents.slice(0, 5),
      eventStats,
      activeChallenges,
      pastChallenges: pastChallenges.slice(0, 5),
      challengeStats,
      userEmail: req.user.email,
      // Session-2 hook: true only when CLUB_PLAN_GATES_ENABLED is on AND this
      // club is on the free plan (never-throw, computeProLocked convention).
      // No UI consumes it yet.
      gating: { clubProLocked: await computeClubProLocked(clubId) }
    };

    let html = injectProBadge(injectBottomNav(injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-club-dashboard.html'), 'utf8'), clubData), 'club-dashboard'), (await getUserPlan(req.user.id)) === 'pro');
    // Sidebar-footer identity badge: real subscription via getClubPlan, NOT
    // the CLUB_PLAN_GATES_ENABLED flag (a paying club shows its status even
    // with gates off — individual PRO badge precedent). Free clubs get '' so
    // their pages contain zero badge markup. Sibling of .club-name, so the
    // client's textContent rewrite can't wipe it.
    html = html.replace('<!--CLUB_PRO_BADGE_SLOT-->',
      (await getClubPlan(clubId)) === 'club_pro' ? CLUB_PRO_BADGE_HTML : '');
    res.type('html').send(html);
  } catch (err) {
    console.log('Dashboard data error:', err.message);
    sendPageError(res);
  }
});
// ── CLUB MEMBER PAGE ──
// A member's view of one specific club they belong to. The club id is in the
// path; we verify the viewer is actually a member of that club, then inject the
// real club + the viewer's profile as window.ARENAS_DATA. The bare /clubs/member
// route redirects to the viewer's first club (or /feed if they have none) so any
// old links keep working.
app.get(BASE + '/clubs/member', requirePageAuth, async (req, res) => {
  try {
    const clubs = await getSidebarClubs(req.user.id);
    if (clubs.length) return res.redirect(BASE + '/clubs/member/' + clubs[0].id);
    return res.redirect(BASE + '/feed');
  } catch (err) {
    console.log('Club member fallback error:', err.message);
    return res.redirect(BASE + '/feed');
  }
});
app.get(BASE + '/clubs/member/:clubId', requirePageAuth, async (req, res) => {
  try {
    // No service-role client means we can't verify membership — never serve the
    // static mock here (that's the wrong-club bug we're fixing); bounce to feed.
    if (!supabaseAdmin) return res.redirect(BASE + '/feed');
    // Confirm the viewer is a member of the requested club before showing it.
    const { data: membership } = await supabaseAdmin
      .from('memberships')
      .select('role, clubs:club_id (id, name, handle, sport, logo_url)')
      .eq('user_id', req.user.id)
      .eq('club_id', req.params.clubId)
      .maybeSingle();
    const club = membership && (Array.isArray(membership.clubs) ? membership.clubs[0] : membership.clubs);
    if (!club) {
      // Not a member of this club — fall back to their own first club, else the
      // feed. Guard against redirecting back to the same id (avoids a loop).
      const clubs = await getSidebarClubs(req.user.id);
      if (clubs.length && clubs[0].id !== req.params.clubId) {
        return res.redirect(BASE + '/clubs/member/' + clubs[0].id);
      }
      return res.redirect(BASE + '/feed');
    }
    const clubData = {
      club,
      role: membership.role,
      profile: displayFromUser(req.user),
      clubs: await getSidebarClubs(req.user.id),
      userId: req.user.id,
      userEmail: req.user.email
    };
    const html = injectProBadge(injectBottomNav(injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-club-member.html'), 'utf8'), clubData), 'club-member'), (await getUserPlan(req.user.id)) === 'pro');
    res.type('html').send(html);
  } catch (err) {
    console.log('Club member data error:', err.message);
    // Never serve the static mock on error — it would bypass the membership
    // (IDOR) gate. Bounce to the feed instead.
    res.redirect(BASE + '/feed');
  }
});

// ── CLUB MEMBER HOME DATA (API) ──
// Everything a member sees about ONE club, in a single payload: hero stats,
// their weekly leaderboard standing, recent coach announcements, upcoming
// events (with the viewer's RSVP), active challenges (with the viewer's
// progress), and the roster. Membership-gated. Display names come from auth
// metadata via buildUserProfileMap (there is no profiles table); points reuse
// the shared calculatePoints heuristic (unit-aware distance).
app.get(BASE + '/api/clubs/:clubId/member-home', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Service unavailable' });
  const { clubId } = req.params;
  const userId = req.user.id;
  const PLACEHOLDER = '00000000-0000-0000-0000-000000000000';
  try {
    // Membership gate — non-members get a soft error the client renders inline.
    const { data: myMembership } = await supabaseAdmin
      .from('memberships')
      .select('role')
      .eq('user_id', userId)
      .eq('club_id', clubId)
      .maybeSingle();
    const viewerIsClubManager = !!myMembership && (myMembership.role === 'admin' || myMembership.role === 'coach');
    if (!myMembership) return res.json({ error: 'Not a member of this club' });

    // Club details.
    const { data: club } = await supabaseAdmin
      .from('clubs')
      .select('id, name, handle, sport, city, logo_url')
      .eq('id', clubId)
      .maybeSingle();

    // Full roster, ordered by join time. Names resolved from auth metadata.
    const { data: members } = await supabaseAdmin
      .from('memberships')
      .select('user_id, role, created_at')
      .eq('club_id', clubId)
      .order('created_at', { ascending: true });
    const memberRows = members || [];
    const memberIds = memberRows.map((m) => m.user_id);
    const safeIds = memberIds.length ? memberIds : [PLACEHOLDER];
    const profileMap = await buildUserProfileMap(memberIds);
    const nameOf = (id) => (profileMap[id] && profileMap[id].name) || 'Member';
    const handleOf = (id) => (profileMap[id] && profileMap[id].handle) || 'member';

    // Roster: admins, then coaches, then members alphabetically.
    const roleOrder = { admin: 0, coach: 1, member: 2 };
    const roster = memberRows.map((m) => ({
      userId: m.user_id,
      name: nameOf(m.user_id),
      handle: handleOf(m.user_id),
      avatar_url: (profileMap[m.user_id] && profileMap[m.user_id].avatar_url) || null,
      profilePublic: profileMap[m.user_id] ? profileMap[m.user_id].profilePublic !== false : true,
      role: m.role,
      isMe: m.user_id === userId
    })).sort((a, b) => ((roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3)) || a.name.localeCompare(b.name));

    // Club announcements — by the post's stored club_id (the durable signal),
    // never the author's current role. Announcements are club-owned speech:
    // they stay if the author leaves the club or changes roles.
    const { data: announcements } = await supabaseAdmin
      .from('posts')
      .select('id, user_id, content, image_url, created_at')
      .eq('club_id', clubId)
      .order('created_at', { ascending: false })
      .limit(5);
    const annRows = announcements || [];
    // Departed authors are outside the roster profile map — fetch them too.
    const missingAnnAuthors = [...new Set(annRows.map((a) => a.user_id))]
      .filter((id) => id && !profileMap[id]);
    if (missingAnnAuthors.length) {
      Object.assign(profileMap, await buildUserProfileMap(missingAnnAuthors));
    }
    const annIds = annRows.map((a) => a.id);
    const { data: annLikes } = await supabaseAdmin
      .from('post_likes')
      .select('post_id, user_id')
      .in('post_id', annIds.length ? annIds : [PLACEHOLDER]);
    const likeRows = annLikes || [];
    const { data: annComments } = await supabaseAdmin
      .from('post_comments')
      .select('post_id')
      .in('post_id', annIds.length ? annIds : [PLACEHOLDER]);
    const annCommentRows = annComments || [];
    const announcementsOut = annRows.map((a) => {
      const likes = likeRows.filter((l) => l.post_id === a.id);
      return {
        id: a.id,
        userId: a.user_id,
        canDelete: viewerIsClubManager,
        coachName: nameOf(a.user_id),
        coachAvatarUrl: (profileMap[a.user_id] && profileMap[a.user_id].avatar_url) || null,
        coachProfilePublic: profileMap[a.user_id] ? profileMap[a.user_id].profilePublic !== false : true,
        // Display role only if the author is still on the roster — a departed
        // author gets no role badge, but keeps honest "posted by" attribution.
        role: (memberRows.find((m) => m.user_id === a.user_id) || {}).role || null,
        content: a.content,
        image_url: a.image_url || null,
        createdAt: a.created_at,
        likeCount: likes.length,
        commentCount: annCommentRows.filter((c) => c.post_id === a.id).length,
        likedByMe: likes.some((l) => l.user_id === userId)
      };
    });

    // Upcoming club events with the viewer's RSVP status.
    const nowIso = new Date().toISOString();
    const { data: clubEvents } = await supabaseAdmin
      .from('events')
      .select('id, title, date, location, sport, image_path')
      .eq('club_id', clubId)
      .gte('date', nowIso)
      .order('date', { ascending: true })
      .limit(5);
    const eventRows = clubEvents || [];
    const eventIds = eventRows.map((e) => e.id);
    const { data: allEventRsvps } = await supabaseAdmin
      .from('event_rsvps')
      .select('event_id, user_id, status')
      .in('event_id', eventIds.length ? eventIds : [PLACEHOLDER]);
    const rsvpRows = allEventRsvps || [];
    const eventsOut = eventRows.map((e) => {
      const rsvps = rsvpRows.filter((r) => r.event_id === e.id);
      const myRsvp = rsvps.find((r) => r.user_id === userId);
      return {
        id: e.id, title: e.title, date: e.date, location: e.location, sport: e.sport,
        image: eventImageVersion(e.image_path),
        goingCount: rsvps.filter((r) => r.status === 'going').length,
        myStatus: myRsvp ? myRsvp.status : null
      };
    });

    // Active club challenges with the viewer's progress.
    const { data: clubChallenges } = await supabaseAdmin
      .from('challenges')
      .select('id, title, sport, goal_type, goal_target, goal_unit, start_date, end_date, image_path')
      .eq('club_id', clubId)
      .gte('end_date', nowIso)
      .order('end_date', { ascending: true });
    const { data: myActs } = await supabaseAdmin
      .from('activities')
      .select('sport, distance, date')
      .eq('user_id', userId);
    const myActRows = myActs || [];
    const challengesOut = [];
    for (const ch of (clubChallenges || [])) {
      const { data: myPart } = await supabaseAdmin
        .from('challenge_participants')
        .select('id')
        .eq('challenge_id', ch.id)
        .eq('user_id', userId)
        .maybeSingle();
      const { count: participantCount } = await supabaseAdmin
        .from('challenge_participants')
        .select('*', { count: 'exact', head: true })
        .eq('challenge_id', ch.id);
      let progress = 0;
      const streakDays = new Set();
      // Viewer's own progress: window + streak days in the VIEWER'S zone
      // (boundary policy), matching the shared challenge helpers.
      const viewerTz = getUserTimezone(req.user);
      const chWin = challengeWindowFor(ch, viewerTz);
      const chStart = new Date(ch.start_date);
      const chEnd = new Date(ch.end_date);
      myActRows.forEach((a) => {
        const t = new Date(a.date).getTime();
        if (t < chWin.startMs || t > chWin.endMs) return;
        if (ch.sport !== 'any' && a.sport !== ch.sport) return;
        if (ch.goal_type === 'distance') progress += parseDistanceKmUnitAware(a.distance);
        else if (ch.goal_type === 'duration') progress += parseDurationHours(a.duration);
        else if (ch.goal_type === 'streak') streakDays.add(dayKey(a.date, viewerTz));
        else progress += 1;
      });
      if (ch.goal_type === 'streak') progress = streakDays.size;
      progress = Math.round(progress * 10) / 10;
      // Guard every completion check with goal_target > 0 — a 0/null target
      // would make pct/"achieved" fire with no real progress.
      const pct = ch.goal_target > 0 ? Math.min(100, Math.round((progress / ch.goal_target) * 100)) : 0;
      const totalDays = Math.max(1, (chEnd - chStart) / 86400000);
      const elapsed = Math.max(0, (new Date() - chStart) / 86400000);
      const expectedPct = Math.round((elapsed / totalDays) * 100);
      const daysLeft = Math.max(0, Math.ceil((chEnd - new Date()) / 86400000));
      let statusText, statusColor;
      if (!myPart) { statusText = 'Not joined — tap to join'; statusColor = '#854D0E'; }
      else if (ch.goal_target > 0 && pct >= 100) { statusText = 'Goal achieved ✓'; statusColor = '#10B981'; }
      else if (ch.goal_type === 'streak') {
        const rem = Math.max(0, (ch.goal_target || 0) - progress);
        statusText = `${rem} more active day${rem !== 1 ? 's' : ''} to go`;
        statusColor = '#854D0E';
      }
      else if (pct >= expectedPct) { statusText = 'On pace'; statusColor = '#10B981'; }
      else { statusText = 'Behind pace — push on'; statusColor = '#854D0E'; }
      challengesOut.push({
        id: ch.id, title: ch.title, sport: ch.sport,
        image: challengeImageVersion(ch.image_path),
        goalTarget: ch.goal_target, goalUnit: ch.goal_unit,
        joined: !!myPart, progress, pct, daysLeft, statusText, statusColor,
        participantCount: participantCount || 0
      });
    }

    // The viewer's standing in the club's weekly points leaderboard.
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    const { data: weekActs } = await supabaseAdmin
      .from('activities')
      .select('user_id, sport, distance, duration, date')
      .in('user_id', safeIds)
      .gte('date', weekStart.toISOString());
    const ptsByUser = {};
    memberIds.forEach((id) => { ptsByUser[id] = []; });
    (weekActs || []).forEach((a) => { if (ptsByUser[a.user_id]) ptsByUser[a.user_id].push(a); });
    const standings = memberIds.map((id) => ({ userId: id, points: calculatePoints(ptsByUser[id]) }))
      .sort((a, b) => b.points - a.points);
    const myRankIdx = standings.findIndex((s) => s.userId === userId);
    const myRank = myRankIdx >= 0 ? myRankIdx + 1 : null;
    const myPoints = myRankIdx >= 0 ? standings[myRankIdx].points : 0;
    const myActiveChallenges = challengesOut.filter((c) => c.joined).length;

    res.json({
      club,
      stats: {
        memberCount: memberRows.length,
        eventCount: eventsOut.length,
        challengeCount: challengesOut.length,
        myRank, myPoints
      },
      standing: { rank: myRank, total: memberRows.length, points: myPoints, activeChallenges: myActiveChallenges },
      announcements: announcementsOut,
      events: eventsOut,
      challenges: challengesOut,
      roster,
      myRole: myMembership.role,
      viewerId: userId
    });
  } catch (err) {
    console.log('Club member-home error:', err.message);
    res.json({ error: 'Could not load club' });
  }
});

// ── CLUB INVITE ADMIN PAGE ──
// Renders the invite console with the manager's real club, pending invites, and
// members injected as window.INVITE_DATA. Falls back to the static mockup if the
// viewer isn't a club manager or data can't be loaded.
app.get(BASE + '/clubs/invite', requirePageAuth, async (req, res) => {
  try {
    if (!supabaseAdmin) return sendPageError(res);

    // Same club resolution as the dashboard: honor an explicit ?club=<id>
    // when the viewer manages it (so the invite console stays on the club the
    // manager came from), otherwise fall back to the most recent admin/coach
    // membership. The role filter keeps this IDOR-safe — an unmanaged or
    // unknown id silently falls back to the default club.
    const requestedClubId = typeof req.query.club === 'string' ? req.query.club : null;
    const pickManagedMembership = async (clubFilter) => {
      let q = supabaseAdmin
        .from('memberships')
        .select('club_id, role, clubs (id, name, handle, sport, city, logo_url, visibility, description)')
        .eq('user_id', req.user.id)
        .in('role', ['admin', 'coach']);
      if (clubFilter) q = q.eq('club_id', clubFilter);
      const { data } = await q
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    };
    let membership = requestedClubId ? await pickManagedMembership(requestedClubId) : null;
    if (!membership) membership = await pickManagedMembership(null);

    if (!membership || !membership.club_id) return res.redirect(BASE + '/feed');
    const clubId = membership.club_id;

    const [invitesRes, membersRes, countRes] = await Promise.all([
      supabaseAdmin.from('club_invites').select('*').eq('club_id', clubId).order('created_at', { ascending: false }),
      supabaseAdmin.from('memberships').select('user_id, role, created_at').eq('club_id', clubId).order('created_at', { ascending: false }),
      supabaseAdmin.from('memberships').select('*', { count: 'exact', head: true }).eq('club_id', clubId)
    ]);

    const invites = invitesRes.data || [];
    const memberRows = membersRes.data || [];
    const memberCount = countRes.count || 0;

    const nameMap = await buildUserDisplayMap([
      ...invites.map(i => i.invited_by),
      ...memberRows.map(m => m.user_id)
    ]);

    const now = Date.now();
    const inviteData = {
      club: membership.clubs || { id: clubId, name: 'Your club' },
      role: membership.role,
      profile: displayFromUser(req.user),
      memberCount,
      invites: invites.map(i => ({
        id: i.id,
        email: i.email,
        role: i.role,
        status: i.status,
        created_at: i.created_at,
        expires_at: i.expires_at,
        accepted_at: i.accepted_at,
        isOpen: i.email === OPEN_INVITE_EMAIL,
        isExpired: i.expires_at ? new Date(i.expires_at).getTime() < now : false,
        invitedByName: (nameMap[i.invited_by] && nameMap[i.invited_by].name) || 'A coach'
      })),
      members: memberRows.map(m => ({
        user_id: m.user_id,
        role: m.role,
        joined_at: m.created_at,
        name: (nameMap[m.user_id] && nameMap[m.user_id].name) || 'Member',
        handle: (nameMap[m.user_id] && nameMap[m.user_id].handle) || 'member',
        avatar_url: (nameMap[m.user_id] && nameMap[m.user_id].avatar_url) || null,
        isSelf: m.user_id === req.user.id
      })),
      baseUrl: publicBaseUrl(req)
    };

    let html = injectNotificationsPanel(injectNamedData(fs.readFileSync(path.join(HTML, 'arenas-club-invite.html'), 'utf8'), 'INVITE_DATA', inviteData));
    // Sidebar-footer club-identity badge — same rule as the dashboard route:
    // real subscription via getClubPlan (never the CLUB_PLAN_GATES_ENABLED
    // flag); free clubs get '' so their pages contain zero badge markup.
    html = html.replace('<!--CLUB_PRO_BADGE_SLOT-->',
      (await getClubPlan(clubId)) === 'club_pro' ? CLUB_PRO_BADGE_HTML : '');
    res.type('html').send(html);
  } catch (err) {
    console.log('Invite page data error:', err.message);
    sendPageError(res);
  }
});

// ── BILLING (Stripe Checkout) ──
// Checkout START only. NOTHING in this section writes to the subscriptions
// table — the webhook below is its sole writer. A successful checkout only
// becomes an active plan once the checkout.session.completed event lands.

// Read-only lookup of ANY subscription row for an owner (any status). Used to
// reuse the existing Stripe customer so a re-subscriber keeps one customer
// record instead of forking a second one.
async function findAnySubscriptionRow(ownerType, ownerId) {
  if (!supabaseAdmin || !ownerId) return null;
  try {
    const { data } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('owner_type', ownerType)
      .eq('owner_id', ownerId)
      .limit(1);
    return (Array.isArray(data) && data[0]) || null;
  } catch (err) {
    return null;
  }
}

// Shared Checkout Session builder. metadata.owner_type/owner_id is set BOTH on
// the session AND on subscription_data so the Session ③ webhook can identify
// the owner from customer.subscription.* events without extra lookups.
// metadata.initiated_by is the logged-in user who started checkout — the
// success page uses it to reject other users' session IDs.
async function createBillingCheckout({ req, ownerType, ownerId, priceId }) {
  const base = publicBaseUrl(req);
  const params = {
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { owner_type: ownerType, owner_id: ownerId, initiated_by: req.user.id },
    subscription_data: { metadata: { owner_type: ownerType, owner_id: ownerId } },
    client_reference_id: ownerType + ':' + ownerId,
    success_url: base + '/billing/success?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: base + '/billing/canceled'
  };
  const existing = await findAnySubscriptionRow(ownerType, ownerId);
  if (existing && existing.stripe_customer_id) {
    params.customer = existing.stripe_customer_id;
  } else if (req.user.email) {
    params.customer_email = req.user.email;
  }
  return stripe.checkout.sessions.create(params);
}

// Start Individual Pro checkout for the logged-in user.
app.post(BASE + '/api/billing/checkout/pro', requireAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Billing is not configured' });
  const priceId = (process.env.STRIPE_PRICE_PRO || '').trim();
  if (!priceId) return res.status(503).json({ error: 'Billing is not configured' });
  try {
    const plan = await getUserPlan(req.user.id);
    if (plan === 'pro') return res.status(409).json({ error: 'already subscribed' });
    const session = await createBillingCheckout({
      req, ownerType: 'user', ownerId: req.user.id, priceId
    });
    return res.json({ url: session.url });
  } catch (err) {
    console.log('Pro checkout error:', err.message);
    return res.status(500).json({ error: 'Could not start checkout' });
  }
});

// Start Club Pro checkout for a club. Same authorization bar as every other
// club-management action (admin/coach via getClubRole); plain members 403.
app.post(BASE + '/api/billing/checkout/club/:clubId', requireAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Billing is not configured' });
  const priceId = (process.env.STRIPE_PRICE_CLUB_PRO || '').trim();
  if (!priceId) return res.status(503).json({ error: 'Billing is not configured' });
  const { clubId } = req.params;
  const role = await getClubRole(req.user.id, clubId);
  if (!isClubManagerRole(role && role.role)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  try {
    const plan = await getClubPlan(clubId);
    if (plan === 'club_pro') return res.status(409).json({ error: 'already subscribed' });
    const session = await createBillingCheckout({
      req, ownerType: 'club', ownerId: clubId, priceId
    });
    return res.json({ url: session.url });
  } catch (err) {
    console.log('Club checkout error:', err.message);
    return res.status(500).json({ error: 'Could not start checkout' });
  }
});

// Start Club Pro checkout without an explicit club id (used by the marketing
// pricing CTAs, which don't know the caller's clubs). Resolves the caller's
// managed clubs (admin/coach) server-side: checkout starts for the first
// managed club still on the free plan; a caller who manages no club is routed
// to club creation ({redirect}); all managed clubs already subscribed → 409.
app.post(BASE + '/api/billing/checkout/club', requireAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Billing is not configured' });
  const priceId = (process.env.STRIPE_PRICE_CLUB_PRO || '').trim();
  if (!priceId) return res.status(503).json({ error: 'Billing is not configured' });
  if (!supabaseAdmin) return res.status(503).json({ error: 'Billing is not configured' });
  try {
    const { data: mems } = await supabaseAdmin
      .from('memberships')
      .select('club_id, role')
      .eq('user_id', req.user.id);
    const managed = (mems || []).filter(m => isClubManagerRole(m.role) && m.club_id);
    if (managed.length === 0) {
      return res.json({ redirect: BASE + '/for-clubs' });
    }
    for (const m of managed) {
      const plan = await getClubPlan(m.club_id);
      if (plan !== 'club_pro') {
        const session = await createBillingCheckout({
          req, ownerType: 'club', ownerId: m.club_id, priceId
        });
        return res.json({ url: session.url });
      }
    }
    return res.status(409).json({ error: 'already subscribed' });
  } catch (err) {
    console.log('Club checkout (auto) error:', err.message);
    return res.status(500).json({ error: 'Could not start checkout' });
  }
});

// Billing page. Shows the honest current state: the viewer's individual plan
// (getUserPlan), the plan of every club they manage (getClubPlan), upgrade
// buttons with auto-renewal disclosures when free, and Manage billing (Stripe
// portal) when subscribed. Rendered from injected data only — no fabrication.
app.get(BASE + '/billing', requirePageAuth, async (req, res) => {
  try {
    if (!supabaseAdmin) return sendPageError(res);
    const userPlan = await getUserPlan(req.user.id);
    const clubs = await getSidebarClubs(req.user.id);
    const { data: mems } = await supabaseAdmin
      .from('memberships')
      .select('role, club_id, clubs:club_id (id, name, sport)')
      .eq('user_id', req.user.id);
    const managedClubs = [];
    for (const m of (mems || [])) {
      if (!isClubManagerRole(m.role)) continue;
      const c = Array.isArray(m.clubs) ? m.clubs[0] : m.clubs;
      if (!c || !c.id) continue;
      managedClubs.push({
        id: c.id,
        name: c.name || 'Club',
        role: m.role,
        plan: await getClubPlan(c.id)
      });
    }
    const data = {
      userId: req.user.id,
      profile: displayFromUser(req.user),
      clubs,
      billing: { configured: !!stripe, userPlan, managedClubs }
    };
    const html = injectProBadge(
      injectBottomNav(
        injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-billing.html'), 'utf8'), data),
        'billing'
      ),
      userPlan === 'pro'
    );
    res.type('html').send(html);
  } catch (err) {
    console.log('Billing page error:', err.message);
    sendPageError(res);
  }
});

// Post-checkout landing. Retrieves the Checkout Session server-side and shows
// an HONEST confirmation of what Stripe reports — it deliberately does NOT
// claim plan features are active (activation arrives with the Session ③
// webhook) and writes nothing to the database.
app.get(BASE + '/billing/success', requirePageAuth, async (req, res) => {
  const sessionId = typeof req.query.session_id === 'string' ? req.query.session_id.trim() : '';
  let data = { status: 'error' };
  if (!stripe) {
    data = { status: 'unavailable' };
  } else if (!sessionId) {
    data = { status: 'missing' };
  } else {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const meta = session.metadata || {};
      if (meta.initiated_by !== req.user.id) {
        // Someone else's session ID (or a session we didn't create): reject.
        data = { status: 'forbidden' };
      } else {
        // Derive the recurring-price label from the REAL subscription price
        // object via the SAME helper the confirmation email uses, so the page
        // and the email share exactly one code path and can't drift or go
        // stale. subscriptionPriceLabel already substitutes the neutral,
        // non-stale fallback if the price object is unreadable.
        let priceLabel = PRICE_FALLBACK_LABEL;
        try {
          const subId =
            typeof session.subscription === 'string'
              ? session.subscription
              : session.subscription && session.subscription.id;
          if (subId) {
            const sub = await stripe.subscriptions.retrieve(subId);
            priceLabel = subscriptionPriceLabel(sub);
          }
        } catch (err) {
          // Non-fatal: priceLabel stays the neutral fallback (no numeric guess).
        }
        data = {
          status: 'ok',
          sessionStatus: session.status,          // complete | open | expired
          paymentStatus: session.payment_status,  // paid | unpaid | no_payment_required
          planLabel: meta.owner_type === 'club' ? 'Club Pro' : 'Individual Pro',
          priceLabel,                             // "$9/month" from the real price, or neutral fallback
          livemode: !!session.livemode
        };
      }
    } catch (err) {
      data = { status: 'notfound' };
    }
  }
  data.baseUrl = BASE;
  const html = injectNamedData(
    fs.readFileSync(path.join(HTML, 'arenas-billing-success.html'), 'utf8'),
    'BILLING_DATA', data
  );
  res.type('html').send(html);
});

// Cancel landing: nothing was created or charged; static reassurance page.
app.get(BASE + '/billing/canceled', requirePageAuth, (req, res) => {
  res.type('html').send(fs.readFileSync(path.join(HTML, 'arenas-billing-canceled.html'), 'utf8'));
});

// ── BILLING (Stripe webhook) ──
// The webhook is the SOLE writer to the subscriptions table; everything else
// (plan helpers, customer reuse) only reads it. The raw-body mount for this
// path lives up top, BEFORE the global body parsers — signature verification
// needs the exact request bytes.

// Map a Stripe price ID to our plan value. Falls back to the owner type so a
// rotated/unknown price ID can't silently drop a paid row (logged upstream).
function planFromPrice(priceId, ownerType) {
  if (priceId && priceId === (process.env.STRIPE_PRICE_CLUB_PRO || '').trim()) return 'club_pro';
  if (priceId && priceId === (process.env.STRIPE_PRICE_PRO || '').trim()) return 'pro';
  return ownerType === 'club' ? 'club_pro' : 'pro';
}

// current_period_end moved from the subscription object to its items on newer
// Stripe API versions — check both. Returns an ISO timestamp or null.
function subPeriodEndIso(sub) {
  const item = sub && sub.items && sub.items.data && sub.items.data[0];
  const unix = (sub && sub.current_period_end) || (item && item.current_period_end) || null;
  return unix ? new Date(unix * 1000).toISOString() : null;
}

// The invoice→subscription link also moved across Stripe API versions: older
// payloads have invoice.subscription, newer ones nest it under
// parent.subscription_details. Check both, then the line items.
function invoiceSubscriptionId(invoice) {
  if (!invoice) return null;
  const direct = invoice.subscription;
  if (typeof direct === 'string') return direct;
  if (direct && direct.id) return direct.id;
  const details = invoice.parent && invoice.parent.subscription_details;
  if (details) {
    if (typeof details.subscription === 'string') return details.subscription;
    if (details.subscription && details.subscription.id) return details.subscription.id;
  }
  const line = invoice.lines && invoice.lines.data && invoice.lines.data[0];
  if (line) {
    if (typeof line.subscription === 'string') return line.subscription;
    const lp = line.parent && line.parent.subscription_item_details;
    if (lp && typeof lp.subscription === 'string') return lp.subscription;
  }
  return null;
}

// Owner identity from a subscription's own metadata (the contract set at
// checkout: subscription_data.metadata = { owner_type, owner_id }).
function subscriptionOwner(sub) {
  const meta = (sub && sub.metadata) || {};
  if ((meta.owner_type === 'user' || meta.owner_type === 'club') && meta.owner_id) {
    return { ownerType: meta.owner_type, ownerId: meta.owner_id };
  }
  return null;
}

// Upsert the single row per owner from a Stripe subscription object, keyed on
// unique(owner_type, owner_id) so replayed and out-of-order events converge
// on the same final row. Throws on DB failure so the webhook answers 500 and
// Stripe retries the event.
async function upsertSubscriptionRow(sub, ownerType, ownerId) {
  const item = sub.items && sub.items.data && sub.items.data[0];
  const priceId = item && item.price && item.price.id;
  const row = {
    owner_type: ownerType,
    owner_id: ownerId,
    plan: planFromPrice(priceId, ownerType),
    stripe_customer_id:
      typeof sub.customer === 'string' ? sub.customer : (sub.customer && sub.customer.id) || null,
    stripe_subscription_id: sub.id,
    status: sub.status,
    current_period_end: subPeriodEndIso(sub),
    cancel_at_period_end: !!sub.cancel_at_period_end,
    updated_at: new Date().toISOString()
  };
  const { error } = await supabaseAdmin
    .from('subscriptions')
    .upsert(row, { onConflict: 'owner_type,owner_id' });
  if (error) throw new Error('subscriptions upsert failed: ' + error.message);
}

app.post(BASE + '/api/stripe/webhook', async (req, res) => {
  const whSecret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!stripe || !whSecret) {
    console.log('[stripe webhook skipped: no', !stripe ? 'STRIPE_SECRET_KEY]' : 'STRIPE_WEBHOOK_SECRET]');
    return res.status(503).send('Billing not configured');
  }
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], whSecret);
  } catch (err) {
    console.log('[stripe webhook] invalid signature:', err.message);
    return res.status(400).send('Invalid signature');
  }
  try {
    if (!supabaseAdmin) throw new Error('supabaseAdmin not configured');
    // Populated by checkout.session.completed; the confirmation email is sent
    // AFTER the 200 response below (fire-and-forget) so a send failure can never
    // turn a successful webhook into a 500 — which would make Stripe retry and
    // re-run the upsert.
    let confirmationEmail = null;
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const meta = session.metadata || {};
        if (session.mode !== 'subscription' || !session.subscription) break; // not a billing checkout
        if (!((meta.owner_type === 'user' || meta.owner_type === 'club') && meta.owner_id)) {
          console.log('[stripe webhook] completed session missing owner metadata:', session.id);
          break;
        }
        const subId =
          typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
        const sub = await stripe.subscriptions.retrieve(subId);
        // Same stale guard as sub.updated: a redelivered completed event for
        // an OLD session (possible only after earlier 5xx + retry) must not
        // let its now-canceled subscription clobber a newer re-subscribe row.
        const { data: prior } = await supabaseAdmin
          .from('subscriptions')
          .select('stripe_subscription_id')
          .eq('owner_type', meta.owner_type)
          .eq('owner_id', meta.owner_id)
          .limit(1);
        const priorRow = (Array.isArray(prior) && prior[0]) || null;
        const subPaying = PAID_SUB_STATUSES.includes(sub.status) || sub.status === 'trialing';
        if (priorRow && priorRow.stripe_subscription_id && priorRow.stripe_subscription_id !== sub.id && !subPaying) {
          console.log('[stripe webhook] stale completed ignored:', sub.id, '(row has', priorRow.stripe_subscription_id + ')');
          break;
        }
        await upsertSubscriptionRow(sub, meta.owner_type, meta.owner_id);
        console.log('[stripe webhook] checkout completed →', meta.owner_type, meta.owner_id, '=', sub.status);
        // Queue the ARL-compliant confirmation email for the paying subscriber.
        // owner_type maps 1:1 to product (user → Individual Pro, club → Club
        // Pro) because the two checkout flows use distinct prices. The price
        // string is derived from the REAL subscription price object at send
        // time (never hardcoded) so a Stripe price change can't leave the ARL
        // email stating a stale amount. Gated on subPaying so we never
        // "confirm" an incomplete/unpaid subscription.
        const confirmTo =
          (session.customer_details && session.customer_details.email) ||
          session.customer_email ||
          null;
        if (subPaying && confirmTo) {
          const isClub = meta.owner_type === 'club';
          const conf = buildSubscriptionConfirmationEmail({
            planLabel: isClub ? 'Club Pro' : 'Individual Pro',
            priceLabel: subscriptionPriceLabel(sub),
            manageUrl: publicBaseUrl(req) + '/billing'
          });
          confirmationEmail = { to: confirmTo, subject: conf.subject, html: conf.html, text: conf.text };
        } else if (subPaying) {
          console.log('[stripe webhook] completed but no customer email to confirm:', session.id);
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const owner = subscriptionOwner(sub);
        if (!owner) {
          console.log('[stripe webhook] sub.updated missing owner metadata:', sub.id);
          break;
        }
        // Upsert (not update): this event can arrive BEFORE
        // checkout.session.completed and must produce the same final row.
        // One guard on top of the spec: a non-paying update for an OLD
        // subscription must not clobber a row that has since moved to a
        // different (newer) subscription — e.g. a late-retried "canceled"
        // update for the previous subscription after a re-subscribe.
        const { data: existing } = await supabaseAdmin
          .from('subscriptions')
          .select('stripe_subscription_id')
          .eq('owner_type', owner.ownerType)
          .eq('owner_id', owner.ownerId)
          .limit(1);
        const row = (Array.isArray(existing) && existing[0]) || null;
        const paying = PAID_SUB_STATUSES.includes(sub.status) || sub.status === 'trialing';
        if (row && row.stripe_subscription_id && row.stripe_subscription_id !== sub.id && !paying) {
          console.log('[stripe webhook] stale sub.updated ignored:', sub.id, '(row has', row.stripe_subscription_id + ')');
          break;
        }
        await upsertSubscriptionRow(sub, owner.ownerType, owner.ownerId);
        console.log('[stripe webhook] sub.updated →', owner.ownerType, owner.ownerId, '=', sub.status);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        // Keep the row (stripe_customer_id is reused at next checkout); just
        // flip status — the plan helpers treat anything outside
        // active/past_due as free. The stale-event guard is inherent in
        // matching BY subscription ID: a delete for an old subscription finds
        // no row once the owner re-subscribed under a new one.
        const { data, error } = await supabaseAdmin
          .from('subscriptions')
          .update({ status: 'canceled', cancel_at_period_end: !!sub.cancel_at_period_end, updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', sub.id)
          .select('owner_type, owner_id');
        if (error) throw new Error('subscriptions cancel update failed: ' + error.message);
        console.log('[stripe webhook] sub.deleted', sub.id, data && data.length ? '→ row canceled' : '→ no matching row (stale, ignored)');
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subId = invoiceSubscriptionId(invoice);
        if (!subId) {
          console.log('[stripe webhook] payment_failed without a subscription:', invoice.id);
          break;
        }
        // Same inherent stale guard: match by subscription ID only.
        const { data, error } = await supabaseAdmin
          .from('subscriptions')
          .update({ status: 'past_due', updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', subId)
          .select('owner_type, owner_id');
        if (error) throw new Error('subscriptions past_due update failed: ' + error.message);
        console.log('[stripe webhook] payment_failed', subId, data && data.length ? '→ past_due' : '→ no matching row (stale, ignored)');
        break;
      }
      default:
        break; // every other event type is acknowledged and ignored
    }
    res.status(200).json({ received: true });
    // Non-critical, post-response: send the confirmation email fire-and-forget.
    // sendEmail never throws (it degrades to a log with no RESEND_API_KEY and
    // returns { ok:false } on HTTP errors); the .catch is defensive only. The
    // webhook has already answered 200, so nothing here can affect its outcome.
    if (confirmationEmail) {
      sendEmail(confirmationEmail).catch((err) =>
        console.error('[stripe webhook] confirmation email error:', (err && err.message) || err)
      );
    }
    return;
  } catch (err) {
    console.error('[stripe webhook] handler failed:', event.type, '—', err.message);
    return res.status(500).send('Webhook handler failed'); // Stripe retries on 500
  }
});

// ── BILLING (Customer Portal) ──
// Self-serve subscription management (cancel, update card, invoices) via
// Stripe's hosted portal. Looks up the owner's stripe_customer_id from the
// subscriptions table (any status — a canceled owner can still open the
// portal for history); 404 with a clear message when there's nothing yet.

async function createPortalSession({ req, ownerType, ownerId }) {
  const row = await findAnySubscriptionRow(ownerType, ownerId);
  if (!row || !row.stripe_customer_id) return null;
  return stripe.billingPortal.sessions.create({
    customer: row.stripe_customer_id,
    return_url: publicBaseUrl(req) + '/feed'
  });
}

app.post(BASE + '/api/billing/portal/pro', requireAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Billing is not configured' });
  try {
    const portal = await createPortalSession({ req, ownerType: 'user', ownerId: req.user.id });
    if (!portal) return res.status(404).json({ error: 'No subscription found for your account' });
    return res.json({ url: portal.url });
  } catch (err) {
    console.log('Pro portal error:', err.message);
    return res.status(500).json({ error: 'Could not open billing portal' });
  }
});

// Same authorization bar as club checkout: admin/coach only.
app.post(BASE + '/api/billing/portal/club/:clubId', requireAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Billing is not configured' });
  const { clubId } = req.params;
  const role = await getClubRole(req.user.id, clubId);
  if (!isClubManagerRole(role && role.role)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  try {
    const portal = await createPortalSession({ req, ownerType: 'club', ownerId: clubId });
    if (!portal) return res.status(404).json({ error: 'No subscription found for this club' });
    return res.json({ url: portal.url });
  } catch (err) {
    console.log('Club portal error:', err.message);
    return res.status(500).json({ error: 'Could not open billing portal' });
  }
});

// ── CLUB INVITES API ──
// Create a single personal email invite. Only club admins/coaches may invite.
app.post(BASE + '/api/clubs/:clubId/invites', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Server not configured' });
  const { clubId } = req.params;
  const role = await getClubRole(req.user.id, clubId);
  if (!isClubManagerRole(role && role.role)) return res.status(403).json({ error: 'Not authorized' });

  let email = (req.body && req.body.email || '').trim().toLowerCase();
  let inviteRole = ['member', 'coach', 'admin'].includes(req.body && req.body.role) ? req.body.role : 'member';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  try {
    const { data: existing } = await supabaseAdmin
      .from('club_invites')
      .select('id')
      .eq('club_id', clubId)
      .eq('email', email)
      .eq('status', 'pending')
      .maybeSingle();
    if (existing) return res.status(409).json({ error: 'An invite is already pending for this email' });

    // Does this email already belong to an Arenas user? If so, we'll notify
    // them in-app instead of relying on the join link alone.
    const allUsers = await listAllAuthUsers();
    const existingUser = allUsers.find(u => (u.email || '').toLowerCase() === email) || null;
    if (existingUser) {
      const memberRole = await getClubRole(existingUser.id, clubId);
      if (memberRole) return res.status(409).json({ error: 'This person is already a member of your club' });
    }

    const token = generateInviteToken();
    const { data: invite, error } = await supabaseAdmin
      .from('club_invites')
      .insert({
        club_id: clubId,
        invited_by: req.user.id,
        email,
        role: inviteRole,
        token,
        status: 'pending',
        expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString()
      })
      .select('*')
      .single();
    if (error) {
      console.log('Invite insert error:', error.message);
      return res.status(500).json({ error: 'Could not create invite' });
    }
    const joinUrl = `${publicBaseUrl(req)}/join/${token}`;

    // Resolve club + inviter names once, for both the email and the in-app notif.
    const inviter = displayFromUser(req.user);
    let clubName = 'a club';
    try {
      const { data: club } = await supabaseAdmin.from('clubs').select('name').eq('id', clubId).single();
      if (club && club.name) clubName = club.name;
    } catch (err) { /* fall back to generic name */ }

    // Everyone invited gets the email. Fire-and-forget: a failed send must never
    // block invite creation (the row already exists and the manager has the link).
    const invEmail = buildInviteEmail({ clubName, inviterName: inviter.name, joinUrl, role: inviteRole });
    sendEmail({ to: email, subject: invEmail.subject, html: invEmail.html, text: invEmail.text });

    if (existingUser) {
      // Existing Arenas users ALSO get an in-app notification (one-click join).
      // Link stored without the BASE prefix (client prepends it). The public
      // /join/:token page handles one-click join for a signed-in invitee.
      await createNotification({
        userId: existingUser.id,
        type: 'club',
        title: 'Club invite',
        body: `${inviter.name} invited you to join ${clubName} on Arenas`,
        link: `/join/${token}`,
        actorId: req.user.id,
        entityId: clubId
      });
      return res.json({
        success: true,
        existingUser: true,
        invite,
        joinUrl,
        message: `${email} already has an Arenas account — they've been emailed and notified in-app, and can join with one click`
      });
    }

    return res.json({
      success: true,
      existingUser: false,
      invite,
      joinUrl,
      message: `Invite email sent to ${email}`
    });
  } catch (err) {
    console.log('Invite error:', err.message);
    return res.status(500).json({ error: 'Could not create invite' });
  }
});

// Create a single club invite: dedupe against pending invites and existing
// members, insert the row, send the email (fire-and-forget) and, for existing
// Arenas users, an in-app notification. Shared by the bulk-invite endpoint and
// the club signup wizard. Returns { status: 'sent'|'skipped'|'failed', ... }.
async function createClubInviteRecord({ clubId, inviterUser, email, role, req, userByEmail, clubName, inviterName }) {
  const cleanEmail = (email || '').trim().toLowerCase();
  const irole = ['member', 'coach', 'admin'].includes(role) ? role : 'member';
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return { status: 'failed', email: cleanEmail, reason: 'invalid_email' };
  }
  try {
    const { data: existing } = await supabaseAdmin
      .from('club_invites')
      .select('id')
      .eq('club_id', clubId)
      .eq('email', cleanEmail)
      .eq('status', 'pending')
      .maybeSingle();
    if (existing) return { status: 'skipped', email: cleanEmail, reason: 'already_pending' };

    const existingUser = userByEmail[cleanEmail] || null;
    if (existingUser) {
      const memberRole = await getClubRole(existingUser.id, clubId);
      if (memberRole) return { status: 'skipped', email: cleanEmail, reason: 'already_member' };
    }

    const token = generateInviteToken();
    const { error } = await supabaseAdmin
      .from('club_invites')
      .insert({
        club_id: clubId,
        invited_by: inviterUser.id,
        email: cleanEmail,
        role: irole,
        token,
        status: 'pending',
        expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString()
      });
    if (error) return { status: 'failed', email: cleanEmail, reason: 'db' };
    const joinUrl = `${publicBaseUrl(req)}/join/${token}`;

    // Everyone invited gets the email (fire-and-forget, never blocks the row).
    const invEmail = buildInviteEmail({ clubName, inviterName, joinUrl, role: irole });
    sendEmail({ to: cleanEmail, subject: invEmail.subject, html: invEmail.html, text: invEmail.text });

    if (existingUser) {
      // Existing Arenas users ALSO get an in-app notification.
      await createNotification({
        userId: existingUser.id,
        type: 'club',
        title: 'Club invite',
        body: `${inviterName} invited you to join ${clubName} on Arenas`,
        link: `/join/${token}`,
        actorId: inviterUser.id,
        entityId: clubId
      });
      return { status: 'sent', email: cleanEmail, joinUrl, existingUser: true };
    }
    return { status: 'sent', email: cleanEmail, joinUrl, existingUser: false };
  } catch (err) {
    return { status: 'failed', email: cleanEmail, reason: 'db' };
  }
}

// Create many invites at once (used by the club dashboard invite form).
app.post(BASE + '/api/clubs/:clubId/invites/bulk', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Server not configured' });
  const { clubId } = req.params;
  const role = await getClubRole(req.user.id, clubId);
  if (!isClubManagerRole(role && role.role)) return res.status(403).json({ error: 'Not authorized' });

  const incoming = Array.isArray(req.body && req.body.invites) ? req.body.invites : [];
  if (incoming.length === 0) return res.status(400).json({ error: 'No invites provided' });
  if (incoming.length > 200) return res.status(400).json({ error: 'Too many invites at once (max 200)' });

  // Resolve all existing Arenas users once (not per email) so we can notify
  // people who already have an account in-app instead of relying on the link.
  const userByEmail = {};
  (await listAllAuthUsers()).forEach(u => { if (u.email) userByEmail[u.email.toLowerCase()] = u; });
  // Inviter + club names for the in-app notifications (resolved once).
  const inviter = displayFromUser(req.user);
  let clubName = 'a club';
  try {
    const { data: club } = await supabaseAdmin.from('clubs').select('name').eq('id', clubId).single();
    if (club && club.name) clubName = club.name;
  } catch (err) { /* fall back to generic name */ }

  const results = { sent: [], skipped: [], failed: [] };
  for (const raw of incoming) {
    const r = await createClubInviteRecord({
      clubId,
      inviterUser: req.user,
      email: raw && raw.email,
      role: raw && raw.role,
      req,
      userByEmail,
      clubName,
      inviterName: inviter.name
    });
    if (r.status === 'sent') results.sent.push({ email: r.email, joinUrl: r.joinUrl, existingUser: r.existingUser });
    else if (r.status === 'skipped') results.skipped.push({ email: r.email, reason: r.reason });
    else results.failed.push({ email: r.email, reason: r.reason });
  }
  return res.json({ success: true, ...results });
});

// List a club's invites (managers only). Resolves inviter display names since
// there is no profiles table.
app.get(BASE + '/api/clubs/:clubId/invites', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ invites: [] });
  const { clubId } = req.params;
  const role = await getClubRole(req.user.id, clubId);
  if (!isClubManagerRole(role && role.role)) return res.status(403).json({ error: 'Not authorized' });
  try {
    const { data } = await supabaseAdmin
      .from('club_invites')
      .select('*')
      .eq('club_id', clubId)
      .order('created_at', { ascending: false });
    const invites = data || [];
    const nameMap = await buildUserDisplayMap(invites.map(i => i.invited_by));
    const now = Date.now();
    return res.json({
      invites: invites.map(i => ({
        id: i.id,
        email: i.email,
        role: i.role,
        status: i.status,
        created_at: i.created_at,
        expires_at: i.expires_at,
        accepted_at: i.accepted_at,
        isOpen: i.email === OPEN_INVITE_EMAIL,
        isExpired: i.expires_at ? new Date(i.expires_at).getTime() < now : false,
        invitedByName: (nameMap[i.invited_by] && nameMap[i.invited_by].name) || 'A coach'
      }))
    });
  } catch (err) {
    return res.json({ invites: [] });
  }
});

// Resend (extend) a pending invite. Authorized via the invite's own club.
app.post(BASE + '/api/clubs/invites/:inviteId/resend', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Server not configured' });
  try {
    const { data: invite } = await supabaseAdmin
      .from('club_invites')
      .select('*')
      .eq('id', req.params.inviteId)
      .maybeSingle();
    if (!invite) return res.status(404).json({ error: 'Invite not found' });
    const role = await getClubRole(req.user.id, invite.club_id);
    if (!isClubManagerRole(role && role.role)) return res.status(403).json({ error: 'Not authorized' });
    if (invite.status !== 'pending') return res.status(400).json({ error: 'Only pending invites can be resent' });

    const ttl = invite.email === OPEN_INVITE_EMAIL ? OPEN_INVITE_TTL_MS : INVITE_TTL_MS;
    const { data: updated, error } = await supabaseAdmin
      .from('club_invites')
      .update({ expires_at: new Date(Date.now() + ttl).toISOString() })
      .eq('id', invite.id)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: 'Could not resend invite' });
    const joinUrl = `${publicBaseUrl(req)}/join/${invite.token}`;

    // Actually re-send the invite email (the whole point of "resend"). Skip the
    // sentinel address used by open shareable links — those aren't tied to a real
    // inbox. Fire-and-forget so a failed send never fails the resend request.
    if (invite.email && invite.email !== OPEN_INVITE_EMAIL) {
      let clubName = 'a club';
      try {
        const { data: club } = await supabaseAdmin.from('clubs').select('name').eq('id', invite.club_id).single();
        if (club && club.name) clubName = club.name;
      } catch (err) { /* fall back to generic name */ }
      const resender = displayFromUser(req.user);
      const invEmail = buildInviteEmail({ clubName, inviterName: resender.name, joinUrl, role: invite.role });
      sendEmail({ to: invite.email, subject: invEmail.subject, html: invEmail.html, text: invEmail.text });
    }
    return res.json({ success: true, invite: updated, joinUrl });
  } catch (err) {
    return res.status(500).json({ error: 'Could not resend invite' });
  }
});

// Cancel/delete an invite. Authorized via the invite's own club.
app.delete(BASE + '/api/clubs/invites/:inviteId', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Server not configured' });
  try {
    const { data: invite } = await supabaseAdmin
      .from('club_invites')
      .select('club_id')
      .eq('id', req.params.inviteId)
      .maybeSingle();
    if (!invite) return res.status(404).json({ error: 'Invite not found' });
    const role = await getClubRole(req.user.id, invite.club_id);
    if (!isClubManagerRole(role && role.role)) return res.status(403).json({ error: 'Not authorized' });
    const { error } = await supabaseAdmin.from('club_invites').delete().eq('id', req.params.inviteId);
    if (error) return res.status(500).json({ error: 'Could not revoke invite' });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Could not revoke invite' });
  }
});

// List club members (managers only). Resolves names from auth metadata since
// there is no profiles table, and uses created_at as the join date.
app.get(BASE + '/api/clubs/:clubId/members', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ members: [] });
  const { clubId } = req.params;
  const role = await getClubRole(req.user.id, clubId);
  if (!isClubManagerRole(role && role.role)) return res.status(403).json({ error: 'Not authorized' });
  try {
    const { data } = await supabaseAdmin
      .from('memberships')
      .select('user_id, role, created_at')
      .eq('club_id', clubId)
      .order('created_at', { ascending: true });
    const rows = data || [];
    const nameMap = await buildUserDisplayMap(rows.map(m => m.user_id));
    return res.json({
      members: rows.map(m => ({
        user_id: m.user_id,
        role: m.role,
        joined_at: m.created_at,
        name: (nameMap[m.user_id] && nameMap[m.user_id].name) || 'Member',
        handle: (nameMap[m.user_id] && nameMap[m.user_id].handle) || 'member',
        avatar_url: (nameMap[m.user_id] && nameMap[m.user_id].avatar_url) || null,
        isSelf: m.user_id === req.user.id
      }))
    });
  } catch (err) {
    return res.json({ members: [] });
  }
});

// Change a member's role (admins only).
app.patch(BASE + '/api/clubs/:clubId/members/:userId/role', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Server not configured' });
  const { clubId, userId } = req.params;
  const newRole = req.body && req.body.role;
  if (!['member', 'coach', 'admin'].includes(newRole)) return res.status(400).json({ error: 'Invalid role' });
  const requester = await getClubRole(req.user.id, clubId);
  if (!requester || requester.role !== 'admin') return res.status(403).json({ error: 'Only admins can change roles' });
  try {
    const { error } = await supabaseAdmin
      .from('memberships')
      .update({ role: newRole })
      .eq('user_id', userId)
      .eq('club_id', clubId);
    if (error) return res.status(500).json({ error: 'Could not update role' });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Could not update role' });
  }
});

// Remove a member from a club (admins only; can't remove yourself).
app.delete(BASE + '/api/clubs/:clubId/members/:userId', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Server not configured' });
  const { clubId, userId } = req.params;
  const requester = await getClubRole(req.user.id, clubId);
  if (!requester || requester.role !== 'admin') return res.status(403).json({ error: 'Only admins can remove members' });
  if (userId === req.user.id) return res.status(400).json({ error: 'You cannot remove yourself from the club' });
  try {
    // Conditional delete that returns the deleted row: success requires an
    // actual membership row to have been removed, so "removing" someone who
    // isn't a member reports an honest 404 (race-free — no separate fetch).
    const { data: deleted, error } = await supabaseAdmin
      .from('memberships')
      .delete()
      .eq('user_id', userId)
      .eq('club_id', clubId)
      .select('user_id');
    if (error) return res.status(500).json({ error: 'Could not remove member' });
    if (!deleted || deleted.length === 0) return res.status(404).json({ error: 'Member not found' });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Could not remove member' });
  }
});

// Generate a shareable open join link (managers only).
app.post(BASE + '/api/clubs/:clubId/join-link', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Server not configured' });
  const { clubId } = req.params;
  const role = await getClubRole(req.user.id, clubId);
  if (!isClubManagerRole(role && role.role)) return res.status(403).json({ error: 'Not authorized' });
  try {
    const token = generateInviteToken();
    const { error } = await supabaseAdmin
      .from('club_invites')
      .insert({
        club_id: clubId,
        invited_by: req.user.id,
        email: OPEN_INVITE_EMAIL,
        role: 'member',
        token,
        status: 'pending',
        expires_at: new Date(Date.now() + OPEN_INVITE_TTL_MS).toISOString()
      });
    if (error) return res.status(500).json({ error: 'Could not generate link' });
    return res.json({ success: true, joinUrl: `${publicBaseUrl(req)}/join/${token}` });
  } catch (err) {
    return res.status(500).json({ error: 'Could not generate link' });
  }
});

// ── PUBLIC JOIN FLOW ──
// View the branded join page for an invite token. No auth required.
app.get(BASE + '/join/:token', async (req, res) => {
  const render = (state) => {
    try {
      const html = injectAvatarHelpers(injectNamedData(fs.readFileSync(path.join(HTML, 'arenas-club-join.html'), 'utf8'), 'JOIN_DATA', state));
      res.type('html').send(html);
    } catch (err) {
      res.status(500).send('Unable to load invite');
    }
  };
  try {
    if (!supabaseAdmin) return render({ status: 'error', baseUrl: publicBaseUrl(req) });
    const { data: invite } = await supabaseAdmin
      .from('club_invites')
      .select('*, clubs (id, name, handle, sport, city, logo_url)')
      .eq('token', req.params.token)
      .maybeSingle();
    if (!invite) return render({ status: 'invalid', baseUrl: publicBaseUrl(req) });

    const nameMap = await buildUserDisplayMap([invite.invited_by]);
    const invitedByName = (nameMap[invite.invited_by] && nameMap[invite.invited_by].name) || 'A coach';
    const isExpired = invite.expires_at ? new Date(invite.expires_at).getTime() < Date.now() : false;
    const isOpen = invite.email === OPEN_INVITE_EMAIL;

    // Offer one-click join if the visitor is already signed in.
    let viewer = null;
    const tok = req.signedCookies && req.signedCookies.sb_access_token;
    if (tok) {
      try {
        const { data } = await supabase.auth.getUser(tok);
        if (data && data.user) viewer = { name: displayFromUser(data.user).name, email: data.user.email };
      } catch (e) { /* treat as logged out */ }
    }

    let status = 'ok';
    if (invite.status === 'accepted') status = 'accepted';
    else if (invite.status !== 'pending') status = 'invalid';
    else if (isExpired) status = 'expired';

    return render({
      status,
      token: req.params.token,
      error: req.query.error || null,
      club: invite.clubs || { name: 'a club' },
      role: invite.role || 'member',
      invitedByName,
      email: isOpen ? '' : invite.email,
      lockEmail: !isOpen,
      isOpen,
      expiresAt: invite.expires_at,
      viewer,
      baseUrl: publicBaseUrl(req)
    });
  } catch (err) {
    console.log('Join page error:', err.message);
    return render({ status: 'error', baseUrl: publicBaseUrl(req) });
  }
});

// Accept an invite by creating a brand-new account, joining the club, and
// signing in. Form POST → redirects back to the join page on error.
app.post(BASE + '/auth/join/:token', async (req, res) => {
  const back = (err) => res.redirect(`${BASE}/join/${req.params.token}?error=${err}`);
  try {
    if (!supabaseAdmin) return back('unavailable');
    const { data: invite } = await supabaseAdmin
      .from('club_invites')
      .select('*, clubs (name)')
      .eq('token', req.params.token)
      .eq('status', 'pending')
      .maybeSingle();
    if (!invite) return back('invalid');
    if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) return back('expired');

    const isOpen = invite.email === OPEN_INVITE_EMAIL;
    const email = (isOpen ? (req.body.email || '') : invite.email).trim().toLowerCase();
    const password = req.body.password || '';
    const name = (req.body.name || '').trim() || (email ? email.split('@')[0] : 'Athlete');
    if (!email) return back('missing_email');
    if (!password || password.length < 6) return back('weak_password');

    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name }
    });
    if (authErr || !authData || !authData.user) return back('account_exists');
    const userId = authData.user.id;

    const { error: memErr } = await supabaseAdmin
      .from('memberships')
      .insert({ user_id: userId, club_id: invite.club_id, role: invite.role || 'member' });
    if (memErr) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return back('unknown');
    }

    // Personal invites are single-use (marked accepted). Open shareable links
    // stay pending so they can be reused until they expire. A failed marking
    // must fail the whole flow — otherwise the invite stays redeemable while
    // the account+membership already exist. Roll both back.
    if (!isOpen) {
      const { error: markErr } = await supabaseAdmin
        .from('club_invites')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('token', req.params.token);
      if (markErr) {
        console.log('Invite accept: status update failed:', markErr.message);
        // Compensation order matters: only delete the auth user AFTER the
        // membership rollback succeeds — deleting the user first (or anyway)
        // could orphan a membership row, the half-created state this rollback
        // exists to prevent. The user was created in this request, so the
        // (user_id, club_id) membership is necessarily the one we inserted.
        const { error: rbMemErr } = await supabaseAdmin.from('memberships').delete()
          .eq('user_id', userId).eq('club_id', invite.club_id);
        if (rbMemErr) {
          console.error('Invite accept rollback FAILED — user %s left with membership in club %s (invite %s still pending; manual remediation needed):', userId, invite.club_id, invite.id, rbMemErr.message);
          return back('unknown');
        }
        const { error: rbUserErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
        if (rbUserErr) console.error('Invite accept rollback: orphaned auth user %s (no memberships; manual remediation needed):', userId, rbUserErr.message);
        return back('unknown');
      }
    }

    try {
      const { data: admins } = await supabaseAdmin
        .from('memberships').select('user_id').eq('club_id', invite.club_id).eq('role', 'admin');
      const clubName = (invite.clubs && invite.clubs.name) || 'your club';
      await Promise.all((admins || []).map(a => createNotification({
        userId: a.user_id,
        type: 'club',
        title: 'New member joined',
        body: `${name} accepted your invite and joined ${clubName}`,
        link: '/clubs/dashboard?club=' + invite.club_id,
        actorId: userId,
        entityId: invite.club_id
      })));
    } catch (e) {
      console.log('Join notify error:', e.message);
    }

    const { data: signInData } = await supabase.auth.signInWithPassword({ email, password });
    if (signInData && signInData.session) setSession(res, signInData.session);
    return res.redirect(BASE + '/feed');
  } catch (err) {
    console.log('Join error:', err.message);
    return back('unknown');
  }
});

// Accept an invite as an already-signed-in user (one-click join).
app.post(BASE + '/auth/join/:token/existing', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Server not configured' });
  try {
    const { data: invite } = await supabaseAdmin
      .from('club_invites')
      .select('*, clubs (name)')
      .eq('token', req.params.token)
      .eq('status', 'pending')
      .maybeSingle();
    if (!invite) return res.status(404).json({ error: 'Invalid or expired invite' });
    if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'This invite has expired' });
    }

    // Personal invites are bound to a specific email; only that account may
    // redeem them. Open shareable links accept any signed-in user.
    const isOpen = invite.email === OPEN_INVITE_EMAIL;
    if (!isOpen && (req.user.email || '').toLowerCase() !== (invite.email || '').toLowerCase()) {
      return res.status(403).json({ error: 'This invite was sent to a different email address' });
    }

    const already = await getClubRole(req.user.id, invite.club_id);
    if (already) return res.json({ success: true, alreadyMember: true });

    const { error } = await supabaseAdmin
      .from('memberships')
      .insert({ user_id: req.user.id, club_id: invite.club_id, role: invite.role || 'member' });
    if (error) return res.status(500).json({ error: 'Could not join club' });

    // Single-use for personal invites; open links remain reusable until expiry.
    // A failed marking must fail the route — otherwise the caller is a member
    // while the invite stays redeemable. Roll the membership back.
    if (!isOpen) {
      const { error: markErr } = await supabaseAdmin
        .from('club_invites')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('token', req.params.token);
      if (markErr) {
        console.log('Invite join: status update failed:', markErr.message);
        const { error: rbErr } = await supabaseAdmin.from('memberships').delete()
          .eq('user_id', req.user.id).eq('club_id', invite.club_id);
        if (rbErr) console.log('Invite join rollback: membership delete failed:', rbErr.message);
        return res.status(500).json({ error: 'Could not join club' });
      }
    }

    // A pending directory join request for this club is now moot — the user
    // got in via a direct invite. Remove it so the club's request queue and
    // the requester's directory state stay honest. Non-fatal: a leftover row
    // self-heals (approve route treats already-member as resolve-only, and
    // re-request flips the same row).
    {
      const { error: jrErr } = await supabaseAdmin
        .from('club_join_requests')
        .delete()
        .eq('club_id', invite.club_id)
        .eq('user_id', req.user.id)
        .eq('status', 'pending');
      if (jrErr) console.log('Invite join: pending request cleanup failed:', jrErr.message);
    }

    try {
      const { data: admins } = await supabaseAdmin
        .from('memberships').select('user_id').eq('club_id', invite.club_id).eq('role', 'admin');
      const joiner = displayFromUser(req.user);
      const clubName = (invite.clubs && invite.clubs.name) || 'your club';
      await Promise.all((admins || []).map(a => createNotification({
        userId: a.user_id,
        type: 'club',
        title: 'New member joined',
        body: `${joiner.name} accepted your invite and joined ${clubName}`,
        link: '/clubs/dashboard?club=' + invite.club_id,
        actorId: req.user.id,
        entityId: invite.club_id
      })));
    } catch (e) {
      console.log('Join notify error:', e.message);
    }

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Could not join club' });
  }
});
app.get(BASE + '/landing', (req, res) => res.sendFile(path.join(HTML, 'arenas-landing-login.html')));
// ── NOTIFICATIONS API ──
// List the viewer's 50 most recent notifications with actor display info and an
// unread count. Mounted under BASE so the shared proxy routes here.
app.get(BASE + '/api/notifications', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ notifications: [], unreadCount: 0 });
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.json({ error: error.message });
  const notifications = await enrichNotifications(data);
  await attachInviteState(notifications, req.user.id);
  await attachChallengeInviteState(notifications, req.user.id);
  const unreadCount = notifications.filter(n => !n.read).length;
  res.json({ notifications, unreadCount });
});

// Club-invite notifications (link '/join/<token>') get a live inviteState so
// the panel can render an honest action: 'pending' → Join Club button,
// 'joined' (accepted OR already a member via any path) → muted ✓ Joined,
// 'expired' → dead label, 'gone' (invite revoked = row deleted) → plain row.
// Two batched lookups, only when invite notifications are present; any
// failure degrades to no inviteState (rows fall back to plain link behavior).
async function attachInviteState(notifications, userId) {
  try {
    const inviteNotifs = notifications.filter(n => typeof n.link === 'string' && /^\/join\/[A-Za-z0-9_-]+$/.test(n.link));
    if (!inviteNotifs.length) return;
    const tokens = [...new Set(inviteNotifs.map(n => n.link.slice('/join/'.length)))];
    const { data: invites, error: invErr } = await supabaseAdmin
      .from('club_invites')
      .select('token, status, expires_at, club_id')
      .in('token', tokens);
    // A failed lookup must degrade to "no state" (plain rows), never to 'gone'
    // — 'gone' is an honest claim that the invite row was deleted (revoked).
    if (invErr) return;
    const byToken = {};
    (invites || []).forEach(i => { byToken[i.token] = i; });
    const clubIds = [...new Set((invites || []).map(i => i.club_id).filter(Boolean))];
    const memberOf = new Set();
    if (clubIds.length) {
      const { data: mems } = await supabaseAdmin
        .from('memberships').select('club_id').eq('user_id', userId).in('club_id', clubIds);
      (mems || []).forEach(m => memberOf.add(m.club_id));
    }
    inviteNotifs.forEach(n => {
      const inv = byToken[n.link.slice('/join/'.length)];
      if (!inv) { n.inviteState = 'gone'; return; }
      if (memberOf.has(inv.club_id) || inv.status === 'accepted') { n.inviteState = 'joined'; return; }
      if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) { n.inviteState = 'expired'; return; }
      n.inviteState = 'pending';
    });
  } catch (err) {
    console.log('Invite-state enrich error:', err.message);
  }
}

// Challenge-invite notifications (type 'challenge_invite', entity_id = the
// challenge) get a live server-computed state so the panel renders an honest
// inline action, mirroring the club-invite pill exactly:
//   'pending' → brand-yellow Join pill (accepts via the existing join endpoint)
//   'joined'  → muted ✓ Joined      (participant via any path)
//   'ended'   → muted label          (challenge end date passed)
//   'revoked' → muted label          (invite record deleted by the creator)
//   'gone'    → muted label          (challenge itself deleted)
// A failed INVITE lookup attaches no pending/revoked verdict (plain row) —
// degradation must never claim 'revoked' when it can't prove the row is gone.
// THE pending rule — single source, shared by challenges AND events. Invite
// rows are RETAINED on accept, so:
// pending = invite row exists ∧ invitee has NOT accepted (challenge: is not a
// participant; event: has no non-cancelled RSVP).
// Every surface needing pending-ness must call this helper — never re-derive
// it inline ("identical" inline copies drift; computeStreaks was five copies).
// inviteRows: [{ <idField>, invitee_id, ... }]
// acceptedPairs: [{ <idField>, user_id }] — the accepted relation, pre-filtered
//   by the caller (e.g. cancelled RSVPs excluded: cancelling returns to pending)
// idField: 'challenge_id' (default — original call sites unchanged) or 'event_id'
// Returns the pending subset of inviteRows.
function pendingInvites(inviteRows, acceptedPairs, idField = 'challenge_id') {
  const partSet = new Set((acceptedPairs || []).map((p) => p[idField] + ':' + p.user_id));
  return (inviteRows || []).filter((r) => !partSet.has(r[idField] + ':' + r.invitee_id));
}

async function attachChallengeInviteState(notifications, userId) {
  try {
    const chNotifs = notifications.filter(n => n.type === 'challenge_invite' && n.entity_id);
    if (!chNotifs.length) return;
    const ids = [...new Set(chNotifs.map(n => n.entity_id))];
    const [chResult, partResult, invResult] = await Promise.all([
      supabaseAdmin.from('challenges').select('id, end_date').in('id', ids),
      supabaseAdmin.from('challenge_participants').select('challenge_id').in('challenge_id', ids).eq('user_id', userId),
      supabaseAdmin.from('challenge_invites').select('challenge_id').in('challenge_id', ids).eq('invitee_id', userId)
    ]);
    if (chResult.error || partResult.error) return;
    const chById = {};
    (chResult.data || []).forEach(c => { chById[c.id] = c; });
    const joined = new Set((partResult.data || []).map(p => p.challenge_id));
    const inviteLookupOk = !invResult.error;
    // Same shared rule as the challenges API: pending = row ∧ not participant.
    const pendingSet = new Set(pendingInvites(
      (invResult.data || []).map(r => ({ challenge_id: r.challenge_id, invitee_id: userId })),
      (partResult.data || []).map(p => ({ challenge_id: p.challenge_id, user_id: userId }))
    ).map(r => r.challenge_id));
    chNotifs.forEach(n => {
      if (joined.has(n.entity_id)) { n.challengeInviteState = 'joined'; return; }
      const ch = chById[n.entity_id];
      if (!ch) { n.challengeInviteState = 'gone'; return; }
      if (ch.end_date && new Date(ch.end_date).getTime() < Date.now()) { n.challengeInviteState = 'ended'; return; }
      if (!inviteLookupOk) return; // can't prove pending vs revoked — plain row
      n.challengeInviteState = pendingSet.has(n.entity_id) ? 'pending' : 'revoked';
    });
  } catch (err) {
    console.log('Challenge-invite state enrich error:', err.message);
  }
}

// Mark a single notification as read (scoped to the owner).
app.post(BASE + '/api/notifications/:id/read', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Service unavailable' });
  const { error } = await supabaseAdmin
    .from('notifications')
    .update({ read: true })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);
  if (error) return res.json({ error: error.message });
  res.json({ success: true });
});

// Mark all of the viewer's unread notifications as read.
app.post(BASE + '/api/notifications/read-all', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Service unavailable' });
  const { error } = await supabaseAdmin
    .from('notifications')
    .update({ read: true })
    .eq('user_id', req.user.id)
    .eq('read', false);
  if (error) return res.json({ error: error.message });
  res.json({ success: true });
});

// Dismiss (delete) a single notification (scoped to the owner).
// Zero-leak: fetch first — a nonexistent id and someone else's notification
// answer byte-identically, so the route is not an existence oracle.
app.delete(BASE + '/api/notifications/:id', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
  // Conditional delete that returns the deleted rows: the owner predicate is
  // enforced at the write boundary, and success is defined by an actual row
  // being deleted (no fetch/delete race, no phantom success).
  const { data: deleted, error } = await supabaseAdmin
    .from('notifications')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select('id');
  if (error) return res.status(500).json({ error: 'Could not dismiss the notification' });
  if (!deleted || deleted.length === 0) {
    return res.status(404).json({ error: 'Notification not found' });
  }
  res.json({ success: true });
});

// The standalone notifications page is retired — the bell now opens an in-place
// dropdown on every shell page (see injectNotificationsPanel). Redirect any old
// links/bookmarks to the feed. The /api/notifications* routes above remain (the
// dropdown depends on them).
app.get(BASE + '/notifications', (req, res) => res.redirect(BASE + '/feed'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on 0.0.0.0:${PORT}`);
});
