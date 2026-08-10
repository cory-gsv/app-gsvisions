create table if not exists public.site_traffic_events (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  event_type text not null default 'page_view'
    check (event_type in ('page_view', 'media_view')),
  media_asset_id uuid references public.media_assets(id) on delete set null,
  path text,
  referrer text,
  referrer_host text,
  city text,
  region text,
  country text,
  visitor_hash text,
  created_at timestamptz not null default now()
);

create index if not exists site_traffic_events_site_created_idx
  on public.site_traffic_events (site_id, created_at desc);

create index if not exists site_traffic_events_site_type_created_idx
  on public.site_traffic_events (site_id, event_type, created_at desc);

create index if not exists site_traffic_events_media_idx
  on public.site_traffic_events (media_asset_id)
  where media_asset_id is not null;

alter table public.site_traffic_events enable row level security;
alter table public.site_traffic_events force row level security;

revoke all on table public.site_traffic_events from anon, authenticated;

