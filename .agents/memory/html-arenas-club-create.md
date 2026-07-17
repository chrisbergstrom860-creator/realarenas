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
- Duplicate handles are DB-enforced: unique index `clubs_handle_unique` on `lower(handle)` is LIVE in Supabase. Both create paths map Postgres 23505 to the friendly error — API → 409 `handle_taken`; signup → account rollback then 302 `/for-clubs?error=handle_taken`. The API pre-check is `ilike` (case-insensitive, safe: handle regex-gated first). Never let a club-insert 23505 fall through to a 500/generic error.
- `/for-clubs` reads `?error=` on load: opens the wizard and shows a persistent banner on `err-{WIZARD_STEPS[0]}` (`handle_taken` gets a specific message). The logged-out form-POST path relies on this — wizard state is lost across the redirect, so the banner lands on the first visible step by design.
- Identity fork is dead: `/auth/signup-club` 302s logged-in users to `/for-clubs?create=1`. Never resurrect a second-account path.
- `?create=1` on /for-clubs auto-opens the wizard — sidebar "+ Create club" (appended last in the shared My-clubs IIFE on all 9 shell pages, incl. zero-clubs case) and the post-login return both rely on it.
- Login form supports a `next` hidden field; server honors it only when it matches same-app relative path (`BASE + '/'`, rejects `//`, `://`, `\`). Any new "return after login" flow should reuse this, not invent another mechanism.

## Accepted risks (disclose before real launch)
- `/auth/email-check` is an unauthenticated account-enumeration oracle with no rate limit, and scans the full paged auth user list per call. Fine at prototype scale only.
- `/auth/signup-club` does no server-side handle format validation (client lowercases; a direct form POST can store an arbitrary-case handle — uniqueness still holds via the index). Cheap parity fix: apply the same regex+lowercase there.
