alter table public.marketing_designs
  drop constraint if exists marketing_designs_kind_check;

alter table public.marketing_designs
  add constraint marketing_designs_kind_check
  check (kind in ('flyer', 'social-square', 'slideshow'));
