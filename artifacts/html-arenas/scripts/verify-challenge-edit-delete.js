// One-shot seeded verification of challenge creator edit/delete routes.
// Creates 4 test users + 6 challenges, runs the server matrix over real
// logged-in HTTP sessions, then proves its complete fixture manifest is gone.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BASE = `https://${process.env.REPLIT_DEV_DOMAIN}/html`;
const PW = 'ArenasTest!234';
const emails = {
  creator: 'edcreator@arenas-test.dev',
  p1: 'edp1@arenas-test.dev',
  p2: 'edp2@arenas-test.dev',
  stranger: 'edstranger@arenas-test.dev'
};

let failures = 0, cleanupFailures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  → ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
};
const manifest = {
  users: [],
  challenges: [],
  participants: [],
  activities: [],
  notifications: [],
  invites: []
};
const MANIFEST_PATH = '/tmp/verify-challenge-edit-delete-manifest.json';
const saveManifest = () => fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
const cleanupCheck = (name, ok, detail) => {
  console.log(`${ok ? 'CLEAN' : 'CLEANUP FAIL'}  ${name}${ok ? '' : '  → ' + JSON.stringify(detail)}`);
  if (!ok) cleanupFailures++;
};
async function checkedDelete(name, query) {
  try {
    const { error } = await query;
    cleanupCheck(name, !error, error && error.message);
  } catch (error) {
    cleanupCheck(name, false, error.message);
  }
}

