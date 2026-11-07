-- Convert the existing single ledger into tenant-scoped businesses. Existing
-- rows and users are retained in the original RKH Suppliers workspace.
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status text not null default 'active' check (status in ('active','suspended','closed')),
  timezone text not null default 'Asia/Kathmandu',
  default_currency text not null default 'NPR' check (default_currency ~ '^[A-Z]{3}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.business_roles (
  business_id uuid not null references public.businesses(id) on delete cascade,
  role_key text not null check (role_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  name text not null check (length(btrim(name)) between 2 and 60),
  permissions text[] not null check (
    permissions <@ array['ledger_view','parties_write','parties_delete','transactions_write','transactions_delete','reports_view','sahakari_view','sahakari_record','sahakari_edit','staff_balances_view']::text[]
    and (('ledger_view'=any(permissions) and not ('staff_balances_view'=any(permissions))) or permissions=array['staff_balances_view']::text[])
    and (not ('sahakari_record'=any(permissions)) or 'sahakari_view'=any(permissions))
    and (not ('sahakari_edit'=any(permissions)) or 'sahakari_view'=any(permissions))
  ),
  is_system boolean not null default false,
  primary key (business_id,role_key)
);
create unique index business_roles_name_unique on public.business_roles(business_id,name);
create table public.business_memberships (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_key text not null,
  status text not null default 'active' check (status in ('invited','active','suspended','removed')),
  joined_at timestamptz not null default now(),
  primary key (business_id,user_id)
);
alter table public.business_memberships add constraint business_memberships_role_fkey
  foreign key(business_id,role_key) references public.business_roles(business_id,role_key);
create index business_memberships_user_status_idx on public.business_memberships(user_id,status,business_id);
create index business_memberships_business_role_idx on public.business_memberships(business_id,role_key);
alter table public.profiles add column active_business_id uuid references public.businesses(id);

insert into public.businesses(id,name,slug,created_by)
select gen_random_uuid(),'RKH Suppliers','rkh-suppliers', user_id from public.app_owner;
insert into public.business_roles(business_id,role_key,name,permissions,is_system)
select b.id,r.role_key,r.name,r.permissions,r.is_system from public.businesses b cross join public.app_roles r;
insert into public.business_roles(business_id,role_key,name,permissions,is_system)
select b.id,'business_owner','Business Owner',r.permissions,true from public.businesses b join public.app_roles r on r.role_key='admin';
insert into public.business_memberships(business_id,user_id,role_key)
select b.id,p.id,p.role from public.businesses b cross join public.profiles p
where p.role is not null;
update public.business_memberships m set role_key='business_owner'
where m.business_id=(select id from public.businesses where slug='rkh-suppliers')
  and m.user_id in (select user_id from public.app_owner);
update public.profiles set active_business_id=(select id from public.businesses where slug='rkh-suppliers');

alter table public.parties add column business_id uuid references public.businesses(id);
update public.parties set business_id=(select id from public.businesses where slug='rkh-suppliers');
alter table public.parties alter column business_id set not null;
alter table public.parties add constraint parties_business_id_id_key unique(business_id,id);
create index parties_business_name_idx on public.parties(business_id,name);

alter table public.transactions add column business_id uuid references public.businesses(id);
update public.transactions t set business_id=p.business_id from public.parties p where p.id=t.party_id;
alter table public.transactions alter column business_id set not null;
alter table public.transactions add constraint transactions_party_business_fkey
  foreign key(business_id,party_id) references public.parties(business_id,id) on delete cascade;
create index transactions_business_date_idx on public.transactions(business_id,date_ad desc);
create index transactions_business_party_idx on public.transactions(business_id,party_id);

alter table public.cooperatives add column business_id uuid references public.businesses(id);
update public.cooperatives set business_id=(select id from public.businesses where slug='rkh-suppliers');
alter table public.cooperatives alter column business_id set not null;
alter table public.cooperatives add constraint cooperatives_business_id_id_key unique(business_id,id);
alter table public.cooperatives drop constraint if exists cooperatives_name_key;
create unique index cooperatives_business_name_key on public.cooperatives(business_id,name);
alter table public.cooperative_entries add column business_id uuid references public.businesses(id);
update public.cooperative_entries e set business_id=c.business_id from public.cooperatives c where c.id=e.cooperative_id;
alter table public.cooperative_entries alter column business_id set not null;
alter table public.cooperative_entries add constraint cooperative_entry_business_cooperative_fkey
  foreign key(business_id,cooperative_id) references public.cooperatives(business_id,id) on delete restrict;
create index cooperative_entries_business_date_idx on public.cooperative_entries(business_id,entry_date desc);
create index cooperative_entries_business_cooperative_idx on public.cooperative_entries(business_id,cooperative_id);

-- Notifications carry the originating tenant too, including existing history.
alter table public.notification_events add column business_id uuid references public.businesses(id);
update public.notification_events set business_id=(select id from public.businesses where slug='rkh-suppliers');
alter table public.notification_events alter column business_id set not null;
alter table public.notification_events add constraint notification_events_business_id_id_key unique(business_id,id);
alter table public.notification_events alter column business_id drop default;
alter table public.notification_events enable row level security;
revoke all on public.notification_events from public,anon,authenticated;
alter table public.notification_sends add column business_id uuid references public.businesses(id);
update public.notification_sends set business_id=(select id from public.businesses where slug='rkh-suppliers');
alter table public.notification_sends alter column business_id set not null;
create index notification_sends_business_created_idx on public.notification_sends(business_id,created_at desc);
alter table public.notification_sends enable row level security;
revoke all on public.notification_sends from public,anon,authenticated;
alter table public.notification_inbox add column business_id uuid references public.businesses(id);
update public.notification_inbox i set business_id=e.business_id from public.notification_events e where e.id=i.event_id;
alter table public.notification_inbox alter column business_id set not null;
alter table public.notification_inbox add constraint notification_inbox_event_business_fkey
  foreign key(business_id,event_id) references public.notification_events(business_id,id) on delete cascade;
create index notification_inbox_business_feed_idx on public.notification_inbox(business_id,user_id,created_at desc,event_id desc);
create index notification_inbox_business_event_idx on public.notification_inbox(business_id,event_id);
create or replace function public.active_business_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.active_business_id from public.profiles p join public.businesses b on b.id=p.active_business_id
    where p.id=(select auth.uid()) and b.status='active'
    and exists(select 1 from public.business_memberships m
      where m.user_id=p.id and m.business_id=p.active_business_id and m.status='active')
$$;
drop policy if exists inbox_read on public.notification_inbox;
drop policy if exists inbox_mark_read on public.notification_inbox;
create policy inbox_read on public.notification_inbox for select to authenticated
  using(user_id=(select auth.uid()) and business_id=(select public.active_business_id())
    and (permission is null or public.app_has_permission(permission)));
create policy inbox_mark_read on public.notification_inbox for update to authenticated
  using(user_id=(select auth.uid()) and business_id=(select public.active_business_id())
    and (permission is null or public.app_has_permission(permission)))
  with check(user_id=(select auth.uid()) and business_id=(select public.active_business_id())
    and (permission is null or public.app_has_permission(permission)));
revoke all on public.notification_inbox from public,anon,authenticated;
grant select on public.notification_inbox to authenticated;
grant update(read_at) on public.notification_inbox to authenticated;
create or replace function notification_private.fanout() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.notification_inbox(event_id,user_id,business_id,category,title,body,permission,created_at)
  select new.id,m.user_id,new.business_id,new.category,new.title,new.body,new.permission,new.created_at
  from public.business_memberships m join public.business_roles r on r.business_id=m.business_id and r.role_key=m.role_key
  where m.business_id=new.business_id and m.status='active' and (new.recipient_id is null or m.user_id=new.recipient_id)
    and (new.permission is null or new.permission=any(r.permissions));
  return new;
end $$;
create or replace function notification_private.capture_admin() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.notification_events(id,source_key,category,title,body,recipient_id,business_id,created_at,push_status)
  values(new.id,'admin:'||new.id,'admin',new.title,new.body,new.recipient_id,new.business_id,new.created_at,'complete')
  on conflict do nothing;
  return new;
end $$;

create or replace function notification_private.capture_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare actor text; party_name text; party_kind text; heading text; message text;
  required_permission text:='ledger_view'; amount_text text; date_text text; tenant uuid:=new.business_id;
begin
  select coalesce(nullif(btrim(p.full_name),''),u.email,'System') into actor
    from auth.users u left join public.profiles p on p.id=u.id where u.id=auth.uid();
  actor:=coalesce(actor,'System');
  if tg_table_name='parties' then
    heading:='Party Added'; message:=format('New party "%s" added by %s.',new.name,actor);
  elsif tg_table_name='transactions' then
    select name,party_type into party_name,party_kind from public.parties
      where business_id=tenant and id=new.party_id;
    amount_text:='NPR '||to_char(new.amount,'FM999,999,999,999,990.00');
    date_text:=coalesce(nullif(new.date_bs,'')||' BS',new.date_ad::text||' AD');
    if party_kind='customer' then
      heading:='Transaction';
      if new.type='PURCHASE' then message:=format('%s purchased %s on %s, added by %s.',party_name,amount_text,date_text,actor);
      else message:=format('%s paid %s on %s, added by %s.',party_name,amount_text,date_text,actor); end if;
    else
      heading:='Transaction Added';
      if new.type='PURCHASE' then message:=format('You purchased %s from %s on %s, added by %s.',amount_text,party_name,date_text,actor);
      else message:=format('You paid %s to %s on %s, added by %s.',amount_text,party_name,date_text,actor); end if;
    end if;
  else
    if not new.deposited then return new; end if;
    if tg_op='UPDATE' and old.deposited then return new; end if;
    required_permission:='sahakari_view';
    select name into party_name from public.cooperatives where business_id=tenant and id=new.cooperative_id;
    heading:='Sahakari Deposited';
    message:=format('NPR %s deposited at %s for %s AD, added by %s.',to_char(new.amount,'FM999,999,999,999,990.00'),party_name,new.entry_date,actor);
  end if;
  insert into public.notification_events(source_key,category,title,body,permission,business_id)
    values(tg_table_name||':'||new.id,'activity',heading,message,required_permission,tenant)
    on conflict(source_key) do nothing;
  return new;
end $$;
revoke all on function notification_private.capture_activity() from public,anon,authenticated;

create or replace function public.active_business_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.active_business_id from public.profiles p join public.businesses b on b.id=p.active_business_id
    where p.id=(select auth.uid()) and b.status='active'
    and exists(select 1 from public.business_memberships m
      where m.user_id=p.id and m.business_id=p.active_business_id and m.status='active')
$$;
create or replace function public.app_has_permission(permission_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p
    join public.business_memberships m on m.user_id=p.id and m.business_id=p.active_business_id
    join public.business_roles r on r.business_id=m.business_id and r.role_key=m.role_key
    join public.businesses b on b.id=m.business_id and b.status='active'
    where p.id=(select auth.uid()) and m.status='active' and permission_key=any(r.permissions))
$$;
create or replace function public.is_app_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.business_memberships m
    where m.user_id=(select auth.uid()) and m.business_id=(select public.active_business_id())
      and m.role_key='business_owner' and m.status='active')
