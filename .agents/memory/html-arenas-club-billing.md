---
name: html-arenas club billing authority
description: Club Pro checkout/portal are admin-or-owner (NOT manager-level); server-decided billing list; refusal copy contract.
---

# Club billing = admin-or-owner (Task-#79 decision, do not re-litigate)

**Rule:** Club Pro checkout and the Stripe portal require `canManageClubBilling` = admin membership OR `clubs.owner_id === userId` (fails closed). Coaches keep full USE of Club Pro features (plan gates read only the club's plan) but can never buy/change the subscription. This is deliberately stricter than the `isClubManagerRole` (admin/coach) bar used for day-to-day club actions.

**Why:** billing is a money action on the owner's card; a coach could previously start a $29/mo subscription billed to someone else. Owner is checked separately from role because an owner may self-demote below admin and must still manage a sub on their own card.

**How to apply:**
- Guarded routes: `POST /api/billing/checkout/club/:clubId`, `POST /api/billing/portal/club/:clubId` → 403 with `CLUB_BILLING_REFUSAL` (explains admins/owner rule + that coaches keep feature access — keep copy exact, the verifier asserts it byte-for-byte).
- No-id marketing checkout `POST /api/billing/checkout/club` and the `/billing` page both derive club lists from `getBillableClubIds` (admin memberships ∪ owned clubs) — ONE authority set so the UI can never show a control the API refuses (canLeave/isOwner pattern). Coach's /billing shows an explanatory empty state under "Club billing"; role label `'owner'` when owner_id matches.
- Any NEW billing surface (dashboard buy buttons, emails with manage links, etc.) must gate on `canManageClubBilling` / `getBillableClubIds`, never `isClubManagerRole`.
- Verifier: `scripts/verify-club-billing.js` (24 checks; proves guard passage via 409 already-subscribed / 404 no-sub paths with a fake club_pro row — no real Stripe objects). Screenshot harness: `scripts/shot-billing-roles.js` (beware: `textContent('body')` includes the inline renderer script source, so assert on rendered locators, not body text).
- Dashboard locked-card "Upgrade" CTAs stay navigational to /billing for everyone — the page itself is the gate.
