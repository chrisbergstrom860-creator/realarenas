---
name: html-arenas avatars & club logos — final architecture
description: Photo avatars + club logos end-state - storage pipeline, shared rendering helpers, payload conventions, JK retirement. Both sessions shipped 2026-07-14.
---

# Avatars & club logos — shipped end-state

## Storage & upload pipeline (Session ①)
- ONE public `avatars` bucket (idempotent createBucket at startup — safe to leave in), path namespacing `users/{id}/{ts}.webp` + `clubs/{clubId}/{ts}.webp`. All writes server-mediated via service role; clients never touch Storage.
- Shared processAndStoreAvatar: multer memoryStorage 5MB (field name `avatar` for both endpoints) → sharp decode allowlist (jpeg/png/webp) → 256×256 cover webp (EXIF stripped) → versioned filename (the cache-buster — never reuse a path, Supabase CDN caches ~1h) → delete old object.
- Endpoints: POST/DELETE `/api/profile/avatar` (self) and `/api/clubs/:clubId/logo` (getClubRole+isClubManagerRole, UNCONDITIONAL — never behind plan gates). Per-subject in-flight lock Set → 429, released in `finally`.
- Source of truth: `avatar_url` in auth **user_metadata** (profiles table stays unused); `clubs.logo_url` (user-ran the ALTER TABLE — DDL is user-run SQL, service role can't).
- `updateUserById(..., { user_metadata: { avatar_url: null } })` REMOVES the key — falsy checks everywhere.
- **Why:** versioned filenames beat fixed paths (stale CDN), metadata beats profiles table (don't fork source of truth).
- Known non-blocking edge: pipeline deletes old object BEFORE pointer write; reorder to write-pointer→delete-old when next touching these routes.
- Railway risk: sharp+multer are native/CJS deps in artifact package.json; Railway must rebuild sharp for linux — watch first deploy.

## Rendering helpers (Session ②)
- `injectAvatarHelpers` puts AVATAR_HELPERS_SCRIPT in `<head>` (so body inline scripts can call it): `window.avatarHtml(url,name,sizeClass,style)` + `clubTileHtml(url,sport,sizeClass,style)` + `.content(url,x)` inner-HTML variants for filling existing circles/tiles.
- Fallback pattern: escaped initials/emoji span ALWAYS rendered (hidden when url present) + `<img loading=lazy onerror="unhide previous sibling span; this.remove()">` — broken URLs degrade to initials at runtime. `object-fit:cover;border-radius:inherit` fits any circle or rounded-square tile. Everything interpolated goes through esc() (architect-verified no XSS).
- Injection chain: injectBottomNav→injectNotificationsPanel→injectAvatarHelpers+TOPBAR_IDENTITY_SCRIPT (at body end, wins over page IIFEs). Identity script reads ARENAS_DATA||INVITE_DATA and fills viewer topbar/menu avatars. Join page injects helpers only — its call sites must guard `window.clubTileHtml ?`.
- **How to apply:** any new page served through injectBottomNav gets helpers for free; call avatarHtml/clubTileHtml, never hand-roll initials circles or `textContent==='JK'` rewrites.

## Payload convention
- Any payload/API carrying people MUST include the avatar field: `avatar_url` everywhere, EXCEPT `avatarUrl` in recent-activity + club feed items and `coachAvatarUrl` in member-home announcements (legacy camelCase — match the page, don't rename).
- Names AND avatars both come from auth user_metadata via displayFromUser/buildUserProfileMap/buildUserDisplayMap — one added field there propagates everywhere.
- Club logos flow via getSidebarClubs (sidebar/dropdown/profile Clubs tab) + per-route selects (dashboard, club-member, JOIN_DATA club.logo_url).

## JK retirement convention (repo is grep-clean of "JK")
- Viewer-identity placeholders → `·` (filled by identity script); fictional marketing personas (landing/blog) → single `J`. Never reintroduce initials placeholders that scripts match by textContent.

## Verification harness lesson
- Temp self-login route for screenshots must live under `/landing/...` (screenshot tool prepends previewPath `/html/landing`); signInWithPassword + setSession + redirect works. REMOVE the route after — it's an unauthenticated login-as-user hole.
