---
name: html-arenas events feature
description: Constraints/decisions for the Arenas events + RSVP feature (server routes, feed RSVP cards, events page wiring).
---

# Events feature (html-arenas)

The events page (`/events`) is data-injected via `injectArenasData` + `requirePageAuth`
(was a static `sendFile` stub). The rich mock UI (filter bar, featured card, "Near you"
and "Hackney RC events" side-cards) is **hidden at runtime** by the client IIFE because it
operated on removed mock `.ev-card`s / listed hardcoded fake events. Real events render into
`#events-grid` (forced single-column) and the real "Your RSVPs" side-card is populated in place.

## Durable rules

- **Club-scoped writes must verify membership first.** `POST /api/events/create` only accepts a
  `club_id` if the caller has a matching `memberships` row; otherwise it rejects. Service role
  bypasses RLS, so without this check anyone could create events in any club and trigger a
  club-wide notification fan-out.
  **Why:** caught in review as an access-control + notification-spam vector.
  **How to apply:** any future club-scoped insert/fan-out needs the same membership gate.

- **Notification fan-out only on the transition *into* a state, never on repeats.** RSVP
  notifications (to organiser + the actor's followers) fire only when `status==='going'` AND the
  prior row was not already `going`. Re-clicking "Going" must not re-notify.
  **Why:** review flagged duplicate-notification spam on repeated clicks.
  **How to apply:** mirror this for any toggle endpoint — read prior state, compare, then notify.

- **RSVP toggle is client-driven via explicit `cancelled`.** Buttons send `cancelled` when the
  user clicks an already-active state (going→cancelled / interested→cancelled); the server deletes
  the row on `cancelled`. The endpoint itself is not self-toggling.

## Shape notes

- `event_rsvps` has a usable `created_at` (used to order followed-users' "going" RSVPs in the feed).
- Feed shows "X is going to <event>" cards from `window.ARENAS_DATA.followingRsvps` (built by
  `buildFeedRsvps`), alongside the existing activity cards. Names from auth metadata; events joined
  in JS (no PostgREST embeds, consistent with the rest of this app).
