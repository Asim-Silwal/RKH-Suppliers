# Notification architecture proposal

**Status:** Future design only. No provider, database, scheduler, or application changes were made.

## Goals and boundaries

- Support customer due-payment reminders over email, WhatsApp and SMS, and internal supplier payment alerts to authorized business employees.
- Keep notification delivery asynchronous and independent from posting a sale, purchase, receipt or supplier payment.
- Enforce tenant scope, recipient consent, preferences, quiet hours, provider configuration and business-local time rules before enqueue and immediately before send.
- Keep an auditable, retryable delivery history without keeping unnecessary message contents or secrets indefinitely.
- Provider/API credentials are server-side secrets. They never enter the React bundle, logs, notification preferences, templates or user-editable rows.

## Proposed components

1. **Ledger event/outbox:** The same Postgres transaction that posts a document/payment writes a minimal outbox row. It contains business, branch, entity ID/type, event type, occurred-at and an idempotency key. It does not call an external provider.
2. **Reminder scheduler:** A scheduled Supabase Cron/Edge Function reads due reminder rules and open receivables/payables, checks tenant settings/time zone/preferences/consent, then creates unique notification jobs and enqueues job IDs.
3. **Durable queue:** Supabase Queues (`pgmq`) carries work to background consumers. Queue message means “process this job”; the durable application job/delivery tables remain the business audit source. Supabase documents Queues as Postgres-backed durable delivery and provides consumer/Edge Function patterns: [Queues](https://supabase.com/docs/guides/queues), [quickstart](https://supabase.com/docs/guides/queues/quickstart).
4. **Channel workers/adapters:** A server-side Edge Function reads a job, revalidates it, renders a versioned template, sends through Email/WhatsApp/SMS provider, then records provider outcome and next state. Keep provider adapters isolated so one channel outage does not block another.
5. **Provider callbacks:** Signed delivery-status webhooks update append-only provider events and a materialized latest delivery status. Verify signature, timestamp/replay window and expected provider account before processing.
6. **Preference center/admin UI:** Business admins configure schedules/templates; customers manage permitted channels and opt-out. UI is not the enforcement point; sender rechecks the database state immediately before provider call.

Edge Function background `waitUntil` is suitable for short best-effort work, but durable scheduled reminders and retries should use the queue/job records. Supabase describes Edge Function background tasks at [Background Tasks](https://supabase.com/docs/guides/functions/background-tasks). Current app already has a push service worker/notification Edge Function; retain it as a separate PWA channel rather than treating browser push as email/SMS/WhatsApp.

## Proposed data records

Every row below is business-scoped with `business_id not null`; branch scope is optional but same-business constrained. Only global provider/template catalogs and queue internals are outside the tenant-owned public data model.

| Table | Essential fields and behavior |
|---|---|
| `business_notification_settings` | Business, timezone, enabled channels, default quiet hours, sender identity reference, locale. No provider secret values. |
| `reminder_schedules` | Business, event type (`document_due`, `document_overdue`, `supplier_payment_due`), enabled, relative offset (e.g. N days before/after), local time, branch scope, recipient rule, template ID/version, channel set. Validate bounded offsets and supported channels. |
| `notification_preferences` | Business, recipient kind/user-or-party, channel, event category, enabled/quiet-hours/locale. Defaults to no customer marketing consent. Internal staff preferences are separate from external customer consent. |
| `party_channel_contacts` | Business, party, channel, normalized destination and status. E.g. verified email/phone; enforce tenant FK, do not expose full contact through notification workers unnecessarily. |
| `party_channel_consents` | Business, party, channel, purpose (`transactional_reminder` or `marketing`), state (`unknown`, `opted_in`, `opted_out`), captured time/source/version/evidence reference, revoked time. Append consent changes; current state is derived or safely projected. |
| `notification_templates` | Business or approved global template, channel, locale, category, version, content, provider template reference/approval state. WhatsApp template approval is versioned and provider-specific. Avoid sensitive amounts/ledger details in preview text by default. |
| `notification_jobs` | Business, branch, event/source type and ID, recipient party or member, channel, template version, `scheduled_for`, status, dedupe key, attempts count, last error code, created/updated timestamps. Unique dedupe key prevents duplicate scheduled reminder creation. |
| `notification_deliveries` | Business, job ID, channel, provider/account reference, provider message ID, current status, accepted/delivered/read/failed timestamps, last sanitized error, retry-after. Unique `(business_id,job_id,channel)` for one logical delivery. |
| `notification_attempts` | Business, delivery ID, attempt number, start/end, provider response class, sanitized error, retry decision, provider request correlation ID. Append-only; never store credentials or full sensitive content. |
| `provider_message_events` | Business, provider, provider event ID, message ID, status, occurred time, verified signature result and minimal payload digest. Unique provider event key prevents callback replay from duplicating state. |
| `notification_outbox` | Business, branch, source ledger event, event type, occurred time, processed timestamp; unique `(business_id,source_type,source_id,event_type)`. Created in the same commit as the source event. |

Use composite tenant FKs throughout. Store provider credentials in Edge Function secrets or managed secret storage, not these tables. Encrypt or tightly protect normalized destinations; redact them in logs and limit worker reads.

## Scheduling rules and duplicate prevention

- Business-local timezone is explicit (IANA timezone); store job instants as `timestamptz` in UTC and retain the schedule’s intended local date/time for daylight-saving/reconciliation.
- Schedules are relative to due dates and business preferences, for example due-soon (3 days before), due-today, and overdue (1/7/14 days after). These are defaults, not hardcoded universal behavior.
- On a schedule tick, generate a stable occurrence key from business + branch + event + source financial document + rule/version + local occurrence date + recipient + channel. Unique constraints make repeated scheduler runs idempotent.
- Recheck before send: source still open/outstanding, business active, job not canceled, schedule enabled, destination verified, consent/preferences permit channel, quiet hours elapsed, branch/member is eligible, and no equivalent delivery already succeeded.
- A payment/allocation or reversal may cancel not-yet-sent reminders for the now-settled document. Already-sent messages remain in history. A subsequent overdue amount can create a new occurrence based on remaining balance and a new dedupe key.
- Enforce per-business and per-destination rate limits. Batch large schedules and prioritize due events fairly across tenants so one business cannot starve the queue.

## Consent, opt-out and customer protection

- Default customer outbound messaging to off until consent/eligibility is recorded. Track consent separately by channel and purpose; do not infer WhatsApp/SMS permission from having a phone number on file.
- Record who/what captured consent, timestamp, channel, purpose, policy/template version, and evidence reference. Store opt-out events as append-only history with current effective state.
- Support channel-specific unsubscribe: email unsubscribe link/headers, SMS STOP/keyword handling where provider/country supports it, and WhatsApp opt-out/callback keywords. Apply immediately to future matching jobs and recheck state at send time.
- Transactional/account reminders and promotional marketing have different categories and preferences. Never reclassify marketing as transactional to bypass opt-out.
- Avoid sending ledger details in push/SMS lock-screen previews. Use minimal text such as “A payment reminder is available in RKH Ledger”; link to authenticated app if useful.
- Local rules, provider terms and consent expectations vary by jurisdiction and channel. Obtain legal/product review before enabling each market/channel; this design does not determine compliance.

## Internal supplier payment alerts

- These are business notifications to employees, not messages to the supplier. Trigger from an upcoming/overdue posted payable or recorded supplier payment.
- Resolve recipients from explicit notification preferences and active business memberships with `notifications.internal_supplier_alerts` and branch access. Do not notify all Auth users or all RKH users globally.
- Send minimal amount/due-date/supplier context only to roles authorized to view financial data; branch-limited employees receive only their branch. Email/SMS alerting requires staff channel preference and validated destination.
- Deduplicate by business + payable source + schedule + recipient + channel + occurrence. A supplier payment cancels future alerts for the settled amount; partial settlement recalculates remaining payable and future schedule.

## Delivery state and retry behavior

```text
scheduled -> queued -> processing -> accepted -> delivered -> read (if provider supports)
                                |-> retry_wait -> queued
                                |-> suppressed (consent/quiet-hours/settled)
                                |-> failed_permanent
                                |-> dead_letter (retry budget exhausted)
```

- Use exponential backoff with jitter, bounded attempts and provider-specific retry classification. Retry network timeouts, rate limits and temporary server errors; do not retry invalid destinations, revoked consent, rejected templates or permanent provider errors without remediation.
- Queue visibility/ack occurs only after delivery result is persisted. A worker crash returns the job for retry. A periodic reconciler recovers stuck `processing` rows and checks queue/job disagreement.
- External sends cannot be guaranteed exactly once solely by queue semantics: a provider may accept a request while the worker loses the response. Use provider idempotency keys where available, query provider state where supported, and mark ambiguous outcomes for reconciliation rather than blindly resending.
- Keep an immutable attempt record per send try, including sanitized provider status and trace IDs. Maintain a dead-letter/admin requeue flow with permissions and reason; requeueing preserves original attempt history.
- Inbound provider callbacks are signature-validated and idempotent; callback event IDs are unique. Apply status transition ordering so stale callbacks cannot downgrade delivered to queued/failed.

## Security, RLS and secret handling

- RLS scopes job, preference, contact/consent and delivery rows by business membership and permission. External customers do not get direct Data API access to business tables; their opt-out endpoint uses a tightly scoped signed token or provider-verified webhook with rate limiting.
- Browser users cannot insert queue messages, set delivery status, choose arbitrary recipient/business, or mark consent on behalf of a customer without an audited consent-capture permission.
- Queue consumers and webhook functions validate caller/provider; service-role credentials remain server-only. Provider send APIs use least privilege, per-environment accounts and rotation.
- Secrets never appear in app logs, attempts, queue payloads, PDFs or provider webhook dumps. Queue payloads carry opaque IDs only; workers load restricted records server-side.
- Provide retention policy for message payloads, destinations, consent evidence and delivery history. Prefer template/version plus payload hash over storing full rendered messages unless support/legal needs justify a protected, time-limited copy.

## Rollout path

1. Keep current Web Push behavior isolated; first establish tenant-scoped outbox/job/delivery records and one internal email provider in staging.
2. Add customer consent/preferences and email reminders for a pilot business; validate dedupe, stop-on-payment, timezone and retry behavior.
3. Add SMS with inbound opt-out handling and country-aware sender setup.
4. Add WhatsApp template approval/versioning, opt-in proof, provider callbacks and sender-account management.
5. Add user-configurable schedules, branch preferences, delivery analytics and metering after reliability/consent flows are proven.

The Supabase Queue docs currently describe durable Postgres-backed messages and consumer patterns, but provider-side effects still need the idempotency/reconciliation rules above. See [Supabase Queues](https://supabase.com/docs/guides/queues) and [Edge Function scheduling](https://supabase.com/docs/guides/functions/scheduling-functions).
