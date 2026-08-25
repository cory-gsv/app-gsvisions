-- Correct Matterport package tiers in catalogs where the earlier reconciliation already ran.
update public.products
set price_cents = corrected.price_cents,
    updated_at = now()
from (values
  ('matterport-media-tier-0', 45000),
  ('matterport-media-tier-1', 57000),
  ('matterport-media-tier-2', 70000),
  ('matterport-media-tier-3', 84000),
  ('matterport-media-tier-4', 105000)
) as corrected(slug, price_cents)
where public.products.slug = corrected.slug
  and public.products.price_cents is distinct from corrected.price_cents;
