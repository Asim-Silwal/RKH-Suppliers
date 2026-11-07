-- RLS integration tests for the tenant migration. Run only in a disposable local
-- database or staging clone with the full migration set applied. Fixtures roll back.
begin;

do $$
declare
  user_a uuid;
  user_b uuid;
  business_a uuid;
  business_b uuid := gen_random_uuid();
  suffix text := txid_current()::text || '-' || replace(gen_random_uuid()::text,'-','');
begin
  select user_id into user_a from public.app_owner limit 1;
  select id into user_b from public.profiles where id <> user_a order by created_at limit 1;
  select id into business_a from public.businesses where slug='rkh-suppliers';
  if user_a is null or user_b is null or business_a is null then
    raise exception 'Tenant tests require the migrated RKH owner, one employee, and legacy business';
  end if;
  insert into public.businesses(id,name,slug,created_by)
    values(business_b,'Isolation Test','isolation-test-'||substr(replace(business_b::text,'-',''),1,12),user_b);
  insert into public.business_roles(business_id,role_key,name,permissions,is_system)
    select business_b,r.role_key,r.name,r.permissions,r.is_system from public.app_roles r;
  insert into public.business_roles(business_id,role_key,name,permissions,is_system)
    select business_b,'business_owner','Business Owner',r.permissions,true from public.app_roles r where r.role_key='admin';
  insert into public.business_memberships(business_id,user_id,role_key,status)
    values(business_b,user_b,'business_owner','active');
  -- Temporarily make the existing employee a member of B only for isolation tests.
  delete from public.business_memberships where business_id=business_a and user_id=user_b;
  update public.profiles set active_business_id=business_a where id=user_a;
  update public.profiles set active_business_id=business_b where id=user_b;
  perform set_config('rkh_test.user_a',user_a::text,true);
  perform set_config('rkh_test.user_b',user_b::text,true);
  perform set_config('rkh_test.business_a',business_a::text,true);
  perform set_config('rkh_test.business_b',business_b::text,true);
  perform set_config('rkh_test.suffix',suffix,true);
end $$;

-- Create Business B fixtures first so A's cross-tenant requests have real rows.
select set_config('request.jwt.claim.sub',current_setting('rkh_test.user_b'),true);
set local role authenticated;
do $$
declare suffix text:=current_setting('rkh_test.suffix'); party_b uuid; txn_b uuid;
begin
  insert into public.parties(name,party_type) values('tenant-b-'||suffix,'supplier') returning id into party_b;
  perform set_config('rkh_test.party_b',party_b::text,true);
  insert into public.transactions(party_id,type,amount,date_ad,date_bs)
    values(party_b,'PURCHASE',200,'2026-01-02','2082-09-18') returning id into txn_b;
  perform set_config('rkh_test.txn_b',txn_b::text,true);
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('rkh_test.user_a'),true);
set local role authenticated;
do $$
declare
  suffix text:=current_setting('rkh_test.suffix');
  party_a uuid;
  forced_party uuid;
  txn_a uuid;
  affected integer;
