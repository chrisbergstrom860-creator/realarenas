---
name: html-arenas leaderboards
description: Athlete + club-dashboard leaderboards — scoring model, at-risk/nudge anti-spam rule, where identity comes from.
---

# html-arenas leaderboards

Two leaderboards: the athlete-facing `/leaderboards` page and the coach dashboard Leaderboard tab. Endpoints: `GET BASE+/api/leaderboard/{platform,following,club,club-dashboard}` and `POST BASE+/api/clubs/:clubId/nudge-atrisk`.

## Points are a deliberate heuristic
Scores come from a `SPORT_POINTS` table (distance sports score per-km, the rest per-session), computed from raw `activities`.
**Why:** there is no stored points/score column in Supabase; ranking must be derived.
**How to apply:** to change scoring, edit `SPORT_POINTS` + `calculatePoints` — don't invent a parallel scheme. `distance` is a free-form string; only the numeral is used (units ignored app-wide).

## At-risk + nudge are ALWAYS recomputed server-side
At-risk = club members with no activity in the last 5 days, computed from the full membership roster (so zero-activity members count). The nudge endpoint recomputes this set itself and ignores any client-supplied IDs.
**Why:** accepting recipient IDs from the client would let a coach spam arbitrary users with notifications — the same anti-spam convention other notification endpoints here follow.
**How to apply:** never pass user IDs in the nudge body; verify the caller's admin/coach role for the specific clubId first. The dashboard view excludes the viewing coach from at-risk so its count matches the nudge recipient count.

## Identity comes from auth metadata, not profiles
Name/handle/sports/location read from auth `user_metadata` (no profiles table). The platform board enumerates everyone via `listAllAuthUsers()` (metadata inline, no per-user calls); following/club boards resolve the small ID set via `buildUserProfileMap` (per-id `getUserById`).
**How to apply:** fetch all activities for the user set in ONE query and bucket by user_id; never query per-user. Period 'all' returns a null start — skip the date `.gte`.

## Athlete page has no tab bar
The `/leaderboards` page's scope `<select>` IS the platform/following/club switch (the old local/national/global options were pure mock). The client maps period `alltime`→`all` for the API and renders "—" in the Change column (no historical rank snapshots exist).

## The right rail is real-data only (banner/podium/table stay server-rendered)
The athlete `/leaderboards` right rail now contains ONLY an "Active challenges" card, populated client-side by a fetch of `GET BASE+/api/challenges` (same contract the Challenges page uses), filtered to `isJoined && !isExpired && !isComplete`. Everything else that used to live there (Near-you / Medals / Global-top-5, sport count-pills, the "· Pro" tier suffix, points/reward badges) was fabricated and has been deleted along with its CSS — do not reintroduce; none of it has a backing column.
**Why:** pre-launch app with no real data behind those widgets; showing invented numbers is dishonest.
**How to apply:** render challenges with `c.title` + real `c.goal_unit`; use the server's clamped `c.pct` for the bar. `goal_type === 'duration'` has NO server progress branch (computeChallengeProgress only does distance/sessions/streak → progress always 0), so render duration goals WITHOUT a bar — show "`goal_target goal_unit` goal · N days left" instead of a misleading 0%.
