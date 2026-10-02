const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { saveBanner, backfillBanner } = require('./profile-banner');
function fixture(failure) {
  const objects = new Map(), writes = [], removed = [];
  const origin = process.env.SUPABASE_URL || 'https://example.invalid';
  const url = path => origin + '/storage/v1/object/public/avatars/' + path;
  const db = { storage: { from: () => ({
    async upload(path, bytes) {
      if (failure === 'card' && path.endsWith('-card.webp')) return { error: Error('card upload failed') };
      objects.set(path, bytes); return {};
    },
    getPublicUrl: path => ({ data: { publicUrl: url(path) } }),
    async remove(paths) { removed.push(...paths); paths.forEach(p => objects.delete(p)); return {}; },
    async download(path) { const b = objects.get(path); return { data: new Blob([b]) }; }
  }) }, auth: { admin: {
    async updateUserById(id, value) { if (failure === 'metadata') return { error: Error('metadata failed') }; writes.push(value); return {}; },
    async getUserById() { return { data: { user: { user_metadata: { banner_url: url('banners/u/old.webp') } } } }; }
  } } };
  return { db, objects, writes, removed, url };
}
const source = () => sharp({ create: { width: 800, height: 200, channels: 3, background: '#446688' } }).png().toBuffer();
test('banner upload saves both sizes and only the two metadata pointers', async () => {
  const f = fixture(), result = await saveBanner(f.db, 'u', await source());
  assert.equal(f.objects.size, 2);
  for (const [path, bytes] of f.objects) {
    const m = await sharp(bytes).metadata();
    assert.equal(m.width, path.endsWith('-card.webp') ? 640 : 1600);
    assert.equal(m.height, path.endsWith('-card.webp') ? 160 : 400);
  }
  assert.deepEqual(f.writes[0], { user_metadata: result });
});
for (const failure of ['card', 'metadata']) test('failed ' + failure + ' rolls back replacements, preserves old banner', async () => {
  const f = fixture(failure);
  await assert.rejects(saveBanner(f.db, 'u', await source(), { banner_url: f.url('banners/u/old.webp') }));
  // Paths are validated against the configured Supabase origin.
  if (process.env.SUPABASE_URL) assert.equal(f.objects.size, 0);
  assert.ok(!f.removed.includes('banners/u/old.webp'));
  assert.equal(f.writes.length, 0);
});
test('backfill dry-run does not upload or write metadata', async () => {
  const f = fixture();
  if (!process.env.SUPABASE_URL) return;
  f.objects.set('banners/u/old.webp', await source());
  const r = await backfillBanner(f.db, { id: 'u', user_metadata: { banner_url: f.url('banners/u/old.webp') } });
  assert.equal(r.applied, false);
  assert.ok(r.variantBytes > 0);
  assert.equal(f.objects.size, 1);
  assert.equal(f.writes.length, 0);
});
test('backfill apply keeps the full banner and adds only the card pointer', async () => {
  const f = fixture();
  if (!process.env.SUPABASE_URL) return;
  f.objects.set('banners/u/old.webp', await source());
  const r = await backfillBanner(f.db, { id: 'u', user_metadata: { banner_url: f.url('banners/u/old.webp') } }, true);
  assert.equal(r.applied, true);
  assert.ok(f.objects.has('banners/u/old.webp'));
  assert.ok(f.objects.has('banners/u/old-card.webp'));
  assert.deepEqual(Object.keys(f.writes[0].user_metadata), ['banner_card_url']);
});
test('successful replacement retires both previous objects', async () => {
  const f = fixture();
  if (!process.env.SUPABASE_URL) return;
  await saveBanner(f.db, 'u', await source(), {
    banner_url: f.url('banners/u/old.webp'), banner_card_url: f.url('banners/u/old-card.webp')
  });
  assert.deepEqual(f.removed.sort(), ['banners/u/old-card.webp', 'banners/u/old.webp']);
});
test('unsupported bytes reject with client error before storage writes', async () => {
  const f = fixture();
  await assert.rejects(saveBanner(f.db, 'u', Buffer.from('not an image')), { status: 400 });
  assert.equal(f.objects.size, 0);
});
test('banner remove clears both pointers before deleting both objects', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const sourceCode = fs.readFileSync(require.resolve('./server'), 'utf8');
  const start = sourceCode.indexOf("app.delete(BASE + '/api/profile/banner'");
  let handler;
  const calls = [];
  vm.runInNewContext(sourceCode.slice(start, sourceCode.indexOf('\n});', start) + 4), {
    BASE: '', requireAuth() {}, app: { delete: (...args) => { handler = args.at(-1); } }, console,
    supabaseAdmin: { auth: { admin: { updateUserById: async (id, data) => {
      calls.push(JSON.parse(JSON.stringify(data))); return {};
    } } } },
    deleteAvatarObject: async url => { calls.push(url); }
  });
  let output;
  await handler({ user: { id: 'u', user_metadata: { banner_url: 'full', banner_card_url: 'card' } } },
    { json: data => { output = data; } });
  assert.deepEqual(calls, [{ user_metadata: { banner_url: null, banner_card_url: null } }, 'full', 'card']);
  assert.equal(output.success, true);
  const exportBlock = sourceCode.slice(sourceCode.indexOf('    const exportDoc = {'));
  assert.match(exportBlock, /profile: meta/);
  assert.match(sourceCode, /if \(meta\.banner_card_url\) await deleteAvatarObject\(meta\.banner_card_url, 'banners\/' \+ uid\)/);
});