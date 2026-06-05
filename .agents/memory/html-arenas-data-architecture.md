---
name: html-arenas data architecture
description: Where app data lives and how the server writes it for the html-arenas Supabase prototype
---

# html-arenas data architecture

- **Single source of truth = Supabase.** User accounts AND app data (clubs, memberships) live in the Supabase project, not in Replit's built-in Postgres. `DATABASE_URL`/`PG*` env vars point at Replit "Helium" Postgres — that is NOT the Supabase DB and must not be used for this artifact's data.
- **No service-role key / no Supabase DB connection string is available.** The server only has the anon key. It therefore cannot run DDL or bypass RLS. Schema changes must be applied by the user in the Supabase SQL editor.
- **Auth is auto-confirm ON** (`mailer_autoconfirm: true`), so `supabase.auth.signUp()` returns a session immediately. The server uses that session's access_token to build a per-request authenticated client so `auth.uid()` resolves for RLS / RPC.

**Why:** chosen by the user for a single source of truth; the constraints (anon-key-only) dictate the patterns below.

**How to apply — writing app data from the server:**
- A `SUPABASE_SERVICE_ROLE_KEY` is now configured. The server uses a module-level `supabaseAdmin` client (service role, `persistSession:false`) for trusted writes; it bypasses RLS. This key is server-only and must NEVER reach the browser.
- Club/membership provisioning is done with `supabaseAdmin` direct inserts (clubs then memberships) with a compensating `delete` of the club if the membership insert fails (best-effort atomicity without a DB transaction). `auth.uid()` is NULL under service role, so the old `create_club_with_admin` RPC (which relies on `auth.uid()`) is NOT used on this path — pass the user id explicitly instead.
- Account creation still uses the anon client's `supabase.auth.signUp()` (autoconfirm on → returns a session used for the login cookie). If `!data.session`, we can't log the user in, so we redirect to `?error=confirm`.
- Keep client-facing RLS SELECT-only (owner-or-member for clubs, self for memberships). Do NOT add permissive client INSERT policies; all writes go through `supabaseAdmin`.
- The clubs SELECT policy may subquery memberships safely (no recursion) as long as the memberships SELECT policy only references `auth.uid()` and never references clubs.
- The `create_club_with_admin` SECURITY DEFINER function still exists in the DB (created earlier) but is unused by the current service-role write path; harmless to leave.
- **User directories (e.g. the Athletes page) are built from `supabaseAdmin.auth.admin.listUsers()`, not a table** — there is no usable `profiles` row to query. Only `name`/`handle`/`bio`/`location` exist (in `user_metadata`); `sports`/`level` are NOT persisted anywhere because the signup sport-picker is a prototype stub, so any sport-filter / level UI will be empty until those are actually saved.
