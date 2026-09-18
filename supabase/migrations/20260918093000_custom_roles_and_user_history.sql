-- Preserve the name shown in Sahakari history after an account is deleted.
alter table public.cooperative_entries add column recorded_by_name text;
update public.cooperative_entries e
set recorded_by_name = coalesce(nullif(btrim(p.full_name), ''), u.email)
from public.profiles p join auth.users u on u.id = p.id
where e.recorded_by = p.id;
alter table public.cooperative_entries drop constraint cooperative_entries_recorded_by_fkey;
alter table public.cooperative_entries add constraint cooperative_entries_recorded_by_fkey
  foreign key (recorded_by) references auth.users(id) on delete set null;
grant select (recorded_by_name) on public.cooperative_entries to authenticated;

-- Built-in roles remain fixed. The owner can add and edit custom roles through
-- the functions below; each permission is still enforced by the existing RLS.
alter table public.app_roles add column is_system boolean not null default false;
update public.app_roles set is_system = true where role_key in ('admin', 'manager', 'staff');
alter table public.app_roles add constraint app_roles_key_check
  check (role_key ~ '^[a-z][a-z0-9_]{1,39}$');
alter table public.app_roles add constraint app_roles_name_check
  check (length(btrim(name)) between 2 and 60);
alter table public.app_roles add constraint app_roles_permissions_check check (
  permissions <@ array[
    'ledger_view','parties_write','parties_delete','transactions_write',
    'transactions_delete','reports_view','sahakari_view','sahakari_record',
    'sahakari_edit','staff_balances_view'
  ]::text[]
  and (
    ('ledger_view' = any(permissions) and not 'staff_balances_view' = any(permissions))
    or permissions = array['staff_balances_view']::text[]
  )
  and (not 'sahakari_record' = any(permissions) or 'sahakari_view' = any(permissions))
  and (not 'sahakari_edit' = any(permissions) or 'sahakari_view' = any(permissions))
);

create or replace function public.create_app_role(role_name text, role_permissions text[])
returns text language plpgsql security definer set search_path = '' as $$
declare new_key text;
begin
  if not (select public.is_app_owner()) then raise exception 'Owner access required'; end if;
  role_name := btrim(role_name);
  if role_name is null or length(role_name) not between 2 and 60 then
    raise exception 'Role name must be 2 to 60 characters';
  end if;
  new_key := trim(both '_' from lower(regexp_replace(role_name, '[^a-zA-Z0-9]+', '_', 'g')));
  if new_key !~ '^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'Use a role name with 2 to 40 letters or numbers';
  end if;
  insert into public.app_roles (role_key, name, permissions)
  values (new_key, role_name, role_permissions);
  return new_key;
end;
$$;

create or replace function public.update_app_role(target_role text, role_permissions text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_app_owner()) then raise exception 'Owner access required'; end if;
  update public.app_roles set permissions = role_permissions
  where role_key = target_role and not is_system;
  if not found then raise exception 'Only custom roles can be changed'; end if;
end;
$$;

create or replace function public.delete_app_role(target_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_app_owner()) then raise exception 'Owner access required'; end if;
  if exists (select 1 from public.profiles where role = target_role) then
    raise exception 'Move users to another role before deleting this role';
  end if;
  delete from public.app_roles where role_key = target_role and not is_system;
  if not found then raise exception 'Only custom roles can be deleted'; end if;
end;
$$;

revoke all on function public.create_app_role(text,text[]) from public, anon;
revoke all on function public.update_app_role(text,text[]) from public, anon;
revoke all on function public.delete_app_role(text) from public, anon;
grant execute on function public.create_app_role(text,text[]) to authenticated;
grant execute on function public.update_app_role(text,text[]) to authenticated;
grant execute on function public.delete_app_role(text) to authenticated;
