const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function section(startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1, `missing section start: ${startText}`);
  const end = source.indexOf(endText, start);
  assert.notEqual(end, -1, `missing section end: ${endText}`);
  return source.slice(start, end);
}

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function database(writes) {
  return {
    from(table) {
      let result = { data: [], error: null };
      const query = {
        select() { return this; },
        eq() { return this; },
        neq() { return this; },
        in() { return this; },
        order() { return this; },
        maybeSingle() { return Promise.resolve(result); },
        single() { return Promise.resolve(result); },
        insert(value) {
          writes.push({ table, operation: 'insert', value });
          if (table === 'events') {
            result = { data: { id: 'new-event', ...value }, error: null };
          }
          return this;
        },
        update(value) {
          writes.push({ table, operation: 'update', value });
          result = { data: null, error: null };
          return this;
        },
        upsert(value) {
          writes.push({ table, operation: 'upsert', value });
          return this;
        },
        then(resolve, reject) {
          return Promise.resolve(result).then(resolve, reject);
        }
      };
      return query;
    }
  };
}

function loadRoutes({ visibleEvent, manageable = true } = {}) {
  const handlers = {};
  const writes = [];
  const context = vm.createContext({
    app: {
      post(route, _auth, handler) { handlers[`POST ${route}`] = handler; },
      patch(route, _auth, handler) { handlers[`PATCH ${route}`] = handler; }
    },
    BASE: '',
    requireAuth() {},
    supabaseAdmin: database(writes),
    EVENT_VISIBILITIES: ['public', 'club', 'private'],
    getVisibleEvent: async () => visibleEvent,
    canManageEvent: async () => manageable,
    displayFromUser: () => ({ name: 'Athlete' }),
    createNotification: async () => {},
    console,
    Date,
    Set
  });
  const limitsAndCreate = section(
    'const EVENT_TEXT_LIMITS = Object.freeze({',
    '// RSVP to an event'
  );
  const patch = section(
    "app.patch(BASE + '/api/events/:id'",
    '// Events page: inject'
  );
  vm.runInContext(`${limitsAndCreate}\n${patch}`, context);
  return { handlers, writes };
}

function createRequest(body) {
  return { body, user: { id: 'user-1' }, params: {} };
}

function patchRequest(body) {
  return { body, user: { id: 'user-1' }, params: { id: 'event-1' } };
}

const validCreate = {
  title: 'Run',
  sport: 'running',
  date: '2030-01-01T10:00:00.000Z',
  location: 'Park',
  description: 'Easy pace',
  visibility: 'public'
};

const existingEvent = {
  id: 'event-1',
  created_by: 'user-1',
  club_id: null,
  visibility: 'public',
  title: 'Run',
  date: '2030-01-01T10:00:00.000Z',
  location: 'Park'
};

test('actual create route accepts every exact text boundary', async () => {
  const { handlers, writes } = loadRoutes();
  const res = response();
  await handlers['POST /api/events/create'](createRequest({
    ...validCreate,
    title: 't'.repeat(80),
    location: 'l'.repeat(120),
    description: 'd'.repeat(500)
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(writes.filter((write) => write.table === 'events').length, 1);
});

for (const [field, max, label] of [
  ['title', 80, 'Title'],
  ['location', 120, 'Location'],
  ['description', 500, 'Description']
]) {
  test(`actual create route rejects over-limit ${field} without writes`, async () => {
    const { handlers, writes } = loadRoutes();
    const res = response();
    await handlers['POST /api/events/create'](createRequest({
      ...validCreate,
      [field]: ' '.repeat(max + 1)
    }), res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(plain(res.body), { error: `${label} must be ${max} characters or less.` });
    assert.deepEqual(writes, []);
  });
}

test('actual patch route accepts every exact text boundary', async () => {
  const boundaryEvent = { ...existingEvent, location: 'l'.repeat(120) };
  const { handlers, writes } = loadRoutes({ visibleEvent: boundaryEvent });
  const res = response();
  await handlers['PATCH /api/events/:id'](patchRequest({
    title: 't'.repeat(80),
    location: 'l'.repeat(120),
    description: 'd'.repeat(500)
  }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(plain(res.body), { success: true });
  assert.deepEqual(plain(writes), [{
    table: 'events',
    operation: 'update',
    value: {
      title: 't'.repeat(80),
      location: 'l'.repeat(120),
      description: 'd'.repeat(500)
    }
  }]);
});

for (const [field, max, label] of [
  ['title', 80, 'Title'],
  ['location', 120, 'Location'],
  ['description', 500, 'Description']
]) {
  test(`actual patch route rejects supplied over-limit ${field} without writes`, async () => {
    const { handlers, writes } = loadRoutes({ visibleEvent: existingEvent });
    const res = response();
    await handlers['PATCH /api/events/:id'](
      patchRequest({ [field]: ' '.repeat(max + 1) }),
      res
    );
    assert.equal(res.statusCode, 400);
    assert.deepEqual(plain(res.body), { error: `${label} must be ${max} characters or less.` });
    assert.deepEqual(writes, []);
  });
}

test('patching an unrelated field preserves a legacy over-limit event', async () => {
  const legacy = {
    ...existingEvent,
    title: 't'.repeat(81),
    location: 'l'.repeat(121),
    description: 'd'.repeat(501)
  };
  const { handlers, writes } = loadRoutes({ visibleEvent: legacy });
  const res = response();
  await handlers['PATCH /api/events/:id'](patchRequest({ event_type: 'social' }), res);
  assert.deepEqual(plain(res.body), { success: true });
  assert.deepEqual(plain(writes), [{
    table: 'events',
    operation: 'update',
    value: { event_type: 'social' }
  }]);
  assert.equal(legacy.title.length, 81);
  assert.equal(legacy.location.length, 121);
  assert.equal(legacy.description.length, 501);
});

test('create visibility gate still precedes text limits', async () => {
  const { handlers, writes } = loadRoutes();
  const res = response();
  await handlers['POST /api/events/create'](createRequest({
    ...validCreate,
    visibility: 'secret',
    title: 't'.repeat(81)
  }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(plain(res.body), { error: 'Invalid visibility' });
  assert.deepEqual(writes, []);
});

test('patch missing and unauthorized gates still precede text limits', async () => {
  const missing = loadRoutes({ visibleEvent: null });
  const missingRes = response();
  await missing.handlers['PATCH /api/events/:id'](
    patchRequest({ title: 't'.repeat(81) }),
    missingRes
  );
  assert.equal(missingRes.statusCode, 200);
  assert.deepEqual(plain(missingRes.body), { error: 'Event not found' });
  assert.deepEqual(missing.writes, []);

  const denied = loadRoutes({ visibleEvent: existingEvent, manageable: false });
  const deniedRes = response();
  await denied.handlers['PATCH /api/events/:id'](
    patchRequest({ title: 't'.repeat(81) }),
    deniedRes
  );
  assert.equal(deniedRes.statusCode, 200);
  assert.deepEqual(plain(deniedRes.body), { error: 'You do not have permission to edit this event' });
  assert.deepEqual(denied.writes, []);
});