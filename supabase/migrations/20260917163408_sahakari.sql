-- Daily cooperative savings, independent of ledger parties and transactions.
create table if not exists public.cooperatives (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  default_daily_amount numeric(14,2) not null default 5000
    check (default_daily_amount > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.cooperative_entries (
  id uuid primary key default gen_random_uuid(),
  cooperative_id uuid not null references public.cooperatives(id) on delete restrict,
  entry_date date not null,
  deposited boolean not null,
  amount numeric(14,2),
  reason text,
  recorded_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cooperative_entries_cooperative_date_key unique (cooperative_id, entry_date),
  constraint cooperative_entries_outcome_check check (
    (deposited = true and amount is not null and amount > 0)
    or
    (deposited = false and amount is null and reason is not null and btrim(reason) <> '')
  )
);

create index if not exists cooperative_entries_recent_idx
  on public.cooperative_entries (cooperative_id, entry_date desc);

insert into public.cooperatives (name, default_daily_amount)
values ('Subha Bitta Multipurpose Co-operative Ltd.', 5000)
on conflict (name) do nothing;

alter table public.cooperatives enable row level security;
alter table public.cooperative_entries enable row level security;

revoke all on public.cooperatives from public, anon, authenticated;
revoke all on public.cooperative_entries from public, anon, authenticated;
grant select on public.cooperatives to authenticated;
grant select on public.cooperative_entries to authenticated;
grant insert (cooperative_id, entry_date, deposited, amount, reason, recorded_by)
  on public.cooperative_entries to authenticated;
grant update (deposited, amount, reason, updated_at)
  on public.cooperative_entries to authenticated;

-- Both existing application roles may access Sahakari. The profile check also
-- excludes authenticated accounts that have not been granted an app role.
create policy "App users can view cooperatives"
  on public.cooperatives for select to authenticated
  using (
    (select auth.uid()) is not null
    and exists (select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role in ('admin', 'staff'))
  );

create policy "App users can view cooperative entries"
  on public.cooperative_entries for select to authenticated
  using (
    (select auth.uid()) is not null
    and exists (select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role in ('admin', 'staff'))
  );

create policy "App users can record cooperative entries"
  on public.cooperative_entries for insert to authenticated
  with check (
    recorded_by = (select auth.uid())
    and exists (select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role in ('admin', 'staff'))
  );

create policy "App users can update cooperative entries"
  on public.cooperative_entries for update to authenticated
  using (
    (select auth.uid()) is not null
    and exists (select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role in ('admin', 'staff'))
  )
  with check (
    (select auth.uid()) is not null
    and exists (select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role in ('admin', 'staff'))
  );
