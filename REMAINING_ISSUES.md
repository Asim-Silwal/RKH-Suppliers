# Remaining Issues

Findings are classified by risk to tenant confidentiality, authorization, financial integrity, or deployment safety. Status reflects static review at commit `a28ac1d`; no staging migration or database test was run.

## Critical

No critical issue was confirmed from the reviewed code. This is not a claim that the system has passed runtime security testing.

## High

### H1 — Tenant owner can change global role templates

- **Evidence:** `is_app_owner()` changes meaning from platform ownership to active business ownership; legacy `update_app_role(text,text[])` continues to use it and remains executable by authenticated users.
- **Impact:** Tenant privilege reaches a global role catalog and may affect newly created tenants.
- **Correction:** Separate platform-owner and business-owner predicates; revoke/replace global function grants; test tenant-owner denial.

### H2 — Admin can reset business owner's global Auth password

- **Evidence:** `set-user-password` checks target active membership and multiple active memberships but not target role or all membership states before Auth Admin password update.
- **Impact:** An administrator may take over owner credentials; Auth credentials apply across business memberships.
- **Correction:** Do not allow non-owner reset of owner accounts. Prefer account recovery or owner-only reset of non-owner accounts. Consider any membership state when identifying shared identities.

### H3 — Party deletion cascades through financial transactions

- **Evidence:** Existing and new transaction-party FKs use `ON DELETE CASCADE`; authenticated roles may have tenant-scoped delete permission.
- **Impact:** User action can erase posted ledger history and change historical reports without an auditable reversal.
- **Correction:** Replace ledger deletion with archive/reversal workflow and preserve transaction history; test retention semantics.

### H4 — Migration prerequisites/history are not reproducible from the repository

- **Evidence:** Core baseline schema is missing; remote and repo migration histories differ; no staging clone or test runner was available.
- **Impact:** Migration success and preservation cannot be established; incorrect history reconciliation can make schema drift worse.
- **Correction:** Compare with authoritative backup schema and reconcile in isolated staging before approving this migration as a candidate.

## Medium

### M1 — No database or Edge Function test execution

- **Evidence:** SQL test source exists, but `supabase`, `psql`, `docker`, and `deno` are unavailable and staging was unavailable.
- **Impact:** SQL syntax/runtime, RLS context, Deno types and integration behaviors remain unverified.
- **Correction:** Run integration and type checks in isolated staging; add coverage for coop, notification, role RPC, create/switch, and failure paths.

### M2 — Legacy `is_admin()` remains ambiguous

- **Evidence:** SECURITY DEFINER helper still checks global `profiles.role='admin'`, uses `search_path public`, and remains callable; no current live policy references were found in inspected metadata.
- **Impact:** Old/untracked paths can confuse global and tenant authority; fixed search path is weaker hardening.
- **Correction:** Inventory callers, replace with explicit platform/tenant predicates, empty search path, and least-privilege execute grants.

### M3 — Membership lifecycle operations are multi-request and non-atomic

- **Evidence:** `delete-user` and `create-user` perform multiple service-role mutations without a transaction.
- **Impact:** Errors after partial success can leave account/profile/membership state inconsistent and retries ambiguous.
- **Correction:** Use transactional database RPCs or explicit idempotent compensation; test injected failures at each step.

### M4 — Wildcard CORS on authenticated privileged functions

- **Evidence:** Modified user-facing Edge Functions set `Access-Control-Allow-Origin: *`.
- **Impact:** Broad origins can invoke endpoints with an exposed user bearer token; CORS is not an authorization control.
- **Correction:** Restrict allowed origins while retaining server-side token, membership, role, tenant and input checks.

### M5 — Membership creation does not support joining existing Auth users

- **Evidence:** `create-user` creates a new Auth identity and then membership; no invite/accept flow for an existing Auth user is implemented in this change.
- **Impact:** A person with an existing RKH Ledger login cannot be added to another business through the implemented employee flow; future multi-business account support is incomplete operationally.
- **Correction:** Add secure invitation and acceptance flow that inserts membership only after authorized invitation/verified identity.

## Low

### L1 — Browser list queries rely on RLS for tenant filtering

- **Evidence:** Main parties/transactions queries omit explicit `business_id`; app uses active business context and database policies.
- **Impact:** Query behavior depends entirely on correct RLS deployment. Current source clears data and uses request sequencing on business switch, but UI behavior was not executed.
- **Correction:** Keep RLS authoritative and add switch/race integration tests; tenant-qualified query filters can aid maintainability.

### L2 — CORS and push endpoint deployment URLs are fixed in source

- **Evidence:** Push VAPID subject is hard-coded to a mockup-sandbox Vercel URL in notification functions.
- **Impact:** Production delivery metadata may identify the wrong application origin and complicate environment separation.
- **Correction:** Configure a validated per-environment application URL server-side and test it in deployment checks.

## History and documentation verification

**Confirmed from Git:** Current branch `feature/multi-tenant-business-architecture` at `a28ac1d` is descended through the approved Task 1 audit (`3afdc08`), Task 2 architecture design (`a3efec9`), and Task 3 development infrastructure (`124f3f0`). The required earlier architecture and development documents are present. No missing Task 1–3 commit was identified in this branch ancestry. The working tree on the review branch contains only the review documents after this review's documentation change.

**Inferred from implementation:** Presence of the earlier Task 1–3 docs does not mean the implementation satisfies their recommendations. Several explicitly staged/future items (subscriptions, branches, notification scheduling/channels, payment allocation) are not implemented and remain outside this Task 04 change.

## Overall recommendation

**NOT READY FOR STAGING TESTING** until the high findings are corrected and the migration is reconciled against an isolated schema/data copy. No production migration was applied and no database test is claimed as passed.
