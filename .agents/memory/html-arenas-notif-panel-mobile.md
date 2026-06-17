---
name: html-arenas notifications pop-down mobile fix
description: Why the club-dashboard notifications panel needs a mobile-only override and why it's safe to leave ungated.
---

# html-arenas notifications pop-down (mobile)

The `#notifications-panel` pop-down exists **only** on the club dashboard
(`arenas-club-dashboard.html`). Every other shell page sends the bell to the
full `arenas-notifications.html` page instead, so there is no panel to fix there.

**Root cause of the ~375px bug:** the panel's inline styles
(`position:absolute; right:0; width:360px`) anchor it to the bell wrapper, but the
bell is **not** flush-right — an avatar sits to its right. So `right:0` + a fixed
360px width pushes the panel off the **left** viewport edge on a 375px screen,
causing clipping + horizontal scroll. Vertical was always fine (it has a
max-height + internal scroll).

**Fix:** mobile-only override in `html/arenas.css`, inside the existing
`@media (max-width:768px)` block — pin the panel to the viewport
(`position:fixed; left:8px; right:8px; width:auto; top:60px; max-height:70vh;
overflow-y:auto`) and clear the inner list cap (`#notifications-panel-list
{ max-height:none }`).

**Why `!important`:** the panel's geometry is set via inline styles, so the
rules must use `!important` to win the cascade.

**Why ungated (NOT behind `body:has(.bottom-nav)`):** the rest of that media
block is gated on `.bottom-nav`, but this override is intentionally left ungated
so it always reaches the panel. That's safe precisely because the ID is
dashboard-only — it cannot leak onto another page. **If you ever reuse
`#notifications-panel` on another mobile page, revisit this.**

**How to verify (auth-gated page):** the dashboard requires Supabase login, so
visual QA uses a temporary no-auth harness route that reproduces the topbar +
bell + open panel + a long list, links the real `arenas.css`, registered under
the artifact previewPath (`/html/landing/...`) so the screenshot tool reaches it.
Always remove the harness + restart + grep-confirm removal afterward.
