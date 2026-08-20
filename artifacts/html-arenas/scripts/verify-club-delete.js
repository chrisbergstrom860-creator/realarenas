// verify-club-delete.js — owner-initiated club deletion, end to end.
//
// Proves, by DIRECT table/storage queries (never the route's return value):
//   1. Refusals: non-owner admin → 403 owner_only; wrong typed handle → 400
//      confirm_mismatch — with zero rows deleted in both cases.
//   2. Stripe abort: a paid sub row whose stripe_subscription_id Stripe has
//      never heard of → 502, and the club is FULLY intact afterward (every
//      row and object still present, and the pre-written member
//      notifications retracted — no false "deleted" alarm).
//   3. Success: after removing the fake sub row, delete succeeds and every
//      club-owned table is empty (challenges, participants, challenge
//      invites, events, RSVPs, event invites, club posts + comments + likes,
//      club_invites, club_join_requests, memberships, subscriptions, clubs)
//      and every storage object is gone (challenge image, event image, post
//      image, club logo).
//   4. Member boundary: the member's activities survive; the member gets
//      exactly one un-suppressible 'club' notification with null link/actor;
//      the owner gets none.
//   5. Member-side residue: the club name is absent from the member's /feed
//      page payload (sidebar clubs) after deletion.
//
// Run: set -a && . ./.env && node scripts/verify-club-delete.js
/* eslint-disable no-console */
const { createClient } = require('@supabase/supabase-js');

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DOMAIN = process.env.REPLIT_DEV_DOMAIN;
const BASE_URL = `https://${DOMAIN}/html`;
const PW = 'ClubDel!2345';
const EMAILS = {
  owner: 'clubdel-owner@arenas-test.dev',
  admin2: 'clubdel-admin2@arenas-test.dev',
  member: 'clubdel-member@arenas-test.dev'
};
let failures = 0;
const check = (n, ok, d) => {
  if (ok) console.log('  ok  ' + n);
  else { failures++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); }
};
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
  '1f15c4890000000d4944415478da63fcffff3f030005fe02fea72d1ea10000000049454e44ae426082', 'hex');

async function login(email) {
  const r = await fetch(BASE_URL + '/auth/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(PW)}`
  });
  const setC = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  const raw = (setC || []).filter(Boolean).map(c => c.split(';')[0]);
  if (r.status !== 302 || !raw.length) throw new Error('login failed for ' + email);
  return raw.join('; ');
}
const del = (cookie, clubId, confirm) => fetch(BASE_URL + '/api/clubs/' + clubId, {
  method: 'DELETE',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ confirm })
}).then(r => r.json().then(b => ({ status: r.status, body: b })));

async function objectExists(bucket, path) {
  const dir = path.slice(0, path.lastIndexOf('/'));
  const name = path.slice(path.lastIndexOf('/') + 1);
  const { data } = await admin.storage.from(bucket).list(dir);
  return !!(data || []).find(f => f.name === name);
}
const ins = async (table, row) => {
  const { data, error } = await admin.from(table).insert(row).select().single();
  if (error) throw new Error('insert ' + table + ': ' + error.message);
  return data;
};
const count = async (table, col, val) =>
  ((await admin.from(table).select('*', { count: 'exact', head: true }).eq(col, val)).count) || 0;

