-- Passbook deposits supplied by the owner on 2083 Bhadra 9–31 (BS).
-- entry_date is stored as an AD date for Postgres; the app displays BS dates.
-- No row is created for Saturdays or dates absent from the passbook.
with passbook (entry_date, amount) as (
  values
    (date '2026-08-25',  5000.00), -- 2083-05-09
    (date '2026-08-26',  5000.00), -- 2083-05-10
    (date '2026-08-27',  5000.00), -- 2083-05-11
    (date '2026-08-28',  5000.00), -- 2083-05-12
    (date '2026-08-30', 10000.00), -- 2083-05-14
    (date '2026-08-31',  5000.00), -- 2083-05-15
    (date '2026-09-01',  5000.00), -- 2083-05-16
    (date '2026-09-02',  5000.00), -- 2083-05-17
    (date '2026-09-03',  5000.00), -- 2083-05-18
    (date '2026-09-04',  5000.00), -- 2083-05-19
    (date '2026-09-06', 10000.00), -- 2083-05-21
    (date '2026-09-07',  5000.00), -- 2083-05-22
    (date '2026-09-08',  5000.00), -- 2083-05-23
    (date '2026-09-09',  5000.00), -- 2083-05-24
    (date '2026-09-10',  5000.00), -- 2083-05-25
    (date '2026-09-11',  5000.00), -- 2083-05-26
    (date '2026-09-13', 10000.00), -- 2083-05-28
    (date '2026-09-15', 10000.00), -- 2083-05-30
    (date '2026-09-16',  5000.00)  -- 2083-05-31
)
insert into public.cooperative_entries (cooperative_id, entry_date, deposited, amount, recorded_by)
select c.id, p.entry_date, true, p.amount, null
from passbook p
cross join public.cooperatives c
where c.name = 'Subha Bitta Multipurpose Co-operative Ltd.'
on conflict (cooperative_id, entry_date) do nothing;
