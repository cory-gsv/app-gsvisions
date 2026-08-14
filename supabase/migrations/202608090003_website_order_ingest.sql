-- Ingests website checkout orders into the GSV-owned portal.
create table if not exists public.booking_ingest_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_reference text not null,
  booking_id uuid not null references public.bookings(id),
  site_id uuid not null references public.sites(id),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (source, external_reference)
);

alter table public.booking_ingest_events enable row level security;
alter table public.booking_ingest_events force row level security;
revoke all on public.booking_ingest_events from anon, authenticated;

create or replace function public.ingest_website_booking(
  p_external_reference text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_event public.booking_ingest_events%rowtype;
  new_booking_id uuid := gen_random_uuid();
  new_site_id uuid := gen_random_uuid();
  now_at timestamptz := now();
  appointment_start_at timestamptz;
  appointment_end_at timestamptz;
  total_amount integer := greatest(coalesce((p_payload->>'total_cents')::integer, 0), 0);
  is_paid boolean := coalesce((p_payload->>'paid')::boolean, false);
  property_label text := nullif(trim(coalesce(p_payload->'property'->>'address', '')), '');
  site_slug_value text;
begin
  if nullif(trim(p_external_reference), '') is null then
    raise exception 'External booking reference is required';
  end if;
  if nullif(trim(coalesce(p_payload->'customer'->>'email', '')), '') is null then
    raise exception 'Customer email is required';
  end if;
  if property_label is null then
    raise exception 'Property address is required';
  end if;

  select * into existing_event
    from public.booking_ingest_events
    where source = 'gsvisions_website' and external_reference = p_external_reference;
  if found then
    update public.booking_ingest_events
      set payload = p_payload
      where id = existing_event.id;
    update public.bookings
      set client_id = nullif(p_payload->'customer'->>'client_id', '')::uuid,
          payment_status = case when is_paid then 'paid' else payment_status end,
          payment_required = case when is_paid then false else payment_required end,
          invoice_requested = case when is_paid then false else invoice_requested end,
          internal_notes = concat('Website reference: ', p_external_reference,
            case when nullif(p_payload->>'fulfillment_order_id', '') is not null
              then concat(' | Fulfillment order: ', p_payload->>'fulfillment_order_id') else '' end),
          updated_at = now_at
      where id = existing_event.booking_id;
    update public.sites
      set client_id = nullif(p_payload->'customer'->>'client_id', '')::uuid,
          client_ms_id = nullif(p_payload->'customer'->>'client_id', '')::uuid,
          user_id = nullif(p_payload->'customer'->>'client_id', '')::uuid,
          paid = is_paid,
          balance_due_cents = case when is_paid then 0 else balance_due_cents end,
          last_payment_amount_cents = case when is_paid then total_amount else last_payment_amount_cents end,
          requires_payment_to_access = not is_paid,
          updated_at = now_at
      where id = existing_event.site_id;
    return jsonb_build_object(
      'booking_id', existing_event.booking_id,
      'site_id', existing_event.site_id,
      'created', false
    );
  end if;

  if nullif(p_payload->'appointment'->>'date', '') is not null
     and nullif(p_payload->'appointment'->>'time', '') is not null then
    appointment_start_at := (
      (p_payload->'appointment'->>'date') || ' ' || (p_payload->'appointment'->>'time')
    )::timestamp at time zone 'America/Los_Angeles';
    appointment_end_at := appointment_start_at
      + make_interval(mins => greatest(coalesce((p_payload->>'estimated_minutes')::integer, 60), 15));
  end if;

  site_slug_value := trim(both '-' from regexp_replace(lower(split_part(property_label, ',', 1)), '[^a-z0-9]+', '-', 'g'));
  if site_slug_value ~ '^([0-9]+)-(n|s|e|w|ne|nw|se|sw|north|south|east|west|northeast|northwest|southeast|southwest)-.+' then
    site_slug_value := regexp_replace(
      site_slug_value,
      '^([0-9]+)-(n|s|e|w|ne|nw|se|sw|north|south|east|west|northeast|northwest|southeast|southwest)-(.+)$',
      '\1\2|||\3'
    );
    site_slug_value := replace(replace(site_slug_value, '-', ''), '|||', '-');
  else
    site_slug_value := replace(site_slug_value, '-', '');
  end if;

  insert into public.bookings (
    id, status, property_address, property_city, property_state, property_zip,
    property_full_address, property_sqft, sqft,
    client_id, client_first_name, client_last_name, client_email, client_phone,
    selected_package_name, selected_services, selected_addons,
    subtotal_cents, discount_cents, total_cents, estimated_minutes,
    scheduled_start, scheduled_end, scheduled_timezone,
    payment_method, payment_status, payment_required, invoice_requested,
    source, internal_notes, services, addons, site_id, created_at, updated_at
  ) values (
    new_booking_id, case when appointment_start_at is null then 'pending' else 'scheduled' end,
    property_label, nullif(p_payload->'property'->>'city', ''),
    nullif(p_payload->'property'->>'state', ''), nullif(p_payload->'property'->>'zip', ''),
    concat_ws(', ', property_label, nullif(p_payload->'property'->>'city', ''),
      concat_ws(' ', nullif(p_payload->'property'->>'state', ''), nullif(p_payload->'property'->>'zip', ''))),
    nullif(p_payload->'property'->>'sqft', '')::integer,
    nullif(p_payload->'property'->>'sqft', '')::integer,
    nullif(p_payload->'customer'->>'client_id', '')::uuid,
    nullif(p_payload->'customer'->>'first_name', ''), nullif(p_payload->'customer'->>'last_name', ''),
    lower(p_payload->'customer'->>'email'), nullif(p_payload->'customer'->>'phone', ''),
    nullif(p_payload->>'package_name', ''), coalesce(p_payload->'services', '[]'::jsonb),
    coalesce(p_payload->'addons', '[]'::jsonb), total_amount, 0, total_amount,
    greatest(coalesce((p_payload->>'estimated_minutes')::integer, 60), 15),
    appointment_start_at, appointment_end_at, 'America/Los_Angeles',
    nullif(p_payload->>'payment_method', ''),
    case when is_paid then 'paid' else 'invoice_requested' end,
    not is_paid, not is_paid, 'gsvisions_website',
    concat('Website reference: ', p_external_reference,
      case when nullif(p_payload->>'fulfillment_order_id', '') is not null
        then concat(' | Fulfillment order: ', p_payload->>'fulfillment_order_id') else '' end),
    coalesce(p_payload->'services', '[]'::jsonb), coalesce(p_payload->'addons', '[]'::jsonb),
    null, now_at, now_at
  );

  insert into public.sites (
    id, booking_id, client_id, client_ms_id, user_id, created_at, updated_at, status, paid, allow_delivery,
    balance_due_cents, media_status, originals_status, cloudinary_enabled,
    public_site_enabled, traffic_enabled, domain_status, gallery, invoice_items,
    site_data, name, site_name, slug, site_slug,
    property_address, property_city, property_state, property_zip,
    property_full_address, property_sqft, sqft,
    hero_image_url, preview_image_url, site_url, admin_url,
    requires_payment_to_access, is_published, invoice_public_enabled,
    last_payment_amount_cents, media_sleeping, media_keep_count
  ) values (
    new_site_id, new_booking_id,
    nullif(p_payload->'customer'->>'client_id', '')::uuid,
    nullif(p_payload->'customer'->>'client_id', '')::uuid,
    nullif(p_payload->'customer'->>'client_id', '')::uuid,
    now_at, now_at,
    case when appointment_start_at is null then 'pending' else 'scheduled' end,
    is_paid, false, case when is_paid then 0 else total_amount end,
    'pending', 'pending', true, false, false, 'none', '[]'::jsonb,
    coalesce(p_payload->'lines', '[]'::jsonb), '{}'::jsonb,
    property_label, property_label, site_slug_value, site_slug_value,
    property_label, nullif(p_payload->'property'->>'city', ''),
    nullif(p_payload->'property'->>'state', ''), nullif(p_payload->'property'->>'zip', ''),
    concat_ws(', ', property_label, nullif(p_payload->'property'->>'city', ''),
      concat_ws(' ', nullif(p_payload->'property'->>'state', ''), nullif(p_payload->'property'->>'zip', ''))),
    nullif(p_payload->'property'->>'sqft', '')::integer,
    nullif(p_payload->'property'->>'sqft', '')::integer,
    '', '', '', '', not is_paid, false, false,
    case when is_paid then total_amount else 0 end, false, 0
  );

  update public.bookings set site_id = new_site_id where id = new_booking_id;

  insert into public.booking_ingest_events (
    source, external_reference, booking_id, site_id, payload
  ) values (
    'gsvisions_website', p_external_reference, new_booking_id, new_site_id, p_payload
  );

  return jsonb_build_object('booking_id', new_booking_id, 'site_id', new_site_id, 'created', true);
exception when unique_violation then
  select * into existing_event
    from public.booking_ingest_events
    where source = 'gsvisions_website' and external_reference = p_external_reference;
  if found then
    return jsonb_build_object('booking_id', existing_event.booking_id, 'site_id', existing_event.site_id, 'created', false);
  end if;
  raise;
end;
$$;

revoke all on function public.ingest_website_booking(text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_website_booking(text, jsonb) to service_role;
