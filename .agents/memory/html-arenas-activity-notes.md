---
name: Activity notes visibility
description: activities.notes are public on all surfaces; 500-char cap; feed rendering rules
---

- Notes are PUBLIC by design (user decision Aug 2026): main feed, club feeds (already showed them as `notes || title`), self profile tab. Only control is account-level `activity_feed_visible` pref — user explicitly rejected per-activity/per-field privacy controls; don't re-propose.
- Server cap: 500 chars in POST /api/activities/create (route-convention `res.json({error})`, not 400). Log form has maxlength=500 + live counter; placeholder states visibility plainly.
- Feed render: `feedNotesHtml()` in arenas-feed.html — escFeedAct + `.fa-notes` (white-space:pre-line, overflow-wrap:break-word), clamp >220 chars or >3 newlines → 3-line -webkit-line-clamp + Show more toggle. Empty notes → '' (no block, no gap).
- **Why the grid fix:** feed `.main` desktop track was bare `1fr` (min-width auto) — one long note widened the column to ~2860px. Fixed to `minmax(0,1fr) 300px`. Same lesson as the mobile-shell minmax rule, now applied to desktop too.
- verify-feed-notes.js covers rendering/clamp/XSS/cap/privacy at 4 widths.
