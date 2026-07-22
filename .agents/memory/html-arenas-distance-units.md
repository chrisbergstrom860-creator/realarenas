---
name: html-arenas distance units
description: One canonical unit-aware km parser app-wide (parseDistanceKmUnitAware); the legacy unit-blind parser is RETIRED — never reintroduce a second distance parser.
---

# html-arenas distance parsing & units

`activities.distance` is a **free-form string** (e.g. `"10.5 km"`, `"5mi"`,
swimming `"2,000m"`). There is **no unit column** — the unit lives inside the
string.

## ONE canonical parser: `parseDistanceKmUnitAware`
Every km figure in the app goes through it: points scoring (`calculatePoints`),
profile hero `kmLogged`, Stats & PRs (hero/breakdown/PRs), overview + feed
weekly km, club dashboard rankings & training load, club report, challenges
distance progress (all 4 code paths incl. `computeChallengeProgress`), goals,
and achievement `badgeKm` (thin wrapper).

Rules: lowercase + strip thousands commas, then `km`→as-is, `mi`/`miles`→×1.609,
bare `m`/metres→÷1000, no unit→assume km, null/≤0→0.

**Why:** the profile hero (unit-aware, 69.5) and Stats & PRs (unit-blind, 47)
visibly disagreed on the same all-time total for a mile-logging user. The
unit-blind `parseDistanceKm` ("10mi" read as 10 km, swim "2,000m" inflated to
2000 km) was deleted; its 6 call sites and 5 inline `parseFloat(replace())`
duplicates all converged on the canonical parser. The old swim-1000× display
bug is gone.

**How to apply:** never add a second distance parser or an inline numeral-strip
on a distance string. Guard: `scripts/verify-km-consistency.js` (static asserts
+ parser unit tests + real-account recompute + seeded mixed-unit e2e across all
profile/feed surfaces; seeds only `@arenas-test.dev` emails, self-cleans).

## Rounding convention
Sum first, then round to 1dp (`Math.round(x*10)/10`) at each display site.
Stats & PRs `period=all` uses ALL activities (the 2020 epoch cut was removed)
so its set is identical to the hero's. Per-sport breakdown rows are rounded
individually — their sum may drift from the hero by ±0.05/row; that is
cosmetic, do NOT "fix" by summing rounded rows.

## Intentional behavior shifts from the retirement (July 2026)
- Distance-challenge progress: mile entries ×1.609, swim-metre entries ÷1000 —
  a previously "completed" swim distance challenge can render incomplete
  (progress is computed on read, nothing stored, no data corruption).
- Badge km thresholds now count real km; already-awarded badges are never
  revoked (awards idempotent).
- Club report km totals changed accordingly.

## Points scoring notes
The unit-aware points rule ("10 mi" = 16.09 km) is publicly documented on
`/how-points-work` — keep `calculatePoints` and that page's worked examples in
lockstep (verify script: `scripts/verify-points-page.js`).

## Profile header has NO fabricated numbers
All hero stats (Activities, km logged, Followers, Following) and tab counts
have static fallback `0` and hydrate from real data. Eager on load: hero stats
+ Activities/Following/Clubs tab counts. **Lazy:** the Achievements tab count
only updates on tab open (`/api/profile/achievements`), so it reads `0` until
that tab is visited.
