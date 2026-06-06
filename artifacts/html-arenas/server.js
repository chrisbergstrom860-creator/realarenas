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
app.get(BASE + '/feed', requirePageAuth, async (req, res) => {
  try {
    const { posts, followsNobody } = await buildFeedPosts(20, req.user.id);
    const feedActivities = await buildFeedActivities(10, req.user.id);
    const followingRsvps = await buildFeedRsvps(req.user.id);
    const userData = { profile: displayFromUser(req.user), userId: req.user.id, posts, followsNobody, feedActivities, followingRsvps };
    const html = injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-feed.html'), 'utf8'), userData);
    res.type('html').send(html);
  } catch (err) {
    console.log('Feed data error:', err.message);
    res.sendFile(path.join(HTML, 'arenas-feed.html'));
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
    followingIds: []
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
        followingIds
      };
    }
  } catch (err) {
    console.log('Athletes data error:', err.message);
  }
  try {
    const html = injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-athletes.html'), 'utf8'), athleteData);
    res.type('html').send(html);
  } catch (err) {
    console.log('Athletes render error:', err.message);
    res.sendFile(path.join(HTML, 'arenas-athletes.html'));
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
  res.json({ success: true, status });
});

// Delete one of the viewer's own events (the created_by filter enforces
// ownership even though the service role bypasses RLS).
app.delete(BASE + '/api/events/:id', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.json({ error: 'Server is not configured for events' });
  const { error } = await supabaseAdmin
    .from('events').delete().eq('id', req.params.id).eq('created_by', req.user.id);
  if (error) return res.json({ error: error.message });
  res.json({ success: true });
});

