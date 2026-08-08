---
name: Challenge goal types
description: Four goal types (distance/duration/sessions/streak="Active days"), frozen stored values, shared phrase/label helpers, day-key "ended" semantics.
---

# Challenge goal types (reworked Aug 2026)

- Allowed types: `CHALLENGE_GOAL_TYPES = ['distance','duration','sessions','streak']` — single constant used by BOTH create (400 `invalid_goal_type`) and PATCH. Never add a type without a compute branch everywhere.
- **Stored values are FROZEN**: `'streak'` stays in the DB but displays as **"Active days"** everywhere (it always counted distinct active days, never consecutive). Display via `goalTypeLabel()` maps in challenges page + club dashboard — never `cap(goal_type)`.
- **Why:** rename-in-place avoids a data migration and keeps old rows/exports working; the export intentionally shows the stored value.
- Duration = sum `parseDurationHours(a.duration)` in the challenge window. Compute lives in `computeChallengeProgress` AND three inline paths (member-home, club-feed milestone loop, reports rollup — rollup now calls the shared helper). **Any activities select feeding challenge progress MUST include `duration`** — a missing column silently computes 0 (caught by review: milestone loop selected only sport/distance/date).
- Milestone loop counts streak days via Set of member-zone dayKeys (one-per-activity announced milestones early on multi-activity days).
- Notification/post bodies use `challengeGoalPhrase(ch)` ("3 active days", "2 hours") — never interpolate raw goal_type.
- "Ended" semantics: `challengeHasEnded(ch, tz?)` compares **day keys** — ended only when the end DAY is fully over (matches window admitting end-day activities). Authorization uses UTC key (uniform); display `isExpired` uses viewer zone. Card chrome: dim/"Ended"/hide-Invites key on `isExpired` only; goal-met-but-live shows "Goal reached · N days left". Completed tab stays `isExpired || isComplete`.
- Create form goal grid is 2×2 (distance 📍, duration ⏱️, sessions 📋, active days 📆); `selectGoalType` snaps unit to the type's natural unit; unit select includes `hours`.
- DB: `challenges.goal_unit` is NOT NULL — API creates must send a unit.
- Verify: `scripts/verify-challenge-goal-types.js` (all types e2e, invalid 400, distinct days, end-day boundary, invite copy, club-feed duration milestone). NOTE: `verify-challenge-edit-delete.js` tends to leave Ed* user residue — sweep after running it.
- Club create API responds `{redirect:'/clubs/dashboard?club=<id>'}`, not a club object; follow route is `/api/follow/:userId`.
