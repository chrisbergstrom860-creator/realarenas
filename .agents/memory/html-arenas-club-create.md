---
name: html-arenas logged-in club creation
description: Dual-mode /for-clubs wizard, POST /api/clubs/create, email pre-check, login `next` param — invariants and accepted risks.
---

# Logged-in club creation path

## Rules
- `/for-clubs` is session-aware: server injects `window.ARENAS_SESSION = {name,email}|null` before `</head>` (escape `<` as `\u003c`). Logged-in visitors get a shortened wizard; logged-out flow is untouched.
- The wizard is ONE state machine driven by `WIZARD_STEPS` (`[2,3,4,5]` when logged in, `[1..5]` when not). All chrome (bar, dots, counters, eyebrows) derives from `stepPos(id)` — never hardcode step numbers when touching the wizard.
- **Why:** one code path for both modes; hardcoded "Step N of 5" text broke silently before renumbering was centralized. Eyebrow text is CSS-uppercased — assert case-insensitively in tests.
- Logged-in launch calls `POST /api/clubs/create` (requireAuth, JSON): registry sport validation, handle `/^[a-z0-9]{2,20}$/`, 3-owned-clubs cap (403 `club_limit`), handle dedupe (409 `handle_taken`), club+admin membership with compensating club delete, best-effort invites. Client maps `handle_taken`→club step inline error, `club_limit`→review step.
- Identity fork is dead: `/auth/signup-club` 302s logged-in users to `/for-clubs?create=1`. Never resurrect a second-account path.
- `?create=1` on /for-clubs auto-opens the wizard — sidebar "+ Create club" (appended last in the shared My-clubs IIFE on all 9 shell pages, incl. zero-clubs case) and the post-login return both rely on it.
- Login form supports a `next` hidden field; server honors it only when it matches same-app relative path (`BASE + '/'`, rejects `//`, `://`, `\`). Any new "return after login" flow should reuse this, not invent another mechanism.

## Accepted risks (disclose before real launch)
- `/auth/email-check` is an unauthenticated account-enumeration oracle with no rate limit, and scans the full paged auth user list per call. Fine at prototype scale only.
- Handle dedupe in `/api/clubs/create` is a TOCTOU pre-check; true safety needs a DB unique constraint on `clubs.handle` (unconfirmed).