(async () => {
  const users = {};
  let clubId = null, activityId = null;
  // Track the banner object path so cleanup can remove it if a test leaves it behind.
  let bannerObjectPath = null;
  const cleanup = async () => {
    if (bannerObjectPath) {
      await admin.storage.from('club-banners').remove([bannerObjectPath]).catch(() => {});
    }
    if (clubId) {
      // Also sweep any remaining banner objects under this club's prefix.
      const { data: bannerObjs } = await admin.storage.from('club-banners').list('clubs/' + clubId);
      if (bannerObjs && bannerObjs.length) {
        await admin.storage.from('club-banners').remove(bannerObjs.map(o => 'clubs/' + clubId + '/' + o.name)).catch(() => {});
      }
      const { data: chs } = await admin.from('challenges').select('id').eq('club_id', clubId);
      if ((chs || []).length) {
        await admin.from('challenge_participants').delete().in('challenge_id', chs.map(c => c.id));
        await admin.from('challenges').delete().eq('club_id', clubId);
      }
      await admin.from('events').delete().eq('club_id', clubId);
      await admin.from('club_invites').delete().eq('club_id', clubId);
      await admin.from('club_join_requests').delete().eq('club_id', clubId);
      await admin.from('subscriptions').delete().eq('owner_type', 'club').eq('owner_id', clubId);
      await admin.from('memberships').delete().eq('club_id', clubId);
      await admin.from('clubs').delete().eq('id', clubId);
    }
    for (const k of Object.keys(users)) {
      if (!users[k]) continue;
      await admin.from('notifications').delete().eq('user_id', users[k]);
      await admin.from('activities').delete().eq('user_id', users[k]);
      await admin.auth.admin.deleteUser(users[k]).catch(() => {});
    }
  };
  try {
    const { error: profileSchemaErr } = await admin.from('clubs').select('website_url, banner_path').limit(1);
    if (profileSchemaErr && /website_url|banner_path|column/i.test(profileSchemaErr.message || '')) {
      console.log('SKIP: public club profile columns are not live yet.');
      console.log('      Apply scripts/sql/public-club-profiles.sql first.');
      return;
    }
    // ── Seed users ──
    const { data: all } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of all.users) if (Object.values(EMAILS).includes(u.email)) await admin.auth.admin.deleteUser(u.id);
    for (const [k, email] of Object.entries(EMAILS)) {
      const { data, error } = await admin.auth.admin.createUser({
        email, password: PW, email_confirm: true,
        user_metadata: { name: 'ClubDel ' + k, handle: 'clubdel_' + k, sports: ['running'] }
      });
      if (error) throw new Error('createUser ' + k + ': ' + error.message);
      users[k] = data.user.id;
    }

    // ── Seed club + everything it owns ──
    const { data: club, error: cErr } = await admin.from('clubs')
      .insert({ name: 'ClubDel Verify Club', handle: 'clubdelverify', sport: 'running', owner_id: users.owner })
      .select().single();
    if (cErr) throw new Error('club: ' + cErr.message);
    clubId = club.id;
    await admin.from('memberships').insert([
      { club_id: clubId, user_id: users.owner, role: 'admin' },
      { club_id: clubId, user_id: users.admin2, role: 'admin' },
      { club_id: clubId, user_id: users.member, role: 'member' }
    ]);

    // Storage objects (uploaded first so paths are real)
    const logoPath = `clubs/${clubId}/verify-logo.png`;
    await admin.storage.from('avatars').upload(logoPath, PNG, { contentType: 'image/png' });
    const logoUrl = admin.storage.from('avatars').getPublicUrl(logoPath).data.publicUrl;
    await admin.from('clubs').update({ logo_url: logoUrl }).eq('id', clubId);
    club.logo_url = logoUrl;

    // Club banner (private bucket clubs/{clubId}/{ts}.webp). The server uses a
    // WebP encoded via sharp; for the seed we write a raw PNG at the expected
    // path so the object exists — the deletion sweep only checks the path, not
    // the bytes. We write it with the timestamp prefix the route produces.
    const bannerTs = Date.now();
    const bannerSeedPath = `clubs/${clubId}/${bannerTs}.webp`;
    await admin.storage.from('club-banners').upload(bannerSeedPath, PNG, { contentType: 'image/png' });
    await admin.from('clubs').update({ banner_path: bannerSeedPath }).eq('id', clubId);
    bannerObjectPath = bannerSeedPath;

    const ch = await ins('challenges', {
      title: 'ClubDel Challenge', sport: 'running', goal_type: 'distance', goal_target: 50, goal_unit: 'km',
      start_date: '2026-08-01', end_date: '2026-09-01', club_id: clubId, created_by: users.owner
    });
    const chImgPath = `challenges/${ch.id}/verify.png`;
    await admin.storage.from('challenge-images').upload(chImgPath, PNG, { contentType: 'image/png' });
    await admin.from('challenges').update({ image_path: chImgPath }).eq('id', ch.id);
    await admin.from('challenge_participants').insert({ challenge_id: ch.id, user_id: users.member });
    await admin.from('challenge_invites').insert({ challenge_id: ch.id, invitee_id: users.member, inviter_id: users.owner });

    const ev = await ins('events', {
      created_by: users.owner, club_id: clubId, title: 'ClubDel Event', sport: 'running',
      date: new Date('2026-09-15T10:00:00Z').toISOString(), location: 'Verify Park', visibility: 'club'
    });
    const evImgPath = `events/${ev.id}/verify.png`;
    await admin.storage.from('event-images').upload(evImgPath, PNG, { contentType: 'image/png' });
    await admin.from('events').update({ image_path: evImgPath }).eq('id', ev.id);
    await admin.from('event_rsvps').insert({ event_id: ev.id, user_id: users.member, status: 'going' });
    await admin.from('event_invites').insert({ event_id: ev.id, invitee_id: users.member, inviter_id: users.owner });

    const postImgPath = `posts/${users.owner}/verify.png`;
    await admin.storage.from('post-images').upload(postImgPath, PNG, { contentType: 'image/png' });
    const postImgUrl = admin.storage.from('post-images').getPublicUrl(postImgPath).data.publicUrl;
    const post = await ins('posts', {
      user_id: users.owner, club_id: clubId, content: 'ClubDel announcement', image_url: postImgUrl
    });
    await admin.from('post_comments').insert({ post_id: post.id, user_id: users.member, content: 'verify comment' });
    await admin.from('post_likes').insert({ post_id: post.id, user_id: users.member });

    await admin.from('club_invites').insert({ club_id: clubId, email: 'clubdel-invitee@arenas-test.dev', invited_by: users.owner, role: 'member', token: 'clubdelverify-token-1' });
    await admin.from('club_join_requests').insert({ club_id: clubId, user_id: null, status: 'pending' }).then(async r => {
      // some schemas require user_id — retry with a real user (join requests
      // normally come from non-members; reuse admin2's id is invalid since
      // they're a member, but the FK only needs a real user)
      if (r.error) await admin.from('club_join_requests').insert({ club_id: clubId, user_id: users.member, status: 'pending' });
    });

    // Member-owned data that must SURVIVE
    const act = await ins('activities', {
      user_id: users.member, sport: 'running', title: 'ClubDel member run', date: '2026-08-10',
      distance: '5 km', duration: '30:00'
    });
    activityId = act && act.id;

    // Scale: >1000 extra challenge rows (bulk, no images) prove the teardown
    // uses paged reads — an unpaged read would strand rows past PostgREST's
    // 1000-row default page.
    const bulk = [];
    for (let i = 0; i < 1050; i++) bulk.push({
      title: 'ClubDel bulk ' + i, sport: 'running', goal_type: 'distance', goal_target: 5,
      goal_unit: 'km', start_date: '2026-08-01', end_date: '2026-09-01', club_id: clubId, created_by: users.owner
    });
    for (let i = 0; i < bulk.length; i += 500) {
      const { error: bErr } = await admin.from('challenges').insert(bulk.slice(i, i + 500));
      if (bErr) throw new Error('bulk challenges: ' + bErr.message);
    }

    // Fake paid sub (Stripe has never heard of this id → retrieve fails)
    await admin.from('subscriptions').insert({
      owner_type: 'club', owner_id: clubId, plan: 'club_pro', status: 'active',
      stripe_customer_id: 'cus_clubdelverify', stripe_subscription_id: 'sub_clubdelverify_bogus'
    });

    const snapshot = async () => ({
      clubs: await count('clubs', 'id', clubId),
      memberships: await count('memberships', 'club_id', clubId),
      challenges: await count('challenges', 'club_id', clubId),
      participants: await count('challenge_participants', 'challenge_id', ch.id),
      challengeInvites: await count('challenge_invites', 'challenge_id', ch.id),
      events: await count('events', 'club_id', clubId),
      rsvps: await count('event_rsvps', 'event_id', ev.id),
      eventInvites: await count('event_invites', 'event_id', ev.id),
      posts: await count('posts', 'club_id', clubId),
      comments: await count('post_comments', 'post_id', post.id),
      likes: await count('post_likes', 'post_id', post.id),
      clubInvites: await count('club_invites', 'club_id', clubId),
      joinRequests: await count('club_join_requests', 'club_id', clubId),
      subs: await count('subscriptions', 'owner_id', clubId)
    });
    const fullTotal = s => Object.values(s).reduce((a, b) => a + b, 0);
    const before = await snapshot();
    check('seed complete (all rows present, incl. 1051 challenges for the paging case)', before.clubs === 1 && before.memberships === 3 && before.challenges === 1051 && before.events === 1 && before.posts === 1, JSON.stringify(before));

    const ownerCookie = await login(EMAILS.owner);
    const admin2Cookie = await login(EMAILS.admin2);
    const memberCookie = await login(EMAILS.member);

    // Member sees the club on /feed before deletion (sidebar payload)
    const feedBefore = await fetch(BASE_URL + '/feed', { headers: { Cookie: memberCookie } }).then(r => r.text());
    check('member /feed shows club before delete', feedBefore.includes('ClubDel Verify Club'));

    // ── 1. Refusals ──
    let r = await del(admin2Cookie, clubId, 'clubdelverify');
    check('non-owner admin → 403 owner_only', r.status === 403 && r.body.error === 'owner_only', JSON.stringify(r));
    r = await del(ownerCookie, clubId, 'wrong-handle');
    check('wrong typed handle → 400 confirm_mismatch', r.status === 400 && r.body.error === 'confirm_mismatch', JSON.stringify(r));
    let s = await snapshot();
    check('refusals deleted nothing', JSON.stringify(s) === JSON.stringify(before), JSON.stringify(s));

    // ── 1b. Owner-demotion gap (owner protection on role/removal routes) ──
    const api = (cookie, method, path, body) => fetch(BASE_URL + path, {
      method, headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined
    }).then(r => r.json().then(b => ({ status: r.status, body: b })));
    const roleOf = async (uid) => (await admin.from('memberships').select('role')
      .eq('club_id', clubId).eq('user_id', uid).maybeSingle()).data;

    r = await api(admin2Cookie, 'PATCH', `/api/clubs/${clubId}/members/${users.owner}/role`, { role: 'member' });
    check('admin2 demoting owner → 403 with explanatory copy',
      r.status === 403 && /owner themselves/.test(r.body.error || ''), JSON.stringify(r));
    check('owner role untouched after refused demotion', (await roleOf(users.owner)).role === 'admin');

    r = await api(admin2Cookie, 'DELETE', `/api/clubs/${clubId}/members/${users.owner}`);
    check('admin2 removing owner → 403 with explanatory copy',
      r.status === 403 && /owner cannot be removed/.test(r.body.error || ''), JSON.stringify(r));
    check('owner membership intact after refused removal', !!(await roleOf(users.owner)));

    // Ordinary role changes between non-owners are unaffected.
    r = await api(admin2Cookie, 'PATCH', `/api/clubs/${clubId}/members/${users.member}/role`, { role: 'coach' });
    check('admin2 promoting member → coach still works', r.status === 200 && (await roleOf(users.member)).role === 'coach', JSON.stringify(r));
    r = await api(ownerCookie, 'PATCH', `/api/clubs/${clubId}/members/${users.member}/role`, { role: 'member' });
    check('owner changing a non-owner role still works', r.status === 200 && (await roleOf(users.member)).role === 'member', JSON.stringify(r));

    // Owner changing their OWN role is allowed (self only) — and crucially the
    // restore must work THROUGH THE API while the owner is no longer admin
    // (no management lockout after a self-demotion).
    r = await api(ownerCookie, 'PATCH', `/api/clubs/${clubId}/members/${users.owner}/role`, { role: 'member' });
    check('owner self role change allowed', r.status === 200 && (await roleOf(users.owner)).role === 'member', JSON.stringify(r));
    r = await api(ownerCookie, 'PATCH', `/api/clubs/${clubId}/members/${users.member}/role`, { role: 'coach' });
    check('demoted owner cannot manage OTHERS (admin gate still applies)', r.status === 403, JSON.stringify(r));
    r = await api(admin2Cookie, 'PATCH', `/api/clubs/${clubId}/members/${users.owner}/role`, { role: 'admin' });
    check('even a PROMOTION of the owner by another admin is refused', r.status === 403, JSON.stringify(r));
    r = await api(ownerCookie, 'PATCH', `/api/clubs/${clubId}/members/${users.owner}/role`, { role: 'admin' });
    check('non-admin owner can restore their own admin role via API (no lockout)', r.status === 200 && (await roleOf(users.owner)).role === 'admin', JSON.stringify(r));

    // Members API flags the owner row so the UI can hide the controls.
    r = await api(admin2Cookie, 'GET', `/api/clubs/${clubId}/members`);
    const ownRow = ((r.body && r.body.members) || []).find(m => m.user_id === users.owner);
    check('members API marks owner row isOwner', !!(ownRow && ownRow.isOwner === true), JSON.stringify(ownRow));

    s = await snapshot();
    check('owner-protection checks left counts unchanged', JSON.stringify(s) === JSON.stringify(before), JSON.stringify(s));

    // ── 2. Stripe abort ──
    r = await del(ownerCookie, clubId, 'clubdelverify');
    check('bogus paid sub → 502 stripe abort', r.status === 502, JSON.stringify(r));
    s = await snapshot();
    check('stripe abort: club FULLY intact', JSON.stringify(s) === JSON.stringify(before), JSON.stringify(s));
    check('stripe abort: challenge image object still present', await objectExists('challenge-images', chImgPath));
    check('stripe abort: club banner object still present (not deleted on abort)', await objectExists('club-banners', bannerSeedPath));
    const notifsAfterAbort = await count('notifications', 'user_id', users.member);
    check('stripe abort: member notifications retracted (no false alarm)', notifsAfterAbort === 0, String(notifsAfterAbort));

    // ── 3. Success (drop the fake sub so Stripe is not consulted) ──
    await admin.from('subscriptions').delete().eq('owner_type', 'club').eq('owner_id', clubId);
    before.subs = 0;
    r = await del(ownerCookie, clubId, 'clubdelverify');
    check('owner + exact handle → 200', r.status === 200 && r.body.success, JSON.stringify(r));
    s = await snapshot();
    check('every club-owned table empty', fullTotal(s) === 0, JSON.stringify(s));
    check('challenge image object gone', !(await objectExists('challenge-images', chImgPath)));
    check('event image object gone', !(await objectExists('event-images', evImgPath)));
    check('post image object gone', !(await objectExists('post-images', postImgPath)));
    check('club logo object gone', !(await objectExists('avatars', logoPath)));
    check('club banner object gone (destroyClub cleans club-banners bucket)', !(await objectExists('club-banners', bannerSeedPath)));
    bannerObjectPath = null; // successfully deleted — cleanup should not try again

    // ── 4. Member boundary ──
    const { data: actRow } = await admin.from('activities').select('id').eq('id', activityId).maybeSingle();
    check('member activity SURVIVES', !!actRow);
    const { data: memberNotifs } = await admin.from('notifications').select('type,title,body,link,actor_id').eq('user_id', users.member);
    check('member got exactly one club notification', (memberNotifs || []).length === 1, JSON.stringify(memberNotifs));
    const n = (memberNotifs || [])[0] || {};
    check('notification copy + degradation (null link, null actor)',
      n.type === 'club' && /has been deleted by its owner/.test(n.body || '') && /activities and achievements are unaffected/.test(n.body || '') && n.link === null && n.actor_id === null,
      JSON.stringify(n));
    const ownerNotifs = await count('notifications', 'user_id', users.owner);
    check('owner got no notification', ownerNotifs === 0, String(ownerNotifs));
    const admin2Notifs = await count('notifications', 'user_id', users.admin2);
    check('other admin got the notification too', admin2Notifs === 1, String(admin2Notifs));

    // ── 5. Member-side residue ──
    const feedAfter = await fetch(BASE_URL + '/feed', { headers: { Cookie: memberCookie } }).then(r => r.text());
    check('member /feed no longer shows the club', !feedAfter.includes('ClubDel Verify Club'));
    const memberMemberships = await count('memberships', 'user_id', users.member);
    check('member membership row gone', memberMemberships === 0, String(memberMemberships));
  } catch (e) {
    failures++;
    console.log('  FAIL (exception) ' + e.message);
  } finally {
    await cleanup();
    console.log(failures ? failures + ' FAILURE(S)' : 'ALL PASS');
    process.exit(failures ? 1 : 0);
  }
})();
