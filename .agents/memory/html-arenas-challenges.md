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
- **Completion must be guarded by `goal_target > 0`.** Never use
  `progress >= goal_target` alone: with a 0/null target, `0 >= 0` falsely marks
  the challenge complete. The server enrich() is the single source of truth —
  it emits `pct` (safe, never /0) and `isComplete = goalTarget>0 && progress>=goalTarget`;
  the client must consume `c.pct`/`c.isComplete`, not recompute from raw values.
  Create route also rejects non-positive/NaN `goal_target`. **Why:** a private
  challenge showed "goal achieved" with no activities due to this exact bug.
- **Invitees are validated server-side** in `POST /api/challenges/create`:
  filtered to users the caller actually follows and capped (50). **Why:** without
  this, the endpoint could spam notifications to arbitrary known user IDs.

## Coach dashboard "Club Challenges" tab

- The `/clubs/dashboard` route enriches `window.ARENAS_DATA` with
  `activeChallenges` / `pastChallenges` / `challengeStats` (mirrors the Events
  tab rollup). Per challenge: one batched activities query
  (`.in('user_id', participantIds)` within the challenge date window), grouped by
  user, fed through `computeChallengeProgress` to build top3/leaderboard,
  participationPct/successRate/notJoinedCount/daysLeft/isPast. Wrap in try/catch
  so a challenges failure never blanks the whole dashboard.
- **Management routes need `requireChallengeManager(id, userId, columns)`** (the
  challenge's club admin/coach). Like `requireEventManager`, the `columns` arg
  **must include `club_id`** or the helper can't resolve the club and always
  denies. Covers `POST /api/challenges/:id/{nudge-join,post-to-feed,duplicate}`
  and `DELETE /api/challenges/:id`.
- **DELETE /api/challenges/:id was added beyond the original 3-route spec** — the
  coach Cancel button needs it; the spec wrongly assumed it already existed.
- **Known gap (intentionally out of scope):** `POST /api/challenges/create`
  inserts `club_id` from the body with NO *unconditional* club-membership check —
  any authed user can create a challenge inside any club (it then renders on that
  club's coach dashboard). Same class of bug as the events club-scoped-write rule.
  Add a flag-independent membership gate when `club_id` is supplied (NOT inside the
  `PLAN_GATES_ENABLED` block — authz must not be flag-dependent). **Why deferred:**
  task scope was the Challenges tab; create route is pre-existing and shared with
  the main challenges page. NOTE: the plan-gating layer already resolves club role
  from the supplied club_id when `PLAN_GATES_ENABLED` is on (free non-managers get
  403), but that is a *plan* gate, not an authorization gate — see
  html-arenas-stripe.md "Plan gating".

## Same-route refresh after a write (gotcha)

After a write whose result must appear in **server-injected** `ARENAS_DATA` on a
route the user is **already on** (e.g. create/duplicate a challenge while on
`/clubs/dashboard`), use `window.location.hash = '<tab>'; window.location.reload();`
— NOT `window.nav('/clubs/dashboard#<tab>')`. **Why:** `nav` sets `location.href`;
when only the hash differs the browser does not reload, there is no `hashchange`
listener, and `ARENAS_DATA` is baked in at render time, so the new row never
shows until a manual refresh. The Events tab already uses the hash+reload form.

## Tab mapping (client)

- mine → active myChallenges; completed (#completed-list) → finished myChallenges
- friends (#tab-friends) → clubChallenges; discover (#discover-grid) → publicChallenges

## Tab-panel flex direction + gap (layout gotcha)

`setTab(tab)` toggles the chosen panel to `display:flex` (mine/completed/friends)
or `block` (discover). Any panel set to flex that should stack vertically MUST
carry inline `flex-direction:column`, or it defaults to `row` and cards reflow
horizontally off the right edge. `#tab-friends`/`#tab-completed` already do this;
`#tab-mine` was missing it (the reflow bug) — now fixed.
**Do NOT add a flex `gap` to these panels:** `buildChallengeCard` cards each
carry inline `margin-bottom:10px`, so a gap would double the inter-card spacing.
`gap:0` (default) keeps the flex (after-click) state pixel-identical to the
block first-load state. On first load `#tab-mine` is `block` (no setTab has run),
so its `flex-direction` is inert until the tab is clicked.

## Query notes

- Empty `.in(col, ids)` is invalid in Supabase — pass a placeholder array when
  `ids` is empty (`ids.length ? ids : ['00000000-...']`).
- **My-vs-Discover partitioning:** fetch created (`created_by`) and joined
  (`id.in(joinedIds)`) challenges as TWO separate queries and merge — avoids
  `.or()` UUID quirks. Discover must EXCLUDE created+joined ids via
  `.not('id','in','(...)')`, applied ONLY when the exclude list is non-empty
  (an empty `.not(...in...)` errors). **Why:** a created challenge was leaking
  into Discover because the public query didn't exclude the user's own.
