---
name: html-arenas RSVP color grammar
description: Two-tier yellow system for RSVP states (Going / Interested / not-responded) and the traps hit while retiring green
---

## The grammar
- **Committed / action tier = SOLID yellow**: `#FFD21E` (`var(--yellow)`) fill, `#111827` (gray-900) text, `#E6B800` (`var(--yellow-dark)`) border. Used by: Going everywhere (chips, pills, buttons, roster header band, badges), the notif panel "Join Club" pill, `btn-yellow`, calendar `.dp-btn.primary`. Solid yellow = "you / your action".
- **Tentative tier = PALE yellow**: `#FFF9E0` (`var(--yellow-light)`) fill, `#7a5c00` text, `#FDE68A` border. Used by: Interested everywhere. Dot language: solid dot = going, hollow/stroked ring (`transparent` or `#FDE68A` bg + `var(--yellow-dark)` stroke) = interested.
- **Unanswered = ghost**: transparent/white fill, dashed gray border, gray text (untouched). Distinctness from Going is structural (solid block vs dashed outline), not hue-based.

**Why:** green previously meant both "committed RSVP" and "done/logged" — ambiguous. Yellow is the brand; two yellow tiers + ghost cover the RSVP triad. Green now means completion ONLY.

**How to apply:** any new RSVP/commitment surface picks a tier from this file; never invent a third yellow. Interested text/fill tokens are the established `#FFF9E0/#FDE68A/#7a5c00` trio (not #FFF3C4 or ad-hoc creams).

## Traps
- **WCAG**: `#111827` on `#FFD21E` = 12.2:1 (AAA); `#7a5c00` on `#FFF9E0` = 5.9:1 (AA); `#7a5c00` on white = 6.25:1 (AA). **`#7a5c00` on `#FFD21E` FAILS (4.3:1) — never put pale-tier text on solid-tier fill.**
- **Momentum bar collision**: the dashboard RSVP bar's *interested* segment was ALREADY `#FFD21E` back when going was green. Recoloring going→yellow collided; interested stepped down to `#FDE68A` + `box-shadow:inset 0 0 0 1px var(--yellow-dark)` (pale alone is near-invisible against the gray-100 track at 6px — keep the stroke).
- **Dual dashboard modals**: club-dashboard has BOTH a legacy static RSVP modal (mock "34 Going" tile) and the live JS-built roster modal. Restyle both or they drift.
- **Shared panel JS**: `arenas-notifications-panel.js` runs on pages that may lack the CSS vars — hardcode hexes there.
- Greens kept deliberately: logged/done (`chip.done`, `cd-pill.act`), past-events "✓ N attended", the "Free" price tag, "Your event" ownership badge.
