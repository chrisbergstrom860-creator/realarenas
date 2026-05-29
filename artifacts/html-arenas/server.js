require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE = (process.env.BASE_PATH || '/html').replace(/\/$/, '');
const HTML = path.join(__dirname, 'html');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

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

app.get(BASE === '' ? '/' : BASE, (req, res) => res.sendFile(path.join(HTML, 'arenas-feed.html')));
app.get(BASE + '/athletes', (req, res) => res.sendFile(path.join(HTML, 'arenas-athletes.html')));
app.get(BASE + '/events', (req, res) => res.sendFile(path.join(HTML, 'arenas-events.html')));
app.get(BASE + '/leaderboards', (req, res) => res.sendFile(path.join(HTML, 'arenas-leaderboards.html')));
app.get(BASE + '/challenges', (req, res) => res.sendFile(path.join(HTML, 'arenas-challenges.html')));
app.get(BASE + '/profile', (req, res) => res.sendFile(path.join(HTML, 'arenas-my-profile.html')));
app.get(BASE + '/blog', (req, res) => res.sendFile(path.join(HTML, 'arenas-blog.html')));
app.get(BASE + '/for-clubs', (req, res) => res.sendFile(path.join(HTML, 'arenas-for-clubs.html')));
app.get(BASE + '/clubs/dashboard', (req, res) => res.sendFile(path.join(HTML, 'arenas-club-dashboard.html')));
app.get(BASE + '/clubs/member', (req, res) => res.sendFile(path.join(HTML, 'arenas-club-member.html')));
app.get(BASE + '/clubs/invite', (req, res) => res.sendFile(path.join(HTML, 'arenas-club-invite.html')));
app.get(BASE + '/landing', (req, res) => res.sendFile(path.join(HTML, 'arenas-landing-login.html')));
app.get(BASE + '/notifications', (req, res) => res.sendFile(path.join(HTML, 'arenas-notifications.html')));

app.listen(PORT, () => {
  console.log('Arenas HTML prototype on port ' + PORT + ' base ' + (BASE || '/'));
});
