---
name: html-arenas athlete directory (shared cards + profile tab)
description: Shared athlete-card module + eventing, profile Athletes tab, topbar-search completion — contracts and traps
---
- Shared renderer: `html/arenas-athlete-cards.js` (`window.ArenasAthleteCards.mount`) renders athlete cards for BOTH /athletes and the my-profile "Athletes" tab; server-side `buildAthleteDirectory()` feeds both (page inject + `GET /api/athletes/directory`, requireAuth). Never fork the card template per surface.
- Component CSS prefix is **adc-** in arenas.css. **Why:** the ac- prefix is TAKEN by stat-tiles, and ms-/.pill names collide with page-local CSS. **How to apply:** any new shared component needs a fresh prefix + a collision grep across html/*.html AND arenas.css first (substring beware: 'athlete-card' matches 'athlete-cards.js').
- Cross-surface follow sync: document CustomEvent `arenas:follow-change` {id, following, athlete, source}. Contract: dispatch once per confirmed mutation; instances ignore events with their own `source`; external events applied via quiet syncFollowUI (no re-dispatch). That source-tag + quiet pair is the anti-loop mechanism. The Following tab dispatches its unfollows and listens for everything else.
- No badge on the Athletes tab, ever. **Why:** it's a directory, not personal items. Enforced three ways that must stay in sync: not in TAB_SEEN_TABS (client), not in TAB_SEEN_KEYS (server), no `.tab-count` span in the htab markup.
- Profile tab deliberately omits sort dropdown, grid/list toggle, and the athlete modal (my-profile defines its own .pill etc — modal chrome would collide). Card tap is a no-op there; /athletes keeps all three.
- Search destination: `/athletes?q=` is THE topbar-search target on every shell page, desktop AND mobile (tab = casual browse only). Matching is substring over name+location+countryName+stateName+stateCode+sports+level — "cy" matching "cycling" is by design, not a bug.
- TRAP: every new shared html/*.js file needs its dual-path serve route in server.js (mirroring arenas-time.js) — script tags 404 silently without it (forgotten this session, caught before testing).
- Club discovery still does NOT exist (no directory page, no search endpoint; invite links + sidebar only). Banked shape if requested: clubs-table query + member counts + join-request/open-invite flow — a separate feature-sized task.
- Known minor: /athletes highlights nothing in the mobile bottom nav (`athletes: null` in the nav map).
- TRAP: never target positional children (`.adc-head>div`) in shared-component CSS — injected helpers (avatarHtml) add their own wrapper divs that catch the rule (this stretched avatars; border-radius was a red herring). Class every structural node. Guard: scripts/verify-athlete-cards.js.
- Extraction audits must diff old page CSS for VARIANT classes too, not just base ones — the gold advanced-level pill was silently flattened to muted during extraction.
- Athletes tab is mobile-only BY DESIGN (desktop has /athletes): desktop deep-links to #athletes redirect there; leaving mobile with the tab open snaps to Overview and clears the hash.
