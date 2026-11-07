# SaaS readiness report

## Overall assessment: not ready for multi-tenant customer onboarding

**Assessment:** The app is a usable single-business ledger with a useful range of operational features and a clear Supabase Auth/RLS foundation. It is **not yet a commercial multi-tenant SaaS platform**. The production schema has no tenant/business entities or tenant ownership columns, and its RLS is role-only. The local working tree contains an uncommitted tenant draft, but the live Supabase project has not applied it; it cannot be counted as a delivered or verified tenant boundary.

- **Confirmed from source:** Current account, role and owner models are global/single-business. The app has no public registration/onboarding, plan/billing, subscription limits, business settings or tenant-aware audit trail.
- **Inferred from implementation:** Launching a second independent company against the current database would expose shared data to any user with corresponding role permission. Frontend filters do not change this.
- **Recommendation:** Keep the production app single-tenant until a reviewed and tested isolation design is fully deployed. Do not invite external businesses to the current project.

## Readiness by area

| Area | Assessment | Evidence |
|---|---|---|
| Core ledger features | Strong single-business fit | Parties, purchase/payment history, reports, date handling, exports and PDF statements are implemented. |
| Authentication | Existing, admin-provisioned | Supabase email/password; no self-service signup or onboarding route in committed app. |
| Authorization | Role-based, single tenant | Profile has one role; `app_has_permission` evaluates global app role. |
| Tenant isolation | Missing in live DB | No `businesses`/membership table or tenant ID in ledger tables; RLS policies do not use tenant predicates. |
| Financial auditability | Limited | Net balance is derived from rows; party delete cascades to transactions; no payment allocation, immutable journal, or separate actor/tenant audit trail. |
| Database reproducibility | Weak | Core table baseline DDL absent from tracked migrations; Drizzle model disagrees with live UUID schema and delete behavior. |
| Operations | Partial | Vercel/PWA setup, push delivery and health API exist; no documented tenant backup/restore, billing, metering or support/admin workflows visible. |
| PWA/mobile | Good presentation; online data | Responsive UI, manifest and push worker; worker deliberately avoids caching private ledger data, so no offline ledger. |

## Critical problems to solve first

1. **Tenant isolation in the database.** Establish the tenant boundary across parties, transactions, cooperative data, notifications, members, role assignments and any other business-owned records. Use RLS and relational constraints, not only client filters.
2. **Identity and membership model.** Replace the global profile role/single owner assumptions with a business membership and per-business role model. A single Auth user may belong to multiple businesses with different access.
3. **Every privileged surface.** Update RPCs, Edge Functions, scheduled notification jobs, push recipients, storage access, profile/avatar handling, and exports for tenant-aware checks. Prevent a caller from choosing another tenant's ID.
4. **Source-of-truth schema.** Reconcile live schema, Drizzle definitions, generated types, and checked-in migrations. Add a reproducible reviewed baseline and migration/rollback process.
5. **Financial record retention.** Decide how deletion, correction, reversals, opening balances and payment allocation work. Current party cascade can erase transaction history.
6. **Safe onboarding and operating controls.** Add registration/business creation, invitations, verified email/recovery, abuse controls, business lifecycle/export/deletion, subscription/billing, limits, support and data-retention processes before charging customers.

## Recommended development order

1. **Freeze the audit baseline:** Review this audit; choose the intended accounting boundary (party-level net balance vs. invoice allocations); define tenant roles and expected data-retention rules. Keep the current production behavior unchanged.
2. **Make schema reproducible:** Capture/verify the actual live schema into a clean database project. Reconcile UUID types, constraints, indexes, RLS, Storage and Auth triggers. Add migration CI and a safe rollback/restore procedure.
3. **Design tenant schema:** Define businesses, memberships, role scope, current-business selection, uniqueness scope, tenant-owned tables, composite foreign keys and deletion behavior. Keep platform operators separate from business owners.
4. **Implement database isolation first:** Add/backfill tenant ownership, policies for all CRUD operations, tenant-aware secure RPCs, secure definer grants and Storage/notification scope. Validate with automated two-tenant adversarial tests.
5. **Update app and Edge Functions:** Add onboarding/business switch, business-specific member/role tools, tenant-aware requests, notifications, PDFs, exports and profile behavior. Ensure state resets completely when switching businesses.
6. **Add SaaS operations:** Billing provider integration, plans, entitlements, limits, invoices/receipts as applicable, lifecycle controls, admin support view, observability and customer export/delete.
7. **Release gates:** Migration dry-run on a production-like copy; data reconciliation; permission/RLS tests; backup restore; load/performance tests; security review; mobile/PWA regression; staged rollout with rollback criteria.

## Files likely to need modification

### Database and generated contracts

- `supabase/migrations/*` — baseline reconciliation and tenant/membership/role migrations.
- `supabase/tests/*` — RLS isolation, membership/role and accounting behavior tests.
- `lib/db/src/schema/index.ts` — align IDs, relationships, tenant keys, constraints, actual enums and live tables.
- `lib/api-spec/openapi.yaml`, `lib/api-zod/src/generated/*`, `lib/api-client-react/src/generated/*` — only if API contracts are used/expanded; currently not the ledger's primary data path.

### Frontend

- `artifacts/mockup-sandbox/src/App.tsx` — onboarding, selected business lifecycle, route/access behavior, data loading/pagination, tenant-aware state reset.
- `artifacts/mockup-sandbox/src/components/UserManagement.tsx` and `Notifications.tsx` — tenant-scoped business members, roles and notifications.
- `artifacts/mockup-sandbox/src/components/Sahakari.tsx`, `StaffOverview.tsx`, and `src/lib/sahakari.ts` — tenant-aware cooperative and RPC behavior.
- `artifacts/mockup-sandbox/src/lib/supabase.ts`, `notifications.ts`, `kathmanduTime.ts`, PDF helpers and `src/components/MobileLock.tsx` — client/session/business context and generated outputs where relevant.
- `artifacts/mockup-sandbox/src/premium.css`, `index.css`, component CSS, `public/manifest.webmanifest`, `public/sw.js`, `vite.config.ts`, and `vercel.json` — SaaS branding, responsive onboarding, install/offline policy and deploy routing as scope requires.

### Server functions and deployment

- `supabase/functions/create-user/index.ts`, `delete-user/index.ts`, `set-user-password/index.ts`, `notifications/index.ts`, `notification-delivery/index.ts` — business-aware authorization, recipient selection, lifecycle, CORS and logging.
- Supabase/Vercel environment configuration and deployment docs — separate staging/production settings, secrets, URLs, redirects, backup and release process. No single environment config file is currently a source of truth for those operations.

## Working-tree draft status

- **Confirmed from source:** The workspace contains uncommitted modifications from earlier multi-business work, including an untracked migration `supabase/migrations/20261107090000_multi_business_tenants.sql` and changes to `App.tsx` and Edge Functions. This task did not edit or apply those files. The migration is not in the connected database's applied migration list, and live tables lack its business columns.
- **Inferred from implementation:** Current draft frontend expects `profiles.active_business_id` and business tables that are absent from the live DB. Deploying only the frontend or only the migration/functions would leave incompatible components.
- **Recommendation:** Review the code draft after the audit, test it in a separate Supabase dev/preview project, and reconcile its business-admin, role, notification, and data-backfill behavior before any production release.
