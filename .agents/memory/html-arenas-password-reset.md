---
name: html-arenas password reset & email confirm
description: Server-side password-reset + email-confirmation auth flow (token_hash + verifyOtp, no browser supabase-js); per-endpoint OTP type whitelist is a security boundary.
---

# Server-side reset / confirm flow

html-arenas does password reset and email confirmation entirely server-side with `token_hash` + `supabase.auth.verifyOtp` — no `@supabase/supabase-js` in the browser. The OTP token is read from the URL into a form/route and verified only on the server.

## verifyOtp type mapping (installed @supabase/auth-js)
- Password **reset** link → `type: 'recovery'`
- Signup **confirmation** link → `type: 'signup'` (NOT `'email'`; `'email'` is magic-link OTP login, `'email_change'` is email change)
- `EmailOtpType` union: `'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email'`

## Policy split (user-approved)
- Reset: verifyOtp(recovery) → `supabaseAdmin.auth.admin.updateUserById(returnedUser.id, {password})` → redirect to login `?msg=reset_ok`. **Does NOT auto-login.**
- Confirm: verifyOtp(signup) → `setSession(res, data.session)` → `/feed`. **Auto-logs in.**
- Always use user.id/session from verifyOtp's RETURN value, never the shared client's in-memory session.

## Security rule (do not regress)
**Each endpoint must whitelist the OTP `type` it accepts.** `/auth/confirm` MUST reject any type other than `signup`.
**Why:** if `/auth/confirm` passes `req.query.type` straight to verifyOtp, a password-**recovery** token can be replayed at `/auth/confirm?type=recovery` to set a session and auto-login — bypassing the "reset does not auto-login" policy. (Caught in code review.)
**How to apply:** confirm route guards `type==='signup'` then hardcodes `verifyOtp({type:'signup'})`; reset route hardcodes `type:'recovery'`.

## Other constraints
- Forgot-password POST is enumeration-safe: always redirect `/landing?msg=reset_sent` regardless of whether the email exists (swallow Supabase errors). Missing email → `/forgot-password?error=missing`.
- Weak-password (<8) bounce re-puts `token_hash` in the URL BEFORE verifyOtp consumes it, so retry works. Once verifyOtp runs the token is single-use/consumed (no retry after that).
- Banner codes (`?msg=reset_sent|reset_ok|confirm_failed`) must exist in BOTH the server redirects AND the landing-page `?msg=` IIFE — same dual-wiring rule as the `?error=` banner.

## Dashboard dependency (Supabase, shared dev+prod project)
- Email templates use `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery|signup`. `{{ .RedirectTo }}` comes from the `redirectTo`/`emailRedirectTo` passed in code (`publicBaseUrl(req)+'/reset-password'` and `+'/auth/confirm'`), so one template serves both dev (`/html/...`) and prod (root) base paths.
- Redirect URLs allowlist must include the reset + confirm URLs for both dev and prod.
- Set `PUBLIC_BASE_URL` in prod so publicBaseUrl doesn't trust a poisoned Host header when building email links.
