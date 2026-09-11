# Golden State Visions Client Portal

This repository is the production client and administration portal for Golden State Visions (GSV). It manages clients, property sites, orders, appointments, invoices, payments, protected media delivery, marketing assets, and transactional email.

This document is also the canonical technical handoff for future Codex chats. Read it completely before changing the portal, its database, payments, email, calendar behavior, or the connected public website.

Last reviewed: September 10, 2026

## Mandatory startup checklist

Before making any change:

1. Read this entire README and the root `AGENTS.md`.
2. Run `git status --short` and `git log -10 --oneline`.
3. Treat every existing modification and untracked file as user work until proven otherwise.
4. Inspect the relevant code and current diff before editing. Do not rely only on an earlier chat summary.
5. Identify whether the change also affects the public website repository at `/Users/cory/Documents/Real Estate Media`.
6. Read that repository's `AGENTS.md` before touching it.
7. Never send a real email, create/capture/refund a payment, change DNS, mutate production data, deploy, commit, or discard unrelated work unless the user's request authorizes it.

## Repository and production map

| Concern | Canonical location | Production |
| --- | --- | --- |
| Client/admin portal | `/Users/cory/Projects/app-gsvisions`, branch `main` | `https://app.gsvisions.co` |
| Public website and booking UI | `/Users/cory/Documents/Real Estate Media`, branch `master` | `https://gsvisions.co`, `https://www.gsvisions.co`, `https://booking.gsvisions.co` |
| Portal hosting | Vercel project `app-gsvisions`, team `gsvisions` | Git deployment from `main` |
| Data and authentication | Supabase | Production project reference is stored by the linked CLI configuration; never copy credentials into documentation |
| Card payments | Stripe | Server webhook is authoritative for successful Stripe payments |
| PayPal payments | PayPal REST API | `PAYPAL_ENVIRONMENT` must explicitly distinguish `live` from `sandbox` |
| Transactional email | Resend | Controlled by `OUTBOUND_EMAIL_ENABLED` and `RESEND_API_KEY` |
| Calendar | Microsoft 365 / Graph | Calendar updates and appointment notifications are coupled deliberately |
| Media storage | S3-compatible object storage via AWS SDK | Downloads are signed and access-controlled |

The portal and website are separate repositories but one booking system. A change is not end-to-end complete until both sides agree on payloads, prices, product identifiers, appointment semantics, and customer-facing copy.

## Technology

- Next.js App Router
- React 19
- TypeScript
- Supabase Auth, Postgres, RLS, and RPC functions
- Stripe and PayPal
- Resend
- Microsoft Graph / Microsoft 365 calendar
- AWS SDK / S3-compatible object storage
- Vercel

Useful commands:

```bash
npm run dev
npx tsc --noEmit
npm run lint
npm run build
```

The production build uses `next build --webpack`.

## Product and pricing invariants

These business rules are intentional. Do not silently normalize or simplify them.

- Standard Media starts at $300 for properties under 2,000 sq. ft. and rises by tier.
- Package discounts are designed to grow as a package contains more services.
- Video Plus and Signature include both aerial drone photography and aerial drone video.
- Marketing Kit is included with every package and is displayed as a $100 value.
- Property Domain is not a standard booking add-on. It remains a separate portal upgrade with a markup.
- Additional Floor Plan is not a standard booking add-on.
- A 2D floor plan may exist as a zero-dollar included service for operational/CubiCasa access. Do not advertise it as included unless the customer asks or the selected product explicitly includes it.
- Online booking is allowed above 7,000 sq. ft.; add $100 per additional 1,000 sq. ft.
- Large properties over one acre add $50.
- An on-location twilight photoshoot is $225 up to 4,000 sq. ft. and $300 over 4,000 sq. ft. Customer-facing order labels should simply say `Twilight photoshoot` without the tier text.
- An on-location twilight photoshoot is a separate return visit with its own date, time, duration, and calendar event. It must never extend or merge into the primary daytime appointment.

Catalog changes must be synchronized across:

- portal catalog API and database catalog rows;
- `scripts/sync-live-catalog.mjs`;
- website booking and pricing data;
- invoices;
- confirmation, appointment, payment, and media-ready email descriptions;
- package-to-service links in Supabase migrations.

Never rely on editing an old migration that may already have run. Add a new, idempotent corrective migration.

