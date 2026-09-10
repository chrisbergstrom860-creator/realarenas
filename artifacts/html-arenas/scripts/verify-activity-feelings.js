// Permanent focused verifier for activity-feeling visibility.
//
// This deliberately does not browse the auth-gated product pages. It first
// inspects their real server payloads, then renders four unauthenticated local
// harness routes with the exact renderer functions extracted from the current
// page sources, plus the real shared activity-card scripts and CSS.
//
// Run only when the current app server has been restarted:
//   node scripts/verify-activity-feelings.js
//
// Live fixtures are manifest-tracked immediately after every create and are
// removed (with direct residue proofs) in finally.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'html');
const MANIFEST_FILE = '/tmp/verify-activity-feelings-manifest.json';
const CAPTURE_FILE = '/tmp/verify-activity-feelings-club-feed.json';
const SCREENSHOT_DIR = path.join(ROOT, 'screenshots');
const PW = 'Feeling-Verify-234!';
const EMAILS = {
  athlete: 'activity-feeling-athlete@arenas-test.dev',
  coach: 'activity-feeling-coach@arenas-test.dev'
};
const CLUB_HANDLE = 'activity-feeling-verifier-club';
const LIVE_BASE = process.env.VERIFY_BASE_URL ||
  (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/html` : '');

let failures = 0;
let cleanupFailures = 0;
let assertions = 0;
function check(label, condition, detail) {
  assertions++;
  console.log((condition ? '  ok  ' : '  FAIL ') + label +
    (!condition && detail ? ' — ' + detail : ''));
  if (!condition) failures++;
}

function saveManifest(manifest) {
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + '\n');
}

function read(name) {
  return fs.readFileSync(path.join(HTML, name), 'utf8');
}

// Extract a named function without copying it into this verifier. The scanner
// understands strings, template literals and comments, so braces in page copy
// cannot truncate the source block.
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`source function not found: ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  let escaped = false;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    const n = source[i + 1];
    if (lineComment) {
      if (c === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (c === '*' && n === '/') { blockComment = false; i++; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && n === '/') { lineComment = true; i++; continue; }
    if (c === '/' && n === '*') { blockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated source function: ${name}`);
}

function pageStyles(source) {
  return Array.from(source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi), m => m[1]).join('\n');
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function parseInjectedData(html) {
  const marker = 'window.ARENAS_DATA = ';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('window.ARENAS_DATA missing from real page');
  const jsonStart = start + marker.length;
  let inString = false;
  let escaped = false;
  let depth = 0;
  for (let i = jsonStart; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{' || c === '[') depth++;
    if (c === '}' || c === ']') depth--;
    if (c === ';' && depth === 0) return JSON.parse(html.slice(jsonStart, i));
  }
  throw new Error('unterminated window.ARENAS_DATA payload');
}

async function login(base, email) {
  const response = await fetch(base + '/auth/login', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password: PW })
  });
  const setCookies = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  if (response.status !== 302 || !setCookies.length) {
    throw new Error(`login failed for ${email}: HTTP ${response.status}`);
  }
  return setCookies.map(c => c.split(';')[0]).join('; ');
}

async function fetchText(url, cookie) {
  const response = await fetch(url, { headers: cookie ? { Cookie: cookie } : {} });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}: ${text.slice(0, 300)}`);
  return text;
}

async function fetchJson(url, cookie) {
  const text = await fetchText(url, cookie);
  try { return JSON.parse(text); }
  catch (err) { throw new Error(`${url}: non-JSON response: ${text.slice(0, 300)}`); }
}

function hasOwnFeeling(value) {
  return value && typeof value === 'object' &&
    Object.prototype.hasOwnProperty.call(value, 'feeling');
}

async function cleanupFixture(admin, manifest) {
  const quietDelete = async (table, build) => {
    try {
      const query = build(admin.from(table).delete());
      const { error } = await query;
      if (error) throw error;
    } catch (err) {
      cleanupFailures++;
      console.log(`  CLEANUP FAIL ${table} — ${err.message}`);
    }
  };

  for (const id of manifest.activities || []) {
    await quietDelete('activities', q => q.eq('id', id));
  }
  for (const edge of manifest.follows || []) {
    await quietDelete('follows', q => q.eq('follower_id', edge.follower_id)
      .eq('following_id', edge.following_id));
  }
  for (const row of manifest.memberships || []) {
    await quietDelete('memberships', q => q.eq('club_id', row.club_id).eq('user_id', row.user_id));
  }
  for (const id of manifest.clubs || []) {
    await quietDelete('clubs', q => q.eq('id', id));
  }
  for (const id of manifest.users || []) {
    // Auth deletion normally cascades profiles. Remove the trigger-created
    // profile explicitly if a previous partial cleanup left it behind.
    await quietDelete('profiles', q => q.eq('id', id));
    try {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error && !/not found/i.test(error.message || '')) throw error;
    } catch (err) {
      cleanupFailures++;
      console.log(`  CLEANUP FAIL auth user ${id} — ${err.message}`);
    }
  }
}

async function proveCleanup(admin, manifest) {
  const proveIdsGone = async (table, ids) => {
    if (!ids.length) return;
    const { data, error } = await admin.from(table).select('id').in('id', ids);
    check(`cleanup proof: ${table} rows gone`, !error && (data || []).length === 0,
      error ? error.message : JSON.stringify(data));
  };
  await proveIdsGone('activities', manifest.activities || []);
  await proveIdsGone('clubs', manifest.clubs || []);
  await proveIdsGone('profiles', manifest.users || []);

  for (const row of manifest.memberships || []) {
    const { data, error } = await admin.from('memberships').select('user_id')
      .eq('club_id', row.club_id).eq('user_id', row.user_id);
    check('cleanup proof: membership gone', !error && (data || []).length === 0,
      error ? error.message : JSON.stringify(data));
  }
  for (const edge of manifest.follows || []) {
    const { data, error } = await admin.from('follows').select('follower_id')
      .eq('follower_id', edge.follower_id).eq('following_id', edge.following_id);
    check('cleanup proof: follow gone', !error && (data || []).length === 0,
      error ? error.message : JSON.stringify(data));
  }
  for (const id of manifest.users || []) {
    const { data } = await admin.auth.admin.getUserById(id);
    const gone = !(data && data.user);
    check('cleanup proof: auth user gone ' + id, gone);
  }
}

function buildHarness(capturedClubPayload) {
  const feedSource = read('arenas-feed.html');
  const ownSource = read('arenas-my-profile.html');
  const visitorSource = read('arenas-athlete-profile.html');
  const clubSource = read('arenas-club-dashboard.html');
  const renderers = {
    feed: extractFunction(feedSource, 'collectActivityItems'),
    own: extractFunction(ownSource, 'renderActivities'),
    visitor: extractFunction(visitorSource, 'activityCard'),
    club: extractFunction(clubSource, 'renderClubFeed')
  };
  const styles = {
    feed: pageStyles(feedSource),
    own: pageStyles(ownSource),
    visitor: pageStyles(visitorSource),
    club: pageStyles(clubSource)
  };
  const fixtures = [
    { id: 'friendly-a', sport: 'running', title: 'Morning hills', feeling: 'strong', notes: 'Steady session' },
    { id: 'friendly-b', sport: 'running', title: 'Recovery loop', feeling: 'easy', notes: null },
    { id: 'edge-null', sport: 'running', title: 'Null control', feeling: null },
    { id: 'edge-unknown', sport: 'running', title: 'Unknown control', feeling: 'private_sentinel' },
    { id: 'edge-prototype', sport: 'running', title: 'Prototype control', feeling: 'toString' }
  ].map((a, i) => ({
    ...a,
    user_id: 'fixture-athlete',
    author: { name: 'Fixture Athlete', profilePublic: true },
    name: 'Fixture Athlete',
    userId: 'fixture-athlete',
    profilePublic: true,
    created_at: new Date(Date.UTC(2025, 0, i + 1)).toISOString(),
    timestamp: new Date(Date.UTC(2025, 0, i + 1)).toISOString()
  }));

  const commonHead = (surface) => `<!doctype html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="stylesheet" href="/source/arenas.css">
    <style>${styles[surface]}</style>
    <style>body{background:#f5f5f3;padding:28px}.harness{max-width:720px;margin:auto}
    .harness-title{font:700 20px Arial;margin:0 0 18px}.post-note-card,.activity-card-item{background:white}</style>
    </head><body><main class="harness"><h1 class="harness-title">${surface} harness</h1>`;
  const commonScripts = `<script>
    window.ARENAS_SPORTS_BY_ID={running:{label:'Running',emoji:'🏃',colors:{bg:'#FFF4E8',text:'#8A4718',border:'#F2C99F'}}};
    window.arenasTimeAgo=function(){return 'Recently'};
    window.athleteLinkAttrs=function(){return ''};
    window.avatarHtml=function(url,name,unused,style){return '<span style="'+style+'">'+String(name||'A').slice(0,1)+'</span>'};
    window.postImageHtml=function(){return ''};
    window.postDeleteButtonHtml=function(){return ''};
    window.clubPostHeaderHtml=function(){return ''};
    function escAct(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
    function escFeedAct(s){return escAct(s)}
    function esc(s){return escAct(s)}
    function likeActivity(){}
    function deleteActivity(){}
    </script>
    <script src="/source/arenas-stat-tiles.js"></script>
    <script src="/source/arenas-activity-card.js"></script>`;

  const pages = {};
  pages['/harness/feed'] = commonHead('feed') + '<div id="surface"></div></main>' + commonScripts +
    `<script>window.ARENAS_DATA={feedActivities:${safeJson(fixtures)}};
    ${renderers.feed}
    collectActivityItems().forEach(function(row){document.getElementById('surface').appendChild(row.el)});
    window.__HARNESS_READY=true;</script></body></html>`;

  pages['/harness/own-profile'] = commonHead('own') +
    '<div id="activities-list"><div id="activities-empty"></div></div></main>' + commonScripts +
    `<script>${renderers.own}
    renderActivities(${safeJson(fixtures)});
    window.__HARNESS_READY=true;</script></body></html>`;

  pages['/harness/visitor-profile'] = commonHead('visitor') +
    '<div id="surface"></div></main>' + commonScripts +
    `<script>var byId=window.ARENAS_SPORTS_BY_ID;
    ${renderers.visitor}
    document.getElementById('surface').innerHTML=${safeJson(fixtures)}.map(activityCard).join('');
    window.__HARNESS_READY=true;</script></body></html>`;

  pages['/harness/club-dashboard'] = commonHead('club') +
    '<div id="cf-feed-list"></div></main>' + commonScripts +
    `<script>
    var cfFilter='all',cfFeedItems=[],cfViewerId=null;
    var avColors=[{bg:'#FEF9C3',c:'#854D0E'}];
    function timeAgo(){return 'Recently'}
    ${renderers.club}
    fetch('/api/club-feed').then(function(r){return r.json()}).then(function(payload){
      cfFeedItems=payload.feed||[];cfViewerId=payload.viewerId||null;renderClubFeed();window.__HARNESS_READY=true;
    });</script></body></html>`;

  return http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }
    if (pathname === '/api/club-feed') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(capturedClubPayload));
    }
    const sourceFiles = {
      '/source/arenas.css': 'arenas.css',
      '/source/arenas-stat-tiles.js': 'arenas-stat-tiles.js',
      '/source/arenas-activity-card.js': 'arenas-activity-card.js'
    };
    if (sourceFiles[pathname]) {
      const ext = path.extname(sourceFiles[pathname]);
      res.writeHead(200, { 'Content-Type': ext === '.css' ? 'text/css' : 'text/javascript' });
      return res.end(read(sourceFiles[pathname]));
    }
    if (pages[pathname]) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(pages[pathname]);
    }
    res.writeHead(404);
    res.end('Not found');
  });
}

