---
name: html-arenas visual verification of auth-gated pages
description: How to screenshot auth-gated html-arenas widgets, and the screenshot-tool previewPath quirk
---

- App-shell pages (events, dashboard, profile, clubs…) are auth-gated and redirect 302 to landing when unauthed, so the screenshot tool cannot capture the real authed widget without a Supabase login. (Auth is Supabase, not Clerk — the testing skill's Clerk override does not apply.)
- To visually verify a widget's rendering, build a self-contained harness HTML: link `/html/arenas.css` for base vars (`--gray-*`, `--green`, `--border`, `--mono`, `--radius-lg` live there, NOT in the page), copy the page's own `<style>` rules for the widget, paste the render fns verbatim, add mock data covering every state. Serve it via a TEMPORARY unauthed `app.get(..., sendFile)` route, screenshot desktop + mobile, then remove the route + file + restart so the tree is clean before push.

**screenshot-tool previewPath quirk**
- For `app_preview`, the tool resolves `localhost:80{previewPath}{path}`, and this artifact's previewPath is `/html/landing` (NOT `/html`). So `path:'/foo'` becomes `/html/landing/foo`.
- **How to apply:** to screenshot a route mounted at `/html/foo`, add a `/html/landing/foo` alias to the temp route (or otherwise make the composed URL land on your handler). A bare `/html/foo` path will 404 through the tool.

**Reduced-motion e2e via testing subagent**
- A `matchMedia('(prefers-reduced-motion: reduce)')` guard evaluated once at script load can only be tested if Playwright emulation is set at CONTEXT CREATION (`newContext({ reducedMotion: 'reduce' })`). Telling the tester to "emulate reduced motion" without this yields a false failure: emulation lands after scripts ran, the animation plays, and the snapshot catches a mid-flight value.
- **How to apply:** spell out "set reducedMotion:'reduce' at context creation, before navigation; do NOT use page.emulateMedia after load" in the test plan. Same reasoning: full-page screenshots may catch count-up animations mid-value ("11" of 12) — that's proof the animation runs, not a bug.

**Full-page harness variant (better than copy-paste harness for whole tabs)**
- Instead of copying widget CSS/fns into a standalone file, add a temp unauthed route `BASE+'/landing/__preview/<name>'` that serves the REAL page file through the real `injectArenasData` + `injectBottomNav` pipeline with fixture data, then appends a `<script>` before `</body>` that (1) monkey-patches `window.fetch` for the page's API URL to return fixture JSON (query param like `?ms=0` toggles empty states) and (2) on DOMContentLoaded calls `setTab('<tab>', el)` to open the target tab. Expected: 401 console noise from the notifications poll — harmless.
- Remove the route + `node --check server.js` + restart before push so `git status` shows only the intended files.
- E2E tester wanders into root React app: any /html test plan must say 'two apps on this domain; every URL must start with /html; /landing or /member-dashboard means wrong app'.
