# Multi-Tenant Security Review

**Review target:** `feature/multi-tenant-business-architecture` at `a28ac1d`  
**Review branch:** `review/multi-tenant-security`  
**Scope:** Static source review of the tenant migration, affected React app and Edge Functions, repository history, plus read-only inspection of the connected Supabase project. No production writes, migration execution, or data changes were performed.

## Executive result

**Recommendation: NOT READY FOR STAGING TESTING.** The migration has not been applied to a staging clone and the repository does not contain a complete baseline for the existing production schema. Static review found a permission escalation through a legacy SECURITY DEFINER function and a credential-reset authorization flaw. Those should be corrected before staging verification.

The migration's core tenant pattern is sound in several important respects: it derives tenant context from an authenticated user's active membership, locks `business_id` on updates, uses tenant predicates in ledger policies, adds composite tenant-parent foreign keys, and scopes the balance helper. These source observations do not establish runtime correctness; SQL and Edge Function tests were not run.

## Findings

### High — Tenant business owners can mutate the global role catalog

**Confirmed from source:** The migration redefines `public.is_app_owner()` to mean membership as `business_owner` in the active business. The existing SECURITY DEFINER `public.update_app_role(text,text[])` still checks `is_app_owner()` and is not replaced or revoked in the tenant migration. Its execute grant to `authenticated` is inherited from an earlier migration. The changed predicate therefore authorizes every tenant business owner to update global `app_roles` permissions.

**Impact (inferred):** A tenant owner can change a global role template used by future business creation, affecting businesses beyond their own tenant. Existing per-business role snapshots reduce immediate impact on already-created businesses but do not prevent global catalog poisoning.

**Recommendation:** Restore a platform-only helper for legacy platform functions (check `app_owner` directly), or revoke authenticated execution and replace the function with tenant-scoped role mutation. Audit every legacy function that calls `is_app_owner()` before changing its meaning. Add a regression test proving an ordinary tenant owner cannot mutate `app_roles`.

### High — Business administrator can reset the business owner's global password

**Confirmed from source:** `set-user-password` checks that the caller is an active `business_owner` or `admin` and the target is an active member of the selected business. It blocks accounts with more than one *active* business membership, but does not prevent a non-owner admin from targeting the `business_owner` membership. It calls Auth Admin `updateUserById`, which changes the user's global credential. Inactive memberships in other businesses are not included in the guard.

**Impact (inferred):** A delegated administrator can take control of the owner's account if the owner currently has one active membership; the same global password change may affect other accounts/workspaces if an inactive membership exists.

**Recommendation:** Restrict password changes to the account recovery/self-service flow, or allow only the business owner to reset non-owner users. Never permit an administrator to reset the business owner's password. Treat any membership, regardless of status, as evidence that the Auth identity is shared when applying safeguards.

### High — Hard deletion can erase ledger history

**Confirmed from source:** The live schema has `transactions.party_id` with `ON DELETE CASCADE`. The tenant migration adds a second composite `(business_id, party_id)` foreign key with `ON DELETE CASCADE`, and grants users with `parties_delete`/`transactions_delete` the corresponding delete operations. It does not introduce an archival or reversal model.

**Impact (inferred):** Deleting a party can remove its financial transactions and destroy evidence needed for statements and reconciliation. Deleting a transaction likewise changes historical balances and reports without an auditable reversal.

**Recommendation:** Before any staging dataset is used for representative testing, replace ledger deletion with soft archive or controlled reversal semantics. Restrict/delete-review historical data and add audit records. Avoid cascading removal of posted financial entries.

### High — Migration is not reconciled to an executable baseline

**Confirmed from source/live metadata:** The checked-in migration history does not create core `parties`, `transactions`, or `profiles` tables. Live migration history differs from the repository history (including a repo migration for `party_type` that is not recorded as applied remotely, although the column exists). The connected project is the known production project; it has no tenant schema and has not applied `20261107090000_multi_business_tenants`.

**Impact (inferred):** A fresh local replay cannot prove the migration's prerequisites, and staging may not match production if schema drift is not resolved. Applying this migration to an incorrectly provisioned project can fail partway or leave untracked history.

**Recommendation:** Create an isolated staging project from a verified production schema/data copy, reconcile migration history without executing against production, record a canonical baseline or explicit drift reconciliation, and apply/test only there. Obtain a complete schema dump and preflight counts before any rollout.

### Medium — No runtime isolation or function tests were executed

**Confirmed from review environment:** The SQL test file exists and uses rollback fixtures for two-business SELECT/INSERT/UPDATE/DELETE and membership checks. `supabase`, `psql`, `docker`, and `deno` were unavailable on the review machine. No database or Edge Function tests were run.

