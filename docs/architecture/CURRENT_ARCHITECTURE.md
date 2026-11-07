# Current architecture audit

**Audit date:** 2026-11-07 (client time, Asia/Kathmandu)
**Scope:** Read-only review of the repository, the live Supabase schema/migration history, and current security advisories. No database writes or migrations were run.

Each finding separates what is **Confirmed from source**, what is **Inferred from implementation**, and the **Recommendation**. “Live” means the connected Supabase project `yyuilpixyrvmzxgyehme`; current row counts and advisories are snapshots, not permanent properties.

## System shape

- **Confirmed from source:** The user-facing product is a React 19 + TypeScript single-page app in `artifacts/mockup-sandbox`, built with Vite. Navigation is a small custom History API router in `src/App.tsx`, not a route framework. Vercel rewrites paths to `index.html`; the Vite base path defaults to `/__mockup` outside Vercel.
- **Confirmed from source:** The browser calls Supabase directly through `@supabase/supabase-js` and Vite environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`). PDF generation is client-side with `pdf-lib`/`@pdf-lib/fontkit`; date conversion uses `nepali-date-converter`; icons use `lucide-react`.
- **Confirmed from source:** Supabase Edge Functions use Deno imports for `create-user`, `delete-user`, `set-user-password`, `notifications`, and `notification-delivery`. The generated `artifacts/api-server` is a separate Express/TypeScript health API skeleton; its routes expose health status and do not implement ledger operations. `lib/api-*` is generated OpenAPI client/schema material. `lib/db` contains a Drizzle schema.
- **Confirmed from source:** The live database contains `parties`, `transactions`, `profiles`, `app_roles`, `app_owner`, cooperative tables, and notification/push tables. Its migration history contains 11 app migrations from September–October 2026. The repo does not contain the original baseline DDL for the core `parties`, `transactions`, or `profiles` tables; those tables predate the checked-in migrations.
- **Confirmed from source:** The live database uses UUID primary keys and party/transaction columns that differ from `lib/db/src/schema/index.ts`, which declares serial/integer IDs and omits live `party_type`. The Drizzle schema also declares `archived_at` for parties, absent from the live table. This is schema drift, not merely naming style.
- **Confirmed from source:** The workspace is pnpm-based and contains the Vite app, API server, shared API client/schema, Drizzle DB library, scripts, and Supabase functions/migrations. The app package has a typecheck and build script; it has test files but no package-level test script.

## Runtime request/data flow

1. **Confirmed from source:** A user signs in with Supabase Auth email/password. The app subscribes to auth state, fetches the caller’s profile, role definition and owner flag, then loads the visible parties and transactions. The database RLS is the authoritative data gate; route checks and hidden controls are UI behavior only.
2. **Confirmed from source:** Party/transaction reads and writes use the browser Supabase client. The app calculates balances and reports in React from loaded transaction rows. Special operations use RPCs such as `staff_customer_balances`, `list_app_users`, and `assign_app_role`, and Edge Functions for privileged Auth account operations and push notifications.
3. **Confirmed from source:** Photos are uploaded to a private `avatars` Storage bucket using a path prefixed by the authenticated user ID. The app stores the path in `profiles.avatar_path` and displays a time-limited signed URL.
4. **Confirmed from source:** The service worker is registered for push notification support. Its implementation deliberately does not cache the ledger or provide offline ledger access.

## Route/page inventory

Routes are selected from the first one or two path segments in `currentRoute()` in `artifacts/mockup-sandbox/src/App.tsx`.

| Route | Page/function |
|---|---|
| `/` or `/dashboard` | Dashboard summary, balances and activity view |
| `/parties` | Customer/supplier directory and search |
| `/parties/:id-or-slug` | Party detail, account totals, transaction history and PDF statement |
| `/add-party` | Add customer or supplier |
| `/edit-party/:id` | Change party details/type |
| `/add-entry` (optional party query/path) | Add sale/purchase or payment; supports partial settlement at entry time |
| `/transactions` | Search/filter transaction history and download PDF export |
| `/reports` | Date-range sales, purchases, collections, payments and balance reports; PDF export |
| `/sahakari` | Cooperative savings daily records, history and PDF export |
| `/users` | User/role administration (owner-gated in the UI) |
| `/notifications` | Send push/inbox notices (owner-gated in the UI) |
| `/inbox` | User notification inbox |

**Inferred from implementation:** There is no distinct signup, onboarding, subscription, billing, business settings, or audit-log route in the committed app. The sign-in screen describes authorized RKH Suppliers users; accounts are created administratively.

## Repository state and scope caveat

- **Confirmed from source:** At audit start the Git base was `main` at `origin/main`, and the workspace had pre-existing uncommitted multi-business edits in `App.tsx`, four Supabase Edge Functions, plus an untracked tenant migration. This audit branch was created without changing those files.
- **Confirmed from source:** The connected live Supabase project does not list the tenant migration in its migration history and its schema has no `businesses`, `business_memberships`, or `active_business_id` objects. No migration was applied in this audit.
- **Inferred from implementation:** The uncommitted app/functions now expect tenant schema that is absent from the live database, so the checked-out working tree is not an end-to-end deployable multi-tenant release. Findings about current production behavior in the other audit documents refer to `origin/main` plus the live database unless explicitly marked as a local draft.
- **Recommendation:** Treat the uncommitted multi-business work as a draft. Review it separately, reconcile it against the live schema, test migration and rollback behavior in a non-production project, then merge only after explicit review.
