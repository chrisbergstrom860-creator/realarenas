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
- Known remaining rough spot (not a grid, so the standard block misses it): the "Live feed preview" cards (`.preview-*`) are flex mini-rows that stay horizontal at 375px → hard text wrap + clipped "AI analysed" badge. Needs its own stacking rule if desired.
