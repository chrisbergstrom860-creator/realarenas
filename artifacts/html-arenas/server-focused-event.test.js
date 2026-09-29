const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Extract the actual route and canonical access helpers without booting the
// server. The database below is read-only/in-memory; no credentials or network.
const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const id = '11111111-1111-1111-1111-111111111111';
const pastEvent = {
  id,
  date: '2020-01-01T00:00:00.000Z',
  title: 'Past event',
  created_by: 'other',
  visibility: 'public',
  club_id: null,
  image_path: 'private/path'
};

function section(startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1, `missing section start: ${startText}`);
  const end = source.indexOf(endText, start);
  assert.notEqual(end, -1, `missing section end: ${endText}`);
  return source.slice(start, end);
}

async function run({
  event,
  query = { event: id },
  member = false,
  invited = false,
  rsvp = false,
  extraEvents = []
} = {}) {
  const tables = {
    events: [...(event ? [event] : []), ...extraEvents],
    memberships: member ? [{ user_id: 'viewer', club_id: 'club', role: 'member' }] : [],
    event_invites: invited ? [{ invitee_id: 'viewer', event_id: id }] : [],
    event_rsvps: rsvp ? [{ user_id: 'viewer', event_id: id, status: 'going' }] : [],
    follows: [],
    clubs: [{ id: 'club', name: 'Club' }]
  };
  let handler;
  let idQueries = 0;
  const database = {
    from(table) {
      assert.ok(Object.hasOwn(tables, table), `unexpected table: ${table}`);
      let rows = [...tables[table]];
      return {
        select() { return this; },
        eq(key, value) {
          if (table === 'events' && key === 'id') idQueries++;
          rows = rows.filter(row => row[key] === value);
          return this;
        },
        in(key, values) {
          rows = rows.filter(row => values.includes(row[key]));
          return this;
        },
        gte(key, value) {
          rows = rows.filter(row => row[key] >= value);
          return this;
        },
        order(key, { ascending }) {
          rows.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (ascending ? 1 : -1));
          return this;
        },
        limit(count) { rows = rows.slice(0, count); return this; },
        maybeSingle() { return Promise.resolve({ data: rows[0] || null }); },
        then(resolve, reject) { return Promise.resolve({ data: rows }).then(resolve, reject); }
      };
    }
  };
  const context = vm.createContext({
    supabaseAdmin: database,
    app: { get(_path, _auth, callback) { handler = callback; } },
    BASE: '',
    requireAuth() {},
    buildUserDisplayMap: async () => ({ other: { name: 'Organizer' } }),
    eventImageVersion: () => 'version',
    console,
    Date,
    Set
  });
  vm.runInContext(
    section('function canUserSeeEvent(', '// THE single write-authorization rule') +
    section('async function getVisibleEvent(', 'const EVENT_TEXT_LIMITS ='),
    context
  );
  let body;
  await handler({ user: { id: 'viewer' }, query }, {
    json(value) { body = JSON.parse(JSON.stringify(value)); }
  });
  assert.equal(body.error, undefined);
  return { body, idQueries };
}

function eventRows(body) {
  return [...body.upcomingEvents, ...body.clubEvents, ...body.myCreatedEvents, ...body.invitedEvents];
}

for (const [label, event, options, list] of [
  ['public', pastEvent, {}, 'upcomingEvents'],
  ['member club', { ...pastEvent, visibility: 'club', club_id: 'club' }, { member: true }, 'clubEvents'],
  ['invited private', { ...pastEvent, visibility: 'private' }, { invited: true }, 'invitedEvents']
]) {
  test(`selected past ${label} event uses canonical access and shared enrichment`, async () => {
    const { body } = await run({ event, ...options, rsvp: true });
    assert.equal(eventRows(body).length, 1);
    assert.equal(body[list][0].id, id);
    assert.equal(body[list][0].image_path, undefined);
    assert.equal(body[list][0].image, 'version');
    assert.equal(body[list][0].creatorName, 'Organizer');
    assert.equal(body[list][0].goingCount, 1);
    assert.equal(body[list][0].myRsvpStatus, 'going');
    if (event.club_id) assert.deepEqual(body[list][0].clubs, { name: 'Club' });
  });
}

