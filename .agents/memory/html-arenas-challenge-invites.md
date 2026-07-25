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
  server-side on BOTH create and invite-more. **Canonical body key = `invitees`
  on both routes** (aligned 2026-07-25; the old create=`invitees` /
  invite-more=`userIds` split caused false test failures — never reintroduce a
  second key for the same concept). Cap 50, no self-invite; all three invite
  routes (GET list / POST send / DELETE revoke) are creator-only. Invitees are
  only accepted for private solo creates.
- **Row RETAINED on accept**: pending = row exists ∧ NOT participant. The
  verdict comes from ONE shared server helper `pendingInvites(inviteRows,
  participantPairs)` (rows need challenge_id+invitee_id, pairs
  challenge_id+user_id) used by all four surfaces: With-friends rails, owner
  pending counts, notification enrich (`attachChallengeInviteState`:
  joined→gone→ended→pending; lookup failure = NO verdict, plain row), and the
  manage-invites list route. **Never re-derive it inline.** Retention enables
  leave→rejoin self-heal. **Why:** a status column would need syncing on every
  join/leave; derivation cannot drift — but inline copies of the derivation do.
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
- **Account deletion — BOTH sides proven live** (2026-07-25): invitee-side
  rows are deleted explicitly in /api/account/delete; inviter-side, the
  creator's challenges are HARD-DELETED (participants explicitly, invite rows
  via the challenge_id FK cascade, invite notifications via the actor_id
  sweep) — nothing orphaned or anonymized, invitees see no ghost invitation.
  No FKs to auth.users anywhere (app-level teardown pattern).
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
