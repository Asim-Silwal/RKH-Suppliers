-- Existing parties are customers. This changes only their classification.
alter table public.parties
  add column if not exists party_type text default 'customer';

update public.parties
set party_type = 'customer'
where party_type is null;

alter table public.parties
  alter column party_type set default 'customer',
  alter column party_type set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'parties_party_type_check'
      and conrelid = 'public.parties'::regclass
  ) then
    alter table public.parties
      add constraint parties_party_type_check
      check (party_type in ('customer', 'supplier'));
  end if;
end $$;
