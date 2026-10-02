const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./server'), 'utf8');
function section(start, end) {
  const a = source.indexOf(start);
  return source.slice(a, source.indexOf(end, a));
}
function fixture(n = 14, rows = 2) {
  const users = Array.from({ length: n }, (_, i) => ({
    id: String(i), user_metadata: { sports: ['running', 'running', 'skiing', 'cycling'], name: 'Athlete' }, created_at: '2026-01-01'
  }));
  let requests = 0;
  const db = {
    auth: { admin: { async listUsers({ page, perPage }) {
      requests++; return { data: { users: users.slice((page - 1) * perPage, page * perPage) } };
    } } },
    from(table) {
      let from = 0, to = 999, viewer = false;
      const q = {
        select() { return q; }, range(a, b) { from = a; to = b; return q; },
        eq() { viewer = true; return q; }, in() { return q; }, order() { return q; },
        then(resolve) {
          requests++;
          const data = viewer ? [] : Array.from({ length: rows }, () =>
            table === 'posts' ? { user_id: '1' } : { following_id: '1' }).slice(from, to + 1);
          return Promise.resolve({ data }).then(resolve);
        }
      }; return q;
    }
  };
  const ctx = vm.createContext({
    supabaseAdmin: db, KNOWN_SPORTS: ['running', 'cycling'],
    prefsFromMeta: m => ({ show_on_leaderboards: m.prefs?.show_on_leaderboards !== false }),
    displayFromUser: u => ({ name: u.user_metadata.name })
  });
  vm.runInContext(section('async function fetchAllRows(', '// Full-coverage data export.'), ctx);
  vm.runInContext(section('async function buildAthleteDirectory(', '// Directory feed for'), ctx);
  return { users, run: () => ctx.buildAthleteDirectory('0'), requests: () => requests };
}
test('small directory stays four requests with normalized counts and raw sports retained', async () => {
  const f = fixture(), r = await f.run();
  assert.equal(f.requests(), 4);
  assert.equal(r.total, 13);
  assert.equal(r.athletes.length, 13);
  assert.equal(r.athletes[0].sportsCount, 2);
  assert.deepEqual([...r.athletes[0].sportsRegistry], ['running', 'cycling']);
  assert.equal(r.athletes[0].sports.length, 4);
  assert.equal(r.athletes[0].postCount, 2);
});
test('all auth pages scanned, cap stays 50 and opted-out users/viewer excluded', async () => {
  const f = fixture(215);
  f.users[1].user_metadata.prefs = { show_on_leaderboards: false };
  const r = await f.run();
  assert.equal(r.total, 213);
  assert.equal(r.athletes.length, 50);
  assert.ok(!r.athletes.some(a => a.id === '0' || a.id === '1'));
  assert.equal(f.requests(), 6);
});
test('post and follower counts paginate past the 1000-row response cap', async () => {
  const f = fixture(14, 2001), r = await f.run();
  assert.equal(r.athletes[0].postCount, 2001);
  assert.equal(r.athletes[0].followerCount, 2001);
  assert.equal(f.requests(), 8);
});
test('visitor following-list excludes opted-out identity before display mapping', async () => {
  const code = section('    const fUserMap = {};', '    const followingList =');
  const ctx = vm.createContext({
    followingIds: ['public', 'private', 'missing'],
    supabaseAdmin: { auth: { admin: { getUserById: async id => ({ data: {
      user: id === 'missing' ? null : { id, user_metadata: { prefs: { show_on_leaderboards: id !== 'private' } } }
    } }) } } },
    prefsFromMeta: m => ({ show_on_leaderboards: m.prefs.show_on_leaderboards }),
    displayFromUser: u => ({ name: u.id })
  });
  const result = await vm.runInContext('(async()=>{' + code + '; return fUserMap;})()', ctx);
  assert.deepEqual(Object.keys(result), ['public']);
});
test('truncated directory renders an explicit total, not a false platform count', () => {
  let renderer;
  const grid = { addEventListener() {}, innerHTML: '' }, count = {};
  const ctx = vm.createContext({ window: {}, document: { addEventListener() {} } });
  vm.runInContext(fs.readFileSync(require.resolve('./html/arenas-athlete-cards'), 'utf8'), ctx);
  renderer = ctx.window.ArenasAthleteCards.mount({ athletes: [], total: 71, gridEl: grid, countEl: count });
  renderer.render();
  assert.equal(count.textContent, 'Showing 0 of 71 — refine with search');
  ctx.window.avatarHtml = () => '<span class="adc-av">A</span>';
  renderer = ctx.window.ArenasAthleteCards.mount({
    athletes: Array.from({ length: 50 }, (_, i) => ({ id: String(i), name: 'Athlete', sports: [] })),
    total: 71, gridEl: grid, countEl: count
  });
  renderer.render();
  assert.equal(count.textContent, 'Showing 50 of 71 — refine with search');
});