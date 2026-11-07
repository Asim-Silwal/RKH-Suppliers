# Database audit

**Evidence basis:** Read-only inspection of the live Supabase project's table metadata, constraints, indexes, RLS policies and applied migration list, cross-checked with `supabase/migrations/`. The live project had 11 app migrations applied through `20261014161600`; it does **not** have the uncommitted `20261107090000_multi_business_tenants.sql` migration present in the working tree.

## Live application tables

The live database snapshot showed 13 public application tables. Current row counts are shown only as a snapshot.

| Table | Purpose/important columns | Keys / relationships |
|---|---|---|
| `parties` | Customer/supplier identity, contact, location, notes, `party_type` | UUID PK; `party_type` check is customer/supplier; indexes on name, company name, contact. |
| `transactions` | `party_id`, `type`, positive numeric amount, AD/BS dates, description | UUID PK; FK to `parties(id)` **ON DELETE CASCADE**; type check PURCHASE/PAYMENT; positive amount check; indexes on party/date/type. |
| `profiles` | Auth user ID, single `role`, name, contact, avatar path | PK/FK to `auth.users(id)` ON DELETE CASCADE; role FK to `app_roles(role_key)`. |
| `app_roles` | Global role names, permission array, `is_system` | Text role key PK; unique name; key/name/permission checks. Three rows in live snapshot. |
| `app_owner` | Singleton platform owner account | Boolean singleton PK/check; unique FK to auth user. RLS enabled; no user-facing policy; grants revoked from client roles. |
| `cooperatives` | Cooperative name, positive suggested daily amount, active flag | UUID PK; globally unique name. |
| `cooperative_entries` | One deposit/no-deposit result per cooperative/date, amount/reason, recorder | UUID PK; FK to cooperative; unique `(cooperative_id, entry_date)`; recorder FK to Auth ON DELETE SET NULL; outcome check requires amount for deposit and reason for missed deposit. Recent cooperative/date index. |
| `push_subscriptions` | Web Push endpoint and key material per user | Endpoint PK; Auth user FK ON DELETE CASCADE; user index. |
| `notification_sends` | Admin notification send result/recipient | UUID PK; sender/recipient Auth FKs ON DELETE SET NULL; created-at index. |
| `notification_vapid` | Singleton VAPID public/private key material | Boolean singleton PK/check; service-role only. |
| `notification_events` | Idempotent notification event queue and delivery state | UUID PK; unique source key; category check; queue index. |
| `notification_inbox` | Per-user event copy and read time | Composite PK `(user_id,event_id)`; user Auth FK and event FK with cascade; feed/event indexes. |
| `notification_dispatch_config` | Singleton hash used to authorize scheduled delivery | Boolean singleton PK/check; service-role only. |

**Confirmed from source:** The two ledger tables contain 36 parties and 220 transactions in the live snapshot. This is useful for scale context, not a complete business-data inventory. Cooperative and notification-related tables are described by checked-in SQL migrations. Core ledger/profile table creation DDL is not present in the repository migrations, so their original creation history and any out-of-band changes cannot be reconstructed from this repo alone.

**Confirmed from source:** `parties` and `transactions` are UUID-based in the live DB, while `lib/db/src/schema/index.ts` declares `serial`/integer keys and a Drizzle enum. The live DB stores transaction type as checked text, and the live parties table lacks Drizzle's `archived_at`. Do not use the Drizzle declaration as the production schema contract until reconciled.

## Ledger relationship and accounting behavior

