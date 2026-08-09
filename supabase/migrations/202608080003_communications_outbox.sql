create table if not exists public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  message_type text not null,
  booking_id uuid references public.bookings(id),
  site_id uuid references public.sites(id),
  recipient_email text not null,
  subject text not null,
  status text not null check (status in ('sending', 'sent', 'failed')),
  provider text not null default 'resend',
  provider_message_id text,
  last_error text,
  attempt_count integer not null default 1,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.outbound_messages enable row level security;
alter table public.outbound_messages force row level security;
revoke all on public.outbound_messages from anon, authenticated;

create or replace function public.claim_outbound_message(
  p_idempotency_key text,
  p_message_type text,
  p_booking_id uuid,
  p_site_id uuid,
  p_recipient_email text,
  p_subject text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_id uuid;
begin
  insert into public.outbound_messages (
    idempotency_key, message_type, booking_id, site_id,
    recipient_email, subject, status
  ) values (
    p_idempotency_key, p_message_type, p_booking_id, p_site_id,
    p_recipient_email, p_subject, 'sending'
  )
  on conflict (idempotency_key) do update
    set status = 'sending',
        last_error = null,
        attempt_count = outbound_messages.attempt_count + 1,
        updated_at = now()
    where outbound_messages.status = 'failed'
  returning id into claimed_id;

  return claimed_id;
end;
$$;

revoke all on function public.claim_outbound_message(text, text, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_outbound_message(text, text, uuid, uuid, text, text)
  to service_role;
