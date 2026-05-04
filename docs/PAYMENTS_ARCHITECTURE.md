# Payments Architecture

**Status:** Production-ready (PR1–PR8 shipped 2026-05-03 → 2026-05-04).
**Owner:** Platform / Payments.
**Provider today:** Stripe Connect (Express). Provider-neutral by design.

---

## 1. System overview

Syntraro is a multi-tenant SaaS where each HVAC business is a separate company. Tenants accept online card payments from their own customers and receive bank payouts directly. Syntraro never holds tenant funds — every charge runs **on the tenant's connected provider account** (Stripe Direct Charges), and the provider settles to the tenant's bank.

### Provider-neutral design

Stripe is the only adapter shipped today, but every layer above the adapter is provider-blind:

- **`shared/schema.ts`** uses generic columns (`provider_source`, `provider_account_id`, `provider_payout_id`, `provider_dispute_id`) — never `stripe_*`.
- **`server/services/payments/providers/types.ts`** defines a `PaymentProvider` interface; the application service depends on the interface.
- **`server/services/payments/providers/stripeAdapter.ts`** is the **only** file outside `stripeClient.ts` that imports the Stripe SDK.
- The webhook entrypoint `POST /api/webhooks/:provider` dispatches by URL segment via `resolveById`. A second adapter (e.g. Adyen, Square) is a new file + one resolver branch.

### Tenant-owned funds

PR4 made the platform-only path structurally impossible: every SDK call site in the adapter requires `providerAccountId` and refuses to call Stripe without it (`assertConnectAccount` guard). Funds flow tenant → tenant's bank, never through the platform. Refunds run on the same connected account that originated the charge.

---

## 2. Lifecycle flows

### 2.1 Onboarding (PR2 / PR3)

```
Tenant clicks "Set up payments" (Settings → Payments, PR3 UI)
  ↓
POST /api/payments/account/onboard
  ↓
paymentProviderAccountService.getOrCreateAccount()
  - Row-locked SELECT FOR UPDATE on payment_provider_accounts
  - If missing: stripe.accounts.create({ type: "express", capabilities, country })
  - Persist providerAccountId + initial state
  ↓
paymentProviderAccountService.createOnboardingLink()
  - stripe.accountLinks.create({ account, refresh_url, return_url })
  ↓
Frontend redirects browser to link.url (Stripe-hosted wizard)
  ↓
Tenant completes KYC + bank verification at Stripe
  ↓
Stripe redirects back to /settings/payments?from=stripe
  ↓
PaymentsSettingsPage detects flag → calls POST /account/refresh ONCE
  - paymentProviderAccountService.retrieveAndSyncAccount()
  - stripe.accounts.retrieve(...) → maps to ProviderAccountState
  - normalizeAccountStatus() → { not_started | pending | active | restricted | disabled }
  - Strips ?from=stripe from URL
```

Stripe also fires `account.updated` webhooks throughout the flow; the same normaliser applies via `paymentProviderAccountService.applyAccountUpdate()`. Operator + webhook converge on the same persisted state.

### 2.2 Checkout (PR4)

Single-invoice (`createCheckout`), multi-invoice (`createMultiCheckout`), off-session saved-card (`payWithSavedMethod`), and SetupIntent (`createPortalSetupIntent`) all follow the same shape:

```
1. paymentProviderAccountService.getActiveAccount(companyId)
   - Throws PAYMENTS_NOT_ENABLED (HTTP 409 + stable code) if null or
     chargesEnabled = false.
2. Mint prospectivePaymentId = randomUUID().
   - Doubles as Stripe idempotencyKey AND payments.id at webhook time.
3. Resolver provides the adapter; service calls:
     stripe.paymentIntents.create({...}, {
       idempotencyKey: prospectivePaymentId,
       stripeAccount: providerAccountId,   // ← Direct Charges
     })
4. Metadata round-trips:
     - companyId, invoiceId / invoiceIds (JSON), prospectivePaymentId
     - paymentProviderAccountId (so the webhook persists attribution
       without a second resolver lookup)
5. Frontend confirms with Stripe Elements.
```

### 2.3 Webhook lifecycle

