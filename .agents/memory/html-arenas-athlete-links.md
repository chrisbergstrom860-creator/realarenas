---
name: Athlete-link mechanism (app-wide clickable names/avatars)
description: How athlete names/avatars link to /athletes/:id everywhere — shared module, reachability flags, and the scope boundaries chosen with the user.
---

## The mechanism (ONE, never fork)
- `html/arenas-athlete-link.js` — `window.athleteLinkAttrs(userId, reachable)` returns ` data-athlete-link="<id>" role="link" tabindex="0"` or `''` (unreachable/no id; id sanitized to `[a-zA-Z0-9-]`). One capture-phase document click + Enter handler navigates: self (`ARENAS_DATA.userId`) → `/profile`, else `/athletes/:id`. It ignores clicks landing on interactive descendants (`button,a,input,select,textarea,label`), so buttons inside linked regions need NO per-surface stopPropagation; capture phase beats card-level inline onclicks (RSVP whole-card nav etc.).
- Markup pattern: `<span {attrs} style="display:contents">avatarHtml…</span>` for avatars; attrs directly on name elements. CSS affordance `[data-athlete-link]{cursor:pointer}` in arenas.css.
- **Script tag must be NON-defer** (before the inline page renderers) — with `defer` the renderers run first, `athleteLinkAttrs` is undefined, and every guard silently emits no link. Bit us in browser testing.

## Reachability rule
- Payloads carry the flag; client never infers. `displayFromUser` + `buildUserProfileMap` emit `profilePublic` (= `show_on_leaderboards !== false`); feed posts carry `authorProfilePublic`, member-home announcements `coachProfilePublic`; club feed / roster / challenge-lb / event-rsvps / friendsInChallenges carry `profilePublic`. Opted-out athletes are NEVER links (their profile 404s — zero-leak).
- `buildFeedPosts` had a hand-rolled profile-map subset that dropped the flag — refactored to `displayFromUser`. Watch for other hand-rolled metadata maps when adding fields.
- Challenge leaderboard route does NOT filter opt-outs (unlike platform/club/following leaderboards) — that's why its entries need the flag; platform-lb surfaces pass `reachable=true`.
- Follow notifications: serve-time remap in `enrichNotifications` (stored links untouched) → `/athletes/:actorId` only when actor reachable. Other notification bodies deliberately have no nested name link (row already navigates).

## Scope boundaries (user-approved, don't "fix")
- Coach/admin club-dashboard's own renderers (Members table, dashboard challenge rankings, reports, training load) are EXCLUDED by plan — only its Feed tab + RSVP modal are wired. An architect review flagged this as a gap; it's a deliberate boundary.
- Directory (adc) cards keep modal→"View full profile"; profile Athletes tab uses `onCardClick` → nav.
- Kudos who-liked lists / comment-author UIs don't exist (counts only).

## Guard
- `scripts/verify-athlete-links.js` — 27 seeded payload checks (flags, opted-out false, notif remap, wiring served). Its cleanup must delete follows/notifications/achievements/profiles rows before auth users — the follow POSTs mint side-effect rows that leave residue otherwise.
