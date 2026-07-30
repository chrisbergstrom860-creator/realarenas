// Seeded verification of real invite-only events (event_invites + the single
// canUserSeeEvent access rule).
//   - creator C, invitee I (C follows I → invitable), stranger S (follows I,
//     NOT invited — the feed-leak probe)
//   - zero-leak byte-diff: for S, every read-shaped route answers IDENTICALLY
//     for the real private event id and a random UUID
//   - RSVP gate, enum validation, invited list surface, calendar, feed HTML,
//     private "friend going" notification fan-out restriction,
//     revoke (refused after RSVP / allowed after cancel), re-RSVP after revoke
// Run with the dev server up:
//   node artifacts/html-arenas/scripts/verify-event-invites.js
// Cleanup is built in (also covered by scripts/test-data-sweep.js --delete).

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const BASE_URL = 'http://localhost:80/html';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const PW = 'ArenasTest!234';
const emails = {
  c: 'evinv-creator@arenas-test.dev',
  i: 'evinv-invitee@arenas-test.dev',
  s: 'evinv-stranger@arenas-test.dev'
};
const names = {
  c: ['Evinv Creator', 'evinv_creator'],
  i: ['Evinv Invitee', 'evinv_invitee'],
  s: ['Evinv Stranger', 'evinv_stranger']
};

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail ? ' — ' + String(detail).slice(0, 400) : '')); }
}

async function deleteUserByEmail(email) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of (data && data.users) || []) {
    if (u.email === email) await admin.auth.admin.deleteUser(u.id);
  }
}

const users = {};   // key → { id, cookie }

async function mkUser(key) {
  await deleteUserByEmail(emails[key]);
  const { data, error } = await admin.auth.admin.createUser({
    email: emails[key], password: PW, email_confirm: true,
    user_metadata: { name: names[key][0], handle: names[key][1] }
  });
  if (error) throw new Error(key + ': ' + error.message);
  users[key] = { id: data.user.id };
}

