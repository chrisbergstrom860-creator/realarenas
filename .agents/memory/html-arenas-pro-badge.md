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

# Club Pro badge (club visibility) — same rules, two placements

**Rule:** identical flag-independence — driven by `getClubPlan === 'club_pro'` (canceled sub = free), never by `CLUB_PLAN_GATES_ENABLED`.

Placements:
- Athlete sidebar "My clubs" rows: compact "PRO" pill. Server-decided via an ADDITIVE `plan: 'club_pro'` field (set only for paying clubs — free club objects untouched) on BOTH clubs data paths: `getSidebarClubs()` AND the /profile route's separate inline `userClubs` list (it exists because the My Clubs tab needs `city`; any new clubs-list builder needs the same enrichment or the badge silently misses that page). The 9 byte-identical sidebar renderer IIFEs append the span only when `club.plan === 'club_pro'`. Existing `.pro-badge` + `.nav-item .pro-badge{margin-left:auto}` CSS — no new styles.
- Club-dashboard sidebar-footer identity block: "CLUB PRO" pill via `<!--CLUB_PRO_BADGE_SLOT-->` comment, a flex-row SIBLING of `.club-name` (client `textContent` rewrites would wipe a child — hero-slot precedent). Route replaces with `CLUB_PRO_BADGE_HTML` or ''.

Byte-cleanliness scope (be precise when claiming it): free clubs' *rendered rows* and free clubs' *dashboard pages* are clean of the CLUB badge; athlete pages' raw bytes always contain the literal 'pro-badge' template string inside the renderer JS, and an individual-Pro viewer still gets injectProBadge markup on any dashboard.

Mobile: at ~380px sidebars are hidden (bottom-nav shell), so neither club badge surface is visible — consistent with the individual badge's badge-free mobile pills; accepted, not a bug.

Perf note (known follow-up): getSidebarClubs now runs one getClubPlan query per club membership per page load (parallel). If latency matters, batch as one `.in('owner_id', ids)` subscriptions query.

Candidate future placements (deliberately NOT built): club-member page identity header, profile hero club pills + My Clubs tab cards (profile data already carries `plan` — client-only change), avatar "Clubs you manage" menu, invite/club-join pages.
