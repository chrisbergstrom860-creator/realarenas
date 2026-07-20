---
name: html-arenas mobile responsiveness shell
description: How the app-shell goes mobile (bottom nav + single media block); the grid-blowout gotcha and the table-scroll plan for rollout.
---

# html-arenas mobile responsiveness

Approach (STEP 2): server-injected mobile **bottom nav** + ONE `@media (max-width:768px)` block in the shared `html/arenas.css`. No per-page CSS.

- `server.js` injects the bottom nav by replacing `</body>` (`injectBottomNav(html, pageKey)`), athlete variant = 5 items (Feed/Events/Log[primary]/Ranks/Profile). Club variants are setTab-based and were deferred to the rollout.
- All shell-collapse rules are GATED on `body:has(.bottom-nav)` so pages that haven't been rolled out yet keep their desktop sidebar untouched. Rolling a page out = wire its route through `injectBottomNav`.

## Gotcha: grid blowout (the bug that clipped content at 375px)
Collapsing the shell to one column with `grid-template-columns: 1fr` is WRONG. `1fr` = `minmax(auto,1fr)`, so the track grows to the widest min-content among ALL items in that column (here the topbar's fixed-width search input + feed cards), pushing the column past the viewport. With `body{overflow-x:hidden}` the excess is clipped, so paragraphs/stat strips appear cut off on the right instead of wrapping.

**Fix:** use `grid-template-columns: minmax(0, 1fr)` on BOTH `.app` and `.main`, plus `min-width:0` on the column children (`.feed-col`, `.side-col`, `.right-col`). Also override fixed-width topbar pieces (`.topbar-search{width:260px}` → `width:100%;min-width:0`).
**Why:** `min-width:0`/`minmax(0,..)` lets flex/grid children shrink below content width so text wraps. This is the canonical CSS blowout fix and applies to every page rolled out.

## Gotcha variant: nested grid→flex trap (my-profile Following list)
Grid of flex cards + `white-space:nowrap` text: `min-width:0` on the INNER flex
child is NOT enough — the `1fr` track's auto minimum resolves to the flex CARD's
intrinsic min-content (full nowrap text width), blowing the row past the viewport
(~540px card in a 380px viewport, silently clipped by the shell's overflow).
**Fix:** put `min-width:0` on the grid ITEM itself (the card). The my-profile
Following/Followers grid stacks to one column in the gated mobile block with
ellipsized `.fc-name`/`.fc-sport` and `flex-shrink:0` on the button; desktop
keeps `1fr 1fr`. Sibling tabs (Clubs = flex column; Achievements/Stats tiles)
measured clean at 380px — don't "fix" them.

## Rails stack for free
`.side-col` / `.right-col` are the LAST child of `.main`, so once the grid is single-column they flow below the main content automatically — just reset them to `position:static;height:auto;overflow:visible;width:auto`.

## Fixed-column leaderboard tables need a scroll wrapper
Px-based `grid-template-columns` row/header tables don't collapse and will overflow on mobile. Wrap each in `.table-scroll`/`.table-scroll-inner{min-width:560px}` (util already in arenas.css). Known instances:
- leaderboards: `.lb-table-header`/`.lb-row` (40px 1fr 110px 80px 60px)
- club-dashboard: `.lb-table-row` (32px 1fr 80px 70px 60px)
- club-member: `.lb-header-row`/`.lb-row` (36px 1fr 90px 70px 60px)

## Verification trick
Feed pages are auth-gated, so a TEMP unauth route was used to screenshot at 375px. The screenshot tool resolves paths against `previewPath` (`/html/landing`), so the temp route must live at `BASE + '/landing/__mobiletest-...'` to be reachable. REMOVE any such temp route before pushing.
