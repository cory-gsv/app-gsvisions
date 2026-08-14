-- Keep the year built returned by the website's property lookup attached to
-- the portal site created for the booking.
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
      year_built = nullif(new.payload->'property'->>'year_built', '')::integer,
      updated_at = now()
  where id = new.site_id;

  return new;
end;
$$;

-- Repair bookings ingested before this field was added. Existing rows without
-- a year remain null; rows that already carry it are populated.
update public.booking_ingest_events
set payload = payload
where source = 'gsvisions_website';
