---
name: html-arenas timezone + country work
description: Country/state fix + /log date SHIPPED; remaining timezone work (tz capture, zone-aware server day math, multi-user rollups) with agreed fix shape.
---

# Country/state + /log date — SHIPPED (Session ①, July 2026)
- `countries.js` is the SSOT (mirrors sports.js): 250 ISO-3166-1 alpha-2 countries + 51 USPS states with derived name maps. CLDR-generated then frozen; legacy/transitional codes (UK, DD, SU, YU/CS, FX, ZR…) are EXCLUDED — they duplicate current codes' display names and pollute stored data. If regenerating, re-check for duplicate names.
- Convention: `meta.country` stores the CODE ('US'), `meta.state` the USPS code ('CA'), US-only; free-text `meta.location` stays the city. Server update route validates against the registry (invalid → 400), processes country BEFORE state, and clears state whenever country ≠ US (stale-CA guard).
- **Supabase `updateUserById` MERGES `user_metadata`** — clearing a key requires an explicit `null`; `delete meta.key` on the local copy is a silent no-op against storage. This bit once (state survived country changes) and was only caught by metadata-level checks, not UI tests.
- Registries are injected per-page via the /profile ARENAS_DATA payload (`countries`/`usStates`), NOT the global shell script (~7KB only where needed). displayFromUser now also returns country/countryName/state/stateName (registry-resolved, unknown → null).
- Modal edit-profile stays city-only by design; only Settings sends country/state (absent key = no change, empty string = explicit clear).
- Hero subline degrades: "Tustin, CA · United States" → "London · United Kingdom" → city/state/country-only → member-since only. Compact surfaces (athlete cards, podium, pickers) stay city-only; athletes search matches countryName/stateName/state code via hidden match text.
- /log default date now uses local date parts (was `toISOString().split('T')[0]` = UTC tomorrow after 5PM Pacific).
- Playwright note: verifying a ~250-option select via accessibility snapshot times out the tester — instruct it to use JS evaluation (`el.options.length`, `el.value`) and `selectOption` by value.
- Playwright note: this project serves TWO apps — the root-path React arenas prototype still shows the old mock (@jamiek, dead UK/US/Germany select). Testers drift there if a URL drops the /html prefix; test plans must pin every URL to /html and assert it.

# Timezone regime (remaining work, UTC-7 user, server clock = UTC)
- **Server-side day math is server-local/UTC**: `getWeekStart`:1957, `computeStreaks`:1976 (6 call sites), training-load `restDays`:2058, club report month bounds:2501, overview weekStart+dayStrip:3043-3073, challenges weekGrid:3326, stats weeklyChart:4665 + PRs biggest-week:4730, goals `goalWindow`:4799 (weekly/monthly; custom via `parseLocalDate` = UTC midnight on deploy), Early Bird `getHours()<6`:2904. All flip at **5PM Pacific** (streaks zero early, Sunday-evening workouts land in "next week", month/goal windows close 7h early). (Line refs pre-date Session ① edits — server.js grew ~50 lines; re-grep before use.)
- **Rolling windows are fine** (no day boundary): at-risk 5-day, recent-activity 14d, `getDateRange` 7/30d (but rolling-week ≠ Monday week — known feed right-rail mismatch).
- **Client-side is browser-local (correct)**: calendar grid+insights, feed timeago, profile labels. Calendar server fetch widened ±8d so local bucketing is safe.
- `/log` picked day → local-NOON ISO, safe. Early Bird semantics shaky: evaluates UTC hour of stored stamp; /log noon-stamps mean west-of-UTC users can never earn it, east-of-UTC noon logs earn it spuriously.

# Agreed fix shape (not yet built)
`meta.timezone` (IANA) auto-captured via `Intl.DateTimeFormat().resolvedOptions().timeZone` posted with login/signup forms + Settings override; fallback UTC until captured. Server: dependency-free zone-aware helper on `Intl.DateTimeFormat(...).formatToParts` → `dayKey/dateParts/weekStart/monthKey`; replace toDateString/setHours/getDay math with key comparisons. Multi-user rollups (training-load, report, club feed, at-risk) bucket each member in THEIR zone (tz joins buildUserProfileMap); club-level boundaries use requesting coach's zone. No data migration — all read-time conversion.
Remaining split: ② tz capture + helper + single-user endpoints; ③ multi-user rollups + parity verification sweep.
