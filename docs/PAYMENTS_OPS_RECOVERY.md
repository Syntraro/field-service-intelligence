# Payments Ops — Stripe charge / local-ledger reconciliation

This runbook covers the rare case where Stripe successfully charged a card
but our local payments ledger did NOT record the payment. The webhook
detects the mismatch, returns `200 OK` to Stripe (so Stripe stops retrying),
and writes a `payment_webhook_events` row with `outcome = 'config_error'`.

The dashboard's "Events requiring attention" banner picks up these rows
via `getTenantWebhookAnomalySummary`.

> ⚠️ **The money is at Stripe, not lost.** This is a recoverable state.
> Do NOT manually create a `payments` row to "match" the charge unless
> you've followed the steps below — guessing the allocation breakdown
> can desync invoice balances permanently.

---

## How the mismatch happens

Path: a staff operator opens the **Collect Payment** dialog on Invoice
Detail, picks **Credit card**, allocates amounts across one or more
unpaid invoices, clicks **Continue**, and confirms the card via the
embedded Stripe Elements form.

Internally that flow:

1. `POST /api/payments/card-intent` — server validates allocations
   against current invoice balances and creates a Stripe PaymentIntent
   for the SUM, packing the per-invoice allocations into Stripe metadata
   (`metadata.allocations` = compact tuple JSON).
2. The customer's card is charged at Stripe — the money moves.
3. Stripe fires `payment_intent.succeeded` → our webhook runs the
   `handleManualAllocationsPaymentSucceeded` branch, parses the
   metadata, and asserts `sum(allocations) === stripe.amount_charged`.
4. If they match: write one `payments` row + N `payment_allocations`
   atomically.
5. **If they don't match:** abort the write. Log structured
   `manual_allocations_amount_mismatch` to stdout. Persist a
   `payment_webhook_events` row with `outcome = 'config_error'` and a
   grep-friendly errorMessage. Return `accepted` to Stripe.

The most common trigger for the mismatch is an invoice balance
shifting between intent creation and webhook delivery — for example,
an unrelated manual payment from another operator that paid down one
of the included invoices in the seconds between Continue and the
webhook landing.

---

## Triage steps

### 1. Find the structured log line

The mismatch handler emits a single stdout line shaped like:

```
[anomaly] manual_allocations_amount_mismatch {"providerId":"stripe","eventId":"evt_…","providerPaymentId":"pi_…","chargeId":"ch_…","companyId":"…","customerCompanyId":"…","stripeAmountCents":99900,"allocationSumCents":99800,"diffCents":100,"allocationInvoiceIds":["…","…"],"prospectivePaymentId":"…"}
```

The same fields are persisted to `payment_webhook_events`:

```sql
SELECT
  received_at,
  provider_event_id,
  provider_payment_id,
  amount_cents,
  company_id,
  raw_metadata,
  error_message
FROM payment_webhook_events
WHERE outcome = 'config_error'
  AND error_message LIKE 'kind=manual_allocations%'
ORDER BY received_at DESC
LIMIT 50;
```

Each row's `error_message` is a key-value string:

```
kind=manual_allocations_amount_mismatch
providerPaymentId=pi_…
chargeId=ch_…
customerCompanyId=…
stripeCents=99900
allocationSumCents=99800
diffCents=100
invoiceCount=2
```

### 2. Find the Stripe charge

