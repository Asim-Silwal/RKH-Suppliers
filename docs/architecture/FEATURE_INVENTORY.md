# Feature inventory

This inventory is based on `artifacts/mockup-sandbox/src/App.tsx`, its components and libraries, Supabase migrations/functions, and the PWA assets. It distinguishes shipped behavior from conclusions inferred from code.

## Accounts, profile and access

- **Confirmed from source:** Email/password login through Supabase Auth; logout; auth-state listener; role/profile load; permission-based navigation and operation controls. Profile page supports name/contact and avatar upload. `MobileLock` provides optional device passkey or password re-verification for mobile privacy.
- **Confirmed from source:** Owner-only user tools create users with email/name/password, reset passwords, delete users, assign a role, create/edit/delete custom roles, and display permissions. The Edge Functions use Supabase service role only server-side. Password policy in these functions is 12–128 characters.
- **Confirmed from source:** Built-in roles currently include Admin, Manager, and Staff. Permission keys include ledger view, party writes/deletes, transaction writes/deletes, reports, cooperative access, and staff customer-balance-only access.
- **Inferred from implementation:** Account creation is invitation/owner-admin driven; there is no public self-registration or new-business onboarding in committed production source. Roles attach globally to a user profile, not to a business membership.

## Ledger and parties

- **Confirmed from source:** Parties are Customers or Suppliers, with name, company, contact, location and notes. Directory/search and party details show purchase/sale history, payments and net outstanding/advance. Party type may be changed in the edit form.
- **Confirmed from source:** Transactions have two types: `PURCHASE` and `PAYMENT`. UI labels depend on party type. Amounts are validated as positive money with at most two decimal places; dates are stored as English date (AD) and Nepali date (BS). Descriptions are supported.
- **Confirmed from source:** A purchase/sale can have an optional same-day partial payment. The app inserts the purchase and payment as two rows in one database insert request. Later payments are recorded separately. Transaction edit, multi-select delete (with permission), and party deletion are implemented.
- **Confirmed from source:** Transaction history supports party/description search, transaction-type filter, BS from/to filter, and client-side “show more” batches. It supports a PDF export.
- **Inferred from implementation:** Net balance is calculated from every loaded party transaction; the app does not keep a separate account balance value. Payment allocation to individual invoices is not represented.

## Dashboard, reports and statements

- **Confirmed from source:** Dashboard shows financial summaries and business position based on the loaded ledger. Reports offer week/month/year/lifetime/custom date period selection and sales/purchases, money received/paid, balance, and payment efficiency metrics. Report/transaction PDFs are generated in-browser.
- **Confirmed from source:** Party PDF statements include transaction rows, running balance, totals and closing balance/advance. The PDF embeds a bundled Noto Sans Devanagari font and uses `pdf-lib` to support Nepali text. Cooperative history has a separate PDF export.
- **Inferred from implementation:** Report metrics and PDF exports inherit the client-side data-load limit/behavior; validate totals once transaction counts approach the Supabase REST row limit. There is no separate server-generated, tamper-evident accounting report.

## Cooperative savings (Sahakari)

- **Confirmed from source:** Cooperative names and suggested daily deposits; one entry per cooperative/date; records deposit/no-deposit, amount or reason, recorder, history, and permission-gated edits. Migrations backfill a named default cooperative and preserve recorder names when an Auth user is removed. Calendar/time helper uses Kathmandu-aware logic and BS display.
- **Inferred from implementation:** Sahakari is a domain-specific companion ledger, not part of customer/supplier balances or general accounting reports.

## Notifications and PWA

- **Confirmed from source:** Inbox has Admin and Activity categories, unread state, mark-read support, and recipient-specific rows. Web Push subscriptions use VAPID; an Edge Function sends notifications and cleans expired subscriptions; a scheduled database job calls notification delivery. The service worker displays push notifications and opens the inbox.
- **Confirmed from source:** `manifest.webmanifest` provides standalone display, app icons and theme metadata; HTML links the manifest and icons. Responsive layouts have mobile breakpoints and safe-area treatment; tests exist for device lock and notifications.
- **Confirmed from source:** The service worker comment explicitly says it does not cache private ledger data. There is no offline ledger mode or background sync implementation.
- **Recommendation:** Keep the no-private-data-cache property unless offline support is deliberately designed with encrypted, per-user storage, business switching/session invalidation, and conflict handling.

## Tests and verification assets

- **Confirmed from source:** `tests/deviceLock.test.ts` covers WebAuthn challenge/origin/authenticator-data/signature validation and enrollment. `tests/notifications.test.ts` and browser CJS scripts cover notification behavior; a mobile-lock browser script exists. There is no broad accounting, RLS isolation, report-total, database migration, or end-to-end tenant test suite visible in the app package scripts.
- **Inferred from implementation:** Existing tests cover isolated features, not ledger correctness or real database permissions. They should not be considered evidence of multi-tenant isolation.
- **Recommendation:** In a later implementation phase, add isolated DB tests for cross-tenant reads/writes and property tests for balances, payments, dates, and PDF totals. Keep this audit-only task free of code/test changes.
