const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const duration = require('./html/arenas-duration');
const parse = require('./html/arenas-parse');

test('running 5:30 over 1 km warns, explicit switch resolves to 5:30/km', () => {
  const result = duration.inspect('5:30', 'running', '1 km');
  assert.equal(result.label, '5 h 30 min');
  assert.equal(result.warning.pace, '330:00');
  assert.equal(result.warning.alternativeValue, '0:05:30');
  const switched = duration.inspect(result.warning.alternativeValue, 'running', '1 km');
  assert.equal(switched.label, '5 min 30 s');
  assert.equal(switched.warning, undefined);
  assert.equal(parse.formatPace(switched.hours * 60), '5:30');
});
test('45:00 for a 5 km run is 45 minutes and has no warning', () => {
  const result = duration.inspect('45:00', 'running', '5 km');
  assert.equal(result.label, '45 min');
  assert.equal(result.warning, undefined);
});
test('non-running sports show interpretation but never a plausibility warning', () => {
  for (const sport of ['cycling', 'swimming', 'hiking', 'yoga']) {
    const result = duration.inspect('5:30', sport, '1 km');
    assert.equal(result.label, '5 h 30 min');
    assert.equal(result.warning, undefined);
  }
});
test('thresholds are inclusive and require distance', () => {
  for (const [value, km] of [['20:00', '10 km'], ['20:00', '1 km'], ['5:30', '']]) {
    assert.equal(duration.inspect(value, 'running', km).warning, undefined);
  }
});
test('invalid new values cannot pass permissive historical parsing', () => {
  for (const value of ['', null, {}, '0', 'garbage', '-45', '1:02:', '1:75:00', '1:60', '1::02', '1:00:60', '1:2:3:4', '45xyz']) {
    assert.equal(duration.validate(value).valid, false, String(value));
  }
  for (const value of ['45', '1', '45 min', '1h 30m', '1 hour 30 minutes', '0:59:59', '2:00:00', '45:00', '1:02:15']) {
    assert.equal(duration.validate(value).valid, true, value);
  }
});
test('browser and Node use the identical duration decisions', () => {
  const ctx = vm.createContext({window: {}});
  for (const file of ['arenas-parse', 'arenas-duration']) vm.runInContext(fs.readFileSync(require.resolve('./html/' + file), 'utf8'), ctx);
  assert.equal(JSON.stringify(ctx.window.arenasDuration.inspect('5:30', 'running', '1 km')),
    JSON.stringify(duration.inspect('5:30', 'running', '1 km')));
});

// Execute the actual POST handler, with no real database or HTTP dependencies.
const source = fs.readFileSync(require.resolve('./server'), 'utf8');
const start = source.indexOf("app.post(BASE + '/api/activities/create'");
const end = source.indexOf('\n});', start) + 4;
function apiFixture() {
  let handler;
  const inserted = [];
  const db = {from(table) {
    return {
      insert(row) {
        inserted.push(row);
        return {select() { return {async single() {return {data: {...row, id: 'fixture'}, error: null};}};}};
      },
      select() {return {eq() {return Promise.resolve({data: [], count: 2, error: null});}};}
    };
  }};
  vm.runInNewContext(source.slice(start, end), {
    app: {post(...args) {handler = args.at(-1);}}, BASE: '', requireAuth() {},
    supabaseAdmin: db, validateActivityDuration: duration.validate,
    prefsFromMeta: () => ({activity_feed_visible: false}),
    displayFromUser: () => ({name: 'Fixture'}), checkAchievements: async () => {}, getUserTimezone: () => 'UTC', console
  });
  return {inserted, async call(value) {
    const res = {statusCode: 200, status(code) {this.statusCode = code; return this;}, json(body) {this.body = body; return this;}};
    await handler({body: {sport: 'running', title: 'Duration check', duration: value}, user: {id: 'fixture-user', user_metadata: {prefs: {activity_feed_visible: false}}}}, res);
    return res;
  }};
}
test('API rejects invalid durations with HTTP 400 before any database access', async () => {
  for (const value of ['', null, '0', 'garbage', '1:02:', '1:75:00', '45xyz']) {
    const fixture = apiFixture(), result = await fixture.call(value);
    assert.equal(result.statusCode, 400, String(value));
    assert.equal(result.body.field, 'duration');
    assert.equal(fixture.inserted.length, 0);
  }
});
test('API persists explicit switched duration, preserving preview/server agreement', async () => {
  const fixture = apiFixture();
  const value = duration.inspect('5:30', 'running', '1km').warning.alternativeValue;
  const result = await fixture.call(value);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.success, true);
  assert.equal(fixture.inserted[0].duration, '0:05:30');
  assert.equal(parse.formatPace(parse.parseDurationHours(fixture.inserted[0].duration) * 60), '5:30');
});