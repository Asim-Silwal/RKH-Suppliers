-- Keep browser clients from granting themselves admin access, even if a broad
-- profiles update policy exists. Trusted database code and the Edge Function's
-- service role may still assign roles.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    if tg_op = 'INSERT' and new.role <> 'staff' then
      raise exception 'Only an administrator can assign roles';
    end if;
    if tg_op = 'UPDATE' and new.role is distinct from old.role then
      raise exception 'Only an administrator can change roles';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role
before insert or update of role on public.profiles
for each row execute function public.protect_profile_role();

-- These trigger functions are internal, not Data API endpoints.
revoke execute on function public.protect_profile_role() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
