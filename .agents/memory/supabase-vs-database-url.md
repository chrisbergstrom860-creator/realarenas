---
name: Supabase vs DATABASE_URL (two separate databases)
description: Where the Arenas app's real data lives and which client to use; why DATABASE_URL/psql is the wrong DB.
---

The Arenas project has TWO unrelated Postgres databases. Do not confuse them.

- **Real app data** lives in the **Supabase** project, reached only through the
  `supabaseAdmin` (service-role) client in `artifacts/html-arenas/server.js`
  (env: `SUPABASE_URL`, service-role key). Tables present: `clubs`,
  `memberships`, `posts`, `post_likes`, `post_comments`.
- **`DATABASE_URL`** (host `helium`) is Replit's built-in Postgres — a
  DIFFERENT, EMPTY database. `psql $DATABASE_URL` / Drizzle against it will NOT
  see app data. Never use it to inspect or migrate app tables.

**Why:** the two were set up independently; the app was wired to Supabase REST,
not to the bundled Replit DB.

**How to apply:** to inspect/seed/migrate app tables, go through Supabase
(supabase-js with the service-role key, or the Supabase SQL editor). DDL cannot
be run from this repo — there is no Supabase DB password here, only the REST
service-role JWT, so create tables/constraints in the Supabase dashboard.

Schema gotchas verified against the live Supabase project:
- **No `profiles` table exists.** PostgREST embeds like
  `posts.select('*, profiles(...)')` fail (no FK, no table). Resolve author
  display name/handle from Supabase **auth user_metadata** via
  `supabaseAdmin.auth.admin.getUserById(user_id)` instead (fallback to email
  local-part, then 'Athlete'/'athlete').
- `post_likes` has **no `id` column** — composite PK `(post_id, user_id)`. Use
  `.select('post_id').maybeSingle()` for existence checks, not `.single()`.
- `post_likes`/`post_comments` DO have FKs to `posts.id`, so count embeds
  (`post_likes(count)`, `post_comments(count)`) work fine.