$$;
create or replace function public.is_business_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.business_memberships m
    where m.user_id=(select auth.uid()) and m.business_id=(select public.active_business_id())
      and m.status='active' and m.role_key in ('business_owner','admin'))
$$;

create or replace function public.set_business_tenant()
returns trigger language plpgsql security definer set search_path = '' as $$
declare tenant uuid;
begin
  if tg_op='INSERT' then
    tenant := (select public.active_business_id());
    if tenant is null then raise exception 'Select a business first'; end if;
    new.business_id:=tenant;
  elsif new.business_id is distinct from old.business_id then raise exception 'Business cannot be changed';
  end if;
  return new;
end $$;
create trigger parties_set_tenant before insert or update on public.parties
  for each row execute function public.set_business_tenant();
create trigger transactions_set_tenant before insert or update on public.transactions
  for each row execute function public.set_business_tenant();
create trigger cooperatives_set_tenant before insert or update on public.cooperatives
  for each row execute function public.set_business_tenant();
create trigger cooperative_entries_set_tenant before insert or update on public.cooperative_entries
  for each row execute function public.set_business_tenant();

-- SECURITY DEFINER legacy read helpers must scope every result to the active
-- tenant because their queries do not inherit caller RLS.
create or replace function public.staff_customer_balances()
returns table (party_id uuid, customer_name text, remaining_balance numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select public.app_has_permission('staff_balances_view')) then raise exception 'Staff access required'; end if;
  return query
    select p.id,p.name,greatest(coalesce(sum(case when t.type='PURCHASE' then t.amount
      when t.type='PAYMENT' then -t.amount else 0 end),0),0)::numeric
    from public.parties p left join public.transactions t
      on t.business_id=p.business_id and t.party_id=p.id
    where p.business_id=(select public.active_business_id()) and p.party_type='customer'
    group by p.id,p.name order by p.name;
