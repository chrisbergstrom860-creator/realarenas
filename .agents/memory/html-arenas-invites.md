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

## Other constraints carried from schema reality
- Revoke = DELETE the row (do not write a `revoked` status — unknown status CHECK risk). Only `pending`/`accepted` are ever written.
- `isExpired` is computed from `expires_at`, not stored.
- TTLs: personal `INVITE_TTL_MS` 14d, open `OPEN_INVITE_TTL_MS` 30d.
- Token-bearing join URLs are only `console.log`'d when `NODE_ENV !== 'production'` (avoid token replay from logs).
- Every invite/member API endpoint authorizes via `getClubRole` + `isClubManagerRole`; resend/revoke look up the invite's club first (prevent IDOR/PII leak).
