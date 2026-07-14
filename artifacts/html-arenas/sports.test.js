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

test('registry has exactly the 12 sports: historic 8 in SPORT_POINTS order, then the Session ② four', () => {
  assert.deepStrictEqual(
    SPORTS.map((s) => s.id),
    ['running', 'cycling', 'climbing', 'swimming', 'football', 'hiking', 'weightlifting', 'yoga',
     'golf', 'pickleball', 'basketball', 'hockey']
  );
});

test('derived SPORT_POINTS: historic 8 unchanged, Session ② four pinned', () => {
  assert.deepStrictEqual(SPORT_POINTS, {
    running: { per: 'km', rate: 10 },
    cycling: { per: 'km', rate: 6 },
    climbing: { per: 'session', rate: 50 },
    swimming: { per: 'session', rate: 40 },
    football: { per: 'session', rate: 30 },
    hiking: { per: 'session', rate: 30 },
    weightlifting: { per: 'session', rate: 20 },
    yoga: { per: 'session', rate: 20 },
    golf: { per: 'session', rate: 30 },
    pickleball: { per: 'session', rate: 25 },
    basketball: { per: 'session', rate: 35 },
    hockey: { per: 'session', rate: 40 }
  });
});

test('derived KNOWN_SPORTS is the 12 registry ids in order', () => {
  assert.deepStrictEqual(
    KNOWN_SPORTS,
    ['running', 'cycling', 'climbing', 'swimming', 'football', 'hiking', 'weightlifting', 'yoga',
     'golf', 'pickleball', 'basketball', 'hockey']
  );
});

test('derived DISTANCE_SPORTS is unchanged — none of the Session ② sports are distance sports', () => {
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
    yoga: ['🧘', 'Yoga'],
    golf: ['⛳', 'Golf'],
    pickleball: ['🏓', 'Pickleball'],
    basketball: ['🏀', 'Basketball'],
    hockey: ['🏒', 'Hockey']
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
    yoga: ['#FBEAF0', '#72243E', '#F4C0D1'],
    golf: ['#F7FEE7', '#3F6212', '#BEF264'],
    pickleball: ['#ECFEFF', '#155E75', '#67E8F9'],
    basketball: ['#FFFBEB', '#92400E', '#FCD34D'],
    hockey: ['#F1F5F9', '#334155', '#94A3B8']
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

test('SPORT_ICONS + legacy alias cover all 12 sports plus the triathlon legacy emoji', () => {
  assert.deepStrictEqual(Object.assign({}, SPORT_ICONS, LEGACY_SPORT_EMOJI), {
    running: '🏃', cycling: '🚴', climbing: '🧗', swimming: '🏊',
    football: '⚽', weightlifting: '🏋️', hiking: '🥾', yoga: '🧘',
    golf: '⛳', pickleball: '🏓', basketball: '🏀', hockey: '🏒',
    triathlon: '🔱'
  });
});