end $$;
create or replace function public.cooperative_recorder_names()
returns table (user_id uuid, full_name text)
language sql stable security definer set search_path = '' as $$
  select p.id,p.full_name from public.profiles p
  where (select public.app_has_permission('sahakari_view'))
    and exists(select 1 from public.cooperative_entries e where e.business_id=(select public.active_business_id()) and e.recorded_by=p.id)
$$;
create or replace function public.notification_push_targets(target_event uuid)
returns table(endpoint text,p256dh text,auth text)
language sql security invoker set search_path = '' as $$
  select s.endpoint,s.p256dh,s.auth from public.push_subscriptions s
  join public.notification_inbox i on i.user_id=s.user_id and i.event_id=target_event
  join public.business_memberships m on m.business_id=i.business_id and m.user_id=i.user_id and m.status='active'
  join public.business_roles r on r.business_id=m.business_id and r.role_key=m.role_key
  where i.permission is null or i.permission=any(r.permissions)
$$;

-- Replace permission-only policies with tenant plus permission checks.
drop policy if exists "Role can view parties" on public.parties;
drop policy if exists "Role can add parties" on public.parties;
drop policy if exists "Role can update parties" on public.parties;
drop policy if exists "Admin can delete parties" on public.parties;
create policy parties_tenant_read on public.parties for select to authenticated
  using (business_id=(select public.active_business_id()) and (select public.app_has_permission('ledger_view')));
