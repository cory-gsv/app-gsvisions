-- Stores inquiries submitted from public property websites.
create table if not exists public.property_leads (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  client_id uuid,
  name text not null,
  email text not null,
  phone text,
  message text not null,
  property_address text,
  source text not null default 'property_site',
  status text not null default 'new' check (status in ('new', 'contacted', 'archived')),
  email_status text not null default 'pending' check (email_status in ('pending', 'sent', 'failed', 'not_configured')),
  email_provider_id text,
  email_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists property_leads_site_created_idx on public.property_leads (site_id, created_at desc);
create index if not exists property_leads_client_created_idx on public.property_leads (client_id, created_at desc);

alter table public.property_leads enable row level security;
alter table public.property_leads force row level security;
revoke all on table public.property_leads from anon, authenticated;