for (const [label, event, options] of [
  ['uninvited private', { ...pastEvent, visibility: 'private' }, {}],
  ['RSVP without invite', { ...pastEvent, visibility: 'private' }, { rsvp: true }],
  ['nonmember club', { ...pastEvent, visibility: 'club', club_id: 'club' }, {}],
  ['invite does not override club scope', { ...pastEvent, visibility: 'private', club_id: 'club' }, { invited: true }]
]) {
  test(`${label}: denied and missing responses are identical`, async () => {
    const denied = await run({ event, ...options });
    const missing = await run(options);
    assert.equal(eventRows(denied.body).length, 0);
    assert.deepEqual(denied.body, missing.body);
  });
}

for (const [label, event] of [
  ['created', { ...pastEvent, created_by: 'viewer' }],
  ['upcoming', { ...pastEvent, date: '2999-01-01T00:00:00.000Z' }]
]) {
  test(`focused ${label} event is not duplicated`, async () => {
    const focused = await run({ event });
    const normal = await run({ event, query: {} });
    assert.equal(eventRows(focused.body).length, 1);
    assert.deepEqual(focused.body, normal.body);
  });
}

test('absent and invalid query IDs preserve default lists without single-event lookup', async () => {
  for (const query of [{}, { event: '' }, { event: 'bad' }, { event: [id] }, { event: { id } }]) {
    const { body, idQueries } = await run({ event: pastEvent, query });
    assert.equal(eventRows(body).length, 0);
    assert.equal(idQueries, 0);
  }
});

test('focus includes only the selected past event, not the past listing', async () => {
  const extraEvents = [{ ...pastEvent, id: '22222222-2222-2222-2222-222222222222' }];
  const { body } = await run({ event: pastEvent, extraEvents });
  assert.deepEqual(eventRows(body).map(event => event.id), [id]);
});

test('focus can include a public event beyond the unchanged default cap', async () => {
  const event = { ...pastEvent, date: '2999-02-01T00:00:00.000Z' };
  const extraEvents = Array.from({ length: 50 }, (_, index) => ({
    ...pastEvent, id: `listed-${index}`, date: '2999-01-01T00:00:00.000Z'
  }));
  const normal = await run({ event, extraEvents, query: {} });
  const focused = await run({ event, extraEvents });
  assert.equal(normal.body.upcomingEvents.length, 50);
  assert.equal(normal.body.upcomingEvents.some(row => row.id === id), false);
  assert.equal(focused.body.upcomingEvents.length, 51);
  assert.equal(focused.body.upcomingEvents.filter(row => row.id === id).length, 1);
});

test('loadEvents forwards the encoded focus query and preserves the default URL', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'html/arenas-events.html'), 'utf8');
  const match = html.match(/function loadEvents\(\) \{[\s\S]*?\n  \}/);
  assert.ok(match, 'loadEvents exists');
  const calls = [];
  let focused = 0;
  const context = vm.createContext({
    URLSearchParams,
    window: { location: { search: `?event=${id}` } },
    B: '/html',
    fetch: async (url, options) => {
      calls.push({ url, credentials: options.credentials });
      return { json: async () => ({}) };
    },
    renderEvents() {},
    focusTargetEvent() { focused++; },
    console
  });
  vm.runInContext(match[0], context);
  await context.loadEvents();
  context.window.location.search = '';
  await context.loadEvents();
  context.window.location.search = '?event=value%26other%3D1';
  await context.loadEvents();
  assert.deepEqual(calls, [
    { url: `/html/api/events?event=${id}`, credentials: 'same-origin' },
    { url: '/html/api/events', credentials: 'same-origin' },
    { url: '/html/api/events?event=value%26other%3D1', credentials: 'same-origin' }
  ]);
  assert.equal(focused, 3);
});