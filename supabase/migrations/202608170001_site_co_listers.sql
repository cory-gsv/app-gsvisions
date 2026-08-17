create table if not exists public.site_co_listers (
  site_id uuid primary key references public.sites(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_co_lister_not_primary check (site_id is not null)
);

create index if not exists site_co_listers_profile_idx on public.site_co_listers(profile_id);
alter table public.site_co_listers enable row level security;
alter table public.site_co_listers force row level security;

create policy site_co_listers_select_participant_or_staff
on public.site_co_listers for select to authenticated
using (
  public.is_gsv_admin()
  or public.current_gsv_role() = 'staff'
  or profile_id = auth.uid()
);

create policy site_co_listers_admin_write
on public.site_co_listers for all to authenticated
using (public.is_gsv_admin())
with check (public.is_gsv_admin());

revoke all on public.site_co_listers from anon;
grant select, insert, update, delete on public.site_co_listers to authenticated;

create policy sites_select_co_lister
on public.sites for select to authenticated
using (exists (
  select 1 from public.site_co_listers c
  where c.site_id = sites.id and c.profile_id = auth.uid()
));

create policy media_select_co_lister
on public.media_assets for select to authenticated
using (exists (
  select 1 from public.site_co_listers c
  where c.site_id = media_assets.site_id and c.profile_id = auth.uid()
));
