---
name: html-arenas post delete
description: Author-only post delete — cascade order, zero-leak 404 contract, shared delete fragment, and the filtered-delete-returns-success audit results.
---

# Post delete (Task #60)

- **Author only** — posts have no `club_id`, so there is no club context giving a manager authority (matches the activity rule, NOT the event `canManageEvent` rule). No edit path exists — user chose option A (delete-and-repost); do not add `edited_at` or an edit route without new direction.
- **Cascade order (required rows, then best-effort object):** post_likes → post_comments → notifications (`entity_id = postId`, `type in ('like','comment')`) → post row → `deletePostImageObject` best-effort. **Why:** row-before-object means a storage failure can never block the delete; notifications are a *required* cascade — check the returned `{error}` (supabase-js does not throw) and 500 before deleting the post if it fails. Architect caught a try/catch-only version that silently skipped it.
- **Zero-leak 404:** fetch the row first; non-author and nonexistent ids answer byte-identically (`404 {error:'Post not found'}`). The activity delete route was converted to the same shape — the old filtered-delete (`.eq(id).eq(user_id)`) returned `{success:true}` to a non-author because zero rows matched.
- **Remaining filtered-delete-returns-success routes (reported, deliberately NOT fixed):** unfollow (idempotent by design), notification dismiss (self-scoped, idempotent), club member removal (admin-gated; removing a non-member reports success). All invite revokes, plans, club invites already fetch first.
- **ONE shared client fragment** in `arenas-post-image.js`: `postDeleteButtonHtml(post, viewerId, {pushRight})` + `window.deletePost` — consumed by main feed `postCardHtml`, club dashboard Feed tab post/announcement branches, and club member-home coach announcements. Card roots carry `data-post-root`; on the main feed the handler removes the enclosing `.feed-item-wrap`. `pushRight` exists because some heads already have a right-aligned badge/tag at `margin-left:auto`.
- Payload additions to make the button/copy work: club feed + member-home now carry `viewerId`, `userId`, `likeCount`, `commentCount` — the field-dropping-remap trap from post images applies here too.
- Confirm copy is dynamic: names photo/kudos/comments only when present; bare post gets the short form.
