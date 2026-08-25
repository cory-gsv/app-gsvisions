alter table public.profiles
  add column if not exists assistant_to_profile_id uuid null references public.profiles(id) on delete set null;

create index if not exists profiles_assistant_to_profile_idx
  on public.profiles(assistant_to_profile_id)
  where assistant_to_profile_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_assistant_not_self'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_assistant_not_self
      check (assistant_to_profile_id is null or assistant_to_profile_id <> id);
  end if;
end $$;

create or replace function public.protect_assistant_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.assistant_to_profile_id is distinct from new.assistant_to_profile_id
    and coalesce(auth.role(), '') <> 'service_role'
    and not public.is_gsv_admin()
  then
    raise exception 'Only an administrator can change assistant assignments.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_assistant_assignment on public.profiles;
create trigger profiles_protect_assistant_assignment
before update of assistant_to_profile_id on public.profiles
for each row execute function public.protect_assistant_assignment();

create or replace function public.current_portal_owner_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.assistant_to_profile_id from public.profiles p where p.id = auth.uid()),
    auth.uid()
  );
$$;

revoke all on function public.current_portal_owner_id() from public, anon;
grant execute on function public.current_portal_owner_id() to authenticated, service_role;

drop policy if exists profiles_select_assigned_realtor on public.profiles;
create policy profiles_select_assigned_realtor
on public.profiles for select to authenticated
using (id = public.current_portal_owner_id());

drop policy if exists sites_select_assistant_owner on public.sites;
create policy sites_select_assistant_owner
on public.sites for select to authenticated
using (
  client_id = public.current_portal_owner_id()
  or client_ms_id = public.current_portal_owner_id()
);

drop policy if exists bookings_select_assistant_owner on public.bookings;
create policy bookings_select_assistant_owner
on public.bookings for select to authenticated
using (client_id = public.current_portal_owner_id());

drop policy if exists media_select_assistant_owner on public.media_assets;
create policy media_select_assistant_owner
on public.media_assets for select to authenticated
using (exists (
  select 1 from public.sites s
  where s.id = media_assets.site_id
    and (
      s.client_id = public.current_portal_owner_id()
      or s.client_ms_id = public.current_portal_owner_id()
    )
));

drop policy if exists site_co_listers_select_assistant on public.site_co_listers;
create policy site_co_listers_select_assistant
on public.site_co_listers for select to authenticated
using (profile_id = public.current_portal_owner_id());

drop policy if exists sites_select_assistant_co_lister on public.sites;
create policy sites_select_assistant_co_lister
on public.sites for select to authenticated
using (exists (
  select 1 from public.site_co_listers c
  where c.site_id = sites.id
    and c.profile_id = public.current_portal_owner_id()
));

drop policy if exists media_select_assistant_co_lister on public.media_assets;
create policy media_select_assistant_co_lister
on public.media_assets for select to authenticated
using (exists (
  select 1 from public.site_co_listers c
  where c.site_id = media_assets.site_id
    and c.profile_id = public.current_portal_owner_id()
));
