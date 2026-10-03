// Read-only frozen-founder proof. No sessions, fixtures, mutations or provider calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { createClient } = require('@supabase/supabase-js');
const { load } = require('./lib/goal-data-proof.cjs');
const ref = process.argv[2] || '49cde03';
const instant = '2026-10-03T23:05:08.745Z';
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
(async () => {
  const { data, error } = await db.auth.admin.getUserById('4e3cd18f-2c09-4ce9-ada1-67fbe725fcd4');
  if (error) throw error;
  const before = load(db, instant, ref), after = load(db, instant);
  for (const url of ['/api/profile/stats', '/api/goals']) {
    assert.deepEqual(await before.invoke(url, data.user), await after.invoke(url, data.user));
    console.log('PASS frozen founder full response: ' + url);
  }
  const acts = await after.ctx.fetchAllRows('activities',
    q => q.eq('user_id', data.user.id).order('date').order('id'), 'id,sport,distance,duration,date');
  const tz = after.ctx.getUserTimezone(data.user), today = after.ctx.dayKey(instant, tz);
  assert.equal(acts.filter(a => after.ctx.dayKey(a.date, tz) > today).length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(before.ctx.computeStreaks(acts, tz))),
    JSON.parse(JSON.stringify(after.ctx.computeStreaks(acts, tz))));
  const old = execFileSync('git', ['show', ref + ':artifacts/html-arenas/server.js'], { encoding: 'utf8', maxBuffer: 3000000 });
  const source = fs.readFileSync(require('node:path').join(__dirname, '../server.js'), 'utf8');
  // Entire unchanged caller regions, not just individual call lines. Given the
  // identical founder streak result above, every output in these regions is preserved.
  const regions = [
    ['Overview', "app.get(BASE + '/api/profile/overview'", "app.get(BASE + '/api/challenges'"],
    ['Challenges header', '// ── Header + sidebar stats', '// ── CHALLENGE'],
    ['feed sidebar', 'async function buildFeedSidebar(', 'function computePublicAthleteStats('],
    ['public athlete stats', 'function computePublicAthleteStats(', '// ──']
  ];
  for (const [name, start, end] of regions) {
    const a = source.indexOf(start);
    assert.ok(a >= 0, name + ' start');
    const b = source.indexOf(end, a + start.length);
    assert.ok(b > a, name + ' end');
    const segment = source.slice(a, b);
    assert.ok(old.includes(segment), name + ' caller source changed');
    console.log('PASS frozen founder ' + name + ': unchanged caller + identical shared streak input/output');
  }
  console.log('Future-day rows: 0; frozen=' + instant);
})().catch(e => { console.error(e.stack); process.exitCode = 1; });