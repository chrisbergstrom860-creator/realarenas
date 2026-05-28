const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE = (process.env.BASE_PATH || '/html').replace(/\/$/, '');
const HTML = path.join(__dirname, 'html');

if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    next();
  });
}

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
