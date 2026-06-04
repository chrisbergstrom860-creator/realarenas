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

## Auth error codes the banner understands
`/auth/signup` redirects use: `missing_fields`, `signup_failed`, `confirm_email`.
`/auth/login` uses `invalid`. The `?error=` banner maps these to messages and opens the
signup vs login tab accordingly. Add new codes to BOTH the server redirect and the
banner's `msgs` map or they show a generic fallback.
**Note:** `confirm_email` (no session returned from signUp) means Supabase email
confirmation is enabled — the likely root cause if signup succeeds but login won't stick.
