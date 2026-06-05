require('dotenv').config();

console.log('Starting server...');
console.log('PORT env var:', process.env.PORT);
console.log('All env vars:', Object.keys(process.env).filter(k => !k.includes('KEY') && !k.includes('SECRET')));

const express = require('express');
const path = require('path');
const fs = require('fs');
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

    let orFilter = `created_by.eq.${userId}`;
    if (myIds.length) orFilter += `,id.in.(${myIds.join(',')})`;
    const { data: myChallenges } = await supabaseAdmin
      .from('challenges').select('*').or(orFilter)
      .order('created_at', { ascending: false });

    const { data: clubChallenges } = await supabaseAdmin
      .from('challenges').select('*')
      .in('club_id', clubIds.length ? clubIds : [PLACEHOLDER])
      .order('created_at', { ascending: false });

    const { data: publicChallenges } = await supabaseAdmin
      .from('challenges').select('*')
      .eq('visibility', 'public')
      .gt('end_date', new Date().toISOString())
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
      return {
        ...c,
        participantCount: (allParticipants || []).filter((p) => p.challenge_id === c.id).length,
        isJoined: myIds.includes(c.id) || c.created_by === userId,
        progress: progressMap[c.id] || 0,
        daysLeft: Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24))),
        isExpired: end < now,
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
  const { data: challenge, error } = await supabaseAdmin
    .from('challenges').insert({
      created_by: req.user.id,
      club_id: club_id || null,
      title: String(title).trim(),
      description: description || null,
      sport: sport || 'any',
      goal_type,
      goal_target,
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
    const userData = { profile: displayFromUser(req.user), userId: req.user.id, posts, followsNobody, feedActivities };
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
app.get(BASE + '/events', (req, res) => res.sendFile(path.join(HTML, 'arenas-events.html')));
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
    }

    const clubData = {
      club: (membership && membership.clubs) || null,
      profile: displayFromUser(req.user),
      memberCount,
      members,
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
app.get(BASE + '/clubs/invite', (req, res) => res.sendFile(path.join(HTML, 'arenas-club-invite.html')));
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
