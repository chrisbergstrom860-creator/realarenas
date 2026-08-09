// Club post attribution verification:
//   - announcements persist club_id (the durable signal); personal posts don't
//   - classification is club_id, NEVER the author's current role:
//       * a coach's personal post renders as type 'post' in the club feed
//       * demoting the author does NOT reclassify their old announcement
//   - club feed + member-home payloads carry club identity
//     (clubName/clubLogoUrl/clubSport) on announcements only
//   - main-feed post payload (buildFeedPosts shape via /feed page data)
//     carries clubId/clubName for announcements when the viewer follows the
//     author
//   - announcements SURVIVE the author leaving the club (club-owned speech),
//     with honest "posted by" attribution still resolvable
//   - member-home role badge is null for a departed author
//   - notification copy: "Club announcement" title, club name in body
//   - no-logo fallback: payload logo null (renderer falls back to the shared
//     clubTileHtml sport icon — client-side, structurally shared)
//   - club deletion: FK cascade removes announcements (app must NOT
//     double-handle) — verified by deleting the club and checking posts gone
// Run with the dev server up:
//   node artifacts/html-arenas/scripts/verify-club-post-attribution.js

const { createClient } = require('@supabase/supabase-js');
const BASE_URL = 'http://localhost:80/html';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const PW = 'ArenasTest!234';
const emails = {
  coach: 'clubattr-coach@arenas-test.dev',
  member: 'clubattr-member@arenas-test.dev',
  coach2: 'clubattr-coach2@arenas-test.dev',
  outsider: 'clubattr-outsider@arenas-test.dev'
};

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail ? ' — ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400) : '')); }
}

