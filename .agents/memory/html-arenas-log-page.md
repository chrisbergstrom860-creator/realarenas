---
name: html-arenas /log page
description: Standalone Log-activity page — route shape, post-save redirects, ?plan= deep link, what moved out of my-profile.
---

# /log — standalone activity logging page (shipped)

- `arenas-log.html` + `app.get(BASE + '/log')` clone the /calendar composition: `requirePageAuth`, `injectProBadge(injectBottomNav(injectArenasData))` with `{userId, profile, clubs}`, `log:'log'` in `ATHLETE_NAV_ACTIVE`, and NO `proLocked` injection.
  **Why:** logging is a free feature, plan-linking included — adding a Pro gate here would contradict the dormant-gating design (see stripe memory).
- The form is open by default — there is no open/close toggle. `resetActivityForm()` is the reset half of the old `toggleActivityForm`, run on DOMContentLoaded.
- Post-save there is deliberately NO toast — navigation is the confirmation: default → `/feed`; if the response carries `planCompleted` → `/calendar#YYYY-MM`.
  **Why (month source):** the month comes from the date INPUT value (local `YYYY-MM-DD` string), never the returned ISO timestamp — the local-noon→UTC conversion can skew into the previous month for viewers east of UTC.
- `?plan=<id>` prefills from `/api/plans` (ownership-scoped server-side; a stale/deleted id silently degrades to a plain empty form, no fake plan link). `pendingPlanId` is cleared on reset so a manually opened form never carries a stale link.
- Back-compat deep links on my-profile: `/profile#log=<id>` forwards via `location.replace` to `/log?plan=<id>` (encodeURIComponent(decodeURIComponent(id))); `/profile#activities` just opens the Activities tab.
- my-profile's Activities tab is list-only now (`escAct`/`loadActivities`/`deleteActivity`/`renderActivities` stayed); its header button and empty-state link `nav('/log')`. `setTab` no longer maps any tab to the "Log activity" sidebar label.
- Shared styles were promoted to `arenas.css` (`.form-input/.form-select/.form-textarea`, `.toast`, `.act-sport-chip`, `.act-feeling-chip`).
  **How to apply:** my-profile's goal-period chips reuse `.act-sport-chip` and its delete toast uses `.toast` — do not remove these from arenas.css even though the entry form left the page.
- Club pages (club-dashboard, club-member) keep their own nav without a Log item — by design, not a missed entry point.
- e2e login pattern: create a throwaway confirmed athlete via service-role `admin.createUser({email_confirm:true})`, then log in through `/html/auth/login`. Delete the user AND its rows afterwards (activities, planned_sessions, achievements, notifications all carry `user_id`) — old test accounts' passwords rot and pollute the shared dev DB.
