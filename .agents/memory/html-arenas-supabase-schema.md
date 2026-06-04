---
name: html-arenas Supabase schema reality
description: Real Supabase schema for the Arenas HTML prototype and how display names are resolved — differs from common assumptions.
---

# Arenas (html-arenas) Supabase schema reality

The live Supabase schema for this project does NOT match the "obvious" assumptions
people write into snippets. Verified against the live DB.

- **No `profiles` table exists.** A user's display name/handle comes from Supabase
  **auth user_metadata** (`user_metadata.name`) with the email local-part as
  fallback. The posts API already does this; reuse the same `displayFromUser`
  helper rather than joining a `profiles` table.
- **`memberships`** columns: `id, user_id, club_id, role, created_at`. There is
  **no `status`** and **no `joined_at`** column. Order by `created_at`; treat every
  row as active (no active/inactive concept).
- **`clubs`** columns: `id, name, handle, sport, city, owner_id, created_at`.
  `sport` is a **single TEXT** value (not an array — don't index `sport[0]`).
  There is **no `plan`** column (the "Club Pro" badge is purely cosmetic).
- Other tables present: `posts (id,user_id,content,sport,feeling,created_at)`,
  `post_likes (post_id,user_id,created_at)`, `post_comments`.

**Why:** A user-provided spec assumed a `profiles` table, `memberships.status`/
`joined_at`, `clubs.plan`, and `sport` as an array — all of which would return
empty/throw against the real DB. Always verify the live schema before trusting
schema-shaped snippets.

**How to apply:** When wiring real data into html-arenas pages, resolve names via
`auth.admin.getUserById` + `user_metadata`, order memberships by `created_at`, and
don't reference non-existent `status`/`joined_at`/`plan` columns.

## Server-side page data injection pattern
Page routes read the HTML file, inject `<script>window.ARENAS_DATA = {...}</script>`
before `</head>` (escape `<` to `\u003c` to prevent `</script>` breakout), and a
client script rewrites `textContent` of classed elements (`.club-name`,
`.coach-name`, `.coach-initials`, `.member-count`, `.user-name`, `.user-initials`,
`.user-handle`). `supabaseAdmin` is null unless `SUPABASE_SERVICE_ROLE_KEY` is set
(set on Railway; also present in this dev env). Page routes use `requirePageAuth`
(redirects to `/landing`), NOT `requireAuth` (which returns JSON 401).
