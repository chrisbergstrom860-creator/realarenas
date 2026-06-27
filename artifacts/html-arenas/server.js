require('dotenv').config();

console.log('Starting server...');
console.log('PORT env var:', process.env.PORT);
console.log('All env vars:', Object.keys(process.env).filter(k => !k.includes('KEY') && !k.includes('SECRET')));

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const { createClient } = require('@supabase/supabase-js');

const app = express();
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
    // Club admins/coaches land on the dashboard; everyone else on the feed.
    const dest = (await isClubManager(data.user && data.user.id)) ? '/clubs/dashboard' : '/feed';
    return res.redirect(BASE + dest);
  } catch (err) {
    return res.redirect(BASE + '/landing?error=invalid');
  }
});

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
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } }
    });
    console.log('Signup result - user:', data && data.user && data.user.id);
    console.log('Signup result - session:', !!(data && data.session));
    console.log('Signup result - error:', error && error.message);
    if (error || !data || !data.user) {
      console.log('Signup failed:', error && error.message);
      return res.redirect(BASE + '/landing?error=signup_failed');
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
  const { email, password, name, club_name, handle, sport, city } = req.body;
  try {
    if (!supabaseAdmin) {
      return res.redirect(BASE + '/for-clubs?error=server');
    }

    // Create the user with the admin client so the email is auto-confirmed and
    // no confirmation step is required.
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name }
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
      await supabaseAdmin.auth.admin.deleteUser(userId);
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
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return res.redirect(BASE + '/for-clubs?error=club');
    }

    // Link the user to the club as admin.
    const { error: memErr } = await supabaseAdmin
      .from('memberships')
      .insert({ user_id: userId, club_id: club.id, role: 'admin' });
    if (memErr) {
      // Compensating cleanup so we don't leave an orphaned club or account.
      await supabaseAdmin.from('clubs').delete().eq('id', club.id);
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return res.redirect(BASE + '/for-clubs?error=membership');
    }

    setSession(res, signInData.session);
    return res.redirect(BASE + '/clubs/dashboard');
  } catch (err) {
    return res.redirect(BASE + '/for-clubs?error=signup');
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

// Returns true if the user holds an admin/coach membership in any club, so we
// can route club managers to the dashboard instead of the athlete feed. Safe to
// call without the service role key (returns false rather than throwing).
async function isClubManager(userId) {
  if (!userId || !supabaseAdmin) return false;
  try {
    const { data, error } = await supabaseAdmin
      .from('memberships')
      .select('role')
      .eq('user_id', userId)
      .in('role', ['admin', 'coach'])
      .limit(1);
    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch (err) {
    return false;
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
    handle: meta.handle || emailLocal || 'athlete'
  };
}

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
    + bnItem(activeKey, 'events', "nav('/events')", '📅', 'Events', false)
    + bnItem(activeKey, 'log', "nav('/profile#activities')", '➕', 'Log', true)
    + bnItem(activeKey, 'ranks', "nav('/leaderboards')", '🏆', 'Ranks', false)
    + bnItem(activeKey, 'profile', "nav('/profile')", '👤', 'Profile', false)
    + '</nav>';
}
const ATHLETE_NAV_ACTIVE = { feed: 'feed', profile: 'profile', events: 'events', leaderboards: 'ranks', challenges: null, athletes: null, notifications: null };

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
    + clubBnItem(activeKey, 'events', 'events', '📅', 'Events')
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
    var icons = { running:'🏃', cycling:'🚴', climbing:'🧗', swimming:'🏊', football:'⚽', weightlifting:'🏋️', hiking:'🥾', yoga:'🧘', triathlon:'🔱' };
    var bgs = { running:'#FFF7ED', cycling:'#EFF6FF', climbing:'#F5F3FF', swimming:'#F0FDFA', football:'#ECFDF5', weightlifting:'#FEF9C3', hiking:'#FAEEDA', yoga:'#FBEAF0', triathlon:'#EFF6FF' };
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
      ic.style.cssText = 'width:26px;height:26px;border-radius:7px;background:' + (bgs[c.sport] || '#FFF7ED') + ';display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0';
      ic.textContent = icons[c.sport] || '🏟';
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
  let out = injectAvatarMenu(html);
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

// ── NOTIFICATIONS ──
// Insert a notification row for a recipient. Best-effort: failures are logged
// but never bubble up, so the triggering action (like/comment/follow) still
// succeeds. Uses the shared supabaseAdmin singleton.
async function createNotification({ userId, type, title, body, link, actorId, entityId }) {
  if (!supabaseAdmin || !userId) return;
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
  return list.map(n => ({ ...n, actor: actorMap[n.actor_id] || null }));
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
app.post(BASE + '/api/posts/create', requireAuth, async (req, res) => {
  const { content, sport, feeling } = req.body;
  if (!content || content.trim().length === 0) {
    return res.json({ error: 'Content is required' });
  }
  if (content.length > 280) {
    return res.json({ error: 'Post must be 280 characters or less' });
  }
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for posting' });
  const { data, error } = await supabaseAdmin
    .from('posts')
    .insert({
      user_id: req.user.id,
      content: content.trim(),
      sport: sport || null,
      feeling: feeling || null
    })
    .select()
    .single();
  if (error) return res.json({ error: error.message });
  res.json({ success: true, post: data });
});

app.get(BASE + '/api/posts', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for posting' });
  const limit = parseInt(req.query.limit) || 20;
  const { data: posts, error } = await supabaseAdmin
    .from('posts')
    .select('*, post_likes (count), post_comments (count)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return res.json({ error: error.message });
  // There is no `profiles` table in this project, so resolve author
  // display info from the Supabase auth user metadata instead of a join.
  const ids = [...new Set((posts || []).map(p => p.user_id).filter(Boolean))];
  const profileMap = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
      const user = u && u.user;
      if (user) {
        const meta = user.user_metadata || {};
        const emailLocal = user.email ? user.email.split('@')[0] : null;
        profileMap[id] = {
          name: meta.name || emailLocal || 'Athlete',
          handle: meta.handle || emailLocal || 'athlete'
        };
      }
    } catch (err) {
      // Ignore individual lookup failures; the card will fall back to defaults.
    }
  }));
  const enriched = (posts || []).map(p => ({ ...p, profiles: profileMap[p.user_id] || null }));
  res.json({ posts: enriched });
});

