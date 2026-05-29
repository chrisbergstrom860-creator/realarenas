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
- Do all multi-row provisioning through a `SECURITY DEFINER` Postgres function called via `userClient.rpc(...)`, not via multiple client-side `.insert()` calls.
  - **Why:** (1) atomicity — two separate inserts can leave partial state; (2) security — a client-side `memberships` insert policy of just `user_id = auth.uid()` lets any authenticated user insert themselves as admin into ANY club_id (broken access control / role escalation). The definer function hardcodes the role and derives club_id internally.
- Keep client-facing RLS to SELECT-only (owner-or-member for clubs, self for memberships). Do NOT add permissive client INSERT policies; route writes through definer functions instead.
- The clubs SELECT policy may subquery memberships safely (no recursion) as long as the memberships SELECT policy only references `auth.uid()` and never references clubs.
