-- Required-delivery, idempotent Club Pro visibility disclosures.
-- Run in the Supabase SQL editor before deploying the matching server code.

alter table public.notifications
  add column if not exists source_key text;

create unique index if not exists notifications_user_source_key_uidx
  on public.notifications (user_id, source_key);

alter table public.subscriptions
  add column if not exists ever_paid boolean not null default false;

alter table public.subscriptions
  add column if not exists last_paid_subscription_id text;

-- Preserve retry knowledge for subscriptions that are already entitled when
-- this migration is applied. Non-paying historical rows remain false.
update public.subscriptions
set
  ever_paid = true,
  last_paid_subscription_id = stripe_subscription_id
where status in ('active', 'past_due')
  and plan in ('pro', 'club_pro')
  and (
    ever_paid = false
    or last_paid_subscription_id is null
  );