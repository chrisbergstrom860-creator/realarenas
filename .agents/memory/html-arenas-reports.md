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

## Known non-blocking quirks
Challenge participationRate can exceed 100% because challenge joins are permissive
to non-members; the per-participant activity check is N+1 (fine at ~48-member scale).
