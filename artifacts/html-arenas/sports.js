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
  { id: 'running',       label: 'Running',       emoji: '🏃', colors: { bg: '#FFF7ED', text: '#C2410C', border: '#FDBA74' }, scoring: { per: 'km',      rate: 10 }, isDistance: true,  fieldsConfig: 'running' },
  { id: 'cycling',       label: 'Cycling',       emoji: '🚴', colors: { bg: '#EFF6FF', text: '#1E40AF', border: '#93C5FD' }, scoring: { per: 'km',      rate: 6  }, isDistance: true,  fieldsConfig: 'cycling' },
  { id: 'climbing',      label: 'Climbing',      emoji: '🧗', colors: { bg: '#F5F3FF', text: '#6D28D9', border: '#C4B5FD' }, scoring: { per: 'session', rate: 50 }, isDistance: false, fieldsConfig: 'climbing' },
  { id: 'swimming',      label: 'Swimming',      emoji: '🏊', colors: { bg: '#F0FDFA', text: '#0F766E', border: '#5EEAD4' }, scoring: { per: 'session', rate: 40 }, isDistance: true,  fieldsConfig: 'swimming' },
  { id: 'football',      label: 'Football',      emoji: '⚽', colors: { bg: '#ECFDF5', text: '#166534', border: '#86EFAC' }, scoring: { per: 'session', rate: 30 }, isDistance: false, fieldsConfig: 'football' },
  { id: 'hiking',        label: 'Hiking',        emoji: '🥾', colors: { bg: '#FAEEDA', text: '#57534E', border: '#EF9F27' }, scoring: { per: 'session', rate: 30 }, isDistance: true,  fieldsConfig: 'hiking' },
  { id: 'weightlifting', label: 'Weightlifting', emoji: '🏋️', colors: { bg: '#FEF9C3', text: '#713F12', border: '#FDE047' }, scoring: { per: 'session', rate: 20 }, isDistance: false, fieldsConfig: 'weightlifting' },
  { id: 'yoga',          label: 'Yoga',          emoji: '🧘', colors: { bg: '#FBEAF0', text: '#72243E', border: '#F4C0D1' }, scoring: { per: 'session', rate: 20 }, isDistance: false, fieldsConfig: 'yoga' },
  // ── Session ② additions (July 2026) — all per-session scoring, no distance
  // goals. Rates argued against the existing session-sport spread (climbing 50
  // down to yoga 20): hockey 40 = swimming (short, very high intensity,
  // full-body); basketball 35 sits between football 30 and swimming 40
  // (sustained running + jumping, usually shorter than a football match);
  // golf 30 = hiking/football (4+ hours, ~10km walked — long duration, low
  // intensity); pickleball 25 above weightlifting/yoga 20 (real cardio, but
  // lighter than the field-sport sessions).
  { id: 'golf',          label: 'Golf',          emoji: '⛳', colors: { bg: '#F7FEE7', text: '#4D7C0F', border: '#BEF264' }, scoring: { per: 'session', rate: 30 }, isDistance: false, fieldsConfig: 'golf' },
  { id: 'pickleball',    label: 'Pickleball',    emoji: '🏓', colors: { bg: '#ECFEFF', text: '#155E75', border: '#67E8F9' }, scoring: { per: 'session', rate: 25 }, isDistance: false, fieldsConfig: 'pickleball' },
  { id: 'basketball',    label: 'Basketball',    emoji: '🏀', colors: { bg: '#FFFBEB', text: '#A3412C', border: '#FCD34D' }, scoring: { per: 'session', rate: 35 }, isDistance: false, fieldsConfig: 'basketball' },
  { id: 'hockey',        label: 'Hockey',        emoji: '🏒', colors: { bg: '#F1F5F9', text: '#1E293B', border: '#94A3B8' }, scoring: { per: 'session', rate: 40 }, isDistance: false, fieldsConfig: 'hockey' },
  // ── Session ③ additions (Aug 2026) — scoring MIRRORS an anchor sport
  // (structure and rate, both per-session): tennis = hockey 40 (short,
  // high-intensity, whole-body session); pilates = yoga 20 (controlled
  // low-intensity studio session). Neither is a distance sport. Accents are
  // shade-searched under the white-on-slice AA cap (relative luminance <=
  // 0.183, ~L* 50): magenta/pink was the only open region at pairwise
  // dE >= 20 across all 14 — both sit dE 45 from every existing accent.
  { id: 'tennis',        label: 'Tennis',        emoji: '🎾', colors: { bg: '#FDF2F8', text: '#DA0064', border: '#F9A8D4' }, scoring: { per: 'session', rate: 40 }, isDistance: false, fieldsConfig: 'tennis' },
  { id: 'pilates',       label: 'Pilates',       emoji: '🤸', colors: { bg: '#FDF4FF', text: '#D000B0', border: '#F0ABFC' }, scoring: { per: 'session', rate: 20 }, isDistance: false, fieldsConfig: 'pilates' }
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
