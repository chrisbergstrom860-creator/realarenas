---
name: html-arenas invite stats + History tab
description: Non-obvious gotchas wiring the club-invite admin page stat cards and History tab to real invite data
---

# Invite stat cards & History tab (arenas-club-invite.html)

- `setStat(label, value)` matches `.stat-card` by `.sc-label` text across the **whole page**, so the same label on multiple tabs (e.g. "Pending" exists on both `#tab-invites` and `#tab-history`) all update together. A per-tab stat override must (a) scope its query to the tab container (e.g. `#tab-history .stat-card`) and (b) run **after** `renderPending` in every lifecycle (initial load AND `refresh()`), or the global `setStat('pending', …)` clobbers it.
- Server-computed `isExpired` = `expires_at < now` and **ignores status** — an accepted invite past its expiry also has `isExpired === true`. Always guard "expired" counts/rows with `status !== 'accepted'` (or `status === 'pending'`).
- `club_invites` has **no `declined` status** (there is no decline mechanism — invites only expire). Statuses are `pending` and `accepted`; "expired" is derived. Revoked invites are **hard-deleted**. So the History tab reflects **current invite records**, not a permanent all-time audit — "Total sent" can't count revoked invites. Don't label it "all time"; the History table can never show a "Declined" outcome.

**Decision — History stat cards are a clean partition.** Accepted + active-Pending + Expired = Total (all excluding `isOpen` sentinel links). The invites-tab "Pending" stat still includes expired (matches its own pending table, which lists expired rows for resending).
**Why:** the History tab has a separate Expired card, so counting expired inside Pending too would make the four cards visibly fail to sum. The invites tab has no separate Expired card, so including expired in its Pending is correct there.
**How to apply:** when touching either page's stats, keep History as the clean partition and leave the invites-tab Pending semantics alone — they intentionally differ.