create policy parties_tenant_insert on public.parties for insert to authenticated
  with check (business_id=(select public.active_business_id()) and (select public.app_has_permission('parties_write')));
create policy parties_tenant_update on public.parties for update to authenticated
  using (business_id=(select public.active_business_id()) and (select public.app_has_permission('parties_write')))
  with check (business_id=(select public.active_business_id()) and (select public.app_has_permission('parties_write')));
create policy parties_tenant_delete on public.parties for delete to authenticated
  using (business_id=(select public.active_business_id()) and (select public.app_has_permission('parties_delete')));
drop policy if exists "Role can view transactions" on public.transactions;
drop policy if exists "Role can add transactions" on public.transactions;
drop policy if exists "Role can update transactions" on public.transactions;
drop policy if exists "Admin can delete transactions" on public.transactions;
create policy transactions_tenant_read on public.transactions for select to authenticated
  using (business_id=(select public.active_business_id()) and (select public.app_has_permission('ledger_view')));
create policy transactions_tenant_insert on public.transactions for insert to authenticated
  with check (business_id=(select public.active_business_id()) and (select public.app_has_permission('transactions_write')));
create policy transactions_tenant_update on public.transactions for update to authenticated
  using (business_id=(select public.active_business_id()) and (select public.app_has_permission('transactions_write')))
  with check (business_id=(select public.active_business_id()) and (select public.app_has_permission('transactions_write')));
create policy transactions_tenant_delete on public.transactions for delete to authenticated
  using (business_id=(select public.active_business_id()) and (select public.app_has_permission('transactions_delete')));
