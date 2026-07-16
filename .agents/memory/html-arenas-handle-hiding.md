---
name: html-arenas handle hiding
description: Handles hidden from display but preserved in data; Session-1 surfaces done, Session-2 (sidebar chrome) remaining.
---

# Handle hiding (Session 1 shipped)

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
- Feed: all meta lines bare timeago (default 'Just now'); feed page
  sidebar-footer has NO handle span (unlike other pages).
- My profile: hero "Location · Member since"; Settings handle field deleted;
  followers/following subline "Sport · Location" (deliberate deviation from
  "name only" — keeps identical-name users distinguishable); share text
  "Follow {name} on Arenas — {url}".

**Session-2 remaining:** sidebar-footer chrome on athletes/profile and the
other shell pages still renders @handle via injected IIFEs / static markup.

**How to apply:** never re-add handle to display or search surfaces; when
touching sidebar chrome, that's the place to finish the job. Identical-name
disambiguation relies on location + sports sublines — don't strip those.
Whole-page "@" greps fail on Session-2 pages; scope checks per-surface.
