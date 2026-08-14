---
name: Overlay migration to arenasOverlay
description: Patterns and traps for migrating hand-rolled overlays to the shared window.arenasOverlay primitive (Batches A/B; C pending)
---

## Primitive contract (arenas-overlay.js)
- Escape/backdrop consult `beforeClose` (return false = stay open); explicit `close(id)` calls ALWAYS bypass it — success paths and ✕/Cancel buttons must use `arenasOverlay.close('<id>')`.
- `open({node})` adopts a static panel and returns it home on close (stale-sibling falls back to appendChild). Rename the static root `#<id>-home`; it never gets `.open` again — the page's legacy `closeModals()` sweep can coexist untouched for unmigrated modals.
- Focus-in requires a focusable element in the panel — a ✕ rendered as a `div` silently breaks it (make it a real button).

## Dirty-guard patterns (approved by user)
- Form overlays: snapshot the joined form state immediately after the last synchronous population write, compare in `beforeClose` — untouched/prefilled forms read clean, change-and-back reads clean. Verify population really is synchronous first (async writes after open = false-dirty).
- Selection overlays (evx invites): compute dirty LIVE (query checked boxes at close time), never a flag — list reloads (e.g. after revoke) then correctly reset the guard.
- Destructive-confirmation modals (delete account): NO guard by explicit user decision — typed DELETE must be droppable; don't re-propose.

## Verifier (scripts/verify-overlay-behavior.js — permanent, extend, never fork)
- Config-table per overlay; always run the extended table BEFORE migrating for a non-vacuous baseline.
- Guard proofs both ways via dialog counting (playwright auto-dismiss = "stay"): dirty Escape/backdrop prompt + stay open; clean close = zero dialogs.
- Scenarios that consume seeded rows (revoke) need a per-width `beforeWidth` reseed.
- focusSel must survive the overlay's own side effects (e.g. club-invite send rebuilds its rows — focus the Send button, not an input).

## Ripple rule
Migrating an overlay retires its `.open`-class contract — grep ALL verify-* scripts for `#<id>.open` waits (profile-banner and mobile-geometry both needed updates in A/B).

## Remaining (user-driven, do not start unprompted)
- Batch C: #modal-avatar-photo/#modal-banner-photo (crop-cancel closeModals wrapper keys on them).
- #ccm-overlay excluded until bottom-sheet mode question settled; fetch-abort-on-close banked as its own task.
