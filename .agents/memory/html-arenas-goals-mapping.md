---
name: html-arenas goals feature — decisions & lessons
description: Goals Pro feature (API + my-profile Goals tab + Overview mini-card + live marketing copy, all shipped) — decisions future work must stay consistent with, plus build lessons.
---

# Goals feature — fully shipped (API, Goals tab, Overview mini-card, live pricing copy)

## Decisions locked in by the built API
- **Units:** goal progress uses `parseDistanceKmUnitAware` (profile "km logged" precedent), NOT the app-wide unit-blind `parseDistanceKm`. Goal `unit` ('km'|'mi') stored; target converted to km ONCE on read (MI_TO_KM=1.609, symmetric with the parser's mile factor); progress reported back in the goal's own unit (2dp).
- **Streaks:** `computeStreaks(activities)` shared helper now exists (near getWeekStart). There were FIVE inline copies, not four — the fifth was in /api/profile/overview; challenges used a daySet probe-walk variant that is semantically identical (proven by a 5,015-case equivalence test). Never re-inline; challenges still keeps its daySet for weekGrid rendering.
- **Streak goals measure the ALL-TIME current streak** (parity with the Stats tab number); the goal window is only a deadline, not a streak filter.
- **State is computed, not stored:** progress/pct/isComplete/onTrack/state(active|completed|expired) come from `enrichGoal` on read; only `status` (active|archived) is persisted. Only custom-period goals can expire.
- **Windows:** weekly = Monday-start local week (`getWeekStart(0)`), monthly = local calendar month, custom = start..end **inclusive**; local date parts, never toISOString (UTC+ skew rule).
- **Distance goals with sport=null** mean "any DISTANCE_SPORTS activity" (running/cycling/swimming/hiking filter applied in progress).
- **Gating:** POST/PATCH = `requireProPlan('goals')`; GET = requireAuth self-only, degrades to `{active:[],archived:[],unavailable:true}` if the table is missing; archive + DELETE = requireAuth only (ungated exit actions). Lapsed (canceled sub) can read/archive/delete but not create/edit — falls out of the gate shape, don't special-case.
- **Validation codes** the UI must handle: sport_not_distance, unit_required, unit_not_allowed, end_date_required, end_date_not_allowed, invalid_start_date, invalid_end_date, invalid_target, invalid_type, invalid_sport, goal_limit (5-active soft cap, 400), immutable_field (PATCH type/status). PATCH validates the MERGED row.
- **Goals tab FETCHES even when proLocked** (reads allowed) and renders read-only with upgrade CTAs on create/edit only — unlike stats tab which skips the fetch.
- **Copy flip DONE:** landing + billing Pro cards list "Set goals & track progress" as a live ✓ feature. "AI coaching — coming soon" stays until that ships (copy in lockstep with the gate boundary). Goals appear in exactly those two marketing spots — nothing anywhere implies coaching/recommendations/AI in the goals context; keep it that way (feature is 4 self-tracked types with a linear on-pace projection).
- **Overview mini-card:** the profile Overview renders "🎯 My goals · N in progress" (top 2 by daysRemaining asc then pct desc, state==='active' only), hidden entirely at zero; goals fetch is `.catch`-guarded so a goals failure can never break the Overview; formatting shared from the Goals IIFE via `window.__goalFmt` (safe because inline scripts run before fetch microtasks resolve).

## Goals tab decisions
- All Goals UI lives in one IIFE in arenas-my-profile.html; the client NEVER recomputes numbers — progress/pct/onTrack/daysRemaining/state all render from API enrichment, and server 400 `message` strings surface directly in the form.
- **PATCH bodies omit date keys unless period=custom** — `start_date` is NOT NULL in the DB, so sending `start_date: null` would 500. Server clears end_date itself when period moves off custom.
- Locked-panel precedence: unavailable/error → locked panel ONLY when proLocked AND zero goals → lapsed read-only banner (proLocked + goals exist) → pro cards/empty state.
- Goal type is immutable on edit (disabled type cards + hint); MAX_ACTIVE=5 mirrored client-side (cap message + disabled button). No escaping needed in card markup: every field is a server enum, number, UUID, or ISO date — but free-text sinks (form error, toast) still use textContent.
- Date-hint copy is edit-aware: "(today if blank)" on create vs "(unchanged if blank)" on edit, because PATCH omits a blank start date rather than resetting it.

## Build lessons
- `goals` table is live in Supabase (user-created; 12 cols incl. defaults status=active, start_date=today) with CHECK constraints on type/period/status/target_value>0 — a malformed enum reaching Postgres is a 500, so validate everything app-side first.
- Backgrounded processes do NOT survive across separate bash tool invocations here — run a temp test server and its test suite inside ONE command (`(node server.js &); sleep 3; node test.cjs; kill ...`).
