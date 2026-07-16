// ── ZONE-AWARE DATE HELPERS ──
// Dependency-free timezone day-math built on Intl.DateTimeFormat(...,
// { timeZone }).formatToParts(). This is the single source of truth for
// "which day/week/month does this timestamp belong to?" questions across
// server.js — all single-user day bucketing goes through these key-string
// helpers so a 6 PM Pacific activity lands on the Pacific day, not the UTC one.
//
// Conventions:
// - A "day key" is 'YYYY-MM-DD' (zero-padded) in the given zone. Key strings
//   compare lexicographically in chronological order, so window checks are
//   plain string comparisons.
// - Weeks start on Monday (weekday 1 = Mon ... 7 = Sun), matching the app's
//   Mon→Sun strips and getWeekStart precedent.
// - No-zone fallback is ALWAYS 'UTC'. The server runs in UTC, so tz='UTC'
//   reproduces the legacy server-local behavior exactly (verified by the
//   old-vs-new parity harness before the swap).
// - Formatter instances are cached per zone (they are expensive to build).

const FORMATTERS = new Map();
function zoneFormatter(tz) {
  const zone = tz || 'UTC';
  let fmt = FORMATTERS.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    FORMATTERS.set(zone, fmt);
  }
  return fmt;
}

// True when `tz` is a zone name Intl accepts (IANA names like
// 'America/Los_Angeles', plus 'UTC'). Constructing a formatter and catching
// the RangeError is the validator — no zone table to maintain.
function isValidTimezone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (err) { return false; }
}

// The effective zone for an auth user: their stored user_metadata.timezone
// when it is a valid zone, otherwise UTC (legacy behavior for users who have
// never logged in since capture shipped, or whose stored value is garbage).
function getUserTimezone(user) {
  const meta = (user && user.user_metadata) || {};
  return isValidTimezone(meta.timezone) ? meta.timezone : 'UTC';
}

const WEEKDAY_NUM = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const pad2 = (n) => String(n).padStart(2, '0');

// Calendar parts of an instant as seen in `tz`:
// { y, m (1-12), d, weekday (1=Mon..7=Sun), hour (0-23), minute }.
// Invalid dates return null (callers treat that as "no bucket").
function dateParts(date, tz) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  const parts = zoneFormatter(tz).formatToParts(d);
  const out = {};
  for (const p of parts) {
    if (p.type === 'year') out.y = Number(p.value);
    else if (p.type === 'month') out.m = Number(p.value);
    else if (p.type === 'day') out.d = Number(p.value);
    else if (p.type === 'weekday') out.weekday = WEEKDAY_NUM[p.value];
    else if (p.type === 'hour') out.hour = Number(p.value);
    else if (p.type === 'minute') out.minute = Number(p.value);
  }
  return out;
}

// 'YYYY-MM-DD' of the instant in `tz` ('invalid' for unparseable dates — one
// harmless bucket, mirroring the old toDateString behavior on bad input).
function dayKey(date, tz) {
  const p = dateParts(date, tz);
  if (!p) return 'invalid';
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
}

// Days since the Unix epoch for a day key (NaN for 'invalid'). Key arithmetic
// happens in this integer space — never on Date objects in some local zone.
function keyToEpochDays(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1) / 86400000;
}

// Day key + n days → day key. Pure calendar math via Date.UTC (immune to the
// server's own zone and to DST, since keys are zone-less calendar dates).
function addDaysToKey(key, n) {
  const [y, m, d] = String(key).split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + n));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

// A day key rendered as a Date at UTC midnight — ONLY for formatting labels
// with { timeZone: 'UTC' } options (chart/PR labels), never for bucketing.
function keyToUtcDate(key) {
  return new Date(keyToEpochDays(key) * 86400000);
}

// Day key of the Monday starting the week that contains `date` (as seen in
// `tz`), `weeksAgo` weeks back (0 = the current week of that instant).
function weekStartKey(date, tz, weeksAgo) {
  const p = dateParts(date, tz);
  if (!p) return 'invalid';
  const back = (p.weekday - 1) + (weeksAgo || 0) * 7;
  return addDaysToKey(`${p.y}-${pad2(p.m)}-${pad2(p.d)}`, -back);
}

// 'YYYY-MM' of the instant in `tz`.
function monthKey(date, tz) {
  const p = dateParts(date, tz);
  if (!p) return 'invalid';
  return `${p.y}-${pad2(p.m)}`;
}

// The UTC instant at which the calendar day `key` begins in `tz` (local
// midnight). Iterative offset correction handles DST: guess UTC midnight,
// measure what wall-clock that maps to in the zone, subtract the difference.
// On a spring-forward day where local midnight doesn't exist, this lands on
// the first existing instant after the gap — the correct window edge.
function zoneMidnightUtc(key, tz) {
  const [y, m, d] = String(key).split('-').map(Number);
  const target = Date.UTC(y, (m || 1) - 1, d || 1);
  let ts = target;
  for (let i = 0; i < 3; i++) {
    const p = dateParts(new Date(ts), tz);
    if (!p) break;
    const wall = Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute);
    const diff = wall - target;
    if (diff === 0) break;
    ts -= diff;
  }
  return new Date(ts);
}

// Shared streak computation over a user's activities (rows need only `.date`),
// bucketed into days in the USER'S zone. `longestStreak` is the max run of
// consecutive active days all-time; `currentStreak` is the run ending today or
// yesterday in that zone (today may still be pending, so a rest day today
// doesn't break yesterday's streak; last activity 2+ days ago = 0). Duplicate
// same-day rows collapse via the key Set, so callers pass raw activity lists.
// `nowMs` is injectable for tests; production callers omit it.
function computeStreaks(activities, tz, nowMs) {
  const days = [...new Set((activities || []).map((a) => dayKey(a.date, tz)))]
    .sort()
    .map(keyToEpochDays);
  let longestStreak = 0, run = 0;
  for (let i = 0; i < days.length; i++) {
    if (i === 0) run = 1;
    else run = days[i] - days[i - 1] === 1 ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
  }
  let currentStreak = 0;
  if (days.length > 0) {
    const today = keyToEpochDays(dayKey(nowMs == null ? new Date() : new Date(nowMs), tz));
    if (today - days[days.length - 1] <= 1) {
      currentStreak = 1;
      for (let i = days.length - 1; i > 0; i--) {
        if (days[i] - days[i - 1] === 1) currentStreak++;
        else break;
      }
    }
  }
  return { currentStreak, longestStreak };
}

module.exports = {
  isValidTimezone,
  getUserTimezone,
  dateParts,
  dayKey,
  keyToEpochDays,
  addDaysToKey,
  keyToUtcDate,
  weekStartKey,
  monthKey,
  zoneMidnightUtc,
  computeStreaks
};
