-- Attribute only the imported passbook rows to the account that recorded
-- the existing Ashoj 1 deposit. This does not change later records.
update public.cooperative_entries imported
set recorded_by = current_entry.recorded_by
from public.cooperative_entries current_entry
join public.cooperatives c on c.id = current_entry.cooperative_id
join public.profiles owner_profile on owner_profile.id = current_entry.recorded_by
where imported.cooperative_id = c.id
  and c.name = 'Subha Bitta Multipurpose Co-operative Ltd.'
  and current_entry.entry_date = date '2026-09-17' -- 2083-06-01 BS
  and owner_profile.full_name = 'Asim Silwal'
  and imported.entry_date between date '2026-08-25' and date '2026-09-16'
  and imported.recorded_by is null;

-- Profile RLS permits users to read only their own profile. Return only
-- display names of people who recorded cooperative entries to app users.
create or replace function public.cooperative_recorder_names()
returns table (user_id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name
  from public.profiles p
  where exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.role in ('admin', 'staff')
  )
    and exists (
      select 1 from public.cooperative_entries e
      where e.recorded_by = p.id
    );
$$;

revoke all on function public.cooperative_recorder_names() from public, anon;
grant execute on function public.cooperative_recorder_names() to authenticated;
