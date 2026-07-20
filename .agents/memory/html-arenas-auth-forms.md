---
name: html-arenas auth form conventions
description: Gotchas wiring the landing/login page's signup & login forms to the Express auth routes.
---

# html-arenas auth forms (arenas-landing-login.html)

## Prototype stubs faked navigation instead of submitting
`handleSignup()` / `handleLogin()` originally just did `nav('/feed')` — pure client-side
redirects that never POST. That made signup silently bounce: `/feed` has no session
cookie, so `requirePageAuth` redirects back to `/landing` **with no `?error=` param**.
**Lesson:** if a form-backed action lands on `/landing` with no error param, the form
never submitted — look for a stub handler, not a server bug. Real submit must call
`form.requestSubmit()` (triggers native validation + the submit event).

## First + last name are combined client-side into one `name` field
The signup form has separate `name` (first) and `lastName` inputs. A `submit` listener
combines them into a single hidden `input[name="name"]` and strips the original `name`
attributes (guarded by `form._nameCombined` so it runs once). Server `/auth/signup`
reads `req.body.name` with a fallback to first+last / email local-part.
**Why:** Supabase user_metadata stores one `name`; the rest of the app reads that.

## Disabled <button> never fires click → can't show a toast
Social (Strava/Google) buttons are OAuth-not-wired. Do NOT set `btn.disabled = true`
if you also want an onclick toast — disabled buttons swallow click events. Use
`aria-disabled="true"` + opacity styling + `onclick` that `preventDefault()`s and calls
`showToast(...)`. The landing page has no `#toast` element, so its `showToast` is
self-contained (creates the element on first call).

## Existing-email signup = enumeration-safe honest pattern
With confirmations ON, Supabase signUp on an EXISTING confirmed email returns an
obfuscated user with an EMPTY `identities` array, sends nothing, and the person waits
forever for a confirmation. Detection is `data.user.identities.length === 0`. The route
keeps the redirect byte-identical to a fresh signup (`?error=confirm_email` → "check
your inbox") but fires `buildExistingEmailSignupEmail` (log-in / reset links) via the
shared Resend sender, NOT awaited (so timing stays flat and a failed send can't break
signup). Existing UNCONFIRMED emails still get Supabase's own re-sent confirmation
(identities non-empty → falls through). Club wizard is separately covered by the
inline `/auth/email-check` step gate (deliberately explicit — documented accepted risk).
Known: fresh-vs-existing response timing differs (~0.9s, Supabase's own send dominates)
— accepted at prototype scale; `/auth/email-check` is the bigger oracle anyway.

## Auth error codes the banner understands
`/auth/signup` redirects use: `missing_fields`, `signup_failed`, `confirm_email`.
`/auth/login` uses `invalid`. The `?error=` banner maps these to messages and opens the
signup vs login tab accordingly. Add new codes to BOTH the server redirect and the
banner's `msgs` map or they show a generic fallback.
**Note:** `confirm_email` (no session returned from signUp) means Supabase email
confirmation is enabled — the likely root cause if signup succeeds but login won't stick.
