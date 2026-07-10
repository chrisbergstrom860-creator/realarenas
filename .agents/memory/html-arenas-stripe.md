---
name: html-arenas Stripe / subscriptions
description: Payments build decisions — plans, subscriptions table, SDK exception, plan-resolution semantics, env vars.
---

# html-arenas Stripe & plan model

## Locked product decisions
- Individual Pro **$9/month monthly-only**; Club Pro **flat $29/month monthly-only** (no per-member fees), purchased by a club's coach/admin on behalf of the club. Test mode only until told otherwise. No trials, no annual — all fabricated landing copy ($12/annual/14-day trial/per-member) was removed in the Session ④ honesty pass; repo greps for those terms should stay clean (legit non-pricing "14-day" uses: invite expiry windows, streak-challenge names, Fortnight badge; `trialing` status handling in webhook code is also legit).

## Data model
- Single `subscriptions` table in Supabase (user-created via SQL editor — service role can't run DDL): polymorphic `owner_type ('user'|'club')` + `owner_id`, `plan ('pro'|'club_pro')`, `stripe_customer_id`, `stripe_subscription_id`, `status`, `current_period_end`, `cancel_at_period_end`, unique(owner_type, owner_id).
- **Why one table:** one webhook code path for both products; "free" = absence of a row; unique(owner_type,owner_id) is the idempotency anchor for webhook upserts.

## Plan resolution (server.js)
- `getUserPlan(userId)` → 'pro'|'free', `getClubPlan(clubId)` → 'club_pro'|'free' via shared `getPaidSubscription()`. Paid = status in `PAID_SUB_STATUSES` ('active','past_due' grace). No row / other status / error / wrong plan value → free. Never throws.

## Plan gating (DORMANT behind PLAN_GATES_ENABLED)
- Gating is BUILT but **off by default**. `PLAN_GATES_ENABLED` env var (unset/false/0/no/off = zero gating, behaviorally identical to the ungated build). **Why dormant:** founding period is free; ship the mechanism now, flip the flag later without a redeploy.
- **Free vs individual-Pro boundary** (only these three surfaces gate; everything else stays free — feed, activity logging, personal stats, event discovery/RSVP, leaderboard *viewing*):
  - `POST /api/challenges/create` — individual create gated; club create EXEMPT when caller is admin/coach of the **supplied** club_id (getClubRole+isClubManagerRole).
  - `POST /api/challenges/:id/join` — individual/public join gated; joining a challenge that has a `club_id` is EXEMPT.
  - `GET /api/profile/stats` — training analytics (profile Stats tab) gated via `requireProPlan('training_analytics')` (the ONLY remaining requireProPlan usage).
- **Rules that must hold:** create/join are SHARED by club + individual flows, so their gates must be club-aware inline (a blanket `requireProPlan` middleware broke "club features untouched" — club-dashboard posts create with visibility:'club',club_id). `DELETE /api/challenges/:id/leave` is **NEVER gated** (an exit action must not trap a downgraded user). Club-scoped features + coach's notes are entirely untouched.
- **No bypass:** create gate resolves the club role from the *supplied* club_id, so a free user passing a foreign/non-member club_id gets 403 (no role → gated). Join gate keys off the persisted challenge's club_id, not client input.
- **Client mirror** (`arenas-challenges.html`): `proLocked = gating.proLocked` (server-injected, true only when flag-on AND free). Join button locks only when `(proLocked && !c.club_id)`; individual create button + openCreateModal gate; joinChallenge/leaveChallenge carry NO blanket redirect. Pages inject `gating.proLocked` even when flag-off (value false) — so "behaviorally identical", not byte-identical.
- **Pre-existing gap (out of scope, unchanged):** create still has no *unconditional* club-membership check when the flag is OFF (any user can tag any club_id, as today). Adding an authz check there is a separate flag-independent follow-up — do NOT put it inside the `if (PLAN_GATES_ENABLED)` block (authz must not be flag-dependent).

## Stripe client
- Official `stripe` npm SDK is a **deliberate exception** to the repo's plain-fetch rule (needed for `stripe.webhooks.constructEvent`). Resend-style degradation: `stripe` is null without STRIPE_SECRET_KEY (logs `[stripe skipped: ...]`); every future caller must `if (!stripe)` no-op.
- Dependency added as concrete semver in artifacts/html-arenas/package.json (NOT catalog:) — required for the Railway subfolder npm build.

## Env vars
- `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_CLUB_PRO`, `STRIPE_WEBHOOK_SECRET` (dev-scoped, from API-created dev endpoint) set in Replit; ALL must be set in Railway separately before prod — the webhook signing secret DIFFERS per endpoint/environment.

## Checkout start flow
- POST BASE+/api/billing/checkout/pro and /club/:clubId (requireAuth; club gated by getClubRole+isClubManagerRole = admin/coach, same bar as invites); 503 no stripe/price, 409 already-paid. GET /billing/success + /billing/canceled pages (requirePageAuth, standalone-card style like club-join).
- **No-id club checkout** POST /api/billing/checkout/club (no :clubId): resolves the caller's OWN managed clubs server-side — none → `{redirect: BASE+'/for-clubs'}`, first free club → checkout `{url}`, all paid → 409. Used by marketing-page CTAs (landing `startUpgrade`, for-clubs `startClubUpgrade`) where no club context exists; 401 → client sends to signup. Limitation: a logged-in manager-less user lands on /for-clubs whose wizard creates a NEW account via /auth/signup-club.
- **Billing page** GET /billing (requirePageAuth) + html/arenas-billing.html: renders plan cards purely from injected ARENAS_DATA.billing {configured, userPlan, managedClubs[{id,name,role,plan}]}; CA auto-renewal (ARL) disclosure text must sit adjacent to EVERY upgrade button app-wide (landing, for-clubs, billing page). Billing nav item exists in all 8 shell-page sidebars; `billing: null` in ATHLETE_NAV_ACTIVE keys the mobile bottom nav.
- **Metadata contract (webhook depends on it):** `{owner_type, owner_id}` on BOTH session AND subscription_data.metadata; `initiated_by` (user id) on session metadata only — success page rejects sessions where initiated_by ≠ logged-in user. client_reference_id = "type:id".
- Customer reuse reads the subscriptions table (any-status row) → a canceled owner's re-subscribe reuses the same stripe_customer_id (verified live). Success page stays honest: "features aren't switched on yet" until gating ships.

## Webhook + Customer Portal (live, sole writer to subscriptions)
- **Raw-mount rule:** `app.use(BASE + '/api/stripe/webhook', express.raw({type:'application/json'}))` must sit BEFORE the global urlencoded/json parsers or constructEvent fails. Path-scoped, so no other route is affected.
- 4 events handled, all others 200-ignored. completed retrieves the sub then upserts on unique(owner_type,owner_id); updated is a true UPSERT (out-of-order safe, converges with completed); deleted/payment_failed match BY stripe_subscription_id → inherent stale guard; deleted keeps the row (customer reuse) with status=canceled; DB failure throws → 500 so Stripe retries; every write sets updated_at.
- **Stale-guard extension (both completed AND updated):** if the owner's row holds a DIFFERENT sub id and the incoming sub's status is non-paying, ignore the event — a late-retried canceled event for an old sub must not clobber a re-subscribe. Paying status for a new sub id wins the row.
- SDK v22 shape drift: `current_period_end` may live on the sub OR on items.data[0] (subPeriodEndIso checks both); invoice→subscription id may be `invoice.subscription`, `parent.subscription_details.subscription`, or in line items (invoiceSubscriptionId handles all).
- Portal: POST /api/billing/portal/pro + /club/:clubId (same auth gates as checkout); 404 when owner has no row/customer; works for canceled owners too (findAnySubscriptionRow, any status). Default test-mode portal configuration already existed — no configurations API call needed.
- **Per-environment webhook infra:** dev endpoint created via API → https://$REPLIT_DEV_DOMAIN/html/api/stripe/webhook, secret in dev-scoped STRIPE_WEBHOOK_SECRET env var. Railway prod needs its OWN dashboard endpoint + secret (signing secrets differ per endpoint). If the dev domain ever changes, the endpoint URL must be updated in Stripe.
- Full matrix verified live in test mode: signed/unsigned, both checkouts, 409s live, real cancel→canceled+plan freed, payment_failed→past_due (grace keeps 409), replayed completed idempotent (1 row/owner, converges to current sub state), stale delete no-op.

## E2E testing hosted checkout (hard-won)
- Pin ONE origin end-to-end: success_url is derived from the host of the request that CREATED the session (publicBaseUrl). Creating sessions via curl on localhost while the browser logs in on the dev domain (or vice versa) bounces the success page to /landing — cookie lives on the other host. Create sessions AND log in on $REPLIT_DEV_DOMAIN.
- Playwright agent must hard-verify login (load /feed, assert no redirect) BEFORE opening checkout — its UI login can fail silently and the payment still completes, wasting the run.
- Stripe Link's "Save my information" checkbox adds a required phone field that fails validation for the test agent — instruct it to uncheck/avoid Link ("Pay without Link").
- Test cleanup: stripe.subscriptions.cancel each test sub, checkout.sessions.expire leftover open sessions, then delete Supabase test users/club.
