-- Apply after weekly-recaps-email.sql. This migration sends no email.
-- Resend retains idempotency keys for 24 hours. Allow automatic retries for
-- only 23 hours from the first attempted send, leaving a one-hour margin.
begin;

alter table public.weekly_recaps
  add column if not exists email_first_attempt_at timestamptz;

-- Call immediately before contacting Resend, never during a dry run.
-- The first-attempt timestamp is durable and cannot be reset by this RPC.
-- Concurrent callers share the same timestamp and must use the same Resend
-- idempotency key and identical payload. This is NOT an exclusive send lease.
-- A missing, terminal, exhausted, or out-of-window row returns a null
-- composite; the caller must check its id and must not send on a no-op.
create or replace function public.begin_weekly_recap_email_attempt(
  p_id uuid
) returns public.weekly_recaps
language plpgsql security definer set search_path = public as $$
declare
  attempted public.weekly_recaps;
  attempt_time timestamptz := clock_timestamp();
begin
  update public.weekly_recaps as recap set
    email_first_attempt_at =
      coalesce(recap.email_first_attempt_at, attempt_time)
  where recap.id = p_id
    and recap.status = 'generated'
    and recap.email_status = 'pending'
    and recap.email_attempts < 3
    and (
      recap.email_first_attempt_at is null
      or recap.email_first_attempt_at > attempt_time - interval '23 hours'
    )
  returning recap.* into attempted;

  return attempted;
end $$;

-- Existing mark_weekly_recap_email leaves this timestamp untouched,
-- including when a failed attempt transitions back to pending.
-- Keep existing owner-read-only table RLS and service-role-only writes.
revoke all on function public.begin_weekly_recap_email_attempt(uuid)
  from public, anon, authenticated;
grant execute on function public.begin_weekly_recap_email_attempt(uuid)
  to service_role;

notify pgrst, 'reload schema';
commit;