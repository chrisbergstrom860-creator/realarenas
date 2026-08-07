---
name: html-arenas delete honesty
description: Convention for delete routes — success must mean a row was actually deleted
---

Delete routes must never report `{success:true}` when zero rows matched.

**The rule:** For simple deletes (notification dismiss, member removal), use a single conditional `delete().eq(...).select('id')` — keep the owner/scope predicate at the write boundary and treat an empty returned array as 404. This is race-free; a separate fetch-then-delete gets rejected in review because a concurrent delete produces phantom success. Fetch-first remains correct only when the row is needed for cascades/cleanup (post/activity deletes with images and child rows).

**Zero-leak:** where existence must not leak (owner-scoped resources), nonexistent and someone-else's rows return byte-identical 404 bodies. Unfollow stays idempotent-success by design — don't "fix" it.

**How to apply:** any new DELETE route: conditional delete + `.select()` + empty→404; verify with a live script (see scripts/verify-delete-honesty.js pattern).
