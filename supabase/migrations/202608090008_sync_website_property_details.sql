-- Keep property facts returned by the website's shared property lookup attached
-- to the portal site created for that booking.
create or replace function public.sync_website_booking_property_details()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source <> 'gsvisions_website' then
    return new;
  end if;

  update public.sites
  set property_address = nullif(new.payload->'property'->>'address', ''),
      property_city = nullif(new.payload->'property'->>'city', ''),
      property_state = nullif(new.payload->'property'->>'state', ''),
      property_zip = nullif(new.payload->'property'->>'zip', ''),
      property_full_address = concat_ws(', ',
        nullif(new.payload->'property'->>'address', ''),
        nullif(new.payload->'property'->>'city', ''),
        nullif(trim(concat_ws(' ',
          nullif(new.payload->'property'->>'state', ''),
          nullif(new.payload->'property'->>'zip', '')
        )), '')
      ),
      address_full = concat_ws(', ',
        nullif(new.payload->'property'->>'address', ''),
        nullif(new.payload->'property'->>'city', ''),
        nullif(trim(concat_ws(' ',
          nullif(new.payload->'property'->>'state', ''),
          nullif(new.payload->'property'->>'zip', '')
        )), '')
      ),
      city_state_zip = nullif(trim(concat_ws(' ',
        nullif(new.payload->'property'->>'city', ''),
        nullif(new.payload->'property'->>'state', ''),
        nullif(new.payload->'property'->>'zip', '')
      )), ''),
      beds = nullif(new.payload->'property'->>'beds', '')::numeric::integer,
      baths = nullif(new.payload->'property'->>'baths', '')::numeric,
      sqft = nullif(new.payload->'property'->>'sqft', '')::integer,
      property_sqft = nullif(new.payload->'property'->>'sqft', '')::integer,
      lot_sqft = nullif(new.payload->'property'->>'lot_sqft', '')::integer,
      updated_at = now()
  where id = new.site_id;

  return new;
end;
$$;

drop trigger if exists booking_ingest_sync_property_details
  on public.booking_ingest_events;

create trigger booking_ingest_sync_property_details
after insert or update of payload on public.booking_ingest_events
for each row execute function public.sync_website_booking_property_details();

revoke all on function public.sync_website_booking_property_details() from public, anon, authenticated;

-- Repair bookings ingested before this trigger was installed.
update public.booking_ingest_events
set payload = payload
where source = 'gsvisions_website';
