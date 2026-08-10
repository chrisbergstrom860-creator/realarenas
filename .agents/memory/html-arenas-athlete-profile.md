---
name: html-arenas public athlete profile
description: /athletes/:userId visitor page — zero-leak gate, privacy boundaries, launch wiring
---

# Public athlete profile (/athletes/:userId)

- Page: `html/arenas-athlete-profile.html`, fully server-injected (no per-user data API). Route registered AFTER `/athletes`; self → 302 `/profile`; unauth → 302 `/landing`.
- **Zero-leak gate**: nonexistent id, malformed id, deleted account, and `show_on_leaderboards=false` opt-out ALL return the byte-identical 404 (`ATHLETE_NOT_FOUND_HTML`, one constant, one send helper). Never add a second not-found path.
- **Why:** distinguishable responses would let anyone probe whether an id exists / opted out. Same standard as club/event zero-leak rules.
- Opt-out is now also filtered out of `buildAthleteDirectory` (was a pre-existing gap) — opt-out means undiscoverable everywhere: directory, profile page, leaderboards.
- `activity_feed_visible=false` boundary: activities are never even fetched; `stats:null`, `activities:null`; identity, trophy case (earned badges only — no progress, it leaks volume), PUBLIC clubs, follow counts still render. Private-state copy: "This athlete keeps their training private" + "Activities and training stats are hidden by their settings."
- Private club memberships filtered server-side (`visibility==='public'` only).
- Public stats = `computePublicAthleteStats` — deliberately separate from Pro-gated `/api/profile/stats` but shares `parseDistanceKmUnitAware` + `computeStreaks` (athlete's tz). All-time only, no PRs, no points. `ai_insight` scrubbed from activity payloads.
- Launch wiring so far: athletes-directory modal "View full profile" + my-profile Following-tab cards. A sweep of remaining link sites (feed authors, kudos/comments, club rosters, leaderboards, RSVP lists, challenge participants, notification actors) is planned follow-up work.
- Guard: `scripts/verify-athlete-profile.js` (seeded access matrix, byte-identity assertions, cleanup built in).
