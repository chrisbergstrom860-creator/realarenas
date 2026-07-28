// Seeded verification of the personal data export's privacy rules
// (export_version 2): challenge invites, club invites, and the
// third-party-data rules — no raw UUIDs anywhere (account.id excepted), no
// system-revealed emails (user-supplied club-invite emails permitted), no
// invite tokens, people as { name, handle }.
// Two phases so the before/after diff is real:
//   node scripts/verify-export-invites.js --seed    (run against the OLD code:
//     seeds users/data, captures before-exports to /tmp)
//   node scripts/verify-export-invites.js --check   (after the change+restart)
// Cleanup: node scripts/test-data-sweep.js --delete
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BASE = `https://${process.env.REPLIT_DEV_DOMAIN}/html`;
const PW = 'ArenasTest!234';
const BEFORE_ZERO = '/tmp/export-before-zero.json';
const BEFORE_OWNER = '/tmp/export-before-owner.json';
const OPEN_INVITE_EMAIL = 'open-invite@realarenas.com';
const emails = { o: 'exp2owner@arenas-test.dev', m: 'exp2member@arenas-test.dev', z: 'exp2zero@arenas-test.dev' };
const names = { o: ['Exp Owner', 'exp_owner'], m: ['Exp Member', 'exp_member'], z: ['Exp Zero', 'exp_zero'] };
const OUTSIDER_EMAIL = 'never-signed-up@example.com';

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  → ' + JSON.stringify(detail).slice(0, 600)}`);
  if (!ok) failures++;
};

