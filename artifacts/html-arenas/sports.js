'use strict';

// ── SPORTS REGISTRY — single source of truth ──
// Every sport the app knows about, in canonical order. Everything sport-shaped
// is DERIVED from this list: server scoring (SPORT_POINTS), validation
// (KNOWN_SPORTS), distance-goal eligibility (DISTANCE_SPORTS), and the
// client-side window.ARENAS_SPORTS injection that pickers/badges/tag maps
// render from. Add or change a sport HERE and nowhere else.
//
// Field notes:
// - id: lowercase canonical id — the value stored in activities.sport,
//   clubs.sport, user_metadata.sports, challenges.sport, events.sport.
// - label/emoji: display strings ("🏃" + "Running").
// - colors: the consolidated palette (bg / text / border) used by sport tags,
//   pills and tiles. These are the canonical hexes that the vast majority of
//   surfaces already used; the few drifted copies were normalized to these.
// - scoring: leaderboard points — { per: 'km' | 'session', rate: number }.
//   Values are EXACTLY today's SPORT_POINTS (equivalence-tested).
// - isDistance: whether a distance goal makes sense for the sport (derives
//   DISTANCE_SPORTS — exactly today's list, equivalence-tested).
// - fieldsConfig: key into the activity-form per-sport field config
//   (activitySportFields in arenas-my-profile.html). 1:1 with id today.
const SPORTS = [
  { id: 'running',       label: 'Running',       emoji: '🏃', colors: { bg: '#FFF7ED', text: '#9A3412', border: '#FDBA74' }, scoring: { per: 'km',      rate: 10 }, isDistance: true,  fieldsConfig: 'running' },
  { id: 'cycling',       label: 'Cycling',       emoji: '🚴', colors: { bg: '#EFF6FF', text: '#1E40AF', border: '#93C5FD' }, scoring: { per: 'km',      rate: 6  }, isDistance: true,  fieldsConfig: 'cycling' },
  { id: 'climbing',      label: 'Climbing',      emoji: '🧗', colors: { bg: '#F5F3FF', text: '#5B21B6', border: '#C4B5FD' }, scoring: { per: 'session', rate: 50 }, isDistance: false, fieldsConfig: 'climbing' },
  { id: 'swimming',      label: 'Swimming',      emoji: '🏊', colors: { bg: '#F0FDFA', text: '#134E4A', border: '#5EEAD4' }, scoring: { per: 'session', rate: 40 }, isDistance: true,  fieldsConfig: 'swimming' },
  { id: 'football',      label: 'Football',      emoji: '⚽', colors: { bg: '#ECFDF5', text: '#166534', border: '#86EFAC' }, scoring: { per: 'session', rate: 30 }, isDistance: false, fieldsConfig: 'football' },
  { id: 'hiking',        label: 'Hiking',        emoji: '🥾', colors: { bg: '#FAEEDA', text: '#633806', border: '#EF9F27' }, scoring: { per: 'session', rate: 30 }, isDistance: true,  fieldsConfig: 'hiking' },
  { id: 'weightlifting', label: 'Weightlifting', emoji: '🏋️', colors: { bg: '#FEF9C3', text: '#854D0E', border: '#FDE047' }, scoring: { per: 'session', rate: 20 }, isDistance: false, fieldsConfig: 'weightlifting' },
  { id: 'yoga',          label: 'Yoga',          emoji: '🧘', colors: { bg: '#FBEAF0', text: '#72243E', border: '#F4C0D1' }, scoring: { per: 'session', rate: 20 }, isDistance: false, fieldsConfig: 'yoga' }
];

// Leaderboard points per sport — derived; must stay identical to the historic
// hand-written SPORT_POINTS literal (asserted in sports.test.js).
const SPORT_POINTS = {};
SPORTS.forEach((s) => { SPORT_POINTS[s.id] = { per: s.scoring.per, rate: s.scoring.rate }; });

// Valid sport ids (validation for goals, challenges, profile sports, …).
const KNOWN_SPORTS = SPORTS.map((s) => s.id);

// Sports where a distance goal makes sense (goal progress for sport=null
// distance goals only counts these).
const DISTANCE_SPORTS = SPORTS.filter((s) => s.isDistance).map((s) => s.id);

// id → emoji, for club tiles / sidebar rows. LEGACY_SPORT_EMOJI carries emoji
// for non-registry sport values that exist in stored club data (drift kept
// rendering exactly as before — graceful fallback, no data migration). The
// injected window.ARENAS_SPORT_ICONS alias is registry icons + legacy.
const SPORT_ICONS = {};
SPORTS.forEach((s) => { SPORT_ICONS[s.id] = s.emoji; });
const LEGACY_SPORT_EMOJI = { triathlon: '🔱' };

module.exports = { SPORTS, SPORT_POINTS, KNOWN_SPORTS, DISTANCE_SPORTS, SPORT_ICONS, LEGACY_SPORT_EMOJI };
