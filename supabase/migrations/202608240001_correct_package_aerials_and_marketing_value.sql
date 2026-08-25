-- Idempotently correct catalogs that already ran the August 9 reconciliation.
do $$
declare
  tier_index integer;
  package_slug text;
  service_slug text;
  next_sort integer;
begin
  update public.products
  set price_cents = 10000, updated_at = now()
  where slug = 'marketing-kit' and price_cents is distinct from 10000;

  update public.products
  set description = case
    when slug like 'video-plus-tier-%' then 'Photo and cinematic video coverage with aerial drone photography and video.'
    else 'Our complete photo, video, aerial photography, aerial video, floor-plan, and 3D media suite.'
  end,
  updated_at = now()
  where slug like 'video-plus-tier-%' or slug like 'signature-tier-%';

  for tier_index in 0..4 loop
    foreach package_slug in array array['video-plus-tier-' || tier_index, 'signature-tier-' || tier_index] loop
      foreach service_slug in array array['aerial-photography-tier-' || tier_index, 'aerial-video-tier-' || tier_index] loop
        select coalesce(max(ps.sort_order), 0) + 10 into next_sort
        from public.package_services ps
        join public.products p on p.id = ps.package_id
        where p.slug = package_slug;

        insert into public.package_services (package_id, service_id, qty, sort_order)
        select p.id, s.id, 1, next_sort
        from public.products p
        join public.products s on s.slug = service_slug
        where p.slug = package_slug
          and not exists (
            select 1 from public.package_services existing
            where existing.package_id = p.id and existing.service_id = s.id
          );
      end loop;
    end loop;
  end loop;
end $$;