begin
  insert into public.parties(name,party_type) values('tenant-a-'||suffix,'customer') returning id into party_a;
  perform set_config('rkh_test.party_a',party_a::text,true);
  insert into public.transactions(party_id,type,amount,date_ad,date_bs)
    values(party_a,'PURCHASE',100,'2026-01-01','2082-09-17') returning id into txn_a;
  perform set_config('rkh_test.txn_a',txn_a::text,true);
  if not exists(select 1 from public.parties where id=party_a) or not exists(select 1 from public.transactions where id=txn_a) then
    raise exception 'Business A cannot read its own data';
  end if;
  -- Client-supplied tenant values on INSERT are replaced with the caller's tenant.
  insert into public.parties(business_id,name,party_type)
    values(current_setting('rkh_test.business_b')::uuid,'tenant-a-forced-'||suffix,'customer') returning id into forced_party;
  if not exists(select 1 from public.parties where id=forced_party and business_id=current_setting('rkh_test.business_a')::uuid) then
    raise exception 'INSERT allowed or retained a forged business_id';
  end if;
  begin
    insert into public.transactions(business_id,party_id,type,amount,date_ad,date_bs)
      values(current_setting('rkh_test.business_b')::uuid,current_setting('rkh_test.party_b')::uuid,'PURCHASE',50,'2026-01-03','2082-09-19');
    raise exception 'Cross-business party reference unexpectedly succeeded';
  exception when foreign_key_violation then null;
  end;
  if exists(select 1 from public.parties where name='tenant-b-'||suffix) then raise exception 'Business A read Business B party'; end if;
  if exists(select 1 from public.transactions where id=current_setting('rkh_test.txn_b')::uuid) then raise exception 'Business A read Business B transaction'; end if;
  update public.parties set name='tenant-a-updated-'||suffix where id=party_a;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Business A could not update its party'; end if;
  update public.parties set name='tenant-a-attack' where id=current_setting('rkh_test.party_b')::uuid;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Business A modified Business B party'; end if;
  delete from public.parties where id=current_setting('rkh_test.party_b')::uuid;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Business A deleted Business B party'; end if;
  update public.transactions set amount=999 where id=current_setting('rkh_test.txn_b')::uuid;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Business A modified Business B transaction'; end if;
  delete from public.transactions where id=current_setting('rkh_test.txn_b')::uuid;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Business A deleted Business B transaction'; end if;
  -- UPDATE cannot move a row to another tenant, even with a valid membership elsewhere.
  begin
    update public.parties set business_id=current_setting('rkh_test.business_b')::uuid where id=party_a;
    raise exception 'Party tenant reassignment unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm='Party tenant reassignment unexpectedly succeeded' then raise; end if;
  end;
  -- A user cannot self-join another business by writing the membership table.
  begin
    insert into public.business_memberships(business_id,user_id,role_key)
      values(current_setting('rkh_test.business_b')::uuid,auth.uid(),'admin');
    raise exception 'Unauthorized membership insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.select_business(current_setting('rkh_test.business_b')::uuid);
    raise exception 'Nonmember unexpectedly selected Business B';
  exception when raise_exception then
    if sqlerrm='Nonmember unexpectedly selected Business B' then raise; end if;
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('rkh_test.user_b'),true);
set local role authenticated;
do $$
declare suffix text:=current_setting('rkh_test.suffix'); party_b uuid; txn_b uuid; affected integer;
begin
  insert into public.parties(name,party_type) values('tenant-b-'||suffix,'supplier') returning id into party_b;
  perform set_config('rkh_test.party_b',party_b::text,true);
  insert into public.transactions(party_id,type,amount,date_ad,date_bs)
    values(party_b,'PURCHASE',200,'2026-01-02','2082-09-18') returning id into txn_b;
  perform set_config('rkh_test.txn_b',txn_b::text,true);
  if not exists(select 1 from public.parties where id=party_b) then raise exception 'Business B cannot read its party'; end if;
  if not exists(select 1 from public.transactions where id=txn_b) then raise exception 'Business B cannot read its transaction'; end if;
  if exists(select 1 from public.parties where id=current_setting('rkh_test.party_a')::uuid) then raise exception 'Business B read Business A party'; end if;
  if exists(select 1 from public.transactions where id=current_setting('rkh_test.txn_a')::uuid) then raise exception 'Business B read Business A transaction'; end if;
  update public.parties set name='tenant-b-updated-'||suffix where id=party_b;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Business B could not update its party'; end if;
  update public.parties set name='tenant-b-attack' where id=current_setting('rkh_test.party_a')::uuid;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Business B modified Business A party'; end if;
  delete from public.parties where id=current_setting('rkh_test.party_a')::uuid;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Business B deleted Business A party'; end if;
  update public.transactions set amount=999 where id=current_setting('rkh_test.txn_a')::uuid;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Business B modified Business A transaction'; end if;
  delete from public.transactions where id=current_setting('rkh_test.txn_a')::uuid;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Business B deleted Business A transaction'; end if;
  update public.transactions set amount=201 where id=txn_b;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Business B could not update its transaction'; end if;
  delete from public.transactions where id=txn_b;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Business B could not delete its own transaction'; end if;
  -- Own-row DELETE is independently authorized by the delete policy.
  delete from public.parties where id=party_b;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Business B could not delete its own party'; end if;
end $$;
reset role;
rollback;
