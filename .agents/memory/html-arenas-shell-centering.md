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
- Pages that put max-width on `.main` itself (log/billing 820, challenges) center INSIDE the capped cell — that's per-page width, not a bug (user may still decide to left-anchor them; measured report delivered Aug 2026).
- **One centering mechanism only**: feed's `justify-content:center` on `.main` was REMOVED (Aug 2026) — page-level centering inside the centered shell cell stacked two mechanisms and floated the group mid-cell. Don't re-add page-level centering to full-cell grid pages.
- **Global cap is now 1176px** (Aug 2026, user decision): `--shell-max` = 220 sidebar + 956 content (feed's 656+300), ONE value, NO per-page variation — sidebar must sit at identical x on every page when navigating (52/132/372 at 1280/1440/1920). Wider pages (club dashboard was 1240, events 1240) accept the tighter 956 cell as the cost. Mirror value + `var()` fallback in club-invite's inline shell.
- Cap shrink fallout pattern: fixed-width side-by-side flex rows (pie 230px + content-sized nowrap legend) overflow narrower columns → fix with `flex-wrap:wrap;justify-content:center` on the desktop row (wraps only when it doesn't fit; legend-below-ALWAYS was rejected earlier). Check profile stats @1280 after any cap change.
- Events rail's 16px `.sidebar-col` padding makes its right void LOOK bigger (246 vs 230 at 1920) — optical, not structural; shell gutters are exactly symmetric.

## Topbar seam alignment rule
- The topbar stays a full-width band; its contents center to the shell box via padding that uses the SAME `(100% - --shell-max)/2` formula as the body row's fr gutters — alignment by shared formula, never by tuned pixel values. **Why:** padding % and fr gutters resolve against the same grid width basis (scrollbar included), so the logo cell cannot diverge from the sidebar at any width.
- **How to apply:** any future shell-width change only touches `--shell-max`; mirror topbar rules in club-invite's inline copy (the only self-contained shell page — dashboard/member inherit from arenas.css). Landing/blog topbars are non-shell and intentionally different. Bell panel + avatar menu anchor to their own relative wrappers, so they travel with recentered contents automatically.

## Deferred (user-accepted)
- ~~Events page own content cap~~ DONE (Aug 2026): events `.main` carries `width:100%;max-width:940px;margin:0 auto` in its page style — the sanctioned per-page-width-on-.main pattern (like /log/billing). Auto margins center it inside the 956px shell cell; no-op below 1216px and on mobile.

## Desktop geometry guard
`verify-mobile-geometry.js` now also runs 1280/1440/1920 (`DESKTOP_VIEWPORTS` in lib). Surfaces flagged `mobileOnly:true` (rail max:1 contracts) are skipped >768px. **Full 6-width run exceeds a 5-min shell window and background/nohup runs stall or die mid-run (killed runs leak seeds — sweep after!)** — run in halves via `GEO_WIDTHS=mobile|desktop|360,380` foreground.

## Known pre-existing desktop defect (NOT fixed, documented in guard header)
FIXED (Aug 2026): the former feed@1280/1440/1920 clip FAILs are gone — cause was default `flex-shrink:1` on `.side-card` inside the fixed-height `.side-col` flex rail (over-full column shrank every card a few px; card overflow:hidden clipped last-child padding/descenders). Fix = one shared rule in arenas.css: `.side-col > *, .sidebar-col > *, .sidebar > * { flex-shrink: 0 }` (height-constrained scrollable rails must scroll, never shrink children). Guard is now fully green with ZERO exemptions (613 desktop + 619 mobile); any geometry FAIL is a real regression.
