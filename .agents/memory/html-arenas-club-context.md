---
name: html-arenas club context propagation
description: Rule for club-scoped navigation (explicit ?club= everywhere), the navClub helpers, and the post-login landing policy.
---

# Club context must be passed, never inferred

**Rule:** every navigation between club-scoped pages (`/clubs/dashboard`, `/clubs/invite`) must carry an explicit `?club=<id>`. Server routes may keep a "most recent admin/coach membership" fallback for bare URLs, but no in-app link should rely on it.

**Why:** the fallback orders memberships by `created_at desc`, so for a manager of several clubs it always resolves to the LAST-CREATED club — any bare link silently teleported multi-club managers between clubs (dashboard → invite console → back landed on a different club).

**How to apply:**
- Both club pages define `window.navClub(path)` in their head script: appends `?club=` from the injected payload (`ARENAS_DATA.club.id` on the dashboard, `INVITE_DATA.club.id` on the invite console), handles `#hash` placement, falls back to plain `nav()` when no payload (servePlain). Use it for any new club-scoped link on those pages.
- Server-side club resolution on both routes: honor `?club=` only when the viewer has an admin/coach membership of that club (role-filtered query = the IDOR boundary); unknown/unmanaged/garbage ids silently fall back, never 500.
- Notification `link`s pointing at the dashboard must include `?club=` (club id is at hand as `entityId`).
- Already-correct surfaces (don't re-fix): athlete sidebar "My clubs" + avatar "Clubs you manage" menu carry `?club=`; dashboard tabs are in-page `setTab` (no reload); `/billing` lists ALL managed clubs; member pages are path-scoped `/clubs/member/:clubId`.

# Post-login landing policy

Everyone lands on `/feed` after login (login POST, root route for logged-in users). There is NO manager special-case — the old `isClubManager → /clubs/dashboard` redirect was deleted (helper removed too) because it combined with the fallback above to land managers on the last-created club. The only dashboard redirect left is the for-clubs wizard COMPLETION (onboarding, not login), which now carries the new club's explicit `?club=`. Wizard-created club-only accounts are ordinary users — feed works; clubs reachable via sidebar/avatar menu.
