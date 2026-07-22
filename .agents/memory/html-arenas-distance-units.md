---
name: html-arenas distance units
description: How activity distance strings are parsed to km, the remaining display-only unit bug, and which consumers use the unit-aware parser (points scoring included).
---

# html-arenas distance parsing & units

`activities.distance` is a **free-form string** (e.g. `"10.5 km"`, `"45 km"`,
swimming `"2,000m"`, football `"9.2 km"` optional). There is **no unit column** —
the unit lives inside the string.

## Display parser (`parseDistanceKm`) — still has a known unit bug
The shared helper strips everything except digits/`.` and treats the number as km,
**ignoring the unit**. Still used for DISPLAY distance totals (weekly km, club
rollups, challenges distance progress).

- Correct for km-entered sports (running/cycling/hiking/football).
- **BUG:** swimming is entered in **metres** (`"2,000m"`) → parsed as **2000 km**,
  inflating distance **~1000×** anywhere `parseDistanceKm` is used.

**Decision (deferred):** display totals need a dedicated app-wide unit-aware pass.
Do NOT silently "fix" `parseDistanceKm` as a side effect of a small change.
The bug is flagged in a code comment above `parseDistanceKmUnitAware` in server.js.

## Unit-aware parser (`parseDistanceKmUnitAware`) — now includes POINTS SCORING
Used by the profile "km logged" stat, goals, AND `calculatePoints` (leaderboard
points): lowercase + strip thousands commas, then `km`→as-is, `mi`/miles→×1.609,
bare `m`/metres→÷1000, no unit→assume km.
**Why points are safe from the swim bug:** only per-km sports (running, cycling)
feed distance into scoring; swimming is per-session. The unit-aware points rule
("10 mi" = 16.09 km) is publicly documented on `/how-points-work` — keep
calculatePoints and that page's worked examples in lockstep (verify script:
`scripts/verify-points-page.js`).

## Profile header has NO fabricated numbers
All hero stats (Activities, km logged, Followers, Following) and tab counts
(Activities, Achievements, Clubs, Following) have static fallback `0` and hydrate
from real data. Eager hydration on load: hero stats + Activities/Following/Clubs
tab counts. **Lazy:** the Achievements tab count only updates on tab open (fetch
to `/api/profile/achievements`), so it reads `0` until that tab is visited.
