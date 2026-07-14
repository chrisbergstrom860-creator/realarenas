---
name: html-arenas calendar
description: Calendar page + planned_sessions CRUD, interactive day panel, Log-this handoff, gating split, month endpoint honesty rules.
---

# Calendar feature (interactive day panel shipped)

- `planned_sessions` is a user-provisioned table (no DDL via service role) — every read degrades to empty if missing. Plan dates are plain `YYYY-MM-DD` local-date strings (goals convention), never timestamps.
- **Why:** timestamps skew days in non-UTC locales; text windows compare lexicographically and are exact.
- Gating split (dormant behind `PLAN_GATES_ENABLED`): create + content-edit are Pro-gated; status-only PATCH (defined keys ⊆ {status}), DELETE, and reads are always free. **Why:** lapsed users must be able to close out / exit their existing plans. The PATCH gate is an inline check, not middleware — middleware can't see the body shape. `activity_id` is never client-writable.
- "Log this" handoff: calendar → `/profile#log=<planId>`; profile hash handler fetches the plan and prefills the activity form; `POST /api/activities/create` accepts `plan_id` — looked up BEFORE insert (foreign → hard 403, no insert; stale/missing → silently ignored; owned → sets `activity_id` + `status:'done'` after insert, response carries `planCompleted`).
- Day panel is interactive: delegated click handler on `#dp-body` via `data-cal-action` attrs; in-place updates re-fetch `/api/calendar/month` + full re-render (simpler than client-state patching; known nit: an RSVP click wipes an unsaved in-progress plan form).
- `window.ARENAS_SPORTS` entries have `label`, NOT `name` — `sportName()` must read `.label`. **Why:** `.name` returns undefined and untitled plans crash render via `sportName(...).toLowerCase()` (untitled plans render "Planned <sport>").
- `/api/calendar/month` honesty partition: `myStatus` is `going`/`interested`/`'none'`. Cancelled RSVP → `'none'` on club events, row DROPPED for non-club events. Non-club events with no RSVP never appear. "Not responded" renders muted — never as commitment.
- Month window: event/activity timestamp window widened ±1 day server-side; CLIENT trims to exact local month via local date parts. Plan window is exact text compare. All month arithmetic is integer year/month math (reports-tab rule).
- Page details: view toggle in localStorage `arenas_calendar_view` (default agenda ≤768px, month desktop); month hash `#YYYY-MM` + suppress flag; day panel = modal desktop / bottom sheet ≤768px; panel buttons disable during in-flight requests (a mid-flight snapshot looks like a "disabled Delete" — check DB before calling it a bug).
- Testing patterns that worked: temp confirmed users via service-role `createUser` + cookie login on `/html/auth/login`; gate-flag-on UI tested by temporarily writing `PLAN_GATES_ENABLED=1` to a throwaway `.env` (dotenv) + workflow restart — Playwright test agents CANNOT reach ad-hoc localhost ports, only the proxied app.
- Gotchas: `events.location` is NOT NULL — seeds must set it. `clubs` insert needs `owner_id` + `handle` (no `admin_user_id`).
