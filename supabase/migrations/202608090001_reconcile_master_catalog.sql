-- Makes the portal product catalog match the current gsvisions.co booking and
-- pricing tables. This migration is intentionally idempotent and is not
-- executed merely by committing it.

create unique index if not exists products_slug_unique
  on public.products (slug)
  where slug is not null;

do $$
declare
  tier_labels text[] := array['Up to 2,000', 'Up to 3,000', 'Up to 4,000', 'Up to 5,000', 'Up to 7,000'];
  tier_min integer[] := array[0, 2001, 3001, 4001, 5001];
  tier_max integer[] := array[2000, 3000, 4000, 5000, 7000];
  i integer;
  family record;
  product_name text;
begin
  for family in
    select * from (values
      ('standard-media', 'Standard Media', 'Listing photography, aerial drone photos, a measured 2D floor plan, and one polished virtual twilight.', array[30000,40000,50000,62000,79000]::integer[], array[100,120,155,190,230]::integer[]),
      ('matterport-media', 'Matterport Media', 'Listing photography and aerial photos paired with a measured 2D floor plan, virtual twilight, and immersive 3D Matterport tour.', array[45000,57000,56000,62000,75000]::integer[], array[135,160,215,235,310]::integer[]),
      ('video-plus', 'Video Plus', 'Photo and cinematic video coverage built for standout marketing.', array[60000,70000,80000,90000,115000]::integer[], array[210,255,315,375,480]::integer[]),
      ('signature', 'Signature', 'Our complete photo, video, aerial, floor-plan, and 3D media suite.', array[70000,80000,90000,105000,135000]::integer[], array[245,280,375,450,600]::integer[])
    ) as x(key, label, description, prices, minutes)
  loop
    for i in 1..5 loop
      product_name := family.label || ' Package (' || tier_labels[i] || ' sq. ft.)';
      insert into public.products
        (kind, type, category, name, description, price_cents, duration_minutes, min_sq_ft, max_sq_ft, sqft_min, sqft_max, active, is_active, sort_order, sort, slug, sku, price_type, taxable, unit_label)
      values
        ('package', 'package', 'packages', product_name, family.description, family.prices[i], family.minutes[i], tier_min[i], tier_max[i], tier_min[i], tier_max[i], true, true, i * 10 + case family.key when 'standard-media' then 0 when 'matterport-media' then 100 when 'video-plus' then 200 else 300 end, i * 10, family.key || '-tier-' || (i - 1), 'PKG-' || upper(replace(family.key, '-', '_')) || '-T' || (i - 1), 'fixed', true, 'package')
      on conflict (slug) where slug is not null do update set
        name = excluded.name, description = excluded.description, price_cents = excluded.price_cents,
        duration_minutes = excluded.duration_minutes, min_sq_ft = excluded.min_sq_ft,
        max_sq_ft = excluded.max_sq_ft, sqft_min = excluded.sqft_min, sqft_max = excluded.sqft_max,
        active = true, is_active = true, sort_order = excluded.sort_order, sku = excluded.sku,
        updated_at = now();
    end loop;
  end loop;

  for family in
    select * from (values
      ('photoshoot', 'Photoshoot', 'Interior and exterior MLS-ready listing photography.', array[16500,23500,33500,45000,60000]::integer[], array[45,60,90,120,150]::integer[]),
      ('cinematic-video-tour', 'Cinematic video tour', 'A professionally filmed walkthrough highlighting flow and features.', array[40000,50000,60000,70000,90000]::integer[], array[75,105,135,165,240]::integer[]),
      ('twilight-photoshoot', 'Twilight photoshoot', 'On-location exterior photography during dusk.', array[20000,25000,30000,35000,45000]::integer[], array[60,60,60,60,60]::integer[]),
      ('matterport-scanning', '3D Matterport scanning', 'An immersive room-by-room 3D property tour.', array[20000,27000,35000,42000,56000]::integer[], array[35,40,60,75,120]::integer[]),
      ('floor-plan', '2D floor plan', 'A measured floor plan showing layout and scale.', array[15000,17000,19000,21000,25000]::integer[], array[15,20,25,30,40]::integer[]),
      ('aerial-photography', 'Aerial drone photography', 'High-resolution aerial images of the property and surroundings.', array[15000,15000,15000,15000,15000]::integer[], array[40,40,40,40,40]::integer[]),
      ('aerial-video', 'Aerial drone video', 'Smooth aerial footage for property films and social media.', array[17500,17500,17500,17500,17500]::integer[], array[75,75,75,75,75]::integer[])
    ) as x(key, label, description, prices, minutes)
  loop
    for i in 1..5 loop
      product_name := family.label || ' (' || tier_labels[i] || ' sq. ft.)';
      insert into public.products
        (kind, type, category, name, description, price_cents, duration_minutes, min_sq_ft, max_sq_ft, sqft_min, sqft_max, active, is_active, sort_order, sort, slug, sku, price_type, taxable, unit_label)
      values
        ('service', 'service', 'services', product_name, family.description, family.prices[i], family.minutes[i], tier_min[i], tier_max[i], tier_min[i], tier_max[i], true, true, i * 10 + case family.key when 'photoshoot' then 0 when 'cinematic-video-tour' then 100 when 'twilight-photoshoot' then 200 when 'matterport-scanning' then 300 when 'floor-plan' then 400 when 'aerial-photography' then 500 else 600 end, i * 10, family.key || '-tier-' || (i - 1), 'SVC-' || upper(replace(family.key, '-', '_')) || '-T' || (i - 1), 'fixed', true, 'service')
      on conflict (slug) where slug is not null do update set
        name = excluded.name, description = excluded.description, price_cents = excluded.price_cents,
        duration_minutes = excluded.duration_minutes, min_sq_ft = excluded.min_sq_ft,
        max_sq_ft = excluded.max_sq_ft, sqft_min = excluded.sqft_min, sqft_max = excluded.sqft_max,
        active = true, is_active = true, sort_order = excluded.sort_order, sku = excluded.sku,
        updated_at = now();
    end loop;
  end loop;

  for family in
    select * from (values
      ('large-property', 'Large property', 'Is your property over 1 acre in size? If so, extra time is needed to properly capture it.', 5000, 'Over one acre'),
      ('marketing-kit', 'Marketing kit', 'Custom agent and office branding, property sites, automatic video reels, teaser videos, printable flyers, social graphics, and weekly traffic reports.', 8500, 'Per property'),
      ('property-domain', 'Custom property-site domain', 'A memorable custom web address for the property presentation site.', 7500, 'Per domain'),
      ('virtual-twilight', 'Virtual twilight', 'A daylight exterior transformed into a polished dusk presentation.', 3000, 'Per finished image'),
      ('virtual-staging', 'Virtual staging', 'Photorealistic furnishings added to help buyers imagine the space.', 3000, 'Per finished image'),
      ('decluttering', 'Photoshop decluttering', 'Careful digital removal of distracting objects and visual clutter.', 4000, 'Per finished image'),
      ('additional-floor-plan', 'Additional 2D floor plan', 'An extra floor-plan deliverable added to an existing order.', 5000, 'Per plan')
    ) as x(key, label, description, price, unit)
  loop
    insert into public.products
      (kind, type, category, name, description, price_cents, active, is_active, sort_order, sort, slug, sku, price_type, taxable, unit_label)
    values
      ('addon', 'addon', 'addons', family.label, family.description, family.price, true, true, 1000, 1000, family.key, 'ADD-' || upper(replace(family.key, '-', '_')), 'fixed', true, family.unit)
    on conflict (slug) where slug is not null do update set
      name = excluded.name, description = excluded.description, price_cents = excluded.price_cents,
      active = true, is_active = true, sku = excluded.sku, unit_label = excluded.unit_label,
      updated_at = now();
  end loop;

  -- Retire the old unkeyed catalog only after all canonical rows exist.
  update public.products
    set active = false, is_active = false, updated_at = now()
    where kind in ('package', 'service', 'addon') and slug is null;

  -- Rebuild canonical package contents using the same tier for tiered services.
  delete from public.package_services
    where package_id in (select id from public.products where kind = 'package' and slug is not null);

  for i in 0..4 loop
    insert into public.package_services (package_id, service_id, qty, sort_order)
    select p.id, s.id, 1, x.ord
    from (values
      ('standard-media', 'photoshoot', 10), ('standard-media', 'aerial-photography', 20), ('standard-media', 'floor-plan', 30), ('standard-media', 'virtual-twilight', 40),
      ('matterport-media', 'photoshoot', 10), ('matterport-media', 'aerial-photography', 20), ('matterport-media', 'floor-plan', 30), ('matterport-media', 'virtual-twilight', 40), ('matterport-media', 'matterport-scanning', 50),
      ('video-plus', 'photoshoot', 10), ('video-plus', 'cinematic-video-tour', 20), ('video-plus', 'aerial-photography', 30), ('video-plus', 'aerial-video', 40), ('video-plus', 'floor-plan', 50), ('video-plus', 'virtual-twilight', 60),
      ('signature', 'photoshoot', 10), ('signature', 'cinematic-video-tour', 20), ('signature', 'aerial-photography', 30), ('signature', 'aerial-video', 40), ('signature', 'floor-plan', 50), ('signature', 'virtual-twilight', 60), ('signature', 'matterport-scanning', 70)
    ) as x(package_key, item_key, ord)
    join public.products p on p.slug = x.package_key || '-tier-' || i
    join public.products s on s.slug = case
      when x.item_key in ('virtual-twilight') then x.item_key
      else x.item_key || '-tier-' || i
    end;
  end loop;
end $$;
