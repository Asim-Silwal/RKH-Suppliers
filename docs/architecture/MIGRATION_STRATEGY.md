# Preserve-data migration strategy

**Status:** Proposed phased plan. No schema, data, Auth account, Storage object, or production setting was changed in this task.

## Migration guardrails

- Keep the existing Supabase project, Auth users, financial rows, profile rows, private avatars, cooperative history and notification history. Do not replace production with a fresh database.
- Treat the live database as the data source of truth until a reviewed schema baseline and reconciliation are complete. The audit found core table DDL missing from the repository and a Drizzle schema that does not match live UUID columns or the live party-delete FK.
- Use expand/backfill/validate/cutover/contract phases. Additive work first; retain old records and source IDs. Do not drop legacy tables, constraints or columns as part of the first release.
- Keep financial data available read-only if the new writer is disabled. No migration step should destroy transaction history or Auth identities.
- Every data conversion must be idempotent, resumable, observable and reversible before cutover. Maintain an import/mapping record with source table/key, target IDs, migration batch and validation status.

## Phase 0 — baseline and recovery preparation

1. Export the live schema, policies, grants, Auth triggers, Storage policies/buckets, extensions, scheduled jobs and relevant function definitions to a reviewed baseline. Resolve the production-versus-Drizzle mismatch before generating a canonical migration set.
2. Verify PITR/backup coverage and rehearse restoration into a non-production Supabase project. Record a pre-migration backup and a cutover freeze window.
3. Profile the existing data for orphan party IDs, invalid/duplicate contact data, negative/precision anomalies, BS/AD date inconsistencies, parties whose type changed, deleted Auth users and notification rows whose recipients no longer exist. Do not “clean” ambiguous data silently.
4. Inventory Auth users and roles; identify the `app_owner` account and employee accounts. Confirm that each existing user should retain access to the RKH business after cutover.
5. Create automated expected-value reports from current data: row counts, transaction amount totals, per-party signed balances, month totals, first/last dates, cooperative totals and PDF statement samples. Secure and restrict exports containing personal data.

**Gate:** Restore succeeds, source totals are understood, mapping decisions and retention rules are approved.

## Phase 1 — additive tenant and authorization schema

1. Add `businesses`, `business_memberships`, business-scoped roles/permission assignments and optional `business_branches`. Do not modify current behavior yet.
2. Insert one legacy business representing RKH Suppliers. Map existing `app_owner` to its business-owner membership; map every existing profile to a member and translate its existing role into a business-scoped role with equivalent least-privilege permissions. Preserve `auth.users.id`, `profiles.id`, email, password, names and session-relevant Auth data.
3. Add nullable `business_id` columns to parties, transactions, cooperatives, cooperative entries and tenant-scoped notification records, plus nullable `branch_id` for records whose branch scope is known. Backfill all current business records to the RKH business. Do not make the fields NOT NULL until counts and constraints validate.
4. Create tenant-scoped uniqueness and composite parent FKs only after checking duplicates and orphan rows. Ensure the existing globally unique cooperative name and `(cooperative_id,entry_date)` rules are converted without collisions.
5. Leave legacy user avatar object paths and bucket unchanged. If business documents/logo storage is introduced, add a separate tenant-aware private path/policy; do not bulk move existing personal avatars.
6. Create tenant-aware policies and permission helpers in shadow/test form. Keep old policy behavior until application cutover; ensure policy combinations cannot widen access due to permissive-policy OR semantics.

**Gate:** For each current row, exactly one expected tenant mapping exists; all composite FKs validate; existing users resolve to the correct business role; no cross-business path exists.

## Phase 2 — financial model backfill, without guessing allocations