`POST /api/webhooks/:provider` is mounted **before** `express.json()` because signature verification is computed over raw bytes. The route is thin — it delegates to:

```
paymentApplicationService.verifyInboundWebhook
  → adapter.verifyWebhook(rawBody, headers)
    → stripe.webhooks.constructEvent(...)
    → normalised events with discriminating `kind`

paymentApplicationService.applyVerifiedWebhookBatch
  → switch on event.kind → handler
```

Per-event handlers classify errors into three buckets and the route maps each to the correct HTTP status:

| Class | Mapping | Stripe behaviour |
|---|---|---|
| Signature / config secret | 400 | Stripe retries until operator fixes config |
| Transient (DB blip, pool exhausted) | 500 | Stripe retries with exponential backoff (~72h) |
| Replay / final config drift | 200 | Stripe stops retrying |

Pre-PR-C1 (2026-04-21) ALL application failures silently 200-ACK'd. Patch C1 split the three classes; **never silently 200 a transient.**

The diagnostic sidecar `payment_webhook_events` records every delivery with `outcome ∈ { accepted, replayed, ignored, config_error, transient_failure, signature_failed }`. Writes are best-effort — log failure must never block the canonical decision.

### 2.4 Payout lifecycle (PR5)

Stripe emits five `payout.*` events on the connected account; the adapter normalises all five into one shared envelope. The handler `handlePayoutEvent`:

```
1. Resolve local payment_provider_accounts row by
   (provider, providerAccountId).
2. Missing → 200 ACK + payment_payout_account_not_found ops anomaly +
   skip. Never auto-create accounts from payout webhooks.
3. Upsert payment_payouts via ON CONFLICT (provider, provider_payout_id)
   DO UPDATE — idempotent on replay; status updates are NOT monotonic
   (provider truth wins).
```

Syntraro never initiates payouts. Stripe's hosted dashboard is canonical for scheduling / cancellation.

### 2.5 Dispute lifecycle (PR6)

Stripe's `charge.dispute.{created,updated,closed}` events fire on the connected account. `handleDisputeEvent` resolves the local account, then **attempts** a payment match by `payments.reference === providerPaymentId` (Stripe `ch_...`) — tenant-scoped: a payment whose `companyId !== account.companyId` is rejected as a cross-tenant match (logged + null FKs).

**Disputes are NEVER dropped because the local payment match is missing.** Out-of-order events land with null `payment_id` / `invoice_id` and a `payment_dispute_payment_not_found` log; a follow-up `dispute.updated` re-attempts the link via the same logic.

Evidence submission is **not implemented** — operators use Stripe's hosted dashboard.

---

## 3. Data model

### 3.1 Core ledger

| Table | Owner | Purpose |
|---|---|---|
| `payments` | tenant | Canonical money ledger. `provider_source ∈ {manual, qbo, stripe}`. `payment_type ∈ {payment, refund, reversal}`. Connected-account attribution via `payment_provider_account_id` (FK) + `provider_account_id` (text mirror). |
| `payment_allocations` | tenant | Multi-invoice payment junction. One payment row → N allocation rows. Modern multi-invoice payments leave `payments.invoice_id = NULL`. |
| `payment_methods` | tenant + customer | Saved-card metadata (last4, brand, exp, consent). Raw PAN never stored. |

### 3.2 Connected-account lifecycle

| Table | Owner | Purpose |
|---|---|---|
| `payment_provider_accounts` | tenant | One row per (tenant, provider). Holds `provider_account_id`, `status` (5-state enum), `charges_enabled`, `payouts_enabled`, `details_submitted`, `requirements_due` (jsonb), `disabled_reason`, `country`, `default_currency`. |
| `payment_payouts` | tenant | Mirrored payout lifecycle. `status ∈ {pending, in_transit, paid, failed, canceled}`. `destination_last4` only when Stripe expands the destination object. |
| `payment_disputes` | tenant | Dispute / chargeback lifecycle. `status` is the 8-state enum. `payment_id` / `invoice_id` are nullable for out-of-order events. |
| `payment_webhook_events` | tenant (or null) | Diagnostic sidecar — never the source of truth. Used for ops anomaly counts (PR8 `getTenantWebhookAnomalySummary`). |

