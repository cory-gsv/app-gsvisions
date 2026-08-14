-- Close every remaining PostgREST-exposed table reported by the Supabase
-- security advisor. Server-side workflows use service_role and bypass RLS.

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'admin_settings',
    'booking_line_items',
    'email_log',
    'package_items',
    'package_services',
    'product_categories',
    'product_components',
    'product_exclusions',
    'product_rules',
    'product_variants',
    'products',
    'site_media',
    'site_tasks',
    'sites_backup_pre_owner_migration'
  ] loop
    if to_regclass(format('public.%I', target_table)) is not null then
      execute format('alter table public.%I enable row level security', target_table);
      execute format('alter table public.%I force row level security', target_table);
      execute format('revoke all on public.%I from anon, authenticated', target_table);
    end if;
  end loop;
end $$;

-- The booking application reads the active catalog directly with the anon key.
-- Writes remain restricted to authenticated GSV administrators.
do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'products',
    'package_items',
    'package_services',
    'product_categories',
    'product_components',
    'product_exclusions',
    'product_rules',
    'product_variants'
  ] loop
    if to_regclass(format('public.%I', target_table)) is not null then
      execute format('grant select on public.%I to anon, authenticated', target_table);
      execute format('grant insert, update, delete on public.%I to authenticated', target_table);
      execute format('drop policy if exists %I on public.%I', target_table || '_catalog_read', target_table);
      execute format('drop policy if exists %I on public.%I', target_table || '_admin_write', target_table);
      execute format(
        'create policy %I on public.%I for select to anon, authenticated using (true)',
        target_table || '_catalog_read', target_table
      );
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.is_gsv_admin()) with check (public.is_gsv_admin())',
        target_table || '_admin_write', target_table
      );
    end if;
  end loop;
end $$;

-- Operational and legacy tables are never public. Admin access is explicit;
-- service_role retains access for trusted server routes and background jobs.
do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'admin_settings',
    'booking_line_items',
    'email_log',
    'site_media',
    'site_tasks'
  ] loop
    if to_regclass(format('public.%I', target_table)) is not null then
      execute format('grant select, insert, update, delete on public.%I to authenticated', target_table);
      execute format('drop policy if exists %I on public.%I', target_table || '_admin_only', target_table);
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.is_gsv_admin()) with check (public.is_gsv_admin())',
        target_table || '_admin_only', target_table
      );
    end if;
  end loop;
end $$;

-- The pre-migration backup table remains accessible only to service_role.
revoke all on table public.sites_backup_pre_owner_migration from anon, authenticated;

-- Make the exposed view obey the querying user's grants and RLS policies.
alter view if exists public.sites_with_client set (security_invoker = true);
