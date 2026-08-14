alter table public.outbound_messages
  add column if not exists delivered_at timestamptz,
  add column if not exists opened_at timestamptz,
  add column if not exists clicked_at timestamptz,
  add column if not exists last_event_at timestamptz,
  add column if not exists open_count integer not null default 0,
  add column if not exists click_count integer not null default 0,
  add column if not exists last_clicked_url text;

create index if not exists outbound_messages_provider_message_id_idx
  on public.outbound_messages(provider_message_id);

create table if not exists public.email_engagement_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  outbound_message_id uuid not null references public.outbound_messages(id) on delete cascade,
  event_type text not null,
  occurred_at timestamptz not null,
  clicked_url text,
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists email_engagement_events_message_time_idx
  on public.email_engagement_events(outbound_message_id, occurred_at desc);

alter table public.email_engagement_events enable row level security;
alter table public.email_engagement_events force row level security;
revoke all on public.email_engagement_events from anon, authenticated;
