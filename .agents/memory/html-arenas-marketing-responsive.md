---
name: html-arenas marketing/auth pages — mobile responsive selectors
description: Real CSS class names + gotchas when adding @media blocks to the self-contained marketing/auth HTML pages (arenas-landing-login.html, arenas-for-clubs.html)
---

The marketing/auth pages (`arenas-landing-login.html`, `arenas-for-clubs.html`) are fully self-contained: no `arenas.css` link, each has its own `:root` tokens + single inline `<style>`, only external link is Google Fonts. Responsive work = ONE `@media (max-width:768px)` block appended at the end of that page's own `<style>` (before `</style>`). A fix in one page does NOT affect the other — class names overlap by convention but values diverge per file.

**Verify selectors against the file before writing the block — several "obvious" names are wrong:**
- Hero grid container is **`.split-hero`** (grid 1fr 1fr), NOT `.hero`. `.hero` does not exist as the grid; using it is a silent no-op. (`.hero-left`, `.hero-right`, `.hero-h1` DO exist.)
- Features grid is **`.features-grid`**; `.features-inner` is only a max-width wrapper (no columns).
- Testimonials grid is **`.testimonials`** (no `-grid`/`-inner` suffix).
- For-clubs teaser grid is **`.for-clubs-inner`** (NOT `.for-clubs-teaser`/`.teaser-inner`).
- Pricing grid is **`.pricing-grid`** (`.pricing-inner` is max-width only). Amount = `.pricing-amount`.
- Steps "how it works" grid is **`.steps-grid`**; the horizontal connector line is a pseudo-element **`.steps-grid::before`** — hide it with `display:none`, there is no `.steps-connector`/`.step-connector` element.
- Auth dark branding panel is **`.auth-left`** (has `.auth-left::before` glow); form wrap is `.auth-form-wrap`; side-by-side name fields use `.form-row` (grid 1fr 1fr).

**Gotchas:**
- `.topbar-inner` has fixed `height:56px`. Adding `flex-wrap:wrap` alone makes wrapped rows overflow and overlap the hero — must also set `height:auto` in the @media block.
- Hiding `.auth-left` on mobile is safe for the login page: the form has its own "Welcome back" heading + Log in/Sign up toggle, and the same "Every sport / One community" tagline already appears in the hero above (combined landing+login page).
- Verify served output via `curl localhost:80/html/landing` (static `sendFile`, no restart needed). Screenshot hash anchors (`/#features`, `/#pricing`, `/#for-clubs`) undershoot ~1 section due to smooth-scroll + sticky topbar; `/#login` lands exactly on the form (it's near max scroll).
- landing-login "Live feed preview" cards (`.p-card` flex rows) are NOT grids, so the generic block misses them; fixed with their own wrap rule (`.p-card{flex-wrap:wrap;row-gap}`, `.p-info{flex:1 1 calc(100% - 52px)}`, `.p-stats{flex-wrap:wrap}`, `.ai-badge{margin-left:auto}`) so text wraps + the "AI analysed" badge stops clipping at 375px.

**arenas-for-clubs.html specifics (all confirmed):**
- Hero grid is **`.hero-inner`** `grid-template-columns:1fr 440px` — the FIXED 440px col is the horizontal-scroll culprit; collapse to `1fr`. `.hero` already has `overflow:hidden`, so the 600×600 `.hero-glow` is already clipped (shrinking it is just defensive, not the real fix).
- `.nav` is **`position:fixed`** `height:60px`. To wrap: `.nav{height:auto;flex-wrap:wrap}` AND `.nav-links{width:100%;margin-left:0;flex-wrap:wrap;justify-content:center}` so links wrap centered below the logo. Hero `padding-top:~132px` clears the taller wrapped nav.
- `.stats-bar` is a flex row (no `-inner`) → `flex-wrap:wrap`. `.hp-stat-row` is `repeat(4)` → use `repeat(2,1fr)` (2×2), not single col.
- Content grids: `.features-grid`, `.testimonials-grid`, `.pricing-grid` (all `repeat(3)`); amount `.price-amount` 36px; `.cta-title` 40px; `.section-title` 38px; `.hero-title` 52px.
- Signup modal `#signup-overlay`/`.signup-modal` (max-width:760px width:100%, fits 375px). Inner grids `.form-row`/`.integration-grid` (1fr 1fr) + `.plan-cards` (repeat(3)) → 1fr. TWO grids are INLINE-styled (how-it-works split + step-6 review) so no class targets them — collapse via attribute selector `[style*="grid-template-columns:1fr 1fr"]{grid-template-columns:1fr!important}`.

**Public content pages — arenas-about.html (/about) & arenas-terms.html (/terms):**
- Both are self-contained pages modeled on for-clubs tokens/nav/footer with a white content area (`.content{background:#fff}`), served raw via `sendFile` from public BASE-prefixed routes in server.js (beside `/for-clubs`, no auth). Both carry the dual-base head script (strips `/html` on Railway), so hardcoded `/html/...` hrefs are correct on both bases.
- about = "story" layout: hero + 3 `.story` sections (`.story-num` + `.story-title`) + dark `.cta-band`. terms = "legal" layout: hero + `.prose.legal` with `.legal-section` dividers, `.legal-title` headings, bold `<strong>` list lead-ins, mono `.doc-meta` "Last updated" line; NO cta-band (a legal doc shouldn't push a signup CTA). Reuse the legal CSS pattern for future Privacy page.
- **Cross-page auth-link gotcha:** landing only deep-links **`#login`** (top-script handler opens the auth panel). There is NO `#signup` handler — linking to `/landing#signup` silently just lands on landing with no panel. So every marketing page's Log in / Sign up / primary CTA must point at **`/html/landing#login`** (the auth panel has its own login/signup toggle).
- **Footer wiring still pending:** Terms/Privacy/Contact footer links across pages are `href="#"` stubs (and landing's "About" still has the old `onclick="scrollToSection('features')"` scroll bug). Deferred to a single dedicated footer-wiring pass.

**Two cross-cutting gotchas (cost real time):**
- The html-arenas artifact `previewPath` is **`/html/landing`** (the landing page), NOT `/html`. So `app_preview` screenshots of for-clubs must use `path:'/../for-clubs'` (resolves `/html/landing/../for-clubs` → `/html/for-clubs`). A bare `path:'/for-clubs'` 404s as `/html/landing/for-clubs`.
- `runTest` (Playwright) DEFAULTS TO THE WRONG APP: it went to the React `arenas` artifact's `/login?mode=signup` (`artifacts/arenas/src/pages/Login.tsx`) instead of the static `/html/for-clubs`. Must give strict guardrails: pin `path:/html/for-clubs`, state the modal is an in-page overlay (URL never changes), and forbid `/login`/`?mode=signup`/React routes.
