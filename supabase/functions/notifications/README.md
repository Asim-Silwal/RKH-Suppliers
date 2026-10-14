# Web push notifications

Apply the `add_web_push` migration and deploy `notifications` with JWT verification enabled. The function also verifies the session with Auth and checks `app_owner` for sending and history. It uses the built-in Supabase service-role environment variable only on the server.

On the first authenticated request, a VAPID key pair is generated and stored once in `notification_vapid`. The table has RLS, no client policies, and no anonymous/authenticated grants. Only the service role can select/insert. The private key is never returned to the browser. Keep this table in database backups; replacing its keys invalidates existing subscriptions. The no-policy advisor notices on the three server-only notification tables are intentional.

Users enable notifications from Profile → Notifications on each device. On iPhone they must open the installed Home Screen app (iOS 16.4+). Permission is requested only after tapping Enable. Signing out or switching accounts unsubscribes the old device subscription. Expired subscriptions are removed on sending. No private ledger responses are cached by the service worker.

Owners send from the dedicated Send notifications page in the sidebar (or the profile menu on mobile). Sends accept a title, message, and all opted-in users or one user. The UI keeps the same request UUID when retrying an uncertain send; the server records it before delivery to prevent duplicate sends. Outcomes count push-service acceptance, not confirmed device delivery. A function interruption may leave a send marked processing; it must not be automatically retried with a new UUID. Sends are limited to five per minute and 200 devices per request, with 20 concurrent deliveries and an eight-second delivery timeout. Notification links always open/focus this app and preserve its privacy lock.

Verification:

```sh
node --test artifacts/mockup-sandbox/tests/notifications.test.ts
node artifacts/mockup-sandbox/tests/notifications.browser.cjs <path-to-playwright>
```

The browser test mocks push and the backend; it never sends to real users. Final real-device acceptance: open the iPhone Home Screen app, enable notifications, background it, and use the owner sender to send a message to that same account. Confirm Notification Center presentation and that tapping it still requires the configured app unlock.
