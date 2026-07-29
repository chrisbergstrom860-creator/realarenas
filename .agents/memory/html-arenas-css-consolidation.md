---
name: Shared-CSS consolidation rules
description: Hard-won rules for moving page <style> rules into arenas.css (Batch 1 lessons)
---

Batch 1 (Jul 2026) moved 10 base-chrome rules into `html/arenas.css` ("Base chrome (consolidated, Batch 1)" section, placed BEFORE the mobile @media so mobile overrides still win). Three traps were hit and must govern every future batch:

1. **Membership by `<link>` tag, not grep.** `grep -l arenas.css` matched a *comment* in arenas-club-invite.html saying it does NOT link the file. Only 11 pages truly link arenas.css: athletes, billing, calendar, challenges, club-dashboard, club-member, events, feed, leaderboards, log, my-profile. club-invite is self-contained. Always use `grep -l '<link[^>]*arenas.css'`.
   **Why:** editing club-invite as "linked" stripped its only copies → 48% pixel diff.

2. **Partial coverage = scope expansion.** A rule identical on the pages that carry it still can't move if some linked pages DON'T carry it and the selector can match their DOM (element/universal selectors always match). `button,select,input,textarea{font-family}` was on only 6/11 pages — moving it restyled every form control on the other 5.
   **How to apply:** for each candidate, list carriers; non-carriers need proof the selector matches nothing there (class unused in markup AND JS), or the rule stays page-local.

3. **Same-specificity demotion vs sibling rules, not just duplicates.** `.btn-yellow/.btn-primary/.btn-ghost` conflict with each page's LOCAL `.btn` (font-weight:500, sometimes background) at equal specificity; moving the variants earlier (arenas.css) lets `.btn` win. The hazard rule: check every earlier page rule that shares *properties* with the candidate on the same elements, not just same-selector copies. Safe movers: higher-specificity state rules (`.modal-overlay.open`, `.toast.show`), zero-specificity reset, and standalone classes sharing no props (`.btn-full`, `.card`, `.footer*`, `.notif-btn`).

**Verification recipe that works:** throwaway shot script (coach test user, 12 surfaces × 1280/380) against a clean-HEAD baseline taken in the SAME session; `cmp` + `compare -metric AE`; ≤~120px on live-data pages is dynamic noise (prove by re-shooting HEAD). Re-shoot the HEAD baseline fresh if runs are separated — data drift (memberships, time-ago) produces multi-thousand-px false diffs.

SW note: arenas.css is served network-first (sw.js Rule 5, same-origin asset → networkFirst); no cache-bust needed beyond deploy.

**Batch 2 (Jul 2026) — button system.** Canonical `.btn`/`.btn:hover` + ghost/primary/yellow variants now in arenas.css, ordered .btn → .btn:hover → variants → variant hovers (variants must stay after base or they demote). Canonical .btn has NO background/color (bare `.btn` buttons on club-dashboard/my-profile inherit gray-800) but DOES keep font-family (challenges/leaderboards lack the element font rule). athletes/billing/events keep FULL local .btn cascades + local variant copies — their padding/background divergences are real, and any page-local `.btn` demotes arenas.css variants, so a page either deletes its whole button cascade or keeps all of it. challenges/leaderboards normalized: body 15→14px, .btn/.toast → canonical 13px. Accepted side effect: pages without a prior .btn:hover now get gray-100 hover on variant-less buttons.
