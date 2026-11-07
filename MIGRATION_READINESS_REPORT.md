# Migration Readiness Report

**Target migration:** `supabase/migrations/20261107090000_multi_business_tenants.sql`  
**Target commit:** `a28ac1d`  
**Production migration status:** Not applied; no migration command or write was run.

## Recommendation

**NOT READY FOR STAGING TESTING** until the migration's authorization blockers are corrected and the source schema/migration history is reconciled. This recommendation means the current draft should not yet be treated as a validated staging candidate. It does not authorize any production action.

## Production schema comparison

### Confirmed from live metadata

- Connected project `yyuilpixyrvmzxgyehme` is the known production project. No staging project was available in the connected project list.
- Production does not contain `businesses`, `business_roles`, or `business_memberships`, nor `profiles.active_business_id`.
- Production has existing `parties`, `transactions`, `profiles`, cooperative, notification, role, and owner tables. The reviewed snapshot contained 36 parties, 220 transactions, and 2 profiles; these counts are a point-in-time snapshot.
- Remote migration history contains 11 migrations through `20261014161600`. The tenant migration is absent.
- The repository lacks baseline DDL for core `parties`, `transactions`, and `profiles`. A checked-in `202609170001_party_type.sql` is absent from remote migration history even though live `parties.party_type` exists.

### Assessment

**Inferred from implementation:** The tenant migration's expected columns generally match the live schema documented by the earlier audit (UUID keys, `party_type`, transaction date/type fields, cooperative and notification tables), and it backfills existing ledger/cooperative/notification rows to one `RKH Suppliers` business. However, a complete SQL comparison against an authoritative schema dump cannot be proven from repository history alone. Functions, constraints, indexes, policies, grants, triggers, and column nullability may have drifted out of band.

**Recommendation:** Obtain a schema-only dump from a production backup or read-only export and compare it to the migration prerequisites. Reconcile migration history in a non-production clone. Do not point a migration runner at production to “see what happens.”

## Data preservation and backfill review

### Confirmed from source

- Existing parties are assigned the seeded RKH business ID and made `NOT NULL`.
- Existing transactions derive `business_id` from the referenced party, then become `NOT NULL`; this is safer than an independent blanket assignment if the existing party relation is intact.
- Existing cooperatives and cooperative entries are assigned the RKH business ID through their parent relationship.
- Existing notification events/sends receive the RKH business ID; inbox rows derive it from their event.
- Existing profiles receive an active RKH business selection and membership based on their existing `profiles.role`; app owner is mapped to `business_owner`.
- Existing UUID primary keys and source rows are not explicitly deleted or rewritten except for new tenant columns and the intended owner role-key mapping.

### Risks and preflight conditions

- The insert of the RKH business assumes exactly one `app_owner` row. Empty or multiple/invalid owner state can result in no business or migration failure.
- Membership creation assumes every profile role maps to a seeded business role and profile identifiers correspond to real Auth users. Missing profiles for existing Auth users are not auto-associated.
- Transaction backfill leaves rows null if there are orphaned party IDs, then `SET NOT NULL` fails. Notification inbox backfill similarly depends on every event being present.
- Existing cooperative global uniqueness is replaced with tenant-scoped uniqueness; the existing name uniqueness is removed. This is intentional for SaaS, but should be verified against production indexes and duplicates.
- Role copying assumes app role names/keys comply with the new business-role constraints and that adding `business_owner` does not collide with an existing role key/name.
- New composite foreign keys are additive. Existing single-column foreign keys remain; the transaction-to-party cascade remains destructive for ledger history.

**Recommendation:** Run read-only preflight checks on a staging clone: orphan count checks, owner/profile/Auth membership reconciliation, role map validation, duplicate constraint check, affected-row totals, and before/after aggregate balances. Save source-to-tenant mapping and a reconciliation report.

## Reversibility and rollback

**Confirmed from source:** The migration does not define a paired down migration. It adds columns and objects and changes policies, grants, triggers, helper functions, and at least the cooperative name uniqueness constraint. It also redefines notification triggers/helpers and legacy authorization helper semantics.

**Inferred from implementation:** Before any tenant writes, schema rollback could be engineered, but would require restoring prior functions, grants, policies, triggers and uniqueness constraints in the correct order. After new businesses or tenant-specific rows exist, dropping `business_id`/tenant tables is data loss; rollback would require preserving those records and likely a forward fix. This is not realistically reversible by a simple down migration.

**Recommendation:** Use forward-only recovery after cutover. Keep backups and a tested restoration path; retain original IDs and legacy data. Define a write freeze or capture strategy and an explicit point of no return. Rehearse rollback/restore on a disposable staging clone.

## Test readiness

- `supabase/tests/multi_tenant_isolation.sql` exists and has transaction rollback fixtures. It covers a subset of ledger tenant operations and self-join prevention.
- The SQL test is written for a database that already has this migration and app fixture rows. It does not constitute a migration test by itself.
- No SQL integration test or database migration replay was run. `supabase`, `psql`, and `docker` are unavailable on this machine; no staging project was available.
- Deno is unavailable, so modified Edge Functions were not typechecked or integration-tested.
- Review-time `pnpm run build` was attempted and failed during workspace TypeScript checks because required Drizzle/Postgres modules (`drizzle-orm`, `pg`, `drizzle-zod`) are unavailable in the local dependency installation. No packages were installed as part of this audit. Even a successful frontend build would not validate database migration, RLS, Edge Function, or multi-tenant behavior.

## Required gates before staging approval

1. Fix the global `app_roles` authorization path and owner password reset flaw documented in `MULTI_TENANT_SECURITY_REVIEW.md`.
2. Resolve ledger hard-delete/cascade semantics before testing representative financial history.
3. Reconcile the migration against a schema-only production backup and migration history in a disposable, isolated staging project.
4. Test migration both forward and restore/rollback rehearsal with production-shaped data; verify counts, keys, profiles, employee access, and balance/report totals.
5. Run and extend RLS tests across parties, transactions, cooperatives, entries, business membership/roles, notifications, inbox, and all relevant RPC/Edge Function paths.
6. Run Deno typechecking and function integration tests; exercise two businesses, multi-business accounts, role boundaries, and failure/retry cases.
7. Verify no production Supabase credentials are configured in the staging workflow and confirm the target project ref before every CLI command.
