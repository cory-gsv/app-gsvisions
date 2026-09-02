-- Set the Matterport Media package for 2,001–3,000 sq. ft. to $550.
update public.products
set price_cents = 55000,
    updated_at = now()
where slug = 'matterport-media-tier-1'
  and price_cents is distinct from 55000;