drop policy if exists "Role can view cooperatives" on public.cooperatives;
drop policy if exists "Owner can add cooperatives" on public.cooperatives;
drop policy if exists "Role can view cooperative entries" on public.cooperative_entries;
drop policy if exists "Role can record cooperative entries" on public.cooperative_entries;
drop policy if exists "Admin can edit cooperative entries" on public.cooperative_entries;
create policy cooperatives_tenant_read on public.cooperatives for select to authenticated
  using (business_id=(select public.active_business_id()) and (select public.app_has_permission('sahakari_view')));
create policy cooperatives_tenant_insert on public.cooperatives for insert to authenticated
  with check (business_id=(select public.active_business_id()) and (select public.app_has_permission('parties_delete')));
create policy cooperatives_tenant_update on public.cooperatives for update to authenticated
  using (business_id=(select public.active_business_id()) and (select public.app_has_permission('sahakari_edit')))
  with check (business_id=(select public.active_business_id()) and (select public.app_has_permission('sahakari_edit')));
create policy cooperative_entries_tenant_read on public.cooperative_entries for select to authenticated
  using (business_id=(select public.active_business_id()) and (select public.app_has_permission('sahakari_view')));
create policy cooperative_entries_tenant_insert on public.cooperative_entries for insert to authenticated
  with check (business_id=(select public.active_business_id()) and recorded_by=(select auth.uid()) and (select public.app_has_permission('sahakari_record')));
create policy cooperative_entries_tenant_update on public.cooperative_entries for update to authenticated
  using (business_id=(select public.active_business_id()) and (select public.app_has_permission('sahakari_edit')))
  with check (business_id=(select public.active_business_id()) and (select public.app_has_permission('sahakari_edit')));

-- Remove inherited broad grants (including TRUNCATE, which bypasses RLS) and
-- regrant only the operations the application actually uses.
revoke all on public.parties,public.transactions,public.cooperatives,public.cooperative_entries
  from public,anon,authenticated;
grant select,insert,update,delete on public.parties,public.transactions to authenticated;
grant select,insert,update on public.cooperatives to authenticated;
grant select,insert,update on public.cooperative_entries to authenticated;
alter table public.parties enable row level security;
alter table public.transactions enable row level security;
alter table public.cooperatives enable row level security;
alter table public.cooperative_entries enable row level security;

alter table public.businesses enable row level security;
alter table public.business_memberships enable row level security;
create policy businesses_member_read on public.businesses for select to authenticated
  using (status='active' and exists(select 1 from public.business_memberships m where m.business_id=id and m.user_id=(select auth.uid()) and m.status='active'));
alter table public.business_roles enable row level security;
create policy business_roles_member_read on public.business_roles for select to authenticated
  using (business_id=(select public.active_business_id()));
create policy memberships_self_read on public.business_memberships for select to authenticated
  using ((user_id=(select auth.uid()) and status='active') or (business_id=(select public.active_business_id()) and (select public.is_business_admin())));
revoke all on public.businesses,public.business_roles,public.business_memberships from public,anon,authenticated;
grant select on public.businesses,public.business_memberships to authenticated;
grant select on public.business_roles to authenticated;
-- Remove any permissive legacy profile policies before granting only self access.
do $$ declare policy_name text; begin
  for policy_name in select policyname from pg_policies where schemaname='public' and tablename='profiles'
  loop execute format('drop policy %I on public.profiles',policy_name); end loop;
end $$;
revoke all on public.profiles from public,anon,authenticated;
grant select on public.profiles to authenticated;
grant update(full_name,contact,avatar_path,updated_at) on public.profiles to authenticated;
create policy profiles_select_self on public.profiles for select to authenticated using(id=(select auth.uid()));
create policy profiles_update_self on public.profiles for update to authenticated
  using(id=(select auth.uid())) with check(id=(select auth.uid()));

