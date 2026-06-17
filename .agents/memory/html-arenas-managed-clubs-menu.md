---
name: html-arenas managed-clubs avatar dropdown
description: How the "Clubs you manage" section in the #userMenu avatar dropdown is injected and gated across shell pages.
---

# "Clubs you manage" avatar-dropdown section

A coach/admin-only section injected at the TOP of the `#userMenu` avatar dropdown,
linking each managed club to `/clubs/dashboard?club=<id>`. This is the **mobile**
route to a club dashboard, since the sidebar "My clubs" list is `display:none`
≤768px.

## How it is wired (the durable, non-obvious parts)
- It is injected by **`injectBottomNav()`** — that function is now the shared
  injector for BOTH the mobile bottom nav AND this menu script. It is the single
  chokepoint hit by exactly the 9 shell pages (7 athlete + club-dashboard +
  club-member) and NOT by blog / club-invite / landing.
  **How to apply:** any new shell-wide client chrome that must appear on those 9
  pages (and only those) belongs in `injectBottomNav`, not per-page HTML.
- The client script reads `window.ARENAS_DATA.clubs` (role comes from
  `getSidebarClubs()`), filters `role==='admin'||'coach'`, builds DOM via
  `createElement`/`textContent` (XSS-safe), no-ops for pure athletes / missing
  `#userMenu` / missing `ARENAS_DATA`, and self-guards double-insert via both a
  server `indexOf('buildManagedClubsMenu')` check and a client
  `menu.querySelector('.menu-club-item')` check.

## Gotcha: club-dashboard route lacked clubs[]
The `/clubs/dashboard` route historically injected only the single managed
`club` object — NOT the viewer's `clubs[]` with roles. Any feature on that page
needing the full membership-with-role list must add
`clubs: await getSidebarClubs(req.user.id)` to its `clubData`.
**Why:** without it the dropdown (and any future per-membership UI) is empty on
the dashboard page itself.

## Verification note
All 9 shell pages are auth-gated (Supabase, not Clerk) so they can't be
screenshotted logged-out, and jsdom isn't installed. To verify the injected
script visually, add a TEMPORARY no-auth route that renders the real
`MANAGED_CLUBS_MENU_SCRIPT` against mock `ARENAS_DATA`, screenshot it, then
remove the route. The screenshot tool prepends the artifact preview path
(`/html/landing`), so the temp route must also answer at
`/html/landing/<name>` for the tool to reach it.
