create extension if not exists pgcrypto;

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id),
  booking_id uuid references public.bookings(id),
  stripe_payment_intent_id text not null unique,
  amount_cents integer not null check (amount_cents > 0),
  tip_cents integer not null default 0 check (tip_cents >= 0),
  currency text not null default 'usd',
  status text not null check (status in ('succeeded', 'refunded', 'partially_refunded')),
  provider_created_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;
alter table public.payments enable row level security;

revoke all on public.stripe_webhook_events from anon, authenticated;
revoke all on public.payments from anon, authenticated;

create or replace function public.apply_invoice_payment(
  p_site_id uuid,
  p_booking_id uuid,
  p_payment_intent_id text,
  p_amount_cents integer,
  p_tip_cents integer,
  p_currency text,
  p_provider_created_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance integer;
  next_balance integer;
begin
  if p_amount_cents <= 0 then
    raise exception 'Payment amount must be positive';
  end if;

  insert into public.payments (
    site_id, booking_id, stripe_payment_intent_id, amount_cents,
    tip_cents, currency, status, provider_created_at
  ) values (
    p_site_id, p_booking_id, p_payment_intent_id, p_amount_cents,
    greatest(p_tip_cents, 0), lower(p_currency), 'succeeded', p_provider_created_at
  ) on conflict (stripe_payment_intent_id) do nothing;

  if not found then
    return false;
  end if;

  select greatest(coalesce(balance_due_cents, 0), 0)
    into current_balance
    from public.sites
    where id = p_site_id
    for update;

  if not found then
    raise exception 'Site not found';
  end if;

  next_balance := greatest(current_balance - p_amount_cents, 0);
  update public.sites
    set balance_due_cents = next_balance,
        paid = next_balance = 0,
        stripe_payment_intent_id = p_payment_intent_id,
        updated_at = now()
    where id = p_site_id;

  if p_booking_id is not null then
    update public.bookings
      set payment_status = case when next_balance = 0 then 'paid' else 'invoice_requested' end,
          updated_at = now()
      where id = p_booking_id;
  end if;

  return true;
end;
$$;

revoke all on function public.apply_invoice_payment(uuid, uuid, text, integer, integer, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_invoice_payment(uuid, uuid, text, integer, integer, text, timestamptz)
  to service_role;
