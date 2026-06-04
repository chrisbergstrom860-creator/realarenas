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
    return res.redirect(BASE);
  } catch (err) {
    return res.redirect(BASE + '/landing?error=invalid');
  }
});

app.post(BASE + '/auth/signup', async (req, res) => {
  const { email, password, name } = req.body;
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } }
    });
    if (error) {
      return res.redirect(BASE + '/landing?error=signup');
    }
    if (data && data.session) setSession(res, data.session);
    return res.redirect(BASE);
  } catch (err) {
    return res.redirect(BASE + '/landing?error=signup');
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
  res.json({ success: true, comment: data });
});

app.get(BASE === '' ? '/' : BASE, (req, res) => res.sendFile(path.join(HTML, 'arenas-feed.html')));
app.get(BASE + '/athletes', (req, res) => res.sendFile(path.join(HTML, 'arenas-athletes.html')));
app.get(BASE + '/events', (req, res) => res.sendFile(path.join(HTML, 'arenas-events.html')));
app.get(BASE + '/leaderboards', (req, res) => res.sendFile(path.join(HTML, 'arenas-leaderboards.html')));
app.get(BASE + '/challenges', (req, res) => res.sendFile(path.join(HTML, 'arenas-challenges.html')));
app.get(BASE + '/profile', (req, res) => res.sendFile(path.join(HTML, 'arenas-my-profile.html')));
app.get(BASE + '/blog', (req, res) => {
  // Marketing page: only reveal the user avatar when actually logged in,
  // otherwise show the guest "Log in / Sign up" CTAs (matches the landing page).
  const loggedIn = !!(req.signedCookies && req.signedCookies.sb_access_token);
  let html = fs.readFileSync(path.join(HTML, 'arenas-blog.html'), 'utf8');
  if (loggedIn) html = html.replace('<body>', '<body class="logged-in">');
  res.type('html').send(html);
});
app.get(BASE + '/for-clubs', (req, res) => res.sendFile(path.join(HTML, 'arenas-for-clubs.html')));
app.get(BASE + '/clubs/dashboard', (req, res) => res.sendFile(path.join(HTML, 'arenas-club-dashboard.html')));
app.get(BASE + '/clubs/member', (req, res) => res.sendFile(path.join(HTML, 'arenas-club-member.html')));
app.get(BASE + '/clubs/invite', (req, res) => res.sendFile(path.join(HTML, 'arenas-club-invite.html')));
app.get(BASE + '/landing', (req, res) => res.sendFile(path.join(HTML, 'arenas-landing-login.html')));
app.get(BASE + '/notifications', (req, res) => res.sendFile(path.join(HTML, 'arenas-notifications.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on 0.0.0.0:${PORT}`);
});
