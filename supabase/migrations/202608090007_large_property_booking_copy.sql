update public.products
set description = 'Is your property over 1 acre in size? If so, extra time is needed to properly capture it.',
    updated_at = now()
where slug = 'large-property';
