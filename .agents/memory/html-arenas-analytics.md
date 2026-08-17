---
name: html-arenas Plausible analytics
description: ONE res.send/res.sendFile injection middleware, client hostname gate, arenasTrack flush helper, server-confirmed custom events; rules for new pages/events.
---

# Plausible analytics (pa-HP_G3pZi3T9xQ23D1nWTb.js)

**Injection rule:** the snippet is injected by ONE middleware in server.js that wraps `res.send` (any string body with `</head>`) and `res.sendFile` (`.html` paths → read+inject+`origSend`). NEVER paste the snippet into individual html files — new pages get it automatically. There is deliberately NO content-based duplicate guard (**Why:** user text containing the script URL could otherwise suppress injection); single-injection is structural, so the sendFile override must call `origSend`, not the wrapped `res.send`.

**Dev/prod gating is CLIENT-SIDE by hostname** (`/(^|\.)realarenas\.com$/`), not a server env gate. **Why:** an env-var gate could silently kill production analytics on a config slip; the hostname check can't, and dev/verifier traffic (`*.replit.dev`, localhost) never loads the script. In dev `window.plausible` is a no-op and `arenasTrack(name,done)` calls done() synchronously.

**arenasTrack(name, done?):** shared helper in the snippet — fires `plausible(name,{callback})` with a once-guard + 400ms setTimeout fallback. ALWAYS use it (never raw `plausible()`), and pass a callback when the success handler navigates away, or the event is lost.

**Custom events — fire ONLY on server-confirmed outcomes** (intent-firing = fabrication):
- Signup Completed: signed one-time cookie (`setSignupMarker`, set only by /auth/signup + /auth/confirm success) consumed by /feed render → injects `window.ARENAS_SIGNUP_COMPLETED = true`. A `?signup=1` param does nothing (rejected as spoofable).
- Club Creation Started: wizard/modal open (intent by explicit spec).
- Club Created: awaited inside shared ArenasClubCreate.submit success (covers both surfaces).
- First Activity Logged: server-computed `is_first` (head-count after insert; racy undercount accepted — drops, never fabricates; atomic RPC judged not worth it).
- Club Join Requested / Approved: 200+success branches (approve fires from the admin's browser).
- Pro Checkout Started: only when server returned the Stripe url, `kind==='pro'` only (club checkout deliberately untracked).
- Dashboard-side goal names must be added manually in Plausible (Settings → Goals → Custom event); with pa-*.js format `plausible('Name')` needs no init option.

**Verifiers:** `scripts/verify-analytics.js` (exactly-once on all 25 pages incl. sneaky-content regression, gate assertions, marker spoof test, is_first truth) — battery is now 40 scripts; `scripts/shot-analytics.js` (browser proof both directions; simulates www.realarenas.com via route interception with plausible.io STUBBED — never send a real hit from a test). Bump sw.js VERSION when the snippet changes (public pages are SW-cached).