**Impact (inferred):** Policy syntax, trigger behavior, RPC grants, service-role paths, test fixture assumptions, and runtime Deno compatibility remain unverified. The checked-in SQL test covers the principal ledger tables but not all exposed tenant tables and privileged notification paths.

**Recommendation:** Run SQL tests against the staging clone with actual authenticated role/JWT contexts, add negative tests for cooperative rows, inbox/history, role RPCs, business creation/switching, and service-role notification worker tenant binding. Typecheck every Edge Function with Deno and perform integration tests using two separate tenants.

### Medium — Legacy global `is_admin()` authorization helper remains

**Confirmed from source/live metadata:** The existing SECURITY DEFINER `public.is_admin()` checks `profiles.role = 'admin'`. The tenant migration does not replace or revoke it. Current production policy metadata showed no RLS policy calling it, but the function remains executable to authenticated users.

**Impact (inferred):** Its semantics are ambiguous after introducing business-specific roles; future or untracked database code can accidentally treat a role in the legacy profile field as platform-wide authority. The function's fixed `public` search path is also less hardened than the new empty-search-path helpers.

**Recommendation:** Inventory all database and app callers, replace with clearly separated platform-owner and active-business-role predicates, use an empty search path, and revoke unneeded execution.

### Medium — Destructive or incomplete member administration lacks atomicity

**Confirmed from source:** `delete-user` first snapshots cooperative recorder name, then deletes membership, then updates/clears the target's active business. These are separate service-role requests. On a later failure it returns an error after earlier changes may already have committed. `create-user` deletes a newly created Auth account if profile or membership insertion fails, but these operations are also separate requests.

**Impact (inferred):** Partial failures can leave an account removed from a business while the API reports failure, or create profile/member cleanup edge cases. Retry behavior may be confusing for operators.

**Recommendation:** Move multi-step membership lifecycle operations into a database transaction/RPC or add idempotent compensating operations and explicit partial-result states. Integration-test retries and each failure boundary.

### Medium — Broad wildcard CORS on authenticated Edge Functions

**Confirmed from source:** The four modified user-facing functions set `Access-Control-Allow-Origin: *`. They require bearer authentication and perform server-side checks.

**Impact (inferred):** Wildcard CORS does not itself bypass bearer auth, but it allows any origin running with a valid user's token to invoke these endpoints. This increases exposure to token theft/XSS and makes origin controls ineffective.

**Recommendation:** Limit allowed origins to the deployed app and local development origins. Continue server-side authorization regardless of CORS.

### Low — Tenant paths are mostly RLS-dependent rather than explicit in browser queries

**Confirmed from source:** App ledger reads query `parties` and `transactions` without an explicit `business_id` filter. Switching clears parties/entries, increments the request sequence, reloads profile/context, and stale load results are discarded by request ID checks. `select_business` validates active membership server-side.

**Impact (inferred):** This is safe only if RLS is deployed and remains correct. The UI behavior inspected appears to prevent stale tenant rows, but browser-level switching behavior was not exercised.

**Recommendation:** Keep RLS authoritative; add UI integration tests that switch quickly between tenants, including requests that resolve out of order. Optional explicit tenant filters can improve query clarity but must never replace RLS.

## Confirmed strengths

- Tenant context is looked up from the authenticated user's profile and active membership, not user metadata.
- `select_business` checks the caller's active membership and active business status before changing the profile selection.
- Tenant core tables have tenant-aware policies; `business_id` is assigned by a trigger on INSERT and cannot be changed on UPDATE.
- Transactions use a composite FK to ensure the referenced party belongs to the same business. Cooperative entries similarly reference a cooperative in the same business.
- The `staff_customer_balances` SECURITY DEFINER helper checks permission and filters both parties and transactions by active business.
- Notification event, send, and inbox history receive a business ID; user-facing notification send/history requests validate caller membership and scope history, rate limits, idempotency and recipient checks to the active business.
- Service-role secrets are read from Edge Function environment variables; no secret value was printed or copied into these deliverables.

## Test and behavior status

- **Confirmed from source:** React supports business selection and business creation through RPCs; employee listing/role assignment is business scoped; removal preserves the Auth account and other memberships; customer/supplier/transaction/report screens consume data under RLS.
- **Not executed:** business creation, switching, employee CRUD/role updates, customer/supplier loads, reports, stale-data races, SQL RLS test file, Deno typechecking, and notification integration tests.
- **Not claimed:** No database isolation test passed during this review.

## Scope limitation

Only the connected live project metadata was inspected read-only. No production query changed data. A staging Supabase environment was not available. This review is a code and schema readiness assessment, not an attestation that deployed RLS is effective.
