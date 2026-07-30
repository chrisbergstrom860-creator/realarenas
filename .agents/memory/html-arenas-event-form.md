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
- Every host close path (✕, Cancel, backdrop, post-submit, REPLACING an open modal) must run the module `teardown()`. The image manager exposes its own single close (`_aefTeardown` on `#evx-img-modal`); route replacement through it.
- `arenasCrop.open()` returns `{cancel}` — teardown must call it: without it a close during the async decode window lets the crop overlay open AFTER its parent is gone (orphan overlay + locked scroll). Any new arenasCrop caller must keep the handle.
- Date is split date+time inputs everywhere (tomorrow/07:00 create prefill); ISO composed client-side `new Date(date+'T'+time).toISOString()`.
- evx-* form CSS lives in shared arenas.css (`.evx-rbtn` RSVP `.on` variants stay events-page-local).
- Edit-path e2e: `scripts/verify-event-edit.js` (real modal PATCH round-trip incl. entry_fee/max_participants, cancel path, image-manager crop lifecycle). Screenshot harness: `scripts/shot-event-forms.js [after]`.
- Personal-event edit for athletes is one mode flag away (server canManageEvent already authorizes creators) — deliberately not shipped yet.
