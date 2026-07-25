-- Challenge invites: one record per invitee per challenge. Powers the real
-- Private-challenge flow (With-friends tab pending section, notification Join
-- pill state, join authorization for private solo challenges, revoke).
-- Run this in the Supabase SQL editor (service role cannot run DDL).
-- Matches the activities/achievements/activity_likes precedent: RLS on with no
-- policies = service-role access only (the app server is the sole reader/writer).

create table if not exists public.challenge_invites (
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  invitee_id   uuid not null,
  inviter_id   uuid not null,
  created_at   timestamptz not null default now(),
  primary key (challenge_id, invitee_id)
);

alter table public.challenge_invites enable row level security;
