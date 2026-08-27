alter table public.payments
  add column if not exists refunded_cents integer not null default 0;

alter table public.payments
  drop constraint if exists payments_refunded_cents_check;
alter table public.payments
  add constraint payments_refunded_cents_check
  check (refunded_cents >= 0 and refunded_cents <= amount_cents);

create table if not exists public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  payment_id uuid not null references public.payments(id),
  site_id uuid not null references public.sites(id),
  booking_id uuid references public.bookings(id),
  provider_refund_id text,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd',
  kind text not null default 'provider_refund'
    check (kind in ('provider_refund', 'manual_refund', 'record_correction')),
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  reason text,
  failure_message text,
  requested_by uuid,
  provider_created_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payment_refunds
  add column if not exists kind text not null default 'provider_refund';
alter table public.payment_refunds
  drop constraint if exists payment_refunds_kind_check;
alter table public.payment_refunds
  add constraint payment_refunds_kind_check
  check (kind in ('provider_refund', 'manual_refund', 'record_correction'));

create unique index if not exists payment_refunds_provider_refund_id_key
  on public.payment_refunds(provider_refund_id)
  where provider_refund_id is not null;
create index if not exists payment_refunds_payment_id_idx
  on public.payment_refunds(payment_id, created_at desc);
create index if not exists payment_refunds_site_id_idx
  on public.payment_refunds(site_id, created_at desc);

alter table public.payment_refunds enable row level security;
revoke all on public.payment_refunds from anon, authenticated;