- **Confirmed from source:** Each transaction belongs to one party through `transactions.party_id`. Database enforces a positive amount and the two transaction types; it does not model an invoice, payment allocation, currency, or opening balance table.
- **Confirmed from source:** `balancesByParty()` adds PURCHASE values and subtracts PAYMENT values in integer cents. UI labels PURCHASE as sale for a customer and purchase for a supplier; PAYMENT is collection from a customer or payment to a supplier. Positive net balance means customer receivable or supplier payable; negative net balance is presented as an advance/credit.
- **Confirmed from source:** Partial payment at the time of a new sale/purchase inserts a PURCHASE row and a PAYMENT row together in one Supabase insert request. The payment is a separate transaction, with explanatory text, not a foreign-key allocation to that purchase. Later payments are equally unallocated and reduce the party's total net balance.
- **Inferred from implementation:** The scheme is a simple running net ledger, not an accrual/invoice subledger. It cannot determine which invoice is partially paid, age each invoice, or prove a payment was allocated to a specific sale/purchase.
- **Recommendation:** Before building formal accounting workflows, define whether this product promises only party-level balances or needs invoice/payment allocations, immutable posting, reversals, opening balances, currencies, tax, and period closing. Add domain-level constraints and migrations to a checked-in canonical schema.

## RLS and storage policies in the live DB

- **Confirmed from source:** RLS is enabled on all listed public application tables. Parties and transactions have authenticated read/insert/update/delete policies that call `app_has_permission(...)`. These policies restrict by the user's global profile role and permissions, not by a business or tenant identifier.
- **Confirmed from source:** Cooperative reads and records similarly use permission checks; creating cooperatives is restricted by `is_app_owner()`. Cooperative entry inserts require `recorded_by = auth.uid()` and `sahakari_record`; edits require `sahakari_edit`.
- **Confirmed from source:** Profile SELECT and UPDATE policies are self-row scoped. `protect_profile_role()` is a trigger intended to prevent a caller from changing their own role through profile update. The profile is nevertheless a single role per Auth user.
- **Confirmed from source:** `notification_inbox` policies scope rows to `user_id = auth.uid()` and check the required role permission. `app_roles` is readable to authenticated users. Sensitive tables such as `app_owner`, `notification_events`, `notification_sends`, `notification_vapid`, `push_subscriptions`, and dispatch config have RLS enabled with no client policies; the migrations revoke client grants and grant server/`service_role` as appropriate.
- **Confirmed from source:** The live `avatars` Storage bucket is private, limits objects to 5 MiB, and allows JPEG, PNG, or WebP. Storage object policies allow an authenticated user to select/insert/update/delete only in the `avatars` bucket under their own user-ID directory.
- **Confirmed from source:** A security advisor flagged one public-executable `SECURITY DEFINER` function, `public.rls_auto_enable()`, and 12 signed-in-executable security-definer functions. Most app functions explicitly check the caller's role/permission and use an empty search path; the event-trigger helper is an advisor warning that should be verified because PostgreSQL event-trigger functions cannot be invoked as ordinary functions. The advisor also reports leaked-password protection disabled.
- **Recommendation:** RLS must add tenant predicates consistently to every business-owned table and RPC after tenant migration, and composite foreign keys should prevent cross-tenant parent references. Audit security-definer execute grants against actual call sites; revoke broad EXECUTE where not required. Verify the event-trigger advisory with a safe permission test. Enable leaked-password protection before opening public registration.

## Important schema behavior and gaps

- **Confirmed from source:** Deleting a party cascades to all its transactions in the live database. The Drizzle schema says `ON DELETE RESTRICT`, which disagrees. User-facing party deletion can therefore permanently erase transaction history; confirm that this is an intentional retention rule.
- **Confirmed from source:** The database enforces unique cooperative/date entries and a positive transaction amount but does not have a unique party name/contact constraint. Duplicate parties are possible at database level.
- **Confirmed from source:** Base schema migrations for `parties`, `transactions`, `profiles`, avatar bucket, and core auth trigger are missing from this repo's migration directory. Current live state therefore cannot be reproduced from a clean DB with only the tracked migration history.
- **Inferred from implementation:** This missing baseline plus live/Drizzle drift makes local CI, branch databases, disaster recovery, and future tenant backfills harder to trust.
- **Recommendation:** Capture a reviewed canonical baseline/snapshot in a dedicated environment and diff it against migrations; do not create a baseline by guessing at live data. Keep sensitive owner/VAPID/dispatch tables inaccessible to client roles.
