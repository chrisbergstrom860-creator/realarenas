---
name: html-arenas goals feature — mapping decisions
description: Pre-build mapping conclusions for the Set Goals & Track Progress Pro feature (3-session build); decisions the build sessions must stay consistent with.
---

# Goals feature — mapping-session conclusions (session 1 of 3, nothing built yet)

- **Units:** goal progress must use `parseDistanceKmUnitAware` (the profile "km logged" precedent), NOT the app-wide `parseDistanceKm` (swim-metres ~1000× bug). Store goal `unit` ('km'|'mi'), convert target to km once on read. Accepted drift vs challenges distance math (buggy parser) — same accepted drift as the profile headline.
- **Streaks:** algorithm exists inline in 4 spots (profile stats route, badge stats, challenges route, feed sidebar) with identical semantics (distinct `toDateString` days; current = run ending today-or-yesterday, gap<=1). NO shared helper exists — extract `computeStreaks(activities)` during build rather than adding a 5th copy.
- **Progress = computed on read** (no stored counters), mirroring challenges `enrich()`; guard every completion check with `target > 0` (the challenges 0>=0 lesson). `duration` goals need `parseDurationHours` (challenges deliberately report 0 for duration — don't ride computeChallengeProgress for that type).
- **Periods:** weekly = Monday-start local calendar week (`getWeekStart(0)`), monthly = local calendar month — matching profile-stats/reports conventions, NOT leaderboards' rolling `getDateRange`. Local date parts, never toISOString (UTC+ skew rule). activities.date is timestamptz stored as midnight UTC.
- **Gating shape:** goals are purely individual → `requireProPlan('goals')` middleware fits writes (no club-aware inline needed, unlike challenges). GET = requireAuth + self-only (IDOR rule), ungated → lapsed read-only falls out naturally ('past_due' still counts as pro = grace). DELETE ungated (exit-action principle, like challenge leave).
- **Goals tab locked panel ≠ stats tab pattern:** stats skips the fetch entirely when proLocked; goals must FETCH even when proLocked (reads allowed) and render read-only with upgrade CTAs on create/edit only.
- **Table must be user-created** via Supabase SQL editor (service role can't DDL) — provide exact CREATE TABLE + RLS SQL, degrade gracefully until it exists (activities/achievements pattern).
- **Copy flip:** landing + billing Pro cards list "Set goals & track progress" as coming-soon — flip to live when built (keep copy in lockstep with gate boundary).
