---
name: html-arenas Pro badge
description: Server-injected "PRO" badge for Individual Pro subscribers — placements, injection pattern, and the flag-independence rule.
---

# Pro badge (Individual Pro visibility)

**Rule:** the PRO badge is driven by the real subscription (`getUserPlan === 'pro'`), deliberately NOT by `PLAN_GATES_ENABLED`. A paying user must see their status even when gates are off; never tie status display to the gating flag.

**Why:** the badge reflects "am I being charged," which is true regardless of whether feature gates are enforced. Tying it to the flag would hide paid status in dev/flag-off environments.

**How to apply:** `injectProBadge(html, isPro)` in server.js — string `replaceAll` applied after `injectBottomNav` in every authed page route (8 shell pages + billing). Free users' pages get the untouched HTML: zero badge markup, no client guessing, no flash. Targets:
- sidebar "My profile" nav item (pattern `👤</span> My profile</div>`) — 7 athlete shells + billing;
- avatar-dropdown "My profile" row (pattern `text-decoration:none">My profile</a>`) — every page; this is the ONLY placement on club-dashboard (its sidebar has coach tabs, no profile item) and the mobile path (bottom nav's cramped "Profile" pill stays badge-free on purpose);
- my-profile hero: `<!--PRO_BADGE_SLOT-->` placeholder inside `.hero-name-row`, replaced server-side (with '' for free users). Safe against `setText('.hero-name', …)` because the badge is a sibling, not a child.

Styling: `.pro-badge` in shared `html/arenas.css` (yellow `var(--yellow)` pill, 9px mono, 800 weight); `.nav-item .pro-badge { margin-left:auto }` right-aligns in sidebars; my-profile page CSS bumps the hero variant to 10px.

Gotcha: the string patterns are exact-match — if the sidebar nav markup or the dropdown link's inline style ever changes, the badge silently disappears. E2E check lives in the pattern: create pro+free test users, insert an active `subscriptions` row (needs `owner_type/owner_id/plan/status`; club inserts need `owner_id`), login via POST /html/auth/login, count `<span class="pro-badge"` per page (pro: 2 per shell page, 1 on club-dashboard, 3 on my-profile; free: 0 everywhere).
