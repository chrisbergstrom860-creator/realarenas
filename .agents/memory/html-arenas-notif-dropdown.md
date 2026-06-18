---
name: html-arenas in-place notifications dropdown
description: Athlete bells open the club-dashboard notifications panel in place; the standalone /notifications page is retired. Covers the shared-injection mechanism and the sibling-vs-child gotcha.
---

# In-place notifications dropdown (athlete shell pages)

Every bell that used `onclick="nav('/notifications')"` now opens the club dashboard's
notifications panel in place. The standalone `/notifications` route is retired and
redirects to `BASE + '/feed'`; `arenas-notifications.html` stays on disk, unused.
All `/api/notifications*` routes are kept — the dropdown depends on them.

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
(served via `sendFile`/`injectNamedData`) and does NOT link `arenas.css`. That page
defines all needed CSS vars except `--shadow-lg` (panel renders shadowless there) and
misses the shared mobile `@media #notifications-panel` override (panel uses desktop
absolute positioning on ~375px). Coach/admin-only page; accepted caveat.

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

## Accepted tradeoff: dropdown rows don't navigate on `n.link`
Like the dashboard, rows only mark-as-read — they don't follow `n.link`. So an existing
user invited in-app (notification `link` = `/join/:token`) loses the in-app click-through.
Invites are still redeemable via the public `/join/:token` page (the canonical accept
surface for every invite). The `POST /api/clubs/:id/accept-invite` endpoint was only
called from the retired page and is now orphaned but harmless. User approved this.
