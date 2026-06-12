---
name: html-arenas achievements tab
description: Real badge system on the athlete profile — how badges are computed, awarded, and degrade before the new table exists.
---

# html-arenas Achievements tab (badge system)

Profile "Achievements" tab backed by a real, server-computed badge system.
`BADGES` is a static array (24 badges, 6 categories) of `{ id, cat, icon, name,
desc, check(stats), progress(stats)->[current,target], unit? }`.

## New `achievements` table is user-created via SQL
Like `activities`, the `achievements` table is created out of band by the user
running SQL (service role can NOT do DDL). Dev and prod share the **same**
Supabase, so it doesn't exist until the user runs it.
Shape: `id uuid pk, user_id uuid -> auth.users, badge_id text, earned_at
timestamptz default now(), unique(user_id, badge_id)` + RLS with permissive
select/insert policies.

**How to apply:** Everything must degrade gracefully BEFORE the table exists:
- `checkAchievements(userId)` returns `[]` if the earned-rows select errors (so
  it never attempts inserts against a missing table).
- The GET `/api/profile/achievements` route still returns all badges with live
  progress (`earned:0`) when the table is unreadable — the tab works regardless.

## Stat computation gotchas
- **`activities` has no `created_at`.** Select only `sport, distance, duration,
  date`. The `early_bird` badge ("before 6am") reads the activity `date`, and
  only counts it when the string carries a real time component (`includes('T')`
  and length > 10) so date-only values don't false-trigger at midnight.
- **`challengesCompleted`** reuses `computeChallengeProgress(challenge, acts)`
  (which filters by sport internally) over activities pre-filtered to the
  challenge's date range; joined challenge rows are fetched via `.in('id', ids)`,
  NOT a PostgREST FK embed. Guard with `goal_target > 0`.
- Counts (followers/following/kudos/clubs/events-going) use Supabase
  `select('*', { count:'exact', head:true })` head counts.

## Awarding is idempotent + non-blocking
- Awards fire-and-forget from 6 action routes via
  `checkAchievements(req.user.id).catch(()=>{})` placed just before `res.json`:
  posts like, follow (POST), activities create, challenges join, events rsvp
  (**only** when `status==='going'`), clubs accept-invite. Never `await` them.
- The GET route also runs a check first so the tab is always current.
- `earnedIds` skip means a badge is inserted + notified **once** — re-checks on
  every tab open or action can't duplicate notifications.
- Unlock notification uses the single-object `createNotification({ userId,
  type:'achievement', title, body, link:'/profile' })` — there is NO
  `supabaseAdmin` first arg (a recurring spec mistake).

## Client
Client IIFE before `</body>` builds the panel into `#ach-body` from the JSON
(latest-unlock banner, per-category grids, earned vs locked-with-progress).
Badge names/descs are server constants (no user input) → no `esc()` needed.
Fetch is `window.BASE`-prefixed; wired to the `htab-achievements` click +
`#achievements` deep link (reloads each open so new badges surface). Also
overwrites the stale hardcoded `.tab-count` ("18") with the real `earnedCount`.