create or replace function public.reserve_payment_refund(
  p_payment_id uuid,
  p_site_id uuid,
  p_request_id uuid,
  p_amount_cents integer,
  p_reason text,
  p_kind text,
  p_requested_by uuid
) returns table (
  refund_id uuid,
  payment_reference text,
  currency text,
  refundable_cents integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_refund public.payment_refunds%rowtype;
  source_payment public.payments%rowtype;
  pending_cents integer;
  remaining_cents integer;
begin
  if p_amount_cents <= 0 then
    raise exception 'Refund amount must be positive';
  end if;
  if p_kind not in ('provider_refund', 'manual_refund', 'record_correction') then
    raise exception 'Invalid refund type';
  end if;
  if p_kind = 'record_correction' and nullif(trim(p_reason), '') is null then
    raise exception 'A reason is required for a payment record correction';
  end if;

  select * into existing_refund
    from public.payment_refunds
    where request_id = p_request_id;
  if found then
    select * into source_payment from public.payments where id = existing_refund.payment_id;
    return query select
      existing_refund.id,
      source_payment.stripe_payment_intent_id,
      source_payment.currency,
      greatest(source_payment.amount_cents - source_payment.refunded_cents, 0);
    return;
  end if;

  select * into source_payment
    from public.payments
    where id = p_payment_id and site_id = p_site_id
    for update;
  if not found then
    raise exception 'Payment not found';
  end if;
  if source_payment.status not in ('succeeded', 'partially_refunded') then
    raise exception 'This payment is not refundable';
  end if;

  select coalesce(sum(amount_cents), 0)::integer into pending_cents
    from public.payment_refunds
    where payment_id = source_payment.id and status = 'pending';
  remaining_cents := greatest(source_payment.amount_cents - source_payment.refunded_cents - pending_cents, 0);
  if p_amount_cents > remaining_cents then
    raise exception 'Refund cannot exceed the remaining refundable amount';
  end if;

  insert into public.payment_refunds (
    request_id, payment_id, site_id, booking_id, amount_cents, currency,
    kind, status, reason, requested_by
  ) values (
    p_request_id, source_payment.id, source_payment.site_id,
    source_payment.booking_id, p_amount_cents, source_payment.currency,
    p_kind, 'pending', nullif(trim(p_reason), ''), p_requested_by
  ) returning id into refund_id;

  payment_reference := source_payment.stripe_payment_intent_id;
  currency := source_payment.currency;
  refundable_cents := remaining_cents;
  return next;
end;
$$;

create or replace function public.finalize_payment_refund(
  p_request_id uuid,
  p_provider_refund_id text,
  p_status text,
  p_provider_created_at timestamptz,
  p_failure_message text default null
) returns table (
  payment_id uuid,
  site_id uuid,
  refunded_cents integer,
  balance_due_cents integer,
  payment_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  refund_row public.payment_refunds%rowtype;
  source_payment public.payments%rowtype;
  next_refunded integer;
  next_balance integer;
begin
  if p_status not in ('pending', 'succeeded', 'failed') then
    raise exception 'Invalid refund status';
  end if;

  select * into refund_row
    from public.payment_refunds
    where request_id = p_request_id
    for update;
  if not found then
    raise exception 'Refund request not found';
  end if;

  select * into source_payment
    from public.payments
    where id = refund_row.payment_id
    for update;
  if not found then
    raise exception 'Payment not found';
  end if;

  if refund_row.applied_at is not null then
    select greatest(coalesce(s.balance_due_cents, 0), 0) into next_balance
      from public.sites s where s.id = source_payment.site_id;
    return query select source_payment.id, source_payment.site_id,
      source_payment.refunded_cents, next_balance, source_payment.status;
    return;
  end if;

  update public.payment_refunds
    set provider_refund_id = coalesce(nullif(trim(p_provider_refund_id), ''), provider_refund_id),
        status = p_status,
        provider_created_at = coalesce(p_provider_created_at, provider_created_at),
        failure_message = nullif(trim(p_failure_message), ''),
        updated_at = now()
    where id = refund_row.id;

  if p_status <> 'succeeded' then
    select greatest(coalesce(s.balance_due_cents, 0), 0) into next_balance
      from public.sites s where s.id = source_payment.site_id;
    return query select source_payment.id, source_payment.site_id,
      source_payment.refunded_cents, next_balance, source_payment.status;
    return;
  end if;

  next_refunded := source_payment.refunded_cents + refund_row.amount_cents;
  if next_refunded > source_payment.amount_cents then
    raise exception 'Refund exceeds the original payment';
  end if;

  update public.payments
    set refunded_cents = next_refunded,
        status = case when next_refunded = amount_cents then 'refunded' else 'partially_refunded' end
    where id = source_payment.id;

  update public.payment_refunds
    set applied_at = now(), updated_at = now()
    where id = refund_row.id;

  update public.sites s
    set balance_due_cents = greatest(coalesce(s.balance_due_cents, 0), 0) + refund_row.amount_cents,
        paid = false,
        updated_at = now()
    where s.id = source_payment.site_id
    returning greatest(coalesce(s.balance_due_cents, 0), 0) into next_balance;

  if source_payment.booking_id is not null then
    update public.bookings
      set payment_status = 'invoice_requested', updated_at = now()
      where id = source_payment.booking_id;
  end if;

  return query select source_payment.id, source_payment.site_id,
    next_refunded, next_balance,
    case when next_refunded = source_payment.amount_cents then 'refunded' else 'partially_refunded' end;
end;
$$;

revoke all on function public.reserve_payment_refund(uuid, uuid, uuid, integer, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_payment_refund(uuid, uuid, uuid, integer, text, text, uuid)
  to service_role;

revoke all on function public.finalize_payment_refund(uuid, text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.finalize_payment_refund(uuid, text, text, timestamptz, text)
  to service_role;

-- Keep manual corrections accurate after any provider payment has been
-- partially or fully refunded. The previous function summed gross payments.
create or replace function public.adjust_manual_payment(
  p_payment_id uuid,
  p_site_id uuid,
  p_amount_cents integer,
  p_payment_reference text,
  p_adjusted_by uuid
) returns table(balance_due_cents integer, total_paid_cents integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_payment public.payments%rowtype;
  previous_paid_total integer;
  next_paid_total integer;
  invoice_total integer;
  current_balance integer;
  next_balance integer;
begin
  if p_amount_cents <= 0 then
    raise exception 'Payment amount must be positive';
  end if;
  if lower(coalesce(p_payment_reference, '')) not like 'manual:check:%'
     and lower(coalesce(p_payment_reference, '')) not like 'manual:cash:%' then
    raise exception 'Only check or cash payments can be adjusted';
  end if;

  select * into existing_payment
    from public.payments
    where id = p_payment_id and site_id = p_site_id
    for update;
  if not found then
    raise exception 'Payment not found';
  end if;
  if existing_payment.status <> 'succeeded'
     or existing_payment.refunded_cents <> 0
     or (lower(existing_payment.stripe_payment_intent_id) not like 'manual:check:%'
         and lower(existing_payment.stripe_payment_intent_id) not like 'manual:cash:%') then
    raise exception 'Only unrefunded check or cash payments can be adjusted';
  end if;

  select greatest(coalesce(s.balance_due_cents, 0), 0)
    into current_balance
    from public.sites s
    where s.id = p_site_id
    for update;
  if not found then
    raise exception 'Site not found';
  end if;

  select coalesce(sum(greatest(amount_cents - refunded_cents, 0)), 0)::integer
    into previous_paid_total
    from public.payments
    where site_id = p_site_id
      and status in ('succeeded', 'partially_refunded', 'refunded');

  invoice_total := current_balance + previous_paid_total;
  next_paid_total := previous_paid_total - existing_payment.amount_cents + p_amount_cents;
  if next_paid_total > invoice_total then
    raise exception 'Corrected payments cannot exceed the current invoice total';
  end if;
  next_balance := greatest(invoice_total - next_paid_total, 0);

  insert into public.manual_payment_adjustments (
    payment_id, site_id, adjusted_by,
    previous_amount_cents, next_amount_cents,
    previous_reference, next_reference
  ) values (
    existing_payment.id, p_site_id, p_adjusted_by,
    existing_payment.amount_cents, p_amount_cents,
    existing_payment.stripe_payment_intent_id, p_payment_reference
  );

  update public.payments
    set amount_cents = p_amount_cents,
        stripe_payment_intent_id = p_payment_reference
    where id = existing_payment.id;

  update public.sites
    set balance_due_cents = next_balance,
        paid = next_balance = 0,
        stripe_payment_intent_id = case
          when stripe_payment_intent_id = existing_payment.stripe_payment_intent_id then p_payment_reference
          else stripe_payment_intent_id
        end,
        updated_at = now()
    where id = p_site_id;

  if existing_payment.booking_id is not null then
    update public.bookings
      set total_cents = invoice_total,
          subtotal_cents = invoice_total + greatest(coalesce(discount_cents, 0), 0),
          payment_status = case when next_balance = 0 then 'paid' else 'invoice_requested' end,
          payment_method = case
            when lower(p_payment_reference) like 'manual:check:%' then 'check'
            else 'cash'
          end,
          updated_at = now()
      where id = existing_payment.booking_id;
  end if;

  return query select next_balance, next_paid_total;
end;
$$;

revoke all on function public.adjust_manual_payment(uuid, uuid, integer, text, uuid)
  from public, anon, authenticated;
grant execute on function public.adjust_manual_payment(uuid, uuid, integer, text, uuid)
  to service_role;
