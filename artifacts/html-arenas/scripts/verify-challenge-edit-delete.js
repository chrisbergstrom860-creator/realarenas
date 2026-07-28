// One-shot seeded verification of challenge creator edit/delete routes.
// Creates 4 test users + 5 challenges, runs the server matrix over real
// logged-in HTTP sessions, prints PASS/FAIL. Cleanup: test-data-sweep.js.
import { createClient } from '@supabase/supabase-js';

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BASE = `https://${process.env.REPLIT_DEV_DOMAIN}/html`;
const PW = 'ArenasTest!234';
const emails = {
  creator: 'edcreator@arenas-test.dev',
  p1: 'edp1@arenas-test.dev',
  p2: 'edp2@arenas-test.dev',
  stranger: 'edstranger@arenas-test.dev'
};

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  → ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
};

const users = {}; // key -> { id, cookie }
async function mkUser(key) {
  const { data, error } = await admin.auth.admin.createUser({
    email: emails[key], password: PW, email_confirm: true,
    user_metadata: { name: 'Ed ' + key, handle: 'ed_' + key }
  });
  if (error) throw new Error(key + ': ' + error.message);
  users[key] = { id: data.user.id };
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
  for (const k of participantKeys) {
    await admin.from('challenge_participants').insert({ challenge_id: data.id, user_id: users[k].id });
  }
  return data;
}
const notifCount = async (key, title) => {
  const { data } = await admin.from('notifications').select('id, title')
    .eq('user_id', users[key].id).eq('type', 'challenge');
  return (data || []).filter((n) => !title || n.title === title).length;
};

for (const k of Object.keys(emails)) { await mkUser(k); await login(k); }
console.log('MANIFEST users:', JSON.stringify(Object.fromEntries(Object.entries(users).map(([k, v]) => [k, v.id]))));

const cb = users.creator.id;
const X = await mkChallenge({ created_by: cb, title: 'ED-X started multi', start_date: iso(-2), end_date: iso(10), visibility: 'public' }, ['creator', 'p1', 'p2']);
const Y = await mkChallenge({ created_by: cb, title: 'ED-Y prestart', start_date: iso(2), end_date: iso(12), visibility: 'public' }, ['creator', 'p1']);
const Z = await mkChallenge({ created_by: cb, title: 'ED-Z solo', start_date: iso(-1), end_date: iso(9), visibility: 'public' }, ['creator']);
const W = await mkChallenge({ created_by: cb, title: 'ED-W discover', start_date: iso(-1), end_date: iso(9), visibility: 'public' }, ['creator', 'p2']);
const V = await mkChallenge({ created_by: cb, title: 'ED-V private solo', start_date: iso(-1), end_date: iso(9), visibility: 'private' }, ['creator']);
console.log('MANIFEST challenges:', JSON.stringify([X.id, Y.id, Z.id, W.id, V.id]));

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
// stranger still locked out of joining W
r = await api('stranger', 'POST', `/challenges/${W.id}/join`);
check('stranger join private W → invite_required', r.body?.error === 'invite_required', r);
// 10. end early: flips expired + notifies
r = await api('creator', 'POST', `/challenges/${X.id}/end-early`);
check('end-early X succeeds, end_date now past', r.body?.success === true && new Date(r.body.challenge.end_date) < new Date(), r);
check('end-early notified p1 ("Challenge ended early")', (await notifCount('p1', 'Challenge ended early')) === 1, {});
r = await api('creator', 'POST', `/challenges/${X.id}/end-early`);
check('second end-early → already_ended', r.body?.error === 'already_ended', r);
// 11. derived-done locks all edits
r = await api('creator', 'PATCH', `/challenges/${X.id}`, { title: 'too late' });
check('PATCH ended X → challenge_ended', r.body?.error === 'challenge_ended', r);
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

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
