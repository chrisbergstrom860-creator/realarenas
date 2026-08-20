// verify-club-profiles.js — Public club profile: page, banner proxy,
// settings (description + website_url), banner lifecycle.
//
// Contracts proved end-to-end:
//
//   PAGE (GET /clubs/:clubId)
//   ─────────────────────────
//   P1. Raw 404 body byte-identical for logged-in vs logged-out on private club.
//   P2. Raw 404 body byte-identical for logged-in vs logged-out on nonexistent id.
//   P3. ARENAS_DATA.club contains exactly: id, name, sport, city, logo_url,
//       description, website_url, memberCount, banner — nothing else that would
//       leak member identities, events, challenges, posts, activity,
//       viewerState, join state, management flags, or the raw banner_path.
//   P4. Normalized website_url is included in ARENAS_DATA.club.website_url
//       and is rendered safely in HTML (no XSS, no raw < / > / & in data).
//
//   BANNER PROXY (GET /api/clubs/:clubId/banner)
//   ─────────────────────────────────────────────
//   B1. Public club with banner → image/webp bytes; no auth required.
//   B2. Public club with NO banner → same 404 JSON as private/nonexistent.
//   B3. Private club → 404 JSON byte-identical to nonexistent id.
//   B4. Nonexistent id → 404 JSON byte-identical to private club.
//
//   SETTINGS (PATCH /api/clubs/:clubId/settings)
//   ─────────────────────────────────────────────
//   S1. Coach PATCH → 404 Club not found (admin-only, zero-leak).
//   S2. Owner-id-only (not a member) → 404 Club not found.
//   S3. description max 500 accepted; 501 chars → 400 description_too_long.
//   S4. website_url acceptance matrix:
//       accept  https://example.com
//       accept  https://sub.example.com/path?q=1
//       reject  http://example.com       (not https)
//       reject  //example.com            (protocol-relative)
//       reject  javascript:alert(1)
//       reject  data:text/html,<h1>x</h1>
//       reject  https://user:pass@example.com   (credentials)
//       reject  '' empty after trim       → clears (null), not rejected
//       reject  malformed-url-no-protocol
//       reject  > 2048 chars
//       reject  contains a control character (U+0000)
//   S5. Blank website_url clears (null) cleanly.
//   S6. Updated values round-trip through page ARENAS_DATA.
//
//   BANNER LIFECYCLE (POST/DELETE /api/clubs/:clubId/banner)
//   ─────────────────────────────────────────────────────────
//   L1. Coach POST → 404 (admin-only denial, before multer).
//   L2. Admin POST with valid webp → {success:true, banner:<version>};
//       object lands in private bucket at clubs/{clubId}/{ts}.webp.
//   L3. Replacement POST: old object gone, new object present.
//   L4. Pointer-write failure after storage succeeds: new object removed,
//       previous pointer/object preserved (local Supabase fault proxy).
//   L5. Public club page HTML and ARENAS_DATA never expose banner_path.
//   L5. DELETE clears pointer; object gone; no-banner DELETE is idempotent.
//
//   DELETION OBJECT LIFECYCLE
//   ──────────────────────────
//   D1. Club deletion also deletes banner object (via destroyClub).
//   D2. Account deletion with sole-member club also deletes banner object.
//   D3. Stripe-aborted club deletion preserves banner object.
//   D4. No-banner club deletion succeeds (no false 404 on missing object).
//
// Prerequisites: SQL public-club-profiles.sql must be applied
//   (clubs.website_url text, clubs.banner_path text, bucket club-banners).
//
// Run: set -a && . ./.env && node artifacts/html-arenas/scripts/verify-club-profiles.js
/* eslint-disable no-console */

const { createClient } = require('@supabase/supabase-js');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const REAL_SUPABASE_URL = process.env.SUPABASE_URL;
const DOMAIN = process.env.REPLIT_DEV_DOMAIN;
const BASE_URL = `https://${DOMAIN}/html`;
const PW = 'ProfileVerify!789';
const EMAILS = {
  owner:  'clubprof-owner@arenas-test.dev',
  coach:  'clubprof-coach@arenas-test.dev',
  outsider: 'clubprof-outsider@arenas-test.dev'
};
const CLUB_BANNER_BUCKET = 'club-banners';
const EXTRA_EMAILS = {
  signupOk: 'clubprof-signup-ok@arenas-test.dev',
  signupReject: 'clubprof-signup-reject@arenas-test.dev'
};

let failures = 0;
const check = (name, ok, detail) => {
  if (ok) {
    console.log('  ok  ' + name);
  } else {
    failures++;
    const d = detail === undefined ? '' : (' — ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400));
    console.log('FAIL  ' + name + d);
  }
};

// Minimal valid 1×1 WebP binary, independently decoded by the installed Sharp.
const WEBP = Buffer.from(
  'UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoQAAQAAUAiJaACdLoB+AADsAD++FC//5T98wA+YAf8p+/+WffH8nCAAAA=',
  'base64'
);
// Minimal valid PNG (1×1, for format-reject test)
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452' +
  '00000001000000010806000000' +
  '1f15c4890000000d4944415478da63fc' +
  'ffff3f030005fe02fea72d1ea10000000049454e44ae426082',
  'hex'
);

const users = {};
let clubId = null;
let privClubId = null;
let bannerPath = null; // tracks the active banner object path
const extraClubIds = new Set();
const extraBannerPaths = new Set();
const extraUserIds = new Set();
let pointerFaultHarness = null;

async function loginAt(k, baseUrl) {
  const r = await fetch(baseUrl + '/auth/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(EMAILS[k])}&password=${encodeURIComponent(PW)}`
  });
  const setC = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  const raw = (setC || []).filter(Boolean).map(c => c.split(';')[0]);
  if (!raw.length) throw new Error('login failed for ' + k);
  return raw.join('; ');
}

async function login(k) {
  users[k].cookie = await loginAt(k, BASE_URL);
}