const users = {};
async function mkUser(key) {
  const { data, error } = await admin.auth.admin.createUser({
    email: emails[key], password: PW, email_confirm: true,
    user_metadata: { name: names[key][0], handle: names[key][1] }
  });
  if (error) throw new Error(key + ': ' + error.message);
  users[key] = { id: data.user.id };
}
async function login(key) {
  if (!users[key]) {
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    users[key] = { id: data.users.find((u) => u.email === emails[key]).id };
  }
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(emails[key])}&password=${encodeURIComponent(PW)}`
  });
  const setC = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  const cookie = (setC || []).filter(Boolean).map((c) => c.split(';')[0]).join('; ');
  if (r.status !== 302 || !cookie) throw new Error('login failed for ' + key);
  users[key].cookie = cookie;
}
async function exportFor(key) {
  const r = await fetch(BASE + '/api/account/export', { headers: { Cookie: users[key].cookie } });
  if (r.status !== 200) throw new Error('export status ' + r.status + ' for ' + key);
  return r.json();
}
async function ins(table, row) {
  const { data, error } = await admin.from(table).insert(row).select().maybeSingle();
  if (error) throw new Error(table + ': ' + error.message);
  return data;
}
const day = 86400000;
const iso = (d) => new Date(Date.now() + d * day).toISOString();

if (process.argv.includes('--seed')) {
  for (const k of Object.keys(emails)) { await mkUser(k); await login(k); }
  console.log('MANIFEST users:', JSON.stringify(Object.fromEntries(Object.entries(users).map(([k, v]) => [k, v.id]))));
  const O = users.o.id, M = users.m.id;
  // Club owned by O with M as a member.
  const club = await ins('clubs', { name: 'EXP2 Test Club', handle: 'exp2club', sport: 'running', city: 'Testville', owner_id: O });
  await ins('memberships', { user_id: O, club_id: club.id, role: 'admin' });
  await ins('memberships', { user_id: M, club_id: club.id, role: 'member' });
  // Club invites sent by O: pending to a never-signed-up address, accepted
  // (M's address, typed by O), and an open link. One received by O from M.
  await ins('club_invites', { club_id: club.id, invited_by: O, email: OUTSIDER_EMAIL, role: 'member', token: 'exp2-token-pending', status: 'pending', expires_at: iso(7) });
  await ins('club_invites', { club_id: club.id, invited_by: O, email: emails.m, role: 'member', token: 'exp2-token-accepted', status: 'accepted', accepted_at: iso(-1), expires_at: iso(7) });
  await ins('club_invites', { club_id: club.id, invited_by: O, email: OPEN_INVITE_EMAIL, role: 'member', token: 'exp2-token-open', status: 'pending', expires_at: iso(7) });
  await ins('club_invites', { club_id: club.id, invited_by: M, email: emails.o, role: 'member', token: 'exp2-token-received', status: 'pending', expires_at: iso(7) });
  // Challenges + invites, both directions, pending and accepted.
  const mkCh = (by, title, parts) => ins('challenges', {
    created_by: by, title, visibility: 'private', sport: 'any', goal_type: 'distance',
    goal_target: 100, goal_unit: 'km', start_date: iso(-1), end_date: iso(9)
  }).then(async (ch) => { for (const p of parts) await ins('challenge_participants', { challenge_id: ch.id, user_id: p }); return ch; });
  const X = await mkCh(O, 'EXP2-X sent-pending', [O]);
  await ins('challenge_invites', { challenge_id: X.id, inviter_id: O, invitee_id: M });
  const Z2 = await mkCh(O, 'EXP2-Z sent-accepted', [O, M]);
  await ins('challenge_invites', { challenge_id: Z2.id, inviter_id: O, invitee_id: M });
  const Y = await mkCh(M, 'EXP2-Y recv-accepted', [M, O]);
  await ins('challenge_invites', { challenge_id: Y.id, inviter_id: M, invitee_id: O });
  const W = await mkCh(M, 'EXP2-W recv-pending', [M]);
  await ins('challenge_invites', { challenge_id: W.id, inviter_id: M, invitee_id: O });
  // Follows both ways; posts, comment + like by O on M's post; notifications
  // both directions; an activity + goal for O; event by M with O's RSVP.
  await ins('follows', { follower_id: O, following_id: M });
  await ins('follows', { follower_id: M, following_id: O });
  await ins('posts', { user_id: O, content: 'EXP2 own post content', sport: 'running' });
  const mp = await ins('posts', { user_id: M, content: 'EXP2 member post', sport: 'running' });
  await ins('post_comments', { post_id: mp.id, user_id: O, content: 'EXP2 own comment' });
  await ins('post_likes', { post_id: mp.id, user_id: O });
  await ins('notifications', { user_id: O, actor_id: M, type: 'like', title: 'New kudos', body: 'Exp Member liked your post' });
  await ins('notifications', { user_id: M, actor_id: O, type: 'follow', title: 'New follower', body: 'Exp Owner followed you' });
  await ins('activities', { user_id: O, sport: 'running', title: 'EXP2 morning run', date: iso(-1).slice(0, 10), duration: '00:40:00', distance: '8 km' });
  await ins('goals', { user_id: O, type: 'distance', sport: 'running', target_value: 50, unit: 'km', period: 'weekly', status: 'active' });
  const ev = await ins('events', { created_by: M, club_id: club.id, title: 'EXP2 club run', sport: 'running', event_type: 'training', date: iso(3), location: 'Testville Track', visibility: 'club' });
  await ins('event_rsvps', { event_id: ev.id, user_id: O, status: 'going' });
  console.log('MANIFEST club:', club.id, 'challenges:', JSON.stringify([X.id, Z2.id, Y.id, W.id]), 'event:', ev.id);
  fs.writeFileSync(BEFORE_ZERO, JSON.stringify(await exportFor('z'), null, 2));
  fs.writeFileSync(BEFORE_OWNER, JSON.stringify(await exportFor('o'), null, 2));
  console.log('Saved pre-change exports →', BEFORE_ZERO, BEFORE_OWNER);
  process.exit(0);
}

// ── --check phase ──
for (const k of Object.keys(emails)) await login(k);
const ex = await exportFor('o');
const O = users.o.id;

// 1-2. Blanket guards: no raw UUIDs anywhere except the requester's own
// account id; no forbidden id-bearing keys anywhere.
const scrubbed = JSON.stringify(ex).split(O).join('OWN_ID');
const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
check('no raw UUID anywhere in the export (own account id excepted)',
  !uuidRe.test(scrubbed), (scrubbed.match(uuidRe) || [])[0]);
check('no id-bearing keys anywhere (user_id/actor_id/invited_by/…)',
  !/"(user_id|actor_id|invited_by|invitee_id|inviter_id|follower_id|following_id|post_id|club_id|challenge_id|event_id|entity_id|owner_id|activity_id)"/.test(scrubbed), null);

// 3. Email provenance: strip the requester's own email and the user-supplied
// club-invite emails → no '@' may remain (system-revealed emails, tokens
// with addresses, anything).
const clone = JSON.parse(JSON.stringify(ex));
delete clone.account.email;
const suppliedEmails = (clone.club_invites.sent || []).map(r => { const e = r.invited_email; delete r.invited_email; return e; }).filter(Boolean);
check('no system-revealed email anywhere (own + user-supplied stripped)',
  !JSON.stringify(clone).includes('@'), (JSON.stringify(clone).match(/[^"{,]*@[^"},]*/) || [])[0]);
check('user-supplied invite emails preserved (provenance rule)',
  suppliedEmails.includes(OUTSIDER_EMAIL) && suppliedEmails.includes(emails.m), suppliedEmails);

// 4. No invite capability tokens.
check('no club-invite tokens anywhere', !JSON.stringify(ex).includes('exp2-token'), null);

// 5. Club invites shape.
const cis = ex.club_invites.sent, cir = ex.club_invites.received;
check('club_invites.sent: 3 rows (pending email, accepted email, open link)',
  cis.length === 3
  && cis.some(r => r.invited_email === OUTSIDER_EMAIL && r.status === 'pending')
  && cis.some(r => r.invited_email === emails.m && r.status === 'accepted')
  && cis.some(r => r.open_link === true && !('invited_email' in r)), cis);
check('club_invites.sent rows carry club name+handle, no sentinel email',
  cis.every(r => r.club && r.club.name === 'EXP2 Test Club' && r.club.handle === 'exp2club')
  && !JSON.stringify(cis).includes(OPEN_INVITE_EMAIL), cis);
check('club_invites.received: inviter as name+handle, no email/token fields',
  cir.length === 1 && cir[0].inviter && cir[0].inviter.name === 'Exp Member' && cir[0].inviter.handle === 'exp_member'
  && !('email' in cir[0]) && !('token' in cir[0]), cir);

// 6. Challenge invites: both directions, derived state via shared helper.
const byTitle = (rows) => Object.fromEntries((rows || []).map((r) => [r.challenge_title, r]));
const sent = byTitle(ex.challenge_invites.sent), recv = byTitle(ex.challenge_invites.received);
check('challenge_invites sent: pending + accepted derived correctly',
  ex.challenge_invites.sent.length === 2
  && sent['EXP2-X sent-pending'] && sent['EXP2-X sent-pending'].state === 'pending'
  && sent['EXP2-Z sent-accepted'] && sent['EXP2-Z sent-accepted'].state === 'accepted', sent);
check('challenge_invites received: pending + accepted derived correctly',
  ex.challenge_invites.received.length === 2
  && recv['EXP2-Y recv-accepted'] && recv['EXP2-Y recv-accepted'].state === 'accepted'
  && recv['EXP2-W recv-pending'] && recv['EXP2-W recv-pending'].state === 'pending', recv);
check('challenge_invites counterparty is Member by name+handle',
  [...ex.challenge_invites.sent, ...ex.challenge_invites.received]
    .every(r => r.counterparty && r.counterparty.name === 'Exp Member' && r.counterparty.handle === 'exp_member'), null);

// 7. Person reshaping across the other sections.
check('follows: both directions person-shaped',
  ex.follows.following.length === 1 && ex.follows.following[0].user.handle === 'exp_member'
  && ex.follows.followers.length === 1 && ex.follows.followers[0].user.handle === 'exp_member', ex.follows);
check('notifications.received: actor as person', ex.notifications.received.some(n => n.actor && n.actor.handle === 'exp_member'), ex.notifications.received);
check('notifications.triggered: recipient as person, read-state omitted',
  ex.notifications.triggered.some(n => n.recipient && n.recipient.handle === 'exp_member')
  && ex.notifications.triggered.every(n => !('read' in n)), ex.notifications.triggered);
check('post_comments/post_likes: post_author as person',
  ex.post_comments.length === 1 && ex.post_comments[0].post_author.handle === 'exp_member'
  && ex.post_likes.length === 1 && ex.post_likes[0].post_author.handle === 'exp_member', { c: ex.post_comments, l: ex.post_likes });
check('rsvps carry event title/date; memberships carry club name+handle',
  ex.events.rsvps.length === 1 && ex.events.rsvps[0].event_title === 'EXP2 club run'
  && ex.clubs.memberships.length === 1 && ex.clubs.memberships[0].club.handle === 'exp2club', { r: ex.events.rsvps, m: ex.clubs.memberships });
check('participations carry challenge titles',
  ex.challenges.participations.length === 3
  && ex.challenges.participations.every(p => p.challenge_title && p.challenge_title.startsWith('EXP2-')), ex.challenges.participations);

// 8. Own data survives (diff vs the pre-change owner export).
const beforeOwner = JSON.parse(fs.readFileSync(BEFORE_OWNER, 'utf8'));
check('own data intact: activity/post/comment/goal/club content unchanged',
  ex.activities.length === 1 && ex.activities[0].title === 'EXP2 morning run' && ex.activities[0].distance === '8 km'
  && ex.posts.length === 1 && ex.posts[0].content === 'EXP2 own post content'
  && ex.post_comments[0].content === 'EXP2 own comment'
  && ex.goals.length === 1 && ex.goals[0].target_value === beforeOwner.goals[0].target_value
  && ex.clubs.owned.length === 1 && ex.clubs.owned[0].name === 'EXP2 Test Club'
  && ex.account.email === beforeOwner.account.email
  && JSON.stringify(ex.account.profile) === JSON.stringify(beforeOwner.account.profile), null);
check('section keys unchanged vs pre-change export',
  JSON.stringify(Object.keys(beforeOwner)) === JSON.stringify(Object.keys(ex)), { before: Object.keys(beforeOwner), after: Object.keys(ex) });
check('leaked fields actually gone (present before, absent now)',
  JSON.stringify(beforeOwner).includes(users.m.id) && JSON.stringify(beforeOwner).includes('exp2-token')
  && !JSON.stringify(ex).includes(users.m.id), null);

// 9. Zero-data user: empty arrays, and the ONLY diff vs pre-change is the
// version bump (all reshaping is a no-op on empty sections).
const exZ = await exportFor('z');
check('zero-data user: invite sections are honest empty arrays',
  Array.isArray(exZ.challenge_invites.sent) && exZ.challenge_invites.sent.length === 0
  && Array.isArray(exZ.club_invites.received) && exZ.club_invites.received.length === 0, exZ.challenge_invites);
const bz = JSON.parse(fs.readFileSync(BEFORE_ZERO, 'utf8'));
const az = JSON.parse(JSON.stringify(exZ));
delete bz.generated_at; delete az.generated_at;
check('zero-data diff: only export_version changed (1 → 2)',
  bz.export_version === 1 && az.export_version === 2
  && (delete bz.export_version, delete az.export_version, JSON.stringify(bz) === JSON.stringify(az)),
  null);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
