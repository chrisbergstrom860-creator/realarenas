---
name: html-arenas brand mark & favicons
description: The Arenas brand mark asset pipeline (SVG master, PWA icons, favicon.ico, topbar imgs) and the brand-vs-content 🏟 emoji rule.
---

# Brand mark — single source of truth

`html/arenas-icon.svg` (512 viewBox, yellow #FFD21E rounded square rx=110 + dark #111827 stadium-track glyph) is THE mark. Everything derives from it:
- **PWA icons** — `scripts/generate-icons.js` (sharp, builds its SVG string inline) → `html/icons/` (192/512/maskable/apple-touch).
- **favicon.ico** — `scripts/generate-favicon.js` reads the SVG file → PNG-packed ICO (16/32/48, ~2KB). PNG-in-ICO is fine for all modern browsers.
- **Topbar/footer marks app-wide** — `<img src="/html/arenas-icon.svg">`; the old emoji-box CSS defs (yellow bg+radius+flex+font) became plain img boxes (width/height/display:block) because the SVG carries the square itself.
- **Favicons on every page** — `<link rel="icon" href="/html/favicon.ico" sizes="48x48">` + `<link rel="icon" href="/html/arenas-icon.svg" type="image/svg+xml">` after the theme-color meta. **New pages need these two links** (in addition to the PWA head block).
- Served via dual-path routes `['/html/...', '/...']` in server.js next to the PWA icon routes (so hardcoded `/html/` src/href work on both Replit and Railway; the head helper only rewrites href, dual mounts cover `<img src>`).

**Why:** one asset = topbar, favicon, and installed-app icon can never drift; vector = crisp at retina.

## Traps
- **No `--` inside SVG/XML comments** — librsvg (sharp) hard-rejects the file, and the file is now browser-loaded directly. Writing "--yellow" var names in comments broke favicon generation once. Spell tokens as "brand yellow" etc.
- **Brand vs content 🏟**: only BRAND marks were converted. Content 🏟 stays emoji forever: `sportIcons[...] || '🏟'` club-tile fallbacks (all pages + server.js clubTileHtml), hero eyebrows on marketing pages, landing feature icon, club-dashboard logo-upload preview, `joined_club` achievement icon. An e2e check exists: seeded club with unknown sport must show emoji, not the mark.
- Offline page (`arenas-offline.html`) inlines the glyph SVG deliberately — zero network dependency; don't convert it to `<img>`.
- Transactional emails keep the "🏆 Arenas" text lockup (server.js Resend templates): most email clients block/proxy remote images and strip SVG, so an embedded mark would render broken at first open. Revisit with a hosted PNG + alt only if email brand fidelity becomes a priority.
- sw.js needed no change for these assets (network-first runtime cache, no precache list) — no VERSION bump required when only adding statically-routed assets.
- `public/favicon.svg` + root `index.html` are dev-scaffold only (not served by server.js); favicon.svg now mirrors the mark.

**How to apply:** changing the mark = edit `html/arenas-icon.svg`, run both generator scripts, done — every surface updates. Never re-introduce emoji/div brand marks; never repoint a brand surface at a second asset.