### 3.3 Idempotency anchors

Every webhook flow has a partial unique index that catches replays at the DB:

| Index | Used by |
|---|---|
| `payments_provider_event_id_uq(company_id, provider_source, provider_event_id) WHERE provider_event_id IS NOT NULL` | `payment_intent.succeeded`, `charge.refunded`, etc. |
| `payment_methods_provider_pm_uq(company_id, provider_source, provider_payment_method_id)` | `payment_method.attached` |
| `payment_provider_accounts_company_provider_uq(company_id, provider)` | Onboarding double-mint guard |
| `payment_payouts_provider_payout_id_uq(provider, provider_payout_id) WHERE provider_payout_id IS NOT NULL` | `payout.*` |
| `payment_disputes_provider_dispute_id_uq(provider, provider_dispute_id) WHERE provider_dispute_id IS NOT NULL` | `charge.dispute.*` |

Drizzle's `targetWhere` matches the partial-index predicate exactly so `ON CONFLICT … DO UPDATE` semantics work.

---

## 4. Key guarantees

### 4.1 Idempotency

- **Checkout retry safety:** `prospectivePaymentId === Stripe idempotencyKey === payments.id`. Same UUID across the entire chain — Stripe returns the same PaymentIntent on retry; webhook records exactly once.
- **Refund retry safety (H2):** Provider key derived deterministically from `(companyId, parentPaymentId, amountCents, reason)` via SHA-256. Two retries with identical inputs produce ONE Stripe refund; ledger insert is idempotent via `payments_provider_event_id_uq`.
- **Webhook replay:** Every replay collides on its partial unique index → SQLSTATE 23505 → handler classifies as `final_replay` → 200 ACK.

### 4.2 Tenant isolation

- Every webhook resolves tenant from the **local** `payment_provider_accounts` row keyed on `(provider, providerAccountId)`. Never trusts metadata for tenant identity.
- Cross-tenant payment match guard: `matchedPayment.companyId === account.companyId` in `handleDisputeEvent`. Cross-tenant matches → null FKs (logged), never linked.
- Every read API uses `req.companyId!` from the authenticated session. No client-supplied filter can override it.
- Repository methods enforce `eq(companyId)` on every read.

### 4.3 Attribution rules

- **`payments.provider_source = 'stripe'`** → `payment_provider_account_id` MUST be set (PR4 enforced).
- **Refund / reversal rows** inherit attribution from parent automatically via `createLedgerAdjustment`. Refund of a Stripe-source payment ALWAYS routes to the same connected account that took the original charge.
- **Manual / QBO rows** leave attribution columns NULL by design.

### 4.4 ACK correctness (Patch C1)

| Failure shape | Class | HTTP |
|---|---|---|
| 23505 on idempotency index | `final_replay` | 200 |
| 4xx from canonical repo (e.g. 404 invoice-not-found from metadata mismatch) | `final_config` | 200 + ops alert |
| Anything else (DB pool exhausted, timeout, unknown bug) | `transient` | 500 → Stripe retries |

---

## 5. RBAC

| Surface | Server gate | Client gate |
|---|---|---|
| Onboarding (`/api/payments/account/*`) | `ADMIN_ROLES` | `requireAdmin` |
| Read APIs (transactions / payouts / disputes / anomaly summary) | `RESTRICTED_MANAGER_ROLES` | `requireRestrictedManager` (PR8 alignment) |
| Webhooks | Provider signature only | n/a |

Pre-PR8 the dashboard route used `requireManager` (allowed dispatcher) while the API gate excluded dispatcher → 403s in the UI. PR8 added `requireRestrictedManager` to `ProtectedRoute` and updated the sidebar to hide the entry from dispatchers. Server gates are unchanged — alignment was made by tightening the client.

---

## 6. Domain errors (stable codes)

Routes return HTTP 409 + `{ code }` for these; the frontend keys off `code`:

| Code | Cause |
|---|---|
| `PAYMENTS_NOT_ENABLED` | No active provider account on a checkout / setup-intent / off-session call |
| `PAYMENT_ACCOUNT_NOT_FOUND` | Refund attempted on a Stripe-source payment with no `provider_account_id` (legacy or orphan row) |
| `PROVIDER_ACCOUNT_MISMATCH` | Webhook's `event.account` doesn't match metadata-derived tenant. Treated as final config error inside webhook (200 ACK + ops alert); also exposed for service-internal callers. |

