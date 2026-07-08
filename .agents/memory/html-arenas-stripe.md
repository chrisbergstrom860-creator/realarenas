---
name: html-arenas Stripe / subscriptions
description: Payments build decisions — plans, subscriptions table, SDK exception, plan-resolution semantics, env vars.
---

# html-arenas Stripe & plan model

## Locked product decisions
- Individual Pro **$9/month monthly-only** (the landing page's "billed annually / $12 monthly" copy is WRONG and slated for removal); Club Pro **$29/month monthly-only**, purchased by a club's coach/admin on behalf of the club. Test mode only until told otherwise. No trials — landing-page "14-day trial" copy is fabricated and slated for removal.

## Data model
- Single `subscriptions` table in Supabase (user-created via SQL editor — service role can't run DDL): polymorphic `owner_type ('user'|'club')` + `owner_id`, `plan ('pro'|'club_pro')`, `stripe_customer_id`, `stripe_subscription_id`, `status`, `current_period_end`, `cancel_at_period_end`, unique(owner_type, owner_id).
- **Why one table:** one webhook code path for both products; "free" = absence of a row; unique(owner_type,owner_id) is the idempotency anchor for webhook upserts.

## Plan resolution (server.js)
- `getUserPlan(userId)` → 'pro'|'free', `getClubPlan(clubId)` → 'club_pro'|'free' via shared `getPaidSubscription()`. Paid = status in `PAID_SUB_STATUSES` ('active','past_due' grace). No row / other status / error / wrong plan value → free. Never throws. NOT wired into any route yet — gating deliberately deferred (founding period is free).

## Stripe client
- Official `stripe` npm SDK is a **deliberate exception** to the repo's plain-fetch rule (needed for `stripe.webhooks.constructEvent`). Resend-style degradation: `stripe` is null without STRIPE_SECRET_KEY (logs `[stripe skipped: ...]`); every future caller must `if (!stripe)` no-op.
- Dependency added as concrete semver in artifacts/html-arenas/package.json (NOT catalog:) — required for the Railway subfolder npm build.

## Env vars
- `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_CLUB_PRO` set in Replit; must ALSO be set in Railway separately before prod (plus `STRIPE_WEBHOOK_SECRET` later — signing secret DIFFERS per environment: Stripe CLI listener secret in dev vs dashboard endpoint secret in prod).

## Session ② DONE (checkout start flow)
- POST BASE+/api/billing/checkout/pro and /club/:clubId (requireAuth; club gated by getClubRole+isClubManagerRole = admin/coach, same bar as invites); 503 no stripe/price, 409 already-paid. GET /billing/success + /billing/canceled pages (requirePageAuth, standalone-card style like club-join).
- **Metadata contract (webhook depends on it):** `{owner_type, owner_id}` on BOTH session AND subscription_data.metadata; `initiated_by` (user id) on session metadata only — success page rejects sessions where initiated_by ≠ logged-in user. client_reference_id = "type:id".
- Success page is deliberately honest: "features aren't switched on yet" note, no DB writes anywhere in Session ② (table verified 0 rows after two completed test checkouts).
- Customer reuse reads the subscriptions table → until the Session ③ webhook writes rows, EVERY checkout creates a fresh Stripe customer (observed 3 customers for one test user). Not a bug; resolves itself after Session ③.

## Session ③ next (webhook + portal)
- Webhook at BASE+/api/stripe/webhook handling checkout.session.completed / customer.subscription.updated / .deleted / invoice.payment_failed → upsert subscriptions keyed on unique(owner_type,owner_id); Customer Portal for self-serve cancel. **Webhook route needs `express.raw()` mounted before the global body parsers** or signature verification fails. Webhook is the SOLE writer to subscriptions.

## E2E testing hosted checkout (hard-won)
- Pin ONE origin end-to-end: success_url is derived from the host of the request that CREATED the session (publicBaseUrl). Creating sessions via curl on localhost while the browser logs in on the dev domain (or vice versa) bounces the success page to /landing — cookie lives on the other host. Create sessions AND log in on $REPLIT_DEV_DOMAIN.
- Playwright agent must hard-verify login (load /feed, assert no redirect) BEFORE opening checkout — its UI login can fail silently and the payment still completes, wasting the run.
- Stripe Link's "Save my information" checkbox adds a required phone field that fails validation for the test agent — instruct it to uncheck/avoid Link ("Pay without Link").
- Test cleanup: stripe.subscriptions.cancel each test sub, checkout.sessions.expire leftover open sessions, then delete Supabase test users/club.
