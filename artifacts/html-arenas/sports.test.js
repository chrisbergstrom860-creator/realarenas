'use strict';

// Equivalence tests for the SPORTS registry (the computeStreaks standard):
// the derived constants must be IDENTICAL to the hand-written literals they
// replaced, so converting the app to the registry is a zero-behavior change.

const test = require('node:test');
const assert = require('node:assert');
const {
  SPORTS,
  SPORT_POINTS,
  KNOWN_SPORTS,
  DISTANCE_SPORTS,
  SPORT_ICONS,
  LEGACY_SPORT_EMOJI
} = require('./sports');

test('registry has exactly the 8 sports, in the historic SPORT_POINTS order', () => {
  assert.deepStrictEqual(
    SPORTS.map((s) => s.id),
    ['running', 'cycling', 'climbing', 'swimming', 'football', 'hiking', 'weightlifting', 'yoga']
  );
});

test('derived SPORT_POINTS is identical to the historic literal', () => {
  assert.deepStrictEqual(SPORT_POINTS, {
    running: { per: 'km', rate: 10 },
    cycling: { per: 'km', rate: 6 },
    climbing: { per: 'session', rate: 50 },
    swimming: { per: 'session', rate: 40 },
    football: { per: 'session', rate: 30 },
    hiking: { per: 'session', rate: 30 },
    weightlifting: { per: 'session', rate: 20 },
    yoga: { per: 'session', rate: 20 }
  });
});

test('derived KNOWN_SPORTS is identical to Object.keys(historic SPORT_POINTS)', () => {
  assert.deepStrictEqual(
    KNOWN_SPORTS,
    ['running', 'cycling', 'climbing', 'swimming', 'football', 'hiking', 'weightlifting', 'yoga']
  );
});

test('derived DISTANCE_SPORTS is identical to the historic literal', () => {
  assert.deepStrictEqual(DISTANCE_SPORTS, ['running', 'cycling', 'swimming', 'hiking']);
});

test('labels and emoji match the strings every surface rendered', () => {
  const expected = {
    running: ['🏃', 'Running'],
    cycling: ['🚴', 'Cycling'],
    climbing: ['🧗', 'Climbing'],
    swimming: ['🏊', 'Swimming'],
    football: ['⚽', 'Football'],
    hiking: ['🥾', 'Hiking'],
    weightlifting: ['🏋️', 'Weightlifting'],
    yoga: ['🧘', 'Yoga']
  };
  SPORTS.forEach((s) => {
    assert.deepStrictEqual([s.emoji, s.label], expected[s.id], s.id);
  });
});

test('canonical colors match the majority palette (club-dashboard set)', () => {
  const expected = {
    running: ['#FFF7ED', '#9A3412', '#FDBA74'],
    cycling: ['#EFF6FF', '#1E40AF', '#93C5FD'],
    climbing: ['#F5F3FF', '#5B21B6', '#C4B5FD'],
    swimming: ['#F0FDFA', '#134E4A', '#5EEAD4'],
    football: ['#ECFDF5', '#166534', '#86EFAC'],
    hiking: ['#FAEEDA', '#633806', '#EF9F27'],
    weightlifting: ['#FEF9C3', '#854D0E', '#FDE047'],
    yoga: ['#FBEAF0', '#72243E', '#F4C0D1']
  };
  SPORTS.forEach((s) => {
    assert.deepStrictEqual([s.colors.bg, s.colors.text, s.colors.border], expected[s.id], s.id);
  });
});

test('every sport has a complete shape (scoring, isDistance, fieldsConfig)', () => {
  SPORTS.forEach((s) => {
    assert.ok(['km', 'session'].includes(s.scoring.per), s.id + ' scoring.per');
    assert.ok(Number.isFinite(s.scoring.rate) && s.scoring.rate > 0, s.id + ' scoring.rate');
    assert.strictEqual(typeof s.isDistance, 'boolean', s.id + ' isDistance');
    assert.strictEqual(s.fieldsConfig, s.id, s.id + ' fieldsConfig maps 1:1 to the activity form config');
  });
});

test('SPORT_ICONS + legacy alias reproduce the historic ARENAS_SPORT_ICONS map', () => {
  assert.deepStrictEqual(Object.assign({}, SPORT_ICONS, LEGACY_SPORT_EMOJI), {
    running: '🏃', cycling: '🚴', climbing: '🧗', swimming: '🏊',
    football: '⚽', weightlifting: '🏋️', hiking: '🥾', yoga: '🧘', triathlon: '🔱'
  });
});