Open the [Stripe Dashboard](https://dashboard.stripe.com/) → search the
`providerPaymentId` (PaymentIntent id, e.g. `pi_…`) or the `chargeId`
(`ch_…`). The PaymentIntent metadata will show:

- `companyId`
- `customerCompanyId`
- `multiInvoiceMode = "manual_allocations"`
- `allocations` (compact tuple JSON: `[["<invoiceId>","<dollars>"], …]`)
- `prospectivePaymentId` (the UUID we minted server-side; this is the
  `payments.id` we WOULD have written)
- `source = "staff"`

The charge will show `Status: Succeeded`. The customer was charged.

### 3. Identify why the local sum diverged

Compare `metadata.allocations` (what we expected) to the
**current** balances of those invoices in our DB:

```sql
SELECT id, invoice_number, status, total, amount_paid, balance, updated_at
FROM invoices
WHERE id = ANY($1::varchar[]);
```

Common causes:

- **Concurrent manual payment.** Another operator hit Save on a manual
  payment for one of the included invoices between Continue and the
  webhook landing. Check `payments` for rows on those invoices with
  `received_at > <intent_created_at>`.
- **Refund / reversal.** Same window, same cause, opposite sign.
- **Stripe rounding.** Should never happen — the service computes the
  total in cents — but worth ruling out.
- **Stripe partial capture.** Should never happen on this code path
  (we don't use manual capture), but worth confirming `amount_captured`
  on the charge equals `amount`.

---

## Reconciliation options

Pick exactly **one** based on the cause.

### Option A — Refund the orphan charge at Stripe (PREFERRED when possible)

When the divergence reflects "the operator double-paid an invoice that
was already paid via another path":

1. In Stripe Dashboard, find the PaymentIntent and click **Refund**.
2. Refund the FULL amount (not partial) — this charge has no
   corresponding ledger entry; refunding it cleanly returns to the
   pre-charge state.
3. Verify the `charge.refunded` webhook lands and Stripe shows the
   PaymentIntent as fully refunded.
4. Communicate with the customer that the duplicate was refunded.

The local ledger remains untouched. The `payment_webhook_events` row
stays as a historical record but represents no missing money.

### Option B — Manually record the payment locally (when the charge is correct and money belongs to the tenant)

When the customer DID owe the full amount Stripe collected and we just
need to ledger it:

1. Identify the correct allocation breakdown. The metadata's snapshot
   may be stale; recompute against current balances.
2. Use the manual Collect Payment flow on the affected invoices,
   choosing method = **Other** (or **Credit card** if you want the
   ledger row to read "credit").
3. Set `reference` to the Stripe `chargeId` so the row is searchable.
4. Set `notes` to a short reconciliation memo (e.g. "Reconciled
   orphan charge ch_… from PaymentIntent pi_… on YYYY-MM-DD").
5. Save **without** "Save and Email Receipt" — the customer was
   already emailed by the original Stripe success path.

> Expected gap: the resulting `payments.providerSource` will be
> `"manual"`, not `"stripe"`. That's accurate — this row is a manual
> reconciliation entry, not a Stripe-attributed payment. Reports that
> filter `providerSource = 'stripe'` will not double-count.

### Option C — Escalate to engineering

Required when:

- The mismatch error fires repeatedly for the same tenant (more than
  twice in a 24h window).
- The PaymentIntent metadata is missing fields that should always be
  present (e.g. `companyId` is null) — indicates a service bug.
- The Stripe charge's `customer` doesn't match our tenant's connected
  account — possible cross-tenant routing bug.

File a ticket with: the `providerEventId`, the `providerPaymentId`,
the structured stdout log line, and the affected `companyId`.

---

## What NOT to do

- ❌ **Do not insert a `payments` row directly via psql.** Use the
  manual Collect Payment flow so balances + statuses recompute through
  the canonical writer.
- ❌ **Do not "fix" the mismatch by editing the metadata in Stripe
  Dashboard and replaying the webhook.** Stripe metadata is immutable
  for completed PaymentIntents; even if it weren't, a replay would
  collide on `payments_provider_event_id_uq` and roll back.
- ❌ **Do not refund partially expecting our ledger to follow.** The
  webhook will not write a payment row for the refund either — there
  was never a parent payment row to attach the refund to.
- ❌ **Do not delete or modify the `payment_webhook_events` row.** It's
  the only durable record of what we saw.
- ❌ **Do not ignore the dashboard banner.** Each row represents real
  money that needs a decision.

---

## Detection thresholds + rates

The Payments dashboard banner uses
`getTenantWebhookAnomalySummary({ companyId, windowDays: 7 })` and
counts every `outcome IN ('config_error', 'transient_failure')` row.
A non-zero count surfaces the banner.

Healthy state: zero `manual_allocations_*` rows in any 7-day window.

If a tenant accumulates more than 3 in a week, treat that as a signal
to investigate the concurrency / retry pattern, not just to reconcile
each row individually.

---

## Implementation references

- Webhook handler:
  `server/services/payments/paymentApplicationService.ts::handleManualAllocationsPaymentSucceeded`
- Logging surface:
  `server/storage/paymentWebhookEvents.ts::safeRecordPaymentWebhookEvent`
- Metadata allowlist (drives what's persistent on the log row):
  `server/storage/paymentWebhookEvents.ts::METADATA_ALLOWLIST`
- Dashboard summary read:
  `server/storage/paymentWebhookEvents.ts::getTenantWebhookAnomalySummary`
- Service that mints the PaymentIntent + packs metadata:
  `server/services/payments/paymentApplicationService.ts::createCardIntentWithAllocations`
- Tests pinning the mismatch behavior:
  `tests/collect-payment-card.test.ts`
  `tests/collect-payment-orphan-recovery.test.ts`
