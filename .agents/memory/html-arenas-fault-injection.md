---
name: html-arenas fault-injection verification
description: How to prove supabase write-failure paths actually fire — local proxy pattern; must-block audit closure state.
---

# Fault-injection proxy pattern

To prove an error path fires (the project has been bitten by fixes that were never seen firing): run a second server instance with `PORT=<free> BASE_PATH='' SUPABASE_URL=http://127.0.0.1:<proxyPort>` pointing at a tiny local http proxy that forwards everything to the real `SUPABASE_URL` but returns 500 for rule-matched requests (`{method, pathPrefix}` like `DELETE /rest/v1/post_likes`, `PATCH /rest/v1/club_invites`, `DELETE /storage/v1/object/avatars`). supabase-js surfaces the 500 as a returned `{error}` — exactly the shape being tested. Rules changeable at runtime via a `POST /__rules` control endpoint.

**Traps:**
- `spawnSync` blocks the event loop, so an in-process proxy never answers — always use async `spawn` when the proxy lives in the harness process.
- Strip `host`/`content-length` on forward and `content-encoding`/`transfer-encoding`/`content-length` on response (Node fetch auto-decompresses).
- Seed NOT NULLs: `events.location`, `challenges.goal_unit`, `notifications.title/body`.

# Must-block audit closure (all fixed + proven by injection)

- unlike toggles (post/activity), challenge leave, all three RSVP writes (checked BEFORE notification fan-out), invite accepted-marking in both `/auth/join/:token` flows, sweep club-logo storage remove (now via checkErr → an injected failure produces `DELETE FAILED` + non-clean verdict).
- Invite rollback order (architect-reviewed): membership rollback FIRST; only delete the just-created auth user if it succeeded — deleting the user regardless orphans the membership, the exact half-state the rollback prevents. Double-failure injection proves user+membership survive and invite stays pending for remediation.
- **Why:** supabase-js returns errors instead of throwing; try/catch alone silently swallows failed writes.
- Still open (user will scope separately): the should-log sites (creator auto-join/auto-RSVP inserts, grandfather invite upsert, signup/club-create compensation deletes, plan-link update) and the verify-script cleanup/seed sites.
