'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dedupeUsersById, mostLoggedSportByUser } = require('./feed-sidebar-data');

test('feed suggestions keep one row per auth user id', () => {
  const first = { id: 'a', name: 'First page copy' };
  assert.deepEqual(
    dedupeUsersById([first, { id: 'b' }, { id: 'a', name: 'Overlapping page copy' }]),
    [first, { id: 'b' }]
  );
});

test('most-logged sport comes from activity counts with registry order as the tie-break', () => {
  const sports = [
    { id: 'running', label: 'Running' },
    { id: 'cycling', label: 'Cycling' }
  ];
  const rows = [
    { user_id: 'a', sport: 'cycling' },
    { user_id: 'a', sport: 'running' },
    { user_id: 'a', sport: 'cycling' },
    { user_id: 'b', sport: 'cycling' },
    { user_id: 'b', sport: 'running' },
    { user_id: 'b', sport: 'unknown' }
  ];
  assert.deepEqual(mostLoggedSportByUser(rows, sports), { a: 'Cycling', b: 'Running' });
});