---
name: Post like/comment visibility gate
description: canUserSeePost write gate for post likes/comments — predicate shape, zero-leak rule, and the one grandfathered like.
---
- **Rule:** post WRITE routes (like toggle, comment) gate on `canUserSeePost(userId, post)` = author ∥ (announcement → current membership in `post.club_id`) ∥ (personal → viewer follows author OR shares ≥1 current club). Deny = fetch-first **404 `{"error":"Post not found"}`** byte-identical to a missing id (same as post DELETE). The gate covers BOTH toggle directions — losing visibility loses unlike too.
- **Why:** like/comment previously wrote for any authed user holding a post id (private-club announcement escalation). The predicate is the exact UNION of the read surfaces (/feed = follows+self personal, member announcements; club feed additionally shows co-members' personal posts) — write matches read, never stricter/looser. Profile opt-out never filters posts on read, so it's deliberately absent.
- **How to apply:** any new post write path must reuse `canUserSeePost` (near canManagePost) and the zero-leak 404. Coverage: gate section in verify-club-post-attribution.js. Known grandfathered row (user chose to review, NOT deleted): foffe@gmail.com's like on chris@gmail.com's personal post `9bad98a5-…` fails the predicate; foffe can no longer unlike it via the app.
