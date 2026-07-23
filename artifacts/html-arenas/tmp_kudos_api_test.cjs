const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const M = require('/tmp/kudos_manifest.json');
const BASE = 'http://localhost:80/html';
const results = [];
const ok = (name, pass, detail) => { results.push({ name, pass, detail }); console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : '')); };

async function login(email) {
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password: M.password }),
    redirect: 'manual'
  });
  const cookie = (r.headers.getSetCookie() || []).map(c => c.split(';')[0]).join('; ');
  if (r.status !== 302 || !cookie) throw new Error('login failed for ' + email + ' status=' + r.status);
  return cookie;
}
const like = (cookie, actId) => fetch(BASE + '/api/activities/' + actId + '/like', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }
}).then(r => r.json());
const likeRows = (actId) => sb.from('activity_likes').select('*').eq('activity_id', actId).then(r => r.data || []);
const notifCount = (uid) => sb.from('notifications').select('*', { count: 'exact', head: true })
  .eq('user_id', uid).eq('type', 'like').then(r => r.count || 0);

(async () => {
  const { a, b, actA } = M.ids;
  const cookieB = await login('kudos.blair.e2e@arenas-test.dev');
  const cookieA = await login('kudos.alex.e2e@arenas-test.dev');

  // 1. B kudos A's activity → liked:true, one row, notification for A
  const n0 = await notifCount(a);
  const r1 = await like(cookieB, actA);
  ok('B kudos A activity → liked:true', r1.liked === true, JSON.stringify(r1));
  let rows = await likeRows(actA);
  ok('exactly 1 like row', rows.length === 1 && rows[0].user_id === b, 'rows=' + rows.length);
  await new Promise(res => setTimeout(res, 800));
  const n1 = await notifCount(a);
  ok('owner notification created (pref default on)', n1 === n0 + 1, n0 + ' -> ' + n1);

  // 2. Double-kudos blocked at DB level: direct duplicate insert → PK violation
  const dup = await sb.from('activity_likes').insert({ activity_id: actA, user_id: b });
  ok('duplicate insert blocked by primary key', !!dup.error && dup.error.code === '23505', dup.error ? dup.error.code + ' ' + dup.error.message : 'NO ERROR');

  // 3. Direct double-POST → toggles off (never a second row)
  const r2 = await like(cookieB, actA);
  rows = await likeRows(actA);
  ok('second POST toggles off, row removed', r2.liked === false && rows.length === 0, JSON.stringify(r2) + ' rows=' + rows.length);

  // 4. Self-kudos: A on own activity → allowed, NO notification
  const n2 = await notifCount(a);
  const r3 = await like(cookieA, actA);
  await new Promise(res => setTimeout(res, 800));
  const n3 = await notifCount(a);
  ok('self-kudos allowed (matches posts)', r3.liked === true, JSON.stringify(r3));
  ok('self-kudos NOT notified', n3 === n2, n2 + ' -> ' + n3);
  await like(cookieA, actA); // toggle off to reset

  // 5. Pref OFF: A turns off notify_kudos → B kudos → like row yes, notification NO
  const { data: au } = await sb.auth.admin.getUserById(a);
  const prevPrefs = (au.user.user_metadata && au.user.user_metadata.prefs) || {};
  await sb.auth.admin.updateUserById(a, { user_metadata: { prefs: { ...prevPrefs, notify_kudos: false } } });
  const n4 = await notifCount(a);
  const r4 = await like(cookieB, actA);
  await new Promise(res => setTimeout(res, 800));
  const n5 = await notifCount(a);
  rows = await likeRows(actA);
  ok('pref off: like row still written', r4.liked === true && rows.length === 1, JSON.stringify(r4) + ' rows=' + rows.length);
  ok('pref off: NO notification row (DB assert)', n5 === n4, n4 + ' -> ' + n5);
  // restore pref + reset like state
  await sb.auth.admin.updateUserById(a, { user_metadata: { prefs: { ...prevPrefs, notify_kudos: true } } });
  await like(cookieB, actA); // toggle off

  // 6. Clean notification rows created by this test (keep DB tidy for browser phase)
  await sb.from('notifications').delete().eq('user_id', a).eq('type', 'like');
  rows = await likeRows(actA);
  ok('reset: zero like rows before browser phase', rows.length === 0, 'rows=' + rows.length);

  const fails = results.filter(r => !r.pass).length;
  console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES');
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