## Booking and client identity

The public website sends signed booking payloads to the portal through integration routes. Important routes include:

- `POST /api/integrations/website-booking`
- `POST /api/integrations/customer-lookup`
- `POST /api/integrations/property-address-lookup`
- `GET /api/catalog`

The shared integration secret is `PORTAL_INGEST_SECRET`. Do not log or expose it.

Required behavior:

- Admin cancellation is record-preserving: mark the site and booking canceled, remove their Microsoft 365 appointment events, close pending change requests/notification holds, and retain invoices and payment history.
- The cancellation dialog defaults to no email. An admin must explicitly choose whether to send the branded client cancellation, and can preview the exact email before taking action. Cancellation emails use the outbox idempotency key `booking-cancellation:{bookingId}` so retries cannot send duplicates.
- Permanent deletion is reserved for test sites, requires typing `DELETE`, never sends an email, and remains blocked when payment records exist.

- Customer email is required for ingest.
- Store client name, email, and phone on the booking as a durable snapshot as well as linking a profile.
- Portal pages must fall back to the booking snapshot if a linked profile is temporarily missing.
- A failed invitation email must never delete the customer profile or order.
- Exact normalized-address lookup warns about an existing property, but does not automatically reject a legitimate repeat booking.
- Repeated checkout submissions must be idempotent. Do not create a second order or second payment for the same provider/session event.
- `profiles.payment_required_at_checkout` is exposed through the signed customer lookup. When enabled, the website must hide deferred payment and both the website pay-later route and portal booking ingest must reject an unpaid booking. The paid Stripe/PayPal completion paths remain the only permitted checkout completion paths for that client.

## Appointments and calendar

Primary and twilight appointments are separate scheduling objects. Calendar behavior is implemented across booking ingest, invoice/order edits, rescheduling, and the Microsoft 365 helper.

Relevant areas:

- `lib/m365-calendar.ts`
- `lib/appointment-change-email.ts`
- `app/api/bookings/[id]/reschedule/route.ts`
- `app/api/sites/[id]/invoice/route.ts`
- `app/api/calendar/route.ts`

Invariants:

- Reject past appointment date/time selections.
- Do not treat adding a service as a schedule change unless its appointment actually changed.
- Update only the intended calendar event.
- A twilight return visit gets a second calendar event.
- If Microsoft 365 cannot confirm the relevant event update, do not claim that the customer notification succeeded.
- Admin order editing is explicit-save, not per-field autosave.
- Saving with `Do not email the client about this save` updates the order and calendar but suppresses the appointment-change email.
- Without suppression, one explicit save should produce at most one consolidated appointment-change email.

## Payment model

The `payments` table is the internal ledger. Do not infer a successful payment merely because a checkout session/order was created or because a user reached a success page.

Authoritative success signals:

- Stripe: verified webhook for a succeeded provider payment.
- PayPal: successful server-side capture response and verified identifiers.
- Check/cash: an explicit authenticated admin action.

Relevant areas:

- `app/api/stripe/webhook/route.ts`
- `app/api/invoice-public/[token]/pay/route.ts`
- `app/api/invoice-public/[token]/paypal/order/route.ts`
- `app/api/invoice-public/[token]/paypal/capture/route.ts`
- `app/api/sites/[id]/payments/manual/route.ts`
- `app/api/sites/[id]/payments/[paymentId]/refund/route.ts`
- `lib/paypal.ts`
- `lib/payment-history.ts`
- `lib/payment-received-email.ts`
- payment and refund migrations under `supabase/migrations/`

Ledger conventions:

- Stripe provider references are Stripe payment intent IDs.
- PayPal references begin with `paypal:`.
- Manual references begin with `manual:cash:` or `manual:check:`; check number is optional.
- `amount_cents`, `refunded_cents`, currency, provider time, and status determine net paid amount.
- Invoice totals, paid amount, and balance due must be recalculated from current order totals and the net successful ledger.
- A manual payment correction must replace the old manual amount in validation math, not add both old and new values.
- Refunds require a deliberate admin action and must update the provider (when applicable), refund ledger, order balance, and media lock consistently.
- Sandbox PayPal transactions are not real charges and must never be represented as live funds.

Before payment testing, confirm all of the following explicitly:

