---
name: In-artifact API routes must be BASE-prefixed (proxy path ownership)
description: Why html-arenas API routes live under /html/api and not /api, to avoid the separate api-server artifact.
---

The shared reverse proxy routes by path, most-specific-first, using each
artifact's `.replit-artifact/artifact.toml` `paths`.

- `html-arenas` owns `["/html/", "/html"]` (BASE_PATH=`/html`).
- A SEPARATE `api-server` artifact owns the bare `["/api"]`.

**Consequence:** if html-arenas' frontend fetches `/api/posts...`, the proxy
sends it to the OTHER api-server, not to html-arenas. To keep an in-artifact
API inside html-arenas, mount Express routes at `BASE + '/api/...'` (e.g.
`/html/api/posts`) and have the browser fetch `'/html/api/...'`. `/html/api/...`
is more specific than `/api`, so it correctly stays in html-arenas.

**Why:** path-based artifact routing means "/api" is a claimed namespace owned
by another deployable; bare-/api routes added here are unreachable.

**How to apply:** when adding any backend endpoint to a web artifact that also
has a sibling api artifact, prefix routes and client URLs with the artifact's
BASE path. Auth in html-arenas uses a signed cookie `sb_access_token` validated
via `supabase.auth.getUser(token)` (cookieParser uses SESSION_SECRET).
