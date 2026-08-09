-- Review against a schema-only production dump before applying.
-- This intentionally replaces all policies on the four core tables.

create or replace function public.is_gsv_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.is_admin is true or lower(coalesce(p.role, '')) = 'admin')
  );
$$;

revoke all on function public.is_gsv_admin() from public, anon;
grant execute on function public.is_gsv_admin() to authenticated, service_role;

create or replace function public.current_gsv_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce((select p.role from public.profiles p where p.id = auth.uid()), 'user'));
$$;

revoke all on function public.current_gsv_role() from public, anon;
grant execute on function public.current_gsv_role() to authenticated, service_role;

do $$
declare
  target_table text;
  policy_row record;
begin
  foreach target_table in array array['profiles', 'sites', 'bookings', 'media_assets'] loop
    for policy_row in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = target_table
    loop
      execute format('drop policy if exists %I on public.%I', policy_row.policyname, target_table);
    end loop;
  end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.sites enable row level security;
alter table public.sites force row level security;
alter table public.bookings enable row level security;
alter table public.bookings force row level security;
alter table public.media_assets enable row level security;
alter table public.media_assets force row level security;

create policy profiles_select_self_or_admin
on public.profiles for select to authenticated
using (id = auth.uid() or public.is_gsv_admin());

create policy profiles_admin_insert
on public.profiles for insert to authenticated
with check (public.is_gsv_admin());

create policy profiles_admin_update
on public.profiles for update to authenticated
using (public.is_gsv_admin())
with check (public.is_gsv_admin());

create policy profiles_update_self_without_role_escalation
on public.profiles for update to authenticated
using (id = auth.uid())
with check (
  id = auth.uid()
  and is_admin is not true
  and lower(coalesce(role, 'user')) = public.current_gsv_role()
);

create policy profiles_admin_delete
on public.profiles for delete to authenticated
using (public.is_gsv_admin());

create policy sites_select_owner_or_admin
on public.sites for select to authenticated
using (
  public.is_gsv_admin()
  or public.current_gsv_role() = 'staff'
  or client_id = auth.uid()
  or client_ms_id = auth.uid()
);

create policy sites_admin_write
on public.sites for all to authenticated
using (public.is_gsv_admin())
with check (public.is_gsv_admin());

create policy bookings_select_owner_or_admin
on public.bookings for select to authenticated
using (public.is_gsv_admin() or public.current_gsv_role() = 'staff' or client_id = auth.uid());

create policy bookings_admin_write
on public.bookings for all to authenticated
using (public.is_gsv_admin())
with check (public.is_gsv_admin());

create policy media_select_site_owner_or_admin
on public.media_assets for select to authenticated
using (
  public.is_gsv_admin()
  or public.current_gsv_role() = 'staff'
  or exists (
    select 1 from public.sites s
    where s.id = media_assets.site_id
      and (s.client_id = auth.uid() or s.client_ms_id = auth.uid())
  )
);

create policy media_admin_write
on public.media_assets for all to authenticated
using (public.is_gsv_admin())
with check (public.is_gsv_admin());

create policy media_staff_write
on public.media_assets for all to authenticated
using (public.current_gsv_role() = 'staff')
with check (public.current_gsv_role() = 'staff');

revoke all on public.profiles, public.sites, public.bookings, public.media_assets from anon;
grant select on public.profiles, public.sites, public.bookings, public.media_assets to authenticated;
grant insert, update, delete on public.profiles, public.sites, public.bookings, public.media_assets to authenticated;