1. Preserve every original `parties.id` and `transactions.id` as a source reference. Add `source_legacy_table`, `source_legacy_id`, and batch ID to the import mapping, or durable `legacy_*_id` columns with unique indexes.
2. Convert current customer PURCHASE rows into sale documents and supplier PURCHASE rows into purchase documents. Convert customer PAYMENT to receipt and supplier PAYMENT to payout using the party type captured during import. Copy original date, description, amount, created timestamp and business ID.
3. Post balanced journal entries using the original signed-ledger semantics and control accounts. Reconcile AR/AP totals by business and party against the existing calculation `sum(PURCHASE) - sum(PAYMENT)`.
4. **Do not automatically attach historical payments to a particular invoice.** The live schema has no payment-to-purchase FK. A description such as “Payment received with purchase” is suggestive but not a referential allocation. Keep historical payments unallocated initially; preserve party-level net balances and expose legacy-open-document allocation status. If invoice aging is needed at cutover, generate proposed allocations separately for business review/approval and retain the original payment record.
5. Map cooperative records and notification history to the RKH business while preserving IDs, recipient IDs, read state, timestamps and recorder snapshots. Missing former users remain historical labels, not newly created Auth users.
6. Keep branch IDs null for historical rows unless source evidence establishes the branch. If the business confirms all historic entries came from the original Kathmandu shop, a documented explicit assignment can be made as a separate reviewed batch; never infer branch scope from current UI defaults.

**Gate:** Per-party and total AR/AP balances match to the cent, document/payment counts and sums reconcile, every journal entry balances, dates/descriptions are preserved, and unresolved records are listed for owner review.

## Phase 3 — tenant-aware application and employee continuity

1. Deploy updated frontend/functions to a staging project first. Existing employees sign in with the same Auth accounts; they should not need new credentials solely due to tenant migration.
2. Add business selection and member tools only after the database can enforce membership. Reset client data caches/state on business switch and re-fetch permissions, business context and all financial data.
3. Run the app against RKH with both owner and employee accounts; verify access to existing customers, suppliers, reports, PDFs, Sahakari records, push inbox and personal avatar. Verify employee permissions match prior behavior.
4. Run adversarial tests as a second test business/member: alter request IDs, query raw tables and call every RPC/function. Each cross-tenant read/write must be denied by the database, including branch-ID and parent-ID substitution.
5. Freeze ledger writes briefly for production backfill/cutover, or use an explicitly designed change-capture mechanism if the business cannot accept a short write pause. Avoid naive dual-writes from a React client because partial success can fork balances.
6. Cut over RKH writers in one transaction/deployment window after backfill validation. Keep legacy tables/columns read-only and available for reconciliation during the agreed rollback period.

**Gate:** Production cutover checklists signed off, same employees can work without re-onboarding, no cross-tenant paths, no balance/report drift.

## Phase 4 — controlled second-tenant launch

1. Create a test business in the same tenant schema, then a controlled pilot business. Validate completely separate parties, documents, balances, branch data, member roles, notifications, files, exports and plan entitlements.
2. Run database advisor/security tests, load tests, migration retry tests, rollback rehearsal and backup-restore checks.
3. Monitor tenant-qualified logs/metrics without leaking names, phone numbers, tokens or statement data. Provide tenant export and closure processes before wider onboarding.
4. Keep the old RKH records read-only until the rollback window ends. Retire old authorization only in a later migration, after confirming there are no code paths using it and after review of all old policies/RPCs.

**Gate:** Pilot owner approval, reconciliation signed, zero known isolation failures, rollback path tested.

## Rollback and data safety

- Before cutover: disable new schema writers and leave old application behavior unchanged; additive tables/columns can remain unused.
- After cutover: revert application traffic to the legacy reader/writer only if no new tenant-specific or allocation-only writes would be lost. Otherwise pause writes, preserve all new rows, and roll forward with a corrective migration.
- Never drop tenant columns, old IDs, original descriptions or source mappings during the initial launch. Keep reversal records and migration batches so reconciliation can be repeated.
- If any validation fails, pause cutover. Do not “fix” balances by setting a balance field; correct source mapping or post an auditable adjustment approved by the business.

## Current uncommitted draft note

The audit branch/worktree contains an uncommitted tenant migration and frontend/function edits from earlier work. They are not applied to the live database and are not assumed to be the migration plan. Compare them against this approved strategy before reuse; do not deploy them as-is based on this document.
