---
name: html-arenas challenge creator edit/delete
description: Rules and route separation for editing, deleting, ending, and unlisting challenges
---

# Challenge creator edit/delete

- Authz for all four routes = `requireChallengeEditor` (creator OR club admin/coach). Private-solo outsiders get "Challenge not found" (zero-leak); public/club outsiders get 403 `not_authorized`. Never plan-gated (correction/exit actions never are).
- **Delete branches on ALONENESS, not doneness**: hard delete only when creator alone (no other participants AND no derived-pending invites), any state incl. completed. Otherwise server refuses with `not_alone` and the UI offers End early / Remove from Discover. Club dashboard Cancel degrades to end-early on `not_alone`.
- **PATCH whitelist keyed on start_date**: pre-start everything editable; post-start ONLY title/description — any material key in body → `field_locked`. Once ended → `challenge_ended`, locks even title.
- **Two "done" concepts, never conflate**: `challengeHasEnded(ch)` (challenge-level, end_date passed) is the ONLY notion authorization consults (edit lock, end-early refusal). Per-viewer `isComplete` (viewerHasCompleted) is DISPLAY ONLY. **Why:** gating mutations on per-viewer completion locked creators who personally finished early out of editing/ending a still-live challenge, with no escape path.
- **End early** = set end_date to 24h ago (derived Completed flips everywhere; no status column). NO standings snapshot exists — all copy must say "standings as of the end date, recomputed from activities", never "frozen/final". Refused pre-start (`not_started`) and when already expired.
- **/remove-from-discover** is a deliberately SEPARATE one-directional route: public→private any time (incl. post-start, where PATCH locks visibility). private→public post-start is impossible by construction.
- **Grandfathering**: any public→private transition on a solo challenge mints invite rows for existing non-creator participants (upsert-ignore, no notifications, pending rule stays false) so they can leave and rejoin. Join route checks invites BEFORE the Pro gate — useful in tests: `pro_required` proves invite gate passed.
- Notification fan-out (type 'challenge', prefs auto-enforced): material pre-start edits + end-early notify other participants; title/desc edits notify nobody. That's the complete set.
- Overlay primitive gained `beforeClose(reason?)` — invoked only for Escape/backdrop closes (return false aborts); ✕/Cancel/programmatic close bypass. Create+edit challenge modals use it for a shared snapshot dirty-guard (`chFormBaseline`).
- Edit modal reuses `buildCreateModal()` re-targeted via `#ch-modal-title` / `#ch-submit` ids; invite picker hidden in edit mode (invites go through the Invites manager).
- Regression guard: `scripts/verify-challenge-edit-delete.js` — seeds 4 users + 5 challenges, 29-check HTTP matrix, sweep cleans up.
