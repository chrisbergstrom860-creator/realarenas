---
name: html-arenas /how-points-work page
description: Public scoring explainer — registry-rendered at request time, entry-link surfaces, verify script, and the honesty fixes it forced.
---

# /how-points-work — public scoring explainer

Public content route (no auth, alongside /about /terms /privacy). Serves
`html/arenas-how-points-work.html` with `<!--SPORT_ROWS-->` and `{{TOKEN}}`
placeholders replaced AT REQUEST TIME from the sports registry (`sports.js`):
the full sport table AND every worked-example number derive from
`SPORTS`/`SPORT_POINTS`. **Never hand-write a rate or example total on this
page** — if scoring changes, the page must change by itself.

**Why:** the page publicly promises "no hidden multipliers" and "this table is
exactly what the leaderboards use"; hand-written numbers would rot.

**How to apply:** any scoring change → run
`node artifacts/html-arenas/scripts/verify-points-page.js` (live server needed;
asserts table==registry row-for-row, example math matches calculatePoints
single-round-at-end semantics, links present, /leaderboards still gates).

## The page's claims forced code changes (kept true elsewhere)
- Points are unit-aware (`calculatePoints` → `parseDistanceKmUnitAware`).
- `getDateRange('week')` = Monday 00:00 viewer tz; `'month'` = calendar month;
  at-risk checks moved to `'rolling7'`. See leaderboards/timezones topics.
- Leaderboards subtitle fixed (was falsely "updated every Monday at midnight").
- Effort-parity sentence ("climbing ≈ 5 km run") is asserted by the verify
  script — if rates change so that breaks, reword the page copy.

## Entry links
`.hpw-link` class ("ⓘ How points work"), same CSS on all three app pages:
leaderboards page header, challenges header-stats strip + the challenges
right-rail "Points breakdown" card (that per-sport card lives on CHALLENGES,
not profile), and the profile Overview "This week" card (JS template — uses
`window.BASE + '/how-points-work'` because the head BASE-strip script only
rewrites static hrefs at DOMContentLoaded). Footer link ("How points work",
beside Privacy) on landing-login, blog, about, terms, privacy, for-clubs and
the page itself.
