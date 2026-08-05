---
name: html-arenas challenges feature
description: Design decisions and policy choices for the Challenges feature in html-arenas
---

# Challenges feature (html-arenas)

Backed by Supabase tables `challenges` and `challenge_participants`. Names of
creators/participants come from auth metadata via a `buildUserDisplayMap()`
helper (mirrors notification enrichment) — there is no usable `profiles` table.

## Policy decisions (be consistent with these)

- **Join is GATED for private solo challenges (supersedes "join permissive",
  2026-07).** `/api/challenges/:id/join` requires creator OR a live
  `challenge_invites` row when `visibility='private' && club_id==null`;
  strangers get 403 `invite_required`, and an invite-lookup failure DENIES
  (fail closed). Public and club challenges keep their prior semantics.
- **Leaderboard for private solo = creator/participant/invitee only**; anyone
  else gets "Challenge not found" (no existence leak). Public/club unchanged.
  Mechanism details: [challenge invites](html-arenas-challenge-invites.md).
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
- **Invitees are validated server-side** in `POST /api/challenges/create` AND
  `POST /api/challenges/:id/invites`: filtered to the creator's FOLLOWERS
  (opted-in audience — NOT following), capped (50), no self-invite; only
  private solo creates accept invitees. **Why:** prevents notification spam to
  arbitrary user IDs, and followers explicitly chose the relationship.

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
- **Club-scoped create is authorized (FIXED).** `POST /api/challenges/create` now
  runs an *unconditional* club-manager check at the top of the handler, OUTSIDE the
  `PLAN_GATES_ENABLED` block: when `club_id` is supplied, resolve getClubRole +
  isClubManagerRole; non-managers get `403 {"error":"not_club_manager"}` whether or
  not the flag is on. **Why outside the flag:** this is authorization, not plan
  gating — it must never depend on a feature flag. The plan gate defers to it
  (computes `isClubMgr` once, then `if (PLAN_GATES_ENABLED && !isClubMgr)`), so a
  verified manager is exempt and individual creates still need Pro when flag-on.
  Previously the only club-role check lived inside the dormant flag block, so with
  gating off any authed user could tag a challenge into a club they don't manage
  (it rendered on that club's dashboard) — same class as the events club-write bug.
- **Join has no analogous hole:** `/api/challenges/:id/join` reads the persisted
  challenge's `club_id` from the DB, never from client input, so there is no
  club-namespace-spoofing vector. (Join is open for public challenges but gated
  for private solo — see the invites topic.)

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
- friends (#tab-friends) → invitations (pending) + your private challenges
  (NO LONGER clubChallenges — un-joined club challenges surface on club
  member-home/coach dashboard instead); discover (#discover-grid) →
  publicChallenges; hash `#friends` deep-links the tab

## Live containers must ship EMPTY — no prototype cards (flash bug)

The four data-bound containers — `#tab-mine`, `#tab-friends`, `#completed-list`,
`#discover-grid` — must render EMPTY at parse time (neutral `.challenges-loading`
placeholders, and `discoverChallenges = []` with NO parse-time `renderDiscover()`
init call). `loadChallenges()` fetches `/api/challenges` and overwrites each
container's innerHTML with real data (or the empty state), so ANY hardcoded
prototype card there "appears then disappears" = a cosmetic flash. This is NOT a
gating bug: `computeProLocked` only swaps Join/Create buttons into upgrade CTAs;
it never removes/hides a card, and `GET /api/challenges` is `requireAuth`-only
(ungated), so free users always receive the full public list.
**Why:** a free user with the flag on reported challenge cards flashing in then
vanishing — it was leftover prototype markup being wiped, not the gate.
**How to apply:** never reintroduce mock cards into these containers; keep the
static tab-count badges + `#active-count` at 0 (JS `updateCounts` fills them);
`loadChallenges` error/catch calls `renderEmptyAll()` (which also zeroes counts)
so the "Loading…" placeholders never get stuck on a fetch failure.

## Header stats strip + subtitle are now real (no fabricated numbers)

All four header stats are real and rendered from the SAME `/api/challenges` load
via `updateCounts` (`—` placeholders pre-fetch, honest 0 on error/empty):
`active-count`+`challenges-available` are client-derived (mineActive /
`publicChallenges.length`, the latter capped at the discover `.limit(20)` — a
floor, not fabrication); `pts-month` (`pointsThisMonth`) and `longest-streak`
(`longestStreak`) are computed server-side in the `/api/challenges` handler from
one `activities` fetch, reusing `calculatePoints` (current calendar month) and
the profile-stats streak loop (max consecutive active days). The subtitle sport
list is real too — injected from `req.user.user_metadata.sports` into
`challengeData`, capitalized client-side, with a generic no-sport-list default.
**Why:** prototype header showed fake `1,240 pts` / `340 available` / `14 streak`
and a hardcoded `Running, Cycling & Climbing`.
**How to apply:** any stat that stays must be real + honest-zero + same load path.
**Right sidebar is now real too** (all four cards, same `/api/challenges` load,
honest empty/zero states):
- Points breakdown → `pointsBySport` (per-sport month points). The total row
  shows `pointsThisMonth` (one round) so it matches the header exactly — do NOT
  switch it to the sum of the per-sport rounded rows, or it can drift ±1 pt from
  the header total.
- Suggested → `publicChallenges.slice(0,4)` with **no points badge**: the
  `challenges` table has NO points/reward column, so the old prototype `+600`
  badges were fabricated. Join buttons replicate the main-grid gate
  (`proLocked && !club_id` → 🔒 Pro / goPro, else joinChallenge).
- Friends in challenges → people you follow who are in **public challenges only**
  (`.eq('visibility','public')`) — never leak private/club challenge titles;
  `followsAnyone` distinguishes "follow no one" vs "none in a public challenge".
- Your streak → `currentStreak`/`longestStreak` + `weekGrid`; month label is the
  real current month (client `toLocaleString`).

**Legacy prototype blob DELETED (2026-07-25):** the static `#detail-modal`
markup, `discoverChallenges`/`joinedDiscover`, legacy `renderDiscover`,
`joinDiscover`, `modalData`, `openDetailModal`/`openModal`/`closeDetailModal`,
and the prototype `leaveChallenge(btn)` stub are gone. What REMAINS by design:
a tiny top-level `renderDiscover()` fallback stub that renders an honest
"Challenges unavailable" empty state — `setTab`/`setFilter` call bare
`renderDiscover()`, and on degraded pages (ARENAS_DATA missing) the real
`window.renderDiscover` is never defined, so deleting the stub reintroduces a
click-time ReferenceError. The data script's `window.renderDiscover =`
override replaces the stub at parse time on healthy loads.

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
- Completed-tab stats: the fiction squares (hardcoded 7/3,250/57%) are DELETED; the one real stat (completed count) renders as a compact header sharing the tab badge's single isDone computation. Rules: any completed-count surface must reuse that one source; "points earned from challenges" is a double-counting trap (points are activity-derived, challenges award nothing); no win/podium stat without a rank-at-completion snapshot (next bullet). (The legacy demo-modal blob that held prototype rank/points fiction was deleted 2026-07-25.)
- Rank-at-completion SNAPSHOT (freeze final standings when a challenge ends) is the prerequisite for any honest podium/win-rate stat — and would also stabilize ended-challenge leaderboards, which today recompute from live activities and shift under post-hoc edits. The wire path if competition stats are ever wanted; until then, no win-rate UI.
- Visibility semantics (re-audited 2026-07 after the invite build): Discover = 20 newest ACTIVE public (ends age out instantly; volume crowd-out, no pagination), Suggested = top 4 of same list; clubChallenges query IGNORES visibility (private club = all-members-only); friendsInChallenges explicitly public-only but not end-date-filtered. PRIVATE SOLO is now ACCESS-CONTROLLED (join gate + leaderboard scoping + zero-leak on mgmt routes — see invites topic); the old invite dead-end is FIXED (notification Join pill + With-friends tab). Solo challenges still have NO delete/retract path (all mgmt routes require club manager; applies to public solo too — accidental public solo sits in Discover until end_date). Public CLUB challenges are platform-wide joinable (Pro-EXEMPT while solo public needs Pro) and outside joiners flow into club milestones/rollups; coach post-to-feed publishes the title as a regular post beyond the club.
- Dead-chrome rule enforced again (2026-08): the Discover "type" pill row (solo/community/performance — no such model field, renderDiscover ignored it) and the fake "Load more" toast button are DELETED; sport is the ONLY Discover filter. Header stats strip is fully real; active-count/challenges-available labels are singular/plural-aware spans set by setStat. Known honest-today caveat: "challenges available" = length of the limit(20) Discover list, understates past 20.