---

## 7. Known limitations (production-ready, not feature-complete)

- **No dispute evidence submission.** Operators submit through Stripe's hosted dashboard. Wiring `disputes.update({ evidence })` + secure file storage is deferred.
- **No payout initiation.** Stripe's hosted dashboard is canonical for scheduling / cancellation.
- **Anomaly handling is partial.** Counts are surfaced in the dashboard (`getTenantWebhookAnomalySummary`); a row-level ops drilldown would surface potentially sensitive payload data and is deferred to a platform-side console.
- **No "switch connected account" flow.** Stripe Express has no clean primitive for tenant deletion. If a tenant ever re-onboards under a new connected account, `customer_companies.provider_customer_id` and saved-card rows under the old account become invalid.
- **No backfill job for orphan disputes.** Disputes that landed with null `payment_id` (out-of-order webhook) are NOT actively reconciled. They backfill on follow-up `dispute.updated` events, but a long-quiet dispute could stay orphaned. Maintenance job deferred.
- **Multi-invoice dispute linking is 1:1.** Disputes that match a multi-invoice `payments` row (which has `invoice_id = NULL` and uses `payment_allocations`) leave `invoice_id` on the dispute row null. Future enhancement could surface the allocation set.
- **Stripe `prevented` dispute status folds to `under_review`.** PR1 enum predates Stripe's addition; raw value preserved on `raw_provider_status`.
- **Manual sandbox verification deferred.** No real Stripe Connect connected accounts have been onboarded in the dev environment yet (PR2's onboarding requires a live Stripe Connect application). Coverage is via integration + mock dispatch tests.

---

## 8. Future extensions

### 8.1 Multi-provider support
Architecture is ready: schema columns are provider-neutral, resolver dispatches by `companies.payment_provider`, adapter contract is the `PaymentProvider` interface. Adding e.g. Adyen requires:
1. New `paymentProviderEnum` value.
2. New `*Adapter.ts` file implementing the interface.
3. New branch in `resolveById`.
4. Parallel env-var convention for adapter credentials.

### 8.2 Dispute evidence submission
Add `disputes.update({ evidence })` adapter method + a secure-file-upload pipeline + dashboard UI. Out of scope for the current PR series.

### 8.3 Payout reconciliation tools
A `payout_payment_matches` table linking payments to the payout that settled them (Stripe's `BalanceTransaction` API exposes this). Would unlock per-payout statement views.

### 8.4 Connect dashboard deep-link
Stripe Express has `accounts.create_login_link` — a magic-link primitive that bounces the operator into Stripe's hosted dashboard. PR8's "Manage at provider →" action stub points to settings; a future PR can wire the deep-link.

### 8.5 Anomaly drilldown
A platform-side console with row-level access to `payment_webhook_events`. Tenant dashboard surfaces COUNTS only — drilldown surfaces payloads which can carry PII.

---

## 9. PR history

| PR | Date | Scope |
|---|---|---|
| PR1 | 2026-05-03 | Schema foundation: `payment_provider_accounts`, `payment_payouts`, `payment_disputes`, `companies.payment_provider`, attribution columns on `payments`. |
| PR2 | 2026-05-03 | `paymentProviderAccountService` + Stripe Connect onboarding adapter methods. `account.updated` webhook. |
| PR3 | 2026-05-03 | Settings → Payments onboarding UI. |
| PR4 | 2026-05-04 | **Behaviour-changing.** Connect-aware checkout, attribution on every payment row, refund routing through originating connected account. Domain errors. |
| PR5 | 2026-05-04 | Payout webhooks (`payout.*`) + read APIs. |
| PR6 | 2026-05-04 | Dispute webhooks (`charge.dispute.*`) + read APIs + payment/invoice link. |
| PR7 | 2026-05-04 | Payments dashboard UI (overview / transactions / payouts / disputes). |
| PR8 | 2026-05-04 | Polish: RBAC alignment, deep-linkable tabs, filter UI, anomaly banner, doc cleanup. |
