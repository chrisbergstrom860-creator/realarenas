---
name: html-arenas "Any sport" clubs
description: clubs.sport 'any' pseudo-value — where it lives, why not in the registry, label/filter sites
---

`'any'` is a **club-only pseudo-value**, deliberately NOT a sports.js registry entry.
**Why:** a registry entry would leak into the activity log, goals, and how-points-work as a loggable sport. Mirrors the `challenges.sport === 'any'` precedent.

**How to apply:**
- Validation: BOTH create paths enforce `sport === 'any' || SPORTS.some(...)` — `/api/clubs/create` AND the public `/auth/signup-club` funnel (the latter was an unvalidated bypass until fixed; keep them in lockstep).
- Directory filter predicate is a SINGLE copy in `arenas-club-cards.js` (`c.sport === f.sport || c.sport === 'any'`); sole consumer is /clubs. The filter dropdown never grows an "Any" chip (registry-∩-present loop skips it).
- Labels: injected `arenasSportTag` + `ARENAS_SPORT_ICONS` (`any:'🏟'`) are the central fix points; hand-rendered special-cases exist in club-member.html (x2), my-profile Clubs tab, club-join.html meta, club-create.js review summary + sportOptions. Never render club sport bare — grep for new `c.sport` reads when touching club UI.
- Verifier: `verify-club-directory.js` section 16 (API + playwright filter/label checks at 1280/380 + signup-funnel coverage).

Legacy defect (user-gated, do NOT fix unprompted): 5 private clubs hold capitalized sport values ("Running"/"Football"). Normalizing to lowercase ids is safe — nothing keys on exact string — but the user hasn't decided.
