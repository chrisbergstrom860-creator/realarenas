---
name: html-arenas sidebar "My clubs"
description: Invariant for how the left-sidebar "My clubs" list is rendered across every athlete-facing page.
---

# Sidebar "My clubs" rendering invariant

Every athlete-facing page (feed, profile, events, leaderboards, challenges,
athletes, notifications) renders its sidebar "My clubs" list from
`window.ARENAS_DATA.clubs` via ONE byte-identical client IIFE placed before
`</body>`. The server injects `clubs` on each of those routes using the shared
`getSidebarClubs(userId)` helper in `server.js`.

**Rule:** Never hardcode club nav-items in the static sidebar HTML, and keep the
per-page renderer copies identical. The static markup must contain only the
`<div class="nav-section-label">My clubs</div>` label — no club rows.

**Why:** The sidebar previously drifted — Feed rendered real clubs, Profile used
a hardcoded icon + single club, and the other pages showed a stale hardcoded
"Hackney RC" demo row. Centralizing on one renderer + one server helper is what
keeps the sidebar consistent everywhere.

**How to apply:** When adding a new athlete page or touching any sidebar, copy
the existing renderer verbatim and ensure the route injects `clubs`. Club names
are inserted with `createTextNode` (XSS-safe); the sport→icon map and the
`nav('/clubs/member')` click target are fixed. Empty state is "No clubs yet".
Note: the Profile page's in-page "My Clubs" TAB is a separate renderer — do not
confuse it with the sidebar one.

Out of scope by user decision: other hardcoded "Hackney RC" demo content (feed
posts, event cards, bios, club-context pages, marketing) is intentionally left
alone.

# MY ARENAS nav-set invariant

The "MY ARENAS" sidebar section must contain exactly these items, in this order,
on ALL 7 athlete pages: Feed, My profile, Events, Leaderboards, Challenges,
Log activity, Athletes — then the "My clubs" label.

**Rule:** Notifications is reached via the topbar 🔔 bell only; it must NEVER be a
sidebar nav-item on any page. The notifications page therefore has no `active`
sidebar highlight, which is acceptable. Each page keeps its own page-specific
`active` item, so markup is "canonical set+order identical," not byte-identical.

**Why:** Notifications nav-items had drifted onto challenges, leaderboards, and the
notifications page itself, breaking sidebar parity.

**How to apply:** The unread count is shown via `id="nav-unread-badge"`. After
removing that element from the notifications sidebar, its `decrementUnread`/
`markAllRead`/`clearAll` must null-guard the lookup (the `syncUnread` path and the
other 6 pages' lookups already do). Leave the separate topbar `.notif-dot` logic
untouched.
