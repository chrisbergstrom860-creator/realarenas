---
name: html-arenas feed right-rail widgets
description: How the feed page right-rail is data-driven, and the (now resolved) week-boundary trap between rolling and local-Monday windows.
---

The `arenas-feed.html` right rail (Your week, Activity streak, Athletes to follow,
Quick actions) is rendered client-side from `window.ARENAS_DATA`, populated by
`buildFeedSidebar(userId)` on the `/feed` route. Every widget has an honest
empty/low-data state and contains no hardcoded users or numbers. Follow buttons do
real POST/DELETE against `BASE + '/api/follow/:id'` and reflect the server's
`{following}` response.

**Week-boundary trap (RESOLVED):** `getDateRange('week')` is now Monday 00:00 in
the viewer's timezone (and `'month'` is the calendar month), so leaderboards and
the feed's Monday-bound "this week" stats finally agree. The trap to preserve:
any "this week" metric and its companion (km + club rank) must come from the SAME
window definition, and the at-risk/nudge 5-day checks must use `'rolling7'` —
a Monday-bound week clips to <5 days early in the week and produces false
at-risk flags.

**Why:** code review once caught club rank ranked over rolling-7-day points while
the km beside it was Monday-bound; later the /how-points-work page publicly
promised "weeks start Monday in your timezone", which forced getDateRange itself
to become Monday-true.

Note: the feed **center-column activity cards** and the **notifications modal** are a
separate concern and still contain prototype/fabricated content (Hackney RC, Alena/
Sofia/Marco, "540 pts to #4"); the right-rail task did not touch them.
