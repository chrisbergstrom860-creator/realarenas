---
name: html-arenas contact form
description: /contact page + POST /api/contact — inbox secrecy, rate limiter, trust proxy, spawned-server test pattern
---

- `/contact` follows the sendMarketingPage pattern but has its OWN route (needs the session email injected for prefill). The injected value is `\u003c`-escaped JSON — keep that on any future inline-script injection (script-context XSS).
- `CONTACT_INBOX` (env, shared) is server-side only; it must NEVER appear in served HTML/JS, API bodies, or error strings. verify-contact-form.js greps for it in every response.
- **Why trust proxy = 1:** exactly one reverse-proxy hop in every deployment (Replit artifact router dev, Railway edge prod); without it `req.ip` is the proxy socket and the per-IP limiter (5/10min, in-memory Map, `CONTACT_RATE_MAX` test hook) buckets ALL users together. Trusting more hops would let clients spoof X-Forwarded-For.
- Route order: honeypot (silent success-shaped discard, nothing stored) → rate limit → validation (reject, never truncate) → insert row (`contact_messages`, user-created SQL table, in sweep USER_REFS) → send via sendEmail (now supports `replyTo` → Resend `reply_to`) → update send_status (`sent`/`failed`/`failed_config`). Missing key/inbox = 500 after persisting — never false success (sendEmail returns ok:false when skipped; callers must check).
- **How to test env-off / fresh-limiter paths:** spawn a second `node server.js` with `PORT` + `BASE_PATH='/html'` and modified env (strip RESEND_API_KEY, set CONTACT_RATE_MAX). BASE_PATH is required or every route 404s.
- No published support address may reappear anywhere (support@realarenas.com mailbox does not exist); legal/marketing pages link `/html/contact`. sw.js: /contact is NEVER_CACHED (per-requester chrome + prefill).
