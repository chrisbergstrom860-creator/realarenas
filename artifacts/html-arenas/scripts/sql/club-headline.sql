begin;

alter table public.clubs
  add column if not exists headline text;

comment on column public.clubs.headline is
  'Optional one-line club headline; max 72 characters enforced by the application.';

commit;

notify pgrst, 'reload schema';