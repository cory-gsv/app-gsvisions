-- Corrects customer-facing twilight pricing without depending on the original
-- catalog reconciliation migration having not yet run. Safe to run repeatedly.

update public.products
set
  price_cents = case slug
    when 'twilight-photoshoot-tier-0' then 22500
    when 'twilight-photoshoot-tier-1' then 22500
    when 'twilight-photoshoot-tier-2' then 22500
    when 'twilight-photoshoot-tier-3' then 30000
    when 'twilight-photoshoot-tier-4' then 30000
    else price_cents
  end,
  updated_at = now()
where slug in (
  'twilight-photoshoot-tier-0',
  'twilight-photoshoot-tier-1',
  'twilight-photoshoot-tier-2',
  'twilight-photoshoot-tier-3',
  'twilight-photoshoot-tier-4'
);

update public.products
set
  name = 'Large property',
  description = 'Additional on-site coverage for properties over one acre.',
  price_cents = 5000,
  unit_label = 'Over one acre',
  updated_at = now()
where slug = 'large-property';
