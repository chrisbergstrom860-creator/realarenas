---
name: /log page restructure plan (investigated, not built)
description: Coupling map + agreed design for moving the activity-log form from my-profile's Activities tab to a standalone /log shell page. Architect-validated July 2026; build not started.
---

# /log restructure — validated plan

**Rule:** when building /log, follow this map; the form is a move-not-rewrite (one session).

**Why:** full investigation + architect PASS established the form's only page-external deps are ARENAS_SPORTS (free on every shell page via injectBottomNav→injectNotificationsPanel→injectAvatarHelpers), window.BASE, and page-local CSS. ARENAS_DATA.userId is only needed by the list (stays in my-profile).

**How to apply:**
- Moves: activitySportFields map, toggleActivityForm/selectActivitySport/selectFeeling/showActError/actVal/saveActivity/prefillFromPlan/pendingPlanId + form markup (chips IIFE is inside it). Stays: loadActivities/renderActivities/deleteActivity/actTimeAgo/escAct + tab counts. escAct is NOT needed on /log (showActError uses textContent).
- **CSS trap:** .form-input/.form-select/.form-textarea/.toast/.act-sport-chip/.act-feeling-chip are page-local styles in my-profile (~lines 221-293), absent from arenas.css — copy or promote them, and check CSS vars (--red-light, --radius-lg).
- Route: clone /calendar route (server.js ~5389): inject {userId, profile, clubs}; NO proLocked (logging + plan-link are free). Add 'log' to ATHLETE_NAV_ACTIVE; retarget bottom-nav Log item.
- Prefill: client-side ?plan= reusing prefillFromPlan (/api/plans is ownership-scoped, stale→empty form); no 50ms setTimeout needed (no tab switch).
- Post-save: response is {success, activity, planCompleted} — enough. Default redirect /feed (feed includes self); plan-linked → /calendar#YYYY-MM using the **date-input value**, never the returned ISO (local-noon ISO can cross month for UTC+ viewers). Drop the toast (doesn't survive nav) or sessionStorage-flag both destinations.
- Back-compat: my-profile #log=<id> handler becomes location.replace(BASE+'/log?plan='+id); #activities keeps opening list-only tab. Retarget ~10 entry points: sidebar item on 8 pages, bottom nav (server.js ~585), feed quick action + empty-state link (feed ~428/~966), calendar plan-log (~758). Challenges ~919 goes to plain /profile today (pre-existing miss).
- Tab after: form was display:none — no layout gap; repoint #log-activity-btn to nav('/log'); reword "above" empty-state copy; fix setTab label-match at my-profile ~803 ("Log activity" no longer a tab).