1. Stripe or PayPal environment is test/sandbox.
2. The target order is a test order.
3. No real customer will receive email.
4. The provider event/capture ID is unique.
5. The portal ledger, invoice, payment email, and media lock agree after the test.

## Media delivery and access control

Media release and payment unlock are different concepts:

- A file must be published/ready before it is releasable.
- If a live balance is due, full-size viewing and download remain locked.
- Email links are long-lived entry points. When clicked, the server must check the current balance and release state rather than trusting the state when the email was sent.
- Media-ready emails can include both `View and download media` and `Pay balance` actions.
- If the user clicks the media action while a balance is due, route them through payment.
- Payment received with a zero balance exposes `View invoice` and `Download media` actions.

Protected gallery preview behavior:

- Show up to nine previews.
- Use the primary/hero photo first.
- Select the remaining previews at evenly distributed positions across the full ordered shoot (for example 1, 6, 12, 18...).
- Display the true photo number, not the preview position.
- Apply the subtle GSV watermark asset at `public/gsv-preview-watermark.png`.
- Never expose original/full-resolution download URLs while payment-locked.

Relevant areas:

- `app/api/media/list/route.ts`
- `app/api/media/[id]/download/route.ts`
- `app/api/sites/[id]/media-download/route.ts`
- `lib/media-access.ts`
- `lib/media-delivery-email.ts`

## Email system and safety

Transactional email is a production side effect. Reading code, rendering HTML locally, or inspecting a draft is safe; calling a send endpoint is not.

Global safety switch:

- `OUTBOUND_EMAIL_ENABLED` must be one of `1`, `true`, `yes`, or `on` for sending to be allowed.
- `requireOutboundEmailApiKey()` enforces the switch before returning `RESEND_API_KEY`.
- Deleting/rotating a provider key is an emergency stop, not normal application control.

Required delivery behavior:

- Every email sent to anyone must BCC Cory through `EMAIL_AUDIT_BCC`, with `cory@gsvisions.co` as the code fallback.
- Preserve recipient deduplication so Cory is not added twice when already the direct recipient.
- Use the branded green/yellow email theme, logo header, useful content blocks, and Cory signature.
- The checklist action is named `Photoshoot Checklist`.
- Payment receipts show the current payment plus complete payment history and the resulting balance/payment status.
- Invoices show payment details/history.
- Never use a development sample endpoint against a real customer or production order.
- Never send or resend missed emails until delivery records and provider status have been checked to avoid duplicates.

Email types include booking confirmation, appointment update, payment received, media ready, client invite/reset, and property lead notification. Resend delivery/open/click events are recorded through `/api/webhooks/resend` and `/api/email-track`.

If an email incident occurs:

1. Set `OUTBOUND_EMAIL_ENABLED=false` in the production environment and deploy/restart as required.
2. If messages continue, revoke the Resend API key as an emergency provider-level stop.
3. Do not trigger more saves or retries.
4. Inspect `outbound_messages`, provider message IDs, status, recipient, subject, and timestamps.
5. Determine whether the provider accepted each message before retrying.
6. Fix idempotency/consolidation first, test without real recipients, then re-enable explicitly.

## Authentication and authorization

- Supabase Auth manages sessions.
- Server routes must use the server auth helpers and verify admin/client authorization.
- RLS is part of the security boundary; do not bypass it casually.
- Service-role credentials are server-only.
- Client assistants and co-listers have deliberately constrained access.
- Password setup/reset uses dedicated server routes and branded email.
- Do not expose internal IDs, secrets, signed URLs, or service-role behavior to unauthenticated clients.

## Database and migrations

Supabase migrations live in `supabase/migrations` and cover:

- payment and refund ledgers;
- RLS and public-schema hardening;
- communications outbox and engagement tracking;
- website booking ingest and property synchronization;
- portal workflows and access events;
- client assistants and site co-listers;
- property leads and site analytics;
- marketing design data;
- catalog and pricing corrections.

Migration rules:

- Never edit an already-applied migration as the only fix.
- Create a new timestamped, idempotent corrective migration.
- Qualify ambiguous PL/pgSQL column references with table aliases or renamed variables.
- Test calculations against partial payment, full payment, overpayment rejection, correction, partial refund, and full refund.
- Never run destructive production SQL without resolving exact target rows and obtaining explicit authorization.

## Environment variables

