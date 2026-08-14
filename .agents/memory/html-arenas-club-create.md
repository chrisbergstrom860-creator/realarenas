---
name: html-arenas logged-in club creation
description: Shared club-create contract layer + in-app modal, dual-mode /for-clubs wizard, POST /api/clubs/create, email pre-check, login `next` param — invariants and accepted risks.
---

# Logged-in club creation path

## Shared contract layer + in-app modal (arenas-club-create.js)
- TWO surfaces create clubs for logged-in users: the in-app modal (sidebar "+ Create club" on all 9 shell pages) and the /for-clubs wizard. BOTH must go through `window.ArenasClubCreate` (validateClub, deriveHandle, filterInvites, submit). Never fork validation, handle derivation, invite filtering, request body, or error-code→message mapping per surface.
- **Why:** the surfaces drifted before extraction; single-sourcing is the whole point of the module. If the API contract changes, change `submit()` once.
- `submit()` returns `{ok,redirect}` or `{ok:false,target:'club'|'review',msg}` — targets are SEMANTIC step names; each surface maps them onto its own step ids (/for-clubs: club→2, review→5). handle_taken/invalid_handle/invalid_name/invalid_sport → 'club'; club_limit (with `d.limit` fallback 3) and everything else → 'review'.
- The modal only sends fields the API persists (name/handle/sport/city + invites) — desc/country were deliberately dropped in-app. "Creating as" line is /for-clubs-only (in-app you're already in your own shell).
- Modal invariants: `ccm-` prefix on ALL ids/classes; `<style>` injected on first `open()` only; review step renders user text via `textContent` only; sports from injected `window.ARENAS_SPORTS`; bottom sheet ≤768px; hrefs built at runtime must use `window.BASE + '/...'` (the pages' BASE href-rewrite pass runs before the modal DOM exists).
- Shell-page entry: `create.onclick` guards `window.ArenasClubCreate` and falls back to `nav('/for-clubs?create=1')` — keep the guard. Asymmetry: arenas-for-clubs.html hard-depends on the script (no guard) — logged-out wizard throws if it 404s; accepted (same-origin, dual-routed like other shared scripts).

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

## Directory-listing choice in wizard step 3 (shipped)
- `clubs.visibility` controls DIRECTORY LISTING ONLY (request-and-approve joining; never content or open joining) — keep all copy on those words, both surfaces (dashboard settings card + wizard) must stay in the same vocabulary.
- Wizard step 3 = radio pair with NO preselected default; launch blocked with inline error until chosen. User-mandated: force a decision, never a skipped default.
- `submit(club, invites, visibility)` includes the field ONLY on a valid explicit value; two-arg callers (/for-clubs wizard) omit it → server omits column → DB default 'private'. Never coerce.
- `open()` resets the radios + review error each session — a stale choice from an abandoned session must not carry into a new club (architect-caught; also the payload coercion).
- POST /api/clubs/create validates 'public'|'private' when present (400 invalid_visibility), inserts the column only when provided.
