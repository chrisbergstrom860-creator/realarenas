---
name: html-arenas challenge images + canUserSeeChallenge
description: Challenge cover images (6:1 ribbon, private bucket) and the canonical challenge visibility gate that closed the private-club hole.
---

## Canonical visibility gate
`canUserSeeChallenge(userId, ch)` in server.js is THE rule for challenge reads:
public → any authed user; creator ∨ participant → yes; private+club → club member;
private solo → invite-row holder; any lookup failure denies. **Visibility wins over
club scope** (clubs can run open challenges; Discover lists public club challenges).
- Join + leaderboard + image proxy all sit on it. Denial = byte-identical
  `{error:'Challenge not found'}` vs a nonexistent id (the old `invite_required`
  403 was an existence oracle — never reintroduce it).
- Duplicate join (23505) = idempotent success ("participant is a grant").
- Pro gate + ended-check run AFTER the gate (caller already proved visibility).
- Invite rows on ended challenges still grant view — intentional (finding 4 kept).

## Images
- Mirrors event-images: PRIVATE bucket `challenge-images`, `challenges/{id}/{ts}.webp`,
  **1440×240 WebP q82 (6:1)** — fixed-aspect ribbon is WYSIWYG at every width
  (Variant B; fixed-height double-crop rejected).
- `challengePublicRow()` strips `image_path` → `image` version token everywhere rows
  leave the server (list enrich, all mutations, coach dashboard, club member home).
  Export has NO image field (matches events, intentional).
- Writes = `requireChallengeEditor` (creator; club admin/coach for club-scoped):
  private solo denial ≡ ghost id; public denial = 403 `not_authorized`.
- Client: crop via arenas-crop.js `{aspect:6,outWidth:1440,outHeight:240}` with the
  event-form state machine (pending blocks submit; cancel handle on rewire);
  create/save-first-then-upload, failed upload = honest toast, never rollback.
  Thumbs (img w/ emoji fallback) on leaderboards rail, member home, coach dashboard.
- Guard: `scripts/verify-challenge-images.js` (hole-closed byte-diffs, leak scans —
  scan excludes the PUBLIC avatars bucket, orphan checks). Row/account deletes sweep
  objects after row deletes.
