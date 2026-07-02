---
name: html-arenas search wiring
description: How topbar/member search works — athletes-only global search, /athletes?q= deep link, dashboard member filter globals
---

- Global search is **athletes-only** (placeholders promise exactly that). There is no clubs directory page and no server-side search endpoint; users aren't queryable server-side (names live in auth metadata), so any future global search must `listUsers` + filter in JS.
- Topbar search on the 5 athlete-facing pages (feed, challenges, leaderboards, my-profile, club-member) is an inline `onkeydown` Enter handler → `nav('/athletes?q='+encodeURIComponent(term))`. All Enter handlers must include `!event.isComposing` (IME confirm would otherwise navigate).
- Athletes page reads `?q=` in a small IIFE right after its state declarations (before first render), lowercasing into `query` and prefilling `#search-input`. Its `oninput` live search is unchanged.
- Club dashboard: topbar + Members-tab search + role select all drive one `renderMembersTable()` (name/@handle substring + exact role match), exposed as `window.applyMemberFilter` / `syncTopbarMemberSearch` / `openMembersTab` from the members IIFE.
- **Gotcha:** those three globals are exported inside the `if(!ARENAS_DATA) return` guard, so the head script defines no-op stubs first (replaced when data is present). Keep the stubs if handlers are added/renamed.
- Filtered-empty vs truly-empty states share `#members-empty`; JS swaps its textContent ("No members match your search." vs the invite copy) — the invite copy string in JS must stay identical to the static HTML fallback.