async function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

(async () => {
  if (!LIVE_BASE) throw new Error('Set VERIFY_BASE_URL or REPLIT_DEV_DOMAIN');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const manifest = { users: [], clubs: [], memberships: [], follows: [], activities: [] };
  let harness = null;
  let browser = null;

  try {
    // Refuse to collide with residue. A stale manifest is cleaned first; named
    // residue after that is a hard failure rather than deleting unknown data.
    if (fs.existsSync(MANIFEST_FILE)) {
      const stale = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
      if ((stale.users || []).length || (stale.clubs || []).length) {
        await cleanupFixture(admin, stale);
      }
    }
    saveManifest(manifest);
    const { data: listed } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const collision = ((listed && listed.users) || []).find(u => Object.values(EMAILS).includes(u.email));
    if (collision) throw new Error('named fixture user still exists after manifest recovery: ' + collision.email);
    const { data: clubCollision } = await admin.from('clubs').select('id').eq('handle', CLUB_HANDLE);
    if ((clubCollision || []).length) throw new Error('named fixture club exists without manifest ownership');

    async function createUser(email, name, handle) {
      const { data, error } = await admin.auth.admin.createUser({
        email, password: PW, email_confirm: true,
        user_metadata: {
          name, handle, sports: ['running'],
          prefs: { activity_feed_visible: true, show_on_leaderboards: true }
        }
      });
      if (error) throw error;
      manifest.users.push(data.user.id); saveManifest(manifest);
      console.log('MANIFEST user:', data.user.id);
      return data.user.id;
    }

    const athleteId = await createUser(EMAILS.athlete, 'Feeling Athlete', 'feeling_verify_athlete');
    const coachId = await createUser(EMAILS.coach, 'Feeling Coach', 'feeling_verify_coach');

    const { data: club, error: clubError } = await admin.from('clubs').insert({
      name: 'Activity Feeling Verifier Club', handle: CLUB_HANDLE,
      sport: 'running', owner_id: coachId
    }).select('id').single();
    if (clubError) throw clubError;
    manifest.clubs.push(club.id); saveManifest(manifest);
    console.log('MANIFEST club:', club.id);

    for (const row of [
      { club_id: club.id, user_id: coachId, role: 'admin' },
      { club_id: club.id, user_id: athleteId, role: 'member' }
    ]) {
      const { error } = await admin.from('memberships').insert(row);
      if (error) throw error;
      manifest.memberships.push(row); saveManifest(manifest);
      console.log('MANIFEST membership:', row.club_id, row.user_id);
    }

    const follow = { follower_id: coachId, following_id: athleteId };
    const { error: followError } = await admin.from('follows').insert(follow);
    if (followError) throw followError;
    manifest.follows.push(follow); saveManifest(manifest);
    console.log('MANIFEST follow:', follow.follower_id, follow.following_id);

    const { data: activity, error: activityError } = await admin.from('activities').insert({
      user_id: athleteId,
      sport: 'running',
      title: 'Feeling transport sentinel',
      distance: '5 km',
      duration: '00:30:00',
      notes: 'Visibility verifier activity',
      feeling: 'strong',
      date: new Date().toISOString()
    }).select('id').single();
    if (activityError) throw activityError;
    manifest.activities.push(activity.id); saveManifest(manifest);
    console.log('MANIFEST activity:', activity.id);

    const coachCookie = await login(LIVE_BASE, EMAILS.coach);
    const athleteCookie = await login(LIVE_BASE, EMAILS.athlete);

    // Main feed and visitor profile are server-injected JSON, while own profile
    // and club feed are JSON endpoints. All four are read from the REAL server.
    const mainData = parseInjectedData(await fetchText(LIVE_BASE + '/feed', coachCookie));
    const ownData = await fetchJson(LIVE_BASE + '/api/activities/' + athleteId, athleteCookie);
    const visitorData = parseInjectedData(await fetchText(LIVE_BASE + '/athletes/' + athleteId, coachCookie));
    const clubPayload = await fetchJson(LIVE_BASE + '/api/clubs/' + club.id + '/feed', coachCookie);
    fs.writeFileSync(CAPTURE_FILE, JSON.stringify(clubPayload, null, 2) + '\n');

    const mainActivity = (mainData.feedActivities || []).find(a => a.id === activity.id);
    const ownActivity = (ownData.activities || []).find(a => a.id === activity.id);
    const visitorActivity = (visitorData.activities || []).find(a => a.id === activity.id);
    const clubActivity = (clubPayload.feed || []).find(a => a.type === 'activity' && a.id === activity.id);
    check('real main feed JSON preserves feeling', mainActivity && mainActivity.feeling === 'strong',
      JSON.stringify(mainActivity));
    check('real own-profile JSON preserves feeling', ownActivity && ownActivity.feeling === 'strong',
      JSON.stringify(ownActivity));
    check('real visitor-profile JSON preserves feeling', visitorActivity && visitorActivity.feeling === 'strong',
      JSON.stringify(visitorActivity));
    check('real club feed includes sentinel activity', !!clubActivity, JSON.stringify(clubPayload).slice(0, 500));
    check('real club feed strips feeling from sentinel item', clubActivity && !hasOwnFeeling(clubActivity),
      JSON.stringify(clubActivity));
    check('real club feed payload contains no feeling key anywhere',
      !JSON.stringify(clubPayload).includes('"feeling"'), CAPTURE_FILE);

    harness = buildHarness(clubPayload);
    const harnessBase = await listen(harness);
    const chromiumBin = process.env.CHROMIUM_BIN ||
      require('child_process').execSync('command -v chromium || command -v chromium-browser').toString().trim();
    browser = await chromium.launch({
      headless: true,
      executablePath: chromiumBin,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    const routes = [
      ['feed', '/harness/feed', true],
      ['own-profile', '/harness/own-profile', true],
      ['visitor-profile', '/harness/visitor-profile', true],
      ['club-dashboard', '/harness/club-dashboard', false]
    ];
    for (const [name, route, peerSurface] of routes) {
      const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', err => errors.push(String(err)));
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
      await page.goto(harnessBase + route, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.__HARNESS_READY === true);
      const result = await page.evaluate(() => {
        const feelings = Array.from(document.querySelectorAll('.ac-feeling')).map(el => el.textContent.trim());
        const inset = document.querySelector('.ac-title.ac-ins');
        return {
          feelings,
          bodyText: document.body.innerText,
          insetMarginLeft: inset ? getComputedStyle(inset).marginLeft : null,
          insetMarginRight: inset ? getComputedStyle(inset).marginRight : null,
          clubCards: document.querySelectorAll('.cf-card').length
        };
      });
      if (peerSurface) {
        check(`${name}: friendly Strong and Easy day labels render`,
          result.feelings.includes('Feeling: Strong') && result.feelings.includes('Feeling: Easy day'),
          JSON.stringify(result.feelings));
        check(`${name}: null, unknown, and prototype keys produce no feeling output`,
          result.feelings.length === 2, JSON.stringify(result.feelings));
        check(`${name}: no raw stored keys or unknown sentinel appear`,
          !/(Feeling:\s*(strong|easy|private_sentinel|toString))\b/.test(result.bodyText),
          result.bodyText);
      } else {
        check('club dashboard: captured activity cards render', result.clubCards > 0,
          JSON.stringify(result));
        check('club dashboard: no feeling output', result.feelings.length === 0,
          JSON.stringify(result.feelings));
        check('club dashboard: default inset layout remains 14px',
          result.insetMarginLeft === '14px' && result.insetMarginRight === '14px',
          JSON.stringify(result));
      }
      check(`${name}: zero browser errors`, errors.length === 0, errors.join(' | '));
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `verify-activity-feelings-${name}.png`),
        fullPage: true
      });
      await context.close();
    }

    const ignored = require('child_process').spawnSync(
      'git', ['check-ignore', 'screenshots/verify-activity-feelings-feed.png'],
      { cwd: ROOT, encoding: 'utf8' }
    );
    check('screenshots directory is gitignored', ignored.status === 0,
      (ignored.stderr || ignored.stdout || '').trim());
  } catch (err) {
    failures++;
    console.log('  FAIL verifier exception — ' + (err && err.stack || err));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (harness) await new Promise(resolve => harness.close(resolve));
    await cleanupFixture(admin, manifest);
    await proveCleanup(admin, manifest);
  }

  const total = failures + cleanupFailures;
  console.log(total ? `\n${total} FAILURE(S)` : '\nALL ACTIVITY-FEELING CHECKS PASSED');
  console.log('Assertions:', assertions);
  console.log('Manifest:', MANIFEST_FILE);
  console.log('Captured club JSON:', CAPTURE_FILE);
  process.exit(total ? 1 : 0);
})().catch(err => {
  console.error('FATAL', err && err.stack || err);
  process.exit(1);
});