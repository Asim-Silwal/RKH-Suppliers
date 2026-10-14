create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  updated_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant all on public.push_subscriptions to service_role;

create table public.notification_sends (
  id uuid primary key,
  sender_id uuid references auth.users(id) on delete set null,
  title text not null,
  body text not null,
  recipient_id uuid references auth.users(id) on delete set null,
  status text not null default 'sending',
  accepted integer not null default 0,
  failed integer not null default 0,
  expired integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.notification_sends enable row level security;
revoke all on public.notification_sends from anon, authenticated;
grant all on public.notification_sends to service_role;
create index notification_sends_created_idx on public.notification_sends(created_at desc);
-- Server-only credentials. No browser role can read or write the signing key.
create table public.notification_vapid (
  singleton boolean primary key default true check (singleton),
  public_key text not null,
  private_key text not null
);
alter table public.notification_vapid enable row level security;
revoke all on public.notification_vapid from public, anon, authenticated;
grant select, insert on public.notification_vapid to service_role;

