---
name: html-arenas goals feature — decisions & lessons
description: Goals Pro feature (3-session build; session ① API done, no UI yet) — decisions later sessions must stay consistent with, plus build lessons.
---

# Goals feature — session ① (API) built; sessions ②/③ (UI) pending

## Decisions locked in by the built API
- **Units:** goal progress uses `parseDistanceKmUnitAware` (profile "km logged" precedent), NOT the app-wide unit-blind `parseDistanceKm`. Goal `unit` ('km'|'mi') stored; target converted to km ONCE on read (MI_TO_KM=1.609, symmetric with the parser's mile factor); progress reported back in the goal's own unit (2dp).
- **Streaks:** `computeStreaks(activities)` shared helper now exists (near getWeekStart). There were FIVE inline copies, not four — the fifth was in /api/profile/overview; challenges used a daySet probe-walk variant that is semantically identical (proven by a 5,015-case equivalence test). Never re-inline; challenges still keeps its daySet for weekGrid rendering.
- **Streak goals measure the ALL-TIME current streak** (parity with the Stats tab number); the goal window is only a deadline, not a streak filter.
- **State is computed, not stored:** progress/pct/isComplete/onTrack/state(active|completed|expired) come from `enrichGoal` on read; only `status` (active|archived) is persisted. Only custom-period goals can expire.
- **Windows:** weekly = Monday-start local week (`getWeekStart(0)`), monthly = local calendar month, custom = start..end **inclusive**; local date parts, never toISOString (UTC+ skew rule).
- **Distance goals with sport=null** mean "any DISTANCE_SPORTS activity" (running/cycling/swimming/hiking filter applied in progress).
- **Gating:** POST/PATCH = `requireProPlan('goals')`; GET = requireAuth self-only, degrades to `{active:[],archived:[],unavailable:true}` if the table is missing; archive + DELETE = requireAuth only (ungated exit actions). Lapsed (canceled sub) can read/archive/delete but not create/edit — falls out of the gate shape, don't special-case.
- **Validation codes** the UI must handle: sport_not_distance, unit_required, unit_not_allowed, end_date_required, end_date_not_allowed, invalid_start_date, invalid_end_date, invalid_target, invalid_type, invalid_sport, goal_limit (5-active soft cap, 400), immutable_field (PATCH type/status). PATCH validates the MERGED row.
- **Goals tab (session ②) must FETCH even when proLocked** (reads allowed) and render read-only with upgrade CTAs on create/edit only — unlike stats tab which skips the fetch.
- **Copy flip still pending:** landing + billing Pro cards list "Set goals & track progress" as coming-soon — flip to live only when the UI ships (copy in lockstep with the gate boundary).

## Build lessons
- `goals` table is live in Supabase (user-created; 12 cols incl. defaults status=active, start_date=today) with CHECK constraints on type/period/status/target_value>0 — a malformed enum reaching Postgres is a 500, so validate everything app-side first.
- Backgrounded processes do NOT survive across separate bash tool invocations here — run a temp test server and its test suite inside ONE command (`(node server.js &); sleep 3; node test.cjs; kill ...`).
