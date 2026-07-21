---
name: html-arenas activity stat tiles
description: Boxed stat-tile treatment on athlete-feed activity cards; renderer landscape (4 independent renderers, no shared code) and mobile wrap rules
---

# Activity stat renderers — four independents, no shared code

- **Athlete feed** (arenas-feed.html `buildStats`): boxed tiles — `.ac-stats-row` > `.ac-stat` with `.sv` (15px mono value) / `.sl` (9px small-caps label). Flex-wrap, tile flex:1 min-width 60px (88px mobile via arenas.css `body:has(.bottom-nav)` rule). Free-text values (course, terrain) use `.sv.tx` (12px sans, ellipsis) + `.tx-tile` (wider).
- **Club feed** (club-dashboard `renderClubFeed` activity branch): the reference tiles, inline-styled, grid `repeat(N,1fr)`, max 3 tiles (distance/duration/pace) so the grid is safe there.
- **my-profile Activities tab**: its own `.ac-stat-item` inline pill renderer — a different design, deliberately not converged.
- **club-member.html**: renders no activity stat rows at all; its `.ac-stats` CSS is orphaned.

**Why flex-wrap, not the club feed's grid:** athlete activities can carry 4–6 tiles; `repeat(6,1fr)` at 380px = microscopic tiles. Flex-wrap gives 2–3 per row on mobile. Deliberate deviation, alongside the feed CSS's hairline border/radius 7/weight 700.

**How to apply:** any new stat surface should reuse the tile pattern + escape values with the page's esc helper (labels too). Empty stats must mean NO row (honest-gap rule). Each tile carries its stat's legacy emoji as a small `.si` accent (11px) in front of the value — the emoji map comes from the old inline row / my-profile pills (⏱ ⛳ 🏌️ ⛰ 🧗 💪 etc.); fields that never had an emoji (terrain) get none, and beside-the-label placement was rejected because it dwarfs the 9px small-caps label. Mobile override specificity: the arenas.css `body:has(.bottom-nav) .ac-stats-row .ac-stat` rule (0-3-1) beats page-level tile modifiers (0-2-0) — text tiles intentionally revert to the shared mobile min-width.

**Gotcha:** pages sometimes carry PRE-STAGED orphaned tile CSS from earlier design passes (feed had `.ac-stats-row`/`.ac-stat` defined but unused; club-member still does; my-profile has an unused boxed variant at ~154). Grep for markup emitters, not just CSS, before assuming a treatment is live.

Feed activity payload is `select('*')` passthrough (buildFeedActivities → enrichActivities spread), so every activities column the /log form writes is already available client-side — surfacing a new field needs no server change.
