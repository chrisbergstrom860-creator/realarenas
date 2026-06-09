---
name: html-arenas club events tab
description: How the coach club-dashboard Events tab is wired (server rollups + coach actions) and its authz/UX rules.
---

# Club Events tab (coach dashboard, /clubs/dashboard)

The Events tab is server-rendered data injected as `window.ARENAS_DATA`, then a
client script in `html/arenas-club-dashboard.html` renders cards into
`#club-events-list` and updates the `#ev-stat-*` stat tiles.

- The `/clubs/dashboard` route computes the rollup itself (upcomingEvents,
  pastEvents sliced to 5, eventStats) and attaches it to clubData. Going-member
  names come from auth metadata via `buildUserDisplayMap` — there is NO usable
  profiles table (see html-arenas-supabase-schema).
- Coach-only actions are 3 routes: `POST BASE+/api/events/:id/{nudge,post-to-feed,duplicate}`.
  All gate on `requireEventManager(eventId,userId,cols)` which checks the caller
  is admin/coach in the event's club. The user's original snippet had NO authz —
  add it for any new event-management route.

**Why:** the snippet assumed a profiles table and skipped authorization; both are
wrong for this app.

**Cancel/delete rule:** `DELETE BASE+/api/events/:id` must allow the creator OR a
club admin/coach, and must return an error when 0 rows match. A `created_by`-only
filter silently deletes 0 rows for a non-creator coach yet returns success, so the
card disappears then reappears on reload (false-success UX).

**Client rules:** escape every DB string with a local `esc()` before `innerHTML`;
define action handlers UNCONDITIONALLY (not after the empty-state early return, or
the "Create first event" button is dead); the tab is shown via the global
`setTab(id, el)` — wrap `window.setTab` to call the renderer when id==='events'.

**`requireEventManager` columns trap:** the helper reads `event.club_id` internally to
check membership, so the `columns` arg you pass MUST include `club_id`. Omitting it makes
`event.club_id` undefined → helper returns null → caller responds "Event not found" even
for a real event owned by the coach. (This silently broke View RSVPs once.) Express route
ordering is NOT the issue here — `:id` never matches across `/`, so `/events/:id` (PATCH/DELETE)
cannot intercept `/events/:id/rsvps` (GET).

**View RSVPs / Edit:** two more routes back the card buttons — `GET BASE+/api/events/:id/rsvps`
(gate via `requireEventManager` with `'id, title, club_id'`; names via `buildUserDisplayMap`; filter to going/interested)
and `PATCH BASE+/api/events/:id` (creator OR admin/coach authz like DELETE; build the
update obj from defined fields only; reject empty updates + invalid date). Edit modal
pre-fills from `window.ARENAS_DATA` (upcoming+past). Same false-success trap applies:
never use a `created_by`-only filter — it no-ops silently for managing coaches.
