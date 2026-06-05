---
name: html-arenas activity logging
description: Manual training-log feature — table prerequisite, author resolution, and the read-authorization rule for activity endpoints.
---

# html-arenas manual activity logging

Athletes log training sessions manually in the profile Activities tab; they
surface in followers' feeds via server-side injection.

## Table prerequisite (blocker pattern)
- The `activities` Supabase table must be created by the user in the SQL editor.
  The service-role key (supabase-js) **cannot run DDL**, so the app cannot
  self-provision it. Until the table exists, all activity routes return
  `{ error }` and the UI degrades gracefully (empty state / inline error).
  **Always tell the user to run the CREATE TABLE + RLS SQL.**

## Author display (same rule as posts/notifications)
- No `profiles` table. Activity author `{name, handle}` is resolved from auth
  `user_metadata` via `displayFromUser` / `getUserById`, one lookup per unique
  user — not a DB join. `enrichActivities()` does this; `buildFeedActivities()`
  mirrors `buildFeedPosts` follow logic and orders by `date`.

## Read authorization
- `GET /api/activities/:userId` is **self-only** (`req.params.userId ===
  req.user.id`, else 403). **Why:** the Activities tab only ever requests the
  viewer's own list, and followers see activities through the feed endpoint
  instead — so an unscoped service-role read was an IDOR (any logged-in user
  could read anyone's history by guessing a UUID).
  **How to apply:** if a public profile-by-id page is later added, broaden this
  to an explicit policy (self OR followed OR same-club coach) enforced
  server-side — do not just drop the check.

## Client conventions
- All rendered activity/user values are HTML-escaped (`escAct` in profile,
  `escFeedAct` in feed) before `innerHTML`. Fetches are `window.BASE`-prefixed.
  Delete keeps a `confirm()` (consistent with the app's other destructive
  actions). `/profile#activities` deep-links open the tab + entry form.
