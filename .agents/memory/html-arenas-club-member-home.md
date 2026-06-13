---
name: html-arenas club member-home page
description: How the /clubs/member/:clubId page is wired to real data — its IDOR boundary, the "coach announcements" approximation, single-page layout, and challenge-progress fallback.
---

# Club member-home page (`/clubs/member/:clubId`)

The page content is rendered client-side from `GET BASE+'/api/clubs/:clubId/member-home'`
(requireAuth, JSON). The route returns `{club, stats, standing, announcements, events,
challenges, roster, myRole}` and the page splits these into `#cm-sec-*` sections.

## Membership gate is the IDOR boundary
The route resolves the viewer's `memberships` row for `(user_id, club_id)` with
`.maybeSingle()` and 401/403s before returning ANY club-scoped data (roster, events,
challenges, standing, RSVP/like state).
**Why:** this single gate is what prevents cross-club reads; every club-scoped field on
this page depends on it. Keep all new member-home data behind the same gate — do not add
fields that read club data before the membership check.

## "Coach announcements" are posts, not a table
There is no announcements table. The announcements block is just recent `posts` authored
by members whose `memberships.role` is `admin`/`coach` (same global-posts model as the
club-feed tab). The kudos button toggles `post_likes` via `POST BASE+'/api/posts/:id/like'`.
**Why:** intentional approximation given the schema. If private/club-scoped announcements
are ever required, posts need an explicit club scope or an announcement marker — do not
assume coach-authorship implies club privacy.

## Single scrolling page, not tabs
The old hardcoded 7-tab `<main>` was replaced by one `#cm-content` container. `setTab(id,el)`
is now scroll-nav: it sets the active sidebar item and `scrollIntoView`s `#cm-sec-<id>`
(falls back to scroll-to-top). **How to apply:** don't re-introduce `.tab-content`/`tab-*`
show/hide logic here; add new sections as `#cm-sec-<id>` anchors instead.

## Challenge-progress fallback
Progress is modeled only for `goal_type` of distance / streak / sessions; any unknown type
is counted as sessions, and completion % is guarded by `goal_target > 0`.
**Why:** known limitation — if duration/performance challenge types are added, this page
will mis-count them until the canonical challenge-progress helper is reused here.
