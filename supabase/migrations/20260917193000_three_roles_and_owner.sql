-- Fixed application roles. Staff reads customer names and balances only through
-- a restricted function; direct party and transaction reads are denied by RLS.
create table public.app_roles (
  role_key text primary key,
  name text not null unique,
  permissions text[] not null
);
insert into public.app_roles (role_key, name, permissions) values
  ('admin', 'Admin', array['ledger_view','parties_write','parties_delete','transactions_write','transactions_delete','reports_view','sahakari_view','sahakari_record','sahakari_edit']),
  ('manager', 'Manager', array['ledger_view','parties_write','transactions_write','reports_view','sahakari_view','sahakari_record']),
  ('staff', 'Staff', array['staff_balances_view']);

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_fkey
  foreign key (role) references public.app_roles(role_key);

-- The account owner is separate from the Admin role. Users cannot grant
-- themselves ownership or manage other users through browser table access.
create table public.app_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id)
);
insert into public.app_owner (singleton, user_id)
select true, u.id from auth.users u
join public.profiles p on p.id = u.id
where lower(u.email) = 'silwalasim70@gmail.com' and p.full_name = 'Asim Silwal';
do $$ begin
  if (select count(*) from public.app_owner) <> 1 then
    raise exception 'Expected exactly one Asim owner account';
  end if;
end $$;

-- Uttam's existing account becomes Manager, leaving Asim as the only Admin.
update public.profiles p set role = 'manager'
from auth.users u where u.id = p.id and lower(u.email) = 'uttamsilwal111@gmail.com';

create or replace function public.is_app_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_owner o where o.user_id = (select auth.uid()));
$$;
create or replace function public.app_has_permission(permission_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join public.app_roles r on r.role_key = p.role
    where p.id = (select auth.uid()) and permission_key = any(r.permissions)
  );
$$;

revoke all on public.app_owner from public, anon, authenticated;
revoke all on public.app_roles from public, anon, authenticated;
grant select on public.app_roles to authenticated;
alter table public.app_roles enable row level security;
create policy "Signed-in users can view role descriptions" on public.app_roles
  for select to authenticated using ((select auth.uid()) is not null);
revoke all on function public.is_app_owner() from public, anon;
revoke all on function public.app_has_permission(text) from public, anon;
grant execute on function public.is_app_owner() to authenticated;
grant execute on function public.app_has_permission(text) to authenticated;

drop policy if exists "Logged in users can view parties" on public.parties;
drop policy if exists "Admins can add parties" on public.parties;
drop policy if exists "Admins can update parties" on public.parties;
drop policy if exists "Admins can delete parties" on public.parties;
create policy "Role can view parties" on public.parties for select to authenticated
  using ((select public.app_has_permission('ledger_view')));
create policy "Role can add parties" on public.parties for insert to authenticated
  with check ((select public.app_has_permission('parties_write')));
create policy "Role can update parties" on public.parties for update to authenticated
  using ((select public.app_has_permission('parties_write')))
  with check ((select public.app_has_permission('parties_write')));
create policy "Admin can delete parties" on public.parties for delete to authenticated
  using ((select public.app_has_permission('parties_delete')));

drop policy if exists "Logged in users can view transactions" on public.transactions;
drop policy if exists "Admins can add transactions" on public.transactions;
drop policy if exists "Admins can update transactions" on public.transactions;
drop policy if exists "Admins can delete transactions" on public.transactions;
create policy "Role can view transactions" on public.transactions for select to authenticated
  using ((select public.app_has_permission('ledger_view')));
create policy "Role can add transactions" on public.transactions for insert to authenticated
  with check ((select public.app_has_permission('transactions_write')));
create policy "Role can update transactions" on public.transactions for update to authenticated
  using ((select public.app_has_permission('transactions_write')))
  with check ((select public.app_has_permission('transactions_write')));
create policy "Admin can delete transactions" on public.transactions for delete to authenticated
  using ((select public.app_has_permission('transactions_delete')));

drop policy if exists "App users can view cooperatives" on public.cooperatives;
drop policy if exists "App users can view cooperative entries" on public.cooperative_entries;
drop policy if exists "App users can record cooperative entries" on public.cooperative_entries;
drop policy if exists "App users can update cooperative entries" on public.cooperative_entries;
create policy "Role can view cooperatives" on public.cooperatives for select to authenticated
  using ((select public.app_has_permission('sahakari_view')));
create policy "Role can view cooperative entries" on public.cooperative_entries for select to authenticated
  using ((select public.app_has_permission('sahakari_view')));
create policy "Role can record cooperative entries" on public.cooperative_entries for insert to authenticated
  with check (recorded_by = (select auth.uid()) and (select public.app_has_permission('sahakari_record')));
create policy "Admin can edit cooperative entries" on public.cooperative_entries for update to authenticated
  using ((select public.app_has_permission('sahakari_edit')))
  with check ((select public.app_has_permission('sahakari_edit')));

create or replace function public.cooperative_recorder_names()
returns table (user_id uuid, full_name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name from public.profiles p
  where (select public.app_has_permission('sahakari_view'))
    and exists (select 1 from public.cooperative_entries e where e.recorded_by = p.id);
$$;

-- Staff receives only customer names and net outstanding balances.
create or replace function public.staff_customer_balances()
returns table (party_id uuid, customer_name text, remaining_balance numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select public.app_has_permission('staff_balances_view')) then
    raise exception 'Staff access required';
  end if;
  return query
    select p.id, p.name,
      greatest(coalesce(sum(case when t.type = 'PURCHASE' then t.amount
                                  when t.type = 'PAYMENT' then -t.amount
                                  else 0 end), 0), 0)::numeric
    from public.parties p left join public.transactions t on t.party_id = p.id
    where p.party_type = 'customer'
    group by p.id, p.name order by p.name;
end;
$$;

create or replace function public.list_app_users()
returns table (user_id uuid, email text, full_name text, role_key text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select public.is_app_owner()) then raise exception 'Owner access required'; end if;
  return query
    select u.id, u.email::text, p.full_name, p.role, u.created_at, u.last_sign_in_at
    from auth.users u join public.profiles p on p.id = u.id
    order by u.created_at desc;
end;
$$;

create or replace function public.assign_app_role(target_user uuid, target_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_app_owner()) then raise exception 'Owner access required'; end if;
  if target_user = (select auth.uid()) then raise exception 'You cannot change your own role'; end if;
  if target_role = 'admin' then raise exception 'Admin is reserved for the account owner'; end if;
  if not exists (select 1 from public.app_roles where role_key = target_role)
    then raise exception 'Unknown role'; end if;
  update public.profiles set role = target_role where id = target_user;
  if not found then raise exception 'User not found'; end if;
end;
$$;

revoke all on function public.staff_customer_balances() from public, anon;
revoke all on function public.list_app_users() from public, anon;
revoke all on function public.assign_app_role(uuid,text) from public, anon;
grant execute on function public.staff_customer_balances() to authenticated;
grant execute on function public.list_app_users() to authenticated;
grant execute on function public.assign_app_role(uuid,text) to authenticated;
