---
name: html-arenas danger zone (export + delete)
description: Account export/delete endpoints — Stripe-first delete ordering, club survival rules, schema gotchas hit while building it
---

# Danger zone: export + account delete

Endpoints live in server.js (`/api/account/export`, `/api/account/delete`), UI in arenas-my-profile.html (type-DELETE modal).

## Durable rules

- **Stripe cancellation ALWAYS before any row deletion.** Any Stripe error — including `resource_missing` when the DB row claims active — aborts the whole delete with 502 and nothing removed. **Why:** a DB-active/Stripe-missing mismatch means key mismatch or corruption; deleting anyway orphans live billing. A sweep failure AFTER cancel fails safe (canceled sub can't bill a half-deleted account) — keep that ordering.
- **Club survival matrix:** no other members → club dies (its sub canceled too); other members but no other admin → 409 block naming club + two paths; another admin exists → club survives, owner_id → longest-standing other admin (memberships.created_at).
- **Surviving-club billing hand-off:** club checkout binds the owner's card, so after a transfer the sub still bills the departed owner. Fix shipped: `billing`-type notification to the new owner (type 'billing' is NOT in NOTIF_PREF_BY_TYPE so it can't be pref-suppressed; actor_id must stay null or the actor_id sweep deletes it in the same request).
- Export = single JSON attachment; avatar as public URL not bytes (single-file, no zip dep). Paged fetch (fetchAllRows) — PostgREST silently truncates at 1000 rows.
- Auth user is deleted LAST; sweep order children-first incl. others' likes/comments on the user's posts, notifications/follows both directions, invites by invited_by AND email.

## Schema gotchas hit

- `posts` has NO club_id column (club feed derives from members) — never query/sweep posts by club.
- `clubs.handle` is NOT NULL — seeds must set it.
- Valid pref keys are notify_kudos/comments/followers/challenges/events (+2 visibility) — `notify_likes` doesn't exist.
- Stripe test recipe: `paymentMethods.attach('pm_card_visa')` returns a NEW pm id — use the returned id as default_payment_method, not the string 'pm_card_visa'.
- Login for API tests: POST `/html/auth/login` form {email,password,tz}, expect 302.

## Known accepted limits

- No DB transaction: sweep can partially fail → honest 500 ("sub already canceled, retry"). TOCTOU between read-phase and sweep accepted at this scale.
- Stripe customer objects (PII) are never deleted, only subs canceled. deleteAvatarObject is best-effort.
