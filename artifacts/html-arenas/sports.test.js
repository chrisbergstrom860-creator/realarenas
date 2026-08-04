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

test('registry has exactly the 14 sports: historic 8, Session ② four, Session ③ two', () => {
  assert.deepStrictEqual(
    SPORTS.map((s) => s.id),
    ['running', 'cycling', 'climbing', 'swimming', 'football', 'hiking', 'weightlifting', 'yoga',
     'golf', 'pickleball', 'basketball', 'hockey', 'tennis', 'pilates']
  );
});

test('derived SPORT_POINTS: historic 8 unchanged, Session ② four pinned, Session ③ mirror their anchors', () => {
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
    hockey: { per: 'session', rate: 40 },
    tennis: { per: 'session', rate: 40 },
    pilates: { per: 'session', rate: 20 }
  });
});

test('Session ③ scoring mirrors the anchor sports structurally (tennis=hockey, pilates=yoga)', () => {
  assert.deepStrictEqual(SPORT_POINTS.tennis, SPORT_POINTS.hockey);
  assert.deepStrictEqual(SPORT_POINTS.pilates, SPORT_POINTS.yoga);
});

test('derived KNOWN_SPORTS is the 14 registry ids in order', () => {
  assert.deepStrictEqual(
    KNOWN_SPORTS,
    ['running', 'cycling', 'climbing', 'swimming', 'football', 'hiking', 'weightlifting', 'yoga',
     'golf', 'pickleball', 'basketball', 'hockey', 'tennis', 'pilates']
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
    hockey: ['🏒', 'Hockey'],
    tennis: ['🎾', 'Tennis'],
    pilates: ['🤸', 'Pilates']
  };
  SPORTS.forEach((s) => {
    assert.deepStrictEqual([s.emoji, s.label], expected[s.id], s.id);
  });
});

// The accent (text) hexes are the July 2026 chart-refresh palette (pairwise
// CIE76 dE >= 20 + white-on-color AA, guarded by verify-sport-colors.js);
// bg/border are the original tag-pill shades.
test('canonical colors match the approved palette', () => {
  const expected = {
    running: ['#FFF7ED', '#C2410C', '#FDBA74'],
    cycling: ['#EFF6FF', '#1E40AF', '#93C5FD'],
    climbing: ['#F5F3FF', '#6D28D9', '#C4B5FD'],
    swimming: ['#F0FDFA', '#0F766E', '#5EEAD4'],
    football: ['#ECFDF5', '#166534', '#86EFAC'],
    hiking: ['#FAEEDA', '#57534E', '#EF9F27'],
    weightlifting: ['#FEF9C3', '#713F12', '#FDE047'],
    yoga: ['#FBEAF0', '#72243E', '#F4C0D1'],
    golf: ['#F7FEE7', '#4D7C0F', '#BEF264'],
    pickleball: ['#ECFEFF', '#155E75', '#67E8F9'],
    basketball: ['#FFFBEB', '#A3412C', '#FCD34D'],
    hockey: ['#F1F5F9', '#1E293B', '#94A3B8'],
    tennis: ['#FDF2F8', '#DA0064', '#F9A8D4'],
    pilates: ['#FDF4FF', '#D000B0', '#F0ABFC']
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

test('SPORT_ICONS + legacy alias cover all 14 sports plus the triathlon legacy emoji', () => {
  assert.deepStrictEqual(Object.assign({}, SPORT_ICONS, LEGACY_SPORT_EMOJI), {
    running: '🏃', cycling: '🚴', climbing: '🧗', swimming: '🏊',
    football: '⚽', weightlifting: '🏋️', hiking: '🥾', yoga: '🧘',
    golf: '⛳', pickleball: '🏓', basketball: '🏀', hockey: '🏒',
    tennis: '🎾', pilates: '🤸', triathlon: '🔱'
  });
});
