---
name: html-arenas sticky filter bar offset
description: Why sticky bars inside .main must use top:0, not top:56px, on app-shell pages
---

# Sticky bar offset inside `.main`

On app-shell pages, a sticky sub-header (e.g. `.filter-zone`) that lives inside `.main`
must use `position:sticky; top:0` — NOT `top:56px` (the topbar height).

**Why:** `.main` has `overflow:hidden`, which makes it the sticky *containing scrollport*.
`.main` sits in the app grid's 2nd row, already below the 56px sticky topbar, and it never
scrolls itself (real scrolling is in the inner `.athletes-col{overflow-y:auto}`). So a
`top:56px` offset is measured relative to `.main`'s top (already at viewport y56) and
double-counts the topbar: the bar is shoved 56px down, its vacated static slot shows as a
gray gap, and the bar paints over the first row of content (hiding the first card's header).
Measured filter-zone top was 112 (56 topbar + 56 shift); `top:0` restored it to 56.

**How to apply:** For any sticky element that is a child of an `overflow:hidden` `.main`
(not the viewport), use `top:0`. Only use `top:<topbar-height>` when the sticky element's
scroll container is the viewport/body. The sticky is effectively inert here anyway (the
container can't scroll), so `top:0` is purely about removing the resting offset.
This latent bug was masked while removed chrome (rec-strip/sport-tabs) occupied the
overlapped zone; it only surfaced once the grid became the first child.
