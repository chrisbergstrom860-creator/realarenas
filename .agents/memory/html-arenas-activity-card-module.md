---
name: html-arenas shared activity-card body
description: arenas-activity-card.js renders activity-card bodies on feed, club dashboard Feed tab, profile Activities tab — never hand-build the body again
---

# Shared activity-card body builder

`html/arenas-activity-card.js` → `window.activityCardBody(a, {inset, title, feeling})` renders the card BODY in the app-wide order **title → stat tiles → notes → coach's note (→ feeling)**. Consumers: main feed, club dashboard Feed tab (`{inset:true}` — its card is flush, `.ac-ins` = margin 0 14px), profile Activities tab (`{title:false, feeling:true}` — title lives in its header row). Loads AFTER `arenas-stat-tiles.js`. Body CSS classes (`.ac-title/.ac-notes-box/.fa-notes/.ac-coach-note/.ac-feeling/.ac-ins`) live in `arenas.css`; the old page-local `.fa-notes` copies are deleted.

**Why:** three hand-built copies produced the club-feed `notes || title` title-loss bug. Never fork a card body per page.

**How to apply:** any new surface showing activity cards uses this module + its serve route. Headers/footers stay per-surface (avatar vs sport tile; kudos give-button vs count chip vs none; delete btn) — known residual divergence: dashboard's rotating-palette avatar fallback vs feed's gray-200, and three sport-pill treatments.

Sport pill: `window.sportPillHtml(sport, {size:'sm'|'xs', icon, style})` in the same module is THE registry-fed pill renderer (colors only from `ARENAS_SPORTS_BY_ID`, no color params; unknown sport → neutral gray + ⚡, never another sport's colors). `xs` = the dashboard's 10px/600/0.5px badge grammar — deliberate, matches its sibling 📣/🎟️ badges, don't converge. verify-sport-colors.js now has a two-tier hardcoded-sport-hex guard: script-context sport+hex lines fail outright; static markup tags (landing/blog mocks — plain sendFile pages, no registry injection) must match current registry hexes or fail; deliberate accent palettes are whitelisted BY NAME (PROGRESS_COLORS, CHALLENGE_ACCENTS) — add a third palette consciously there.

Related facts:
- Club feed payload (`/api/clubs/:clubId/feed`) is CONVERGED to the feed's activity shape: `select('*')` spread into the item + flattened name/avatarUrl/handle; `content` kept title-only for compat. Don't re-project a column subset — that hid the original bug.
- Notes clamp rule: >220 chars or >3 line breaks → 3-line clamp + Show more (`window.toggleActivityNotes`). Clamp may legitimately not truncate on wide columns (profile @1280 fits 458 chars in 3 lines) — verify scripts assert overflow only at narrow widths.
- `scripts/shot-activity-surfaces.js` = seed/shot/clean screenshot harness for before/after pixel diffs (ImageMagick `compare -metric AE` is available); pin fixture dates ~3 days back so timeAgo stays stable between runs.
