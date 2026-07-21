---
name: html-arenas time-ago rule
description: Which activity time field feeds "X ago" lines vs day/calendar widgets, and the shared arenas-time.js helper.
---

**Rule:** "X ago" lines must be fed `activities.created_at` (true UTC timestamptz, default now()), never `date`. `date` is the local-NOON ISO anchor of the training day (built by the /log page), so time-since-`date` renders as hours-since-noon — the classic "fresh log shows 1h ago" bug.

**Why:** feed/social surfaces sort and label by the logged moment ("entered-feed moment, never subject date"); the training day is a separate semantic.

**How to apply:**
- All "ago" rendering goes through the shared `html/arenas-time.js` → `window.arenasTimeAgo(ts, opts)` (Just now/<60s, Xm, Xh, Xd; `opts.dateAfterDays` → locale date). Served dual-path like arenas-stat-tiles.js; loaded via head `<script>` on feed, my-profile, club-member, club-dashboard (local `timeAgo` names are thin shims). Never re-implement bucket math inline.
- Field convention at call sites: `a.created_at || a.date` (fallback is dead-safe; all real rows have created_at).
- Widgets that deliberately show the TRAINING day (my-profile overview Today/Yesterday buckets, calendar, /api/profile/overview ordering) stay on `date` — but day-bucketing must compare local calendar days, not raw ms-diff (noon anchor mis-buckets before ~noon).

**Test gotcha:** PostgREST multi-row inserts send explicit `null` for keys missing from some rows, overriding column defaults — seed rows relying on the created_at default must be inserted individually.
