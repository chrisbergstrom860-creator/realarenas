---
name: html-arenas Railway deploy + base-path
description: How the html-arenas Express prototype serves dual base paths and deploys to Railway from the pnpm monorepo
---

# html-arenas: dual base path + Railway deploy

## Base path
- `server.js`: `const BASE = (process.env.BASE_PATH || '').replace(/\/$/, '')`.
- On **Replit**, `artifact.toml` `[services.env]` sets `BASE_PATH=/html`, so routes serve under `/html` (proxy routes `/html`). On **Railway**, `BASE_PATH` is unset → routes serve at root `/`.
- **Why:** Replit preview is path-routed at `/html`; Railway custom domain (realarenas.com) serves at root.
- HTML files use a `<head>` helper: `window.BASE` (sniffs `/html` prefix from URL), `window.nav(path)`, and a DOMContentLoaded pass that strips `/html` from `[href]`/`[action]` when `BASE===''`. JS URL literals (`POSTS_API`, dynamic `form.action`) are built with `window.BASE`.

## Deploy topology (monorepo)
- App lives in `artifacts/html-arenas/`; repo root is the **pnpm workspace** (`package.json` name `workspace`).
- **Do NOT rename/replace the root `package.json`** (e.g. to "realarenas") — it breaks the pnpm workspace and every other artifact.
- `railway.json` at repo root: NIXPACKS, `buildCommand` is a no-op (avoids the heavy root `pnpm build` across all artifacts), `startCommand = node artifacts/html-arenas/server.js`. Nixpacks installs via pnpm (lockfile at root).
- Railway env vars required: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`. `PORT` is provided by Railway.

## Git / GitHub
- Only git remote in the repl is `gitsafe-backup` (Replit internal). Pushing to GitHub must go through Replit's Git pane (handles auth) — the agent cannot `git push` (no GitHub creds; sandbox blocks destructive git).
