---
name: html-arenas /how-points-work page + in-app modal
description: Public scoring explainer — registry-rendered at request time, in-app modal fragment, per-requester chrome, verify script.
---

# /how-points-work — public scoring explainer + in-app modal

Public route (never blocks). ONE renderer `renderHowPointsHtml()` in server.js
substitutes `<!--SPORT_ROWS-->` + `{{TOKEN}}`s from the sports registry AT
REQUEST TIME. **Never hand-write a rate or example total** — scoring changes
must propagate by themselves.

## Two surfaces, one renderer (2026-07)
- Full page: chrome per requester — `getOptionalUser` swaps the marked
  marketing nav (`<!--HPW_NAV_START/END-->`) for an app nav ("Back to app")
  when a valid session cookie is present. Page stays public.
- `?fragment=1`: slices `/*HPW_CSS_START/END*/` + `<!--HPW_CONTENT_START/END-->`
  out of the SAME rendered HTML for the in-app modal. Missing markers = 500;
  the verify script asserts marker presence.
- **Because the page is now per-requester, it was REMOVED from sw.js
  PUBLIC_PAGES** (VERSION v2→v3). Never re-add it while chrome varies by session.

## In-app modal (`html/arenas-hpw-modal.js`, shared, dual serve route)
Loaded via static `<script src="/html/arenas-hpw-modal.js" defer>` on
leaderboards/challenges/my-profile — works on Railway root because the serve
route registers BOTH `/html/...` and `/...` paths (panel-JS pattern).
Delegated click handler intercepts only root-relative
`/(html/)?how-points-work` links (skips modified clicks, `data-hpw-full`).
Manage-invites overlay chrome + Escape, backdrop, ✕, body scroll lock, focus
restore to trigger, loading + error state (error links to full page).
**No history manipulation — same as the notifications panel; back always
navigates.** Marketing-page footers keep navigating (no script there).

**How to verify:** `node scripts/verify-points-page.js` (live server; asserts
table==registry, fragment==page table byte-identical, markers, chrome split,
links). Authed chrome swap needs a session — covered by e2e, not the guard.

## The page's claims forced code changes (kept true elsewhere)
- Points are unit-aware (`calculatePoints` → `parseDistanceKmUnitAware`).
- `getDateRange('week')` = Monday 00:00 viewer tz; at-risk on `'rolling7'`.
- Effort-parity sentence ("climbing ≈ 5 km run") asserted by the verify script.

## Entry links
`.hpw-link` ("ⓘ How points work"): leaderboards header, challenges header
strip + right-rail Points-breakdown card, profile Overview "This week" card
(JS template, `window.BASE`). All now open the modal. Footer link on
landing-login, blog, about, terms, privacy, for-clubs and the page itself —
these navigate (public chrome).