app.post(BASE + '/api/posts/:id/like', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for posting' });
  const { data: existing } = await supabaseAdmin
    .from('post_likes')
    .select('post_id')
    .eq('post_id', req.params.id)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (existing) {
    await supabaseAdmin.from('post_likes').delete()
      .eq('post_id', req.params.id)
      .eq('user_id', req.user.id);
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
  checkAchievements(req.user.id).catch(() => {});
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
  checkAchievements(req.user.id).catch(() => {});
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
// Generates a short, deterministic "AI coach" insight from the logged activity.
// Pure string logic (no external call) so it works offline and never blocks a
// save. Values it interpolates are user-supplied, so anything rendered from
// ai_insight on the client must still be HTML-escaped there.
function generateAIInsight(activity) {
  const insights = {
    running: [
      activity.run_type === 'Tempo' ?
        `Tempo work at ${activity.pace || 'your target pace'} builds lactate threshold — one of the highest ROI sessions you can do. ${activity.avg_hr ? 'HR of ' + activity.avg_hr + ' suggests ' + (parseInt(activity.avg_hr) > 165 ? 'you pushed hard today — make sure tomorrow is easy.' : 'good effort control.') : ''}` :
      activity.run_type === 'Interval / Track' ?
        `Interval sessions drive VO2 max improvements. ${activity.distance ? 'Covering ' + activity.distance + ' of quality work' : 'This session'} builds the top-end fitness that makes all your other runs feel easier.` :
      activity.run_type === 'Long run' ?
        `Long runs build aerobic base and fat adaptation. ${activity.distance ? activity.distance + ' is solid long run volume.' : ''} Keep the pace easy — the benefit comes from time on feet, not speed.` :
        `${activity.distance ? activity.distance + ' logged.' : 'Session logged.'} Consistency is the most important training variable — showing up regularly matters more than any single workout.`
    ],
    cycling: [
      activity.avg_power ?
        `${activity.avg_power} average power over ${activity.duration || 'this session'} — ${parseInt(activity.avg_power) > 200 ? 'solid output. Your aerobic engine is clearly developing.' : 'good Zone 2 work. This type of riding builds your aerobic base more than people realise.'}` :
        `${activity.distance ? activity.distance + ' covered.' : 'Ride logged.'} Every kilometre on the bike builds aerobic capacity and pedalling efficiency.`
    ],
    climbing: [
      activity.top_grade ?
        `Sending at ${activity.top_grade} shows your current capability. ${activity.project_grade ? 'Projecting ' + activity.project_grade + ' is the right approach — spending time at your limit drives the most adaptation.' : ''} ${activity.notes && activity.notes.includes('foot') ? 'Footwork issues you noted are very common at this grade — deliberate footwork drills in warm-up will pay off fast.' : ''}` :
        `${activity.problems_count ? activity.problems_count + ' problems completed.' : 'Session logged.'} Volume at the wall builds finger strength and movement pattern recognition simultaneously.`
    ],
    swimming: [
      activity.swim_pace ?
        `${activity.swim_pace} per 100m is ${activity.pool_type === 'Open water' ? 'strong for open water where conditions add difficulty.' : 'solid pool pace.'} ${activity.distance ? 'Covering ' + activity.distance + ' in one session builds excellent aerobic base.' : ''}` :
        `Swimming is one of the best cross-training activities for any athlete — low impact, high cardiovascular demand. Consistency here will transfer to all your other sports.`
    ],
    football: [
      `${activity.session_type === 'Match' ? 'Match day effort is high intensity and high reward — make sure the next 48 hours include recovery-focused activity.' : 'Training sessions build the technical and physical foundation that shows up on match day.'} ${activity.distance ? 'Covering ' + activity.distance + ' shows strong work rate.' : ''}`
    ],
    weightlifting: [
      `${activity.session_focus ? activity.session_focus + ' session logged.' : 'Strength session logged.'} ${activity.rpe ? 'RPE ' + activity.rpe + '/10 — ' + (parseInt(activity.rpe) >= 9 ? 'very high intensity. Prioritise sleep and protein today.' : parseInt(activity.rpe) <= 6 ? 'well within your capacity. Good for technique-focused work.' : 'solid working intensity.') : ''} ${activity.total_volume ? 'Total volume of ' + activity.total_volume + ' is trackable — progressive overload over weeks is what drives strength gains.' : ''}`
    ],
    hiking: [
      `${activity.distance ? activity.distance : 'This hike'} ${activity.elevation ? 'with ' + activity.elevation + ' of elevation gain' : ''} is excellent low-impact aerobic work. ${activity.pack_weight ? 'Carrying ' + activity.pack_weight + ' adds resistance training benefit on top of the cardiovascular load.' : ''} Hiking builds the aerobic base and mental resilience that transfers to all other sports.`
    ],
    yoga: [
      `${activity.yoga_style ? activity.yoga_style : 'Yoga'} builds the mobility, body awareness, and breathing control that directly improves performance in every other sport you do. ${activity.yoga_style === 'Yin' || activity.yoga_style === 'Restorative' ? 'Restorative practice like this accelerates recovery from harder training sessions.' : ''} Consistency here matters more than duration.`
    ]
  };
  const sportInsights = insights[activity.sport];
  if (!sportInsights) return 'Activity logged. Keep up the consistent training.';
  return (sportInsights[0] || 'Activity logged. Keep up the consistent training.').replace(/\s+/g, ' ').trim();
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
  const feedUserIds = [...new Set([...followingIds, currentUserId].filter(Boolean))];
  if (!feedUserIds.length) return [];
  const { data, error } = await supabaseAdmin
    .from('activities')
    .select('*')
    .in('user_id', feedUserIds)
    .order('date', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return enrichActivities(data);
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
      .select('event_id, user_id, status, created_at')
      .in('user_id', followingIds)
      .eq('status', 'going')
      .order('created_at', { ascending: false })
      .limit(10);
    if (!rsvpRows || !rsvpRows.length) return [];
    const eventIds = [...new Set(rsvpRows.map(r => r.event_id).filter(Boolean))];
    const eventMap = {};
    if (eventIds.length) {
      const { data: evs } = await supabaseAdmin
        .from('events').select('id, title, date, location, sport, event_type').in('id', eventIds);
      (evs || []).forEach(e => { eventMap[e.id] = e; });
    }
    const nameMap = await buildUserDisplayMap(rsvpRows.map(r => r.user_id));
    return rsvpRows
      .map(r => ({
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

// Create an activity for the logged-in user, generate an AI insight, and notify
// the user's followers (best-effort). The full activities schema must exist in
// Supabase (applied via the SQL editor) — until then inserts return an error.
app.post(BASE + '/api/activities/create', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for logging activities' });
  const b = req.body || {};
  if (!b.sport) return res.json({ error: 'Please select a sport' });
  if (!b.title || !b.title.trim()) return res.json({ error: 'Please enter an activity title' });
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
    instructor: b.instructor || null
  };
  activityData.ai_insight = generateAIInsight(activityData);
  const { data, error } = await supabaseAdmin
    .from('activities')
    .insert(activityData)
    .select()
    .single();
  if (error) return res.json({ error: error.message });
  // Notify followers (best-effort). The actor name comes from auth metadata
  // (no `profiles` table), not a DB join.
  try {
    const { data: followers } = await supabaseAdmin
      .from('follows')
      .select('follower_id')
      .eq('following_id', req.user.id);
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
  checkAchievements(req.user.id).catch(() => {});
  res.json({ success: true, activity: data });
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
  res.json({ activities: data || [] });
});

// Delete one of the viewer's own activities (the user_id filter enforces
// ownership even though service role bypasses RLS).
app.delete(BASE + '/api/activities/:id', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured' });
  const { error } = await supabaseAdmin
    .from('activities')
    .delete()
    .eq('id', req.params.id)
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
// Points per sport. Distance-based sports score per km; the rest score per
// session. The numeric `rate` is points awarded per unit.
const SPORT_POINTS = {
  running: { per: 'km', rate: 10 },
  cycling: { per: 'km', rate: 6 },
  climbing: { per: 'session', rate: 50 },
  swimming: { per: 'session', rate: 40 },
  football: { per: 'session', rate: 30 },
  hiking: { per: 'session', rate: 30 },
  weightlifting: { per: 'session', rate: 20 },
  yoga: { per: 'session', rate: 20 }
};

// `distance` is a free-form string (e.g. "12.4 km"); units are ignored app-wide,
// so we only extract the numeral — same pattern used elsewhere in this file.
function parseDistanceKm(distance) {
  const n = parseFloat(String(distance == null ? '0' : distance).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

// Unit-aware distance parser used ONLY for the profile "km logged" headline stat.
// Unlike parseDistanceKm (which ignores units app-wide), this converts to real km:
// "km" as-is, "mi"/miles ×1.609, bare "m"/metres ÷1000, no unit → assume km.
// Strips thousands separators first so "2,000m" parses as 2000 m → 2 km.
// KNOWN ISSUE (intentionally out of scope here): parseDistanceKm treats
// swim-in-metres as km, inflating distance ~1000× across leaderboards/weekly/
// scoring — needs a unit-aware fix app-wide in a future dedicated pass.
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

// Total leaderboard points for a set of activities.
function calculatePoints(activities) {
  let total = 0;
  (activities || []).forEach((a) => {
    const cfg = SPORT_POINTS[a.sport];
    if (!cfg) { total += 20; return; } // unknown sport: flat per-session credit
    if (cfg.per === 'km') {
      const dist = parseDistanceKm(a.distance);
      total += dist > 0 ? dist * cfg.rate : cfg.rate * 2; // logged-but-no-distance fallback
    } else {
      total += cfg.rate;
    }
  });
  return Math.round(total);
}

// ISO bounds for a leaderboard period. 'all' returns a null start (no lower
// bound) — callers must branch on it and skip the `.gte` filter.
function getDateRange(period) {
  const now = new Date();
  if (period === 'week') {
    const s = new Date(); s.setDate(now.getDate() - 7);
    return { start: s.toISOString(), end: now.toISOString() };
  }
  if (period === 'month') {
    const s = new Date(); s.setDate(now.getDate() - 30);
    return { start: s.toISOString(), end: now.toISOString() };
  }
  return { start: null, end: now.toISOString() };
}

// Fetch activities for a set of users within a period (one query — callers
// bucket by user_id; never query per-user). Sport is optional.
async function fetchActivitiesForUsers(userIds, period, sport) {
  if (!supabaseAdmin || !userIds.length) return [];
  const { start } = getDateRange(period);
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
          sports: Array.isArray(m.sports) ? m.sports : [],
          location: m.location || null
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
    const users = await listAllAuthUsers();
    const userIds = users.map((u) => u.id);
    const byUser = bucketActivities(await fetchActivitiesForUsers(userIds, period, sport));
    const leaderboard = users.map((u) => {
      const m = u.user_metadata || {};
      const disp = displayFromUser(u);
      const acts = byUser[u.id] || [];
      return {
        userId: u.id,
        name: disp.name,
        handle: disp.handle,
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
    const userIds = [...new Set([...(following || []).map((f) => f.following_id), req.user.id].filter(Boolean))];
    const byUser = bucketActivities(await fetchActivitiesForUsers(userIds, period, sport));
    const profileMap = await buildUserProfileMap(userIds);
    const leaderboard = userIds.map((id) => {
      const p = profileMap[id] || { name: 'Athlete', handle: 'athlete', sports: [], location: null };
      const acts = byUser[id] || [];
      return {
        userId: id, name: p.name, handle: p.handle, sports: p.sports, location: p.location,
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
    const memberIds = [...new Set((members || []).map((m) => m.user_id).filter(Boolean))];
    const byUser = bucketActivities(await fetchActivitiesForUsers(memberIds, period, sport));
    const profileMap = await buildUserProfileMap(memberIds);
    const leaderboard = memberIds.map((id) => {
      const p = profileMap[id] || { name: 'Member', handle: 'member', sports: [], location: null };
      const acts = byUser[id] || [];
      return {
        userId: id, name: p.name, handle: p.handle, sports: p.sports, location: p.location,
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
    const acts = await fetchActivitiesForUsers(memberIds, period, 'all');
    const byUser = bucketActivities(acts);
    const profileMap = await buildUserProfileMap(memberIds);

    // At-risk: no activity in the last 5 days, regardless of the selected period.
    const recent = period === 'week' ? acts : await fetchActivitiesForUsers(memberIds, 'week', 'all');
    const fiveDaysAgo = new Date(); fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const recentUserIds = new Set((recent || []).filter((a) => new Date(a.date) >= fiveDaysAgo).map((a) => a.user_id));
    const atRisk = memberIds
      .filter((id) => !recentUserIds.has(id) && id !== req.user.id) // exclude the viewing coach (matches the nudge recipient set)
      .map((id) => ({ userId: id, name: (profileMap[id] && profileMap[id].name) || 'Member', daysInactive: 5 }));

    const stats = memberIds.map((id) => {
      const a = byUser[id] || [];
      let totalKm = 0; a.forEach((x) => { totalKm += parseDistanceKm(x.distance); });
      return {
        userId: id,
        name: (profileMap[id] && profileMap[id].name) || 'Member',
        handle: (profileMap[id] && profileMap[id].handle) || 'member',
        totalKm,
        sessionCount: a.length
      };
    });
    const byDistance = [...stats].sort((a, b) => b.totalKm - a.totalKm);
    const bySessions = [...stats].sort((a, b) => b.sessionCount - a.sessionCount);
    const totalKm = Math.round(stats.reduce((s, u) => s + u.totalKm, 0));
    const totalSessions = stats.reduce((s, u) => s + u.sessionCount, 0);
    const activeCount = stats.filter((u) => u.sessionCount > 0).length;
    res.json({
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
    const { data: members } = await supabaseAdmin
      .from('memberships').select('user_id').eq('club_id', clubId);
    const memberIds = [...new Set((members || []).map((m) => m.user_id).filter(Boolean))];
    const recent = await fetchActivitiesForUsers(memberIds, 'week', 'all');
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

// Monday 00:00 of the week `weeksAgo` weeks before the current week (0 = this week).
function getWeekStart(weeksAgo) {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1 - weeksAgo * 7);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

// Weekly training-load breakdown for a coach's club dashboard. Load is derived
// from logged activity duration (there is no wearable/HR data). Names/handles/
// sports come from auth metadata (no `profiles` table). Admin/coach of the
// :clubId only.
app.get(BASE + '/api/clubs/:clubId/training-load', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured' });
  const clubId = req.params.clubId;
  const weeks = Math.min(Math.max(parseInt(req.query.weeks, 10) || 6, 1), 26);
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
      .from('memberships').select('user_id').eq('club_id', clubId);
    const memberIds = [...new Set((members || []).map((m) => m.user_id).filter(Boolean))];
    const profileMap = await buildUserProfileMap(memberIds);

    // Week boundaries, oldest first.
    const weekStarts = [];
    for (let i = weeks - 1; i >= 0; i--) weekStarts.push(getWeekStart(i));
    const periodStart = weekStarts[0];
    const thisWeekStart = weekStarts[weekStarts.length - 1];

    // Every activity in the window in one query (need `duration` for load).
    let activities = [];
    if (memberIds.length) {
      const { data, error } = await supabaseAdmin
        .from('activities')
        .select('user_id, sport, distance, duration, date')
        .in('user_id', memberIds)
        .gte('date', periodStart.toISOString());
      if (!error) activities = data || [];
    }
    const byUser = bucketActivities(activities);

    const memberData = memberIds.map((id) => {
      const acts = byUser[id] || [];
      const weeklyHours = weekStarts.map((weekStart) => {
        const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);
        const sum = acts
          .filter((a) => { const d = new Date(a.date); return d >= weekStart && d < weekEnd; })
          .reduce((s, a) => s + parseDurationHours(a.duration), 0);
        return Math.round(sum * 10) / 10;
      });
      const thisWeek = weeklyHours[weeklyHours.length - 1];
      const prevWeeks = weeklyHours.slice(Math.max(0, weeklyHours.length - 5), weeklyHours.length - 1);
      const avg = prevWeeks.length
        ? Math.round((prevWeeks.reduce((s, h) => s + h, 0) / prevWeeks.length) * 10) / 10
        : 0;
      const thisWeekActs = acts.filter((a) => new Date(a.date) >= thisWeekStart);
      const kmThisWeek = Math.round(thisWeekActs.reduce((s, a) => s + parseDistanceKm(a.distance), 0) * 10) / 10;
      const activeDays = new Set(thisWeekActs.map((a) => new Date(a.date).toDateString())).size;
      const restDays = Math.max(0, Math.min(7, (new Date().getDay() || 7)) - activeDays);

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
      const prof = profileMap[id] || {};
      return {
        userId: id,
        name: prof.name || 'Member',
        handle: prof.handle || 'member',
        sports: Array.isArray(prof.sports) ? prof.sports : [],
        weeklyHours, thisWeek, avg, trend, status,
        sessionsThisWeek: thisWeekActs.length,
        kmThisWeek, restDays
      };
    });

    const statusOrder = { overdoing: 0, behind: 1, ontrack: 2, inactive: 3 };
    memberData.sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || b.thisWeek - a.thisWeek);

    const clubWeekly = weekStarts.map((_, i) =>
      Math.round(memberData.reduce((s, m) => s + (m.weeklyHours[i] || 0), 0) * 10) / 10);
    const clubThisWeek = clubWeekly[clubWeekly.length - 1];
    const clubPrev = clubWeekly.slice(Math.max(0, clubWeekly.length - 5), clubWeekly.length - 1);
    const clubAvg = clubPrev.length
      ? Math.round((clubPrev.reduce((s, h) => s + h, 0) / clubPrev.length) * 10) / 10
      : 0;

    res.json({
      members: memberData,
      clubWeekly,
      weekLabels: weekStarts.map((d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })),
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

    // Latest logged activities (`date` is a full ISO timestamp set on insert).
    const { data: recentActivities } = await supabaseAdmin
      .from('activities')
      .select('user_id, sport, distance, duration, date')
      .in('user_id', safeIds)
      .order('date', { ascending: false })
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
        text: `logged a ${dist}${sportLabels[a.sport] || a.sport || 'session'}`,
        timestamp: a.date
      });
    });
    recentRsvps.forEach((r) => {
      feed.push({
        type: 'rsvp',
        name: nameOf(r.user_id),
        text: `RSVP'd going to ${eventTitleMap[r.event_id] || 'an event'}`,
        timestamp: r.created_at
      });
    });
    recentJoins.forEach((m) => {
      feed.push({
        type: 'join',
        name: nameOf(m.user_id),
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

    // 1. Posts from members (with like counts + whether the viewer liked each).
    // post_likes has no `id` column — it is keyed by (post_id, user_id).
    const { data: posts } = await supabaseAdmin
      .from('posts')
      .select('id, user_id, content, sport, created_at')
      .in('user_id', safeIds)
      .order('created_at', { ascending: false })
      .limit(20);
    const postIds = (posts || []).map((p) => p.id);
    let likes = [];
    if (postIds.length) {
      const { data: likeRows } = await supabaseAdmin
        .from('post_likes')
        .select('post_id, user_id')
        .in('post_id', postIds);
      likes = likeRows || [];
    }
    (posts || []).forEach((p) => {
      const postLikes = likes.filter((l) => l.post_id === p.id);
      const isCoach = roleMap[p.user_id] === 'admin' || roleMap[p.user_id] === 'coach';
      feed.push({
        type: isCoach ? 'announcement' : 'post',
        id: p.id,
        userId: p.user_id,
        name: prof(p.user_id).name || 'Member',
        handle: prof(p.user_id).handle || 'member',
        role: roleMap[p.user_id],
        content: p.content,
        sport: p.sport,
        likeCount: postLikes.length,
        likedByMe: postLikes.some((l) => l.user_id === req.user.id),
        timestamp: p.created_at
      });
    });

    // 2. Activities from members (ordered by `date` — no created_at column).
    const { data: activities } = await supabaseAdmin
      .from('activities')
      .select('id, user_id, sport, title, notes, distance, duration, pace, ai_insight, date')
      .in('user_id', safeIds)
      .order('date', { ascending: false })
      .limit(20);
    (activities || []).forEach((a) => {
      feed.push({
        type: 'activity',
        id: a.id,
        userId: a.user_id,
        name: prof(a.user_id).name || 'Member',
        handle: prof(a.user_id).handle || 'member',
        content: a.notes || a.title || '',
        sport: a.sport,
        distance: a.distance,
        duration: a.duration,
        pace: a.pace,
        aiInsight: a.ai_insight,
        timestamp: a.date
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
        const { data: acts } = await supabaseAdmin
          .from('activities')
          .select('sport, distance, date')
          .eq('user_id', participant.user_id)
          .gte('date', challenge.start_date)
          .lte('date', challenge.end_date)
          .order('date', { ascending: true });
        let progress = 0;
        let completedAt = null;
        for (const a of (acts || [])) {
          if (challenge.sport !== 'any' && a.sport !== challenge.sport) continue;
          if (challenge.goal_type === 'distance') {
            const dist = parseFloat(String(a.distance || '0').replace(/[^0-9.]/g, ''));
            if (!isNaN(dist)) progress += dist;
          } else if (challenge.goal_type === 'sessions' || challenge.goal_type === 'streak') {
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
            challengeTitle: challenge.title,
            goalTarget: challenge.goal_target,
            goalUnit: challenge.goal_unit,
            timestamp: completedAt
          });
        }
      }
    }

    feed.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json({ feed: feed.slice(0, 30), memberCount: (members || []).length });
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

    // Month param format: YYYY-MM, default current month.
    const monthParam = (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month))
      ? req.query.month : new Date().toISOString().slice(0, 7);
    const [year, month] = monthParam.split('-').map(Number);
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 1);
    const prevStart = new Date(year, month - 2, 1);
    const prevEnd = monthStart;

    // All members with their join dates (created_at — no profiles table / joined_at).
    const { data: members } = await supabaseAdmin
      .from('memberships')
      .select('user_id, created_at')
      .eq('club_id', clubId);
    const memberIds = (members || []).map(m => m.user_id);
    const safeIds = memberIds.length ? memberIds : ['00000000-0000-0000-0000-000000000000'];
    const joinedAt = (m) => m.created_at;

    // Membership metrics (a member with no join date is treated as pre-existing).
    const newJoins = (members || []).filter(m =>
      joinedAt(m) && new Date(joinedAt(m)) >= monthStart && new Date(joinedAt(m)) < monthEnd
    ).length;
    const prevJoins = (members || []).filter(m =>
      joinedAt(m) && new Date(joinedAt(m)) >= prevStart && new Date(joinedAt(m)) < prevEnd
    ).length;
    const membersAtMonthEnd = (members || []).filter(m =>
      !joinedAt(m) || new Date(joinedAt(m)) < monthEnd
    ).length;
    const membersAtPrevEnd = (members || []).filter(m =>
      !joinedAt(m) || new Date(joinedAt(m)) < monthStart
    ).length;

    // Member count trend — count at the end of each of the last 6 months.
    const memberTrend = [];
    for (let i = 5; i >= 0; i--) {
      const trendEnd = new Date(year, month - i, 1);
      memberTrend.push((members || []).filter(m =>
        !joinedAt(m) || new Date(joinedAt(m)) < trendEnd
      ).length);
    }

    // Activities this month and previous month.
    const { data: monthActivities } = await supabaseAdmin
      .from('activities')
      .select('user_id, sport, distance, duration, date')
      .in('user_id', safeIds)
      .gte('date', monthStart.toISOString())
      .lt('date', monthEnd.toISOString());
    const { data: prevActivities } = await supabaseAdmin
      .from('activities')
      .select('user_id, sport, distance, duration, date')
      .in('user_id', safeIds)
      .gte('date', prevStart.toISOString())
      .lt('date', prevEnd.toISOString());

    function summarizeActivities(acts) {
      const activeUsers = new Set((acts || []).map(a => a.user_id));
      let totalHours = 0, totalKm = 0;
      const sportCounts = {};
      const userStats = {};
      (acts || []).forEach(a => {
        totalHours += parseDurationHours(a.duration);
        const dist = parseFloat(String(a.distance || '0').replace(/[^0-9.]/g, ''));
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

    const thisMonth = summarizeActivities(monthActivities);
    const prevMonth = summarizeActivities(prevActivities);

    // Most popular sport / most active member this month.
    const topSport = Object.entries(thisMonth.sportCounts).sort((a, b) => b[1] - a[1])[0];
    const topMember = Object.entries(thisMonth.userStats).sort((a, b) => b[1].sessions - a[1].sessions)[0];
    // Name only needed for the top member — read from auth metadata.
    const profileMap = await buildUserProfileMap(topMember ? [topMember[0]] : []);

    // Training hours trend — total logged hours per month, last 6 months.
    const hoursTrend = [];
    for (let i = 5; i >= 0; i--) {
      const tStart = new Date(year, month - 1 - i, 1);
      const tEnd = new Date(year, month - i, 1);
      const { data: tActs } = await supabaseAdmin
        .from('activities')
        .select('duration')
        .in('user_id', safeIds)
        .gte('date', tStart.toISOString())
        .lt('date', tEnd.toISOString());
      hoursTrend.push(Math.round((tActs || []).reduce((s, a) => s + parseDurationHours(a.duration), 0) * 10) / 10);
    }

    // Events this month + previous month, with "going" RSVP counts.
    const { data: monthEvents } = await supabaseAdmin
      .from('events')
      .select('id, title, date')
      .eq('club_id', clubId)
      .gte('date', monthStart.toISOString())
      .lt('date', monthEnd.toISOString());
    const { data: prevEvents } = await supabaseAdmin
      .from('events')
      .select('id')
      .eq('club_id', clubId)
      .gte('date', prevStart.toISOString())
      .lt('date', prevEnd.toISOString());
    const eventIds = (monthEvents || []).map(e => e.id);
    const { data: eventRsvps } = await supabaseAdmin
      .from('event_rsvps')
      .select('event_id, status')
      .in('event_id', eventIds.length ? eventIds : ['00000000-0000-0000-0000-000000000000'])
      .eq('status', 'going');
    const eventAttendance = (monthEvents || []).map(e => {
      const going = (eventRsvps || []).filter(r => r.event_id === e.id).length;
      return {
        title: e.title,
        date: e.date,
        going,
        rate: membersAtMonthEnd > 0 ? Math.round((going / membersAtMonthEnd) * 100) : 0
      };
    }).sort((a, b) => b.going - a.going);
    const avgAttendees = eventAttendance.length > 0
      ? Math.round(eventAttendance.reduce((s, e) => s + e.going, 0) / eventAttendance.length) : 0;
    const avgAttendanceRate = eventAttendance.length > 0
      ? Math.round(eventAttendance.reduce((s, e) => s + e.rate, 0) / eventAttendance.length) : 0;

    // Challenges overlapping this month.
    const { data: monthChallenges } = await supabaseAdmin
      .from('challenges')
      .select('id, title, goal_type, goal_target, goal_unit, sport, start_date, end_date')
      .eq('club_id', clubId)
      .lt('start_date', monthEnd.toISOString())
      .gte('end_date', monthStart.toISOString());
    let challengeStats = { count: 0, participationRate: 0, completionRate: 0, highlights: [] };
    if ((monthChallenges || []).length > 0) {
      let totalParticipants = 0, totalCompleted = 0, totalPossible = 0;
      for (const ch of monthChallenges) {
        const { data: parts } = await supabaseAdmin
          .from('challenge_participants')
          .select('user_id')
          .eq('challenge_id', ch.id);
        const partCount = (parts || []).length;
        totalParticipants += partCount;
        totalPossible += membersAtMonthEnd;
        let completed = 0;
        for (const p of (parts || [])) {
          const { data: acts } = await supabaseAdmin
            .from('activities')
            .select('sport, distance, date')
            .eq('user_id', p.user_id)
            .gte('date', ch.start_date)
            .lte('date', ch.end_date);
          let progress = 0;
          (acts || []).forEach(a => {
            if (ch.sport !== 'any' && a.sport !== ch.sport) return;
            if (ch.goal_type === 'distance') {
              const dist = parseFloat(String(a.distance || '0').replace(/[^0-9.]/g, ''));
              if (!isNaN(dist)) progress += dist;
            } else {
              progress += 1;
            }
          });
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
      challengeStats.count = monthChallenges.length;
      challengeStats.participationRate = totalPossible > 0
        ? Math.round((totalParticipants / totalPossible) * 100) : 0;
      challengeStats.completionRate = totalParticipants > 0
        ? Math.round((totalCompleted / totalParticipants) * 100) : 0;
    }

    // Health headline — template based.
    const activePct = membersAtMonthEnd > 0
      ? Math.round((thisMonth.activeCount / membersAtMonthEnd) * 100) : 0;
    const prevActivePct = membersAtPrevEnd > 0
      ? Math.round((prevMonth.activeCount / membersAtPrevEnd) * 100) : 0;
    const monthName = monthStart.toLocaleDateString('en-GB', { month: 'long' });
    const growthPct = membersAtPrevEnd > 0
      ? Math.round(((membersAtMonthEnd - membersAtPrevEnd) / membersAtPrevEnd) * 100) : 0;
    let headline = '';
    let headlineTone = 'good';
    if (thisMonth.sessions === 0 && newJoins === 0) {
      headline = `${monthName} was quiet — no activities were logged. Time to rally the club with a challenge or event.`;
      headlineTone = 'warn';
    } else {
      const parts = [];
      if (newJoins > 0) parts.push(`Membership grew ${growthPct > 0 ? growthPct + '%' : 'by ' + newJoins} to ${membersAtMonthEnd} members`);
      if (activePct > 0) parts.push(`${activePct}% of members trained at least once${prevActivePct > 0 && activePct !== prevActivePct ? ` — ${activePct > prevActivePct ? 'up' : 'down'} from ${prevActivePct}% the month before` : ''}`);
      if (avgAttendanceRate > 0) parts.push(`event attendance averaged ${avgAttendanceRate}%`);
      if (challengeStats.participationRate > 0) parts.push(`challenge participation hit ${challengeStats.participationRate}%`);
      headline = parts.join('. ') + '.';
      headlineTone = (growthPct >= 0 && activePct >= prevActivePct) ? 'good' : 'neutral';
    }

    res.json({
      month: monthParam,
      monthLabel: monthStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
      headline: { text: headline, tone: headlineTone, title: `${monthName} at a glance` },
      membership: {
        total: membersAtMonthEnd,
        totalDelta: membersAtMonthEnd - membersAtPrevEnd,
        newJoins,
        newJoinsDelta: newJoins - prevJoins,
        departures: 0,
        retention: 100,
        trend: memberTrend
      },
      engagement: {
        activePct,
        activePctDelta: activePct - prevActivePct,
        totalHours: thisMonth.totalHours,
        hoursDelta: Math.round((thisMonth.totalHours - prevMonth.totalHours) * 10) / 10,
        sessions: thisMonth.sessions,
        sessionsDelta: thisMonth.sessions - prevMonth.sessions,
        sessionsPerActive: thisMonth.activeCount > 0
          ? Math.round((thisMonth.sessions / thisMonth.activeCount) * 10) / 10 : 0,
        totalKm: thisMonth.totalKm,
        topSport: topSport ? {
          name: topSport[0],
          count: topSport[1],
          pct: thisMonth.sessions > 0 ? Math.round((topSport[1] / thisMonth.sessions) * 100) : 0
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
        count: (monthEvents || []).length,
        countDelta: (monthEvents || []).length - (prevEvents || []).length,
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
// normal `posts` row (it renders with a Coach badge in the feed because the
// author's club role is admin/coach), and every other member is notified.
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
    .insert({ user_id: req.user.id, content })
    .select()
    .single();
  if (error) return res.json({ error: error.message });

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
        title: 'Coach announcement',
        body: `${actor.name}: ${content.slice(0, 120)}${content.length > 120 ? '…' : ''}`,
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
function computeChallengeProgress(challenge, activities) {
  const acts = activities || [];
  const matches = (a) => challenge.sport === 'any' || a.sport === challenge.sport;
  let progress = 0;
  if (challenge.goal_type === 'distance') {
    acts.forEach((a) => {
      if (!matches(a)) return;
      const dist = parseFloat((a.distance || '0').replace(/[^0-9.]/g, ''));
      if (!isNaN(dist)) progress += dist;
    });
  } else if (challenge.goal_type === 'sessions') {
    progress = acts.filter(matches).length;
  } else if (challenge.goal_type === 'streak') {
    const dates = [...new Set(acts.filter(matches).map((a) => new Date(a.date).toDateString()))];
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
  { id: 'regular', cat: 'community', icon: '📅', name: 'Regular', desc: 'RSVP going to 10 events', check: s => s.eventsAttended >= 10, progress: s => [s.eventsAttended, 10] },
  { id: 'popular', cat: 'community', icon: '🌟', name: 'Popular', desc: 'Reach 25 followers', check: s => s.followerCount >= 25, progress: s => [s.followerCount, 25] }
];

// Parse a distance string ("12.3 km") into a number of kilometres.
function badgeKm(a) {
  const d = parseFloat((a.distance || '0').replace(/[^0-9.]/g, ''));
  return isNaN(d) ? 0 : d;
}

// Gather every stat the badge checks need for one user, via the global
// service-role client. NOTE: the `activities` table has no `created_at` column,
// so all time-based logic reads the activity `date`.
async function gatherBadgeStats(userId) {
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
  const hasEarlyBird = activities.some(a => {
    const ds = String(a.date || '');
    if (ds.length <= 10 || !ds.includes('T')) return false;
    const dt = new Date(ds);
    return !isNaN(dt.getTime()) && dt.getHours() < 6;
  });
  // Longest streak of consecutive active days.
  const days = [...new Set(activities.map(a => new Date(a.date).toDateString()))]
    .map(d => new Date(d)).sort((a, b) => a - b);
  let longestStreak = 0, run = 0;
  for (let i = 0; i < days.length; i++) {
    if (i === 0) run = 1;
    else run = Math.round((days[i] - days[i - 1]) / 86400000) === 1 ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
  }
  // Social + community counts (head:true → count only, no rows transferred).
  const { count: followingCount } = await supabaseAdmin
    .from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', userId);
  const { count: followerCount } = await supabaseAdmin
    .from('follows').select('*', { count: 'exact', head: true }).eq('following_id', userId);
  const { count: kudosGiven } = await supabaseAdmin
    .from('post_likes').select('*', { count: 'exact', head: true }).eq('user_id', userId);
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
      const inRange = activities.filter(a => {
        const d = new Date(a.date);
        return d >= new Date(ch.start_date) && d <= new Date(ch.end_date);
      });
      if (computeChallengeProgress(ch, inRange) >= Number(ch.goal_target)) challengesCompleted++;
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
async function checkAchievements(userId) {
  if (!supabaseAdmin || !userId) return [];
  try {
    const stats = await gatherBadgeStats(userId);
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
    await checkAchievements(req.user.id);
    const stats = await gatherBadgeStats(req.user.id);
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
    const now = new Date();
    const thisMonthCount = earned.filter(e => {
      const d = new Date(e.earned_at);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
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
// rows are fetched separately via .in(); activities have no created_at column,
// so recent activities are ordered by their `date` timestamp.
app.get(BASE + '/api/profile/overview', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Server is not configured for overview' });
  try {
    const userId = req.user.id;
    const now = new Date();
    const day = now.getDay() || 7;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - day + 1);
    weekStart.setHours(0, 0, 0, 0);

    // This week's activities.
    const { data: weekActs } = await supabaseAdmin
      .from('activities')
      .select('sport, distance, duration, date')
      .eq('user_id', userId)
      .gte('date', weekStart.toISOString());
    const acts = weekActs || [];
    const weekKm = Math.round(acts.reduce((s, a) => s + parseDistanceKm(a.distance), 0) * 10) / 10;
    const weekHours = Math.round(acts.reduce((s, a) => s + parseDurationHours(a.duration), 0) * 10) / 10;
    const weekPoints = calculatePoints(acts);

    // Day strip — which weekdays (Mon=0) had activity this week.
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const activeDaySet = new Set(acts.map(a => (new Date(a.date).getDay() || 7) - 1));
    const todayIdx = day - 1;
    const dayStrip = dayLabels.map((label, i) => ({
      label,
      state: i === todayIdx && !activeDaySet.has(i) ? 'today'
        : activeDaySet.has(i) ? 'active'
        : i < todayIdx ? 'rest' : 'future'
    }));

    // Current streak — consecutive active days ending today or yesterday.
    const { data: allActs } = await supabaseAdmin
      .from('activities').select('date').eq('user_id', userId);
    const days = [...new Set((allActs || []).map(a => new Date(a.date).toDateString()))]
      .map(d => new Date(d)).sort((a, b) => a - b);
    let currentStreak = 0;
    if (days.length > 0) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const last = new Date(days[days.length - 1]); last.setHours(0, 0, 0, 0);
      if (Math.round((today - last) / 86400000) <= 1) {
        currentStreak = 1;
        for (let i = days.length - 1; i > 0; i--) {
          if (Math.round((days[i] - days[i - 1]) / 86400000) === 1) currentStreak++;
          else break;
        }
      }
    }

    // Recent activities (last 3) — ordered by `date` (no created_at column).
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
        const { data: chActs } = await supabaseAdmin
          .from('activities')
          .select('sport, distance, date')
          .eq('user_id', userId)
          .gte('date', ch.start_date)
          .lte('date', ch.end_date);
        const progress = computeChallengeProgress(ch, chActs || []);
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
          statusText = remaining <= 2 ? `${remaining} more day${remaining !== 1 ? 's' : ''} — don't break it!` : `${remaining} days to go`;
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
        .select('id, title, date, location')
        .in('id', eventIds);
      upcomingRsvps = (evRows || [])
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
    return res.json({ myChallenges: [], clubChallenges: [], publicChallenges: [], myJoinedIds: [] });
  }
  const userId = req.user.id;
  const PLACEHOLDER = '00000000-0000-0000-0000-000000000000';
  try {
    const { data: myParticipations } = await supabaseAdmin
      .from('challenge_participants').select('challenge_id').eq('user_id', userId);
    const myIds = [...new Set((myParticipations || []).map((p) => p.challenge_id).filter(Boolean))];

    const { data: memberships } = await supabaseAdmin
      .from('memberships').select('club_id').eq('user_id', userId);
    const clubIds = [...new Set((memberships || []).map((m) => m.club_id).filter(Boolean))];

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

    const { data: clubChallenges } = await supabaseAdmin
      .from('challenges').select('*')
      .in('club_id', clubIds.length ? clubIds : [PLACEHOLDER])
      .order('created_at', { ascending: false });

    // Discover = public, non-expired challenges the user neither created nor
    // joined. Skip the .not() filter entirely when there's nothing to exclude.
    const excludeFromDiscover = [...new Set([...myChallenges.map((c) => c.id), ...myIds])];
    let publicQuery = supabaseAdmin
      .from('challenges').select('*')
      .eq('visibility', 'public')
      .gt('end_date', new Date().toISOString());
    if (excludeFromDiscover.length) {
      publicQuery = publicQuery.not('id', 'in', `(${excludeFromDiscover.join(',')})`);
    }
    const { data: publicChallenges } = await publicQuery
      .order('created_at', { ascending: false }).limit(20);

    // De-duplicate the full set so we only look up each challenge once.
    const allChallenges = [];
    const seen = new Set();
    [myChallenges || [], clubChallenges || [], publicChallenges || []].forEach((list) => {
      list.forEach((c) => { if (!seen.has(c.id)) { seen.add(c.id); allChallenges.push(c); } });
    });
    const allIds = allChallenges.map((c) => c.id);

    const { data: allParticipants } = await supabaseAdmin
      .from('challenge_participants').select('challenge_id, user_id')
      .in('challenge_id', allIds.length ? allIds : [PLACEHOLDER]);

    // Progress for each challenge the user has joined.
    const progressMap = {};
    for (const challengeId of myIds) {
      const challenge = allChallenges.find((c) => c.id === challengeId);
      if (!challenge) continue;
      const { data: activities } = await supabaseAdmin
        .from('activities').select('distance, duration, sport, date')
        .eq('user_id', userId)
        .gte('date', challenge.start_date).lte('date', challenge.end_date);
      progressMap[challengeId] = computeChallengeProgress(challenge, activities);
    }

    // Creator display names (auth metadata) and club names (clubs table).
    const creatorMap = await buildUserDisplayMap(allChallenges.map((c) => c.created_by));
    const challengeClubIds = [...new Set(allChallenges.map((c) => c.club_id).filter(Boolean))];
    const clubNameMap = {};
    if (challengeClubIds.length) {
      const { data: clubs } = await supabaseAdmin.from('clubs').select('id, name').in('id', challengeClubIds);
      (clubs || []).forEach((c) => { clubNameMap[c.id] = c.name; });
    }

    const now = Date.now();
    const enrich = (list) => (list || []).map((c) => {
      const end = new Date(c.end_date).getTime();
      const goalTarget = parseFloat(c.goal_target) || 0;
      const progress = parseFloat(progressMap[c.id]) || 0;
      // Safe percentage — never divide by zero/null goal_target.
      const pct = goalTarget > 0 ? Math.min(100, Math.round((progress / goalTarget) * 100)) : 0;
      return {
        ...c,
        goal_target: goalTarget,
        participantCount: (allParticipants || []).filter((p) => p.challenge_id === c.id).length,
        isJoined: myIds.includes(c.id) || c.created_by === userId,
        progress,
        pct,
        daysLeft: Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24))),
        isExpired: end < now,
        // Only complete when there's a real positive target that's been reached.
        isComplete: goalTarget > 0 && progress >= goalTarget,
        isOwner: c.created_by === userId,
        creator: creatorMap[c.created_by] || null,
        clubName: c.club_id ? (clubNameMap[c.club_id] || null) : null
      };
    });

    res.json({
      myChallenges: enrich(myChallenges),
      clubChallenges: enrich(clubChallenges),
      publicChallenges: enrich(publicChallenges),
      myJoinedIds: myIds
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
  if (!title || !goal_type || !goal_target || !start_date || !end_date) {
    return res.json({ error: 'Missing required fields' });
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
  // Auto-join the creator (best-effort).
  await supabaseAdmin.from('challenge_participants').insert({ challenge_id: challenge.id, user_id: req.user.id });
  // Restrict invites to users the caller actually follows (the modal only offers
  // those) and cap the count, so the endpoint can't be used to spam arbitrary
  // user IDs with notifications.
  let validInvitees = [];
  if (Array.isArray(invitees) && invitees.length) {
    const { data: follows } = await supabaseAdmin
      .from('follows').select('following_id').eq('follower_id', req.user.id);
    const followingSet = new Set((follows || []).map((f) => f.following_id));
    validInvitees = [...new Set(invitees)].filter((id) => followingSet.has(id)).slice(0, 50);
  }
  // Invite selected followers. Actor name from auth metadata (no profiles table).
  const actor = displayFromUser(req.user);
  for (const inviteeId of validInvitees) {
    await createNotification({
      userId: inviteeId,
      type: 'challenge',
      title: 'Challenge invite',
      body: `${actor.name} invited you to join "${challenge.title}" — ${goal_target} ${goal_unit || ''} ${goal_type} challenge`.replace(/\s+/g, ' ').trim(),
      link: '/challenges',
      actorId: req.user.id,
      entityId: challenge.id
    });
  }
  res.json({ success: true, challenge });
});

// Join a challenge (adds the viewer as a participant).
app.post(BASE + '/api/challenges/:id/join', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for challenges' });
  const { error } = await supabaseAdmin
    .from('challenge_participants').insert({ challenge_id: req.params.id, user_id: req.user.id });
  if (error) return res.json({ error: error.message });
  // Award any newly earned challenge badges without blocking.
  checkAchievements(req.user.id).catch(() => {});
  res.json({ success: true });
});

// Leave a challenge. The user_id filter enforces self-only removal even though
// the service role bypasses RLS.
app.delete(BASE + '/api/challenges/:id/leave', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for challenges' });
  await supabaseAdmin.from('challenge_participants').delete()
    .eq('challenge_id', req.params.id).eq('user_id', req.user.id);
  res.json({ success: true });
});

// Leaderboard for a challenge: each participant's progress, ranked. Participant
// names come from auth metadata (no profiles join).
app.get(BASE + '/api/challenges/:id/leaderboard', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for challenges' });
  try {
    const { data: challenge } = await supabaseAdmin
      .from('challenges').select('*').eq('id', req.params.id).single();
    if (!challenge) return res.json({ error: 'Challenge not found' });
    const { data: participants } = await supabaseAdmin
      .from('challenge_participants').select('user_id').eq('challenge_id', req.params.id);
    const nameMap = await buildUserDisplayMap((participants || []).map((p) => p.user_id));
    const target = Number(challenge.goal_target) || 0;
    const leaderboard = [];
    for (const participant of (participants || [])) {
      const { data: activities } = await supabaseAdmin
        .from('activities').select('distance, duration, sport, date')
        .eq('user_id', participant.user_id)
        .gte('date', challenge.start_date).lte('date', challenge.end_date);
      const progress = computeChallengeProgress(challenge, activities);
      const disp = nameMap[participant.user_id] || {};
      leaderboard.push({
        userId: participant.user_id,
        name: disp.name || 'Athlete',
        handle: disp.handle || 'athlete',
        progress,
        percentage: target ? Math.min(100, Math.round((progress / target) * 100)) : 0
      });
    }
    leaderboard.sort((a, b) => b.progress - a.progress);
    leaderboard.forEach((entry, i) => { entry.rank = i + 1; });
    res.json({ leaderboard, challenge });
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
    content: `⚡ Club challenge: ${challenge.title} — ${challenge.goal_target} ${challenge.goal_unit || ''} ${challenge.goal_type} goal. ${daysLeft} days left to join! Find it in the Challenges tab.`.replace(/\s+/g, ' ').trim(),
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
  await supabaseAdmin.from('challenge_participants').insert({ challenge_id: newChallenge.id, user_id: req.user.id });
  res.json({ success: true, challenge: newChallenge });
});

// Cancel/delete a challenge and its participants (coach/admin only). The
// Challenges tab exposes this via each active card's "Cancel" button. There is
// no separate DELETE route in the original spec, but the client UI depends on
// it, so it's added here with the same admin/coach authorization.
app.delete(BASE + '/api/challenges/:id', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for challenges' });
  const challenge = await requireChallengeManager(req.params.id, req.user.id, 'id, club_id');
  if (!challenge) return res.json({ error: 'Challenge not found' });
  await supabaseAdmin.from('challenge_participants').delete().eq('challenge_id', req.params.id);
  const { error } = await supabaseAdmin.from('challenges').delete().eq('id', req.params.id);
  if (error) return res.json({ error: error.message });
  res.json({ success: true });
});

// Root: send new visitors to the landing page, logged-in users to their feed.
app.get(BASE === '' ? '/' : BASE, async (req, res) => {
  const token = req.signedCookies && req.signedCookies.sb_access_token;
  if (!token) return res.redirect(BASE + '/landing');
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data || !data.user) return res.redirect(BASE + '/landing');
    const dest = (await isClubManager(data.user.id)) ? '/clubs/dashboard' : '/feed';
    return res.redirect(BASE + dest);
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

  const { data: posts, error } = await supabaseAdmin
    .from('posts')
    .select('id, content, sport, feeling, created_at, user_id, post_likes (count), post_comments (count)')
    .in('user_id', feedUserIds)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !posts) return { posts: [], followsNobody };
  const ids = [...new Set(posts.map(p => p.user_id).filter(Boolean))];
  const profileMap = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
      const user = u && u.user;
      if (user) {
        const meta = user.user_metadata || {};
        const emailLocal = user.email ? user.email.split('@')[0] : null;
        profileMap[id] = {
          name: meta.name || emailLocal || 'Athlete',
          handle: meta.handle || emailLocal || 'athlete'
        };
      }
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
  const enriched = posts.map(p => ({
    id: p.id,
    content: p.content,
    sport: p.sport,
    feeling: p.feeling,
    created_at: p.created_at,
    user_id: p.user_id,
    authorName: (profileMap[p.user_id] && profileMap[p.user_id].name) || 'Athlete',
    authorHandle: (profileMap[p.user_id] && profileMap[p.user_id].handle) || 'athlete',
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
      .select('role, clubs:club_id (id, name, handle, sport)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    return (data || []).map(m => {
      const c = Array.isArray(m.clubs) ? m.clubs[0] : m.clubs;
      return c ? Object.assign({}, c, { role: m.role }) : null;
    }).filter(Boolean);
  } catch (e) {
    return [];
  }
}

// Right-rail sidebar data for the feed page: this-week distance + day strip,
// current streak, this-week club rank, and follow suggestions. Every value is
// real (no fabricated content); the widgets fall back to honest empty/low-data
// states client-side when these are zero/empty.
async function buildFeedSidebar(userId) {
  const sidebar = { week: { activities: 0, km: 0 }, dayStrip: [], currentStreak: 0, clubRank: null, followSuggestions: [] };
  if (!supabaseAdmin || !userId) return sidebar;
  try {
    // Week bounds — local Monday 00:00 (matches /api/profile/overview).
    const now = new Date();
    const day = now.getDay() || 7;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - day + 1);
    weekStart.setHours(0, 0, 0, 0);
    const todayIdx = day - 1;

    // One query for the user's own activities → weekly km, day strip, streak.
    const { data: allActs } = await supabaseAdmin
      .from('activities')
      .select('sport, distance, date')
      .eq('user_id', userId);
    const acts = allActs || [];
    const weekActs = acts.filter(a => new Date(a.date) >= weekStart);
    const weekKm = Math.round(weekActs.reduce((s, a) => s + parseDistanceKm(a.distance), 0) * 10) / 10;
    sidebar.week = { activities: weekActs.length, km: weekKm };

    // Day strip — which weekdays (Mon=0) had activity this week.
    const activeDaySet = new Set(weekActs.map(a => (new Date(a.date).getDay() || 7) - 1));
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

    // Current streak — consecutive active days ending today or yesterday.
    const days = [...new Set(acts.map(a => new Date(a.date).toDateString()))]
      .map(d => new Date(d)).sort((a, b) => a - b);
    let currentStreak = 0;
    if (days.length > 0) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const last = new Date(days[days.length - 1]); last.setHours(0, 0, 0, 0);
      if (Math.round((today - last) / 86400000) <= 1) {
        currentStreak = 1;
        for (let i = days.length - 1; i > 0; i--) {
          if (Math.round((days[i] - days[i - 1]) / 86400000) === 1) currentStreak++;
          else break;
        }
      }
    }
    sidebar.currentStreak = currentStreak;

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
      const memberIds = [...new Set((members || []).map(m => m.user_id).filter(Boolean))];
      if (memberIds.length) {
        // Rank by points earned since the same local-Monday weekStart used for the
        // viewer's "this week" km — NOT the rolling-7-day leaderboard window, so the
        // rank and the distance above it always describe the same period.
        const { data: memberActs } = await supabaseAdmin
          .from('activities')
          .select('user_id, sport, distance, date')
          .in('user_id', memberIds)
          .gte('date', weekStart.toISOString());
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
      return { id: u.id, name: disp.name, initials, meta: metaBits.join(' · ') };
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
    const sidebar = await buildFeedSidebar(req.user.id);
    const userData = { profile: displayFromUser(req.user), userId: req.user.id, posts, followsNobody, feedActivities, followingRsvps, clubs: userClubs, week: sidebar.week, dayStrip: sidebar.dayStrip, currentStreak: sidebar.currentStreak, clubRank: sidebar.clubRank, followSuggestions: sidebar.followSuggestions };
    const html = injectBottomNav(injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-feed.html'), 'utf8'), userData), 'feed');
    res.type('html').send(html);
  } catch (err) {
    console.log('Feed data error:', err.message);
    res.type('html').send(injectBottomNav(fs.readFileSync(path.join(HTML, 'arenas-feed.html'), 'utf8'), 'feed'));
  }
});
// Athletes directory. Lists real signed-up users (resolved from auth metadata,
// since this project has no usable `profiles` table) with follower/post counts
// and the viewer's follow status, so the page shows the live community instead
// of the hardcoded demo athletes.
app.get(BASE + '/athletes', requirePageAuth, async (req, res) => {
  let athleteData = {
    athletes: [],
    myProfile: displayFromUser(req.user),
    userId: req.user.id,
    followingIds: [],
    clubs: []
  };
  try {
    if (supabaseAdmin) {
      // Pull all users via the admin API and drop the viewer themselves.
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 100 });
      const others = ((list && list.users) || [])
        .filter(u => u.id !== req.user.id)
        .slice(0, 50);
      const athleteIds = others.map(u => u.id);

      // Who the viewer already follows.
      const { data: following } = await supabaseAdmin
        .from('follows')
        .select('following_id')
        .eq('follower_id', req.user.id);
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
          bio: meta.bio || null,
          location: meta.location || null,
          sports: Array.isArray(meta.sports) ? meta.sports : [],
          level: meta.level || null,
          initials,
          postCount: postRows.filter(p => p.user_id === u.id).length,
          followerCount: followerRows.filter(f => f.following_id === u.id).length,
          isFollowing: followingIds.includes(u.id)
        };
      });

      athleteData = {
        athletes,
        myProfile: displayFromUser(req.user),
        userId: req.user.id,
        followingIds,
        clubs: await getSidebarClubs(req.user.id)
      };
    }
  } catch (err) {
    console.log('Athletes data error:', err.message);
  }
  try {
    const html = injectBottomNav(injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-athletes.html'), 'utf8'), athleteData), 'athletes');
    res.type('html').send(html);
  } catch (err) {
    console.log('Athletes render error:', err.message);
    res.type('html').send(injectBottomNav(fs.readFileSync(path.join(HTML, 'arenas-athletes.html'), 'utf8'), 'athletes'));
  }
});
// ── EVENTS API ──
// Mounted under BASE so the shared proxy routes them here (the separate
// api-server owns the bare "/api"). Display names come from auth metadata (no
// `profiles` table); related rows are joined in JS, not via PostgREST embeds.
app.get(BASE + '/api/events', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ upcomingEvents: [], clubEvents: [], myCreatedEvents: [], myRsvps: [] });
  try {
    const userId = req.user.id;
    const nowIso = new Date().toISOString();
    const { data: memberships } = await supabaseAdmin
      .from('memberships').select('club_id').eq('user_id', userId);
    const clubIds = (memberships || []).map(m => m.club_id).filter(Boolean);
    const { data: following } = await supabaseAdmin
      .from('follows').select('following_id').eq('follower_id', userId);
    const followingIds = (following || []).map(f => f.following_id).filter(Boolean);

    const [upcomingRes, clubRes, createdRes] = await Promise.all([
      supabaseAdmin.from('events').select('*').eq('visibility', 'public')
        .gte('date', nowIso).order('date', { ascending: true }).limit(50),
      clubIds.length
        ? supabaseAdmin.from('events').select('*').in('club_id', clubIds)
            .gte('date', nowIso).order('date', { ascending: true })
        : Promise.resolve({ data: [] }),
      supabaseAdmin.from('events').select('*').eq('created_by', userId)
        .order('date', { ascending: true })
    ]);
    const upcomingEvents = upcomingRes.data || [];
    const clubEvents = clubRes.data || [];
    const myCreatedEvents = createdRes.data || [];

    const allEvents = [...upcomingEvents, ...clubEvents, ...myCreatedEvents];
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
      const { data: evs } = await supabaseAdmin
        .from('events').select('id, title, date, location, sport').in('id', myRsvpEventIds);
      (evs || []).forEach(e => { myRsvpEventMap[e.id] = e; });
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
      return {
        ...event,
        creatorName: creator.name || 'Athlete',
        creatorHandle: creator.handle || 'athlete',
        clubs: (event.club_id && clubMap[event.club_id]) ? { name: clubMap[event.club_id].name } : null,
        goingCount,
        interestedCount,
        myRsvpStatus: myRsvp ? myRsvp.status : null,
        followersGoing,
        isOwner: event.created_by === userId
      };
    }

    res.json({
      upcomingEvents: upcomingEvents.map(enrichEvent),
      clubEvents: clubEvents.map(enrichEvent),
      myCreatedEvents: myCreatedEvents.map(enrichEvent),
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
      visibility: visibility || 'public'
    }).select().single();
  if (error) return res.json({ error: error.message });
  // Auto-RSVP the creator as going (best-effort).
  await supabaseAdmin.from('event_rsvps').insert({ event_id: event.id, user_id: req.user.id, status: 'going' });

  const actor = displayFromUser(req.user);
  const dateLabel = eventDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  // Restrict invites to followers (the modal only offers those) and cap the
  // count, so the endpoint can't spam arbitrary user IDs with notifications.
  let validInvitees = [];
  if (Array.isArray(invitees) && invitees.length) {
    const { data: follows } = await supabaseAdmin
      .from('follows').select('following_id').eq('follower_id', req.user.id);
    const followingSet = new Set((follows || []).map(f => f.following_id));
    validInvitees = [...new Set(invitees)].filter(id => followingSet.has(id)).slice(0, 50);
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
  const { data: existing } = await supabaseAdmin
    .from('event_rsvps').select('event_id, status')
    .eq('event_id', req.params.id).eq('user_id', req.user.id).maybeSingle();
  const wasGoing = !!(existing && existing.status === 'going');
  if (existing) {
    if (status === 'cancelled') {
      await supabaseAdmin.from('event_rsvps').delete()
        .eq('event_id', req.params.id).eq('user_id', req.user.id);
    } else {
      await supabaseAdmin.from('event_rsvps').update({ status })
        .eq('event_id', req.params.id).eq('user_id', req.user.id);
    }
  } else if (status !== 'cancelled') {
    await supabaseAdmin.from('event_rsvps')
      .insert({ event_id: req.params.id, user_id: req.user.id, status });
  }
  // Only fan out notifications on the transition *into* going, so repeatedly
  // clicking "Going" can't spam the organiser or the viewer's followers.
  if (status === 'going' && !wasGoing) {
    try {
      const { data: event } = await supabaseAdmin
        .from('events').select('created_by, title').eq('id', req.params.id).maybeSingle();
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
      for (const f of (followers || [])) {
        await createNotification({
          userId: f.follower_id, type: 'event', title: 'Friend going to an event',
          body: `${actor.name} is going to "${event ? event.title : 'an event'}" — are you in?`,
          link: '/events', actorId: req.user.id, entityId: req.params.id
        });
      }
    } catch (err) {
      console.log('RSVP notification error:', err.message);
    }
  }
  // Award community badges (e.g. "Regular") on a going RSVP, without blocking.
  if (status === 'going') checkAchievements(req.user.id).catch(() => {});
  res.json({ success: true, status });
});

// Delete one of the viewer's own events (the created_by filter enforces
// ownership even though the service role bypasses RLS).
app.delete(BASE + '/api/events/:id', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for events' });
  // Allow the event creator OR a club admin/coach to delete. Without this, the
  // dashboard "Cancel" button (shown to coaches) would delete 0 rows yet still
  // report success, so the event reappears on reload.
  const { data: event } = await supabaseAdmin
    .from('events').select('id, created_by, club_id').eq('id', req.params.id).maybeSingle();
  if (!event) return res.json({ error: 'Event not found' });
  let allowed = event.created_by === req.user.id;
  if (!allowed && event.club_id) {
    const { data: mgr } = await supabaseAdmin
      .from('memberships').select('role')
      .eq('club_id', event.club_id).eq('user_id', req.user.id)
      .in('role', ['admin', 'coach']).maybeSingle();
    allowed = !!mgr;
  }
  if (!allowed) return res.json({ error: 'You do not have permission to cancel this event' });
  const { error } = await supabaseAdmin.from('events').delete().eq('id', req.params.id);
  if (error) return res.json({ error: error.message });
  res.json({ success: true });
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
    content: `📅 Club event: ${event.title} — ${eventDate} at ${event.location}. Come join us! RSVP on the Events page.`,
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
      handle: (nameMap[r.user_id] || {}).handle || 'member'
    }));
  res.json({ event, rsvps });
});

// Update an event (creator OR club admin/coach). A created_by-only filter would
// silently update 0 rows for a managing coach yet still report success.
app.patch(BASE + '/api/events/:id', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for events' });
  const { data: event } = await supabaseAdmin
    .from('events').select('id, created_by, club_id').eq('id', req.params.id).maybeSingle();
  if (!event) return res.json({ error: 'Event not found' });
  let allowed = event.created_by === req.user.id;
  if (!allowed && event.club_id) {
    const { data: mgr } = await supabaseAdmin
      .from('memberships').select('role')
      .eq('club_id', event.club_id).eq('user_id', req.user.id)
      .in('role', ['admin', 'coach']).maybeSingle();
    allowed = !!mgr;
  }
  if (!allowed) return res.json({ error: 'You do not have permission to edit this event' });

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
  res.json({ success: true });
});

// Events page: inject the viewer's identity, the people they follow, and their
// clubs so the create modal and rendering can use real data. There is no
// `profiles` table, so names come from auth metadata.
app.get(BASE + '/events', requirePageAuth, async (req, res) => {
  try {
    if (!supabaseAdmin) return res.type('html').send(injectBottomNav(fs.readFileSync(path.join(HTML, 'arenas-events.html'), 'utf8'), 'events'));
    const userId = req.user.id;
    const { data: follows } = await supabaseAdmin
      .from('follows').select('following_id').eq('follower_id', userId);
    const followingIds = [...new Set((follows || []).map(f => f.following_id).filter(Boolean))];
    const nameMap = await buildUserDisplayMap(followingIds);
    const followingList = followingIds.map(id => ({
      id,
      name: (nameMap[id] || {}).name || 'Athlete',
      handle: (nameMap[id] || {}).handle || 'athlete'
    }));
    const clubs = await getSidebarClubs(userId);
    const eventData = { userId, profile: displayFromUser(req.user), following: followingList, clubs };
    const html = injectBottomNav(injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-events.html'), 'utf8'), eventData), 'events');
    res.type('html').send(html);
  } catch (err) {
    console.log('Events page error:', err.message);
    res.type('html').send(injectBottomNav(fs.readFileSync(path.join(HTML, 'arenas-events.html'), 'utf8'), 'events'));
  }
});
// Leaderboards page. Injects the viewer's identity + club name so the client can
// highlight "you" and label the club scope. There is no `profiles` table, so the
// name comes from auth metadata.
app.get(BASE + '/leaderboards', requirePageAuth, async (req, res) => {
  const servePlain = () => res.type('html').send(injectBottomNav(fs.readFileSync(path.join(HTML, 'arenas-leaderboards.html'), 'utf8'), 'leaderboards'));
  try {
    if (!supabaseAdmin) return servePlain();
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
    const lbData = { userId: req.user.id, profile: displayFromUser(req.user), clubName, clubs };
    const html = injectBottomNav(injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-leaderboards.html'), 'utf8'), lbData), 'leaderboards');
    res.type('html').send(html);
  } catch (err) {
    console.log('Leaderboards page error:', err.message);
    servePlain();
  }
});
app.get(BASE + '/challenges', requirePageAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    let following = [];
    if (supabaseAdmin) {
      const { data: follows } = await supabaseAdmin
        .from('follows').select('following_id').eq('follower_id', userId);
      const ids = [...new Set((follows || []).map((f) => f.following_id).filter(Boolean))];
      const map = await buildUserDisplayMap(ids);
      following = ids.map((id) => ({
        id,
        name: (map[id] && map[id].name) || 'Athlete',
        handle: (map[id] && map[id].handle) || 'athlete'
      }));
    }
    const clubs = await getSidebarClubs(userId);
    const challengeData = { userId, profile: displayFromUser(req.user), following, clubs };
    const html = injectBottomNav(injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-challenges.html'), 'utf8'), challengeData), 'challenges');
    res.send(html);
  } catch (err) {
    console.log('Challenges page error:', err.message);
    res.type('html').send(injectBottomNav(fs.readFileSync(path.join(HTML, 'arenas-challenges.html'), 'utf8'), 'challenges'));
  }
});
// My profile requires authentication. Inject the user's real identity, post/
// follower/following counts, recent posts, and club membership so the page shows
// live data instead of the hardcoded "Jamie King" placeholders. There is no
// `profiles` table, so name/handle/bio/location come from auth user metadata.
app.get(BASE + '/profile', requirePageAuth, async (req, res) => {
  const servePlain = () => res.type('html').send(injectBottomNav(fs.readFileSync(path.join(HTML, 'arenas-my-profile.html'), 'utf8'), 'profile'));
  try {
    if (!supabaseAdmin) return servePlain();
    const meta = req.user.user_metadata || {};
    const display = displayFromUser(req.user);

    const [postCountRes, followerRes, followingRes, postsRes, membershipRes, clubsRes, followingListRes, followerListRes, activitiesRes, activityCountRes] = await Promise.all([
      supabaseAdmin.from('posts').select('*', { count: 'exact', head: true }).eq('user_id', req.user.id),
      supabaseAdmin.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', req.user.id),
      supabaseAdmin.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', req.user.id),
      supabaseAdmin.from('posts').select('id, content, sport, feeling, created_at').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(10),
      supabaseAdmin.from('memberships').select('role, clubs (name, handle)').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      // All clubs the viewer belongs to (My Clubs tab). No `status` column on
      // memberships — every row is treated as an active membership.
      supabaseAdmin.from('memberships').select('role, clubs:club_id (id, name, handle, sport, city)').eq('user_id', req.user.id).order('created_at', { ascending: false }),
      // Raw follow edges (no `created_at` ordering — not guaranteed on this table).
      supabaseAdmin.from('follows').select('following_id').eq('follower_id', req.user.id),
      supabaseAdmin.from('follows').select('follower_id').eq('following_id', req.user.id),
      // Lifetime distance source. The `activities` table is user-provisioned and may
      // not exist yet — supabase-js returns { data: null } rather than throwing, so a
      // missing table degrades kmLogged to 0 instead of breaking the whole page.
      supabaseAdmin.from('activities').select('distance').eq('user_id', req.user.id),
      // Real count of the user's activities for the "Activities" hero stat + tab
      // badge. Counted from the activities table (NOT posts) so it matches the
      // Activities list and the Stats & PRs tab. Missing table → count null → 0.
      supabaseAdmin.from('activities').select('*', { count: 'exact', head: true }).eq('user_id', req.user.id)
    ]);

    const membership = membershipRes.data || null;
    const club = membership && membership.clubs
      ? (Array.isArray(membership.clubs) ? membership.clubs[0] : membership.clubs)
      : null;

    // Flatten all memberships into a clubs[] array (joined club + the viewer's role).
    const userClubs = (clubsRes.data || []).map(m => {
      const c = Array.isArray(m.clubs) ? m.clubs[0] : m.clubs;
      return c ? Object.assign({}, c, { role: m.role }) : null;
    }).filter(Boolean);

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

    const profileData = {
      profile: {
        name: display.name,
        handle: display.handle,
        bio: meta.bio || '',
        location: meta.location || ''
      },
      userId: req.user.id,
      email: req.user.email,
      memberSince: req.user.created_at || null,
      postCount: postCountRes.count || 0,
      activityCount: activityCountRes.count || 0,
      kmLogged,
      followerCount: followerRes.count || 0,
      followingCount: followingRes.count || 0,
      posts: postsRes.data || [],
      membership: membership ? { role: membership.role, club } : null,
      clubs: userClubs,
      followingList,
      followerList
    };

    const html = injectBottomNav(injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-my-profile.html'), 'utf8'), profileData), 'profile');
    res.type('html').send(html);
  } catch (err) {
    console.log('Profile data error:', err.message);
    servePlain();
  }
});
// Profile stats & PRs computed from the signed-in user's own `activities`.
// Hero stats and the sport breakdown respect the `period` filter; streaks,
// the 12-week chart, and personal records are always all-time (per spec).
app.get(BASE + '/api/profile/stats', requireAuth, async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });
    const period = req.query.period === 'month' || req.query.period === 'year' ? req.query.period : 'all';
    const now = new Date();
    let periodStart = new Date(2020, 0, 1);
    if (period === 'month') periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    if (period === 'year') periodStart = new Date(now.getFullYear(), 0, 1);

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
    // Period-filtered activities for hero stats and breakdowns.
    const periodActs = acts.filter((a) => new Date(a.date) >= periodStart);

    const km = (a) => parseDistanceKm(a.distance);

    // ── Hero stats (period) ──
    const totalKm = Math.round(periodActs.reduce((s, a) => s + km(a), 0));
    const totalHours = Math.round(periodActs.reduce((s, a) => s + parseDurationHours(a.duration), 0) * 10) / 10;
    const totalPoints = calculatePoints(periodActs);

    // ── Streaks (always all-time) ──
    const activeDays = [...new Set(acts.map((a) => new Date(a.date).toDateString()))]
      .map((d) => new Date(d)).sort((a, b) => a - b);
    let longestStreak = 0, run = 0;
    for (let i = 0; i < activeDays.length; i++) {
      if (i === 0) { run = 1; }
      else {
        const diff = Math.round((activeDays[i] - activeDays[i - 1]) / 86400000);
        run = diff === 1 ? run + 1 : 1;
      }
      if (run > longestStreak) longestStreak = run;
    }
    let currentStreak = 0;
    if (activeDays.length > 0) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const lastActive = new Date(activeDays[activeDays.length - 1]); lastActive.setHours(0, 0, 0, 0);
      const gap = Math.round((today - lastActive) / 86400000);
      if (gap <= 1) {
        currentStreak = 1;
        for (let i = activeDays.length - 1; i > 0; i--) {
          const diff = Math.round((activeDays[i] - activeDays[i - 1]) / 86400000);
          if (diff === 1) currentStreak++;
          else break;
        }
      }
    }
    // Avg sessions per week over the period (or since first activity in period).
    const firstDate = periodActs.length > 0 ? new Date(periodActs[0].date) : now;
    const weeksSpan = Math.max(1, (now - firstDate) / (7 * 86400000));
    const avgPerWeek = Math.round((periodActs.length / weeksSpan) * 10) / 10;

    // ── Weekly chart (last 12 weeks, always recent regardless of period) ──
    const weeklyChart = [];
    for (let i = 11; i >= 0; i--) {
      const day = now.getDay() || 7;
      const wStart = new Date(now); wStart.setDate(now.getDate() - day + 1 - i * 7); wStart.setHours(0, 0, 0, 0);
      const wEnd = new Date(wStart); wEnd.setDate(wStart.getDate() + 7);
      const wActs = acts.filter((a) => { const d = new Date(a.date); return d >= wStart && d < wEnd; });
      weeklyChart.push({
        label: wStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).replace(' ', ''),
        hours: Math.round(wActs.reduce((s, a) => s + parseDurationHours(a.duration), 0) * 10) / 10
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
      km: Math.round(s.km),
      hours: Math.round(s.hours * 10) / 10,
      pct: periodActs.length > 0 ? Math.round((s.sessions / periodActs.length) * 100) : 0
    })).sort((a, b) => b.sessions - a.sessions);

    // ── Personal records (always all-time) ──
    const prs = [];
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000);
    const isNew = (dateStr) => new Date(dateStr) >= fourteenDaysAgo;
    const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    const runs = acts.filter((a) => a.sport === 'running' && km(a) > 0);
    if (runs.length) {
      const best = runs.reduce((m, a) => km(a) > km(m) ? a : m);
      prs.push({ icon: '🏃', label: 'Longest run', value: km(best) + ' km', meta: fmtDate(best.date) + (best.title ? ' · ' + best.title : ''), isNew: isNew(best.date) });
    }
    const pacedRuns = runs.filter((a) => km(a) >= 3 && parseDurationHours(a.duration) > 0);
    if (pacedRuns.length) {
      const withPace = pacedRuns.map((a) => ({ a, pace: (parseDurationHours(a.duration) * 60) / km(a) }));
      const best = withPace.reduce((m, x) => x.pace < m.pace ? x : m);
      const mins = Math.floor(best.pace);
      const secs = Math.round((best.pace - mins) * 60);
      prs.push({ icon: '⚡', label: 'Fastest pace · run', value: `${mins}:${String(secs).padStart(2, '0')} /km`, meta: fmtDate(best.a.date) + (best.a.title ? ' · ' + best.a.title : ''), isNew: isNew(best.a.date) });
    }
    const rides = acts.filter((a) => a.sport === 'cycling' && km(a) > 0);
    if (rides.length) {
      const best = rides.reduce((m, a) => km(a) > km(m) ? a : m);
      prs.push({ icon: '🚴', label: 'Longest ride', value: km(best) + ' km', meta: fmtDate(best.date) + (best.title ? ' · ' + best.title : ''), isNew: isNew(best.date) });
    }
    const timed = acts.filter((a) => parseDurationHours(a.duration) > 0);
    if (timed.length) {
      const best = timed.reduce((m, a) => parseDurationHours(a.duration) > parseDurationHours(m.duration) ? a : m);
      const h = parseDurationHours(best.duration);
      const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
      const sportName = best.sport ? best.sport.charAt(0).toUpperCase() + best.sport.slice(1) : 'Activity';
      prs.push({ icon: '⏱', label: 'Longest activity', value: `${hh}h ${mm}m`, meta: fmtDate(best.date) + ' · ' + sportName, isNew: isNew(best.date) });
    }
    if (acts.length) {
      const weekTotals = {};
      acts.forEach((a) => {
        const d = new Date(a.date);
        const day = d.getDay() || 7;
        const wStart = new Date(d); wStart.setDate(d.getDate() - day + 1); wStart.setHours(0, 0, 0, 0);
        const key = `${wStart.getFullYear()}-${String(wStart.getMonth() + 1).padStart(2, '0')}-${String(wStart.getDate()).padStart(2, '0')}`;
        if (!weekTotals[key]) weekTotals[key] = { hours: 0, count: 0 };
        weekTotals[key].hours += parseDurationHours(a.duration);
        weekTotals[key].count++;
      });
      const bestWeek = Object.entries(weekTotals).reduce((m, x) => x[1].hours > m[1].hours ? x : m);
      prs.push({ icon: '📅', label: 'Biggest week', value: Math.round(bestWeek[1].hours * 10) / 10 + 'h', meta: 'Week of ' + new Date(bestWeek[0]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' · ' + bestWeek[1].count + ' activities', isNew: isNew(bestWeek[0]) });

      const monthTotals = {};
      acts.forEach((a) => {
        const d = new Date(a.date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthTotals[key] = (monthTotals[key] || 0) + km(a);
      });
      const bestMonth = Object.entries(monthTotals).reduce((m, x) => x[1] > m[1] ? x : m);
      const [bmYear, bmMonth] = bestMonth[0].split('-').map(Number);
      prs.push({ icon: '📍', label: 'Biggest month', value: Math.round(bestMonth[1]) + ' km', meta: new Date(bmYear, bmMonth - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) + ' · across all sports', isNew: false });
    }

    res.json({
      period,
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
    if (typeof body.bio === 'string') meta.bio = body.bio.trim().slice(0, 600);
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
// Blog is moving to an external Ghost site (not live yet). Until then the in-app
// blog is unreachable: every in-app blog link has been removed and this route
// redirects to the landing page so stale bookmarks/links don't 404. The page
// file arenas-blog.html stays on disk, unused, to repurpose or point at Ghost later.
app.get(BASE + '/blog', (req, res) => res.redirect(BASE + '/landing'));
app.get(BASE + '/for-clubs', (req, res) => res.sendFile(path.join(HTML, 'arenas-for-clubs.html')));
// About is a public marketing/content page (no auth), served raw like /for-clubs.
app.get(BASE + '/about', (req, res) => res.sendFile(path.join(HTML, 'arenas-about.html')));
// Terms of Service is a public content page (no auth), served raw like /about.
app.get(BASE + '/terms', (req, res) => res.sendFile(path.join(HTML, 'arenas-terms.html')));
// Club dashboard requires authentication. Inject the coach's real club, member
// count, and recent members so the page shows live data instead of the
// hardcoded "Hackney Running Club" / "Rachel" placeholders.
app.get(BASE + '/clubs/dashboard', requirePageAuth, async (req, res) => {
  const servePlain = () => res.type('html').send(injectBottomNav(fs.readFileSync(path.join(HTML, 'arenas-club-dashboard.html'), 'utf8'), 'club-dashboard'));
  try {
    if (!supabaseAdmin) return servePlain();

    // The club this user administers. Honor an explicit ?club=<id> when the
    // viewer is an admin/coach of it (so multi-club coaches land on the right
    // dashboard from the "My clubs" sidebar); otherwise default to their most
    // recent admin/coach membership. The role filter keeps this IDOR-safe — an
    // unmanaged or unknown id silently falls back to the default club.
    const requestedClubId = typeof req.query.club === 'string' ? req.query.club : null;
    const pickManagedMembership = async (clubFilter) => {
      let q = supabaseAdmin
        .from('memberships')
        .select('club_id, role, clubs (id, name, handle, sport, city)')
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
        return { user_id: m.user_id, role: m.role, joined_at: m.created_at, name: display.name, handle: display.handle };
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
              handle: (nameMap[r.user_id] && nameMap[r.user_id].handle) || 'member'
            }));
          const attendancePct = memberCount > 0 ? Math.round((goingCount / memberCount) * 100) : 0;
          const eventTime = new Date(event.date).getTime();
          return {
            ...event,
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

        // One batched auth lookup for every distinct participant.
        const chNameMap = await buildUserDisplayMap(challengeParticipants.map(p => p.user_id));

        const nowMs = Date.now();
        const enrichedChallenges = [];
        for (const challenge of (clubChallenges || [])) {
          const parts = challengeParticipants.filter(p => p.challenge_id === challenge.id);
          const partIds = parts.map(p => p.user_id);
          const target = Number(challenge.goal_target) || 0;

          // Pull every participant's in-window activities in one query, then
          // group by user so each gets its own computeChallengeProgress pass.
          let acts = [];
          if (partIds.length) {
            const { data: actRows } = await supabaseAdmin
              .from('activities')
              .select('user_id, distance, duration, sport, date')
              .in('user_id', partIds)
              .gte('date', challenge.start_date)
              .lte('date', challenge.end_date);
            acts = actRows || [];
          }
          const actsByUser = {};
          acts.forEach(a => { (actsByUser[a.user_id] = actsByUser[a.user_id] || []).push(a); });

          const leaderboard = partIds.map(uid => {
            const progress = computeChallengeProgress(challenge, actsByUser[uid] || []);
            const disp = chNameMap[uid] || {};
            return {
              userId: uid,
              name: disp.name || 'Athlete',
              handle: disp.handle || 'athlete',
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
            ...challenge,
            participantCount,
            notJoinedCount,
            leaderboard,
            top3: leaderboard.slice(0, 3),
            achievedCount,
            successRate: participantCount > 0 ? Math.round((achievedCount / participantCount) * 100) : 0,
            isPast: endMs < nowMs,
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

    const clubData = {
      club: (membership && membership.clubs) || null,
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
      userEmail: req.user.email
    };

    const html = injectBottomNav(injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-club-dashboard.html'), 'utf8'), clubData), 'club-dashboard');
    res.type('html').send(html);
  } catch (err) {
    console.log('Dashboard data error:', err.message);
    servePlain();
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
      .select('role, clubs:club_id (id, name, handle, sport)')
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
    const html = injectBottomNav(injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-club-member.html'), 'utf8'), clubData), 'club-member');
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
// the shared calculatePoints/parseDistanceKm heuristic.
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
    if (!myMembership) return res.json({ error: 'Not a member of this club' });

    // Club details.
    const { data: club } = await supabaseAdmin
      .from('clubs')
      .select('id, name, handle, sport, city')
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
    const roleOf = (id) => (memberRows.find((m) => m.user_id === id) || {}).role || 'coach';

    // Roster: admins, then coaches, then members alphabetically.
    const roleOrder = { admin: 0, coach: 1, member: 2 };
    const roster = memberRows.map((m) => ({
      userId: m.user_id,
      name: nameOf(m.user_id),
      handle: handleOf(m.user_id),
      role: m.role,
      isMe: m.user_id === userId
    })).sort((a, b) => ((roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3)) || a.name.localeCompare(b.name));

    // Coach announcements — recent posts by this club's admins/coaches.
    const coachIds = memberRows.filter((m) => m.role === 'admin' || m.role === 'coach').map((m) => m.user_id);
    const { data: announcements } = await supabaseAdmin
      .from('posts')
      .select('id, user_id, content, created_at')
      .in('user_id', coachIds.length ? coachIds : [PLACEHOLDER])
      .order('created_at', { ascending: false })
      .limit(5);
    const annRows = announcements || [];
    const annIds = annRows.map((a) => a.id);
    const { data: annLikes } = await supabaseAdmin
      .from('post_likes')
      .select('post_id, user_id')
      .in('post_id', annIds.length ? annIds : [PLACEHOLDER]);
    const likeRows = annLikes || [];
    const announcementsOut = annRows.map((a) => {
      const likes = likeRows.filter((l) => l.post_id === a.id);
      return {
        id: a.id,
        coachName: nameOf(a.user_id),
        role: roleOf(a.user_id),
        content: a.content,
        createdAt: a.created_at,
        likeCount: likes.length,
        likedByMe: likes.some((l) => l.user_id === userId)
      };
    });

    // Upcoming club events with the viewer's RSVP status.
    const nowIso = new Date().toISOString();
    const { data: clubEvents } = await supabaseAdmin
      .from('events')
      .select('id, title, date, location, sport')
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
        goingCount: rsvps.filter((r) => r.status === 'going').length,
        myStatus: myRsvp ? myRsvp.status : null
      };
    });

    // Active club challenges with the viewer's progress.
    const { data: clubChallenges } = await supabaseAdmin
      .from('challenges')
      .select('id, title, sport, goal_type, goal_target, goal_unit, start_date, end_date')
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
      const chStart = new Date(ch.start_date);
      const chEnd = new Date(ch.end_date);
      myActRows.forEach((a) => {
        const d = new Date(a.date);
        if (d < chStart || d > chEnd) return;
        if (ch.sport !== 'any' && a.sport !== ch.sport) return;
        if (ch.goal_type === 'distance') progress += parseDistanceKm(a.distance);
        else if (ch.goal_type === 'streak') streakDays.add(d.toDateString());
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
        statusText = rem <= 2 ? `${rem} more day${rem !== 1 ? 's' : ''} — don't break it!` : `${rem} days to go`;
        statusColor = '#854D0E';
      }
      else if (pct >= expectedPct) { statusText = 'On pace'; statusColor = '#10B981'; }
      else { statusText = 'Behind pace — push on'; statusColor = '#854D0E'; }
      challengesOut.push({
        id: ch.id, title: ch.title, sport: ch.sport,
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
      myRole: myMembership.role
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
  const servePlain = () => res.type('html').send(injectNotificationsPanel(fs.readFileSync(path.join(HTML, 'arenas-club-invite.html'), 'utf8')));
  try {
    if (!supabaseAdmin) return servePlain();

    const { data: membership } = await supabaseAdmin
      .from('memberships')
      .select('club_id, role, clubs (id, name, handle, sport, city)')
      .eq('user_id', req.user.id)
      .in('role', ['admin', 'coach'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!membership || !membership.club_id) return servePlain();
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
        isSelf: m.user_id === req.user.id
      })),
      baseUrl: publicBaseUrl(req)
    };

    const html = injectNotificationsPanel(injectNamedData(fs.readFileSync(path.join(HTML, 'arenas-club-invite.html'), 'utf8'), 'INVITE_DATA', inviteData));
    res.type('html').send(html);
  } catch (err) {
    console.log('Invite page data error:', err.message);
    servePlain();
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

    if (existingUser) {
      let clubName = 'a club';
      try {
        const { data: club } = await supabaseAdmin.from('clubs').select('name').eq('id', clubId).single();
        if (club && club.name) clubName = club.name;
      } catch (err) { /* fall back to generic name */ }
      const inviter = displayFromUser(req.user);
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
        message: `${email} already has an Arenas account — they've been notified in-app and can join with one click`
      });
    }

    if (process.env.NODE_ENV !== 'production') console.log('INVITE - To:', email, 'Join URL:', joinUrl);
    return res.json({
      success: true,
      existingUser: false,
      invite,
      joinUrl,
      message: `Invite created for ${email}`
    });
  } catch (err) {
    console.log('Invite error:', err.message);
    return res.status(500).json({ error: 'Could not create invite' });
  }
});

// Create many invites at once (used by the invite form and CSV/paste import).
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
    const email = (raw && raw.email || '').trim().toLowerCase();
    const irole = ['member', 'coach', 'admin'].includes(raw && raw.role) ? raw.role : 'member';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { results.failed.push({ email, reason: 'invalid_email' }); continue; }
    try {
      const { data: existing } = await supabaseAdmin
        .from('club_invites')
        .select('id')
        .eq('club_id', clubId)
        .eq('email', email)
        .eq('status', 'pending')
        .maybeSingle();
      if (existing) { results.skipped.push({ email, reason: 'already_pending' }); continue; }

      const existingUser = userByEmail[email] || null;
      if (existingUser) {
        const memberRole = await getClubRole(existingUser.id, clubId);
        if (memberRole) { results.skipped.push({ email, reason: 'already_member' }); continue; }
      }

      const token = generateInviteToken();
      const { error } = await supabaseAdmin
        .from('club_invites')
        .insert({
          club_id: clubId,
          invited_by: req.user.id,
          email,
          role: irole,
          token,
          status: 'pending',
          expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString()
        });
      if (error) { results.failed.push({ email, reason: 'db' }); continue; }
      const joinUrl = `${publicBaseUrl(req)}/join/${token}`;

      if (existingUser) {
        await createNotification({
          userId: existingUser.id,
          type: 'club',
          title: 'Club invite',
          body: `${inviter.name} invited you to join ${clubName} on Arenas`,
          link: `/join/${token}`,
          actorId: req.user.id,
          entityId: clubId
        });
        results.sent.push({ email, joinUrl, existingUser: true });
      } else {
        if (process.env.NODE_ENV !== 'production') console.log('BULK INVITE - To:', email, 'Join URL:', joinUrl);
        results.sent.push({ email, joinUrl, existingUser: false });
      }
    } catch (err) {
      results.failed.push({ email, reason: 'db' });
    }
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
    if (process.env.NODE_ENV !== 'production') console.log('RESEND INVITE - To:', invite.email, 'Join URL:', joinUrl);
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
    const { error } = await supabaseAdmin
      .from('memberships')
      .delete()
      .eq('user_id', userId)
      .eq('club_id', clubId);
    if (error) return res.status(500).json({ error: 'Could not remove member' });
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
      const html = injectNamedData(fs.readFileSync(path.join(HTML, 'arenas-club-join.html'), 'utf8'), 'JOIN_DATA', state);
      res.type('html').send(html);
    } catch (err) {
      res.status(500).send('Unable to load invite');
    }
  };
  try {
    if (!supabaseAdmin) return render({ status: 'error', baseUrl: publicBaseUrl(req) });
    const { data: invite } = await supabaseAdmin
      .from('club_invites')
      .select('*, clubs (id, name, handle, sport, city)')
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
    // stay pending so they can be reused until they expire.
    if (!isOpen) {
      await supabaseAdmin
        .from('club_invites')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('token', req.params.token);
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
        link: '/clubs/dashboard',
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
    if (!isOpen) {
      await supabaseAdmin
        .from('club_invites')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('token', req.params.token);
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
        link: '/clubs/dashboard',
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
  const unreadCount = notifications.filter(n => !n.read).length;
  res.json({ notifications, unreadCount });
});

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
app.delete(BASE + '/api/notifications/:id', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Service unavailable' });
  const { error } = await supabaseAdmin
    .from('notifications')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);
  if (error) return res.json({ error: error.message });
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
