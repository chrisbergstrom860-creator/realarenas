---
name: html-arenas notifications wiring
description: How notifications are produced/read in artifacts/html-arenas and why actor names come from auth metadata, not the profiles table.
---

# Notifications (artifacts/html-arenas)

- Recipients are notified on like / comment / follow. Triggers live inline in those
  POST routes, wrapped in try/catch so a notification failure never breaks the
  underlying action. Self-actions are skipped; follow only notifies when the insert
  had no error (so a duplicate-follow `23505` does not double-notify).
- Actor display name/handle is resolved via `displayFromUser` (auth `user_metadata`),
  NOT the `profiles` table — even though a `profiles` table now exists.
  **Why:** profile edits in this app write to auth `user_metadata`
  (`/api/profile/update`), so metadata is the editable source of truth. Reading
  names from `profiles` would show stale names after an edit and diverge from the
  feed/profile pages, which also use `displayFromUser`.
- **How to apply:** if you ever switch name resolution to `profiles`, you must also
  change `/api/profile/update` to write to `profiles`, or names will desync.
- Client unread counters are driven by a `syncUnread()` helper. The standalone
  `arenas-notifications.html` page is gone; the live copy now lives in the shared
  `arenas-notifications-panel.js` (the in-place dropdown). markRead / dismiss /
  markAllRead must all go through it, or counters go stale.
- Notification bodies contain user-supplied text (post content, names). The client
  renders via innerHTML, so dynamic text MUST be escaped (`esc()`); the server-side
  injection only escapes `<` for the JSON blob, which is not enough on its own.
- All notification API routes are BASE-prefixed and owner-scoped
  (`.eq('user_id', req.user.id)`). Client fetches must use `window.BASE` — bare
  `/api/...` hits the separate api-server on Replit (BASE=`/html`).
- GET `/api/notifications` returns `{ notifications, unreadCount }`; each notif
  has `read` (bool), `created_at`, `type`, `body`. There is NO numeric badge
  element — unread state is shown only by the `.notif-dot` indicator.
- Club-invite notifs (link `/join/<token>`, the only notifs with that prefix) get a
  server-computed `inviteState` in GET `/api/notifications` (`attachInviteState`:
  batched invite+membership lookups): `pending` → green "Join Club" pill in the
  shared panel (inline accept via `POST /auth/join/:token/existing`, flips to muted
  "✓ Joined"), `joined` (member OR accepted) → muted pill, `expired` → gray label,
  `gone` (row deleted = revoked) → plain row. **Rules:** lookup failure must degrade
  to NO state (plain rows), never `'gone'`; the token only enters the onclick attr
  after a strict `/join/<hex>` regex match + `esc()`; pill click needs
  `stopPropagation` (row click navigates). Accept-failure path navs to the `/join`
  page (canonical error surface). Shared panel only — the dashboard's inline copy
  stays action-less on purpose.
- Every shell bell opens an **inline** `#notifications-panel` dropdown
  (`toggleNotificationsPanel`); the dashboard keeps its own inline copy and other
  pages get one via `injectNotificationsPanel`. The `/notifications` route now just
  redirects to `/feed` (the standalone page was deleted). **Why:** navigating away
  pulled users out of context. See html-arenas-notif-dropdown.md.
