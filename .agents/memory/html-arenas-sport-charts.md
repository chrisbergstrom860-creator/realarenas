---
name: html-arenas By-sport charts + sport accent palette
description: Redesigned Stats & PRs "By sport" card (3 charts + exact table via shared arenas-sport-charts.js) and the refreshed colors.text accent palette with its ΔE guard.
---

## By sport card (Stats & PRs)
- ONE shared builder `html/arenas-sport-charts.js` (`window.buildSportCharts(breakdown, colors, narrow)`) renders the whole card body: Sessions bars, Time bars, pie + full legend (largest-remainder %), then a compact exact-figures table (sessions · km · hours). `arenas-pie.js` is DELETED — its arc + largest-remainder logic lives here now; never reintroduce a per-page fork.
- Distance has NO chart — it lives only in the table ("—" when none). Sessions-without-time keep their slot in the Time chart as a 2px stub + "—" label (alignment across charts is the point).
- In-slice pie %: white 12u bold label only when arc length at label radius 50 (of 80) >= chars*7.2+6 viewBox units (~9-10%); legend always carries every sport, so omission loses nothing. White clears AA on every accent — asserted in verify-sport-charts.js. Bar plot is 200u tall, slots 40/16 desktop vs 30/10 narrow (keeps 12-sport charts from over-shrinking on phones); pie is 230px fixed with content-sized legend BESIDE it on desktop, width:100% capped 300px with legend BELOW on narrow (<=480 caller flag) — a full-width legend below the pie was tried and rejected (pcts drift from names, card too tall); fixed viewBox keeps in-slice label fit size-invariant; chart titles via chartTitle() 13px/700 gray-700.
- One sport = full `<circle>` (an SVG arc can't sweep 360°). Empty breakdown = '' — the caller's card gate owns that state.
- Narrow (≤480, existing `narrow` flag): charts stack single-column, pie legend goes BELOW the pie.
- Guards: `scripts/verify-sport-charts.js` (builder cases + rendered-ΔE floor + e2e values-match vs /api/profile/stats at 4 widths, seeding fully inside try/finally) and geometry's `#sp-stats-body svg[role="img"]` min-3 surface.

## Sport accent palette (colors.text)
- colors.text is now a DATA-ENCODING channel (same hex per sport across charts), so 8 of 12 accents were refreshed (approved): all 12 pairwise CIE76 ΔE ≥ 20 (min 22.9 weightlifting/basketball) and AA ≥ 4.5 on own bg. Old palette had running/basketball ΔE 9.3 (0 under deuteranopia!).
- **Why:** 12 same-darkness hues can't also all separate for dichromats (protan min 5.5, deutan 6.7 — informational); CVD support = redundant labels (emoji axis, legend names, table), never color alone.
- **How to apply:** any colors.text edit must pass `scripts/verify-sport-colors.js` (fails below ΔE 20 or AA 4.5). Before/after surface shots via `scripts/shot-sport-colors.js` (feed pills, profile activities pills, stats charts, athletes cards, club dashboard). Avatar-initial palettes and static blog/marketing hexes reuse similar hex values but are NOT registry consumers — leave them alone.
