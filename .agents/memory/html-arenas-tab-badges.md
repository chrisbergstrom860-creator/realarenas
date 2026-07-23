---
name: html-arenas profile tab badges
description: Profile tab badges are "new since last viewed" counts backed by user_metadata.tab_seen — not totals; keepalive mark-seen; no "0" pill ever.
---

# html-arenas profile tab badges ("new since last viewed")

The my-profile header tab badges (Activities / Achievements / Clubs /
Following) are NOT totals. Each shows only items added since the user last
opened that tab; opening the tab clears it.

## Mechanics
- Per-tab last-seen ISO stamps in `user_metadata.tab_seen` (account-level,
  cross-device — same home as prefs; localStorage would silo per browser).
  `TAB_SEEN_KEYS` in server.js is the whitelist; only `/api/profile/tab-seen`
  and the first-run seed write it (read-merge-write, updateUserById merges
  top-level keys only).
- Unseen = timestamp > last-seen: activities.created_at, achievements
  .earned_at, memberships.created_at; **Following counts NEW FOLLOWERS**
  (follows where viewer is following_id) — the notable external event, not
  people the viewer followed.
- First-run: missing tab_seen keys are seeded to NOW during the /profile page
  build (old content counts as seen — no wall of old-news badges).
- Zero unseen = EMPTY span hidden via `.tab-count:empty{display:none}` — a
  "0" pill must never render. Never write totals into `.tab-count`.

## Sharp edges
- **markTabSeen fetch needs `keepalive:true`** — a reload right after a tab
  click cancels a plain fetch and the badge resurrects on reload (caught by
  E2E; endpoint was fine).
- Old bug this replaced: the Achievements badge was a static markup "0" whose
  only writer lived inside the lazy tab-click loader (earnedCount total) —
  page load never populated it, so it read 0 while the tab held 7 badges.
  The other three badges were load-time totals from the profile payload.
  All four total-writers are retired; totals live in hero stats / tab bodies.
- Opening the Achievements tab awards new badges server-side; genuinely new
  rows earned AFTER the mark-seen stamp legitimately re-badge on next load.
- Sidebar "Challenges 3" (athlete pages) is STATIC mock chrome; club-dashboard
  nav badges are live totals/attention counts — different systems, untouched.
