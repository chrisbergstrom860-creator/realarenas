---
name: html-arenas recurring planned sessions
description: plan_series rule table + materialized occurrences; detach-on-date-change-only; scope=future delete semantics
---

# Recurring planned training sessions

Model: `plan_series` rule table (user-run DDL; weekday 0=Mon..6=Sun, null for daily) + **materialized** `planned_sessions` occurrences linked via `series_id` (FK on delete set null). Materialize-not-expand so every existing read/status/log path works unchanged.

Rules (user-locked decisions — don't re-litigate):
- **Detach ONLY on a date change.** Content edits (title/sport/duration/notes/status) keep the row in its series. PATCH returns `detached:true`; client toast: "✓ Saved — the new date takes this session out of its series; series-wide deletes won't touch it."
- End date is REQUIRED (client prefills +8 weeks). Server caps: daily ≤92-day span, weekly/biweekly ≤366 days, ≤100 occurrences absolute. Form mirrors count math live ("Creates N sessions — every Friday through 30 Oct 2026.").
- `DELETE /api/plans/:id?scope=future` = same series ∧ attached ∧ `status='planned'` ∧ date ≥ anchor; anchor itself deleted explicitly even if done/skipped. Done/skipped history and date-detached rows are never touched.
- Recurrence is CREATE-ONLY (no series-level edit in v1; delete-and-recreate is the escape hatch).
- Series row tidied best-effort when last occurrence goes (benign orphan race — account delete sweeps `plan_series`).

**Why:** silent detach on content edits would make "this and all future" mysteriously spare edited sessions; caps are server truth so the form can't be bypassed.

**How to apply:** stepping is integer Y-M-D (`planYmdAdd`), never timestamps — biweekly parity proven across month boundaries. `attachPlanSeries()` decorates `/api/plans` + `/api/calendar/month` payloads with `series {frequency, weekday, start_date, end_date}` and degrades if the table is missing. Client three-way inline delete choice (confirm() can't do 3-way); solo plans keep confirm(). Guards: `scripts/verify-plan-recurrence.js`, `scripts/verify-plan-form-geometry.js`. Export includes `plan_series` (no ids); account delete sweeps both tables.
