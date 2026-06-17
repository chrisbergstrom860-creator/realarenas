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
are inserted with `createTextNode` (XSS-safe); the sport→icon map is fixed.
Empty state is "No clubs yet". Note: the Profile page's in-page "My Clubs" TAB is
a separate renderer — do not confuse it with the sidebar one.

**Click target is ROLE-AWARE (not fixed to member view).** `getSidebarClubs`
returns `{id,name,handle,sport,role}`, so the renderer branches on `club.role`:
`admin`/`coach` → `nav('/clubs/dashboard?club=' + club.id)`, everyone else →
`nav('/clubs/member/' + club.id)`. This is what lets a coach get back to their
dashboard from any athlete page (the old dead-end was that it always went to the
member view). Keep this branch identical across all 7 pages.

**Why coaches need `?club=`:** the `/clubs/dashboard` route picks the viewer's
most-recent admin/coach membership by default, so without an id a multi-club coach
would land on the wrong club. The route honors `?club=<id>` ONLY when the viewer
is admin/coach of that club (role-filtered membership query = IDOR-safe); an
unmanaged/unknown id silently falls back to the default club.

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

# "Log activity" sidebar highlight

"Log activity" is NOT its own page — its sidebar item does `nav('/profile#activities')`,
landing on the profile page's Activities tab. So its active highlight is driven by
the profile page's `setTab(id)`, which clears `active` from all `.nav-item`s then
re-applies it by tab→label: `activities`→"Log activity", `settings`→"Settings",
everything else (overview/stats/achievements/clubs/following)→"My profile".

**Why:** Previously `setTab` only re-highlighted on overview/settings, so the
activities tab (and stats/etc.) left the sidebar with no highlight at all.

**How to apply:** Keep every profile tab mapped to some sidebar label so the
sidebar is never blank. Matching is `textContent.includes(label)`, which relies on
the static labels "My profile"/"Log activity"/"Settings" being unique — if a
dynamically injected "My clubs" item could ever collide, switch to an explicit
selector/data-attribute.
