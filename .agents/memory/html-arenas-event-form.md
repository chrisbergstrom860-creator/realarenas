---
name: html-arenas shared event form
description: One shared module (arenas-event-form.js) renders event create/edit for events page + club dashboard; teardown/crop contract and host chrome rules.
---

## The rule
All three event forms — events page create (prefix `evx`), dashboard create (`cev`), dashboard edit (`edit-ev`) — come from `window.arenasEventForm.build({mode, context, prefix, ...})` in `html/arenas-event-form.js` (own dual serve route in server.js). The `manageImage` overlay also lives there and serves both pages. Never fork form fields per host again.

**Why:** the two create forms drifted (crop wiring duplicated twice, dashboard lacked fee/max, three different date-input styles) and every fix had to be made 2-3x.

**How to apply:**
- Hosts own ONLY chrome: overlay shell, header, notify banners, footer buttons, post-success behavior. New fields go in the module's registry with per-context flags (events page = free-text type/level + club/visibility/invitees; dashboard = selects + chips + hardwired `visibility:'club'`).
- Field ids are `<prefix>-<suffix>` (title/type/date/time/location/distance/fee/max/level/desc/image/error) — e2e suites key on them.
- Every host close path (✕, Cancel, backdrop, post-submit, REPLACING an open modal) must run the module `teardown()`. The image manager now rides arenasOverlay: its crop cancellation IS the onClose (no route can bypass — Escape/backdrop/✕/replace); `_aefTeardown` is retired. beforeClose asks before discarding an un-uploaded crop; a `closed` flag blocks change events on a detached input from opening orphan crops.
- `arenasCrop.open()` returns `{cancel}` — teardown must call it: without it a close during the async decode window lets the crop overlay open AFTER its parent is gone (orphan overlay + locked scroll). Any new arenasCrop caller must keep the handle.
- CRITICAL past bug: arenasCrop.open() once returned the handle ONLY from the no-primitive early exit — the normal path returned undefined, so mid-decode cancellation silently never worked for ANY caller. The trailing `return handle` is load-bearing; `scripts/verify-img-overlay.js` pins the contract + mid-decode replacement/✕ races + the four primitive behaviors.
- NOT the last hand-rolled overlay app-wide: ~12 remain (dynamic: evx/eev event modal hosts, dashboard RSVP/create/edit/invites, club-create wizard; static class-toggled: athletes, blog, calendar day-panel, dashboard club-logo, club-invite success).
- Date is split date+time inputs everywhere (tomorrow/07:00 create prefill); ISO composed client-side `new Date(date+'T'+time).toISOString()`.
- evx-* form CSS lives in shared arenas.css (`.evx-rbtn` RSVP `.on` variants stay events-page-local).
- Edit-path e2e: `scripts/verify-event-edit.js` (real modal PATCH round-trip incl. entry_fee/max_participants, cancel path, image-manager crop lifecycle). Screenshot harness: `scripts/shot-event-forms.js [after]`.
- Athlete self-edit SHIPPED: owner card Edit → `eev` host on the events page. Events-page edit renders a FREE-TEXT Type field of its own (create puts Type in the sport row; without the edit field, collect() sent event_type:null and PATCH wiped it). Validation must not require sport in edit mode.
- `optHtml` preserves a stored value outside the fixed select options as a selected option — otherwise the dashboard silently rewrites off-list type/level to the first option on any save. Never regress this.
- **Material-change notifications (both hosts, ONE PATCH path in server.js)**: date-or-location actually changed → notify going+interested RSVPers except the actor (type 'event', prefs notify_events inside createNotification). Date compares as instants (form re-composes ISO — string compare false-positives); location trimmed null-safe. Cosmetic edits silent. Fan-out is try/catch — may never fail the edit. `events.location` is NOT NULL in the schema.
- Visibility/club/sport are immutable after creation BY CONSTRUCTION (PATCH whitelist ignores them, module excludes the fields in edit mode) — stronger than an explicit check; keep it that way.
- Owner private card action row (pill + Edit/Invites/Image/Delete) needs flex-wrap; geometry guard asserts it at 360/380/414.
- Self-edit e2e: `scripts/verify-event-self-edit.js` (zero-leak byte-identical, notification matrix, RSVP survival, UI round-trip). `verify-event-edit.js` has an intermittently flaky image-manager timing check (dashboard self-reload race) — rerun before treating as real.
