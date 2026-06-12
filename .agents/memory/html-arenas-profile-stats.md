---
name: html-arenas profile Stats & PRs tab
description: Stats/PRs tab data semantics — what respects the period filter vs what is always all-time, and the bucketing/authz rules.
---

# html-arenas athlete profile — Stats & PRs

Route `GET BASE+/api/profile/stats?period=month|year|all` (requireAuth),
panel `#tab-stats` (pills `.sp-period` + `#sp-stats-body`), client IIFE renders it.

## Period semantics (product decision — keep consistent)
- ONLY hero stats (activities/km/hours/points) and the sport breakdown respect
  `period`. Streaks (current + longest), the 12-week chart, and all Personal
  Records are **always all-time**, ignoring the filter.
  **Why:** PRs and streaks are lifetime achievements; scoping them to "this
  month" makes them meaningless. The 12-week chart is intentionally a fixed
  recent window, not a period view.
  **How to apply:** if asked to add/extend a PR or streak, compute it over the
  full activity set, not `periodActs`.

## Bucketing gotcha (same as reports tab)
- Biggest-week / biggest-month keys are built from **local** date parts
  (`getFullYear`/`getMonth`/`getDate`), NOT `toISOString().slice()`. Round-tripping
  through UTC skews the week/month assignment in UTC+ locales (London/BST).
  See `html-arenas-reports.md` for the same month-math rule.

## Known limitation
- `period='all'` floors at 2020-01-01, so any pre-2020 activity is excluded from
  "all time" hero stats. Spec parity, harmless for this app's data.

## Helpers + safety (reuse, don't reinvent)
- Activity math uses the canonical module helpers: `calculatePoints(activities[])`,
  `parseDistanceKm(distance)`, `parseDurationHours(duration)`. Prefer
  `parseDistanceKm` over the spec's inline `(a.distance||'0').replace(...)` — it is
  null/number-safe (the inline version throws if `distance` is ever numeric).
- Route is **self-only** via `.eq('user_id', req.user.id)` (same IDOR rule as the
  activities endpoint). Client `esc()`s every user-derived string before innerHTML
  (PR title/meta, unknown-sport name fallback). Fetch is `window.BASE`-prefixed.
- Tab loads via an `htab-stats` click listener (mirrors the Activities-tab hook),
  plus a `/profile#stats` deep link.
