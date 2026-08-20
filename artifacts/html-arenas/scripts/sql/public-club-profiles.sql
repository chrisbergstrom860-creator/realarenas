begin;

alter table public.clubs
  add column if not exists website_url text,
  add column if not exists banner_path text;

comment on column public.clubs.website_url is
  'Normalized HTTPS club website; nullable.';
comment on column public.clubs.banner_path is
  'Server-only object path in the private club-banners bucket; never expose in payloads.';

commit;

notify pgrst, 'reload schema';