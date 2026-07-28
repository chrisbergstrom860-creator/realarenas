// Seeded verification: challenge invites in the personal data export.
// Two phases so the before/after diff is real:
//   node scripts/verify-export-invites.js --seed    (run on OLD code: seeds
//     users/data, captures the zero-invite user's export to /tmp)
//   node scripts/verify-export-invites.js --check   (run after the change:
//     asserts both directions, derived state, counterparty shape, empty
//     arrays, and that the only diff for the zero-invite user is the new key)
// Cleanup: node scripts/test-data-sweep.js --delete
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BASE = `https://${process.env.REPLIT_DEV_DOMAIN}/html`;
const PW = 'ArenasTest!234';
const BEFORE_FILE = '/tmp/export-before-zero-invites.json';
const emails = { a: 'exinva@arenas-test.dev', b: 'exinvb@arenas-test.dev', c: 'exinvc@arenas-test.dev' };
const names = { a: ['Ex Alice', 'ex_alice'], b: ['Ex Bob', 'ex_bob'], c: ['Ex Carol', 'ex_carol'] };

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  → ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
};

const users = {};
async function getUser(key) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  return data.users.find((u) => u.email === emails[key]);
}
async function mkUser(key) {
  const { data, error } = await admin.auth.admin.createUser({
    email: emails[key], password: PW, email_confirm: true,
    user_metadata: { name: names[key][0], handle: names[key][1] }
  });
  if (error) throw new Error(key + ': ' + error.message);
  users[key] = { id: data.user.id };
}
async function login(key) {
  if (!users[key]) users[key] = { id: (await getUser(key)).id };
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
const day = 86400000;
const iso = (d) => new Date(Date.now() + d * day).toISOString();
async function mkChallenge(byKey, title, participantKeys) {
  const { data, error } = await admin.from('challenges').insert({
    created_by: users[byKey].id, title, visibility: 'private',
    sport: 'any', goal_type: 'distance', goal_target: 100, goal_unit: 'km',
    start_date: iso(-1), end_date: iso(9), description: null, club_id: null
  }).select().single();
  if (error) throw new Error(error.message);
  for (const k of participantKeys) {
    await admin.from('challenge_participants').insert({ challenge_id: data.id, user_id: users[k].id });
  }
  return data;
}
async function mkInvite(chId, inviterKey, inviteeKey) {
  const { error } = await admin.from('challenge_invites').insert({
    challenge_id: chId, inviter_id: users[inviterKey].id, invitee_id: users[inviteeKey].id
  });
  if (error) throw new Error(error.message);
}

if (process.argv.includes('--seed')) {
  for (const k of Object.keys(emails)) { await mkUser(k); await login(k); }
  console.log('MANIFEST users:', JSON.stringify(Object.fromEntries(Object.entries(users).map(([k, v]) => [k, v.id]))));
  // A sends: X pending (B not joined), Z accepted (B joined).
  const X = await mkChallenge('a', 'EXINV-X sent-pending', ['a']);
  await mkInvite(X.id, 'a', 'b');
  const Z = await mkChallenge('a', 'EXINV-Z sent-accepted', ['a', 'b']);
  await mkInvite(Z.id, 'a', 'b');
  // A receives: Y accepted (A joined), W pending.
  const Y = await mkChallenge('b', 'EXINV-Y recv-accepted', ['b', 'a']);
  await mkInvite(Y.id, 'b', 'a');
  const W = await mkChallenge('b', 'EXINV-W recv-pending', ['b']);
  await mkInvite(W.id, 'b', 'a');
  console.log('MANIFEST challenges:', JSON.stringify([X.id, Z.id, Y.id, W.id]));
  // Capture the zero-invite user's export on the CURRENT (pre-change) code.
  const before = await exportFor('c');
  fs.writeFileSync(BEFORE_FILE, JSON.stringify(before, null, 2));
  console.log('Saved pre-change zero-invite export →', BEFORE_FILE);
  process.exit(0);
}

// ── --check phase ──
for (const k of Object.keys(emails)) await login(k);
const exA = await exportFor('a');
const inv = exA.challenge_invites;
check('challenge_invites section present with sent+received arrays',
  inv && Array.isArray(inv.sent) && Array.isArray(inv.received), inv && Object.keys(inv));

const byTitle = (rows) => Object.fromEntries((rows || []).map((r) => [r.challenge_title, r]));
const sent = byTitle(inv && inv.sent);
const recv = byTitle(inv && inv.received);
check('sent has exactly the 2 seeded invites', inv && inv.sent.length === 2, inv && inv.sent);
check('received has exactly the 2 seeded invites', inv && inv.received.length === 2, inv && inv.received);
check('sent pending derived (invitee not a participant)',
  sent['EXINV-X sent-pending'] && sent['EXINV-X sent-pending'].state === 'pending', sent);
check('sent accepted derived (invitee joined)',
  sent['EXINV-Z sent-accepted'] && sent['EXINV-Z sent-accepted'].state === 'accepted', sent);
check('received accepted derived (self joined)',
  recv['EXINV-Y recv-accepted'] && recv['EXINV-Y recv-accepted'].state === 'accepted', recv);
check('received pending derived (self not joined)',
  recv['EXINV-W recv-pending'] && recv['EXINV-W recv-pending'].state === 'pending', recv);
const allRows = [...(inv ? inv.sent : []), ...(inv ? inv.received : [])];
check('every row: counterparty is Bob by name+handle',
  allRows.length === 4 && allRows.every((r) => r.counterparty && r.counterparty.name === 'Ex Bob' && r.counterparty.handle === 'ex_bob'), allRows);
check('every row carries challenge_title and created_at',
  allRows.every((r) => r.challenge_title && r.created_at), allRows);
const invJson = JSON.stringify(inv);
check('no raw counterparty ids or emails in the invite section',
  !invJson.includes(users.b.id) && !invJson.includes('invitee_id') && !invJson.includes('inviter_id') && !invJson.includes('@'), invJson);

// Zero-invite user: honest empty arrays, and byte-level diff vs pre-change.
const exC = await exportFor('c');
check('zero-invite user gets empty arrays, not missing keys',
  exC.challenge_invites && Array.isArray(exC.challenge_invites.sent) && exC.challenge_invites.sent.length === 0
  && Array.isArray(exC.challenge_invites.received) && exC.challenge_invites.received.length === 0, exC.challenge_invites);
const before = JSON.parse(fs.readFileSync(BEFORE_FILE, 'utf8'));
const after = JSON.parse(JSON.stringify(exC));
delete before.generated_at; delete after.generated_at;
delete after.challenge_invites;
check('only difference vs pre-change export is the new challenge_invites key',
  JSON.stringify(Object.keys(before)) === JSON.stringify(Object.keys(after))
  && JSON.stringify(before) === JSON.stringify(after),
  { beforeKeys: Object.keys(before), afterKeys: Object.keys(after) });

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
