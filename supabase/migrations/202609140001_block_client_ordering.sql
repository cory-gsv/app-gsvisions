alter table public.profiles
  add column if not exists ordering_blocked boolean not null default false;

create or replace function public.protect_ordering_block()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.ordering_blocked is distinct from new.ordering_blocked
    and coalesce(auth.role(), '') <> 'service_role'
    and not public.is_gsv_admin()
  then
    raise exception 'Only an administrator can change ordering access.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_ordering_block on public.profiles;
create trigger profiles_protect_ordering_block
before update of ordering_blocked on public.profiles
for each row execute function public.protect_ordering_block();
