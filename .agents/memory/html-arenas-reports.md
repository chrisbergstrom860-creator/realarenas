---
name: html-arenas reports tab
description: Club dashboard Reports tab (month + year modes) — year-mode semantics, data sources, auth, print/PDF, and the month-navigation timezone gotcha.
---

# html-arenas Reports tab

Club report at `GET BASE+/api/clubs/:clubId/report`, admin/coach only. Two modes:
`?month=YYYY-MM` (default) and `?mode=year&year=YYYY` (year clamped to the coach's
current year server-side AND in the client ‹/› nav).

## Year mode semantics (2026-07)
Computed on-read, no precomputed rollups. Window = Jan 1 → today+1 (exclusive) in
the COACH's zone for the current year (YTD), or the full calendar year for past
years. Per-metric rules:
- **Member totals are point-in-time** (memberships with `created_at` before the
  window end), not "distinct over the window"; the member trend is end-of-month
  point-in-time counts per bucket.
- **Active % = distinct members with ≥1 activity in the window / members at window
  end** — over a year this reads much higher than monthly active %; that's by design.
- **YTD comparisons are same-period prior year** (Jan 1 → same day last year,
  Feb 29 → Feb 28), not full-prior-year, so deltas compare like-for-like. Past
  years compare against the full prior year.
- **`prevHasData` gate**: when the prior-year window has no members, activities,
  or events, the client suppresses ALL "vs last year" lines (a club's first year
  would otherwise show misleading jumps from zero). Month mode ignores the flag.
- **Challenges overlap-match the window**, so a Dec–Jan challenge appears in BOTH
  years' reports; its progress is still computed over the challenge's own window
  (participant zone), not clipped to the report year.
- **Activity bucketing stays member-zone** (same policy as everywhere): a
  `2026-01-01T05:30Z` activity by a Pacific member lands in Dec 2025, excluded
  from 2026 YTD. Verified with a seeded boundary case.
- Activities fetch is PAGED (1000 rows/page via `.range`, ordered `date desc, id
  asc`) — the old single `.limit(1000)` silently truncated; the shared paged
  helper now serves month mode too.
- Trend buckets: Jan → elapsed month for YTD, all 12 for past years; the client
  thins bar labels when n ≥ 12 (keeps last bar's label always).
- Mode chip persisted in localStorage `arenas_reports_period_mode`; labels are
  "July 2026" / "2026 · Year to date" / "2025".
- Year mode multiplies the challenge N+1 quirk (below): a year window can span
  ~12× more challenges than a month, each participant costing one activities
  query. Fine at current scale; first thing to batch if reports get slow.

## Month navigation must use integer math, not Date round-trips
Stepping months as `new Date(y, m-1+dir, 1).toISOString().slice(0,7)` is WRONG: it
builds a local-midnight Date then converts to UTC, so in any UTC+ timezone
(London/BST) the 1st rolls back to 23:00 on the last day of the previous month →
the ‹/› controls skip or stick on a month.
**Why:** the app's users are UK-based; this silently broke the specced control.
**How to apply:** derive YYYY-MM arithmetically:
`total = y*12 + (m-1) + dir; newMonth = Math.floor(total/12)+'-'+String(total%12+1).padStart(2,'0')`.
Apply the same caution anywhere else month strings are stepped.

## Data sources (schema reality)
Same adaptations as the rest of html-arenas: membership counts/joins come from
`memberships.created_at` (there is no `joined_at`); the top member's display name
comes from `buildUserProfileMap` (auth metadata — no `profiles` table). Challenge
"completed" must be guarded `goal_target > 0 && progress >= goal_target`, or
0-target challenges count as completed for every participant.

## Trend charts follow the app chart convention (2026-07)
Both 6-month trend strips (member count, training hours) use the same `trendBars`
renderer, which copies the Overview volume / profile Stats chart conventions:
96px bar area, value labels above bars in honest units, zero months = no label +
3px gray tick (never a `Math.max(min,…)` stub bar), latest bar #E6B800 and
always axis-labeled, short month names under bars via integer YYYY-MM math.
**How to apply:** any new bar strip in the app must follow this convention; the
fake-minimum-stub pattern has now been cured twice (Overview card, Reports tab).

Bars/Line toggle (2026-07): INDEPENDENT per chart — localStorage keys
`arenas_reports_membership_style` (chart 0) / `arenas_reports_engagement_style`
(chart 1), indexed by render order; both default bars. The old shared key
`arenas_reports_chart_style` is retired: a one-time init migration seeds unset
per-chart keys from it, then removes it. Each chip pair controls/reflects only
its own chart (re-render from cached config, no refetch). If a third trend
chart is ever added, RP_STYLE_KEYS must grow in lockstep. Line mode = SVG polyline
(`preserveAspectRatio:none` + `vector-effect:non-scaling-stroke` for uniform
stroke) with HTML-overlay dots/labels so text stays crisp; zero months dip to
baseline with a muted dot, no label (the dip IS honest in a line chart — no
gap-breaking, unlike bars). Chips are `<button>`s ON PURPOSE: the print CSS
hides all buttons, so the PDF prints whichever mode is live, chip-free —
don't switch them to divs or they'll print.

## Known non-blocking quirks
Challenge participationRate can exceed 100% because challenge joins are permissive
to non-members; the per-participant activity check is N+1 (fine at ~48-member scale).

## Print/PDF export (fixed 2026-07)
Printing anything inside the app shell blanks out unless the shell is flattened:
`<main class="main">` is the scrollport (overflow-y:auto) inside the fixed-100vh
`.app` grid, and printing a scroll container emits only its visible sliver — with
topbar/sidebar hidden, grid auto-placement collapses `<main>` into the 56px track.
**Why:** the Reports PDF printed only the title strip; body vanished.
**How to apply:** any future print view must, under `@media print`, set
`.app { display:block }` + `main.main { display:block; overflow:visible; height:auto }`
(`main.main` not bare `main` — must out-specify `body:has(.bottom-nav) .main
{ padding-bottom:76px !important }`, which still matches when the nav is
display:none). Also: A4 content width (~680px) is under the 768px mobile
breakpoint, so mobile shell rules (incl. fixed `.bottom-nav`) apply in print —
hide the nav explicitly; div-bar charts need `print-color-adjust: exact`;
`break-inside: avoid` on `#rp-report-body > div` keeps cards whole. A
`beforeprint` listener adds `printing-report` when the Reports tab is `.active`
so plain Ctrl+P works, not just the Export PDF button.
PDF verification tooling kept installed: nix `chromium` + `playwright-core`
devDep in `scripts/` (page.pdf → pdftotext/pdftoppm). Gotcha: after
`emulateMedia({media:'screen'})`, reset with `media:null` or page.pdf renders
screen styles.