const users = {}; // key -> { id, cookie }
async function mkUser(key) {
  const { data, error } = await admin.auth.admin.createUser({
    email: emails[key], password: PW, email_confirm: true,
    user_metadata: { name: 'Ed ' + key, handle: 'ed_' + key }
  });
  if (error) throw new Error(key + ': ' + error.message);
  users[key] = { id: data.user.id };
  manifest.users.push({ key, id: data.user.id, email: emails[key] });
  saveManifest();
}
async function login(key) {
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(emails[key])}&password=${encodeURIComponent(PW)}`
  });
  const setC = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  const cookie = (setC || []).filter(Boolean).map((c) => c.split(';')[0]).join('; ');
  if (r.status !== 302 || !cookie) throw new Error('login failed for ' + key + ' status=' + r.status);
  users[key].cookie = cookie;
}
async function api(key, method, path, body) {
  const r = await fetch(BASE + '/api' + path, {
    method,
    headers: { Cookie: users[key].cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let j = null;
  try { j = await r.json(); } catch (e) { /* non-json */ }
  return { status: r.status, body: j };
}

const day = 86400000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * day).toISOString();
async function mkChallenge(fields, participantKeys) {
  const { data, error } = await admin.from('challenges').insert({
    sport: 'any', goal_type: 'distance', goal_target: 100, goal_unit: 'km',
    description: null, club_id: null, ...fields
  }).select().single();
  if (error) throw new Error(error.message);
  manifest.challenges.push(data.id);
  saveManifest();
  for (const k of participantKeys) {
    const row = { challenge_id: data.id, user_id: users[k].id };
    const inserted = await admin.from('challenge_participants').insert(row);
    if (inserted.error) throw new Error('participant ' + k + ': ' + inserted.error.message);
    manifest.participants.push(row);
    saveManifest();
  }
  return data;
}
const notifCount = async (key, title) => {
  const { data } = await admin.from('notifications').select('id, title')
    .eq('user_id', users[key].id).eq('type', 'challenge');
  return (data || []).filter((n) => !title || n.title === title).length;
};

async function captureGeneratedRows() {
  const challengeIds = manifest.challenges;
  const userIds = manifest.users.map((row) => row.id);
  if (challengeIds.length) {
    try {
      const invites = await admin.from('challenge_invites').select('challenge_id, invitee_id, inviter_id').in('challenge_id', challengeIds);
      cleanupCheck('capture generated challenge invites', !invites.error, invites.error && invites.error.message);
      if (!invites.error) manifest.invites = invites.data || [];
    } catch (error) {
      cleanupCheck('capture generated challenge invites', false, error.message);
    }
  }
  if (userIds.length) {
    try {
      const notifications = await admin.from('notifications').select('id, user_id, actor_id, type, title')
        .eq('type', 'challenge')
        .or(`user_id.in.(${userIds.join(',')}),actor_id.in.(${userIds.join(',')})`);
      cleanupCheck('capture generated challenge notifications', !notifications.error, notifications.error && notifications.error.message);
      if (!notifications.error) manifest.notifications = notifications.data || [];
    } catch (error) {
      cleanupCheck('capture generated challenge notifications', false, error.message);
    }
  }
  try {
    saveManifest();
  } catch (error) {
    cleanupCheck('persist generated-row manifest', false, error.message);
  }
}

async function verifyNoResidue() {
  const challengeIds = manifest.challenges;
  const userIds = manifest.users.map((row) => row.id);
  const activityIds = manifest.activities;
  const notificationIds = manifest.notifications.map((row) => row.id);
  if (challengeIds.length) {
    const challenges = await admin.from('challenges').select('id').in('id', challengeIds);
    cleanupCheck('manifest challenges absent', !challenges.error && !(challenges.data || []).length, challenges);
    const participants = await admin.from('challenge_participants').select('challenge_id,user_id').in('challenge_id', challengeIds);
    cleanupCheck('manifest participants absent', !participants.error && !(participants.data || []).length, participants);
    const invites = await admin.from('challenge_invites').select('challenge_id,invitee_id').in('challenge_id', challengeIds);
    cleanupCheck('manifest/generated challenge invites absent', !invites.error && !(invites.data || []).length, invites);
  }
  if (activityIds.length) {
    const activities = await admin.from('activities').select('id').in('id', activityIds);
    cleanupCheck('manifest activities absent', !activities.error && !(activities.data || []).length, activities);
  }
  if (userIds.length) {
    const userActivities = await admin.from('activities').select('id,user_id').in('user_id', userIds);
    cleanupCheck('fixture-user activities absent',
      !userActivities.error && !(userActivities.data || []).length, userActivities);
    const userParticipants = await admin.from('challenge_participants').select('challenge_id,user_id').in('user_id', userIds);
    cleanupCheck('fixture-user participants absent',
      !userParticipants.error && !(userParticipants.data || []).length, userParticipants);
    const userInvites = await admin.from('challenge_invites').select('challenge_id,invitee_id,inviter_id')
      .or(`invitee_id.in.(${userIds.join(',')}),inviter_id.in.(${userIds.join(',')})`);
    cleanupCheck('fixture-user challenge invites absent',
      !userInvites.error && !(userInvites.data || []).length, userInvites);
    const userNotifications = await admin.from('notifications').select('id,user_id,actor_id,type')
      .eq('type', 'challenge')
      .or(`user_id.in.(${userIds.join(',')}),actor_id.in.(${userIds.join(',')})`);
    cleanupCheck('fixture-user challenge notifications absent',
      !userNotifications.error && !(userNotifications.data || []).length, userNotifications);
  }
  if (notificationIds.length) {
    const notifications = await admin.from('notifications').select('id').in('id', notificationIds);
    cleanupCheck('manifest/generated challenge notifications absent',
      !notifications.error && !(notifications.data || []).length, notifications);
  }
  const authRows = [];
  for (let page = 1; ; page++) {
    const listed = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listed.error) {
      cleanupCheck('manifest auth users absent', false, listed.error.message);
      break;
    }
    authRows.push(...listed.data.users);
    if (listed.data.users.length < 200) {
      const residue = authRows.filter((row) => userIds.includes(row.id) || manifest.users.some((item) => item.email === row.email));
      cleanupCheck('manifest auth users absent', residue.length === 0, residue.map((row) => ({ id: row.id, email: row.email })));
      break;
    }
  }
}

async function cleanupManifest() {
  await captureGeneratedRows();
  const leaveOne = process.env.VERIFY_CLEANUP_LEAVE_ONE === 'challenge-activity';
  const challengeIds = manifest.challenges;
  const userIds = manifest.users.map((row) => row.id);
  for (const row of manifest.notifications) {
    await checkedDelete('notification ' + row.id, admin.from('notifications').delete().eq('id', row.id));
  }
  if (userIds.length) {
    await checkedDelete('challenge notifications for fixture users',
      admin.from('notifications').delete().eq('type', 'challenge')
        .or(`user_id.in.(${userIds.join(',')}),actor_id.in.(${userIds.join(',')})`));
  }
  for (const row of manifest.invites) {
    await checkedDelete('challenge invite ' + row.challenge_id + '/' + row.invitee_id,
      admin.from('challenge_invites').delete().eq('challenge_id', row.challenge_id).eq('invitee_id', row.invitee_id));
  }
  if (challengeIds.length) {
    await checkedDelete('challenge invites for fixture challenges',
      admin.from('challenge_invites').delete().in('challenge_id', challengeIds));
  }
  for (const row of manifest.participants) {
    await checkedDelete('participant ' + row.challenge_id + '/' + row.user_id,
      admin.from('challenge_participants').delete().eq('challenge_id', row.challenge_id).eq('user_id', row.user_id));
  }
  for (const id of manifest.activities) {
    if (leaveOne && id === manifest.activities[0]) {
      console.log('FAULT INJECTION  deliberately retaining activity ' + id);
      continue;
    }
    await checkedDelete('activity ' + id, admin.from('activities').delete().eq('id', id));
  }
  if (leaveOne && manifest.activities.length) {
    const retainedId = manifest.activities[0];
    const retained = await admin.from('activities').select('id,user_id').eq('id', retainedId);
    cleanupCheck('fault-injected retained activity absent',
      !retained.error && !(retained.data || []).length, retained);
    // Remove the deliberate residue after proving the guard so this negative
    // test cannot itself contaminate later verifier runs.
    await checkedDelete('fault-injected retained activity remediation',
      admin.from('activities').delete().eq('id', retainedId));
  }
  for (const id of manifest.challenges) {
    await checkedDelete('challenge ' + id, admin.from('challenges').delete().eq('id', id));
  }
  for (const row of manifest.users) {
    try {
      const deleted = await admin.auth.admin.deleteUser(row.id);
      cleanupCheck('auth user ' + row.email, !deleted.error, deleted.error && deleted.error.message);
    } catch (error) {
      cleanupCheck('auth user ' + row.email, false, error.message);
    }
  }
  await verifyNoResidue();
}

async function run() {
  try {
    for (const k of Object.keys(emails)) { await mkUser(k); await login(k); }
    console.log('MANIFEST users:', JSON.stringify(Object.fromEntries(Object.entries(users).map(([k, v]) => [k, v.id]))));

    const cb = users.creator.id;
    const X = await mkChallenge({ created_by: cb, title: 'ED-X started multi', start_date: iso(-2), end_date: iso(10), visibility: 'public' }, ['creator', 'p1', 'p2']);
    const Y = await mkChallenge({ created_by: cb, title: 'ED-Y prestart', start_date: iso(2), end_date: iso(12), visibility: 'public' }, ['creator', 'p1']);
    const Z = await mkChallenge({ created_by: cb, title: 'ED-Z solo', start_date: iso(-1), end_date: iso(9), visibility: 'public' }, ['creator']);
    const W = await mkChallenge({ created_by: cb, title: 'ED-W discover', start_date: iso(-1), end_date: iso(9), visibility: 'public' }, ['creator', 'p2']);
    const V = await mkChallenge({ created_by: cb, title: 'ED-V private solo', start_date: iso(-1), end_date: iso(9), visibility: 'private' }, ['creator']);
    // Q: live challenge the CREATOR has personally completed (goal 100km, creator
    // logs 150km) while it remains live for p1 — mutations must gate on
    // challenge-level end_date only, never per-viewer completion.
    const Q = await mkChallenge({ created_by: cb, title: 'ED-Q creator-done live', start_date: iso(-1), end_date: iso(9), visibility: 'public' }, ['creator', 'p1']);
    const activity = await admin.from('activities').insert({
      user_id: cb, sport: 'running', distance: '150 km', duration: '01:00:00',
      date: new Date().toISOString(), title: 'ED seed long run'
    }).select('id').single();
    if (activity.error) throw new Error('activity: ' + activity.error.message);
    manifest.activities.push(activity.data.id);
    saveManifest();
    console.log('MANIFEST challenges:', JSON.stringify([X.id, Y.id, Z.id, W.id, V.id, Q.id]));

    let r;
// 1. hard delete refused when others involved
    r = await api('creator', 'DELETE', `/challenges/${X.id}`);
check('delete X refused not_alone (2 participants)', r.body?.error === 'not_alone' && r.body.participants === 2, r);
// 2. stranger on public → 403 not_authorized (no data leak needed, it's public)
r = await api('stranger', 'PATCH', `/challenges/${X.id}`, { title: 'hax' });
check('stranger PATCH public X → 403 not_authorized', r.status === 403 && r.body?.error === 'not_authorized', r);
// 3. stranger on PRIVATE SOLO → indistinguishable from missing
for (const [m, p] of [['PATCH', ''], ['DELETE', ''], ['POST', '/end-early'], ['POST', '/remove-from-discover']]) {
  r = await api('stranger', m, `/challenges/${V.id}${p}`, m === 'PATCH' ? { title: 'x' } : undefined);
  check(`stranger ${m}${p || ''} private solo V → "Challenge not found"`, r.body?.error === 'Challenge not found', r);
}
// 3b. ZERO-LEAK: stranger responses for a real private-solo id must be
// byte-identical (status + body) to those for a nonexistent id on all four
// routes — a future refactor must not reintroduce an existence oracle.
const ghost = '00000000-0000-4000-8000-000000000000';
for (const [m, p] of [['PATCH', ''], ['DELETE', ''], ['POST', '/end-early'], ['POST', '/remove-from-discover']]) {
  const real = await api('stranger', m, `/challenges/${V.id}${p}`, m === 'PATCH' ? { title: 'x' } : undefined);
  const fake = await api('stranger', m, `/challenges/${ghost}${p}`, m === 'PATCH' ? { title: 'x' } : undefined);
  check(`zero-leak ${m}${p || ''}: private-solo response identical to nonexistent-id response`,
    real.status === fake.status && JSON.stringify(real.body) === JSON.stringify(fake.body), { real, fake });
}
// 14. non-creator participant is not an editor
r = await api('p1', 'PATCH', `/challenges/${X.id}`, { title: 'nope' });
check('participant p1 PATCH X → 403 not_authorized', r.status === 403 && r.body?.error === 'not_authorized', r);
// 4. title-only edit after start: allowed, notifies NOBODY
const p1Before = await notifCount('p1');
r = await api('creator', 'PATCH', `/challenges/${X.id}`, { title: 'ED-X renamed' });
check('title-only PATCH started X succeeds', r.body?.success === true && r.body.challenge.title === 'ED-X renamed', r);
check('title-only edit sent no notifications', (await notifCount('p1')) === p1Before, { before: p1Before });
// 5. material edit after start rejected
r = await api('creator', 'PATCH', `/challenges/${X.id}`, { goal_target: 200 });
check('post-start goal_target PATCH → field_locked', r.body?.error === 'field_locked', r);
// 6. pre-start material edit succeeds + notifies participants
r = await api('creator', 'PATCH', `/challenges/${Y.id}`, { goal_target: 55, description: 'tightened' });
check('pre-start material PATCH Y succeeds', r.body?.success === true && Number(r.body.challenge.goal_target) === 55, r);
check('pre-start material edit notified p1 ("Challenge updated")', (await notifCount('p1', 'Challenge updated')) === 1, {});
// 13. end-early pre-start refused
r = await api('creator', 'POST', `/challenges/${Y.id}/end-early`);
check('end-early on pre-start Y → not_started', r.body?.error === 'not_started', r);
// 7. pre-start public→private via PATCH mints invite for p1
r = await api('creator', 'PATCH', `/challenges/${Y.id}`, { visibility: 'private' });
check('pre-start visibility PATCH Y → private', r.body?.success === true && r.body.challenge.visibility === 'private', r);
let inv = await admin.from('challenge_invites').select('invitee_id').eq('challenge_id', Y.id).eq('invitee_id', users.p1.id).maybeSingle();
check('grandfather invite minted for p1 on Y', !!inv.data, inv);
// 8. remove-from-discover works post-start, one-directional
r = await api('creator', 'POST', `/challenges/${W.id}/remove-from-discover`);
check('remove-from-discover W succeeds post-start', r.body?.success === true && r.body.challenge.visibility === 'private', r);
inv = await admin.from('challenge_invites').select('invitee_id').eq('challenge_id', W.id).eq('invitee_id', users.p2.id).maybeSingle();
check('grandfather invite minted for p2 on W', !!inv.data, inv);
r = await api('creator', 'POST', `/challenges/${W.id}/remove-from-discover`);
check('second remove-from-discover → already_private', r.body?.error === 'already_private', r);
r = await api('creator', 'PATCH', `/challenges/${W.id}`, { visibility: 'public' });
check('private→public after start stays locked (field_locked)', r.body?.error === 'field_locked', r);
// 9. p2 can leave AND get past the invite gate on rejoin (invite check runs
// before the Pro gate, so pro_required also proves grandfathering; only
// invite_required is a failure).
await api('p2', 'DELETE', `/challenges/${W.id}/leave`);
r = await api('p2', 'POST', `/challenges/${W.id}/join`);
check('p2 leave→rejoin passes invite gate on private W', r.body?.success === true || r.body?.error === 'pro_required', r);
// stranger still locked out of joining W — canonical visibility gate answers
// with the byte-identical not-found (the old invite_required 403 was an
// existence oracle; removed 2026-08-07).
r = await api('stranger', 'POST', `/challenges/${W.id}/join`);
check('stranger join private W → zero-leak not-found', r.body?.error === 'Challenge not found', r);
// 10. end early: flips expired + notifies
r = await api('creator', 'POST', `/challenges/${X.id}/end-early`);
check('end-early X succeeds, end_date now past', r.body?.success === true && new Date(r.body.challenge.end_date) < new Date(), r);
check('end-early notified p1 ("Challenge ended early")', (await notifCount('p1', 'Challenge ended early')) === 1, {});
r = await api('creator', 'POST', `/challenges/${X.id}/end-early`);
check('second end-early → already_ended', r.body?.error === 'already_ended', r);
// 11. derived-done locks all edits
r = await api('creator', 'PATCH', `/challenges/${X.id}`, { title: 'too late' });
check('PATCH ended X → challenge_ended', r.body?.error === 'challenge_ended', r);
// 15. PER-VIEWER vs CHALLENGE-LEVEL split: creator personally completed Q
// (display shows Completed for them) but end_date has NOT passed — edits and
// end-early MUST still work. Inverse (creator with zero activities in X still
// locked out of a genuinely expired X) is test 11 above.
r = await api('creator', 'GET', '/challenges');
const qView = (r.body?.myChallenges || []).find((c) => c.id === Q.id);
check('creator view of live Q is isComplete=true, isExpired=false (per-viewer display intact)', !!qView && qView.isComplete === true && qView.isExpired === false, qView);
r = await api('creator', 'PATCH', `/challenges/${Q.id}`, { title: 'ED-Q renamed by finisher' });
check('creator who personally completed can still edit live Q', r.body?.success === true, r);
r = await api('creator', 'POST', `/challenges/${Q.id}/end-early`);
check('creator who personally completed can still end live Q early', r.body?.success === true, r);
check('Q end-early notified p1', (await notifCount('p1', 'Challenge ended early')) === 2, {});
// 12. solo hard delete: allowed, zero residue
r = await api('creator', 'DELETE', `/challenges/${Z.id}`);
check('solo delete Z succeeds', r.body?.success === true, r);
const gone = await admin.from('challenges').select('id').eq('id', Z.id).maybeSingle();
const goneParts = await admin.from('challenge_participants').select('user_id').eq('challenge_id', Z.id);
check('Z fully gone (challenge + participants)', !gone.data && !(goneParts.data || []).length, { gone, goneParts });
// Discover check: X (ended) & W,V,Y (private) — none should offer public discovery of W
r = await api('stranger', 'GET', '/challenges');
const discoverIds = JSON.stringify(r.body);
check('W absent from stranger challenge payload (removed from Discover)', !discoverIds.includes(W.id), {});
    check('Z absent from stranger challenge payload (deleted)', !discoverIds.includes(Z.id), {});
  } catch (error) {
    failures++;
    console.error('FATAL TEST ERROR', error);
  } finally {
    await cleanupManifest();
  }

  const totalFailures = failures + cleanupFailures;
  console.log(totalFailures ? `\n${totalFailures} FAILURE(S)` : '\nALL PASS');
  process.exit(totalFailures ? 1 : 0);
}

run().catch((error) => {
  console.error('FATAL CLEANUP ERROR', error);
  process.exit(1);
});
