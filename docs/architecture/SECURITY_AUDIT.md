# Security audit

**Scope:** Read-only source review plus live-project RLS/storage metadata and Supabase security-advisor results. No exploit attempts, writes, password changes, or migrations were run.

## Findings

### S1 — No business/tenant boundary in the live ledger (Critical for SaaS)

- **Confirmed from source:** `parties`, `transactions`, cooperatives, user profiles, roles and notifications have no tenant/business ID in the live schema. The RLS policies on ledger tables use `app_has_permission()` only. That function joins the caller's one profile role to the global `app_roles` table.
- **Inferred from implementation:** All authorized users operate on the same logical ledger. Existing RLS is role authorization, not tenant isolation. Adding a business selector or filtering React queries cannot protect records from a modified REST request.
- **Recommendation:** Before onboarding a second business, implement and test tenant ownership for each business-owned row, tenant-aware composite foreign keys, tenant-aware RPCs/Edge Functions/notifications/Storage, and restrictive RLS. Test cross-tenant read, insert, update, delete, and parent-ID substitution with two authenticated tenants.

### S2 — Global owner and shared roles are single-tenant assumptions (High)

- **Confirmed from source:** The live `app_owner` table enforces one singleton owner. Every Auth profile has one global `role`; `app_roles` is a global role catalog. The `is_app_owner()` and user-management RPCs are owner-centric. Edge Functions check the singleton owner before managing Auth users or sending notifications.
- **Inferred from implementation:** A user cannot safely have different access in different businesses. A business administrator concept and platform operator concept are conflated in the current owner-only admin UI. Globally editable custom roles would let one business change permissions used by another if shared across tenants.
- **Recommendation:** Separate platform administration from business ownership. Model business memberships and business-scoped roles/permissions. Ensure invite, role assignment, reset, removal, and notifications are authorized against the caller's active business and cannot target another business's users.

### S3 — Party deletion cascades and removes financial history (High; retention decision)

- **Confirmed from source:** Live FK `transactions.party_id -> parties.id` is `ON DELETE CASCADE`. The UI exposes party deletion with confirmation and deletes the party row. The checked-in Drizzle declaration disagrees and says `ON DELETE RESTRICT`.
- **Inferred from implementation:** Deleting a party can remove its associated transactions, affecting outstanding balances and any future financial audit trail. A confirmation prompt does not preserve the evidence.
- **Recommendation:** Decide and document retention/erasure policy. Prefer archive/soft-delete or a controlled reversal/retention flow for financial records; make the canonical schema match production. Do not assume the Drizzle `RESTRICT` declaration protects the live database.

### S4 — Security-definer RPC surface needs grant review (High review priority)

- **Confirmed from source:** The live advisor reported one anon-executable security-definer (`rls_auto_enable`) and 12 authenticated-executable security-definers. `rls_auto_enable()` is an event-trigger function, while app functions include permission checks; `app_has_permission()` intentionally supports RLS and is executable by authenticated users. All inspected functions set `search_path` (mostly empty) except `is_admin()`, which sets `public`.
- **Inferred from implementation:** The advisor warning for an event-trigger function may be a false positive for direct RPC execution, but it should not be ignored without confirming PostgreSQL rejects direct invocation and reviewing its event-trigger registration. Any missing check in a definer function bypasses the caller's table RLS.
- **Recommendation:** Review every definer function's execute grant and caller authorization. Revoke `PUBLIC`/anon execution unless intentionally needed; move internal helpers out of exposed `public` where feasible. Verify and, if safe, harden `rls_auto_enable()`; standardize secure search paths. Supabase advisory remediation: [SECURITY DEFINER available to anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) and [SECURITY DEFINER available to authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

### S5 — Leaked-password protection is disabled (Medium/High before public sign-up)

- **Confirmed from source:** The live Supabase Auth advisor reports leaked-password protection disabled. App Edge Functions require 12–128 character passwords when creating/resetting passwords, but that is not the same as checking compromised passwords.
- **Inferred from implementation:** Once self-service registration is opened, weak/reused compromised passwords increase account takeover risk.
- **Recommendation:** Enable leaked-password protection and define rate limiting, email verification/recovery, MFA policy, and session revocation before public onboarding. Supabase guidance: [password strength and leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

### S6 — Device lock is a UI privacy gate, not server authorization (Medium)

- **Confirmed from source:** `MobileLock` masks the screen on mobile and uses WebAuthn/platform user verification or password before revealing the app. It stores only the credential ID/public key in local storage; Auth remains a Supabase session.
- **Inferred from implementation:** This prevents casual shoulder-surfing/reopening the UI, but it does not revoke the Supabase session or prevent a person with browser developer tools from making API requests using that session. It is not a substitute for RLS, MFA, session expiry, or server-side authorization.
- **Recommendation:** Preserve clear UX language and treat the lock strictly as a local convenience/privacy layer. Rely on Supabase Auth and RLS for every operation; set session lifetime/revocation policy for shared devices.

### S7 — Profile self-update and service-role functions need field/target audit (Medium)

- **Confirmed from source:** `profiles` has a self-row UPDATE policy; a trigger guards `role`. The app updates name/contact/avatar path and uses service-role Edge Functions for password/account actions. User-admin UI presents operations against users returned by an owner-only RPC.
- **Inferred from implementation:** The protection of self-editable columns currently depends on trigger/grant behavior and on every privileged function checking caller and target. Tenant scoping must be added to each such operation, not only to UI visibility.
- **Recommendation:** Grant only intended profile columns to authenticated users. For service-role endpoints, verify the caller via Auth, verify target is a member of the caller's business, prevent self-admin escalation, and log membership/credential changes without storing passwords.

### S8 — Public CORS and deployment origin assumptions (Review)

- **Confirmed from source:** Edge Functions set `Access-Control-Allow-Origin: *` and accept Authorization headers; frontend Supabase access is controlled by deployment environment values. Push endpoint/project information is hardcoded in a migration/scheduled-job SQL in the current repository history.
- **Inferred from implementation:** Bearer tokens remain required for protected actions, so wildcard CORS alone does not bypass Auth; however broad origins increase browser exposure if a token is obtained and make multi-deployment behavior less controlled. Hardcoded project endpoints complicate staging/branch projects.
- **Recommendation:** Set an explicit allowed-origin list per environment, keep service keys exclusively in Edge Function secrets, and make scheduled endpoints/configuration environment-specific.

## Current protections worth retaining

- **Confirmed from source:** Ledger tables require Auth and role permissions in RLS; party/transaction writes have explicit permission checks. `profiles` are self-readable and role updates have a protective trigger. The `avatars` bucket is private, size/MIME-limited, and path-scoped to each Auth user. Server service-role keys are read from Deno environment, not the browser bundle. Push payloads are delivered from the server; service worker does not cache ledger data.
- **Recommendation:** Preserve these protections as the data model becomes multi-tenant; add tenant authorization as an additional predicate rather than moving authorization into the UI.

## Local draft versus live security posture

- **Confirmed from source:** A local, uncommitted tenant migration and app/Edge Function edits are present in the audit workspace. The live migration list and live table metadata do not include them. This audit did not apply or validate that draft.
- **Recommendation:** Do not consider tenant isolation active until a reviewed migration is applied in a test environment, the updated frontend/functions are deployed together, and adversarial two-tenant RLS tests pass.
