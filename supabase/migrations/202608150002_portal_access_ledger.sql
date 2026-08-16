create table if not exists public.portal_access_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  site_id uuid references public.sites(id) on delete cascade,
  event_type text not null check (event_type in ('portal_open','site_view','media_download')),
  path text,
  metadata jsonb not null default '{}'::jsonb,
  user_agent text,
  ip_address inet,
  created_at timestamptz not null default now()
);

create index if not exists portal_access_events_user_created_idx
  on public.portal_access_events (user_id, created_at desc);
create index if not exists portal_access_events_site_created_idx
  on public.portal_access_events (site_id, created_at desc);

alter table public.portal_access_events enable row level security;
alter table public.portal_access_events force row level security;

create policy portal_access_events_admin_select
on public.portal_access_events for select to authenticated
using (public.is_gsv_admin() or public.current_gsv_role() = 'staff');

revoke all on public.portal_access_events from anon;
grant select on public.portal_access_events to authenticated;

