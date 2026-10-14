# Web push notifications

Apply the `add_web_push` migration and deploy `notifications` with JWT verification enabled. The function also verifies the session with Auth and checks `app_owner` for sending and history. It uses the built-in Supabase service-role environment variable only on the server.

On the first authenticated request, a VAPID key pair is generated and stored once in `notification_vapid`. The table has RLS, no client policies, and no anonymous/authenticated grants. Only the service role can select/insert. The private key is never returned to the browser. Keep this table in database backups; replacing its keys invalidates existing subscriptions. The no-policy advisor notices on the three server-only notification tables are intentional.

The bell opens the full-screen inbox, with Admin and Activity tabs, a back button, paginated history, and persisted read state. Device notification settings are available through the inbox gear button. On iPhone users must open the installed Home Screen app (iOS 16.4+). Permission is requested only after tapping Enable. Signing out or switching accounts unsubscribes the old device subscription. Expired subscriptions are removed on sending. No private ledger responses are cached by the service worker.

Owners send from the dedicated Send notifications page in the sidebar (or the profile menu on mobile). Sends accept a title, message, and all opted-in users or one user. The UI keeps the same request UUID when retrying an uncertain send; the server records it before delivery to prevent duplicate sends. Outcomes count push-service acceptance, not confirmed device delivery. A function interruption may leave a send marked processing; it must not be automatically retried with a new UUID. Sends are limited to five per minute and 200 devices per request, with 20 concurrent deliveries and an eight-second delivery timeout. Notification links always open/focus this app and preserve its privacy lock.

Verification:

```sh
node --test artifacts/mockup-sandbox/tests/notifications.test.ts
node artifacts/mockup-sandbox/tests/notifications.browser.cjs <path-to-playwright>
```

The browser test mocks push and the backend; it never sends to real users. Final real-device acceptance: open the iPhone Home Screen app, enable notifications, background it, and use the owner sender to send a message to that same account. Confirm Notification Center presentation and that tapping it still requires the configured app unlock.

## Inbox and automated activity

Apply `notification_inbox_activity` and deploy `notification-delivery` as well. That worker has gateway JWT verification disabled because it verifies a dedicated 256-bit bearer token against its SHA-256 digest. The token is generated inside Postgres, stored in Vault, and never placed in source or client code. The server-only config table contains only its hash. The pg_cron job invokes the worker once per minute only when queued events exist; pg_net keeps HTTP work off the record-save path.

Database triggers create immutable events after new parties and transactions and after new Sahakari deposits (including a missed deposit changed to deposited). The event is committed atomically with its source record. Normal edits do not create another added notification. The actor comes from the authenticated database session. Transaction wording distinguishes customer purchases/payments and supplier purchases/payments; transaction dates include the saved BS date, while Sahakari dates explicitly indicate AD.

Events fan out into private per-user inbox rows. Admin sends are stored even when recipients have no enabled push device; existing admin history is backfilled without sending again. Activity begins from deployment; historic ledger entries are not replayed. Financial events require `ledger_view`, deposits require `sahakari_view`. Both inbox reads and background push targets recheck current access, so downgraded accounts cannot read old financial alerts. Recipients may only update their own `read_at`; clients cannot insert messages or change their contents.

The worker atomically leases up to two events per run, with at most 200 target devices each and 20 concurrent deliveries. Crashed leases retry after three minutes, up to three attempts. Provider acceptance is not proof of device delivery; failures are retained on events. Stable notification tags reduce duplicates if a worker crashes after sending but before recording completion. Direct provider errors are recorded rather than blindly resending successful deliveries. Events with too many targets are explicitly marked failed, and inbox messages remain available.

Run `supabase/tests/notification_inbox.sql` against a test database (or a transaction-capable SQL connection). It rolls back all fixtures, including queued events, and checks actor text, purchases/payments, deposits, private recipients, read state, revoked access, and client privileges. It does not send real notifications.
