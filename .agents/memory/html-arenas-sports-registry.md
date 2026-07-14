---
name: html-arenas sport list sprawl
description: Where the 8-sport list lives (canonical + ~25 client copies), what validates sport values, and the safe path to add sports.
---

# Sport list reality (investigated July 2026, pre-expansion)

**Canonical (server.js):** `SPORT_POINTS` (~line 1530) is the de-facto registry — running per-km×10, cycling per-km×6, climbing 50 / swimming 40 / football 30 / weightlifting 30 / hiking 20 / yoga 20 per session. `KNOWN_SPORTS = Object.keys(SPORT_POINTS)` and `DISTANCE_SPORTS = [running,cycling,swimming,hiking]` derive from/beside it. Server also injects `window.ARENAS_SPORT_ICONS` (9 keys incl. triathlon) via the avatar-helpers script — the proven injection pattern for a future shared registry.

**Rules that matter:**
- `calculatePoints`: unknown sport → flat 20/session (nothing breaks); km-sport without distance → rate×2.
- Validation exists ONLY on goals (`KNOWN_SPORTS` + `DISTANCE_SPORTS`). Activity/post/event/challenge/club creates all accept free-text sport.
- Adding a sport server-side = add one `SPORT_POINTS` entry; everything else already tolerates it. Adding per-session sports never touches `DISTANCE_SPORTS`.

**Client copies (~25) that must be edited by hand until an SSOT exists:** sportIcons/sportColors/sportBgs/sportEmojis maps in my-profile (×~8 incl. goals' client copy of KNOWN/DISTANCE_SPORTS + SPORT_META), club-dashboard (×~8, some drifted with basketball/tennis/gym/rowing/triathlon), feed (SPORT_COLORS/EMOJIS only 4 sports; filter pills + composer chips only 3), leaderboards (tabs only run/cycle/climb; icons 8-key), athletes (6-key, missing weights/hiking/yoga), club-member, billing, challenges, events.html create-select (9 opts incl. Triathlon), for-clubs signup select (capitalized labels incl. Tennis/Surfing/Multi-sport → club.sport stored Capitalized, breaking lowercase icon lookups → 🏟 fallback).

**Dead/trap UI:** edit-profile "Your sports" chips are not wired — `/api/profile/update` only handles name/handle/location/bio; `meta.sports` has NO write path anywhere (seed-only). Feed hero-tags SPORTS map (4-key) and postcard tag degrade gracefully for unknown sports.

**Marketing:** landing stat tile hard-codes "8 Sports supported" — must change with any expansion. All other copy says "every sport" (safe).

**Why:** any sport expansion done by editing only the server list will silently leave ~25 UI maps stale (missing icons/colors, invisible filter options).
**How to apply:** when expanding sports, either touch every list above or first build a server-injected registry (like ARENAS_SPORT_ICONS) and derive the client maps from it.
