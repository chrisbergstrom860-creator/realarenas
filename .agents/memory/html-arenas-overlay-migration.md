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

## Batch C1 (arenasEventForm hosts)
- All four form hosts (evx/eev/edit-ev/cev) ride arenasOverlay node-mode; the module owns dirty: build() returns isDirty() = collect() JSON vs baseline captured at END of build (prefills are markup, nothing async writes in → untouched edit forms read clean) OR cropState !== 'none'.
- teardown() sets a `torn` flag gating EVERY in-flight submit callback — without it a stale success closes a same-id SUCCESSOR overlay and (dashboard) schedules a reload. Architect caught this; keep the flag when touching submit().
- teardown() also bumps window.__aefTeardowns (verifier spy: exactly +1 per close on every path).
- Crop stacking: Escape closes the crop first, host survives with scroll locked; crop-cancel wipes cropState so the second-Escape guard fires off typed fields; accepted-crop-only (ac-use) dirt separately asserted.
- Scripts must never raw-.remove() a primitive-managed overlay (stale stack entry, locked scroll) — geometry cleanup uses arenasOverlay.close(id).

## Batch C2 — the three photo modals (closes the migration category)
- `#modal-club-logo` (club-dashboard), `#modal-avatar-photo` + `#modal-banner-photo` (my-profile) → node-mode with `-home` parking divs; legacy `openModal`/`closeModals`/`closeAllModals` DELETED from both pages (nothing toggles `.open` there anymore).
- **NO dirty guards by design** (user-approved §3): logo/avatar upload immediately on file select; banner stages nothing that survives a crop cancel — pick photo → cancel crop → Escape loses nothing. Deliberate divergence from C1's guard standard, not an oversight.
- Banner mid-decode orphan fix relocated: former closeModals wrapper is now `bannerCleanup()` = the banner overlay's `onClose` (same 4 ops: token++, cropHandle.cancel(), null, input clear — only when cropHandle set). Strictly stronger: Escape/backdrop can't bypass it. `openBannerModal` lives INSIDE the banner IIFE (closure access).
- Spies: `window.__bannerCleanups` (banner), `window.__photoModalCloses` (logo+avatar). Verifier harness spy generalized via `cfg.spyName` (defaults `__aefTeardowns`).
- Contract ripple (grep for `.open` waits when migrating!): fixed in verify-mobile-geometry (open via new fns, chain closes via `arenasOverlay.close`), verify-profile-banner (3 waits), verify-header-avatar (isOpen = root presence).
- E2e note: post-remove image fetch of the just-deleted storage object 404s/400s in console — benign pre-existing race, not migration-related.
- Closing state: 15 overlays under the primitive + verifier; deliberate exclusions = calendar `#day-panel`, for-clubs `#signup-overlay`/`#success-overlay` (own `.signup-overlay` system), plus runtime inline `#rsvp-modal-overlay`.
