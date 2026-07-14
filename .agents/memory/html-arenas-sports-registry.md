---
name: html-arenas sports registry
description: The SSOT SPORTS registry in sports.js — how sport data flows to server + all pages, and the rules for touching sport-shaped code.
---

# html-arenas sports registry (SSOT — shipped July 2026)

`artifacts/html-arenas/sports.js` is the single source of truth for the 12 sports
(running, cycling, climbing, swimming, football, hiking, weightlifting, yoga,
golf, pickleball, basketball, hockey). Per sport: `id`, `label`, `emoji`,
`colors {bg,text,border}`, `scoring {per,rate}`, `isDistance`, `fieldsConfig`.
Everything sport-shaped derives from it. New-sport points are argued against the
existing session-sport spread (comment block in sports.js): hockey 40 = swimming,
basketball 35, golf 30 = hiking, pickleball 25.

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
- All shell-page sport maps/pickers derive from these globals. Feed filter
  pills + composer chips render the VIEWER'S OWN `user_metadata.sports`
  (injected as `ARENAS_DATA.sports` by the /feed route, unknown ids filtered
  out) and fall back to the historic curated sets when the user picked none.
  Leaderboard tabs, club-dashboard pill rows, and the challenges discover
  filter still keep curated local id-arrays but render emoji/label from the
  registry — expanding those is a product decision, not a drift fix.
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
  `/api/profile/update` (validated against KNOWN_SPORTS, dedup, cap =
  KNOWN_SPORTS.length so it auto-scales with the registry); consumed from
  `user_metadata.sports` by leaderboards/athletes/challenges and the feed.
- Landing stat tile hard-codes the sport count ("12 Sports supported") — must
  change with any sport expansion.
- Golf is the only new sport with its own columns (`golf_strokes` int 1–300
  server-validated, `golf_course` text ≤120) — deliberately distinct from
  swimming's `stroke` column/`sf-stroke` input. Pickleball/basketball/hockey
  form panels reuse EXISTING columns only (`session_type`, `avg_hr`) — adding
  a per-sport column requires user-run SQL (no DDL via service role).
- AI insights: sport-specific branches exist for the original 8 + golf; other
  sports hit the generic "Activity logged. Keep up…" fallback by design.
