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
     or (lower(existing_payment.stripe_payment_intent_id) not like 'manual:check:%'
         and lower(existing_payment.stripe_payment_intent_id) not like 'manual:cash:%') then
    raise exception 'Only successful check or cash payments can be adjusted';
  end if;

  select greatest(coalesce(s.balance_due_cents, 0), 0)
    into current_balance
    from public.sites s
    where s.id = p_site_id
    for update;
  if not found then
    raise exception 'Site not found';
  end if;

  select coalesce(sum(amount_cents), 0)::integer into previous_paid_total
    from public.payments
    where site_id = p_site_id and status in ('succeeded', 'partially_refunded');

  -- Current balance plus recorded payments is the current invoice total. Do
  -- not trust bookings.total_cents here because an older partial save may have
  -- updated the site invoice before its linked booking row.
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
