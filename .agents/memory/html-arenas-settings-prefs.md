---
name: html-arenas settings prefs
description: Real Settings toggles — prefs in user_metadata.prefs, enforcement map, and where each pref is checked.
---

# Settings prefs (real toggles)

7 real prefs live in Supabase auth `user_metadata.prefs` (booleans; absent = true, resolved via `prefsFromMeta`):
`show_on_leaderboards`, `activity_feed_visible`, `notify_kudos` (like), `notify_comments` (comment), `notify_followers` (follow), `notify_challenges` (challenge), `notify_events` (event).

**Why this shape:** `updateUserById` merges top-level metadata but REPLACES nested objects — so `POST /api/profile/prefs` must read-merge-write the whole `prefs` object. Endpoint whitelists key + requires boolean value.

## Enforcement map (where each pref is checked)
- Notification prefs: gated inside `createNotification` via `NOTIF_PREF_BY_TYPE` (recipient lookup, **fail-open** on lookup error so notifs aren't lost to transient failures). Types `club` / `achievement` / `activity` have NO recipient toggle by design.
- `activity_feed_visible`: (1) `buildFeedActivities` filters followed authors; (2) the follower `activity` fan-out is gated **actor-side** at activity creation (the `activity` type has no recipient pref).
- `show_on_leaderboards`: platform/following/club leaderboard endpoints + `buildFeedSidebar` clubRank pool — **universal exclusion incl. the user's own view** (opted-out viewer gets no clubRank widget).

## Deliberate non-gates (don't "fix" these)
- Challenge leaderboards: joining a challenge = opting in to compete.
- Club-dashboard coach rankings: management surface, coaches need full rosters.
- Club feeds: club membership = opted-in sharing.

## Client (arenas-my-profile.html)
- Toggles carry `data-pref="<key>"`; flip = optimistic save via `prefToggle` (revert on error), subtle `.pref-saved` "Saved ✓"/error indicator in each card header; hydrated from `ARENAS_DATA.prefs`. No save button. Legacy `toggleIt` deleted.
- 4 former fake toggles (Public profile, Share GPS routes, Allow DMs, Weekly AI summary) were REMOVED, not hidden.

## Testing recipe gotchas (E2E with seeded users)
- `POST /api/clubs/create` requires `handle` matching `/^[a-z0-9]{2,20}$/` and returns `{redirect:"...?club=<id>"}`, NOT `{club:{id}}`.
- Parsing injected data from HTML: match `window\.ARENAS_DATA = (.*?);<\/script>` (no `</head>` anchor — more injected head scripts follow; `<` inside JSON is `\u003c`-escaped so the lazy match is safe).
- Challenge/event invites only notify invitees the creator FOLLOWS.
- Always clean up seeds — the Supabase DB is live user data.
