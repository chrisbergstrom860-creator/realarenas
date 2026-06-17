---
name: html-arenas managed-clubs avatar dropdown
description: How the "Clubs you manage" section in the #userMenu avatar dropdown is injected and gated across shell pages.
---

# "Clubs you manage" avatar-dropdown section

A coach/admin-only section at the top of the `#userMenu` avatar dropdown linking
each managed club to `/clubs/dashboard?club=<id>`. It is the **mobile** route to
a club dashboard, because the sidebar "My clubs" list is hidden ≤768px.

## Durable decisions
- **`injectBottomNav()` is the shared injector for all shell-wide client chrome**
  (mobile bottom nav AND this menu script). It is the single chokepoint that hits
  exactly the 9 shell pages (7 athlete + club-dashboard + club-member) and NOT
  blog / club-invite / landing.
  **How to apply:** put any new client chrome that must appear on those 9 pages
  (and only those) inside `injectBottomNav`, not in per-page HTML.
- The menu is built client-side from `window.ARENAS_DATA.clubs` (role supplied by
  `getSidebarClubs`), filtered to admin/coach, via `createElement`/`textContent`
  (so club names can't inject markup). It no-ops for pure athletes / missing menu
  / missing data and self-guards against double insertion.

## Gotcha: club-dashboard route injects only the single `club`
The `/clubs/dashboard` route historically injected just the one managed `club`,
not the viewer's `clubs[]` with roles. Any feature on that page that needs the
full membership-with-role list must add `getSidebarClubs(req.user.id)` to its
data object.
**Why:** without it, per-membership UI (like this dropdown) is empty on the
dashboard page itself.

## Verifying auth-gated pages
Shell pages use Supabase auth (not Clerk) and redirect when logged out, and
jsdom isn't installed — so the injected script can't be screenshotted on a real
page. Pattern that works: add a TEMPORARY no-auth route that renders the real
menu script against mock `ARENAS_DATA`, screenshot, then remove it. The
screenshot tool prepends the artifact preview path (`/html/landing`), so the
temp route must also answer under that prefix for the tool to reach it.
