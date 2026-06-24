---
name: html-arenas feed right-rail widgets
description: How the feed page right-rail is data-driven, and the week-boundary trap between rolling-7-day and local-Monday windows.
---

The `arenas-feed.html` right rail (Your week, Activity streak, Athletes to follow,
Quick actions) is rendered client-side from `window.ARENAS_DATA`, populated by
`buildFeedSidebar(userId)` on the `/feed` route. Every widget has an honest
empty/low-data state and contains no hardcoded users or numbers. Follow buttons do
real POST/DELETE against `BASE + '/api/follow/:id'` and reflect the server's
`{following}` response.

**Week-boundary trap:** `getDateRange('week')` (and therefore
`fetchActivitiesForUsers(ids, 'week', ...)`) is a **rolling last-7-days** window,
but the feed's "this week" stats (weekly km, day strip, this-week club rank) use a
**local-Monday 00:00 `weekStart`** (matching `/api/profile/overview`). If you compute
a "this week" metric and its companion (e.g. km + club rank) from different windows,
the two numbers silently disagree.

**Why:** code review caught club rank being ranked over rolling-7-day points while the
km beside it was Monday-bound, so a user could see a rank that didn't match their
own displayed distance.

**How to apply:** for any Monday-week feed/profile stat, query activities with
`.gte('date', weekStart.toISOString())` directly — do not reuse the rolling
`getDateRange('week')` helper. Only mix windows on purpose.

Note: the feed **center-column activity cards** and the **notifications modal** are a
separate concern and still contain prototype/fabricated content (Hackney RC, Alena/
Sofia/Marco, "540 pts to #4"); the right-rail task did not touch them.
