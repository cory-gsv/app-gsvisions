-- Apply to the isolated beta Supabase project only while the editor is in trial.
-- Production cutover requires an explicit, separately reviewed migration run.

create table if not exists public.marketing_designs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  kind text not null check (kind in ('flyer', 'social-square')),
  template_version integer not null default 1 check (template_version > 0),
  revision integer not null default 1 check (revision > 0),
  design_json jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, kind)
);

create index if not exists marketing_designs_site_idx
  on public.marketing_designs (site_id, updated_at desc);

alter table public.marketing_designs enable row level security;
alter table public.marketing_designs force row level security;

drop policy if exists marketing_designs_select_owner_or_admin on public.marketing_designs;
create policy marketing_designs_select_owner_or_admin
on public.marketing_designs for select to authenticated
using (
  public.is_gsv_admin()
  or public.current_gsv_role() = 'staff'
  or exists (
    select 1 from public.sites s
    where s.id = marketing_designs.site_id
      and (s.client_id = auth.uid() or s.client_ms_id = auth.uid())
  )
);

drop policy if exists marketing_designs_insert_owner_or_admin on public.marketing_designs;
create policy marketing_designs_insert_owner_or_admin
on public.marketing_designs for insert to authenticated
with check (
  public.is_gsv_admin()
  or public.current_gsv_role() = 'staff'
  or exists (
    select 1 from public.sites s
    where s.id = marketing_designs.site_id
      and (s.client_id = auth.uid() or s.client_ms_id = auth.uid())
  )
);

drop policy if exists marketing_designs_update_owner_or_admin on public.marketing_designs;
create policy marketing_designs_update_owner_or_admin
on public.marketing_designs for update to authenticated
using (
  public.is_gsv_admin()
  or public.current_gsv_role() = 'staff'
  or exists (
    select 1 from public.sites s
    where s.id = marketing_designs.site_id
      and (s.client_id = auth.uid() or s.client_ms_id = auth.uid())
  )
)
with check (
  public.is_gsv_admin()
  or public.current_gsv_role() = 'staff'
  or exists (
    select 1 from public.sites s
    where s.id = marketing_designs.site_id
      and (s.client_id = auth.uid() or s.client_ms_id = auth.uid())
  )
);

revoke all on public.marketing_designs from anon;
grant select, insert, update on public.marketing_designs to authenticated;

