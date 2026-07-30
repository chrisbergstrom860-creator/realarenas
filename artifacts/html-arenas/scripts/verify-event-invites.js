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
  i2: 'evinv-invitee2@arenas-test.dev',
  s: 'evinv-stranger@arenas-test.dev'
};
const names = {
  c: ['Evinv Creator', 'evinv_creator'],
  i: ['Evinv Invitee', 'evinv_invitee'],
  i2: ['Evinv Invitee Two', 'evinv_invitee2'],
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
  for (const k of ['c', 'i', 'i2', 's']) { await mkUser(k); await login(k); }
  console.log('MANIFEST users:', JSON.stringify({ c: users.c.id, i: users.i.id, i2: users.i2.id, s: users.s.id }));
  // C follows I and I2 (invitable) and S (invitable but NOT invited); S follows I (feed probe).
  await admin.from('follows').insert([
    { follower_id: users.c.id, following_id: users.i.id },
    { follower_id: users.c.id, following_id: users.i2.id },
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
    ['invite-more POST', p => apiJson('s', `/api/events/${p}/invites`, { method: 'POST', body: JSON.stringify({ invitees: [users.i2.id] }) })],
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

  // ── Invite-more (post-creation batches) ──
  // Re-invite of revoked I → fresh row + fresh notification (challenge pattern).
  const notifCountBefore = async (uid) => {
    const { data } = await admin.from('notifications').select('id').eq('user_id', uid).eq('title', 'Event invite');
    return (data || []).length;
  };
  const iNotifs0 = await notifCountBefore(users.i.id);
  r = await apiJson('c', `/api/events/${EV}/invites`, { method: 'POST', body: JSON.stringify({ invitees: [users.i.id, users.i2.id] }) });
  check('invite-more: revoked I + new I2 both invited', r.text.includes('"invitedCount":2'), r.text);
  check('re-invite of revoked person got a fresh notification', (await notifCountBefore(users.i.id)) === iNotifs0 + 1);
  const i2Notifs1 = await notifCountBefore(users.i2.id);
  check('new invitee got a notification', i2Notifs1 === 1);

  // Re-inviting still-pending people = no-op, no duplicate notification.
  r = await apiJson('c', `/api/events/${EV}/invites`, { method: 'POST', body: JSON.stringify({ invitees: [users.i2.id] }) });
  check('re-invite pending: no-op (invitedCount 0)', r.text.includes('"invitedCount":0'), r.text);
  check('re-invite pending: no duplicate notification', (await notifCountBefore(users.i2.id)) === i2Notifs1);

  // New invitee has access via the SAME rule: sees event, can RSVP.
  r = await apiJson('i2', '/api/events');
  check('invite-more invitee sees event in invitedEvents', r.text.includes(EV));
  r = await apiJson('i2', `/api/events/${EV}/rsvp`, { method: 'POST', body: JSON.stringify({ status: 'going' }) });
  check('invite-more invitee can RSVP', r.text.includes('"success":true'), r.text);

  // Already-RSVP'd people are excluded (I2 just RSVP'd): server-side no-op.
  r = await apiJson('c', `/api/events/${EV}/invites`, { method: 'POST', body: JSON.stringify({ invitees: [users.i2.id] }) });
  check('already-RSVPd excluded (invitedCount 0)', r.text.includes('"invitedCount":0'), r.text);

  // Cap is TOTAL across batches: pad to 50 rows with ghost invitees (table has
  // no invitee FK), then one more valid invite must refuse with invite_limit.
  const { data: capRowsNow } = await admin.from('event_invites').select('invitee_id').eq('event_id', EV);
  const padCount = 50 - (capRowsNow || []).length;
  const ghosts = Array.from({ length: padCount }, () => ({ event_id: EV, invitee_id: crypto.randomUUID(), inviter_id: users.c.id }));
  await admin.from('event_invites').insert(ghosts);
  r = await apiJson('c', `/api/events/${EV}/invites`, { method: 'POST', body: JSON.stringify({ invitees: [users.s.id] }) });
  check('cap 50 enforced across batches (invite_limit)', r.text.includes('invite_limit'), r.text);
  await admin.from('event_invites').delete().eq('event_id', EV).in('invitee_id', ghosts.map(g => g.invitee_id));

  // Cap RACE: at 49 rows, two concurrent single-invite batches. The pre-check
  // is read-then-write, so both may pass — the post-insert re-count backstop
  // must guarantee the total never exceeds 50 and nobody rolled-back is
  // notified. (Each response is either success or invite_limit.)
  const { data: raceRowsNow } = await admin.from('event_invites').select('invitee_id').eq('event_id', EV);
  const racePad = 49 - (raceRowsNow || []).length;
  const raceGhosts = Array.from({ length: racePad }, () => ({ event_id: EV, invitee_id: crypto.randomUUID(), inviter_id: users.c.id }));
  await admin.from('event_invites').insert(raceGhosts);
  // Two fresh followed users as the racing invitees.
  emails.r1 = 'evinv-race1@arenas-test.dev'; names.r1 = ['Evinv Race One', 'evinv_race1'];
  emails.r2 = 'evinv-race2@arenas-test.dev'; names.r2 = ['Evinv Race Two', 'evinv_race2'];
  await mkUser('r1'); await mkUser('r2');
  await admin.from('follows').insert([
    { follower_id: users.c.id, following_id: users.r1.id },
    { follower_id: users.c.id, following_id: users.r2.id }
  ]);
  const [ra, rb] = await Promise.all([
    apiJson('c', `/api/events/${EV}/invites`, { method: 'POST', body: JSON.stringify({ invitees: [users.r1.id] }) }),
    apiJson('c', `/api/events/${EV}/invites`, { method: 'POST', body: JSON.stringify({ invitees: [users.r2.id] }) })
  ]);
  const raceOk = [ra, rb].every(x => x.text.includes('"invitedCount":1') || x.text.includes('invite_limit'));
  const { data: afterRace } = await admin.from('event_invites').select('invitee_id').eq('event_id', EV);
  check('cap race: every response success-or-limit', raceOk, ra.text + ' | ' + rb.text);
  check('cap race: total rows never exceed 50', (afterRace || []).length <= 50, String((afterRace || []).length));
  const surviving = new Set((afterRace || []).map(x => x.invitee_id));
  for (const k of ['r1', 'r2']) {
    const { data: n } = await admin.from('notifications').select('id').eq('user_id', users[k].id).eq('title', 'Event invite');
    check(`cap race: ${k} notified iff row survived`, ((n || []).length > 0) === surviving.has(users[k].id));
  }
  await admin.from('event_invites').delete().eq('event_id', EV).in('invitee_id',
    raceGhosts.map(g => g.invitee_id).concat([users.r1.id, users.r2.id]));
  await admin.from('follows').delete().in('following_id', [users.r1.id, users.r2.id]);
  await admin.from('notifications').delete().in('user_id', [users.r1.id, users.r2.id]);
  for (const k of ['r1', 'r2']) await admin.auth.admin.deleteUser(users[k].id);

  // Past event: invite-more blocked with an explicit message.
  await admin.from('events').update({ date: new Date(Date.now() - 86400000).toISOString() }).eq('id', EV);
  r = await apiJson('c', `/api/events/${EV}/invites`, { method: 'POST', body: JSON.stringify({ invitees: [users.s.id] }) });
  check('past event: invite-more blocked', r.text.includes('already happened'), r.text);
  await admin.from('events').update({ date: future }).eq('id', EV);

  // Public event: invite-more refused (private-only surface).
  r = await apiJson('c', `/api/events/${PUBEV}/invites`, { method: 'POST', body: JSON.stringify({ invitees: [users.i2.id] }) });
  check('public event: invite-more refused', r.text.includes('Only private events use invites'), r.text);

  // ── Cleanup (FK cascade removes invite rows with the events) ──
  await admin.from('event_rsvps').delete().in('event_id', [EV, PUBEV]);
  await admin.from('events').delete().in('id', [EV, PUBEV]);
  const allIds = ['c', 'i', 'i2', 's'].map(k => users[k].id);
  await admin.from('notifications').delete().in('user_id', allIds);
  await admin.from('notifications').delete().in('actor_id', allIds);
  await admin.from('follows').delete().in('follower_id', allIds);
  await admin.from('follows').delete().in('following_id', allIds);
  const { data: ghostInv } = await admin.from('event_invites').select('*').in('event_id', [EV, PUBEV]);
  check('invite rows gone after event delete (FK cascade)', (ghostInv || []).length === 0, JSON.stringify(ghostInv));
  for (const k of ['c', 'i', 'i2', 's']) await admin.auth.admin.deleteUser(users[k].id);

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
