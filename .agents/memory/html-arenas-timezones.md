---
name: html-arenas timezone handling
description: User-zone day-math rules — tzdate.js SSOT, timezone capture/override semantics, what is converted vs deferred to multi-user rollup work.
---

# Timezone handling (Session ② shipped single-user conversion)

**Rule:** All single-user day bucketing (streaks, week/month windows, day strips, goal windows, PR buckets, early-bird hour, rest days) must go through `artifacts/html-arenas/tzdate.js` — day-KEY string comparisons (`dayKey/weekStartKey/monthKey/addDaysToKey`) in the user's zone, never server-local `Date` math. `zoneMidnightUtc(key, tz)` gives the exact instant for deadline/pace math and DB `gte` filters (equivalent to key filters: `dayKey >= K ⟺ instant >= zoneMidnightUtc(K)`).

**Why:** Server runs UTC; a 6 PM Pacific activity is next-day UTC, which shifted streaks/weeks/months for non-UTC users. UTC parity was proven byte-identical across 9 endpoints + 2000 randomized streak-equivalence cases, so key math is a drop-in for UTC users.

**How to apply:**
- Zone source: `getUserTimezone(user)` reads `user_metadata.timezone` (falls back UTC). Capture: hidden `tz` field on login/signup/signup-club forms; login refreshes it UNLESS `timezone_source === 'manual'`. Settings select ('' = Auto) posts `timezone` + `browserTz`; '' reverts to auto and adopts a valid browserTz immediately; invalid zone → 400. Always validate with `isValidTimezone` at read AND write.
- `computeStreaks(acts, tz, nowMs?)` preserves legacy quirks on purpose — a FUTURE-dated last activity gates the current run to 1 (old `today-last <= 1` passes for negative diffs). Don't "fix" without a product decision.
- Labels rendered from a key must use `keyToUtcDate(key)` + `timeZone:'UTC'` formatting so the label can't drift from its bucket.
- Settings select stays on "Auto" even when a zone is stored with source auto — pre-selecting would freeze the auto-captured zone on the next save.
- DEFERRED to Session ③ (multi-user rollups, keep shared-UTC until then): `computeChallengeProgress` streak `toDateString` (feeds cross-user leaderboards — pick ONE documented boundary policy), training-load weekly hour grid (shared server-week; only restDays is member-zone), club report/feed rollups. Note: /log noon-stamped entries are noon in the USER's zone for early-bird only if logged with real time; date-only entries get a noon UTC stamp — don't re-litigate.
- `zoneMidnightUtc` 3-pass fixpoint can be ~1h off in zones that spring forward exactly at midnight (e.g. America/Santiago) — window-edge nuance, accepted.
