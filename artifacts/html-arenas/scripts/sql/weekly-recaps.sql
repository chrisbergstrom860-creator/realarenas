-- Weekly AI recaps are opt-in, user-owned records. Apply through the Supabase
-- SQL editor as a migration; the existing service-role REST connection cannot
-- execute DDL. RLS lets a signed-in owner read only their own recaps. The
-- service role bypasses RLS for runner writes.
begin;

create table if not exists public.weekly_recaps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  timezone text not null,
  window_start_utc timestamptz not null,
  window_end_utc timestamptz not null,
  status text not null check (status in ('pending', 'generated', 'failed')),
  lease_until timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 3),
  failure_reason text,
  findings jsonb,
  prose text,
  chart jsonb,
  context_schema_version integer,
  contract_version integer,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint weekly_recaps_user_week_key unique (user_id, week_start),
  check (window_end_utc > window_start_utc),
  check (
    (status = 'generated' and findings is not null and prose is not null
      and generated_at is not null and lease_until is null
      and context_schema_version is not null and contract_version is not null)
    or (status <> 'generated' and findings is null and prose is null
      and chart is null and generated_at is null)
  )
);

create index if not exists weekly_recaps_latest_generated_idx
  on public.weekly_recaps (user_id, week_start desc) where status = 'generated';
create index if not exists weekly_recaps_retention_idx
  on public.weekly_recaps ((coalesce(generated_at, created_at)));
create index if not exists weekly_recaps_pending_lease_idx
  on public.weekly_recaps (lease_until) where status = 'pending';

alter table public.weekly_recaps enable row level security;
revoke all on table public.weekly_recaps from public, anon, authenticated;
grant select on table public.weekly_recaps to authenticated;
grant select, insert, update, delete on table public.weekly_recaps to service_role;
drop policy if exists "Owners can read their weekly recaps" on public.weekly_recaps;
create policy "Owners can read their weekly recaps"
  on public.weekly_recaps for select to authenticated using (auth.uid() = user_id);

-- The SECURITY DEFINER routines serialize a claim and only expose their
-- results to the service role; users cannot create/update recap rows directly.
create or replace function public.claim_weekly_recap(
  p_user_id uuid, p_week_start date, p_timezone text,
  p_window_start_utc timestamptz, p_window_end_utc timestamptz,
  p_lease_until timestamptz
) returns public.weekly_recaps
language plpgsql security definer set search_path = public as $$
declare claimed public.weekly_recaps;
begin
  insert into public.weekly_recaps (
    user_id, week_start, timezone, window_start_utc, window_end_utc,
    status, lease_until, attempts
  ) values (
    p_user_id, p_week_start, p_timezone, p_window_start_utc, p_window_end_utc,
    'pending', p_lease_until, 1
  )
  on conflict (user_id, week_start) do update set
    status = 'pending', lease_until = excluded.lease_until,
    attempts = public.weekly_recaps.attempts + 1, failure_reason = null
  where public.weekly_recaps.status in ('pending', 'failed')
    and public.weekly_recaps.attempts < 3
    and (public.weekly_recaps.lease_until is null or public.weekly_recaps.lease_until < now())
  returning * into claimed;
  return claimed;
end $$;

create or replace function public.finish_weekly_recap(
  p_id uuid, p_lease_until timestamptz, p_findings jsonb, p_prose text,
  p_chart jsonb, p_context_schema_version integer, p_contract_version integer
) returns public.weekly_recaps
language plpgsql security definer set search_path = public as $$
declare finished public.weekly_recaps;
begin
  update public.weekly_recaps set
    status = 'generated', lease_until = null, failure_reason = null,
    findings = p_findings, prose = p_prose, chart = p_chart,
    context_schema_version = p_context_schema_version,
    contract_version = p_contract_version, generated_at = now()
  where id = p_id and status = 'pending' and lease_until = p_lease_until
    and lease_until > now()
  returning * into finished;
  return finished;
end $$;

create or replace function public.fail_weekly_recap(
  p_id uuid, p_lease_until timestamptz, p_failure_reason text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.weekly_recaps set
    status = 'failed', lease_until = null, failure_reason = left(p_failure_reason, 500)
  where id = p_id and status = 'pending' and lease_until = p_lease_until;
end $$;

-- No caller-controlled cutoff: saved output lives for 90 days from generation;
-- never-generated rows expire 90 days after creation.
create or replace function public.delete_expired_weekly_recaps()
returns integer
language plpgsql security definer set search_path = public as $$
declare removed integer;
begin
   delete from public.weekly_recaps
     where coalesce(generated_at, created_at) < now() - interval '90 days';
  get diagnostics removed = row_count;
  return removed;
end $$;

revoke all on function public.claim_weekly_recap(uuid,date,text,timestamptz,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.finish_weekly_recap(uuid,timestamptz,jsonb,text,jsonb,integer,integer) from public, anon, authenticated;
revoke all on function public.fail_weekly_recap(uuid,timestamptz,text) from public, anon, authenticated;
revoke all on function public.delete_expired_weekly_recaps() from public, anon, authenticated;
grant execute on function public.claim_weekly_recap(uuid,date,text,timestamptz,timestamptz,timestamptz) to service_role;
grant execute on function public.finish_weekly_recap(uuid,timestamptz,jsonb,text,jsonb,integer,integer) to service_role;
grant execute on function public.fail_weekly_recap(uuid,timestamptz,text) to service_role;
grant execute on function public.delete_expired_weekly_recaps() to service_role;

notify pgrst, 'reload schema';
commit;