// Pins the /profile Clubs-tab navigation behaviour: a user in three clubs
// clicking each card's Open button must land on THAT club — asserted by the
// club id the destination page actually loaded (window.ARENAS_DATA.club.id /
// ?club= on the coach dashboard), not just the generated URL. Regression
// guard for the wrong-club bug where every card called the bare
// nav('/clubs/member') and the server redirected to the most recently joined
// club. Also covers the role branch: admin/coach cards must open the club
// dashboard for that club.
const { launchBrowser } = require('./lib/mobile-geometry.js');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BASE = 'http://localhost:80/html';
const PW = 'Probe-1234!';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  ok  ' : '  FAIL ') + l + (x ? ' — ' + x : '')); if (!c) fails++; };

async function login(email) {
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password: PW }), redirect: 'manual',
  });
  const raw = r.headers.getSetCookie();
  if (!raw.length) throw new Error('login failed');
  return raw.map(c => { const [p] = c.split(';'); const i = p.indexOf('='); return { name: p.slice(0, i), value: p.slice(i + 1), domain: 'localhost', path: '/' }; });
}

(async () => {
  const ids = { users: [], clubs: [] };
  const save = () => fs.writeFileSync('/tmp/verify-profile-clubs-tab-manifest.json', JSON.stringify(ids, null, 2));
  try {
    const { data: ud, error: ue } = await admin.auth.admin.createUser({
      email: 'profile-clubs-tab@arenas-test.dev', password: PW, email_confirm: true,
      user_metadata: { name: 'Clubs Tab Verify', sports: ['running'] },
    });
    if (ue) throw ue;
    const uid = ud.user.id; ids.users.push(uid); save();
    // Three clubs: member of the first two, coach of the third. Joined in
    // sequence so the bare-route fallback (most recent membership) points at a
    // DIFFERENT club than the first two cards — the exact regression shape.
    const defs = [['Verify Club Alpha', 'member'], ['Verify Club Beta', 'member'], ['Verify Club Gamma', 'coach']];
    const clubs = [];
    for (const [name, role] of defs) {
      const { data: club, error: ce } = await admin.from('clubs').insert({
        name, handle: 'verify-tab-' + Math.random().toString(36).slice(2, 8), sport: 'running', owner_id: uid,
      }).select().single();
      if (ce) throw ce;
      ids.clubs.push(club.id); clubs.push({ id: club.id, name, role }); save();
      const { error: me } = await admin.from('memberships').insert({ user_id: uid, club_id: club.id, role });
      if (me) throw me;
      await new Promise(r => setTimeout(r, 1100)); // distinct created_at ordering
    }

    const browser = await launchBrowser();
    const ctx = await browser.newContext();
    await ctx.addCookies(await login('profile-clubs-tab@arenas-test.dev'));
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1440, height: 1000 });

    for (const target of clubs) {
      await page.goto(BASE + '/profile#clubs', { waitUntil: 'networkidle' });
      await page.evaluate(() => { if (typeof setTab === 'function') setTab('clubs'); });
      const idx = await page.evaluate((nm) => Array.from(document.querySelectorAll('#clubs-list .club-card'))
        .findIndex(c => c.querySelector('.club-name').textContent === nm), target.name);
      ok(idx >= 0, `card rendered for "${target.name}"`);
      await page.evaluate((i) => { document.querySelectorAll('#clubs-list .club-card button')[i].click(); }, idx).catch(() => {});
      await page.waitForURL(/\/clubs\/(member|dashboard)/, { timeout: 20000 });
      await page.waitForLoadState('networkidle');
      const landed = await page.evaluate(() => ({
        path: location.pathname,
        query: location.search,
        loadedClubId: (window.ARENAS_DATA && window.ARENAS_DATA.club && window.ARENAS_DATA.club.id) || null,
      }));
      if (target.role === 'coach') {
        ok(/\/clubs\/dashboard$/.test(landed.path) && landed.query.indexOf('club=' + target.id) !== -1,
          `coach card "${target.name}" opens that club's dashboard`, landed.path + landed.query);
        ok(!landed.loadedClubId || landed.loadedClubId === target.id,
          `dashboard loaded club id matches clicked club`, String(landed.loadedClubId));
      } else {
        ok(landed.path === '/html/clubs/member/' + target.id,
          `member card "${target.name}" URL carries the clicked club id`, landed.path);
        ok(landed.loadedClubId === target.id,
          `loaded page club id === clicked club id ("${target.name}")`, String(landed.loadedClubId));
      }
    }
    await ctx.close(); await browser.close();
  } finally {
    if (ids.clubs.length) { await admin.from('memberships').delete().in('club_id', ids.clubs); await admin.from('clubs').delete().in('id', ids.clubs); }
    for (const id of ids.users) { try { await admin.auth.admin.deleteUser(id); } catch (e) { console.log('cleanup fail', e.message); } }
  }
  console.log(fails ? fails + ' FAILURE(S)' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
