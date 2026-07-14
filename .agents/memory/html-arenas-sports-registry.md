---
name: html-arenas sports registry
description: The SSOT SPORTS registry in sports.js — how sport data flows to server + all pages, and the rules for touching sport-shaped code.
---

# html-arenas sports registry (SSOT — shipped July 2026)

`artifacts/html-arenas/sports.js` is the single source of truth for the 8 sports
(running, cycling, climbing, swimming, football, hiking, weightlifting, yoga).
Per sport: `id`, `label`, `emoji`, `colors {bg,text,border}`, `scoring {per,rate}`,
`isDistance`, `fieldsConfig`. Everything sport-shaped derives from it.

**Rule: add/change a sport in sports.js ONLY.** Never reintroduce a hand-written
sport map in a page or the server.

## How it flows

- Server: `SPORT_POINTS`, `KNOWN_SPORTS`, `DISTANCE_SPORTS`, `SPORT_ICONS` are
  derived exports of sports.js; equivalence-pinned by `sports.test.js` (run
  `pnpm --filter @workspace/html-arenas test` after any registry change).
- Client: server injects `window.ARENAS_SPORTS`, `ARENAS_SPORT_ICONS`
  (registry + `LEGACY_SPORT_EMOJI`, e.g. triathlon 🔱), `ARENAS_SPORTS_BY_ID`,
  and `arenasSportTag()` into every app-shell page before `</head>` (inside
  AVATAR_HELPERS_SCRIPT), so parse-time inline scripts can rely on them.
- All shell-page sport maps/pickers derive from these globals. Curated filter
  subsets (feed pills, leaderboard tabs, club-dashboard pill rows, challenges
  discover filter) keep a local id-array of WHICH sports appear but render
  emoji/label from the registry — expanding a subset is a product decision
  (Session ② scope), not a drift fix.
- Local accent palettes that are NOT registry data (challenges PROGRESS_COLORS,
  leaderboards CHALLENGE_ACCENTS bg/bar) stay local by design; only icons/labels
  derive from the registry there.

## Sharp edges

- Marketing pages (landing-login, for-clubs) get NO script injection. for-clubs
  pickers (club-sport select + admin-sports chips) are server-rendered via regex
  replace in the `/for-clubs` route. Landing's 20-sport ticker and visual-only
  onboarding chips (toggleSport only toggles a class) are deliberate marketing
  breadth — leave them.
- arenas-challenges.html: the club-challenge modal is built inside a JS template
  literal (`buildCreateModal`) — NEVER nest a `<script>` tag in it (`</script>`
  terminates the outer script tag in the browser); use `${...}` interpolation.
- Unknown/legacy stored sport values must keep graceful fallback rendering
  (`arenasSportTag` → legacy icon + TitleCase, or plain TitleCase; tiles fall
  back 🏟/🏅). No data migration for drifted stored values.
- `calculatePoints`: unknown sport → flat 20/session; km-sport without distance
  → rate×2 (behavior predates the registry, preserved).
- Profile sports: edit-profile chips render from the registry and save via
  `/api/profile/update` (validated against KNOWN_SPORTS, dedup, cap 8);
  consumed from `user_metadata.sports` by leaderboards/athletes/challenges.
- Landing stat tile hard-codes "8 Sports supported" — must change with any
  sport expansion.
