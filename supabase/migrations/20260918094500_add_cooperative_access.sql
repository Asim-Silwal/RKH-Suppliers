-- Only the app owner can add another cooperative. Existing entries stay linked
-- to their cooperative_id and are never moved by this change.
grant insert (name, default_daily_amount) on public.cooperatives to authenticated;

create policy "Owner can add cooperatives"
  on public.cooperatives for insert to authenticated
  with check ((select public.is_app_owner()));
