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