create or replace function public.create_business(business_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid; new_slug text; base_slug text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  business_name:=btrim(business_name);
  if business_name is null or length(business_name) not between 2 and 120 then raise exception 'Business name must be 2 to 120 characters'; end if;
  base_slug:=trim(both '-' from regexp_replace(lower(business_name),'[^a-z0-9]+','-','g'));
  if base_slug='' then base_slug:='business'; end if;
  new_slug:=left(base_slug,45)||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,8);
  insert into public.businesses(name,slug,created_by) values(business_name,new_slug,auth.uid()) returning id into new_id;
  insert into public.business_roles(business_id,role_key,name,permissions,is_system)
    select new_id,r.role_key,r.name,r.permissions,r.is_system from public.app_roles r;
  insert into public.business_roles(business_id,role_key,name,permissions,is_system)
    select new_id,'business_owner','Business Owner',r.permissions,true from public.app_roles r where r.role_key='admin';
  insert into public.business_memberships(business_id,user_id,role_key,status) values(new_id,auth.uid(),'business_owner','active');
  update public.profiles set active_business_id=new_id where id=auth.uid();
  return new_id;
end $$;
create or replace function public.create_business_role(role_name text, role_permissions text[])
returns text language plpgsql security definer set search_path = '' as $$
declare tenant uuid; new_key text;
begin
  tenant:=(select public.active_business_id());
  if tenant is null or not (select public.is_business_admin()) then raise exception 'Business administrator access required'; end if;
  role_name:=btrim(role_name);
  if role_name is null or length(role_name) not between 2 and 60 or role_permissions is null then raise exception 'Invalid role name or permissions'; end if;
  if not role_permissions <@ array['ledger_view','parties_write','parties_delete','transactions_write','transactions_delete','reports_view','sahakari_view','sahakari_record','sahakari_edit','staff_balances_view']::text[] then raise exception 'Unknown permission'; end if;
  new_key:=trim(both '_' from lower(regexp_replace(role_name,'[^a-zA-Z0-9]+','_','g')));
  if new_key !~ '^[a-z][a-z0-9_]{1,39}$' then raise exception 'Use a role name with 2 to 40 letters or numbers'; end if;
  insert into public.business_roles(business_id,role_key,name,permissions,is_system) values(tenant,new_key,role_name,role_permissions,false);
  return new_key;
end $$;
create or replace function public.update_business_role_details(target_role text, role_name text, role_permissions text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_business_admin()) then raise exception 'Business administrator access required'; end if;
  role_name:=btrim(role_name);
  if role_name is null or length(role_name) not between 2 and 60 then raise exception 'Invalid role name'; end if;
  update public.business_roles set name=role_name,permissions=role_permissions
    where business_id=(select public.active_business_id()) and role_key=target_role and not is_system;
  if not found then raise exception 'Built-in or unknown role cannot be changed'; end if;
end $$;
create or replace function public.delete_business_role(target_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_business_admin()) then raise exception 'Business administrator access required'; end if;
  if exists(select 1 from public.business_memberships where business_id=(select public.active_business_id()) and role_key=target_role) then raise exception 'Move members to another role before deleting this role'; end if;
  delete from public.business_roles where business_id=(select public.active_business_id()) and role_key=target_role and not is_system;
  if not found then raise exception 'Only business custom roles can be deleted'; end if;
end $$;
create or replace function public.select_business(target_business uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.business_memberships m join public.businesses b on b.id=m.business_id
      where m.business_id=target_business and m.user_id=auth.uid() and m.status='active' and b.status='active') then
    raise exception 'You are not a member of this business';
  end if;
  update public.profiles set active_business_id=target_business where id=auth.uid();
end $$;
create or replace function public.list_app_users()
returns table (user_id uuid, email text, full_name text, role_key text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select public.is_business_admin()) then raise exception 'Business administrator access required'; end if;
  return query select u.id,u.email::text,p.full_name,m.role_key,u.created_at,u.last_sign_in_at
    from public.business_memberships m join auth.users u on u.id=m.user_id
    left join public.profiles p on p.id=m.user_id
    where m.business_id=(select public.active_business_id()) and m.status='active' order by u.created_at desc;
