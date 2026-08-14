---
name: html-arenas leave-club flow
description: Self-serve POST /api/clubs/:clubId/leave — teardown boundary, refusal copy, canLeave flag, rejoin guarantees, known reporting property.
---

# Leave-club flow

POST `/api/clubs/:clubId/leave` (POST not DELETE — multi-table teardown with refusal semantics, account-delete's shape).

**Teardown boundary (user-decided, don't re-litigate):**
- DELETED: memberships row (commit point: conditional `delete().select()`, race-free 404), challenge_participants for the club's challenges, event_rsvps on the club's events, club_join_requests row (so rejoin is a clean first-time path).
- KEPT: comments/likes on announcements (member speech), authored announcements (club-owned), all activities/PRs/streaks/achievements.

**Guards (order matters, all before writes):** club fetch fail-closed → zero-leak 404 for non-members (byte-identical to nonexistent id) → owner 403 → sole-admin 409.
- Owner 403 copy names real exits only (delete club or account) — never mention ownership transfer; no such feature exists.
- Sole-admin condition matches account-delete exactly: **other members exist AND no other admin remains** (regardless of ownership). A non-owner admin with another admin present leaves fine.

**Why participant rows must go:** challenge standings enumerate `challenge_participants` with NO membership re-filter, so a surviving row leaves a departed member ranked (and in a private club, ranked on a board canUserSeeChallenge refuses them). Deleting the row fixes standings + report challenge stats at once.

**KNOWN REPORTING PROPERTY (deliberate, not a bug):** club monthly reports are an on-read view of CURRENT data — roster and participant rows are re-queried live for any past month. Any departure (leave or account delete) removes that person from past months' figures too. Same for activity figures (filtered by current roster). No snapshots exist.

**UI:** Leave button on `/clubs/member/:clubId` hero, rendered only on server-injected `canLeave` (+ `clubPrivate` drives the modal's rejoin line) — same server-decided pattern as dashboard danger-zone isOwner, fail closed. Modal = arenasOverlay node mode, deliberately NO beforeClose. Private-club copy warns an invite is needed to return.

**Notification:** admins only (not whole-club fan-out), type 'club', title 'Member left', link `/clubs/dashboard?club=`.

**Rejoin guarantees (proven in verifier):** public = fresh join request (no cooldown — cooldown only arms on declined) → approve; private = fresh invite. Nothing left behind blocks either.

**Known races (accepted, match account/club-delete precedent — no transactions available):** two admins passing the sole-admin read simultaneously; in-flight RSVP/participation landing after teardown; partial-teardown retry gets 404 (membership already gone). Architect flagged; user-informed.

**Verifier:** sections 13–15 of `scripts/verify-club-directory.js` (membership-lifecycle domain owner). Screenshot harness trick: temp route must ALSO be registered at BASE+'/landing/...' (screenshot tool prepends /html/landing).