async function apiJson(k, method, path, body) {
  const isAnon = k === null;
  const r = await fetch(BASE_URL + '/api' + path, {
    method,
    headers: {
      ...(isAnon ? {} : { Cookie: users[k].cookie }),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, body: json, raw: text, headers: r.headers };
}

async function uploadBanner(k, clubIdTarget, buffer, contentType, baseUrl = BASE_URL, cookie = users[k].cookie) {
  const form = new FormData();
  form.append('avatar', new Blob([buffer], { type: contentType }), 'banner.webp');
  const r = await fetch(baseUrl + '/api/clubs/' + clubIdTarget + '/banner', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, body: json, raw: text };
}

function startPointerFaultHarness(targetClubId) {
  return new Promise((resolve, reject) => {
    const proxy = http.createServer(async (req, res) => {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = chunks.length ? Buffer.concat(chunks) : null;
        const target = new URL(req.url, REAL_SUPABASE_URL);
        let injectFailure = req.method === 'PATCH' &&
          target.pathname === '/rest/v1/clubs' &&
          target.searchParams.get('id') === 'eq.' + targetClubId;
        if (injectFailure && body) {
          try {
            const parsed = JSON.parse(body.toString('utf8'));
            injectFailure = typeof parsed.banner_path === 'string' && parsed.banner_path.length > 0;
          } catch (err) {
            injectFailure = false;
          }
        }
        if (injectFailure) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ code: 'FI001', message: 'Injected club banner pointer failure' }));
        }

        const headers = { ...req.headers };
        delete headers.host;
        delete headers.connection;
        delete headers['content-length'];
        const upstream = await fetch(target, {
          method: req.method,
          headers,
          body: body && body.length ? body : undefined
        });
        const outHeaders = {};
        upstream.headers.forEach((value, key) => {
          if (!['connection', 'content-encoding', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) {
            outHeaders[key] = value;
          }
        });
        res.writeHead(upstream.status, outHeaders);
        return res.end(Buffer.from(await upstream.arrayBuffer()));
      } catch (err) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'proxy_failed', message: err.message }));
      }
    });

    proxy.listen(0, '127.0.0.1', () => {
      const proxyPort = proxy.address().port;
      const appPort = 19000 + (process.pid % 1000);
      const env = {
        ...process.env,
        PORT: String(appPort),
        BASE_PATH: '/html',
        SUPABASE_URL: 'http://127.0.0.1:' + proxyPort
      };
      const proc = spawn('node', ['server.js'], {
        cwd: path.join(__dirname, '..'),
        env
      });
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill('SIGTERM');
        proxy.close();
        reject(new Error('pointer-fault server never listened'));
      }, 30000);
      proc.stdout.on('data', (d) => {
        if (settled || !String(d).includes('Server listening')) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          base: 'http://127.0.0.1:' + appPort + '/html',
          async close() {
            proc.kill('SIGTERM');
            await new Promise((done) => proxy.close(done));
          }
        });
      });
      proc.on('exit', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        proxy.close();
        reject(new Error('pointer-fault server exited ' + code));
      });
    });
    proxy.on('error', reject);
  });
}

async function deleteBanner(k, clubIdTarget) {
  return apiJson(k, 'DELETE', '/clubs/' + clubIdTarget + '/banner');
}

async function objectExists(path) {
  if (!path) return false;
  const dir = path.slice(0, path.lastIndexOf('/'));
  const name = path.slice(path.lastIndexOf('/') + 1);
  const { data } = await admin.storage.from(CLUB_BANNER_BUCKET).list(dir);
  return !!(data || []).find(f => f.name === name);
}

