-- Transactional integration checks: never commits fixtures or sends real pushes.
begin;
do $$
declare actor_id uuid; customer_id uuid; supplier_id uuid; coop_id uuid; deposit_id uuid; notice_id uuid:=gen_random_uuid();
begin
  select user_id into actor_id from public.app_owner limit 1;
  perform set_config('request.jwt.claim.sub',actor_id::text,true);
  insert into public.parties(name,party_type,contact) values('Notification test customer','customer','') returning id into customer_id;
  insert into public.parties(name,party_type,contact) values('Notification test supplier','supplier','') returning id into supplier_id;
  insert into public.transactions(party_id,type,amount,date_ad,date_bs) values
    (customer_id,'PURCHASE',1250,'2026-10-14','2083-06-28'),
    (customer_id,'PAYMENT',500,'2026-10-14','2083-06-28'),
    (supplier_id,'PURCHASE',2000,'2026-10-14','2083-06-28'),
    (supplier_id,'PAYMENT',1000,'2026-10-14','2083-06-28');
  insert into public.cooperatives(name,default_daily_amount) values('Notification test cooperative',500) returning id into coop_id;
  insert into public.cooperative_entries(cooperative_id,entry_date,deposited,reason,recorded_by)
    values(coop_id,'2026-10-14',false,'Test',actor_id) returning id into deposit_id;
  if exists(select 1 from public.notification_events where source_key='cooperative_entries:'||deposit_id) then raise exception 'Non-deposit generated alert'; end if;
  update public.cooperative_entries set deposited=true,amount=500,reason=null where id=deposit_id;
  update public.cooperative_entries set amount=600 where id=deposit_id;
  if (select count(*) from public.notification_events where source_key='cooperative_entries:'||deposit_id)<>1 then raise exception 'Deposit duplication'; end if;
  if not exists(select 1 from public.notification_events where title='Transaction' and body like 'Notification test customer purchased NPR 1,250.00%') then raise exception 'Customer message incorrect'; end if;
  if not exists(select 1 from public.notification_events where title='Transaction Added' and body like 'You purchased NPR 2,000.00 from Notification test supplier%') then raise exception 'Supplier message incorrect'; end if;
  if not exists(select 1 from public.notification_events where body like 'Notification test customer paid NPR 500.00%') then raise exception 'Customer payment incorrect'; end if;
  if not exists(select 1 from public.notification_events where body like 'You paid NPR 1,000.00 to Notification test supplier%') then raise exception 'Supplier payment incorrect'; end if;
  if not exists(select 1 from public.notification_inbox where user_id=actor_id and body like 'New party "Notification test customer"%') then raise exception 'Inbox fanout missing'; end if;
  if exists(select 1 from public.notification_inbox where body like '%Notification test%' and body like '%added by System%') then raise exception 'Actor not captured'; end if;
  insert into public.notification_sends(id,sender_id,title,body,recipient_id) values(notice_id,actor_id,'Private test','Test only',actor_id);
  if (select count(*) from public.notification_inbox where event_id=notice_id)<>1 then raise exception 'Private notification leaked'; end if;
  if has_table_privilege('authenticated','public.notification_inbox','INSERT') or has_column_privilege('authenticated','public.notification_inbox','body','UPDATE') then raise exception 'Client can forge inbox'; end if;
  if has_function_privilege('authenticated','public.claim_notification_events()','EXECUTE') then raise exception 'Client can claim delivery jobs'; end if;
end $$;
set local role authenticated;
do $$ begin
  if exists(select 1 from public.notification_inbox where user_id<>auth.uid()) then raise exception 'Cross-user read leak'; end if;
  update public.notification_inbox set read_at=now() where title='Private test';
  if not exists(select 1 from public.notification_inbox where title='Private test' and read_at is not null) then raise exception 'Read state not saved'; end if;
end $$;
reset role;
-- Current permissions are rechecked even for previously delivered inbox rows.
do $$ declare test_role text:='nt_'||replace(gen_random_uuid()::text,'-',''); begin
  insert into public.app_roles(role_key,name,permissions,is_system) values(test_role,'Notification test',array['staff_balances_view']::text[],false);
  update public.profiles set role=test_role where id=auth.uid();
end $$;
set local role authenticated;
do $$ begin
  if exists(select 1 from public.notification_inbox where permission is not null) then raise exception 'Revoked activity still readable'; end if;
  if not exists(select 1 from public.notification_inbox where title='Private test') then raise exception 'Admin messages incorrectly hidden'; end if;
end $$;
reset role;
select true as notification_integration_checks_passed;
rollback;


