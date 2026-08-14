---
name: html-arenas club deletion
description: Owner-only DELETE /api/clubs/:clubId, shared destroyClub teardown, notification-before-Stripe ordering, verifier facts.
---

# Club deletion (shipped 2026-08-14)

- `destroyClub(club)` (server.js, above account-delete route) is the ONE teardown both the account-delete sweep and `DELETE /api/clubs/:clubId` call. Stripe handling stays in the callers.
- Route ordering is user-mandated: refusals → member notifications inserted → Stripe cancel (immediate, abort 502 intact) → `teardownStarted=true` → destroyClub. Notification insert failure = 500 with nothing cancelled/deleted. Any pre-teardown failure retracts the already-written notifications (compensating delete by id) — otherwise members get a false "deleted" alarm on a Stripe abort.
- Gate is `clubs.owner_id` (403 `owner_only` for other admins) + typed exact club handle (400 `confirm_mismatch`). First owner-gated action in the app; the settings PATCH remains any-admin.
- **Why owner-only:** the owner is who Stripe bills; only they may cancel-and-destroy.
- Notifications: type `club` (not in NOTIF_PREF_BY_TYPE → unsuppressible), `link:null` (panel just marks read — no dead nav target), `actor_id:null`.
- destroyClub scale rules: fetchAllRows for challenges/events/posts reads (1000-row page trap) and `.in()` id deletes CHUNKED at 200 ids (URL length limit — a 1051-challenge club 400'd before chunking). Rows delete by club_id where possible.
- Post-image objects: posts rows cascade with the club, objects don't — read `posts.image_url` (+user_id, path is posts/{user_id}/…) BEFORE the club row dies, best-effort delete after. Redundant explicit event_rsvps delete dropped (cascade probe-proven).
- Sub read before Stripe fails CLOSED (read error → 500, no teardown), architect-caught.
- Sole-admin 409 copy is conditional ("if you are the club's owner") — REACHABLE non-owner case: role PATCH has no owner protection, so an admin can demote the owner leaving a sole non-owner admin. Follow-up task proposed for owner-demotion protection.
- UI: danger-zone card in club-dashboard settings (owner-only via server-injected `isOwner` boolean — owner_id itself deliberately NOT injected), arenasOverlay html-mode modal, `beforeClose` omitted (delete-account precedent), `clubPaid` (real getClubPlan) drives the no-refund line.
- Verifier `scripts/verify-club-delete.js` is in the battery (22 checks incl. Stripe-abort intactness via bogus sub id, 1051-row paging, member-side residue). Visual harness pattern: temp unauthed route + `__dzAutoOpen` hook, screenshot path needs `/../` prefix (previewPath is /html/landing).
