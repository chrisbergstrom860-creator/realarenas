---
name: html-arenas handle hiding
description: Handles hidden from ALL display but preserved in data; Sessions 1+2 complete (content surfaces, sidebar chrome, club surfaces, pickers).
---

# Handle hiding (Sessions 1 + 2 shipped — complete)

**The rule:** handles are display-hidden, NOT deleted. Server keeps accepting
and preserving `meta.handle` (`/api/profile/update` only writes it when a
string is sent; clients no longer send it, so stored values persist). Payloads
still carry `handle` — clients simply ignore it. UUID is the real key; nothing
resolves users by handle, so hiding is safe.

**Why:** user wants a name-first product but reversible data (handles may
return later); zero uniqueness enforcement exists, so handles were never
reliable identifiers anyway.

**Session-1 surfaces (done):**
- Athletes: searchText() has no handle; card subline "📍 location · Sports"
  via plain-label `sportName()` (no emoji, unlike arenasSportTag pills);
  modal subline location-only.
- Feed: all meta lines bare timeago (default 'Just now').
- My profile: hero "Location · Member since"; Settings handle field deleted;
  followers/following subline "Sport · Location" (deliberate deviation from
  "name only" — keeps identical-name users distinguishable); share text
  "Follow {name} on Arenas — {url}".

**Session-2 surfaces (done):**
- Sidebar-footer chrome on all shell pages: name only. The per-page identity
  IIFEs had drifted into 3 variants (`.user-handle` class loop, '@jamiek'
  text-matcher, bespoke sfWrap children) — kept un-consolidated by explicit
  instruction; each was trimmed in place.
- Club surfaces: dashboard members table/search (name only), 'joined' details,
  event RSVP rows, club feed meta (action only); invite members table rows =
  avatar + name + role + joined (members payload has no email; invite
  pending/history tables legitimately show invite emails).
- Pickers gained same-name disambiguation: events invitee list = avatar chip +
  name + muted location; challenges dropdown = "Name — Location".
  `displayFromUser` now returns `location` (additive) to feed these.
- leaderboards yb-sport-label no longer falls back to @handle (empty instead);
  events detail is "Organised by {name}" only.

**How to apply:** never re-add handle to display or search surfaces.
Identical-name disambiguation relies on location/avatar sublines — don't strip
those. `/for-clubs` page renders a CLUB handle (@yourclub) — different entity,
intentionally untouched; exclude it from app-wide "@" greps.