Variable names used by the application are listed below. Values are secrets and must not be copied into this README, chat, logs, screenshots, or commits.

### Core and URLs

- `APP_ENV`
- `NEXT_PUBLIC_APP_URL`
- `PORTAL_PUBLIC_URL`
- `PORTAL_INGEST_SECRET`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Email

- `OUTBOUND_EMAIL_ENABLED`
- `RESEND_API_KEY`
- `RESEND_WEBHOOK_SECRET`
- `EMAIL_FROM`
- `EMAIL_REPLY_TO`
- `EMAIL_AUDIT_BCC`
- `APPOINTMENT_CHANGE_BCC`
- `MEDIA_DELIVERY_BCC`
- `PAYMENT_NOTIFICATION_EMAIL`
- `EMAIL_TRACKING_SECRET`

### Payments

- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_ENVIRONMENT`

### Calendar and scheduling

- `M365_TENANT_ID`
- `M365_CLIENT_ID`
- `M365_CLIENT_SECRET`
- `M365_CALENDAR_EMAIL`
- `M365_APPOINTMENT_BUFFER_MINUTES`
- `RESCHEDULE_TOKEN_SECRET`

### Media and optional services

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `AWS_DEFAULT_REGION`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `CUSTOM_DOMAIN_MARKUP_FLAT_CENTS`
- `CUSTOM_DOMAIN_MARKUP_PERCENT`
- `MARKETING_KIT_EDITOR_ENABLED`
- `SITE_ANALYTICS_SALT`

### Vercel automation

- `VERCEL_API_TOKEN`
- `VERCEL_PROJECT_ID`
- `VERCEL_PROJECT_NAME`
- `VERCEL_TEAM_ID`

## Validation expectations

Run checks proportional to the change. At minimum for application changes:

```bash
npx tsc --noEmit
npx eslint path/to/changed-file.ts
npm run build
```

For cross-repository booking changes, also run the website production build and its mobile regression suite as instructed by its `AGENTS.md`.

Known baseline as of the last review:

- Portal TypeScript and production build pass.
- Portal has one existing `@next/next/no-img-element` warning in the large site dashboard page.
- The public website production build and six mobile regression tests pass.
- The public website's large booking component has pre-existing React compiler/lint debt. Distinguish baseline findings from new failures; do not conceal either.

## Git and deployment procedure

The goal is a clean, explainable production state.

1. Inspect `git status`, full relevant diff, and recent commits.
2. Preserve unrelated user work.
3. Make a narrowly scoped change.
4. Run focused lint/type checks and the production build.
5. Review the final diff.
6. Commit only the intended files with a descriptive message.
7. Push `main` only when the user has authorized making the change live.
8. Let Vercel's Git integration deploy production.
9. Verify `vercel inspect app.gsvisions.co` reports `target production`, `status Ready`, and the expected new deployment.
10. Smoke-test read-only routes. Do not use live payment or email sends as a deployment smoke test.
11. Confirm `git status --short` is empty and `main` matches `origin/main`.

Do not use `vercel --prod` for normal releases. Do not call a change live merely because it was pushed; verify the production alias moved to a Ready deployment.

## Production incident checklist

When data, payments, email, or appointments disagree:

1. Stop the side effect if it is still occurring.
2. Preserve evidence: order/site ID, booking ID, provider IDs, timestamps, screenshots, and outbound message IDs.
3. Query the narrowest exact record set; do not bulk-repair by assumption.
4. Establish the authoritative source:
   - provider webhook/capture for payments;
   - Microsoft 365 event for calendar state;
   - Supabase ledger/RPC result for portal totals;
   - Resend provider result plus `outbound_messages` for email acceptance.
5. Explain root cause separately from customer impact.
6. Repair current data only with explicit authorization.
7. Add a forward-looking invariant/idempotency fix and regression test.
8. Verify production and leave both repositories clean.

## Required end-of-chat handoff

Any chat that changes or investigates this system should finish with a concise handoff containing:

- objective and user-visible outcome;
- exact files changed;
- database migrations or production data mutations;
- payment, email, calendar, DNS, and deployment side effects performed;
- checks run and their results;
- commits pushed and production deployment URL/status;
- known baseline warnings or unresolved risks;
- local changes that remain and who owns them;
- safe next action.

Never state that everything is live, fixed, clean, or verified without the corresponding evidence.
