-- Owner-only Edge Functions use the server role after validating the caller.
-- BYPASSRLS does not confer table privileges; grant only the operations needed
-- to check ownership, validate a role, and save the new account's profile.
grant select on public.app_owner, public.app_roles to service_role;
grant select, insert, update on public.profiles to service_role;
