---
name: html-arenas profile Stats & PRs tab
description: Stats/PRs tab data semantics — what respects the period filter vs what is always all-time, and the bucketing/authz rules.
---

# html-arenas athlete profile — Stats & PRs

Route `GET BASE+/api/profile/stats?period=month|year|all` (requireAuth),
panel `#tab-stats` (pills `.sp-period` + `#sp-stats-body`), client IIFE renders it.

## Period semantics (product decision — keep consistent)
- ONLY hero stats (activities/km/hours/points) and the sport breakdown respect
  `period`. Streaks (current + longest), the weekly chart, and all Personal
  Records are **always all-time**, ignoring the filter.
  **Why:** PRs and streaks are lifetime achievements; scoping them to "this
  month" makes them meaningless. The weekly chart is a recent rolling window,
  not a period view.
  **How to apply:** if asked to add/extend a PR or streak, compute it over the
  full activity set, not `periodActs`.
- The weekly chart's range IS user-selectable: `?weeks=` whitelisted to
  6/12/24 (anything else → 12), computed on-read from the same all-time query.
  Client persists the choice in localStorage `arenas_stats_weeks` (whitelist
  parse both sides) and range switching is compute-then-swap (no wrong-range
  flash). Range stays independent of the period pills. Zero weeks render as a
  flat gray baseline tick with no value label; value/axis labels thin to every
  2nd/4th week (aligned backward from the always-labeled current week) at
  24w and on narrow viewports.
- Tab card order (product decision): stat cards/streaks → By sport (bars+pie)
  → Personal records → Weekly activity. Last card carries the 14px bottom
  margin, the others 12px.

## Weekly stacked columns (shared builder)
- Server weeklyChart weeks carry `bySport: [{sport, hours}]` — tenths handed
  out by **largest remainder** so segments sum EXACTLY to the labeled total
  (`hours = totalTenths/10`); dominant sport first; zero-tenth slivers dropped.
  **Why:** independent per-sport rounding drifts 0.1h from the label; the
  verify script asserts exact equality, keep it that way.
- `html/arenas-stack.js` → `window.buildWeeklyStack(weekly, colors, nWeeks,
  narrow)`; dual-path served like arenas-pie.js. Stacked flex columns:
  `flex-basis %` = true share (no min-height inflation — honest-gap rule
  applies to segments), builder REVERSES server order so dominant sits at the
  base; registry colors (same hexes as By-sport bars/pie); native `title`
  tooltips "Sport · Xh"; compact legend of ONLY present sports, hours desc.
- `scripts/verify-stack.js` re-runs builder/order/e2e checks (needs dev
  server up + SUPABASE_SERVICE_ROLE_KEY).

## Pie sizing (2026-07 doubling)
- Desktop pie 300px (panel 340px), inline-label font 9 viewBox units → inline
  threshold **7%**; narrow (≤480) capped at 180px, font 12, threshold 10.
  **Why:** label size is fixed in viewBox units, so a bigger render only fits
  smaller slices if the font shrinks relatively; 2× on mobile (~264px+) would
  dominate a 380px viewport.

## By-sport pie (shared builder)
- `html/arenas-pie.js` → `window.buildSportPie(breakdown, colors, narrow)`;
  dual-path served like arenas-time.js. Hand-rolled SVG arcs, no chart lib.
- **Basis is SESSIONS** — same as the bars' pct, so the two visuals in one card
  can never disagree. **Why:** a time-basis pie next to session-basis bars
  would silently contradict; hours already live in the Weekly chart.
- Printed percentages use largest-remainder rounding (always sum to 100);
  geometry uses exact fractions. Server `pct` is independently rounded — fine,
  because bars display no percent text.
- Labels: emoji+% inline when pct ≥ 10, else legend row under the pie. Single
  sport = `<circle>` (arc path can't sweep 360°). Empty breakdown → `''` (card
  already hidden; never render an empty gray circle). Narrow (≤480) stacks the
  pie BELOW the bars via border-top variant.
- Visual verification of authed widgets: temp unauthed harness route (also
  alias `/html/landing/pie-harness`-style path — screenshot tool prepends
  `/html/landing`), then delete route+file. `scripts/verify-pie.js` re-runs the
  LR/e2e checks.

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
