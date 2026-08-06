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

**Mobile restructure (shipped):** on phones (page-local 768px block gated on
`body:has(.bottom-nav)`) only the Activity streak card is visible — the other
three cards carry `.sc-mobile-hide{display:none}` — and the whole `.side-col`
gets `order:-1`, lifting it above the feed column (shared shell already
collapses `.main` to one column and un-stickies the rail). Pure CSS reorder,
single render, no duplicated markup. `#follow-card`'s loader clears inline
display (doesn't set `block`) so JS can't re-show it on mobile. Geometry guard
pins the rail to EXACTLY 1 visible card on phones (`min:1,max:1` — lib supports
`max` now). Mobile users lose passive follow discovery (rail suggestions);
`/athletes` remains reachable only via topbar search — no bottom-nav tab.

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

**Mobile (≤768px, bottom-nav gated):** per-card rail decision — "Your week" +
"Activity streak" hidden (`.fs-side-extra`; both live on profile Stats & PRs);
"Athletes to follow" + "Quick actions" move ABOVE the feed via `.side-col{order:-1}`
(club-dashboard precedent). Quick actions must stay visible on mobile: it is the
ONLY mobile entry point to /challenges (bottom nav has no Challenges item, and the
leaderboards "Active challenges" rail card is hidden on mobile too).

Note: the feed **center-column activity cards** and the **notifications modal** are a
separate concern and still contain prototype/fabricated content (Hackney RC, Alena/
Sofia/Marco, "540 pts to #4"); the right-rail task did not touch them.

**Desktop reading-measure cap:** feed .main track is minmax(0,656px) 300px + justify-content:center (640px post text after 16px gutter); cap deliberately bites at 1280px too; keep it page-local, NOT in arenas.css. Events .body-grid is still unbounded — needs its own (banner-driven, wider) value if ever capped; challenges/leaderboards already cap via max-width:1280 centered.