// Events page: inject the viewer's identity, the people they follow, and their
// clubs so the create modal and rendering can use real data. There is no
// `profiles` table, so names come from auth metadata.
app.get(BASE + '/events', requirePageAuth, async (req, res) => {
  try {
    if (!supabaseAdmin) return res.sendFile(path.join(HTML, 'arenas-events.html'));
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
    const { data: memberships } = await supabaseAdmin
      .from('memberships').select('club_id, clubs (id, name, handle)').eq('user_id', userId);
    const clubs = (memberships || [])
      .map(m => Array.isArray(m.clubs) ? m.clubs[0] : m.clubs).filter(Boolean);
    const eventData = { userId, profile: displayFromUser(req.user), following: followingList, clubs };
    const html = injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-events.html'), 'utf8'), eventData);
    res.type('html').send(html);
  } catch (err) {
    console.log('Events page error:', err.message);
    res.sendFile(path.join(HTML, 'arenas-events.html'));
  }
});
app.get(BASE + '/leaderboards', (req, res) => res.sendFile(path.join(HTML, 'arenas-leaderboards.html')));
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
    const challengeData = { userId, profile: displayFromUser(req.user), following };
    const html = injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-challenges.html'), 'utf8'), challengeData);
    res.send(html);
  } catch (err) {
    console.log('Challenges page error:', err.message);
    res.sendFile(path.join(HTML, 'arenas-challenges.html'));
  }
});
// My profile requires authentication. Inject the user's real identity, post/
// follower/following counts, recent posts, and club membership so the page shows
// live data instead of the hardcoded "Jamie King" placeholders. There is no
// `profiles` table, so name/handle/bio/location come from auth user metadata.
app.get(BASE + '/profile', requirePageAuth, async (req, res) => {
  const servePlain = () => res.sendFile(path.join(HTML, 'arenas-my-profile.html'));
  try {
    if (!supabaseAdmin) return servePlain();
    const meta = req.user.user_metadata || {};
    const display = displayFromUser(req.user);

    const [postCountRes, followerRes, followingRes, postsRes, membershipRes, followingListRes, followerListRes] = await Promise.all([
      supabaseAdmin.from('posts').select('*', { count: 'exact', head: true }).eq('user_id', req.user.id),
      supabaseAdmin.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', req.user.id),
      supabaseAdmin.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', req.user.id),
      supabaseAdmin.from('posts').select('id, content, sport, feeling, created_at').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(10),
      supabaseAdmin.from('memberships').select('role, clubs (name, handle)').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      // Raw follow edges (no `created_at` ordering — not guaranteed on this table).
      supabaseAdmin.from('follows').select('following_id').eq('follower_id', req.user.id),
      supabaseAdmin.from('follows').select('follower_id').eq('following_id', req.user.id)
    ]);

    const membership = membershipRes.data || null;
    const club = membership && membership.clubs
      ? (Array.isArray(membership.clubs) ? membership.clubs[0] : membership.clubs)
      : null;

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
      followerCount: followerRes.count || 0,
      followingCount: followingRes.count || 0,
      posts: postsRes.data || [],
      membership: membership ? { role: membership.role, club } : null,
      followingList,
      followerList
    };

    const html = injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-my-profile.html'), 'utf8'), profileData);
    res.type('html').send(html);
  } catch (err) {
    console.log('Profile data error:', err.message);
    servePlain();
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
app.get(BASE + '/blog', (req, res) => {
  // Marketing page: only reveal the user avatar when actually logged in,
  // otherwise show the guest "Log in / Sign up" CTAs (matches the landing page).
  const loggedIn = !!(req.signedCookies && req.signedCookies.sb_access_token);
  let html = fs.readFileSync(path.join(HTML, 'arenas-blog.html'), 'utf8');
  if (loggedIn) html = html.replace('<body>', '<body class="logged-in">');
  res.type('html').send(html);
});
app.get(BASE + '/for-clubs', (req, res) => res.sendFile(path.join(HTML, 'arenas-for-clubs.html')));
// Club dashboard requires authentication. Inject the coach's real club, member
// count, and recent members so the page shows live data instead of the
// hardcoded "Hackney Running Club" / "Rachel" placeholders.
app.get(BASE + '/clubs/dashboard', requirePageAuth, async (req, res) => {
  const servePlain = () => res.sendFile(path.join(HTML, 'arenas-club-dashboard.html'));
  try {
    if (!supabaseAdmin) return servePlain();

    // The club this user administers (most recent admin/coach membership wins).
    const { data: membership } = await supabaseAdmin
      .from('memberships')
      .select('club_id, role, clubs (id, name, handle, sport, city)')
      .eq('user_id', req.user.id)
      .in('role', ['admin', 'coach'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const clubId = membership && membership.club_id;
    let memberCount = 0;
    let members = [];
    let pendingCount = 0;

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

      // Count pending invitations so the dashboard can surface them.
      try {
        const { count: pc } = await supabaseAdmin
          .from('club_invites')
          .select('*', { count: 'exact', head: true })
          .eq('club_id', clubId)
          .eq('status', 'pending');
        pendingCount = pc || 0;
      } catch (e) {
        // Non-fatal: dashboard still renders without the pending count.
      }
    }

    const clubData = {
      club: (membership && membership.clubs) || null,
      profile: displayFromUser(req.user),
      memberCount,
      members,
      pendingCount,
      userEmail: req.user.email
    };

    const html = injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-club-dashboard.html'), 'utf8'), clubData);
    res.type('html').send(html);
  } catch (err) {
    console.log('Dashboard data error:', err.message);
    servePlain();
  }
});
app.get(BASE + '/clubs/member', (req, res) => res.sendFile(path.join(HTML, 'arenas-club-member.html')));

// ── CLUB INVITE ADMIN PAGE ──
// Renders the invite console with the manager's real club, pending invites, and
// members injected as window.INVITE_DATA. Falls back to the static mockup if the
// viewer isn't a club manager or data can't be loaded.
app.get(BASE + '/clubs/invite', requirePageAuth, async (req, res) => {
  const servePlain = () => res.sendFile(path.join(HTML, 'arenas-club-invite.html'));
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

    const html = injectNamedData(fs.readFileSync(path.join(HTML, 'arenas-club-invite.html'), 'utf8'), 'INVITE_DATA', inviteData);
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

// Accept a club invite with one click from an in-app notification. The signed-in
// user joins the club; their pending invite (matched by email) is marked
// accepted and the club's admins are notified.
app.post(BASE + '/api/clubs/:clubId/accept-invite', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Server not configured' });
  const { clubId } = req.params;
  try {
    const already = await getClubRole(req.user.id, clubId);
    if (already) return res.status(409).json({ error: 'You are already a member of this club' });

    // Require a real pending invite addressed to this user before joining, so a
    // signed-in user can't join an arbitrary club just by knowing its id.
    const email = (req.user.email || '').toLowerCase();
    const { data: invite } = await supabaseAdmin
      .from('club_invites')
      .select('*')
      .eq('club_id', clubId)
      .eq('email', email)
      .eq('status', 'pending')
      .maybeSingle();
    if (!invite) return res.status(403).json({ error: 'No pending invite found for your account' });
    if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: 'This invite has expired' });
    }

    const { error } = await supabaseAdmin
      .from('memberships')
      .insert({ user_id: req.user.id, club_id: clubId, role: invite.role || 'member' });
    if (error && !/duplicate/i.test(error.message)) {
      return res.status(500).json({ error: 'Could not join club' });
    }

    await supabaseAdmin
      .from('club_invites')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', invite.id);

    // Notify the club's admins that a new member joined.
    try {
      let clubName = 'your club';
      const { data: club } = await supabaseAdmin.from('clubs').select('name').eq('id', clubId).single();
      if (club && club.name) clubName = club.name;
      const joiner = displayFromUser(req.user);
      const { data: admins } = await supabaseAdmin
        .from('memberships').select('user_id').eq('club_id', clubId).eq('role', 'admin');
      await Promise.all((admins || []).map(a => {
        if (a.user_id === req.user.id) return null;
        return createNotification({
          userId: a.user_id,
          type: 'club',
          title: 'New member joined',
          body: `${joiner.name} accepted your invite and joined ${clubName}`,
          link: '/clubs/dashboard',
          actorId: req.user.id,
          entityId: clubId
        });
      }));
    } catch (err) { /* notifications are best-effort */ }

    return res.json({ success: true, message: 'Welcome to the club!' });
  } catch (err) {
    console.log('Accept invite error:', err.message);
    return res.status(500).json({ error: 'Could not join club' });
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

// Notifications page requires auth. Inject the viewer's real notifications and
// identity so the page renders live data instead of the hardcoded placeholders.
app.get(BASE + '/notifications', requirePageAuth, async (req, res) => {
  const servePlain = () => res.sendFile(path.join(HTML, 'arenas-notifications.html'));
  try {
    if (!supabaseAdmin) return servePlain();
    const { data } = await supabaseAdmin
      .from('notifications')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    const notifications = await enrichNotifications(data);
    const notifData = {
      notifications,
      unreadCount: notifications.filter(n => !n.read).length,
      profile: displayFromUser(req.user)
    };
    const html = injectArenasData(fs.readFileSync(path.join(HTML, 'arenas-notifications.html'), 'utf8'), notifData);
    res.type('html').send(html);
  } catch (err) {
    console.log('Notifications error:', err.message);
    servePlain();
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on 0.0.0.0:${PORT}`);
});
