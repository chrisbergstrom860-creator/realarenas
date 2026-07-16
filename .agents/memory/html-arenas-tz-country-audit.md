---
name: html-arenas timezone + country audit
description: Read-only diagnosis — dead Country select in Settings, single free-text meta.location, and the server-UTC vs browser-local day-boundary split with agreed fix shape.
---

# Country-save bug (diagnosed, NOT fixed)
Triple break, client-first:
1. `arenas-my-profile.html:524` Country `<select>` has **no id/name** — `gather()` (~:990) sends only `{name, location, bio(, sports)}`; country is never read or sent.
2. The populate block (`setVal` ~:969-980) never touches the select, so it always re-renders its first hard-coded option ("United Kingdom"; only UK/US/Germany options exist). Save reloads the page after 600ms, which is why it *looks* like a reset.
3. Server `/api/profile/update` (server.js:5482) whitelists name/handle/location≤120/bio≤600/sports — a country key would be silently dropped anyway.

# Location shape
Single free-text `meta.location` (labelled "City"; settings `#set-location`:523, modal `#edit-location`:631), exposed via `displayFromUser` (server.js:553). Renders: profile hero subline (:794), follow grid (:1103), athletes cards (:494) + modal (:639), leaderboards podium/rows (:528/:562), invite pickers, athletes search match (:454).
Agreed proposal: add structured `meta.country` (ISO-3166 alpha-2) + `meta.state` (USPS 2-letter, US-only, cleared when country ≠ US); keep free-text city. Compact surfaces stay city-only; hero shows "City, ST · Country".

# Timezone regime (audit, UTC-7 user, server clock = UTC)
- **Server-side day math is server-local/UTC**: `getWeekStart`:1957, `computeStreaks`:1976 (6 call sites), training-load `restDays`:2058, club report month bounds:2501, overview weekStart+dayStrip:3043-3073, challenges weekGrid:3326, stats weeklyChart:4665 + PRs biggest-week:4730, goals `goalWindow`:4799 (weekly/monthly; custom via `parseLocalDate` = UTC midnight on deploy), Early Bird `getHours()<6`:2904. All flip at **5PM Pacific** (streaks zero early, Sunday-evening workouts land in "next week", month/goal windows close 7h early).
- **Rolling windows are fine** (no day boundary): at-risk 5-day:1854, recent-activity 14d, `getDateRange` 7/30d (but rolling-week ≠ Monday week — known feed right-rail mismatch).
- **Client-side is browser-local (correct)**: calendar grid+insights, feed timeago, profile labels. Calendar server fetch widened ±8d (:5326) so local bucketing is safe.
- `/log` picked day → **local-NOON ISO** (log.html:373-383), safe; but the default date input uses `toISOString().split('T')[0]` (:308) = UTC today → pre-fills TOMORROW after 5PM Pacific (real visible bug, one-line fix).
- Early Bird semantics already shaky: it evaluates the UTC hour of the stored stamp, and /log noon-stamps mean west-of-UTC users can never earn it; east-of-UTC noon logs can earn it spuriously.

# Agreed fix shape (not yet built)
`meta.timezone` (IANA) auto-captured via `Intl.DateTimeFormat().resolvedOptions().timeZone` posted with login/signup forms + Settings override; fallback UTC until captured. Server: dependency-free zone-aware helper on `Intl.DateTimeFormat(...).formatToParts` → `dayKey/dateParts/weekStart/monthKey`; replace toDateString/setHours/getDay math with key comparisons. Multi-user rollups (training-load, report, club feed, at-risk) bucket each member in THEIR zone (tz joins buildUserProfileMap); club-level boundaries use requesting coach's zone. No data migration — all read-time conversion.
Session split: ① country/state + /log default-date fix; ② tz capture + helper + single-user endpoints; ③ multi-user rollups + parity verification sweep.
