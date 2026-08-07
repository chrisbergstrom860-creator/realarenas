// Seeded verification of recurring planned training sessions (plan_series +
// materialized planned_sessions occurrences).
//   - series creation produces EXACTLY the stated count
//   - caps enforced SERVER-SIDE (daily 92d / weekly-biweekly 366d / 100 rows)
//   - biweekly parity correct across a month boundary
//   - "this and future" delete spares done + skipped history
//   - a date-edited occurrence detaches (detached:true, series_id null) and
//     SURVIVES a later future-delete
//   - content edits (title etc.) do NOT detach
//   - "Log this" (activities/create + plan_id) still works on an occurrence
//   - single delete of the last occurrence tidies the series rule row
//   - account delete sweeps planned_sessions AND plan_series
//   - payloads carry series summaries; export includes plan_series rules
// Run with the dev server up:
//   node artifacts/html-arenas/scripts/verify-plan-recurrence.js
// Cleanup is built in.

const { createClient } = require('@supabase/supabase-js');
const BASE_URL = 'http://localhost:80/html';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const PW = 'ArenasTest!234';
const emails = { u: 'planrec-user@arenas-test.dev', x: 'planrec-acctdel@arenas-test.dev' };
const names = { u: ['Planrec User', 'planrec_user'], x: ['Planrec Acctdel', 'planrec_acctdel'] };

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
async function mkUser(k) {
  await deleteUserByEmail(emails[k]);
  const { data, error } = await admin.auth.admin.createUser({
    email: emails[k], password: PW, email_confirm: true,
    user_metadata: { name: names[k][0], handle: names[k][1] }
  });
  if (error) throw new Error(k + ': ' + error.message);
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

async function seriesRows(seriesId) {
  const { data, error } = await admin.from('planned_sessions')
    .select('id, date, status, series_id').eq('series_id', seriesId).order('date');
  if (error) throw new Error(error.message);
  return data || [];
}

async function main() {
  for (const k of ['u', 'x']) { await mkUser(k); await login(k); }
  console.log('MANIFEST users:', JSON.stringify({ u: users.u.id, x: users.x.id }));

  // ── 1. Exact count: weekly Friday series, 6 occurrences ──
  // 2026-09-04 is a Friday; until 2026-10-09 inclusive → 6 Fridays.
  let r = await api('u', 'POST', '/plans', {
    date: '2026-09-04', sport: 'running', title: 'Friday tempo',
    recurrence: { frequency: 'weekly', until: '2026-10-09' }
  });
  check('weekly create returns count 6', r.body && r.body.count === 6, r.body);
  check('weekly create returns 6 rows', r.body && (r.body.plans || []).length === 6, (r.body.plans || []).length);
  const wk = r.body.series;
  check('series weekday = 4 (Friday, 0=Mon)', wk && wk.weekday === 4, wk);
  let rows = await seriesRows(wk.id);
  check('DB holds exactly 6 occurrence rows', rows.length === 6, rows.length);
  check('all dates are Fridays, weekly stepped',
    rows.map(x => x.date).join(',') === '2026-09-04,2026-09-11,2026-09-18,2026-09-25,2026-10-02,2026-10-09',
    rows.map(x => x.date).join(','));

  // ── 2. Server-side caps (raw API, no form in the way) ──
  r = await api('u', 'POST', '/plans', { date: '2026-09-01', sport: 'running', recurrence: { frequency: 'daily', until: '2026-12-15' } });
  check('daily > 92 days → recurrence_too_long', r.status === 400 && r.body.error === 'recurrence_too_long', r);
  r = await api('u', 'POST', '/plans', { date: '2026-09-01', sport: 'running', recurrence: { frequency: 'weekly', until: '2027-09-15' } });
  check('weekly > 12 months → recurrence_too_long', r.status === 400 && r.body.error === 'recurrence_too_long', r);
  r = await api('u', 'POST', '/plans', { date: '2026-09-01', sport: 'running', recurrence: { frequency: 'daily', until: '2026-09-01' } });
  check('until == start → invalid_recurrence', r.status === 400 && r.body.error === 'invalid_recurrence', r);
  r = await api('u', 'POST', '/plans', { date: '2026-09-01', sport: 'running', recurrence: { frequency: 'monthly', until: '2026-10-01' } });
  check('unknown frequency → invalid_recurrence', r.status === 400 && r.body.error === 'invalid_recurrence', r);
  r = await api('u', 'POST', '/plans', { date: '2026-09-01', sport: 'running', recurrence: { frequency: 'weekly' } });
  check('missing until → invalid_recurrence', r.status === 400 && r.body.error === 'invalid_recurrence', r);

  // ── 3. Biweekly parity across a month boundary ──
  // 2026-08-28 (Fri) biweekly until 2026-10-31 → 28 Aug, 11 Sep, 25 Sep, 9 Oct, 23 Oct.
  r = await api('u', 'POST', '/plans', {
    date: '2026-08-28', sport: 'cycling', title: 'Long ride',
    recurrence: { frequency: 'biweekly', until: '2026-10-31' }
  });
  check('biweekly create returns count 5', r.body && r.body.count === 5, r.body);
  const bw = r.body.series;
  rows = await seriesRows(bw.id);
  check('biweekly parity holds across Aug→Sep→Oct',
    rows.map(x => x.date).join(',') === '2026-08-28,2026-09-11,2026-09-25,2026-10-09,2026-10-23',
    rows.map(x => x.date).join(','));

  // ── 4. Payload carries series summary ──
  r = await api('u', 'GET', '/plans?month=2026-09');
  const sept = (r.body.plans || []).filter(p => p.series_id === wk.id);
  check('/api/plans attaches series {frequency,end_date}', sept.length === 4 && sept.every(p => p.series && p.series.frequency === 'weekly' && p.series.end_date === '2026-10-09'), JSON.stringify(sept[0] && sept[0].series));
  const cal = await api('u', 'GET', '/calendar/month?month=2026-09');
  const calPlan = (cal.body.plans || []).find(p => p.series_id === wk.id);
  check('/api/calendar/month attaches series too', calPlan && calPlan.series && calPlan.series.frequency === 'weekly', JSON.stringify(calPlan && calPlan.series));

  // ── 5. Content edit does NOT detach; date edit DOES ──
  rows = await seriesRows(wk.id);
  const second = rows[1], third = rows[2];
  r = await api('u', 'PATCH', '/plans/' + second.id, { title: 'Tempo + strides', notes: 'faster finish' });
  check('content edit: no detached flag', r.body && r.body.plan && !r.body.detached, r.body);
  check('content edit: still in series', r.body.plan.series_id === wk.id, r.body.plan.series_id);
  r = await api('u', 'PATCH', '/plans/' + third.id, { date: '2026-09-19' });
  check('date edit: detached:true', r.body && r.body.detached === true, r.body);
  check('date edit: series_id cleared', r.body.plan.series_id === null, r.body.plan.series_id);
  const movedId = third.id;

  // ── 6. Mark occurrences done/skipped, then "this and future" ──
  rows = await seriesRows(wk.id); // 5 attached left (one detached)
  const doneRow = rows[3], skipRow = rows[4]; // 2026-10-02, 2026-10-09
  await api('u', 'PATCH', '/plans/' + doneRow.id, { status: 'done' });
  await api('u', 'PATCH', '/plans/' + skipRow.id, { status: 'skipped' });
  // Future-delete anchored at the SECOND occurrence (2026-09-11).
  r = await api('u', 'DELETE', '/plans/' + second.id + '?scope=future');
  check('future-delete ok', r.body && r.body.ok === true, r.body);
  rows = await seriesRows(wk.id);
  const leftDates = rows.map(x => x.date + ':' + x.status).join(',');
  check('future-delete spares done + skipped (and the earlier occurrence)',
    leftDates === '2026-09-04:planned,2026-10-02:done,2026-10-09:skipped', leftDates);
  const { data: movedRow } = await admin.from('planned_sessions').select('id').eq('id', movedId).maybeSingle();
  check('date-detached occurrence SURVIVES the future-delete', !!movedRow, movedRow);

  // ── 7. "Log this" on an occurrence ──
  const firstId = rows[0].id;
  r = await api('u', 'POST', '/activities/create', {
    sport: 'running', title: 'Friday tempo done', date: '2026-09-04', duration: '45:00', plan_id: firstId
  });
  check('activity create with plan_id → planCompleted', r.body && r.body.planCompleted === true, r.body);
  const { data: linked } = await admin.from('planned_sessions').select('status, activity_id, series_id').eq('id', firstId).single();
  check('occurrence now done + linked, STILL in series', linked.status === 'done' && !!linked.activity_id && linked.series_id === wk.id, JSON.stringify(linked));

  // ── 8. Single delete of the last attached rows tidies the series row ──
  rows = await seriesRows(bw.id);
  for (const row of rows) {
    const d = await api('u', 'DELETE', '/plans/' + row.id);
    if (!(d.body && d.body.ok)) check('biweekly occurrence delete', false, d.body);
  }
  const { data: bwSeries } = await admin.from('plan_series').select('id').eq('id', bw.id).maybeSingle();
  check('series rule row tidied after last occurrence deleted', !bwSeries, bwSeries);

  // ── 9. Export includes plan_series; account delete sweeps both tables ──
  const rx = await api('x', 'POST', '/plans', {
    date: '2026-09-07', sport: 'swimming', recurrence: { frequency: 'weekly', until: '2026-09-28' }
  });
  check('acctdel user series created (4)', rx.body && rx.body.count === 4, rx.body);
  const exp = await api('x', 'GET', '/account/export');
  check('export includes plan_series rules', Array.isArray(exp.body.plan_series) && exp.body.plan_series.length === 1 && exp.body.plan_series[0].frequency === 'weekly', JSON.stringify(exp.body.plan_series));
  check('export plan_series carries no ids', !JSON.stringify(exp.body.plan_series).match(/"id"|user_id/), JSON.stringify(exp.body.plan_series));
  const del = await api('x', 'POST', '/account/delete', { confirm: 'DELETE' });
  check('account delete ok', del.body && (del.body.ok === true || del.body.success === true), del.body);
  const { data: xPlans } = await admin.from('planned_sessions').select('id').eq('user_id', users.x.id);
  const { data: xSeries } = await admin.from('plan_series').select('id').eq('user_id', users.x.id);
  check('account delete swept planned_sessions', (xPlans || []).length === 0, xPlans);
  check('account delete swept plan_series', (xSeries || []).length === 0, xSeries);

  // ── Cleanup ──
  await admin.from('activities').delete().eq('user_id', users.u.id);
  await admin.from('planned_sessions').delete().eq('user_id', users.u.id);
  await admin.from('plan_series').delete().eq('user_id', users.u.id);
  await admin.from('notifications').delete().eq('user_id', users.u.id);
  for (const k of ['u']) {
    const { error } = await admin.auth.admin.deleteUser(users[k].id);
    check('cleanup: user ' + k + ' deleted', !error, error && error.message);
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
