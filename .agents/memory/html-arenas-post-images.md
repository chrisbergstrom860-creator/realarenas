---
name: html-arenas post images
description: Feed composer photo uploads — avatar-model public bucket, atomic create, no-crop display rule, surfaces list.
---

# Post images (feed composer photo upload)

- **Storage = avatar model**: PUBLIC bucket `post-images`, path `posts/{userId}/{ts}.webp`, CDN `getPublicUrl` stored in `posts.image_url` (user-run DDL added the column). Public URL in payloads is fine; never a bare storage path.
- **No crop anywhere** (user rejected silent crop): sharp `.rotate()` (EXIF/GPS stripped on re-encode) + `resize(1440,1440,{fit:'inside',withoutEnlargement})` + WebP q82. Display: 700px cap `object-fit:cover` + explicit "⤢ Full image" pill shown ONLY when the cap actually trims (client natural-dimension check); tap = lightbox at natural aspect. At mobile widths a portrait often fits under the cap → no pill is correct.
- **Atomic create**: ONE route `POST /api/posts/create` serves JSON *and* multipart (multer skips non-multipart). Upload first, insert with image_url, rollback object on returned insert error AND on thrown exceptions (`inserted` flag in catch). Lock `post:{userId}` via avatarUploadsInFlight. Content-OR-image validation (image-only posts valid — renderers must guard empty content).
- **ONE shared fragment** `arenas-post-image.js` (`window.postImageHtml`) renders the image on ALL post surfaces: feed postCardHtml, club dashboard Feed tab (post + announcement branches), club member-home coach announcements. Each server data path must select/forward `image_url` — buildFeedPosts *enrichment map*, club feed collector, member-home announcements all had field-dropping remaps that needed explicit `image_url` additions.
- **Why one fragment:** post cards are rendered in 3+ bespoke places; forked image markup would drift (same lesson as stat tiles / activity-card body).
- SW: cache-first versioned rule for `/storage/v1/object/public/post-images/`, own cache name, VERSION bumped (v7). Account-delete sweep: paged `fetchAllRows` for posts (>1000-post safety) then best-effort per-post object delete, rows-first.
- Deliberate loose end (reported, not built): posts have NO visibility control; legacy unscoped `GET /api/posts` is dead code.
