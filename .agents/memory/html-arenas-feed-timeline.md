---
name: html-arenas athlete feed merged timeline
description: /feed is one strictly chronological list across types; sort keys are "entered the feed" moments, not subject dates.
---

# Athlete feed — merged chronological timeline

- The /feed page renders ONE merged newest-first list across posts, followed-athlete activities, and follow RSVPs. Client collectors return {ts, id, el}; renderMergedFeed() sorts desc by ts with a string-id tiebreak. No section grouping — don't reintroduce per-type render passes that prepend into #feed-items.
- **Sort key rule:** each item sorts by when it ENTERED the feed (the social moment), never by its subject's date: posts → created_at; activities → created_at (logged-at; the card still DISPLAYS the activity's `date`); RSVP cards → the rsvp row's created_at.
- **Why:** an activity logged today for last Tuesday must appear at today's position — sorting by subject date buries fresh content.
- **How to apply:** any new feed card type must carry an "entered feed" timestamp in its payload and join the same merge; server fetch windows must ORDER BY that same timestamp (buildFeedActivities orders by created_at, not date, so backdated logs stay inside the limit window).
- Paging: none exists client-side (.load-more CSS is dead). Server caps per type (20 posts / 10 activities / 10 RSVPs) — documented interim; a unified cursor is the future fix if volume grows. Club feed routes are separate server-side merges (already timestamp-sorted) and share no assembly with this client path.
