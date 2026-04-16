# Payments — Stripe Integration Contract

**Status:** design contract for the future Stripe writer. No Stripe SDK
code exists yet. This document binds Phase 3's schema-level decisions
to the shape the Stripe code must take when it lands.

Scope covered here: how the existing `payments` table represents Stripe
charges and refunds, the outbound idempotency rule, the inbound webhook
dedupe rule, and the immutability rule. Anything not covered here is
explicitly out of scope for the first Stripe phase.

---

## 1. Column-level contract

All columns on `payments` that relate to provider ownership are
**system-managed**. The canonical `insertPaymentSchema` omits them
(`shared/schema.ts`), so no route can accept them from a user payload.

| Column | Manual row | QBO-synced row | Stripe-synced row |
|---|---|---|---|
| `providerSource` | `'manual'` (default) | `'qbo'` (backfilled) | `'stripe'` (set by Stripe writer) |
| `providerEventId` | `NULL` | `NULL` | Stripe event id (`evt_...`) — set once on first webhook insert |
| `reference` | free-text (cheque number, etc.) | free-text | Stripe object id (`ch_...` for payment row, `re_...` for refund row) |
| `qboPaymentId` | `NULL` | QBO `Payment.Id` / `RefundReceipt.Id` | `NULL` |
| `qboSyncStatus` | `NOT_SYNCED` | `SYNCED` / `PENDING` / `ERROR` | `NOT_SYNCED` until QBO pass-through ships |
| `amount` | free | set by QBO | set by Stripe event payload |
| `method` | free enum | free enum | `'card'` for payment, `'card_refund'` for refund |
| `paymentType` | `'payment'` (default) | `'payment'` | `'payment'` for charge, `'refund'` for refund |
| `parentPaymentId` | null for payments; non-null for refunds/reversals | same | null for charges; non-null for refunds pointing at the charge row |

`providerSource` and `providerEventId` are both checked by the canonical
predicate `isProviderLinked(row)` in `server/lib/paymentPredicates.ts`.
Provider-linked rows block local edits to financial fields via the
`updatePayment` guard.

---

## 2. Outbound idempotency

Every outbound Stripe call (create charge, create refund, create
payment intent) **MUST** pass the owning ledger row's `id` as the
`Idempotency-Key` HTTP header.

```
Idempotency-Key: <payments.id>
```

Rationale:
- `payments.id` is a UUID — globally unique.
- Retries with the same id are treated by Stripe as a single request —
  zero chance of duplicate charge/refund creation at the provider.
- Mirrors the Phase A email pattern exactly (`delivery.id` →
  Resend idempotency key). One contract, one mental model across the
  codebase.

**Do not** use a synthesized key (hash of body, timestamp, etc.).
The row id is the canonical source. If the row doesn't exist yet —
e.g., retrying a failed write — **create the row first** in a local
tx, then issue the Stripe call with that row's id. The tx can mark
the row with a transient `providerSource='stripe'` and `qboSyncStatus`
style error field later if desired; Phase 3 does not prescribe this.

---

## 3. Inbound webhook dedupe

Every Stripe webhook handler **MUST** insert the row with
`providerEventId = <Stripe event id>` (the top-level `evt_...` on the
webhook payload, not the nested object id).

DB-level guard: the partial UNIQUE
`payments_provider_event_id_uq` on
`(company_id, provider_source, provider_event_id)
 WHERE provider_event_id IS NOT NULL`
blocks any duplicate insert. Webhook handler converts the UNIQUE
violation to a `200 OK` (already-processed) response so Stripe stops
retrying.

Webhook events that don't correspond to a new ledger row (for example,
`charge.updated` with no financial consequence) are acknowledged without
an insert and do not participate in this dedupe path.

---

## 4. Immutability contract

Once `providerSource` is `'qbo'` or `'stripe'`, **or** `qboPaymentId`
is non-null, the row is provider-linked. The `updatePayment` guard
rejects any patch that attempts to change `amount`, `method`, or
`receivedAt`. `reference` and `notes` remain editable — they're
metadata, not financial identity.

Refund / reversal is the only way to undo a provider-linked payment.
The Phase 2 writers (`createRefund`, `createReversal`) already enforce:
- parent must be `paymentType='payment'`
- cumulative offset ≤ parent amount (`assertRefundAmountWithinParent`)
- reference dedupe scoped per-parent (partial UNIQUE
  `payments_company_parent_reference_uq`)

None of those writers fire a QBO sync today. When Stripe lands, the
Stripe refund writer calls `createRefund` with `providerSource='stripe'`
and `reference=re_...`, then issues the outbound Stripe API call using
the new refund row's id as the idempotency key. The existing refund
invariants handle everything else.

---

## 5. What the Stripe phase must NOT do

- Introduce a second refund/reversal table or a second write path.
- Mutate an already-inserted `providerEventId` or `reference` on a
  provider-linked row.
- Skip the `isProviderLinked` check.
- Build a webhook handler that returns non-2xx on replay — Stripe
  will retry forever.
- Add new columns to `payments` — the Phase 3 columns are sufficient.
- Introduce a new "Stripe payment service" parallel to
  `paymentRepository`. The single canonical writer stays.

---

## 6. What's still open for the Stripe phase

- The actual Stripe SDK wiring and webhook route (intentionally deferred).
- Provisioning of `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` env vars.
- Whether a Stripe charge can target an invoice directly (customer-
  portal-driven checkout) or only a manual-entry-triggered charge.
- Outbound retry/backoff policy for transient Stripe 5xx.

None of those require any schema change. Phase 3 has made the ledger
Stripe-shaped; the remaining work is purely the SDK layer.
