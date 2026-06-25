---
name: html-arenas distance units
description: How activity distance strings are parsed to km, the app-wide unit bug, and the separate unit-aware parser used only for the profile "km logged" stat.
---

# html-arenas distance parsing & units

`activities.distance` is a **free-form string** (e.g. `"10.5 km"`, `"45 km"`,
swimming `"2,000m"`, football `"9.2 km"` optional). There is **no unit column** —
the unit lives inside the string.

## App-wide parser (`parseDistanceKm`) — has a known unit bug
The shared helper strips everything except digits/`.` and treats the number as km,
**ignoring the unit**. Used by leaderboards, weekly km, scoring, challenges.

- Correct for km-entered sports (running/cycling/hiking/football).
- **BUG:** swimming is entered in **metres** (`"2,000m"`) → parsed as **2000 km**,
  inflating distance **~1000×** anywhere `parseDistanceKm` is used.

**Decision (deferred):** This is a cross-cutting bug touching multiple systems.
Do NOT silently "fix" `parseDistanceKm` as a side effect of a small change — it
would shift every leaderboard/score. It needs a dedicated app-wide unit-aware pass.
The bug is flagged in a code comment above `parseDistanceKmUnitAware` in server.js.

## Profile "km logged" uses a SEPARATE unit-aware parser
The my-profile header "km logged" stat sums `activities.distance` via a distinct
`parseDistanceKmUnitAware()` (server.js, near `parseDistanceKm`):
lowercase + strip thousands commas, then `km`→as-is, `mi`/miles→×1.609,
bare `m`/metres→÷1000, no unit→assume km. Rounded to 1dp; non-distance sports → 0.
**Why separate:** keeps the honest profile headline without disturbing the
app-wide km figures (which still use the buggy parser by design, for now).

## Profile header has NO fabricated numbers
All hero stats (Activities, km logged, Followers, Following) and tab counts
(Activities, Achievements, Clubs, Following) have static fallback `0` and hydrate
from real data. Eager hydration on load: hero stats + Activities/Following/Clubs
tab counts. **Lazy:** the Achievements tab count only updates on tab open (fetch
to `/api/profile/achievements`), so it reads `0` until that tab is visited.
