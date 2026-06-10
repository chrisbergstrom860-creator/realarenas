---
name: html-arenas training load
description: Training-load tab data source, duration parsing gotcha, and per-member check-in endpoint design.
---

# Training load (club dashboard)

Load is derived from the `activities` table's free-form `duration` string (no wearable/HR data). Names/handle/sports come from auth metadata via `buildUserProfileMap` (no `profiles` table).

## Duration parsing gotcha
`parseDurationHours` must treat a colon value whose **first segment > 12 as MM:SS**, otherwise as H:MM.
**Why:** the activity log form (arenas-my-profile.html) placeholder steers users to "e.g. 45:00 or 1h 20m" — so "45:00" is minutes:seconds (0.75h), but "1:30" is 1h30m. Reading every "MM:SS" as hours inflated load ~60x and produced false "overdoing" flags. Bare numbers use the same >12 heuristic (>12 = minutes, else hours).
**How to apply:** any new code that interprets activity `duration` should reuse `parseDurationHours`, not re-parse inline.

## Per-member check-in vs nudge-atrisk
For a single coach→member check-in, use the dedicated `POST /api/clubs/:clubId/checkin` ({userId}) endpoint, NOT `nudge-atrisk`.
**Why:** `nudge-atrisk` deliberately ignores client-supplied IDs and recomputes the at-risk set server-side (anti-spam). Routing a single check-in through it would notify the whole at-risk set, not the chosen member.
**How to apply:** `/checkin` gates the caller to admin/coach of the club AND validates the target is a member of that club before notifying — keep both checks to avoid IDOR/spam.

## Status thresholds
this-week vs 4-week avg (avg excludes current week): trend >= +50% = overdoing, <= -40% = behind, else ontrack; thisWeek==0 = inactive. Server sorts overdoing→behind→ontrack→inactive. Sidebar nav badge shows overdoingCount+behindCount, populated lazily when the tab first loads (static markup badge starts `display:none`).
