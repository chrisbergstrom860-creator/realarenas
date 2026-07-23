---
name: html-arenas kudos on activities
description: Activity kudos feature — activity_likes table shape, degrade rule, count-only profile convention, and the club-feed deferral.
---

# html-arenas kudos on activities

Feed activity cards carry the same kudos system as post cards.

## Storage: `activity_likes` (user-created via SQL, like activities/achievements)
- Shape mirrors `post_likes`: keyed `(activity_id, user_id)` PRIMARY KEY, **no
  `id` column**, `created_at`, FKs cascade on activity delete AND auth-user
  delete. RLS enabled with NO policies (all access is service-role).
- `post_likes` does NOT generalize (no target_type/target_id) — that's why a
  parallel table exists. Any future kudos-able entity gets its own table.
- One-kudos-per-user is the PK (23505 on duplicate insert); the route is a
  toggle (select → delete/insert), so double-POST = unlike, never an error.

## Degrade rule
- `fetchActivityLikes()` in server.js returns `[]` on any error (table missing
  → zero counts everywhere, button still renders, POST returns `{error}` →
  toast). Same blocker pattern as activities/achievements: user must run the
  CREATE TABLE SQL; **PostgREST schema cache can lag minutes after DDL** — a
  `head:true` count probe can false-positive `error:null` while a real select
  still 404s (PGRST205). Trust the plain select, not the head probe.

## Conventions (all mirror posts exactly)
- Self-kudos ALLOWED, never notified (owner-id check before createNotification).
- Notification type `'like'` → recipient-gated by `notify_kudos` ("Kudos on
  activities" toggle) inside createNotification; link `/feed`.
- "Good Sport" badge `kudosGiven` = post_likes given + activity_likes given.
- Profile Activities tab is **count-only** (chip shown only when N>0, no
  give-button) — giving happens where OTHERS' activities appear, i.e. the feed.
- test-data-sweep.js USER_REFS + COMPOSITE_KEYS include activity_likes.

## Club feed deferral (deliberate)
- Club-dashboard Feed tab activity cards have NO kudos (`canLike` = post/
  announcement only) and its renderer + server rollup + toggleClubFeedLike are
  a SEPARATE build from the feed's collectActivityItems — extending it is not
  shared-code-free. Reported, not built.
