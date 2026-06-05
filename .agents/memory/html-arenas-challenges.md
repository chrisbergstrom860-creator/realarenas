---
name: html-arenas challenges feature
description: Design decisions and policy choices for the Challenges feature in html-arenas
---

# Challenges feature (html-arenas)

Backed by Supabase tables `challenges` and `challenge_participants`. Names of
creators/participants come from auth metadata via a `buildUserDisplayMap()`
helper (mirrors notification enrichment) — there is no usable `profiles` table.

## Policy decisions (be consistent with these)

- **Join is permissive by design.** Any authenticated user can join any
  challenge id (including private ones). This preserves the spec's invite flow.
  **Why:** the original spec had no per-challenge join authorization; tightening
  it would break invites. If private challenges must become truly private later,
  add owner/invitee/participant/club-member checks to join AND leaderboard.
- **Leaderboard is readable by any authenticated user** (social semantics).
- **`duration` goal_type progress is not computed (reports 0)** — spec parity.
  `distance` sums numeric distance, `sessions` counts, `streak` counts distinct
  days; everything else is 0.
- **Invitees are validated server-side** in `POST /api/challenges/create`:
  filtered to users the caller actually follows and capped (50). **Why:** without
  this, the endpoint could spam notifications to arbitrary known user IDs.

## Tab mapping (client)

- mine → active myChallenges; completed (#completed-list) → finished myChallenges
- friends (#tab-friends) → clubChallenges; discover (#discover-grid) → publicChallenges

## Query notes

- Empty `.in(col, ids)` is invalid in Supabase — pass a placeholder array when
  `ids` is empty (`ids.length ? ids : ['00000000-...']`).
- **My-vs-Discover partitioning:** fetch created (`created_by`) and joined
  (`id.in(joinedIds)`) challenges as TWO separate queries and merge — avoids
  `.or()` UUID quirks. Discover must EXCLUDE created+joined ids via
  `.not('id','in','(...)')`, applied ONLY when the exclude list is non-empty
  (an empty `.not(...in...)` errors). **Why:** a created challenge was leaking
  into Discover because the public query didn't exclude the user's own.
