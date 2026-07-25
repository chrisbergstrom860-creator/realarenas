---
name: html-arenas private-challenge invites
description: Private-solo challenge invite mechanism — followers basis, row-retained pending rule, join/leaderboard gates, honest degradation, account-deletion coverage.
---

# Private-challenge invites (html-arenas)

`challenge_invites` table (user ran `scripts/sql/challenge-invites.sql` + added
their own invitee_id index): challenge_id FK→challenges ON DELETE CASCADE,
invitee_id, inviter_id, created_at, PK(challenge_id, invitee_id), RLS enabled
with no policies (service-role only). **NO status column — state is DERIVED.**

## Core rules
- **Invite basis = FOLLOWERS of the creator** (opted-in audience), validated
  server-side on BOTH create (`invitees` body key) and invite-more (`userIds`
  body key — the two routes deliberately use different client contracts; don't
  "align" one without changing its caller). Cap 50, no self-invite; all three
  invite routes (GET list / POST send / DELETE revoke) are creator-only.
  Invitees are only accepted for private solo creates.
- **Row RETAINED on accept**: pending = row exists ∧ NOT participant, computed
  identically in the With-friends tab data, owner pending counts, and
  notification enrich (`attachChallengeInviteState`: joined→gone→ended→pending;
  lookup failure = NO verdict, plain row). Retention enables leave→rejoin
  self-heal. **Why:** a status column would need syncing on every join/leave;
  derivation cannot drift.
- **Revoke = row delete**; old notifications degrade server-side to a muted
  "Invite revoked". Reinvite after revoke = fresh row + fresh notification;
  re-send while still pending = upsert no-op with NO duplicate notification.
- **Gates**: join → 403 `invite_required` (fail closed on lookup error);
  leaderboard → creator/participant/invitee else "Challenge not found" (no
  existence leak); mgmt routes (nudge/post-to-feed/duplicate/DELETE) zero-leak
  because `requireChallengeManager` returns null for club_id-null challenges.
- **Honest degradation** (table missing / lookup failure): challenges list →
  no invite data; create → `inviteWarning:'invites_unavailable'` + ZERO
  notifications (no record ⇒ no notification); enrich → plain rows; account
  danger zone tolerates ONLY table-missing errors.
- **Account deletion**: no FKs to auth.users anywhere (app-level teardown
  pattern) — invitee-side rows are deleted explicitly in /api/account/delete;
  inviter-side rows die via the challenge cascade (inviter is always the
  creator; both invite routes are creator-gated). Proven by live-deleting a
  seeded invitee: zero residue both directions.
- Notification pill (arenas-notifications-panel.js): pending → yellow Join
  pill (entity_id passes a strict UUID regex before being embedded in
  onclick), joined → muted "✓ Joined", ended/revoked/gone → muted labels. ONLY
  definitive verdicts (invite_required / has-ended / Challenge not found)
  degrade the pill; unknown/transient errors restore it for retry;
  `pro_required` keeps it live + toast. Club-dashboard's inline legacy panel
  copy predates all pills — challenge invites render as plain linked rows
  there (parity gap shared with club invites; banked).
- Test sweep covers the table (USER_REFS both columns + COMPOSITE_KEYS
  challenge_id+invitee_id); the FK cascade also cleans rows when swept users'
  challenges are deleted.

## UI conventions
Create modal: invite picker exists only under Private (hidden under Public,
not disabled); follower search input appears only with >8 followers; note says
"just you until you invite someone". With-friends tab = "Invitations · N" +
"Your private challenges · N" sections; owner cards show an "Invites · N
pending" button → manage modal (pending list w/ Revoke, invite-more picker
excluding already-invited/joined). Hash `#friends` deep-links the tab.
