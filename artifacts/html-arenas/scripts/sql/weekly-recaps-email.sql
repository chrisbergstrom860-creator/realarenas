-- Weekly AI recap email delivery. Apply manually in the Supabase SQL editor.
-- Existing recaps become email-pending; this migration does not send email.
begin;

alter table public.weekly_recaps
  add column if not exists email_status text not null default 'pending'
    check (email_status in ('pending', 'sent', 'skipped', 'failed')),
  add column if not exists email_attempts integer not null default 0
    check (email_attempts between 0 and 3),
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_message_id text,
  add column if not exists email_failure_reason text;

-- Only generated, email-pending rows can transition. Sent/skipped/exhausted
-- rows are terminal. No matching row returns a null composite (check its id).
create or replace function public.mark_weekly_recap_email(
  p_id uuid,
  p_status text,
  p_message_id text,
  p_failure_reason text
) returns public.weekly_recaps
language plpgsql security definer set search_path = public as $$
declare
  marked public.weekly_recaps;
begin
  if p_status is null or p_status not in ('sent', 'skipped', 'failed') then
    raise exception 'Invalid weekly recap email status'
      using errcode = '22023';
  end if;

  if p_status = 'sent'
    and (p_message_id is null or btrim(p_message_id) = '') then
    raise exception 'Sent weekly recap email requires a message id'
      using errcode = '22023';
  end if;

  update public.weekly_recaps as recap set
    email_status = case
      when p_status = 'failed' and recap.email_attempts + 1 < 3
        then 'pending'
      else p_status
    end,
    email_attempts = recap.email_attempts
      + case when p_status = 'failed' then 1 else 0 end,
    email_sent_at = case when p_status = 'sent' then now() else null end,
    email_message_id = case
      when p_status = 'sent' then btrim(p_message_id)
      else null
    end,
    email_failure_reason = case
      when p_status = 'sent' then null
      else left(p_failure_reason, 500)
    end
  where recap.id = p_id
    and recap.status = 'generated'
    and recap.email_status = 'pending'
    and recap.email_attempts < 3
  returning recap.* into marked;

  return marked;
end $$;

-- Preserve existing owner-read-only table RLS. Only the service role may
-- invoke the SECURITY DEFINER state transition.
revoke all on function public.mark_weekly_recap_email(uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.mark_weekly_recap_email(uuid,text,text,text)
  to service_role;

notify pgrst, 'reload schema';
commit;