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

## Session ② plan (agreed shape)
- Hosted Checkout (subscription mode, metadata owner_type/owner_id) + webhook at BASE+/api/stripe/webhook handling checkout.session.completed / customer.subscription.updated / .deleted / invoice.payment_failed → upsert subscriptions; Customer Portal for self-serve cancel. **Webhook route needs `express.raw()` mounted before the global body parsers** or signature verification fails.