async function login(key) {
  const r = await fetch(BASE_URL + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(emails[key])}&password=${encodeURIComponent(PW)}`,
    redirect: 'manual'
  });
  const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')])
    .map(c => String(c).split(';')[0]).join('; ');
  if (!cookie) throw new Error('login failed for ' + key);
  users[key].cookie = cookie;
}

function api(key, path, opts = {}) {
  return fetch(BASE_URL + path, {
    ...opts,
    headers: {
      Cookie: users[key].cookie,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {})
    }
  });
}
async function apiJson(key, path, opts = {}) {
  const r = await api(key, path, opts);
  return { status: r.status, text: await r.text() };
}

async function main() {
  // ── Seed ──
  for (const k of ['c', 'i', 's']) { await mkUser(k); await login(k); }
  console.log('MANIFEST users:', JSON.stringify({ c: users.c.id, i: users.i.id, s: users.s.id }));
  // C follows I (invitable) and S (invitable but NOT invited); S follows I (feed probe).
  await admin.from('follows').insert([
    { follower_id: users.c.id, following_id: users.i.id },
    { follower_id: users.c.id, following_id: users.s.id },
    { follower_id: users.s.id, following_id: users.i.id }
  ]);

  const future = new Date(Date.now() + 7 * 86400000).toISOString();
  const TITLE = 'Evinv Secret Session';

  // ── Enum validation (crafted values) ──
  let r = await apiJson('c', '/api/events/create', {
    method: 'POST',
    body: JSON.stringify({ title: 'x', sport: 'running', date: future, location: 'x', visibility: 'sneaky' })
  });
  check('crafted visibility rejected', r.text.includes('Invalid visibility'), r.text);
  r = await apiJson('c', '/api/events/create', {
    method: 'POST',
    body: JSON.stringify({ title: 'x', sport: 'running', date: future, location: 'x', visibility: 'club' })
  });
  check('club visibility without club rejected', r.text.includes('need a club'), r.text);

  // ── Create the private event (invitee = I; self-invite attempt included) ──
  r = await apiJson('c', '/api/events/create', {
    method: 'POST',
    body: JSON.stringify({
      title: TITLE, sport: 'running', date: future, location: 'Hidden Trailhead',
      visibility: 'private', invitees: [users.i.id, users.c.id]
    })
  });
  const created = JSON.parse(r.text);
  check('private event created', !!(created.success && created.event), r.text);
  const EV = created.event.id;
  console.log('MANIFEST event:', EV);

  const { data: invRows } = await admin.from('event_invites').select('*').eq('event_id', EV);
  check('exactly one invite row (self-invite filtered)',
    (invRows || []).length === 1 && invRows[0].invitee_id === users.i.id, JSON.stringify(invRows));

  // ── Public control: invitees on a public event create NO rows ──
  r = await apiJson('c', '/api/events/create', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Evinv Public Run', sport: 'running', date: future, location: 'Town Square',
      visibility: 'public', invitees: [users.i.id]
    })
  });
  const pub = JSON.parse(r.text);
  check('public event created', !!(pub.success && pub.event), r.text);
  const PUBEV = pub.event.id;
  console.log('MANIFEST public event:', PUBEV);
  const { data: pubInv } = await admin.from('event_invites').select('*').eq('event_id', PUBEV);
  check('public event: notification-only, zero invite rows', (pubInv || []).length === 0, JSON.stringify(pubInv));

  // ── Visibility surfaces ──
  r = await apiJson('i', '/api/events');
  check('invitee list: event in invitedEvents', (() => {
    try { return (JSON.parse(r.text).invitedEvents || []).some(e => e.id === EV); } catch (e) { return false; }
  })(), r.text.slice(0, 200));
  r = await apiJson('s', '/api/events');
  check('stranger list: event id + title absent from entire payload',
    !r.text.includes(EV) && !r.text.includes(TITLE), r.text.slice(0, 300));

  // ── Zero-leak byte-diff for the stranger: real id vs random UUID ──
  const GHOST = crypto.randomUUID();
  const probes = [
    ['RSVP write', p => apiJson('s', `/api/events/${p}/rsvp`, { method: 'POST', body: JSON.stringify({ status: 'going' }) })],
    ['DELETE', p => apiJson('s', `/api/events/${p}`, { method: 'DELETE' })],
    ['PATCH', p => apiJson('s', `/api/events/${p}`, { method: 'PATCH', body: JSON.stringify({ title: 'hax' }) })],
    ['invites list', p => apiJson('s', `/api/events/${p}/invites`)],
    ['invite revoke', p => apiJson('s', `/api/events/${p}/invites/${users.i.id}`, { method: 'DELETE' })]
  ];
  for (const [label, fn] of probes) {
    const real = await fn(EV);
    const ghost = await fn(GHOST);
    check(`byte-diff ${label}: real === ghost`,
      real.status === ghost.status && real.text === ghost.text,
      `real ${real.status} ${real.text} | ghost ${ghost.status} ${ghost.text}`);
  }
  const { data: noRsvp } = await admin.from('event_rsvps').select('*').eq('event_id', EV).eq('user_id', users.s.id);
  check('stranger RSVP wrote nothing', (noRsvp || []).length === 0, JSON.stringify(noRsvp));

  // ── Invitee accepts (RSVP going) ──
  r = await apiJson('i', `/api/events/${EV}/rsvp`, { method: 'POST', body: JSON.stringify({ status: 'going' }) });
  check('invitee RSVP going succeeds', r.text.includes('"success":true'), r.text);
  const { data: invStill } = await admin.from('event_invites').select('*').eq('event_id', EV).eq('invitee_id', users.i.id);
  check('invite row RETAINED on accept', (invStill || []).length === 1, JSON.stringify(invStill));

  // Private "friend going" fan-out: S follows I but is NOT invited → no notif.
  const { data: sNotifs } = await admin.from('notifications')
    .select('id, body').eq('user_id', users.s.id).eq('actor_id', users.i.id);
  check('no friend-going notif to non-invited follower',
    !(sNotifs || []).some(n => (n.body || '').includes(TITLE)), JSON.stringify(sNotifs));
  const { data: cNotifs } = await admin.from('notifications')
    .select('id, title').eq('user_id', users.c.id).eq('actor_id', users.i.id);
  check('organiser did get the RSVP notif', (cNotifs || []).some(n => n.title === 'New RSVP'), JSON.stringify(cNotifs));

  // ── Calendar ──
  const mon = future.slice(0, 7);
  r = await apiJson('i', `/api/calendar/month?month=${mon}`);
  check('invitee calendar contains event', r.text.includes(EV), r.text.slice(0, 200));
  r = await apiJson('s', `/api/calendar/month?month=${mon}`);
  check('stranger calendar clean', !r.text.includes(EV) && !r.text.includes(TITLE), r.text.slice(0, 200));

  // ── Feed (server-rendered): S follows I, I is going → S's feed must be clean ──
  const feedHtml = await (await api('s', '/feed')).text();
  check('stranger /feed HTML free of private event', !feedHtml.includes(TITLE) && !feedHtml.includes(EV));

  // ── Invite manager states ──
  r = await apiJson('c', `/api/events/${EV}/invites`);
  check('creator invites list: invitee shown as joined', (() => {
    try {
      const rows = JSON.parse(r.text).invitees || [];
      return rows.length === 1 && rows[0].state === 'joined' && rows[0].name === names.i[0];
    } catch (e) { return false; }
  })(), r.text);

  // ── Revoke: refused after RSVP, allowed after cancel ──
  r = await apiJson('c', `/api/events/${EV}/invites/${users.i.id}`, { method: 'DELETE' });
  check('revoke refused after RSVP (already_joined)', r.text.includes('already_joined'), r.text);
  r = await apiJson('i', `/api/events/${EV}/rsvp`, { method: 'POST', body: JSON.stringify({ status: 'cancelled' }) });
  check('invitee cancels RSVP', r.text.includes('"success":true'), r.text);
  r = await apiJson('c', `/api/events/${EV}/invites`);
  check('cancelled RSVP returns invitee to pending', r.text.includes('"state":"pending"'), r.text);
  r = await apiJson('c', `/api/events/${EV}/invites/${users.i.id}`, { method: 'DELETE' });
  check('revoke succeeds once pending again', r.text.includes('"success":true'), r.text);

  // Revoked invitee is now fully locked out — identical to a stranger.
  r = await apiJson('i', '/api/events');
  check('revoked invitee: event gone from list', !r.text.includes(EV) && !r.text.includes(TITLE), r.text.slice(0, 300));
  const realR = await apiJson('i', `/api/events/${EV}/rsvp`, { method: 'POST', body: JSON.stringify({ status: 'going' }) });
  const ghostR = await apiJson('i', `/api/events/${GHOST}/rsvp`, { method: 'POST', body: JSON.stringify({ status: 'going' }) });
  check('revoked invitee re-RSVP: byte-identical to ghost id',
    realR.status === ghostR.status && realR.text === ghostR.text,
    `real ${realR.text} | ghost ${ghostR.text}`);

  // ── Cleanup (FK cascade removes invite rows with the events) ──
  await admin.from('event_rsvps').delete().in('event_id', [EV, PUBEV]);
  await admin.from('events').delete().in('id', [EV, PUBEV]);
  await admin.from('notifications').delete().in('user_id', [users.c.id, users.i.id, users.s.id]);
  await admin.from('notifications').delete().in('actor_id', [users.c.id, users.i.id, users.s.id]);
  await admin.from('follows').delete().in('follower_id', [users.c.id, users.i.id, users.s.id]);
  await admin.from('follows').delete().in('following_id', [users.c.id, users.i.id, users.s.id]);
  const { data: ghostInv } = await admin.from('event_invites').select('*').in('event_id', [EV, PUBEV]);
  check('invite rows gone after event delete (FK cascade)', (ghostInv || []).length === 0, JSON.stringify(ghostInv));
  for (const k of ['c', 'i', 's']) await admin.auth.admin.deleteUser(users[k].id);

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
