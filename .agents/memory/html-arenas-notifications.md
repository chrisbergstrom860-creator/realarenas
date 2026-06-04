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
- Client unread counters (nav badge, sidebar stat, tab badge, header subtitle) are
  driven by one `syncUnread()` helper in arenas-notifications.html. markRead /
  dismiss / markAllRead must all go through it, or counters go stale.
- Notification bodies contain user-supplied text (post content, names). The client
  renders via innerHTML, so dynamic text MUST be escaped (`esc()`); the server-side
  injection only escapes `<` for the JSON blob, which is not enough on its own.
- All notification API routes are BASE-prefixed and owner-scoped
  (`.eq('user_id', req.user.id)`). Client fetches must use `window.BASE` — bare
  `/api/...` hits the separate api-server on Replit (BASE=`/html`).
