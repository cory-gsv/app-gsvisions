create or replace function public.protect_ordering_block()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.ordering_blocked is distinct from new.ordering_blocked
    and coalesce(auth.role(), '') <> 'service_role'
    and session_user <> 'postgres'
    and not public.is_gsv_admin()
  then
    raise exception 'Only an administrator can change ordering access.';
  end if;
  return new;
end;
$$;