function extractArenasData(html) {
  const match = html.match(/window\.ARENAS_DATA\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (err) {
    return null;
  }
}

async function clubBannerObjectNames(id) {
  const { data } = await admin.storage.from(CLUB_BANNER_BUCKET).list('clubs/' + id);
  return (data || []).map(f => f.name).sort();
}

async function cleanup() {
  if (pointerFaultHarness) {
    await pointerFaultHarness.close().catch(() => {});
    pointerFaultHarness = null;
  }
  // Remove any banner objects we may have left behind
  if (bannerPath) {
    await admin.storage.from(CLUB_BANNER_BUCKET).remove([bannerPath]).catch(() => {});
  }
  if (extraBannerPaths.size) {
    await admin.storage.from(CLUB_BANNER_BUCKET).remove([...extraBannerPaths]).catch(() => {});
  }
  // Also sweep the whole clubs/ prefix for test clubs
  if (clubId) {
    const { data: objs } = await admin.storage.from(CLUB_BANNER_BUCKET).list('clubs/' + clubId);
    if (objs && objs.length) {
      await admin.storage.from(CLUB_BANNER_BUCKET).remove(objs.map(o => 'clubs/' + clubId + '/' + o.name)).catch(() => {});
    }
    await admin.from('memberships').delete().eq('club_id', clubId);
    await admin.from('clubs').delete().eq('id', clubId);
  }
  if (privClubId) {
    const { data: objs2 } = await admin.storage.from(CLUB_BANNER_BUCKET).list('clubs/' + privClubId);
    if (objs2 && objs2.length) {
      await admin.storage.from(CLUB_BANNER_BUCKET).remove(objs2.map(o => 'clubs/' + privClubId + '/' + o.name)).catch(() => {});
    }
    await admin.from('memberships').delete().eq('club_id', privClubId);
    await admin.from('clubs').delete().eq('id', privClubId);
  }
  for (const id of extraClubIds) {
    const { data: objs } = await admin.storage.from(CLUB_BANNER_BUCKET).list('clubs/' + id);
    if (objs && objs.length) {
      await admin.storage.from(CLUB_BANNER_BUCKET).remove(objs.map(o => 'clubs/' + id + '/' + o.name)).catch(() => {});
    }
    await admin.from('subscriptions').delete().eq('owner_type', 'club').eq('owner_id', id);
    await admin.from('club_join_requests').delete().eq('club_id', id);
    await admin.from('memberships').delete().eq('club_id', id);
    await admin.from('clubs').delete().eq('id', id);
  }
  for (const k of Object.keys(EMAILS)) {
    if (!users[k] || !users[k].id) continue;
    await admin.from('notifications').delete().eq('user_id', users[k].id);
    await admin.auth.admin.deleteUser(users[k].id).catch(() => {});
  }
  for (const id of extraUserIds) {
    await admin.from('notifications').delete().eq('user_id', id);
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
}

async function removeFixtureClub(id) {
  if (!id) return;
  const { data: objects } = await admin.storage.from(CLUB_BANNER_BUCKET).list('clubs/' + id);
  if (objects && objects.length) {
    await admin.storage.from(CLUB_BANNER_BUCKET)
      .remove(objects.map(o => 'clubs/' + id + '/' + o.name)).catch(() => {});
  }
  await admin.from('subscriptions').delete().eq('owner_type', 'club').eq('owner_id', id);
  await admin.from('club_join_requests').delete().eq('club_id', id);
  await admin.from('memberships').delete().eq('club_id', id);
  await admin.from('clubs').delete().eq('id', id);
}

async function precleanStaleFixtures() {
  const allEmails = [...Object.values(EMAILS), ...Object.values(EXTRA_EMAILS)];
  const handles = [
    'clubprofpublic', 'clubprofpriv', 'clubprofnobanner', 'clubprofd4',
    'clubprofd3', 'clubprofd2', 'clubprofcreate500', 'clubprofcreate501',
    'clubprofsignup500', 'clubprofsignup501'
  ];
  const { data: all } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const staleUsers = ((all && all.users) || []).filter(u => allEmails.includes(u.email));
  const staleUserIds = staleUsers.map(u => u.id);
  const clubIds = new Set();
  const { data: byHandle } = await admin.from('clubs').select('id').in('handle', handles);
  (byHandle || []).forEach(c => clubIds.add(c.id));
  if (staleUserIds.length) {
    const { data: byOwner } = await admin.from('clubs').select('id').in('owner_id', staleUserIds);
    (byOwner || []).forEach(c => clubIds.add(c.id));
  }
  for (const id of clubIds) await removeFixtureClub(id);
  for (const user of staleUsers) await admin.auth.admin.deleteUser(user.id).catch(() => {});
}

// ── Schema guard ──────────────────────────────────────────────────────────────
// Verify columns exist before running any live checks.
async function schemaReady() {
  const { data, error } = await admin.from('clubs').select('website_url, banner_path').limit(1);
  if (error && /website_url|banner_path|column/.test(error.message || '')) {
    console.log('\nSKIP: clubs.website_url / clubs.banner_path columns do not exist yet.');
    console.log('      Apply artifacts/html-arenas/scripts/sql/public-club-profiles.sql first.\n');
    return false;
  }
  return true;
}

(async () => {
  if (!(await schemaReady())) {
    process.exit(0);
  }

  try {
    // ── Seed users ────────────────────────────────────────────────────────────
    await precleanStaleFixtures();
    for (const [k, email] of Object.entries(EMAILS)) {
      const { data, error } = await admin.auth.admin.createUser({
        email, password: PW, email_confirm: true,
        user_metadata: { name: 'ClubProf ' + k, handle: 'clubprof_' + k, sports: ['running'] }
      });
      if (error) throw new Error('createUser ' + k + ': ' + error.message);
      users[k] = { id: data.user.id };
    }
    for (const k of Object.keys(EMAILS)) await login(k);
    console.log('MANIFEST users:', JSON.stringify(
      Object.fromEntries(Object.entries(users).map(([k, v]) => [k, v.id]))
    ));

    // ── Seed clubs ────────────────────────────────────────────────────────────
    // Public club (owner + coach)
    const { data: club, error: cErr } = await admin.from('clubs')
      .insert({ name: 'ClubProf Public', handle: 'clubprofpublic', sport: 'running', city: 'Oslo', owner_id: users.owner.id, visibility: 'public' })
      .select().single();
    if (cErr) throw new Error('club insert: ' + cErr.message);
    clubId = club.id;
    await admin.from('memberships').insert([
      { club_id: clubId, user_id: users.owner.id, role: 'admin' },
      { club_id: clubId, user_id: users.coach.id, role: 'coach' }
    ]);

    // Private club (owner only, for zero-leak tests)
    const { data: priv, error: pErr } = await admin.from('clubs')
      .insert({ name: 'ClubProf Private', handle: 'clubprofpriv', sport: 'cycling', city: 'Bergen', owner_id: users.owner.id, visibility: 'private' })
      .select().single();
    if (pErr) throw new Error('priv club insert: ' + pErr.message);
    privClubId = priv.id;
    await admin.from('memberships').insert({ club_id: privClubId, user_id: users.owner.id, role: 'admin' });

    const fakeId = '00000000-0000-4000-8000-000000000999';
    const CLUB_NOT_FOUND_RAW = JSON.stringify({ error: 'Club not found' });

    // ── P1 & P2. Page raw 404 parity (logged-in vs logged-out) ───────────────
    // Private club
    const privPageLoggedIn  = await fetch(BASE_URL + '/clubs/' + privClubId, { headers: { Cookie: users.outsider.cookie } });
    const privPageLoggedOut = await fetch(BASE_URL + '/clubs/' + privClubId);
    const privInBody  = await privPageLoggedIn.text();
    const privOutBody = await privPageLoggedOut.text();
    check('P1: private page logged-in → 404', privPageLoggedIn.status === 404, privPageLoggedIn.status);
    check('P1: private page logged-out → 404', privPageLoggedOut.status === 404, privPageLoggedOut.status);
    check('P1: private page 404 body byte-identical logged-in vs logged-out', privInBody === privOutBody, { in: privInBody.slice(0, 120), out: privOutBody.slice(0, 120) });
    check('P1: private page 404 body is CLUB_NOT_FOUND', privInBody === CLUB_NOT_FOUND_RAW, privInBody.slice(0, 120));

    // Nonexistent id
    const fakePageLoggedIn  = await fetch(BASE_URL + '/clubs/' + fakeId, { headers: { Cookie: users.outsider.cookie } });
    const fakePageLoggedOut = await fetch(BASE_URL + '/clubs/' + fakeId);
    const fakeInBody  = await fakePageLoggedIn.text();
    const fakeOutBody = await fakePageLoggedOut.text();
    check('P2: nonexistent page logged-in → 404', fakePageLoggedIn.status === 404, fakePageLoggedIn.status);
    check('P2: nonexistent page logged-out → 404', fakePageLoggedOut.status === 404, fakePageLoggedOut.status);
    check('P2: nonexistent 404 body byte-identical logged-in vs logged-out', fakeInBody === fakeOutBody, { in: fakeInBody.slice(0, 120), out: fakeOutBody.slice(0, 120) });

    // ── P3. ARENAS_DATA.club narrow payload ───────────────────────────────────
    // Set description + website so they appear in payload
    await admin.from('clubs').update({ description: 'Test club description', website_url: 'https://clubprof.example.com' }).eq('id', clubId);

    const profilePage = await fetch(BASE_URL + '/clubs/' + clubId, { headers: { Cookie: users.outsider.cookie } });
    check('P3: public club page → 200', profilePage.status === 200, profilePage.status);
    const profileHtml = await profilePage.text();
    const dataMatch = profileHtml.match(/window\.ARENAS_DATA\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
    let pageData = {};
    try { pageData = JSON.parse(dataMatch[1]); } catch (e) { check('P3: ARENAS_DATA parseable', false, e.message); }

    const c = pageData.club || {};
    // Required fields
    check('P3: club.id present', typeof c.id === 'string' && c.id === clubId, c.id);
    check('P3: club.name present', c.name === 'ClubProf Public', c.name);
    check('P3: club.sport present', c.sport === 'running', c.sport);
    check('P3: club.city present', c.city === 'Oslo', c.city);
    check('P3: club.description present', c.description === 'Test club description', c.description);
    check('P3: club.website_url present', c.website_url === 'https://clubprof.example.com/', c.website_url);
    check('P3: club.memberCount present (number)', typeof c.memberCount === 'number', c.memberCount);
    check('P3: club.logo_url present (null or string)', c.logo_url === null || typeof c.logo_url === 'string', c.logo_url);
    check('P3: club.banner field present (null or string)', 'banner' in c, Object.keys(c));
    const allowedClubKeys = [
      'banner', 'city', 'description', 'id', 'logo_url',
      'memberCount', 'name', 'sport', 'website_url'
    ];
    check(
      'P3: club payload has the exact allowlisted key set',
      JSON.stringify(Object.keys(c).sort()) === JSON.stringify(allowedClubKeys),
      Object.keys(c).sort()
    );

    // Forbidden fields — must NOT appear in club object
    const FORBIDDEN = ['banner_path', 'owner_id', 'members', 'events', 'challenges',
      'posts', 'activities', 'viewerState', 'joinState', 'isManager', 'isAdmin',
      'isCoach', 'canManage', 'management'];
    for (const f of FORBIDDEN) {
      check('P3: club payload does NOT contain ' + f, !(f in c), JSON.stringify(c).slice(0, 300));
    }

    // Top-level page data must not contain raw club data beyond the narrow contract
    check('P3: top-level pageData has no joinRequests', !pageData.joinRequests, Object.keys(pageData));
    check('P3: top-level pageData has no memberList', !pageData.memberList, Object.keys(pageData));
    check('P3: ARENAS_DATA top-level has exactly club', JSON.stringify(Object.keys(pageData).sort()) === '["club"]', Object.keys(pageData));

    // ── P4. website_url rendered safely in HTML ────────────────────────────────
    // The URL is trusted (we stored it), but the page must not create XSS vectors.
    // Set a URL with characters that require HTML-escaping and verify they escape.
    await admin.from('clubs').update({ website_url: 'https://example.com/?a=1&b=<script>' }).eq('id', clubId);
    const profilePage2 = await fetch(BASE_URL + '/clubs/' + clubId, { headers: { Cookie: users.outsider.cookie } });
    const profileHtml2 = await profilePage2.text();
    // The raw unescaped string must NOT appear outside the ARENAS_DATA JSON block
    const withoutScript = profileHtml2.replace(/window\.ARENAS_DATA\s*=\s*\{[\s\S]*?\};\s*<\/script>/, '');
    check('P4: website_url with <> in href does not produce unescaped < in rendered HTML (outside data block)',
      !withoutScript.includes('<script>') || !withoutScript.includes('https://example.com/?a=1&b=<script>'),
      'raw XSS string found outside ARENAS_DATA block'
    );
    // Restore clean URL
    await admin.from('clubs').update({ website_url: 'https://clubprof.example.com' }).eq('id', clubId);

    // ── S1. Settings gate: coach denied ───────────────────────────────────────
    let r = await apiJson('coach', 'PATCH', '/clubs/' + clubId + '/settings', { website_url: 'https://coach.example.com' });
    check('S1: coach PATCH settings → 404 Club not found', r.status === 404 && r.raw === CLUB_NOT_FOUND_RAW, r);

    // ── S2. Owner-id-only (outsider) denied ───────────────────────────────────
    // outsider has no membership at all
    r = await apiJson('outsider', 'PATCH', '/clubs/' + clubId + '/settings', { website_url: 'https://out.example.com' });
    check('S2: outsider PATCH settings → 404 Club not found', r.status === 404 && r.raw === CLUB_NOT_FOUND_RAW, r);

    // ── S3. description length boundary ───────────────────────────────────────
    const desc500 = 'A'.repeat(500);
    r = await apiJson('owner', 'PATCH', '/clubs/' + clubId + '/settings', { description: desc500 });
    check('S3: description exactly 500 chars accepted', r.status === 200, r);
    const desc501 = 'A'.repeat(501);
    r = await apiJson('owner', 'PATCH', '/clubs/' + clubId + '/settings', { description: desc501 });
    check('S3: description 501 chars → 400 description_too_long', r.status === 400 && r.body && r.body.error === 'description_too_long', r);

    // The same boundary must hold at BOTH creation routes, not only settings.
    r = await apiJson('owner', 'POST', '/clubs/create', {
      name: 'ClubProf Create Reject', handle: 'clubprofcreate501',
      sport: 'running', city: 'Oslo', description: 'C'.repeat(501)
    });
    const { data: unexpectedApiClub } = await admin.from('clubs')
      .select('id').eq('handle', 'clubprofcreate501').maybeSingle();
    if (unexpectedApiClub) extraClubIds.add(unexpectedApiClub.id);
    check('S3-create-api: 501-char description rejected before club creation', r.status === 400 && r.body && r.body.error === 'description_too_long', r);
    if (unexpectedApiClub) await removeFixtureClub(unexpectedApiClub.id);
    r = await apiJson('owner', 'POST', '/clubs/create', {
      name: 'ClubProf Create 500', handle: 'clubprofcreate500',
      sport: 'running', city: 'Oslo', description: 'C'.repeat(500)
    });
    const apiCreatedId = ((r.body && r.body.redirect) || '').split('club=')[1];
    if (apiCreatedId) extraClubIds.add(apiCreatedId);
    const { data: apiCreated } = apiCreatedId
      ? await admin.from('clubs').select('description').eq('id', apiCreatedId).maybeSingle()
      : { data: null };
    check('S3-create-api: 500-char description accepted and stored', r.status === 200 && apiCreated && apiCreated.description.length === 500, { status: r.status, body: r.body });
    if (apiCreatedId) await removeFixtureClub(apiCreatedId);

    const signupClub = (fields) => fetch(BASE_URL + '/auth/signup-club', {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString()
    });
    let signupResult = await signupClub({
      email: EXTRA_EMAILS.signupReject, password: PW, name: 'ClubProf Signup Reject',
      club_name: 'ClubProf Signup Reject', handle: 'clubprofsignup501',
      sport: 'running', city: 'Oslo', description: 'D'.repeat(501)
    });
    check('S3-create-signup: 501-char description rejected before account creation',
      signupResult.status === 302 && /error=signup/.test(signupResult.headers.get('location') || ''),
      { status: signupResult.status, location: signupResult.headers.get('location') });
    const { data: usersAfterReject } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const rejectedSignupUser = ((usersAfterReject && usersAfterReject.users) || [])
      .find(u => u.email === EXTRA_EMAILS.signupReject);
    if (rejectedSignupUser) extraUserIds.add(rejectedSignupUser.id);
    const { data: unexpectedSignupClub } = await admin.from('clubs')
      .select('id, owner_id').eq('handle', 'clubprofsignup501').maybeSingle();
    if (unexpectedSignupClub) {
      extraClubIds.add(unexpectedSignupClub.id);
      extraUserIds.add(unexpectedSignupClub.owner_id);
    }
    check('S3-create-signup: rejected description creates no auth user',
      !rejectedSignupUser && !unexpectedSignupClub);
    if (unexpectedSignupClub) await removeFixtureClub(unexpectedSignupClub.id);

    signupResult = await signupClub({
      email: EXTRA_EMAILS.signupOk, password: PW, name: 'ClubProf Signup OK',
      club_name: 'ClubProf Signup 500', handle: 'clubprofsignup500',
      sport: 'running', city: 'Oslo', description: 'D'.repeat(500)
    });
    const { data: signupCreated } = await admin.from('clubs')
      .select('id, owner_id, description').eq('handle', 'clubprofsignup500').maybeSingle();
    const { data: usersAfterSignup } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const acceptedSignupUser = ((usersAfterSignup && usersAfterSignup.users) || [])
      .find(u => u.email === EXTRA_EMAILS.signupOk);
    if (acceptedSignupUser) extraUserIds.add(acceptedSignupUser.id);
    if (signupCreated) {
      extraClubIds.add(signupCreated.id);
      extraUserIds.add(signupCreated.owner_id);
    }
    check('S3-create-signup: 500-char description accepted and stored',
      signupResult.status === 302 && !/error=/.test(signupResult.headers.get('location') || '') &&
      signupCreated && signupCreated.description.length === 500,
      { status: signupResult.status, location: signupResult.headers.get('location') });

    // ── S4. website_url acceptance matrix ─────────────────────────────────────
    const WEB_ACCEPT = [
      ['https://example.com',             'https://example.com/'],
      ['https://sub.example.com/path?q=1','https://sub.example.com/path?q=1']
    ];
    const WEB_REJECT = [
      'http://example.com',
      '//example.com',
      'javascript:alert(1)',
      'data:text/html,<h1>x</h1>',
      'https://user:pass@example.com',
      'malformed-url-no-protocol',
      'A'.repeat(2049),
      'https://example.com\u0000end'
    ];

    for (const [input, expected] of WEB_ACCEPT) {
      r = await apiJson('owner', 'PATCH', '/clubs/' + clubId + '/settings', { website_url: input });
      check('S4: accept ' + input.slice(0, 60), r.status === 200 && r.body && r.body.website_url === expected, r);
    }
    for (const input of WEB_REJECT) {
      r = await apiJson('owner', 'PATCH', '/clubs/' + clubId + '/settings', { website_url: input });
      check('S4: reject ' + input.slice(0, 60), r.status === 400 && r.body && r.body.error === 'invalid_website', { status: r.status, error: r.body && r.body.error });
    }

    // ── S5. Blank website_url clears to null ──────────────────────────────────
    // First set a value
    await admin.from('clubs').update({ website_url: 'https://clubprof.example.com' }).eq('id', clubId);
    r = await apiJson('owner', 'PATCH', '/clubs/' + clubId + '/settings', { website_url: '' });
    check('S5: blank website_url clears → 200', r.status === 200, r);
    check('S5: returned website_url is null after clear', r.body && r.body.website_url === null, r.body && r.body.website_url);
    const { data: afterClear } = await admin.from('clubs').select('website_url').eq('id', clubId).maybeSingle();
    check('S5: DB website_url null after clear', afterClear && afterClear.website_url === null, afterClear);

    // ── S6. Round-trip through page ARENAS_DATA ───────────────────────────────
    await apiJson('owner', 'PATCH', '/clubs/' + clubId + '/settings', { description: 'Round-trip desc', website_url: 'https://roundtrip.example.com' });
    const rtPage = await fetch(BASE_URL + '/clubs/' + clubId, { headers: { Cookie: users.outsider.cookie } });
    const rtHtml = await rtPage.text();
    const rtMatch = rtHtml.match(/window\.ARENAS_DATA\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
    let rtData = {};
    try { rtData = JSON.parse(rtMatch[1]); } catch (e) {}
    check('S6: description round-trips via page', rtData.club && rtData.club.description === 'Round-trip desc', rtData.club && rtData.club.description);
    check('S6: website_url round-trips via page (normalized)', rtData.club && rtData.club.website_url === 'https://roundtrip.example.com/', rtData.club && rtData.club.website_url);

    // ── L1. Banner: coach POST → 404 (admin-only) ─────────────────────────────
    const coachBannerR = await uploadBanner('coach', clubId, WEBP, 'image/webp');
    check('L1: coach POST banner → 404 Club not found', coachBannerR.status === 404 && coachBannerR.raw === CLUB_NOT_FOUND_RAW, coachBannerR);

    // Also verify outsider (non-member) gets same 404
    const outBannerR = await uploadBanner('outsider', clubId, WEBP, 'image/webp');
    check('L1: outsider POST banner → 404 byte-identical to coach denial', outBannerR.status === 404 && outBannerR.raw === coachBannerR.raw, outBannerR);

    // ── L2. Admin POST → success; object in private bucket ────────────────────
    const upload1 = await uploadBanner('owner', clubId, WEBP, 'image/webp');
    check('L2: admin POST banner → {success, banner}', upload1.status === 200 && upload1.body && upload1.body.success && upload1.body.banner, upload1);
    // Read pointer from DB
    const { data: afterUpload1 } = await admin.from('clubs').select('banner_path').eq('id', clubId).maybeSingle();
    const path1 = afterUpload1 && afterUpload1.banner_path;
    check('L2: banner_path stored in DB', typeof path1 === 'string' && path1.startsWith('clubs/' + clubId + '/'), path1);
    check('L2: object exists in private bucket', await objectExists(path1), path1);
    bannerPath = path1;

    // The proxy now serves the image
    const bannerProxy1 = await fetch(BASE_URL + '/api/clubs/' + clubId + '/banner');
    check('L2: banner proxy returns image/webp', bannerProxy1.status === 200 && (bannerProxy1.headers.get('content-type') || '').includes('webp'), { status: bannerProxy1.status, ct: bannerProxy1.headers.get('content-type') });

    // ── B1. Banner proxy: public+banner → image/webp (no auth required) ───────
    // (Already proven by L2 above — banner proxy needs no cookie)

    // ── B2. Banner proxy: public + NO banner → 404 JSON ──────────────────────
    const { data: noBannerClub } = await admin.from('clubs')
      .insert({ name: 'ClubProf NoBanner', handle: 'clubprofnobanner', sport: 'running', city: 'Oslo', owner_id: users.owner.id, visibility: 'public' })
      .select().single();
    // Track for cleanup
    const noBannerClubId = noBannerClub.id;
    extraClubIds.add(noBannerClubId);
    const proxyNoBanner = await fetch(BASE_URL + '/api/clubs/' + noBannerClubId + '/banner');
    const proxyNoBannerBody = await proxyNoBanner.text();
    check('B2: public + no banner → 404', proxyNoBanner.status === 404, proxyNoBanner.status);
    check('B2: no-banner 404 body = CLUB_NOT_FOUND', proxyNoBannerBody === CLUB_NOT_FOUND_RAW, proxyNoBannerBody.slice(0, 120));
    // Clean up immediately
    await admin.from('clubs').delete().eq('id', noBannerClubId);

    // ── B3 & B4. Banner proxy: private/nonexistent byte-identical ─────────────
    const proxyPriv = await fetch(BASE_URL + '/api/clubs/' + privClubId + '/banner');
    const proxyPrivLoggedIn = await fetch(BASE_URL + '/api/clubs/' + privClubId + '/banner', {
      headers: { Cookie: users.outsider.cookie }
    });
    const proxyFake = await fetch(BASE_URL + '/api/clubs/' + fakeId + '/banner');
    const proxyPrivBody = await proxyPriv.text();
    const proxyPrivLoggedInBody = await proxyPrivLoggedIn.text();
    const proxyFakeBody = await proxyFake.text();
    check('B3: private club banner proxy → 404', proxyPriv.status === 404, proxyPriv.status);
    check('B3: private banner stays hidden from logged-in visitor',
      proxyPrivLoggedIn.status === 404 && proxyPrivLoggedInBody === proxyPrivBody,
      { status: proxyPrivLoggedIn.status, body: proxyPrivLoggedInBody });
    check('B4: nonexistent club banner proxy → 404', proxyFake.status === 404, proxyFake.status);
    check('B3+B4: private vs nonexistent banner proxy byte-identical', proxyPrivBody === proxyFakeBody && proxyPrivBody === CLUB_NOT_FOUND_RAW,
      { priv: proxyPrivBody.slice(0, 120), fake: proxyFakeBody.slice(0, 120) });

    // ── L3. Replacement: old object gone, new present ─────────────────────────
    const upload2 = await uploadBanner('owner', clubId, WEBP, 'image/webp');
    check('L3: second upload succeeds', upload2.status === 200 && upload2.body && upload2.body.success, upload2);
    const { data: afterUpload2 } = await admin.from('clubs').select('banner_path').eq('id', clubId).maybeSingle();
    const path2 = afterUpload2 && afterUpload2.banner_path;
    check('L3: banner_path updated to new object', path2 !== path1 && typeof path2 === 'string', { path1, path2 });
    check('L3: new object exists', await objectExists(path2), path2);
    check('L3: old object removed', !(await objectExists(path1)), path1);
    bannerPath = path2;

    const publicPageWithBanner = await fetch(BASE_URL + '/clubs/' + clubId);
    const publicPageWithBannerHtml = await publicPageWithBanner.text();
    const publicPageWithBannerData = extractArenasData(publicPageWithBannerHtml);
    const publicBannerPayloadValid = publicPageWithBanner.ok &&
      publicPageWithBannerData &&
      publicPageWithBannerData.club &&
      typeof publicPageWithBannerData.club === 'object';
    check('L5: public page with a banner returns a parseable public payload',
      publicBannerPayloadValid,
      { status: publicPageWithBanner.status, data: publicPageWithBannerData });
    check('L5: post-upload public payload retains the exact allowlisted key set',
      publicBannerPayloadValid &&
      JSON.stringify(Object.keys(publicPageWithBannerData.club).sort()) === JSON.stringify(allowedClubKeys),
      publicBannerPayloadValid ? Object.keys(publicPageWithBannerData.club).sort() : null);
    check('L5: stored banner_path is absent from public served HTML',
      publicBannerPayloadValid &&
      !publicPageWithBannerHtml.includes(path2) &&
      !publicPageWithBannerHtml.includes('banner_path'));
    check('L5: stored banner_path is absent from public ARENAS_DATA payload',
      publicBannerPayloadValid &&
      !JSON.stringify(publicPageWithBannerData).includes(path2) &&
      !Object.prototype.hasOwnProperty.call((publicPageWithBannerData && publicPageWithBannerData.club) || {}, 'banner_path'),
      publicPageWithBannerData && publicPageWithBannerData.club);

    // ── L4. Pointer-write rollback after a successful storage upload ──────────
    // A spawned app talks to Supabase through a local proxy that fails exactly
    // the clubs PATCH carrying the new banner_path. Storage upload/removal and
    // every auth/read request still reach the real project. This exercises the
    // actual rollback branch rather than a pre-upload authorization rejection.
    const objectsBeforeFault = await clubBannerObjectNames(clubId);
    pointerFaultHarness = await startPointerFaultHarness(clubId);
    const faultCookie = await loginAt('owner', pointerFaultHarness.base);
    const failedPointerUpload = await uploadBanner(
      'owner', clubId, WEBP, 'image/webp', pointerFaultHarness.base, faultCookie
    );
    check('L4: injected post-upload pointer failure returns 500',
      failedPointerUpload.status === 500, failedPointerUpload);
    const { data: afterPointerFault } = await admin.from('clubs')
      .select('banner_path').eq('id', clubId).maybeSingle();
    check('L4: failed pointer write preserves the previous DB pointer',
      afterPointerFault && afterPointerFault.banner_path === path2,
      { expected: path2, actual: afterPointerFault && afterPointerFault.banner_path });
    const objectsAfterFault = await clubBannerObjectNames(clubId);
    check('L4: failed pointer write removes the just-uploaded object',
      JSON.stringify(objectsAfterFault) === JSON.stringify(objectsBeforeFault),
      { before: objectsBeforeFault, after: objectsAfterFault });
    check('L4: previous banner object remains present', await objectExists(path2), path2);
    await pointerFaultHarness.close();
    pointerFaultHarness = null;

    // ── L5. DELETE: clears pointer + removes object; idempotent ──────────────
    const del1 = await deleteBanner('owner', clubId);
    check('L5: DELETE banner → {success:true}', del1.status === 200 && del1.body && del1.body.success, del1);
    const { data: afterDel } = await admin.from('clubs').select('banner_path').eq('id', clubId).maybeSingle();
    check('L5: banner_path null after DELETE', afterDel && afterDel.banner_path === null, afterDel);
    check('L5: object removed from bucket after DELETE', !(await objectExists(path2)), path2);
    bannerPath = null;

    // Idempotent: delete again (no banner) → success, not an error
    const del2 = await deleteBanner('owner', clubId);
    check('L5: no-banner DELETE is idempotent (success)', del2.status === 200 && del2.body && del2.body.success, del2);

    // ── D4. No-banner club deletion succeeds ──────────────────────────────────
    // Create a throw-away club with no banner, delete it via the API
    const { data: d4Club } = await admin.from('clubs')
      .insert({ name: 'ClubProf D4', handle: 'clubprofd4', sport: 'running', city: 'Oslo', owner_id: users.owner.id })
      .select().single();
    const d4Id = d4Club.id;
    extraClubIds.add(d4Id);
    await admin.from('memberships').insert({ club_id: d4Id, user_id: users.owner.id, role: 'admin' });
    const d4Del = await fetch(BASE_URL + '/api/clubs/' + d4Id, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Cookie: users.owner.cookie },
      body: JSON.stringify({ confirm: 'clubprofd4' })
    });
    const d4DelBody = await d4Del.json().catch(() => null);
    check('D4: no-banner club delete succeeds (no object-cleanup error)', d4Del.status === 200 && d4DelBody && d4DelBody.success, { status: d4Del.status, body: d4DelBody });

    // ── D1. Club deletion also deletes banner object ──────────────────────────
    // Upload a fresh banner, then delete the club via API
    const upload3 = await uploadBanner('owner', clubId, WEBP, 'image/webp');
    check('D1-setup: banner uploaded', upload3.status === 200 && upload3.body && upload3.body.success, upload3);
    const { data: beforeD1 } = await admin.from('clubs').select('banner_path').eq('id', clubId).maybeSingle();
    const pathD1 = beforeD1 && beforeD1.banner_path;
    check('D1-setup: banner_path stored', typeof pathD1 === 'string', pathD1);
    bannerPath = pathD1;

    const d1Del = await fetch(BASE_URL + '/api/clubs/' + clubId, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Cookie: users.owner.cookie },
      body: JSON.stringify({ confirm: 'clubprofpublic' })
    });
    const d1DelBody = await d1Del.json().catch(() => null);
    check('D1: club delete API → 200 success', d1Del.status === 200 && d1DelBody && d1DelBody.success, { status: d1Del.status, body: d1DelBody });
    check('D1: banner object removed after club delete', !(await objectExists(pathD1)), pathD1);
    bannerPath = null;
    clubId = null; // gone

    // ── D3. Stripe-abort preserves banner object ──────────────────────────────
    // Create a new club, upload a banner, insert a fake paid sub, attempt delete
    // (should 502), verify banner still present.
    const { data: d3Club } = await admin.from('clubs')
      .insert({ name: 'ClubProf D3', handle: 'clubprofd3', sport: 'running', city: 'Oslo', owner_id: users.owner.id })
      .select().single();
    const d3Id = d3Club.id;
    extraClubIds.add(d3Id);
    await admin.from('memberships').insert({ club_id: d3Id, user_id: users.owner.id, role: 'admin' });
    // Re-login (previous login cookie may work or we can just create a fresh one)
    await login('owner');
    const uploadD3 = await uploadBanner('owner', d3Id, WEBP, 'image/webp');
    check('D3-setup: banner uploaded for D3 club', uploadD3.status === 200 && uploadD3.body && uploadD3.body.success, uploadD3);
    const { data: beforeD3 } = await admin.from('clubs').select('banner_path').eq('id', d3Id).maybeSingle();
    const pathD3 = beforeD3 && beforeD3.banner_path;
    if (pathD3) extraBannerPaths.add(pathD3);
    check('D3-setup: banner_path stored', typeof pathD3 === 'string', pathD3);

    await admin.from('subscriptions').insert({
      owner_type: 'club', owner_id: d3Id, plan: 'club_pro', status: 'active',
      stripe_customer_id: 'cus_clubprofd3_bogus', stripe_subscription_id: 'sub_clubprofd3_bogus'
    });
    const d3Del = await fetch(BASE_URL + '/api/clubs/' + d3Id, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Cookie: users.owner.cookie },
      body: JSON.stringify({ confirm: 'clubprofd3' })
    });
    check('D3: Stripe-abort → 502', d3Del.status === 502, d3Del.status);
    check('D3: banner object still present after Stripe abort', await objectExists(pathD3), pathD3);
    // Clean up D3
    await admin.from('subscriptions').delete().eq('owner_type', 'club').eq('owner_id', d3Id);
    await admin.storage.from(CLUB_BANNER_BUCKET).remove([pathD3]).catch(() => {});
    await admin.from('memberships').delete().eq('club_id', d3Id);
    await admin.from('clubs').delete().eq('id', d3Id);

    // ── D2. Account deletion with sole-member club also deletes banner ─────────
    // Create a new sole-member club under owner, upload a banner, then delete the account.
    // We need a fresh owner account for this since owner's main account may be deleted via D1 flow.
    // Actually owner still exists — only clubId was deleted. Verify.
    const { data: ownerStillExists } = await admin.auth.admin.getUserById(users.owner.id);
    if (ownerStillExists && ownerStillExists.user) {
      const { data: d2Club } = await admin.from('clubs')
        .insert({ name: 'ClubProf D2', handle: 'clubprofd2', sport: 'running', city: 'Oslo', owner_id: users.owner.id })
        .select().single();
      const d2Id = d2Club.id;
      extraClubIds.add(d2Id);
      await admin.from('memberships').insert({ club_id: d2Id, user_id: users.owner.id, role: 'admin' });
      await login('owner');
      const uploadD2 = await uploadBanner('owner', d2Id, WEBP, 'image/webp');
      check('D2-setup: banner uploaded for D2 club', uploadD2.status === 200 && uploadD2.body && uploadD2.body.success, uploadD2);
      const { data: beforeD2 } = await admin.from('clubs').select('banner_path').eq('id', d2Id).maybeSingle();
      const pathD2 = beforeD2 && beforeD2.banner_path;
      if (pathD2) extraBannerPaths.add(pathD2);
      check('D2-setup: banner_path stored', typeof pathD2 === 'string', pathD2);

      // owner is the sole member — account delete should destroy the club+banner
      const acctDel = await fetch(BASE_URL + '/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: users.owner.cookie },
        body: JSON.stringify({ confirm: 'DELETE' })
      });
      const acctDelBody = await acctDel.json().catch(() => null);
      check('D2: account delete → 200 ok', acctDel.status === 200 && acctDelBody && acctDelBody.ok, { status: acctDel.status, body: acctDelBody });
      check('D2: banner object removed after account delete', !(await objectExists(pathD2)), pathD2);
      // owner is now gone — null it out so cleanup doesn't try to delete again
      users.owner.id = null;
    } else {
      check('D2-setup: owner account still exists for D2 test', false, 'owner was unexpectedly deleted earlier');
    }

  } catch (err) {
    failures++;
    console.log('FAIL (exception): ' + err.message);
    console.error(err);
  } finally {
    await cleanup();
    console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nALL CHECKS PASSED');
    process.exit(failures ? 1 : 0);
  }
})();
