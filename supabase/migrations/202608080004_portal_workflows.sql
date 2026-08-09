create extension if not exists pgcrypto;

create table if not exists public.appointment_change_requests (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  request_type text not null check (request_type in ('reschedule', 'tbd', 'cancel')),
  requested_start timestamptz,
  requested_end timestamptz,
  customer_notes text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'declined', 'superseded', 'canceled')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    request_type <> 'reschedule'
    or (requested_start is not null and requested_end is not null and requested_end > requested_start)
  )
);

create unique index if not exists appointment_change_requests_one_pending_per_booking
  on public.appointment_change_requests (booking_id)
  where status = 'pending';

create index if not exists appointment_change_requests_status_requested_idx
  on public.appointment_change_requests (status, requested_at desc);

alter table public.appointment_change_requests enable row level security;
revoke all on public.appointment_change_requests from anon, authenticated;

create or replace function public.submit_appointment_change_request(
  p_booking_id uuid,
  p_request_type text,
  p_requested_start timestamptz default null,
  p_requested_end timestamptz default null,
  p_customer_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request_id uuid;
  linked_site_id uuid;
begin
  if p_request_type not in ('reschedule', 'tbd', 'cancel') then
    raise exception 'Invalid appointment change request type';
  end if;

  if p_request_type = 'reschedule' and (
    p_requested_start is null
    or p_requested_end is null
    or p_requested_end <= p_requested_start
  ) then
    raise exception 'A valid requested appointment window is required';
  end if;

  perform 1 from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'Booking not found';
  end if;

  select id into linked_site_id
    from public.sites
    where booking_id = p_booking_id
    order by created_at asc
    limit 1;

  update public.appointment_change_requests
    set status = 'superseded', updated_at = now()
    where booking_id = p_booking_id and status = 'pending';

  insert into public.appointment_change_requests (
    booking_id,
    site_id,
    request_type,
    requested_start,
    requested_end,
    customer_notes
  ) values (
    p_booking_id,
    linked_site_id,
    p_request_type,
    case when p_request_type = 'reschedule' then p_requested_start else null end,
    case when p_request_type = 'reschedule' then p_requested_end else null end,
    nullif(trim(coalesce(p_customer_notes, '')), '')
  ) returning id into request_id;

  update public.bookings
    set reschedule_status = case p_request_type
          when 'reschedule' then 'requested'
          when 'tbd' then 'tbd_requested'
          when 'cancel' then 'cancel_requested'
        end,
        updated_at = now()
    where id = p_booking_id;

  return request_id;
end;
$$;

revoke all on function public.submit_appointment_change_request(uuid, text, timestamptz, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.submit_appointment_change_request(uuid, text, timestamptz, timestamptz, text)
  to service_role;

create table if not exists public.notification_holds (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete cascade,
  site_id uuid references public.sites(id) on delete cascade,
  topic text not null check (topic in (
    'order_confirmation', 'appointment_confirmation', 'appointment_change',
    'invoice', 'payment_receipt', 'media_delivery', 'property_site_live'
  )),
  active boolean not null default true,
  reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  released_by uuid references public.profiles(id) on delete set null,
  released_at timestamptz,
  check (booking_id is not null or site_id is not null)
);

create unique index if not exists notification_holds_active_scope_topic
  on public.notification_holds (
    coalesce(booking_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid),
    topic
  ) where active;

alter table public.notification_holds enable row level security;
revoke all on public.notification_holds from anon, authenticated;
