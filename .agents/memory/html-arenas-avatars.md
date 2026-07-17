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
- **Missed-surface bug class (found twice post-rollout):** a converted renderer calling `avatarHtml(x.avatar_url…)` silently shows initials forever if the route builds its people payload ad hoc (e.g. inline getUserById loop) and omits avatar_url. When debugging "photo user shows initials": check the PAYLOAD first, the renderer second. Fixed instances: /profile followingList/followerList; club-dashboard Training-load + Overview recent-activity had the opposite miss (payload fine, renderer initials-only); billing/calendar sidebar-footer lacked the `sf-av` class the identity script targets (it fills only `[onclick*="userMenu"]` + `.sf-av` — new sidebar footers must carry `sf-av` + `overflow:hidden`).
- Deliberately-initials surfaces (OK to leave): club-invite pending/history rows — email-bound, no user_id linkage; email→user lookup would need a paged listUsers scan (non-additive, enumeration-shaped). Dead `initialsOf` helper defs remain in club-dashboard/challenges/leaderboards/club-member with zero call sites (rollout leftovers, harmless).
- Club logos flow via getSidebarClubs (sidebar/dropdown/profile Clubs tab) + per-route selects (dashboard, club-member, JOIN_DATA club.logo_url).

## JK retirement convention (repo is grep-clean of "JK")
- Viewer-identity placeholders → `·` (filled by identity script); fictional marketing personas (landing/blog) → single `J`. Never reintroduce initials placeholders that scripts match by textContent.

## Verification harness lesson
- Temp self-login route for screenshots must live under `/landing/...` (screenshot tool prepends previewPath `/html/landing`); signInWithPassword + setSession + redirect works. REMOVE the route after — it's an unauthenticated login-as-user hole.

## Profile photo modal (my-profile hero)
- The edit-profile modal is RETIRED — all profile field editing lives only in the Settings tab. The hero avatar (+ always-visible-on-mobile 📷 overlay) opens `#modal-avatar-photo`, a photo-only modal that kept every `ep-*` element ID so the upload script and hydration code needed zero changes.
- **How to apply:** when moving UI blocks between containers, preserve element IDs so ID-wired scripts survive untouched; don't reintroduce an "Edit profile" entry point — Settings is the single edit surface.
- Hero club area = `.hero-clubs` wrapping pill row rendering ALL of `data.clubs` (clubTileHtml tile + name; admin/coach→dashboard, else member page — same routing as sidebar My clubs). The /profile route's single-`membership` payload key was removed with it.
