---
name: html-arenas club feed tab
description: Club dashboard "Club feed" tab — merged member-activity feed + coach announcements; schema adaptations and the milestone false-completion guard.
---

# html-arenas — Club feed tab

The coach dashboard "Club feed" tab (`arenas-club-dashboard.html` `#tab-feed`)
shows a single merged, time-sorted feed of everything happening across a club's
members, and lets coaches broadcast announcements.

## Server routes (server.js)

- `GET BASE+'/api/clubs/:clubId/feed'` — membership-gated (any member; non-member
  → 403 via `maybeSingle()`). Merges five sources for all club members:
  posts, activities, "going" event RSVPs, recent joins, challenge milestones.
  Returns `{ feed, memberCount }`, sorted desc by timestamp, sliced to 30.
- `POST BASE+'/api/clubs/:clubId/announce'` — admin/coach-only (`.in('role',
  ['admin','coach'])` → 403). Inserts a normal `posts` row (so it renders with a
  Coach badge because the author's role is admin/coach), capped at 280 chars to
  match `posts/create`, then fan-out notifies every *other* member.

## Schema adaptations (the spec assumed tables/columns this app lacks)

- No `profiles` table — names/handle/sports come from `buildUserProfileMap(ids)`
  (auth metadata). Dropped the spec's profiles join entirely.
- `memberships` has no `joined_at` → joins use `created_at` (14-day window).
- `activities` have no `created_at` → ordered by `date`; milestone `completedAt`
  is the crossing activity's `date`.
- `post_likes` has no `id` column — keyed by `(post_id, user_id)`; like counts
  computed by filtering fetched like rows, reusing the existing
  `POST BASE+'/api/posts/:id/like'` (returns `{liked}`). No duplicate like route.
- `createNotification({...})` is a SINGLE-object call (the spec's
  `(supabaseAdmin, {...})` is wrong); `supabaseAdmin` is the global singleton
  (the spec's per-route `createClient` is wrong).

## The milestone false-completion bug (must-keep guard)

The milestone loop accumulates progress over each participant's matching
activities and emits a "Completed!" item when `progress >= goal_target`. This
MUST be guarded with `goal_target > 0`:
`if (challenge.goal_target > 0 && progress >= goal_target && !completedAt) ...`

**Why:** legacy challenge rows with 0/null `goal_target` make `0 >= 0` /
`0 >= null` true, so the first activity emits a bogus milestone for every
participant. This is the same class of bug documented in
`html-arenas-challenges.md` and already guarded by the enrich code
(`isComplete: goalTarget > 0 && ...`). The create route rejects non-positive
targets, but old rows persist.

**How to apply:** any time you compare accumulated progress to a stored goal
target in this app, gate on the target being strictly positive first.

## Layout (two-column desktop, July 2026 rework)

- `#tab-feed` uses `.cf-cols` grid (head `<style>`): `minmax(0,1fr) 300px`,
  max-width 980px, padding 14px. Left `.cf-main` = filter pills + `#cf-feed-list`;
  right `.cf-side` (sticky top:14px — this page's `.main` is `overflow-y:auto`,
  so sticky works, unlike the athlete-shell `overflow:hidden` trap) = composer +
  `#cf-milestones` + `#cf-glance`.
- Mobile ≤900px: single column, `.cf-side{order:-1}` puts the composer above the
  pills; `.cf-side-extra{display:none !important}` hides milestones/glance —
  `!important` is REQUIRED because `renderCfSidebar` sets inline
  `display:block` on the milestones card.
- `renderCfSidebar(memberCount)` feeds both side cards from the same
  `cfFeedItems` payload (no fabricated numbers): milestones card auto-hides when
  no `type==='milestone'` items; glance = real memberCount + ≤3 `join` items or
  an honest "No new members in the last 14 days" line. All names `esc()`'d.
- Honesty cleanup: "Club Pro" badge/plan copy removed from dashboard topbar,
  sidebar footer (now just "N members"), and the my-profile mock club card;
  Settings nav ("Club settings"/"Billing" → deceptive /profile redirects) and
  the `#settings`/`#billing` hash branch removed from dashboard AND the invite
  page sidebar. Unknown hashes fall through to Overview. Only remaining
  "Club Pro" mentions are on /for-clubs (deferred pricing pass).

## Client (IIFE before `</body>`)

Self-contained IIFE: local `esc`/`B`/`timeAgo`/`initialsOf`, `avColors`,
`sportColors`. Chains `window.setTab` so `if (id==='feed') loadClubFeed()`
(the app's tab system is the global `setTab(id,el)` — there is no
switchTab/showTab/openTab). Reads club/profile from `window.ARENAS_DATA`.
Every DB-derived string is `esc()`'d before `innerHTML` — including the
computed initials (a name like `<img>` would otherwise inject `<`), and inline
`onclick` embeds only the `esc()`'d post id. `#tab-feed` wrapper uses
`style="padding:0"` because the spec markup brings its own spacing. Composer
textarea font is `var(--font)` (this file has no `--sans`).
