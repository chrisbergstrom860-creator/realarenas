---
name: html-arenas calendar (Session ①)
description: Calendar page + planned_sessions CRUD + month endpoint — honesty rules, month math, and Session ② hooks.
---

# Calendar feature (read-only Session ① shipped)

- `planned_sessions` is a user-provisioned table (no DDL via service role) — every read degrades to empty if missing. Plan dates are plain `YYYY-MM-DD` local-date strings (goals convention), never timestamps.
- **Why:** timestamps skew days in non-UTC locales; text windows compare lexicographically and are exact.
- Plan writes are Pro-gated via `requireProPlan('training_plan')` (dormant behind `PLAN_GATES_ENABLED`); reads (list + month endpoint + page) are always free. Creation forces `status:'planned'`; `activity_id` is NOT client-writable — Session ②'s "Log this" flow sets it server-side.
- `/api/calendar/month` honesty partition: `myStatus` is `going`/`interested`/`'none'`. Cancelled RSVP → `'none'` on club events, row DROPPED for non-club events (the RSVP was its only link). Non-club events with no RSVP never appear. "Not responded" must render muted/dashed — never as commitment.
- Month window: event/activity timestamp window is widened ±1 day server-side; the CLIENT trims to the exact local month by bucketing on local date parts. Plan window is exact text compare. All month arithmetic is integer year/month math (reports-tab rule).
- Page `arenas-calendar.html`: view toggle persisted in localStorage `arenas_calendar_view`; default = agenda ≤768px, month on desktop. Month hash `#YYYY-MM` + hashchange with a suppress flag. Desktop cells show text pills, mobile shows dots (`.cd-pills`/`.cd-dots` media swap). Day panel is modal on desktop / bottom sheet ≤768px and is read-only; `.dp-actions` (display:none) is the reserved slot where Session ② mounts per-item actions.
- Nav: bottom nav now has 6 items (Cal between Log and Ranks) — verified to fit at 380px; sidebar "Calendar" item lives on all 8 athlete pages (7 pre-existing + calendar itself), inserted after Events.
- **How to apply (Session ②):** add write UI into `.dp-actions` + a create-plan affordance gated on `ARENAS_DATA.gating.proLocked`; PATCH status transitions are already whitelisted server-side; e2e seeding pattern (temp users + club + RSVP matrix) worked cleanly with cookie login against `/html/auth/login`.
- Gotcha: `events.location` is NOT NULL — seeds must always set it.
