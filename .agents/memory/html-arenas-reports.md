---
name: html-arenas reports tab
description: Club dashboard monthly Reports tab — data sources, auth, and the month-navigation timezone gotcha.
---

# html-arenas Reports tab

Monthly club report at `GET BASE+/api/clubs/:clubId/report?month=YYYY-MM`, admin/coach only.

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
