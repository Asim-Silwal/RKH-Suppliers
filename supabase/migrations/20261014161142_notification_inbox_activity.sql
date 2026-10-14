create schema if not exists notification_private;
revoke all on schema notification_private from public, anon, authenticated;

create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  source_key text unique not null,
  category text not null check(category in ('admin','activity')),
  title text not null,
  body text not null,
  permission text,
  recipient_id uuid,
  created_at timestamptz not null default now(),
  push_status text not null default 'queued',
  attempts integer not null default 0,
  lease_until timestamptz,
  accepted integer not null default 0,
  failed integer not null default 0
);
alter table public.notification_events enable row level security;
revoke all on public.notification_events from public, anon, authenticated;
grant all on public.notification_events to service_role;
create index notification_events_queue_idx on public.notification_events(push_status,created_at);

create table public.notification_inbox (
  event_id uuid not null references public.notification_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  title text not null,
  body text not null,
  permission text,
  created_at timestamptz not null,
  read_at timestamptz,
  primary key (user_id,event_id)
);
create index notification_inbox_feed_idx on public.notification_inbox(user_id,category,created_at desc,event_id desc);
create index notification_inbox_event_idx on public.notification_inbox(event_id);
alter table public.notification_inbox enable row level security;
revoke all on public.notification_inbox from public,anon,authenticated;
grant select on public.notification_inbox to authenticated;
grant update(read_at) on public.notification_inbox to authenticated;
grant all on public.notification_inbox to service_role;
create policy inbox_read on public.notification_inbox for select to authenticated
using(user_id=(select auth.uid()) and (permission is null or public.app_has_permission(permission)));
create policy inbox_mark_read on public.notification_inbox for update to authenticated
using(user_id=(select auth.uid()) and (permission is null or public.app_has_permission(permission)))
with check(user_id=(select auth.uid()) and (permission is null or public.app_has_permission(permission)));

create function notification_private.fanout() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.notification_inbox(event_id,user_id,category,title,body,permission,created_at)
  select new.id,p.id,new.category,new.title,new.body,new.permission,new.created_at
  from public.profiles p join public.app_roles r on r.role_key=p.role
  where (new.recipient_id is null or p.id=new.recipient_id)
    and p.created_at<=new.created_at
    and (new.permission is null or new.permission=any(r.permissions));
  return new;
end $$;
revoke all on function notification_private.fanout() from public,anon,authenticated;
create trigger notification_fanout after insert on public.notification_events for each row execute function notification_private.fanout();

create function notification_private.capture_admin() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.notification_events(id,source_key,category,title,body,recipient_id,created_at,push_status)
  values(new.id,'admin:'||new.id,'admin',new.title,new.body,new.recipient_id,new.created_at,'complete') on conflict do nothing;
  return new;
end $$;
revoke all on function notification_private.capture_admin() from public,anon,authenticated;
create trigger notification_admin_saved after insert on public.notification_sends for each row execute function notification_private.capture_admin();
-- Preserve past admin sends in recipients' inboxes, without sending them again.
insert into public.notification_events(id,source_key,category,title,body,recipient_id,created_at,push_status)
select id,'admin:'||id,'admin',title,body,recipient_id,created_at,'complete' from public.notification_sends on conflict do nothing;

create function notification_private.capture_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare
  actor text; party_name text; party_kind text; heading text; message text;
  required_permission text := 'ledger_view'; source text; amount_text text; date_text text;
begin
  select coalesce(nullif(btrim(p.full_name),''),u.email,'System') into actor
  from auth.users u left join public.profiles p on p.id=u.id where u.id=auth.uid();
  actor:=coalesce(actor,'System');
  source:=tg_table_name||':'||new.id;
  if tg_table_name='parties' then
    heading:='Party Added'; message:=format('New party "%s" added by %s.',new.name,actor);
  elsif tg_table_name='transactions' then
    select name,party_type into party_name,party_kind from public.parties where id=new.party_id;
    amount_text:='NPR '||to_char(new.amount,'FM999,999,999,999,990.00');
    date_text:=coalesce(nullif(new.date_bs,'' )||' BS',new.date_ad::text||' AD');
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
    if tg_op='UPDATE' then if old.deposited then return new; end if; end if;
    required_permission:='sahakari_view';
    select name into party_name from public.cooperatives where id=new.cooperative_id;
    heading:='Sahakari Deposited';
    message:=format('NPR %s deposited at %s for %s AD, added by %s.',to_char(new.amount,'FM999,999,999,999,990.00'),party_name,new.entry_date,actor);
  end if;
  insert into public.notification_events(source_key,category,title,body,permission)
  values(source,'activity',heading,message,required_permission) on conflict(source_key) do nothing;
  return new;
end $$;
revoke all on function notification_private.capture_activity() from public,anon,authenticated;
create trigger notify_party_added after insert on public.parties for each row execute function notification_private.capture_activity();
create trigger notify_transaction_added after insert on public.transactions for each row execute function notification_private.capture_activity();
create trigger notify_sahakari_deposited after insert or update on public.cooperative_entries for each row execute function notification_private.capture_activity();

-- Atomic leases prevent overlapping workers from sending the same event concurrently.
create function public.claim_notification_events() returns setof public.notification_events language sql security invoker set search_path='' as $$
  update public.notification_events e set push_status='processing',attempts=attempts+1,lease_until=now()+interval '3 minutes'
  where e.id in (select id from public.notification_events where attempts<3 and
    (push_status='queued' or (push_status='processing' and lease_until<now()))
    order by created_at for update skip locked limit 2) returning e.*;
$$;
revoke all on function public.claim_notification_events() from public,anon,authenticated;
grant execute on function public.claim_notification_events() to service_role;

create function public.notification_push_targets(target_event uuid)
returns table(endpoint text,p256dh text,auth text) language sql security invoker set search_path='' as $$
 select s.endpoint,s.p256dh,s.auth from public.push_subscriptions s
 join public.notification_inbox i on i.user_id=s.user_id and i.event_id=target_event
 join public.profiles p on p.id=i.user_id join public.app_roles r on r.role_key=p.role
 where i.permission is null or i.permission=any(r.permissions);
$$;
revoke all on function public.notification_push_targets(uuid) from public,anon,authenticated;
grant execute on function public.notification_push_targets(uuid) to service_role;

create table public.notification_dispatch_config(singleton boolean primary key default true check(singleton),token_hash text not null);
alter table public.notification_dispatch_config enable row level security;
revoke all on public.notification_dispatch_config from public,anon,authenticated;
grant select on public.notification_dispatch_config to service_role;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
do $$ declare token text:=encode(extensions.gen_random_bytes(32),'hex'); begin
  perform vault.create_secret(token,'notification_dispatch_token');
  insert into public.notification_dispatch_config(singleton,token_hash) values(true,encode(extensions.digest(token,'sha256'),'hex'));
end $$;
select cron.schedule('rkh-notification-delivery','* * * * *',$job$
  select net.http_post(
    url:='https://yyuilpixyrvmzxgyehme.supabase.co/functions/v1/notification-delivery',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='notification_dispatch_token')),
    body:='{}'::jsonb,timeout_milliseconds:=150000
  ) where exists(select 1 from public.notification_events where attempts<3 and (push_status='queued' or (push_status='processing' and lease_until<now())));
$job$);
