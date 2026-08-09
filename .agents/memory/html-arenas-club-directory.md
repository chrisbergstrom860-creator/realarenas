---
name: html-arenas club directory
description: /clubs directory + request-and-approve joining; visibility model, join-request state machine, zero-leak rules
---

# Club directory (/clubs) + join requests

- `clubs.visibility` ('private' default / 'public') + `clubs.description` (≤500 chars); `club_join_requests` table PK (club_id,user_id), status pending/approved/declined, resolved_at/resolved_by, FK cascade to clubs (user-run DDL, RLS on — service role bypasses).
- Directory lists ONLY public clubs. Server decides everything per viewer: `viewerState` ('none'|'pending'|'cooldown'|'member') + `cooldownUntil` + `viewerRole` + memberCount + plan. Client never recomputes state.
- **Zero-leak**: `getPublicClub` returns null for both nonexistent AND private → byte-identical 404 `{error:'Club not found'}` on join-request POST/DELETE and (for non-managers) approve/decline. Same standard as events/challenges. Verify script asserts raw-byte equality.

## State machine (user-approved decisions — don't re-litigate)
- Decline → **quiet** (no notif to requester) + 7-day cooldown from resolved_at (`JOIN_REQUEST_COOLDOWN_MS`; 409 `request_cooldown` + retryAt). Re-request after cooldown flips the **same row** back to pending (PK) — never a duplicate row.
- Approve → membership role 'member' (rollback mirrors invite-accept), row approved, requester notified; already-member = resolve-only.
- Club goes public→private → pending requests deleted (checked write; failure = `saved_but_requests_not_cleared`, visibility change stands).
- Invite-accept (`/auth/join/:token/existing`) deletes pending row non-fatally. Requester can cancel own pending (conditional-delete honesty).
- Settings PATCH is **admin-only** (stricter than isClubManager; coach gets zero-leak 404). Approve/decline = isClubManager.
- Account delete: rows swept by user_id AND per dying club by club_id (architect caught the dying-club gap).

## Surfaces
- `/clubs` page (arenas-clubs.html) + shared `arenas-club-cards.js` (ccd- classes, two-tier yellow buttons); sidebar "Clubs" link on all shell pages; dashboard: join-requests queue in Members tab + admin-only settings card in Overview (settings card must live INSIDE #tab-overview or it shows on every tab).
- Empty-state copy is user-approved verbatim ("Clubs choose to be listed…") + Create-club CTA via ArenasClubCreate.open().
- Geometry guard now seeds the club public w/ long description and covers /clubs; sweep covers club_join_requests both keys.
- `scripts/verify-club-directory.js` = full lifecycle + zero-leak + sole-owner account-delete (account delete returns `{ok:true}` not success).