const users = {};
async function deleteUserByEmail(email) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of (data && data.users) || []) if (u.email === email) await admin.auth.admin.deleteUser(u.id);
}
async function mkUser(k, name, handle) {
  await deleteUserByEmail(emails[k]);
  const { data, error } = await admin.auth.admin.createUser({
    email: emails[k], password: PW, email_confirm: true,
    user_metadata: { name, handle, timezone: 'UTC' }
  });
  if (error) throw new Error(error.message);
  users[k] = { id: data.user.id };
}
async function login(k) {
  const r = await fetch(BASE_URL + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(emails[k])}&password=${encodeURIComponent(PW)}`, redirect: 'manual'
  });
  const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')])
    .map(c => String(c).split(';')[0]).join('; ');
  if (!cookie) throw new Error('login failed ' + k);
  users[k].cookie = cookie;
}
async function api(k, method, path, body) {
  const r = await fetch(BASE_URL + '/api' + path, {
    method, headers: { Cookie: users[k].cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function main() {
  await mkUser('coach', 'Attr Coach', 'attr_coach');
  await mkUser('member', 'Attr Member', 'attr_member');
  await mkUser('coach2', 'Attr CoachTwo', 'attr_coach2');
  await mkUser('outsider', 'Attr Outsider', 'attr_outsider');
  for (const k of ['coach', 'member', 'coach2', 'outsider']) await login(k);
  console.log('MANIFEST users:', JSON.stringify(Object.fromEntries(Object.keys(users).map(k => [k, users[k].id]))));

  // Club (no logo → fallback path exercised), coach = admin, member joins.
  let r = await api('coach', 'POST', '/clubs/create', { name: 'Attr Test Club', handle: 'attrclub', sport: 'running', city: '' });
  const clubId = ((r.body && r.body.redirect) || '').split('club=')[1];
  check('club created (no logo)', !!clubId, r.body);
  const { error: memErr } = await admin.from('memberships').insert({ user_id: users.member.id, club_id: clubId, role: 'member' });
  check('member added to club', !memErr, memErr && memErr.message);

  // ── 1. Announcement persists club_id; personal post does not ──
  r = await api('coach', 'POST', '/clubs/' + clubId + '/announce', { content: 'Season kickoff Saturday — bring spikes!' });
  check('announce succeeds', r.body && r.body.success, r.body);
  const annId = r.body.post.id;
  check('announcement row has club_id', r.body.post.club_id === clubId, r.body.post);

  r = await api('coach', 'POST', '/posts/create', { content: 'My personal training note', sport: 'running' });
  const personalId = (r.body && (r.body.post ? r.body.post.id : r.body.id)) || null;
  const { data: personalRow } = await admin.from('posts').select('id, club_id').eq('user_id', users.coach.id).is('club_id', null).limit(1);
  check('coach personal post has NO club_id', personalRow && personalRow.length === 1, personalRow);

  // ── 2. Club feed classification by club_id, not role ──
  r = await api('member', 'GET', '/clubs/' + clubId + '/feed');
  const feed = (r.body && r.body.feed) || [];
  const annItem = feed.find(f => f.id === annId);
  const persItem = feed.find(f => f.type === 'post' && f.userId === users.coach.id);
  check('announcement typed announcement', annItem && annItem.type === 'announcement', annItem);
  check("coach's personal post typed 'post' (no role inference)", !!persItem, feed.map(f => [f.type, f.userId === users.coach.id]));
  check('announcement carries club identity', annItem && annItem.clubName === 'Attr Test Club' && annItem.clubId === clubId && annItem.clubSport === 'running', annItem);
  check('no-logo club → clubLogoUrl null (sport-icon fallback client-side)', annItem && annItem.clubLogoUrl === null, annItem && annItem.clubLogoUrl);
  check('personal post has NO club identity fields', persItem && !persItem.clubId && !persItem.clubName, persItem);

  // ── 3. Member home: announcements by club_id, role badge from roster ──
  r = await api('member', 'GET', '/clubs/' + clubId + '/member-home');
  let ann = ((r.body && r.body.announcements) || []).find(a => a.id === annId);
  check('member-home lists the announcement', !!ann, r.body && (r.body.announcements || []).length);
  check('member-home: personal coach post NOT in announcements', !((r.body && r.body.announcements) || []).some(a => a.userId === users.coach.id && a.id !== annId), r.body && r.body.announcements);
  check('member-home announcement author attributed', ann && ann.coachName === 'Attr Coach', ann);

  // ── 4. Main /feed payload: follower sees club identity on announcement ──
  await api('member', 'POST', '/follow/' + users.coach.id);
  const pageRes = await fetch(BASE_URL + '/feed', { headers: { Cookie: users.member.cookie } });
  const pageHtml = await pageRes.text();
  const m = pageHtml.match(/window\.ARENAS_DATA\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
  let feedPosts = [];
  try { feedPosts = JSON.parse(m[1]).posts || []; } catch (e) {}
  const feedAnn = feedPosts.find(p => p.id === annId);
  const feedPers = feedPosts.find(p => p.user_id === users.coach.id && !p.clubId);
  check('main feed announcement carries clubId + clubName', feedAnn && feedAnn.clubId === clubId && feedAnn.clubName === 'Attr Test Club', feedAnn);
  check('main feed personal post unchanged (no club fields)', feedPers && !feedPers.clubId && !feedPers.clubName, feedPers);

  // ── 4b. Membership scoping: a NON-MEMBER who follows the author must NOT
  //        receive club announcements through /feed (club-owned speech is
  //        scoped by viewer membership, never author-following).
  await admin.from('memberships').delete().eq('user_id', users.member.id).eq('club_id', clubId);
  const nmRes = await fetch(BASE_URL + '/feed', { headers: { Cookie: users.member.cookie } });
  const nmHtml = await nmRes.text();
  const nmMatch = nmHtml.match(/window\.ARENAS_DATA\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
  let nmPosts = [];
  try { nmPosts = JSON.parse(nmMatch[1]).posts || []; } catch (e) {}
  check('non-member follower: announcement ABSENT from /feed', !nmPosts.some(p => p.id === annId), nmPosts.map(p => p.id));
  check('non-member follower: personal posts still present', nmPosts.some(p => p.user_id === users.coach.id && !p.clubId), nmPosts.length);
  // Restore membership for the remaining sections.
  await admin.from('memberships').insert({ user_id: users.member.id, club_id: clubId, role: 'member' });

  // ── 5. Notification copy ──
  const { data: notifs } = await admin.from('notifications').select('title, body').eq('user_id', users.member.id).eq('type', 'club');
  const n = (notifs || [])[0];
  check('notif title "Club announcement", body leads with club name', n && n.title === 'Club announcement' && /^Attr Test Club · Attr Coach:/.test(n.body), n);

  // ── 6. Role change does NOT reclassify; departure does NOT hide ──
  // Demote coach to plain member: announcement must STAY an announcement.
  await admin.from('memberships').update({ role: 'member' }).eq('user_id', users.coach.id).eq('club_id', clubId);
  r = await api('member', 'GET', '/clubs/' + clubId + '/feed');
  const afterDemote = (r.body.feed || []).find(f => f.id === annId);
  check('after demotion announcement still typed announcement', afterDemote && afterDemote.type === 'announcement', afterDemote && afterDemote.type);

  // Remove the author from the club entirely: announcement survives, personal
  // post disappears from club feed, attribution still names the author.
  await admin.from('memberships').delete().eq('user_id', users.coach.id).eq('club_id', clubId);
  r = await api('member', 'GET', '/clubs/' + clubId + '/feed');
  const afterLeave = (r.body.feed || []).find(f => f.id === annId);
  const persAfterLeave = (r.body.feed || []).find(f => f.type === 'post' && f.userId === users.coach.id);
  check('announcement survives author leaving (club-owned speech)', afterLeave && afterLeave.type === 'announcement', (r.body.feed || []).map(f => f.type));
  check('departed author still attributed by name', afterLeave && afterLeave.name === 'Attr Coach', afterLeave && afterLeave.name);
  check("departed author's personal post gone from club feed", !persAfterLeave, persAfterLeave);
  r = await api('member', 'GET', '/clubs/' + clubId + '/member-home');
  ann = ((r.body && r.body.announcements) || []).find(a => a.id === annId);
  check('member-home keeps departed-author announcement, role null', ann && ann.role === null && ann.coachName === 'Attr Coach', ann);

  // ── 6b. Manager delete of announcements ──
  // Roster now: coach has LEFT the club (departed author), member is a plain
  // member. Add coach2 as a coach of this club; outsider manages a DIFFERENT
  // club. Their old announcement (annId) is the departed-coach target.
  await admin.from('memberships').insert({ user_id: users.coach2.id, club_id: clubId, role: 'coach' });
  r = await api('outsider', 'POST', '/clubs/create', { name: 'Attr Other Club', handle: 'attrother', sport: 'cycling', city: '' });
  const otherClubId = ((r.body && r.body.redirect) || '').split('club=')[1];
  check('second club created (outsider is admin)', !!otherClubId, r.body);

  // Zero-leak baseline: DELETE on a nonexistent id.
  const ghost = await api('member', 'DELETE', '/posts/00000000-0000-0000-0000-00000000dead');
  // Plain member (neither author nor manager) → byte-identical not-found.
  let denied = await api('member', 'DELETE', '/posts/' + annId);
  check('plain member denied: byte-identical not-found', denied.status === ghost.status && JSON.stringify(denied.body) === JSON.stringify(ghost.body), { denied, ghost });
  // Manager of a DIFFERENT club → same byte-identical not-found.
  denied = await api('outsider', 'DELETE', '/posts/' + annId);
  check('other-club manager denied: byte-identical not-found', denied.status === ghost.status && JSON.stringify(denied.body) === JSON.stringify(ghost.body), { denied, ghost });
  const { data: stillThere } = await admin.from('posts').select('id').eq('id', annId);
  check('announcement untouched by denied attempts', stillThere && stillThere.length === 1, stillThere);

  // Personal posts stay author-only even for a club manager: coach2 (manager)
  // cannot delete member's personal post.
  r = await api('member', 'POST', '/posts/create', { content: 'Member personal note', sport: 'running' });
  const memberPostId = r.body && r.body.post && r.body.post.id;
  denied = await api('coach2', 'DELETE', '/posts/' + memberPostId);
  check('personal post: manager denied, byte-identical not-found', denied.status === ghost.status && JSON.stringify(denied.body) === JSON.stringify(ghost.body), denied);
  r = await api('member', 'DELETE', '/posts/' + memberPostId);
  check('personal post: author delete works', r.body && r.body.success, r.body);

  // Coach2 posts an announcement WITH an image; author deletes own → OK.
  r = await api('coach2', 'POST', '/clubs/' + clubId + '/announce', { content: 'Coach2 own announcement' });
  const ownAnnId = r.body && r.body.post && r.body.post.id;
  r = await api('coach2', 'DELETE', '/posts/' + ownAnnId);
  check('author deletes own announcement', r.body && r.body.success, r.body);

  // canDelete flags: coach2 (manager) sees canDelete on the departed coach's
  // announcement in club feed + member-home; plain member does not.
  r = await api('coach2', 'GET', '/clubs/' + clubId + '/feed');
  let flagged = (r.body.feed || []).find(f => f.id === annId);
  check('club feed: manager gets canDelete=true', flagged && flagged.canDelete === true, flagged);
  r = await api('member', 'GET', '/clubs/' + clubId + '/feed');
  flagged = (r.body.feed || []).find(f => f.id === annId);
  check('club feed: plain member gets canDelete=false', flagged && flagged.canDelete === false, flagged);
  r = await api('coach2', 'GET', '/clubs/' + clubId + '/member-home');
  flagged = ((r.body && r.body.announcements) || []).find(a => a.id === annId);
  check('member-home: manager gets canDelete=true', flagged && flagged.canDelete === true, flagged);

  // A COACH (not admin) deletes another (departed) coach's announcement.
  r = await api('coach2', 'DELETE', '/posts/' + annId);
  check("coach deletes another coach's announcement", r.body && r.body.success, r.body);

  // Departed coach's announcement with image + kudos + notification, then a
  // COACH (coach2) deletes it: full cascade incl. the image object stored
  // under the AUTHOR's uid.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  // The announce composer is text-only; build an image-bearing announcement
  // by creating an image post then stamping club_id (same row shape).
  const fd = new FormData();
  fd.append('content', 'Departed-style announcement with image');
  fd.append('image', new Blob([png], { type: 'image/png' }), 'a.png');
  const upRes = await fetch(BASE_URL + '/api/posts/create', { method: 'POST', headers: { Cookie: users.coach2.cookie }, body: fd });
  const upBody = await upRes.json();
  const imgAnnId = upBody && upBody.post && upBody.post.id;
  const imgUrl = upBody && upBody.post && upBody.post.image_url;
  check('image post created', !!imgAnnId && !!imgUrl, upBody);
  const { error: stampErr } = await admin.from('posts').update({ club_id: clubId }).eq('id', imgAnnId);
  check('stamped as announcement', !stampErr, stampErr && stampErr.message);
  // coach2 departs; the announcement stays; then re-add coach2? No — instead
  // member likes it and coach (original, now outside) can't. Use coach2 →
  // departed by removing membership AFTER, so deleting manager is coach? coach
  // left earlier. Simplest: member likes it, then remove coach2 from club and
  // make MEMBER an admin — admin deletes departed coach2's announcement.
  await api('member', 'POST', '/posts/' + imgAnnId + '/like');
  await admin.from('memberships').delete().eq('user_id', users.coach2.id).eq('club_id', clubId);
  await admin.from('memberships').update({ role: 'admin' }).eq('user_id', users.member.id).eq('club_id', clubId);
  r = await api('member', 'DELETE', '/posts/' + imgAnnId);
  check("admin deletes departed coach's announcement", r.body && r.body.success, r.body);
  const { data: annRow2 } = await admin.from('posts').select('id').eq('id', imgAnnId);
  const { data: likeRows } = await admin.from('post_likes').select('post_id').eq('post_id', imgAnnId);
  const { data: notifRows } = await admin.from('notifications').select('id').eq('entity_id', imgAnnId).in('type', ['like', 'comment']);
  check('cascade: row, likes, like/comment notifs gone', annRow2.length === 0 && likeRows.length === 0 && notifRows.length === 0, { annRow2, likeRows, notifRows });
  const objectPath = imgUrl.split('/post-images/')[1] && imgUrl.split('/post-images/')[1].split('?')[0];
  if (objectPath) {
    const dir = objectPath.split('/').slice(0, -1).join('/');
    const fileName = objectPath.split('/').pop();
    const { data: objs } = await admin.storage.from('post-images').list(dir);
    check('cascade: image object gone (author-keyed path)', !(objs || []).some(o => o.name === fileName), (objs || []).map(o => o.name));
  } else {
    check('cascade: image object path parseable', false, imgUrl);
  }
  // restore member role for remaining sections
  await admin.from('memberships').update({ role: 'member' }).eq('user_id', users.member.id).eq('club_id', clubId);
  // clean up outsider's club
  await admin.from('clubs').delete().eq('id', otherClubId);

  // ── 7. Club deletion → FK cascade removes announcements (no app double-handling) ──
  const { data: cascAnn } = await admin.from('posts')
    .insert({ user_id: users.member.id, club_id: clubId, content: 'cascade probe' })
    .select('id').single();
  const { error: delErr } = await admin.from('clubs').delete().eq('id', clubId);
  check('club deleted', !delErr, delErr && delErr.message);
  const { data: annAfter } = await admin.from('posts').select('id').eq('id', cascAnn.id);
  check('announcement cascaded away with the club', annAfter && annAfter.length === 0, annAfter);
  const { data: persAfter } = await admin.from('posts').select('id').is('club_id', null).eq('user_id', users.coach.id);
  check('personal post untouched by club deletion', persAfter && persAfter.length === 1, persAfter);

  // ── Cleanup ──
  for (const k of ['coach', 'member', 'coach2', 'outsider']) {
    await admin.from('posts').delete().eq('user_id', users[k].id);
    await admin.from('notifications').delete().eq('user_id', users[k].id);
    await admin.from('notifications').delete().eq('actor_id', users[k].id);
    await admin.from('follows').delete().eq('follower_id', users[k].id);
    await admin.from('follows').delete().eq('following_id', users[k].id);
    await admin.from('memberships').delete().eq('user_id', users[k].id);
    const { error } = await admin.auth.admin.deleteUser(users[k].id);
    check('cleanup: ' + k + ' deleted', !error, error && error.message);
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
