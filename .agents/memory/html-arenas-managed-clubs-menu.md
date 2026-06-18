---
name: html-arenas managed-clubs avatar dropdown
description: How the #userMenu avatar dropdown is built — the "Clubs you manage" section, and its shared click-to-open/click-outside-to-close behavior — and which injection chokepoint reaches which pages.
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
- **Avatar-menu open/close lives in ONE server-injected script (`AVATAR_MENU_SCRIPT`
  / `injectAvatarMenu`), mirroring the bell: click-to-open (the inline avatar
  `onclick` toggle stays), close on document click-OUTSIDE — never `onmouseleave`.**
  The old per-page `onmouseleave` on the wrapper closed the menu the instant the
  cursor crossed the 8px gap to the menu (wrapper's box = just the avatar, since
  `#userMenu` is `position:absolute`); the script removes that attribute at runtime.
  **Why:** one source of truth so the close logic can't drift across the 10 pages.
  **How to apply:** targets the menu by `#userMenu` and the avatar by
  `[onclick*="userMenu"]` (works across wrapper-class variants incl. blog's
  `topbar-user`/`avatar-sm`). The two dropdowns coexist automatically — each one's
  click-outside listener treats a click on the OTHER trigger as "outside", so
  opening one closes the other (only one open at a time), no extra wiring.
- **Different chokepoint from managed-clubs:** the close-behavior script is injected
  at the TOP of `injectNotificationsPanel` (covers 9 pages incl. club-dashboard,
  whose inline `#notifications-panel` triggers the bell early-return — so it MUST run
  before that return) PLUS a direct `injectAvatarMenu` call in the `/blog` route.
  That set is all 10 avatar-menu pages, vs `injectBottomNav`'s 9 for managed-clubs.

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
