---
name: html-arenas activity stat tiles
description: Shared boxed stat-tile builder (feed + my-profile Activities tab) via arenas-stat-tiles.js; CSS in arenas.css; mobile wrap rules and emoji accents
---

# Activity stat tiles — ONE shared builder for feed + profile

- **Shared builder**: `html/arenas-stat-tiles.js` (dual-routed like other shared scripts) exposes `window.buildActivityStatTiles(a)` (tile HTML) and `window.activityStatTilesRow(a)` ('' or the full `.ac-stats-row` div). Own 5-char escaper; values AND labels escaped. Feed and my-profile Activities tab both call it — never re-implement tiles per page.
- **Tile CSS lives in arenas.css** (`.ac-stats-row/.ac-stat/.sv/.sl/.tx-tile/.sv.tx/.si`), placed before the mobile @media block so `body:has(.bottom-nav)` wrap rules (88px min-width) apply on any page with the bottom nav. Feed's old page-local copy replaced with a pointer comment.
- **Still independent**: club-dashboard `renderClubFeed` (inline-styled grid, max 3 tiles — safe there); club-member.html renders no stat rows (its `.ac-stats` CSS is orphaned). my-profile's old `.ac-stat-item` inline-pill renderer is RETIRED.
- **my-profile Activities tab** now = feed-style separated cards: `.activities-hdr-card` + `#activities-list` flex column gap 14px + `.activity-card-item` (white/1px/12px). Per card: header row (icon/title/timeAgo/chip/delete ×) → shared tile row → notes → Coach's note → Feeling line last.

**Why flex-wrap, not the club feed's grid:** athlete activities can carry 4–6 tiles; `repeat(6,1fr)` at 380px = microscopic tiles. Flex-wrap gives 2–3 per row on mobile.

**How to apply:** any new stat surface should load arenas-stat-tiles.js and call the shared builder — do not fork it. Empty stats must mean NO row (honest-gap rule, builder returns ''). Emoji accents (⏱📍⚡❤️⛰✓🧗⛳🏌️💪; terrain none) are an 11px `.si` span in front of the value — trusted literals from the internal map only. Mobile override specificity: `body:has(.bottom-nav) .ac-stats-row .ac-stat` (0-3-1) beats page-level modifiers (0-2-0); text tiles intentionally revert to the shared mobile min-width.

**Gotcha:** pages sometimes carry PRE-STAGED orphaned tile CSS from earlier design passes (club-member still does; my-profile's shadowing radius-6 copies were removed when sharing landed). Grep for markup emitters, not just CSS, before assuming a treatment is live.

Feed activity payload is `select('*')` passthrough (buildFeedActivities → enrichActivities spread), so every activities column the /log form writes is already available client-side — surfacing a new field needs no server change.
