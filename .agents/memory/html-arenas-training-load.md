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

## Range switcher (6/12/24 weeks)
`weeks` is whitelisted server-side to 6/12/24 (else falls back to 6, the page's historic default) — same precedent as the profile stats chart. The activities fetch is paged in 1000-row chunks (`.order date desc, id asc` + `.range`).
**Why:** PostgREST silently caps a single response at 1000 rows; a 24-week window on an active club would otherwise read older weeks as zero. The id tiebreaker makes page boundaries deterministic.
**How to apply:** any new Supabase query whose window can exceed ~1000 rows needs the same paging loop; never trust a single `.select` for wide windows. Chart label thinning at 24w mirrors the profile chart: every 2nd week (4th when ≤480px), aligned backward from the always-labeled current week. tlWeeks has NO persistence (in-page var, resets to 6 on reload) — deliberate, matches page's existing behavior; profile's localStorage precedent was intentionally not imported.

## Status thresholds
this-week vs 4-week avg (avg excludes current week): trend >= +50% = overdoing, <= -40% = behind, else ontrack; thisWeek==0 = inactive. Server sorts overdoing→behind→ontrack→inactive. Sidebar nav badge shows overdoingCount+behindCount, populated lazily when the tab first loads (static markup badge starts `display:none`).
