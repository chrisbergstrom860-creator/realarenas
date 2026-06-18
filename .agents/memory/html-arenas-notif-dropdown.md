---
name: html-arenas in-place notifications dropdown
description: Athlete bells open the club-dashboard notifications panel in place; the standalone /notifications page is retired. Covers the shared-injection mechanism and the sibling-vs-child gotcha.
---

# In-place notifications dropdown (athlete shell pages)

Every bell that used `onclick="nav('/notifications')"` now opens the club dashboard's
notifications panel in place. The standalone `/notifications` route is retired and
redirects to `BASE + '/feed'`; `arenas-notifications.html` has been **deleted** (it was
orphaned). All `/api/notifications*` routes are kept — the dropdown depends on them.

**Mechanism:** `injectNotificationsPanel(html)` in `server.js` rebuilds the bell
server-side and injects `<script src="${BASE}/arenas-notifications-panel.js">`. That JS
file is the dashboard's two notification IIFEs (dot-sync + dropdown) copied verbatim,
served via a public dual route `['/html/...','/...']` (mirrors the `arenas.css` route).
The dashboard keeps its OWN inline copy on purpose; the helper guards on an existing
`id="notifications-panel"` so it no-ops there (intentional duplication, low risk).

**Coverage:** the helper runs inside `injectBottomNav` (covers the 7 pages that flow
through it: feed, my-profile, club-member, challenges, leaderboards, events, athletes)
AND is applied to the two serve points of the `/clubs/invite` route, because
`arenas-club-invite.html` is the one bell page that does NOT go through `injectBottomNav`
(served via `sendFile`/`injectNamedData`) and does NOT link `arenas.css`. Because it
skips `arenas.css`, that page must carry the panel's CSS itself: it now defines
`--shadow-lg` in its inline `:root` AND copies the shared mobile
`@media (max-width:768px) #notifications-panel` override (position:fixed; left/right:8px;
width:auto) verbatim into its own `<style>`. **Lesson:** any self-contained bell page that
injects the panel but skips `arenas.css` needs BOTH inline, or the dropdown renders
shadowless (arenas.css never defines `--shadow-lg`; it's per-page inline) and clips
off-screen at ~375px. Coach/admin-only page.

## Gotcha: panel must be a SIBLING of the bell, never a child
**Rule:** wrap the bell in `<div style="position:relative">` and emit the panel as a
SIBLING after the bell's closing `</div>` (exactly what the dashboard does). Do NOT nest
the panel inside the bell.
**Why:** the bell carries inline `onclick="toggleNotificationsPanel()"`. If the panel is
a descendant of the bell, every click inside the panel (a row, "See all", "Mark all
read") bubbles up to the bell's onclick and toggles the panel shut — "See all" expands
then closes, mark actions close the panel. A nested panel only looks fine for the
outside-click handler (`bell.contains`), which masks the bug.
**How to apply:** the injection is one atomic regex matching the whole bell
(`.notif-btn`/`.icon-btn`); the `<script>` is added only when the regex actually matched
(`out !== html`) so a non-matching page degrades to the /feed redirect, never a dead bell.

## Dropdown rows navigate on `n.link` (mark-read + nav)
Rows now follow `n.link`: the row onclick calls `openNotification(id)`, which awaits
`markNotificationRead(id)` (so the read POST isn't cancelled by the page unloading) THEN
navigates via `nav(link)` (or `location.href = BASE + link` fallback). Rows with no link
stay mark-read-only.
**Guard:** `isSafeLink(link)` only follows single-leading-slash root-relative paths
(rejects `//host`, absolute URLs, `javascript:`). `link` is DB-derived, so this blocks
open-redirect / stored-XSS regressions if a hostile row ever lands.
**Scope:** this lives in the shared `arenas-notifications-panel.js` only. The dashboard
keeps its OWN inline panel copy and was intentionally left mark-read-only (shared-JS scope).
`/join/:token` (+ `/auth/join/:token`, `/auth/join/:token/existing`) is the canonical accept
surface. The old one-click `POST /api/clubs/:id/accept-invite` (only ever called by the now-deleted
notifications page) has been **removed**.
