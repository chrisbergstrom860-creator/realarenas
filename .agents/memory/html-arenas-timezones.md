---
name: html-arenas timezone handling
description: User-zone day-math rules — tzdate.js SSOT, timezone capture/override semantics, the multi-user boundary policy, and accepted quirks.
---

# Timezone handling (fully shipped: single-user AND multi-user rollups)

**Rule:** All single-user day bucketing (streaks, week/month windows, day strips, goal windows, PR buckets, early-bird hour, rest days) must go through `artifacts/html-arenas/tzdate.js` — day-KEY string comparisons (`dayKey/weekStartKey/monthKey/addDaysToKey`) in the user's zone, never server-local `Date` math. `zoneMidnightUtc(key, tz)` gives the exact instant for deadline/pace math and DB `gte` filters (equivalent to key filters: `dayKey >= K ⟺ instant >= zoneMidnightUtc(K)`).

**Why:** Server runs UTC; a 6 PM Pacific activity is next-day UTC, which shifted streaks/weeks/months for non-UTC users. UTC parity was proven byte-identical across 9 endpoints + 2000 randomized streak-equivalence cases, so key math is a drop-in for UTC users.

**How to apply:**
- Zone source: `getUserTimezone(user)` reads `user_metadata.timezone` (falls back UTC). Capture: hidden `tz` field on login/signup/signup-club forms; login refreshes it UNLESS `timezone_source === 'manual'`. Settings select ('' = Auto) posts `timezone` + `browserTz`; '' reverts to auto and adopts a valid browserTz immediately; invalid zone → 400. Always validate with `isValidTimezone` at read AND write.
- `computeStreaks(acts, tz, nowMs?)` preserves legacy quirks on purpose — a FUTURE-dated last activity gates the current run to 1 (old `today-last <= 1` passes for negative diffs). Don't "fix" without a product decision.
- Labels rendered from a key must use `keyToUtcDate(key)` + `timeZone:'UTC'` formatting so the label can't drift from its bucket.
- Settings select stays on "Auto" even when a zone is stored with source auto — pre-selecting would freeze the auto-captured zone on the next save.
- MULTI-USER BOUNDARY POLICY (shipped; policy comment lives above the challenge helpers in server.js): (1) a member's activities always bucket to days in the MEMBER's zone via `dayKey(ts, memberZone(profile))` — `buildUserProfileMap` carries `timezone`, `memberZone()` falls back UTC for missing profiles; (2) window boundaries (which week/month is "current") resolve in the VIEWER's zone (coach viewing a report = coach's month via `weekStartKey/monthKey(now, viewerTz)`); (3) challenge windows are PER-PARTICIPANT instant windows: keys = `dayKey(start/end_date,'UTC')`, window = `[zoneMidnightUtc(startKey,pTz), zoneMidnightUtc(endKey,pTz)]` INCLUSIVE (byte-identical to legacy gte/lte for UTC users). Fetch a day wide via `challengeFetchRange`, then trim per participant with `actsInChallengeWindow`. ASSUMES challenge start/end_date stored as UTC-midnight instants (all creation paths do).
- Rolling INSTANT windows are policy-exempt by design — `getDateRange('rolling7')` (at-risk/nudge 5-day checks ONLY), member-home weekly points, daysLeft/expectedPct countdowns: no day bucketing, leave as instant math. `getDateRange('week'/'month')` are NOT rolling anymore: Monday 00:00 / 1st-of-month in the VIEWER's zone (public promise on /how-points-work).
- Note: /log noon-stamped entries are noon in the USER's zone for early-bird only if logged with real time; date-only entries get a noon UTC stamp — don't re-litigate.
- Accepted quirks: club-feed milestone streak still counts `progress+=1` per activity (legacy, only its window was fixed); training-load "this week" has no upper bound so future-dated acts count (legacy-identical).
- `zoneMidnightUtc` 3-pass fixpoint can be ~1h off in zones that spring forward exactly at midnight (e.g. America/Santiago) — window-edge nuance, accepted.
