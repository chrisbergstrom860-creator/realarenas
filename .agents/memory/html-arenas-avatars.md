---
name: html-arenas custom profile pictures — investigation mapping
description: Pre-build mapping for avatar photos (free feature, initials fallback) — rendering surfaces, data path, storage posture, pipeline decisions. Investigated 2026-07-12, before any code.
---

# Custom profile pictures — investigation (no code yet)

## Rendering reality
- NO shared avatar component. ~15 per-page CSS circle classes (`.user-av`, `.ac-av`, `.fi-av`, `.fc-av`, `.hero-av`, `.lb-av`, `.podium-avatar`, `.yb-avatar`, `.member-av`, `.ch-lb-av`, `.fr-av`, `.av-sm`, `.composer-av`, `.pn-av` + inline 36px circles in feed) across 9+ pages; 8+ local copies of the same initials(name) split/map/slice helper; server.js also computes initials server-side in 2 API responses (~lines 3699, 3776).
- Topbar/sidebar avatars are static "JK" placeholders in each page's HTML, rewritten client-side by matching `textContent === 'JK'` on `.user-initials, .user-av` — a photo change breaks this pattern (img has no textContent).
- NOT avatar surfaces: shared notifications panel (type icons only), events page (topbar only), landing marketing previews (hardcoded fake initials, cosmetic).
- Rollout idea: ship a shared `avatarHtml(url, name)` helper via server injection (same pattern as AVATAR_MENU_SCRIPT / injectNotificationsPanel), then convert each render site; img with onerror → initials div fallback.

## Data path decision
- Store `avatar_url` in auth **user_metadata** (the editable source of truth; profiles table has an avatar_url column but is UNUSED/stale — do not fork the source of truth).
- Server touchpoints to carry avatar_url: `displayFromUser`, `buildUserProfileMap`, `buildUserDisplayMap`, feed author profileMap (~line 1030), athletes listUsers blocks (~3699/3776), ARENAS_DATA.profile injection. One added field each propagates to every surface's data.

## Storage posture (verified live)
- Storage is 100% unused today: `listBuckets()` = []. Bucket creation works via service role (`storage.createBucket` is a Storage API call, NOT SQL DDL — the no-DDL constraint doesn't apply).
- Decision: PUBLIC bucket `avatars`, public URLs, all writes server-mediated via service role (clients never touch Storage; no RLS policies needed for this posture).

## Pipeline decisions
- client → Express → Storage (no signed-upload URLs). Multipart POST /api/profile/avatar: multer memoryStorage 5MB cap → sharp decode = real validation (jpeg/png/webp allowlist) → re-encode 256×256 cover webp (strips EXIF/GPS by default) → upload `avatars/{userId}/{timestamp}.webp` → delete previous object → write public URL to user_metadata. Plus DELETE endpoint (back to initials).
- Versioned filename IS the cache-buster: Supabase public URLs are CDN+browser cached (default cacheControl 3600); overwriting a fixed path would serve stale for an hour+. New URL per upload = instant propagation; never reuse a path.
- New deps: multer + sharp (sharp is native — verify install in this env at build time).

## UI surface
- No file inputs exist anywhere in the app yet. Home: "Edit profile" modal in arenas-my-profile.html (~line 701, hero ✏️ button) — current-avatar preview + Upload/Remove; upload immediately on file select (separate endpoint), don't multipart-ify the existing JSON /api/profile/update form.

## Build plan
- Two sessions confirmed: ① storage+pipeline+metadata+modal UI+own avatar (topbar/hero); ② rollout to all surfaces + server helper fields + shared injected helper. Surface count (~15 classes, 9+ pages) is the cost driver.

## Club logos (investigated 2026-07-12, same read-only pass)
- Club marks are NOT initials circles — they are rounded-SQUARE sport-emoji tiles (sportIcons[c.sport] || '🏟', radius 5–12px). Rendering rollout = img-in-rounded-square with emoji fallback.
- Surfaces: sidebar "My clubs" IIFE (7 athlete pages, .nav-icon emoji), server-injected "Clubs you manage" dropdown (MANAGED_CLUBS_MENU_SCRIPT ~628), dashboard sidebar-footer .club-icon (HARDCODED 🏃 — never rewritten, already wrong for non-running clubs), club-member topbar .tc-icon + sidebar .club-sb-icon (both hardcoded 🏃) + client-rendered 46px hero tile (dynamic), profile Clubs tab renderer. NOT surfaces: feed (posts have no club_id), leaderboards/challenges/events (text labels), club-invite (brand logo + user avatars), marketing pages. Explorer-agent claim that profile .fc-av is a club list was WRONG — that's the Following tab (user avatars).
- **clubs table has NO logo_url — adding it is DDL = user-run SQL in the Supabase dashboard** (service role can't ALTER TABLE; same precedent as activities/achievements).
- Club data path: getSidebarClubs (~3586) is the only shared club resolver (selects id,name,handle,sport → ARENAS_DATA.clubs feeding sidebar + dropdown + profile Clubs tab) — add logo_url there; plus per-route selects: club-member route (id,name,handle,sport,city), dashboard route's own club fetch, join page (would want logo), challenges/events (text-only, skip). No batch club resolver exists (clubs fetched per-route).
- Upload authz: POST /api/clubs/:clubId/logo = `getClubRole` + `isClubManagerRole` → 403, UNCONDITIONAL (never inside PLAN_GATES_ENABLED/requireProPlan — codified challenges lesson, server.js ~3236). ~12 existing management routes model the exact shape.
- No club settings/edit UI or club-update route exists ANYWHERE (dashboard has no settings tab; unknown hashes fall to Overview). Logo upload = new modal off the dashboard sidebar-footer identity block + brand-new route.
- Storage: ONE `avatars` bucket, path namespacing `users/{id}/{ts}.webp` + `clubs/{clubId}/{ts}.webp` (not two buckets — identical public-read/server-write posture, single setup, prefix separation sufficient since all writes are server-mediated). Pipeline identical to users: 5MB → sharp allowlist decode → 256×256 webp (EXIF stripped) → versioned filename → delete old → URL to clubs.logo_url.
