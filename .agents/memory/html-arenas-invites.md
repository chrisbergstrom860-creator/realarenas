---
name: html-arenas club invites
description: Design rules for the club invite/join feature (personal vs open links, single-use semantics, authorization).
---

# Club invite feature design rules

## Two invite kinds, distinguished only by email
- A sentinel email constant `OPEN_INVITE_EMAIL` marks an **open/shareable** invite row.
- Any other email is a **personal** invite. There is no `kind`/`type` column — `invite.email === OPEN_INVITE_EMAIL` is the discriminator.

## Single-use vs reusable (the bug that bit us)
- **Personal invites are single-use**: on accept, set `status='accepted'`. The `/join/:token` lookup filters `status='pending'`, so an accepted personal invite reads as invalid afterward.
- **Open links must stay reusable**: do NOT mark them `accepted` on join, or the first joiner consumes the link for everyone. Leave them `pending` until `expires_at`.
- **Why:** both accept paths (`POST /auth/join/:token` new-account, `POST /auth/join/:token/existing`) shared one "mark accepted" block; applying it to open links silently broke "anyone with this link can join."
- **How to apply:** guard every status-to-accepted write with `if (!isOpen)`.

## Email binding (authorization)
- Personal invites are bound to their email. In the existing-user accept path, reject when `req.user.email` (lowercased) !== `invite.email` (lowercased) → 403. Open links accept any signed-in user.
- New-account path forces the new email to `invite.email` for personal invites, so binding is inherent there.

## Existing vs new invitees
- On invite (single + bulk), detect if the email already belongs to a Supabase auth user. Existing non-members get an **in-app notification** (type `club`, link `/join/<token>`) instead of relying on the link; existing members are rejected/skipped (`already_member`). New emails get the join link as before.
- Use `listAllAuthUsers()` (paginates `auth.admin.listUsers`) — a single `listUsers({perPage:1000})` misclassifies users past page 1 as new. In bulk, fetch the user map once before the loop, not per email.

## Any one-click join must require a real invite (authorization)
- The standalone `POST /api/clubs/:clubId/accept-invite` endpoint was **removed** (its only caller was the retired notifications page). Acceptance now flows only through `/join/:token` + `/auth/join/:token[/existing]`, which resolve the invite by token.
- **Durable rule:** if you ever add another "join this club" path, it MUST verify a real pending invite for `req.user.email` + `clubId` (reject 403 if none, 410 if expired) **before** inserting membership. Deriving role / defaulting to member without that check lets any signed-in user join any club by id — a broken-access-control hole caught in review once already.

## Other constraints carried from schema reality
- Revoke = DELETE the row (do not write a `revoked` status — unknown status CHECK risk). Only `pending`/`accepted` are ever written.
- `isExpired` is computed from `expires_at`, not stored.
- TTLs: personal `INVITE_TTL_MS` 14d, open `OPEN_INVITE_TTL_MS` 30d.
- Token-bearing join URLs are only `console.log`'d when `NODE_ENV !== 'production'` (avoid token replay from logs).
- Every invite/member API endpoint authorizes via `getClubRole` + `isClubManagerRole`; resend/revoke look up the invite's club first (prevent IDOR/PII leak).