end $$;
create or replace function public.assign_app_role(target_user uuid, target_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_business_admin()) then raise exception 'Business administrator access required'; end if;
  if target_user=(select auth.uid()) then raise exception 'You cannot change your own role'; end if;
  if target_role='business_owner' then raise exception 'Business ownership can only be assigned through an owner transfer'; end if;
  if exists(select 1 from public.business_memberships where business_id=(select public.active_business_id()) and user_id=target_user and role_key='business_owner') then
    raise exception 'Business ownership cannot be changed through role assignment';
  end if;
  if target_role='admin' and not (select public.is_app_owner()) then raise exception 'Only the business owner can appoint an administrator'; end if;
  if not exists(select 1 from public.business_roles where business_id=(select public.active_business_id()) and role_key=target_role) then raise exception 'Unknown role'; end if;
  update public.business_memberships set role_key=target_role
    where business_id=(select public.active_business_id()) and user_id=target_user and status='active';
  if not found then raise exception 'Business member not found'; end if;
end $$;
-- Retain the legacy platform role catalog for compatibility. Tenant role
-- definitions are copied at business creation and remain business-scoped.
create or replace function public.create_app_role(role_name text, role_permissions text[])
returns text language plpgsql security definer set search_path = '' as $$
declare new_key text;
begin
  if not exists(select 1 from public.app_owner where user_id=(select auth.uid())) then raise exception 'Platform owner access required'; end if;
  role_name:=btrim(role_name);
  if role_name is null or length(role_name) not between 2 and 60 then raise exception 'Role name must be 2 to 60 characters'; end if;
  new_key:=trim(both '_' from lower(regexp_replace(role_name,'[^a-zA-Z0-9]+','_','g')));
  if new_key !~ '^[a-z][a-z0-9_]{1,39}$' then raise exception 'Use a role name with 2 to 40 letters or numbers'; end if;
  insert into public.app_roles(role_key,name,permissions) values(new_key,role_name,role_permissions);
  return new_key;
end $$;
create or replace function public.update_app_role_details(target_role text, role_name text, role_permissions text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.app_owner where user_id=(select auth.uid())) then raise exception 'Platform owner access required'; end if;
  role_name:=btrim(role_name);
  if role_name is null or length(role_name) not between 2 and 60 then raise exception 'Role name must be 2 to 60 characters'; end if;
  update public.app_roles set name=role_name,permissions=role_permissions where role_key=target_role and not is_system and role_key<>'admin';
  if not found then raise exception 'The Admin role cannot be changed'; end if;
end $$;
create or replace function public.delete_app_role(target_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.app_owner where user_id=(select auth.uid())) then raise exception 'Platform owner access required'; end if;
  if exists(select 1 from public.business_memberships where role_key=target_role) then raise exception 'Move members to another role before deleting this role'; end if;
  delete from public.app_roles where role_key=target_role and not is_system;
  if not found then raise exception 'Only custom roles can be deleted'; end if;
end $$;
revoke all on function public.active_business_id(),public.app_has_permission(text),public.is_app_owner(),public.is_business_admin() from public,anon;
grant execute on function public.active_business_id(),public.app_has_permission(text),public.is_app_owner(),public.is_business_admin() to authenticated;
revoke all on function public.set_business_tenant() from public,anon,authenticated;
revoke all on function public.staff_customer_balances(),public.cooperative_recorder_names() from public,anon;
grant execute on function public.staff_customer_balances(),public.cooperative_recorder_names() to authenticated;
revoke all on function public.notification_push_targets(uuid) from public,anon,authenticated;
grant execute on function public.notification_push_targets(uuid) to service_role;
revoke all on function public.create_business(text),public.select_business(uuid) from public,anon;
grant execute on function public.create_business(text),public.select_business(uuid) to authenticated;
revoke all on function public.list_app_users(),public.assign_app_role(uuid,text) from public,anon;
grant execute on function public.list_app_users(),public.assign_app_role(uuid,text) to authenticated;
revoke all on function public.create_business_role(text,text[]),public.update_business_role_details(text,text,text[]),public.delete_business_role(text) from public,anon;
grant execute on function public.create_business_role(text,text[]),public.update_business_role_details(text,text,text[]),public.delete_business_role(text) to authenticated;
