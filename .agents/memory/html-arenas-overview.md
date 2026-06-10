---
name: html-arenas club dashboard Overview tab
description: How the coach dashboard Overview tab gets its real data, and the schema/spec mismatches to watch for.
---

# html-arenas — club dashboard Overview tab

The Overview tab is the **default active tab** of the coach club dashboard. It is
rendered client-side from `window.ARENAS_DATA` (server-injected) plus two live
fetches: `training-load` and `recent-activity`.

## Spec vs reality
- The build spec claimed `pendingInvites` and `activeMembers` were "already
  injected" into ARENAS_DATA. They were **not** — only a numeric `pendingCount`
  existed. `pendingInvites` had to be injected into the dashboard route's
  `clubData` (shape `{id,email,status,expires_at,isOpen,isExpired}`, with
  `isOpen`/`isExpired` derived **server-side** so the client never re-derives TTL
  rules). `activeMembers` is unused (memberCount already covers it).
- The spec's snippet used `profiles:user_id(name)` joins and ordered activities by
  `created_at`. Neither works here: no usable `profiles` table (names come from
  `buildUserProfileMap`), and `activities` is ordered by its **`date`** ISO
  timestamp. Membership joins use `memberships.created_at` (no `joined_at`).

## Rendering gotchas
- **Render on load AND on tab switch.** Because Overview is the default tab,
  chaining `window.setTab` (like the other tab IIFEs) is not enough — also call
  `renderClubOverview()` on load behind a `document.readyState` guard.
- `nudge-atrisk` **ignores** the client-sent `userIds` and recomputes the at-risk
  set server-side ("no activity in 5 days"). So the toast's nudged-count can
  differ from the overview's "inactive this week" count. This is the intended
  anti-spam convention, not a bug.

**Why:** these are non-obvious mismatches between the written spec and the actual
schema/conventions that already bit this feature once.
**How to apply:** when extending the Overview (or any coach-dashboard data),
trust the live schema + `buildUserProfileMap` over any spec snippet that assumes
`profiles` joins or pre-injected arrays, and keep server-derived flags server-side.
