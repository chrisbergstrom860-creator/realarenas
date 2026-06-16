---
name: html-arenas shared shell CSS
description: Where the app-shell styles live, how they're served, and gotchas for editing them.
---

- The app-shell chrome (topbar, sidebar, nav, logo, shell `:root` tokens) lives in `artifacts/html-arenas/html/arenas.css`, linked by the 9 app-shell pages: feed, my-profile, events, challenges, leaderboards, athletes, notifications, club-dashboard, club-member. Blog and other public/marketing pages are intentionally excluded.
- **Edit shell styles in arenas.css, not per page.** Each page's inline `<style>` now holds only page-specific rules plus a few intentional divergences (challenges/leaderboards body 15px; per-page `.topbar-search`/`.notif-btn`; my-profile `.user-av` animation).
- arenas.css loads BEFORE each page's inline `<style>`, so page rules still win on equal specificity. **Validate shell refactors with an effective-cascade diff vs git HEAD, not a textual diff** (compare computed declarations of arenas.css + remaining inline against the original inline).
- Served by a public (no-auth) route in server.js: `GET ['/html/arenas.css','/arenas.css']`. Dual path is required: Replit serves under BASE=`/html` (head script leaves `/html` hrefs alone) while Railway serves at root BASE=`''` (head script strips `/html`). On Replit, `curl /arenas.css` hits the OTHER `arenas` artifact via the shared proxy — expected, not a bug; use `/html/arenas.css` there.

**Gotcha:** challenges and leaderboards each carry their ORIGINAL top-nav design block PLUS an appended sidebar-shell block, so shell selectors (e.g. `.topbar`) appear twice and some are preceded by section comments. Any CSS-rewriting/dedup tool must strip comments before matching selectors, or it silently misses the commented duplicate.

**Why:** STEP 1 of mobile responsiveness was a pure extraction into one shell stylesheet so later steps can add responsive rules in a single place. Future shell or responsive edits belong in arenas.css.
