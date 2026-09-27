-- Apply in the Supabase SQL editor before deploying the alert runner.
-- Keep idempotency history beyond recap retention and Resend's 24-hour window.
-- Prerequisite: notifications(user_id,source_key) unique index
-- notifications_user_source_key_uidx from club-pro-visibility-notifications.sql
-- (also required by the existing weekly recap notification upsert).
begin;

create table if not exists public.recap_failure_alerts (
  affected_user_id uuid not null,
  week_start date not null,
  kind text not null check (kind in ('generation', 'email')),
  payload text not null,
  recipient text not null,
  first_attempt_at timestamptz,
  lease_until timestamptz,
  message_id text,
  primary key (affected_user_id, week_start, kind)
);
alter table public.recap_failure_alerts enable row level security;
revoke all on public.recap_failure_alerts from public, anon, authenticated;
grant select, insert, update on public.recap_failure_alerts to service_role;

create or replace function public.claim_recap_failure_alert(
  p_user_id uuid, p_week_start date, p_kind text
) returns public.recap_failure_alerts
language plpgsql security definer set search_path = public as $$
declare claimed public.recap_failure_alerts;
begin
  update public.recap_failure_alerts set
    first_attempt_at = coalesce(first_attempt_at, now()),
    lease_until = now() + interval '2 minutes'
  where affected_user_id = p_user_id and week_start = p_week_start and kind = p_kind
    and message_id is null
    and (lease_until is null or lease_until < now())
    and (first_attempt_at is null or first_attempt_at > now() - interval '23 hours')
  returning * into claimed;
  return claimed;
end $$;
revoke all on function public.claim_recap_failure_alert(uuid,date,text) from public, anon, authenticated;
grant execute on function public.claim_recap_failure_alert(uuid,date,text) to service_role;
notify pgrst, 'reload schema';
commit;