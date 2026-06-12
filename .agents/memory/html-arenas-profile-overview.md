---
name: html-arenas athlete-profile Overview tab
description: The athlete profile Overview tab (default tab) — its consolidated route, and the spec mismatches corrected against the real schema.
---

# html-arenas — athlete-profile Overview tab

This is a **different feature** from the coach club-dashboard Overview
(`html-arenas-overview.md`). This one is the **default active tab** of the
athlete's own profile page (`arenas-my-profile.html`, panel `#po-body`,
header `#htab-overview`). It renders client-side from two fetches:
`GET /api/profile/overview` + `GET /api/profile/achievements`.

The overview route returns `{ week:{activities,km,hours,points}, dayStrip,
currentStreak, recentActivities, activeChallenges, upcomingRsvps }`, self-only
via `req.user.id`. It reuses the shared `calculatePoints`, `parseDurationHours`,
`parseDistanceKm`, and `computeChallengeProgress` helpers so its numbers agree
with the leaderboard and Challenges pages.

## Spec vs reality (the build spec was wrong on these)
- The spec selected/ordered recent activities by `created_at`. `activities` has
  **no `created_at`** — order by the `date` column (and client `timeAgo` uses
  `a.date`).
- The spec used PostgREST FK embeds (`challenge_participants.select('challenges(...)')`,
  `event_rsvps.select('events(...)')`). **Embeds are used nowhere in this app and
  don't resolve here** — fetch the joined `challenges`/`events` rows separately
  via `.in('id', ids)`.
- The spec created a per-route `createClient(...)` and an unprefixed route. Use
  the **global `supabaseAdmin`** and **BASE-prefix** the route + both client
  fetches (`/html` Replit vs root Railway deploy).
- The spec rendered other users' challenge titles, event title/location, and
  activity free-form fields raw into `innerHTML` → **stored XSS**. Escape every
  user-controlled string (local `escOv()`); titles come from challenges/events
  created by *other* users that this user joined/RSVP'd.

## Rendering gotchas
- Overview is the **default tab**, so call `loadProfileOverview()` on script-eval
  (script sits at end of body) **and** reload on `#htab-overview` click — chaining
  only the click is not enough.
- "View all →" links call `.click()` on the real `#htab-achievements` /
  `#htab-activities` headers so those tabs' own load listeners fire; use
  `nav('/challenges')` / `nav('/events')` for cross-page links (nav prepends BASE).

**Why:** these mismatches would have thrown (created_at), returned nothing
(embeds), broken under the `/html` base path, or shipped an XSS hole.
**How to apply:** when extending profile-data routes, trust the live schema +
existing `.in()` fetch pattern over any spec snippet, keep routes BASE-prefixed,
and escape any string that originates from another user's content.
