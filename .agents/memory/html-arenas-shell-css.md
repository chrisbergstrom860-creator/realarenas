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

## Mobile responsiveness (STEP 2): server-injected bottom nav
- The mobile bottom nav is **injected server-side** by `injectBottomNav(html, pageKey)` (replaces `</body>`), not present in the static HTML. It must be applied on EVERY app-shell page route's data path AND its catch/fallback path, or the no-service-role / error states render without a nav. `bottomNavFor()` routes `club-dashboard`/`club-member` → a `setTab`-based club nav (`cbnTab`), everything else → the `nav()`-based athlete nav. `injectBottomNav` is idempotent (skips if `class="bottom-nav"` already present).
- All responsive rules are gated on `body:has(.bottom-nav)` at `@media (max-width:768px)` — the injected nav is the single signal that mobile chrome is active, so the desktop shell only collapses when the nav exists. Page-specific mobile tweaks (hero stacking, tab-strip horizontal scroll, topbar truncation, `.table-scroll` wrappers) live in each page's inline `<style>` under that same gate; shared grid/chip collapses live in arenas.css.
- The broad attribute selectors in arenas.css (`[style*="repeat(4"]`, `[style*="1fr 1fr"]`) collapse inline-grid KPI rows at mobile width — they will also catch any FUTURE inline two-column widget; prefer real utility classes for new layouts to avoid accidental collapse.
