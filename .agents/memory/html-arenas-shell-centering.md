---
name: html-arenas shell centering
description: Centered 4-column app-shell grid (1460px cap), topbar seam deferred, desktop geometry guard
---

## The rule
The app shell body row (sidebar + main) is capped and centered via a 4-column grid in `arenas.css`:
`.app{grid-template-columns: minmax(0,1fr) var(--sidebar-w) minmax(0,calc(var(--shell-max) - var(--sidebar-w))) minmax(0,1fr)}` with `--shell-max:1460px`, `.sidebar{grid-column:2;grid-row:2}`, `.app > .main{grid-column:3;grid-row:2}`. Topbar keeps `grid-column:1/-1` = full-width band, so NO markup change and no 100vw hacks. Below 1460px the fr gutters collapse to 0 → pixel-identical to the old 2-col shell.

**Why:** unbounded pages (events/athletes/club-member) sprawled at 1920px; user approved body-row-only centering with topbar deferred.

**How to apply:**
- Mobile collapse (`body:has(.bottom-nav)` ≤768px) must reset `.app > .main{grid-column:1}` — column-3 placement on a 1-col grid spawns implicit columns.
- club-invite carries an inline shell copy that overrides the linked arenas.css by cascade order — mirror any shell change there (incl. its own 768px reset and `--shell-max` in its `:root`; verify-css-vars demands the var be defined in-page).
- Pages that put max-width on `.main` itself (log/billing 820, challenges) center INSIDE the capped cell — that's per-page width, not a bug.

## Deferred (user-accepted)
- **Topbar seam**: `.topbar-logo` border-right sits at x=220 while the centered sidebar starts at the gutter (x=230 @1920) — 10px misalignment, plus sidebar's right border no longer aligns with anything in the topbar. Session 2 = topbar inner centering.
- **Events page own content cap** (~900–960 banner-driven) = session 3.

## Desktop geometry guard
`verify-mobile-geometry.js` now also runs 1280/1440/1920 (`DESKTOP_VIEWPORTS` in lib). Surfaces flagged `mobileOnly:true` (rail max:1 contracts) are skipped >768px. **Full 6-width run exceeds a 5-min shell window and background/nohup runs stall or die mid-run (killed runs leak seeds — sweep after!)** — run in halves via `GEO_WIDTHS=mobile|desktop|360,380` foreground.

## Known pre-existing desktop defect (NOT fixed, documented in guard header)
feed@1280/1440/1920 clip FAIL: every feed `.side-card`'s last child overhangs the card's overflow:hidden bottom by 4–14px (cropped padding/descenders). Pre-dates centering; invisible to mobile guard because most rail cards are mobile-hidden. Guard totals 1212 assertions with these 3 expected FAILs until fixed.
