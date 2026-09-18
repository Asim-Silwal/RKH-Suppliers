-- Admin remains the protected owner role. Manager and Staff can now be
-- managed through the same owner-only controls as newly created roles.
update public.app_roles set is_system = false where role_key in ('manager', 'staff');

create or replace function public.update_app_role_details(
  target_role text, role_name text, role_permissions text[]
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_app_owner()) then raise exception 'Owner access required'; end if;
  role_name := btrim(role_name);
  if role_name is null or length(role_name) not between 2 and 60 then
    raise exception 'Role name must be 2 to 60 characters';
  end if;
  update public.app_roles
  set name = role_name, permissions = role_permissions
  where role_key = target_role and not is_system and role_key <> 'admin';
  if not found then raise exception 'The Admin role cannot be changed'; end if;
end;
$$;

revoke all on function public.update_app_role_details(text,text,text[]) from public, anon;
grant execute on function public.update_app_role_details(text,text,text[]) to authenticated;
