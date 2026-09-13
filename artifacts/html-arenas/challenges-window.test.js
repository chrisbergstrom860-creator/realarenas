'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  challengeFetchRange,
  challengeWindowFor,
  selectChallengeProgressActivities,
  activityReadErrorForProgress
} = require('./challenges-query');

const challenge = {
  start_date: '2026-08-01T00:00:00.000Z',
  end_date: '2026-08-03T00:00:00.000Z'
};

function oldInclusiveQueryPredicate(rows, selectedChallenge, tz) {
  const window = challengeWindowFor(selectedChallenge, tz);
  const paddedRange = challengeFetchRange(selectedChallenge);
  // The pre-consolidation route first fetched the padded instant range with
  // gte/lte, then applied the participant-zone window before computing
  // progress. Keep both halves here rather than testing only the final
  // predicate.
  return rows.filter((row) => {
    const at = new Date(row.date).getTime();
    return at >= new Date(paddedRange.gteIso).getTime()
      && at <= new Date(paddedRange.lteIso).getTime();
  }).filter((row) => {
    const at = new Date(row.date).getTime();
    return at >= window.startMs && at <= window.endMs;
  });
}

test('challenge window keeps old inclusive start/end behavior at every edge', () => {
  for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
    const window = challengeWindowFor(challenge, tz);
    const rows = [
      { id: 'before', date: new Date(window.startMs - 1000).toISOString() },
      { id: 'start', date: new Date(window.startMs).toISOString() },
      { id: 'end', date: new Date(window.endMs).toISOString() },
      { id: 'after', date: new Date(window.endMs + 1000).toISOString() }
    ];
    const oldSelection = oldInclusiveQueryPredicate(rows, challenge, tz).map((row) => row.id);
    const newSelection = selectChallengeProgressActivities(rows, challenge, tz)
      .map((row) => row.id);
    assert.deepEqual(newSelection, oldSelection, `${tz} boundary selection changed`);
    assert.deepEqual(newSelection, ['start', 'end']);
  }
});

test('non-midnight challenge dates keep padded and participant-zone predicates separate', () => {
  const nonMidnight = {
    start_date: '2026-08-01T22:54:00.000Z',
    end_date: '2026-08-03T22:54:00.000Z'
  };
  for (const [tz, expected] of [
    ['Asia/Tokyo', ['end']],
    ['Pacific/Kiritimati', ['end']],
    ['America/Los_Angeles', ['start', 'end']]
  ]) {
    const window = challengeWindowFor(nonMidnight, tz);
    const rows = [
      { id: 'before-padded', date: new Date(new Date(nonMidnight.start_date).getTime() - 86400000 - 1000).toISOString() },
      { id: 'start', date: new Date(window.startMs).toISOString() },
      { id: 'end', date: new Date(window.endMs).toISOString() },
      { id: 'after', date: new Date(window.endMs + 1000).toISOString() }
    ];
    const oldSelection = oldInclusiveQueryPredicate(rows, nonMidnight, tz).map((row) => row.id);
    const newSelection = selectChallengeProgressActivities(rows, nonMidnight, tz)
      .map((row) => row.id);
    assert.deepEqual(newSelection, oldSelection, `${tz} non-midnight selection changed`);
    assert.deepEqual(newSelection, expected);
  }
});

test('DST transition keeps old padded + local-midnight edges exact', () => {
  const dstChallenge = {
    start_date: '2026-03-07T00:00:00.000Z',
    end_date: '2026-03-10T00:00:00.000Z'
  };
  const tz = 'America/Los_Angeles';
  const window = challengeWindowFor(dstChallenge, tz);
  const rows = [
    { id: 'before', date: new Date(window.startMs - 1000).toISOString() },
    { id: 'start', date: new Date(window.startMs).toISOString() },
    { id: 'end', date: new Date(window.endMs).toISOString() },
    { id: 'after', date: new Date(window.endMs + 1000).toISOString() }
  ];
  assert.deepEqual(
    selectChallengeProgressActivities(rows, dstChallenge, tz).map((row) => row.id),
    oldInclusiveQueryPredicate(rows, dstChallenge, tz).map((row) => row.id)
  );
  assert.deepEqual(
    selectChallengeProgressActivities(rows, dstChallenge, tz).map((row) => row.id),
    ['start', 'end']
  );
});

test('challenge fetch bounds still contain all participant-zone boundary rows', () => {
  for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
    const window = challengeWindowFor(challenge, tz);
    const range = challengeFetchRange(challenge);
    assert.ok(window.startMs >= new Date(range.gteIso).getTime(), `${tz} start fell outside fetch range`);
    assert.ok(window.endMs <= new Date(range.lteIso).getTime(), `${tz} end fell outside fetch range`);
  }
});

test('viewer activity transport failure only rethrows for an existing joined challenge', () => {
  const transportError = new Error('activities transport unavailable');
  const failedRead = { data: [], errorThrown: transportError };
  assert.equal(
    activityReadErrorForProgress(
      failedRead,
      ['joined-existing'],
      [{ id: 'joined-existing' }]
    ),
    transportError
  );
  assert.equal(
    activityReadErrorForProgress(
      failedRead,
      ['joined-missing'],
      [{ id: 'different-challenge' }]
    ),
    null
  );
  // A resolved PostgREST { error } result remains the old empty-data path;
  // only a rejected transport is retained for the progress boundary.
  assert.equal(
    activityReadErrorForProgress(
      { data: [], error: { message: 'query failed' }, errorThrown: null },
      ['joined-existing'],
      [{ id: 'joined-existing' }]
    ),
    null
  );
});