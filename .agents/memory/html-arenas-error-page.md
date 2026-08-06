---
name: html-arenas honest error page
description: sendPageError replaces all raw-prototype-HTML fallbacks on authed pages; SW pass-through contract via X-Arenas-App-Error.
---

**Rule:** Authenticated page routes must NEVER fall back to sending a raw file from `html/` without data injection. On `!supabaseAdmin` or a route `catch`, call `sendPageError(res)` — a 503 with a self-contained branded error page (`PAGE_ERROR_HTML`), headers `Cache-Control: no-store`, `Retry-After: 30`, `X-Arenas-App-Error: 1`, retry link built from `BASE`.

**Why:** The old `servePlain()` fallbacks served the prototype files verbatim to signed-in users — placeholder personas ("Jamie King", "Hackney Running Club"/"Rachel", "Priya") became visible on any Supabase outage or thrown error, and `/clubs/invite` showed the fake club console to ANY non-manager in normal operation. Fabrication path removed Aug 2026.

**How to apply:**
- New authed page routes: error/unconfigured branches → `sendPageError(res)`; never `res.send(fs.readFileSync(...))` without injection.
- Access-denied branches (non-member/non-manager) → `res.redirect(BASE + '/feed')` (precedent: /clubs/member, /clubs/invite).
- Service worker contract: sw.js treats 502/503/504 **without** `X-Arenas-App-Error` as gateway failure (offline fallback); a marked 503 passes through and renders. Keep the header if you ever change sendPageError, and bump SW VERSION when touching sw.js.
