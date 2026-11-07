# Role and permission matrix

**Status:** Proposed business-scoped authorization model. This is not an implementation of permissions or database changes.

## Authorization principles

- One Supabase Auth identity may have memberships in multiple businesses. Memberships and grants are independent per business.
- A role is owned by one business and cannot be assigned across business boundaries. Permission keys are a fixed platform catalog; businesses may create roles by selecting allowed keys, but cannot invent privileged permission keys.
- The browser may hide actions but Postgres RLS/functions must authorize every read and write. Edge Functions using service role repeat the membership, permission, target-business and branch checks explicitly.
- Access is the union of the member's assigned roles for ordinary capabilities. Dangerous permissions (owner transfer, billing ownership, platform support) are protected and not obtainable from a custom role.
- Branch-limited employees receive access only to granted branches; owners/admins may have business-wide scope. Business-wide reports require a distinct report permission and branch policy.
- Removing a member revokes membership and active sessions/tokens per policy; financial attribution and audit history are retained by stable user ID and/or a historical display-name snapshot.

## Built-in roles

| Permission | Business owner | Business admin | Accountant | Sales / AR clerk | Cashier | Read-only manager |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `business.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `business.settings.manage` | ✓ | ✓ | — | — | — | — |
| `members.read` | ✓ | ✓ | — | — | — | — |
| `members.invite` | ✓ | ✓ | — | — | — | — |
| `members.roles.manage` | ✓ | ✓ | — | — | — | — |
| `members.remove` | ✓ | ✓ | — | — | — | — |
| `roles.custom.manage` | ✓ | ✓ | — | — | — | — |
| `branches.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `branches.manage` | ✓ | ✓ | — | — | — | — |
| `parties.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `parties.create` | ✓ | ✓ | ✓ | ✓ | — | — |
| `parties.edit` | ✓ | ✓ | ✓ | ✓ | — | — |
| `parties.archive` | ✓ | ✓ | ✓ | — | — | — |
| `documents.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `documents.create` | ✓ | ✓ | ✓ | ✓ | — | — |
| `documents.edit_draft` | ✓ | ✓ | ✓ | ✓ | — | — |
| `documents.post` | ✓ | ✓ | ✓ | — | — | — |
| `documents.reverse` | ✓ | ✓ | ✓ | — | — | — |
| `payments.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `payments.record` | ✓ | ✓ | ✓ | — | ✓ | — |
| `payments.allocate` | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `payments.reverse` | ✓ | ✓ | ✓ | — | — | — |
| `reports.operational.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `reports.financial.read` | ✓ | ✓ | ✓ | — | — | ✓ |
| `reports.export` | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| `audit.read` | ✓ | ✓ | ✓ | — | — | — |
| `notifications.preferences.manage` | ✓ | ✓ | — | — | — | — |
| `notifications.send_manual` | ✓ | ✓ | — | — | — | — |
| `billing.read` | ✓ | ✓ | — | — | — | — |
| `billing.manage` | ✓ | — | — | — | — | — |
| `business.owner.transfer` | ✓* | — | — | — | — | — |

`✓*` means a separate, step-up-authenticated owner-transfer workflow, not a routine role toggle. “Sales / AR clerk” can be split into sales-only and collections-only roles if customer workflows need narrower separation. These are recommended defaults, not assumptions about current family-business roles.

## Fine-grained behavior

- **Owner:** Full business authority and billing ownership; may appoint an admin and transfer ownership. No platform-wide authority implied.
- **Admin:** Manages settings, branches, members and business-scoped roles. Cannot transfer ownership, access other businesses, or edit global permission definitions.
- **Accountant:** Manages posted accounting records, allocations, reversals and financial reports. Reversal should require reason and leave original entries intact.
- **Sales / AR clerk:** Manages parties and drafts, posts authorized sales docs, views customer-facing history, and may allocate receipts only if explicitly granted.
- **Cashier:** Records receipts/payouts and views assigned operational reports; cannot edit posted invoices or transfer funds between tenant accounts.
- **Read-only manager:** Reads the permitted business/branch reports and exports without ledger writes.
- **Custom roles:** Owner/admin can compose from a permission allow-list. Disallow platform support, owner transfer, subscription provider, secret management, and irreversible deletion permission keys.

## Permission families

| Family | Example keys | Enforcement notes |
|---|---|---|
| Tenant/member | `business.read`, `members.invite`, `members.remove`, `members.roles.manage` | Scope member target to same `business_id`; never update Auth user globally when only business removal was requested. |
| Branch | `branches.read`, `branches.manage`, `reports.all_branches.read` | Membership grants a specific branch set or all-branch scope. Branch row must belong to the authorized business. |
| Counterparties | `parties.read/create/edit/archive` | Archive retains records with financial history. Sensitive contact fields may need column-level restrictions later. |
| Documents | `documents.read/create/edit_draft/post/reverse` | A posted document is immutable. Posting and reversing use atomic functions with audit rows. |
| Payments | `payments.read/record/allocate/reverse` | Ensure payment, party, document, currency, branch and allocations all match business and permitted branch. |
| Reporting | `reports.operational.read`, `reports.financial.read`, `reports.export`, `audit.read` | RLS also scopes source rows. Avoid a definer report function that forgets tenant and branch filters. |
| Notifications | `notifications.preferences.manage`, `notifications.send_manual` | Automated reminders run as system work but require business-level schedule/preferences and channel consent. Internal supplier alerts target only entitled members. |
| Billing | `billing.read`, `billing.manage` | Billing management limited to owner; provider webhooks use verified signatures and idempotency, not client role. |

## Platform support and break-glass access

- **Recommendation:** Keep platform support out of all tenant built-in roles. Store a separate `support_access_grants` record with platform operator, business, reason/ticket, approver, start/expiry, and revoked timestamp.
- **Recommendation:** Default support access to no ledger data. Require explicit approval and short duration for scoped read access; sensitive writes should remain disabled or separately approved. Log every access and export in an immutable platform audit stream.
- **Recommendation:** Use an emergency break-glass process with strong authentication, alerting, post-event review and customer-visible audit record. Do not implement a hidden global `is_owner` boolean that bypasses tenant policy.

## Database enforcement requirements

1. Create permission helper(s) that derive `auth.uid()`, membership, active status, business role assignments, branch grant and permission in Postgres.
2. Enable RLS and grant the minimum SQL privileges on every exposed table. Write policies with tenant and branch checks in both `USING` and `WITH CHECK` for updates.
3. Use composite tenant foreign keys so a caller cannot attach a valid foreign business party/document/payment ID to another tenant's row.
4. Restrict role assignment RPCs to same-business memberships, disallow self-upgrade and prevent assigning protected owner capabilities.
5. Ensure Edge Functions using `service_role` validate the current caller's JWT, target business membership and exact permission before the service-role action.
6. Test direct REST requests and RPC calls for each role and branch; UI visibility is not an authorization test.
