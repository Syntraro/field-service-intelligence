/**
 * Payment application service — provider-neutral orchestration layer.
 *
 * Responsibilities that belong here:
 *   - invoice-payment business rules (payable? amount ≤ balance?)
 *   - provider resolution (via the resolver — not inline env sniffing)
 *   - idempotency-key generation and routing through the provider + ledger
 *   - canonical ledger writes via `paymentRepository`
 *   - normalized webhook event → ledger-write application
 *
 * Responsibilities that do NOT belong here:
 *   - provider SDK calls (live only in the adapter)
 *   - invoice balance arithmetic (lives in `paymentRepository` /
 *     `recalculateInvoiceBalance`)
 *   - route auth, HTTP status translation
 *
 * Routes are expected to be thin: auth + validation + call this service +
 * render a response. The service does not know about Express.
 */

import { createHash, randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { payments as paymentsTable } from "@shared/schema";
import { invoiceRepository } from "../../storage/invoices";
import { paymentRepository } from "../../storage/payments";
import { canAcceptInvoicePayment } from "../../lib/invoicePredicates";
import { createError } from "../../middleware/errorHandler";
import { emailDispatchService } from "../emailDispatchService";
import {
  resolveForCompany,
  resolveById,
  resolveForProviderSource,
} from "./providers/resolver";
import type {
  CreateCheckoutResult,
  NormalizedWebhookEvent,
  PaymentProvider,
} from "./providers/types";

// ============================================================================
// Shared helpers
// ============================================================================

function dollarsStringToCents(dollars: string): number {
  const n = parseFloat(dollars);
  if (!Number.isFinite(n) || n <= 0) {
    throw createError(400, "Amount must be a positive number");
  }
  return Math.round(n * 100);
}

function centsToDollarsString(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Unique-violation surfacing from Postgres — used for webhook replay dedupe. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | undefined;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/**
 * 2026-04-21 Patch C1 — webhook error classifier.
 *
 * Three categories feed the webhook ACK decision:
 *
 *   - **final / replay**  — unique violation on the ledger idempotency
 *                            index. The row already exists; ACK 200.
 *   - **final / config**  — 4xx from the canonical repository (e.g.
 *                            404 invoice-not-found from tenant metadata
 *                            mismatch). Retrying won't help — ACK 200,
 *                            anomaly log the drift.
 *   - **transient**       — Everything else: DB connection errors,
 *                            timeouts, pool exhaustion, unknown bugs.
 *                            Retry CAN succeed. Propagate so the route
 *                            returns 500 and Stripe's own retry window
 *                            (exponential backoff, ~72h) rides out the
 *                            outage.
 *
 * Never treat an unknown error as final. The cost of an unnecessary
 * Stripe retry is near-zero; the cost of a silently-lost payment row
 * is the captured money vanishing from our ledger forever.
 */
type WebhookErrorClass = "final_replay" | "final_config" | "transient";

function classifyWebhookError(err: unknown): WebhookErrorClass {
  if (isUniqueViolation(err)) return "final_replay";
  const e = err as
    | { status?: number; statusCode?: number }
    | undefined;
  const status = e?.status ?? e?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return "final_config";
  }
  return "transient";
}

/** Structured log lines — grep for `[payments-webhook]` in operator logs. */
function logInfo(kind: string, ctx: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.info(`[payments-webhook] ${kind}`, JSON.stringify({ kind, ...ctx }));
}
function logAnomaly(kind: string, ctx: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.error(`[payments-webhook] ${kind}`, JSON.stringify({ kind, ...ctx }));
}

/**
 * 2026-04-21 refund hardening logs. Separate tag so operators can alert
 * on refund-specific anomalies without grepping the webhook channel.
 */
function logRefundInfo(kind: string, ctx: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.info(`[payments-refund] ${kind}`, JSON.stringify({ kind, ...ctx }));
}
function logRefundCritical(kind: string, ctx: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.error(
    `[payments-refund] CRITICAL ${kind}`,
    JSON.stringify({ kind, severity: "critical", ...ctx }),
  );
}

// ============================================================================
// createCheckout
// ============================================================================

export interface CreateCheckoutParams {
  companyId: string;
  invoiceId: string;
  source: "staff" | "portal";
  /**
   * Dollars string. When omitted, the invoice's outstanding balance is
   * used (portal self-pay always pays the full balance; staff today
   * supplies an explicit amount ≤ balance).
   */
  amount?: string;
  currency?: string;
}

export interface CreateCheckoutResponse extends CreateCheckoutResult {
  /** Pre-generated UUID that will become `payments.id` on webhook success. */
  prospectivePaymentId: string;
}

/**
 * Issue a provider-neutral checkout token for an invoice.
 *
 * Idempotency chain (identical to the pre-neutralization Stripe path):
 *
 *   prospectivePaymentId  === provider idempotency key
 *                        === `payments.id` written by the webhook
 *                        === stable key across retries
 */
async function createCheckout(
  params: CreateCheckoutParams,
): Promise<CreateCheckoutResponse> {
  const { companyId, invoiceId, source } = params;
  const currency = params.currency ?? "usd";

  // 1. Canonical invoice-payable check.
  const invoice = await invoiceRepository.getInvoice(companyId, invoiceId);
  if (!invoice) throw createError(404, "Invoice not found");
  if (!canAcceptInvoicePayment(invoice.status)) {
    throw createError(
      400,
      `Cannot take payment on invoice with status "${invoice.status}".`,
    );
  }

  // 2. Resolve the requested amount. Staff-supplied amount is honored
  //    with an overshoot guard; portal always pays the full balance.
  const balanceCents = Math.round(parseFloat(invoice.balance ?? "0") * 100);
  if (!Number.isFinite(balanceCents) || balanceCents <= 0) {
    throw createError(400, "Invoice has no outstanding balance");
  }

  let amountCents: number;
  if (params.amount) {
    amountCents = dollarsStringToCents(params.amount);
    if (amountCents > balanceCents) {
      throw createError(
        400,
        `Requested amount exceeds outstanding invoice balance (${centsToDollarsString(balanceCents)}).`,
      );
    }
  } else {
    amountCents = balanceCents;
  }

  // 3. Single source of truth for the idempotency key chain.
  const prospectivePaymentId = randomUUID();

  // 4. Resolve provider and call. The adapter is the ONLY place that
  //    speaks the provider SDK.
  const provider: PaymentProvider = resolveForCompany(companyId);
  const result = await provider.createCheckout({
    companyId,
    invoiceId,
    amountCents,
    currency,
    source,
    idempotencyKey: prospectivePaymentId,
    // Tenant + invoice + id are round-tripped via provider metadata so
    // the webhook can trust the association without client input.
    metadata: {
      companyId,
      invoiceId,
      prospectivePaymentId,
      invoiceNumber: String(invoice.invoiceNumber ?? ""),
      source,
    },
  });

  return { ...result, prospectivePaymentId };
}

// ============================================================================
// refundPayment
// ============================================================================

export interface RefundPaymentParams {
  companyId: string;
  parentPaymentId: string;
  /** Positive dollars string. The ledger negates. */
  amount: string;
  method?: string;
  reference?: string | null;
  notes?: string | null;
  reason?: string | null;
}

/**
 * Discriminated result so the route can distinguish "fully settled"
 * from "provider succeeded but ledger write pending reconciliation".
 * The 202 path is taken only when Stripe has definitely moved money
 * but our ledger write failed for a reason other than unique-violation
 * (which is handled transparently by lookup-and-return).
 */
export type RefundPaymentResult =
  | { kind: "settled"; row: Awaited<ReturnType<typeof paymentRepository.createRefund>> }
  | {
      kind: "reconciliation_pending";
      refundLedgerId: string;
      providerRefundId: string;
      providerSource: "stripe";
    };

/**
 * Derive a DETERMINISTIC Stripe idempotency key from the refund request
 * shape. The same (companyId, parentPaymentId, amountCents, reason)
 * tuple produces the same key — so any retry with identical arguments
 * collapses to a single Stripe refund object (Stripe returns the same
 * `re_...` on every retried call carrying the same idempotency key).
 *
 * This is the core defense against the "provider succeeded but our
 * ledger insert failed → user retries → Stripe issues second refund"
 * scenario (H2). Even if the user clicks refund three times, Stripe
 * issues exactly one refund; our ledger insert is idempotent via the
 * `payments_provider_event_id_uq` partial unique on the returned
 * `providerRefundId`.
 *
 * We DO NOT use the ledger PK (random UUID) as the provider key —
 * that would be unique per attempt and defeat the dedupe. The ledger
 * PK remains random; the provider key is deterministic.
 */
function stripeRefundIdempotencyKey(
  companyId: string,
  parentPaymentId: string,
  amountCents: number,
  reason: string | null,
): string {
  const h = createHash("sha256");
  h.update(companyId);
  h.update("|");
  h.update(parentPaymentId);
  h.update("|");
  h.update(String(amountCents));
  h.update("|");
  h.update(reason ?? "");
  // Stripe idempotency keys accept up to 255 chars; our prefix makes
  // them grep-able in the Stripe dashboard.
  return `syntraro_refund_${h.digest("hex").slice(0, 40)}`;
}

/**
 * Issue a refund. Behavior branches on the parent payment's
 * `providerSource`:
 *
 *   - `'manual'` → ledger-only. Unchanged.
 *   - `'stripe'` → (1) cap check pre-provider, (2) Stripe call with
 *                  deterministic idempotency key, (3) ledger insert.
 *                  Failure of step 3 returns a reconciliation_pending
 *                  result — the provider has the refund, the webhook
 *                  will backfill the ledger row, and a retry from the
 *                  user cannot produce a second provider refund.
 *   - anything else → 409 (e.g. QBO-linked rows go through QBO sync).
 *
 * Retry safety (H2):
 *   Same (companyId, parentPaymentId, amount, reason) → same Stripe
 *   idempotency key → Stripe returns the same refund object → our
 *   ledger insert collides on `payments_provider_event_id_uq` →
 *   service returns the existing row. No second provider refund.
 *
 * Cap ordering (H1):
 *   `paymentRepository.assertRefundAmountWithinParent` runs BEFORE
 *   the provider call. Overshoot rejects at 400 without a Stripe hit.
 */
async function refundPayment(
  params: RefundPaymentParams,
): Promise<RefundPaymentResult> {
  const { companyId, parentPaymentId } = params;

  // 1. Load parent row to determine provider branch.
  const [parent] = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.id, parentPaymentId))
    .limit(1);

  if (!parent) throw createError(404, "Parent payment not found");
  if (parent.companyId !== companyId) {
    // Behave like not-found for cross-tenant attempts.
    throw createError(404, "Parent payment not found");
  }

  const route = resolveForProviderSource(parent.providerSource);
  if ("unsupported" in route) {
    throw createError(
      409,
      `Refunds for provider "${route.providerSource}" are not supported through this endpoint.`,
    );
  }

  const amountCents = dollarsStringToCents(params.amount);
  const amountAbs = amountCents / 100;

  // Provider-linked branch.
  if ("provider" in route) {
    if (!parent.reference) {
      throw createError(
        500,
        "Provider-linked payment is missing its provider reference; refund cannot be issued.",
      );
    }

    // ------------------------------------------------------------------
    // H1: Cap check BEFORE any provider call. Overshoot → 400, no Stripe
    // hit. The same canonical check runs inside paymentRepository's
    // ledger-write path; surfacing it here gives a clean error without
    // leaving a real refund at Stripe for a request we can't record.
    // ------------------------------------------------------------------
    await paymentRepository.assertRefundAmountWithinParent(
      companyId,
      parentPaymentId,
      amountAbs,
    );

    // Deterministic provider idempotency key — same inputs, same key,
    // same Stripe refund on every retry (H2 core defense).
    const providerIdempotencyKey = stripeRefundIdempotencyKey(
      companyId,
      parentPaymentId,
      amountCents,
      params.reason ?? null,
    );
    // Ledger row PK is independent (random) so operators can still
    // distinguish retries in local logs. Only ONE row will land; the
    // others collide on providerEventId dedupe.
    const refundLedgerId = randomUUID();

    logRefundInfo("provider_call_start", {
      companyId,
      parentPaymentId,
      providerSource: "stripe",
      amountCents,
      idempotencyKey: providerIdempotencyKey,
    });

    const providerResult = await route.provider.refundPayment({
      providerPaymentId: parent.reference,
      amountCents,
      reason: params.reason ?? null,
      idempotencyKey: providerIdempotencyKey,
    });

    if (providerResult.status === "failed") {
      logRefundInfo("provider_refund_failed", {
        companyId,
        parentPaymentId,
        providerRefundId: providerResult.providerRefundId,
      });
      throw createError(
        502,
        `Provider refund failed (status=${providerResult.status}).`,
      );
    }

    logRefundInfo("provider_refund_succeeded", {
      companyId,
      parentPaymentId,
      providerRefundId: providerResult.providerRefundId,
      providerStatus: providerResult.status,
    });

    // Attempt the canonical ledger write.
    try {
      const row = await paymentRepository.createRefund(
        companyId,
        parentPaymentId,
        {
          amount: params.amount,
          method: params.method ?? undefined,
          reference: providerResult.providerRefundId,
          notes: params.notes ?? null,
          id: refundLedgerId,
          providerSource: "stripe",
          providerEventId: providerResult.providerRefundId,
        },
      );
      logRefundInfo("ledger_write_succeeded", {
        companyId,
        parentPaymentId,
        refundLedgerId,
        providerRefundId: providerResult.providerRefundId,
      });
      return { kind: "settled", row };
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Either the webhook beat us, or a prior retry of this exact
        // request already wrote the row. Same `providerRefundId` →
        // same row. Return it — the client sees a normal success.
        const existing = await paymentRepository.findByProviderReference(
          "stripe",
          providerResult.providerRefundId,
        );
        if (existing) {
          logRefundInfo("ledger_write_replayed", {
            companyId,
            parentPaymentId,
            refundLedgerId: existing.id,
            providerRefundId: providerResult.providerRefundId,
          });
          return { kind: "settled", row: existing };
        }
      }

      // ----------------------------------------------------------------
      // H2: Stripe has definitely moved money but our ledger write
      // failed for a reason other than unique-violation. Escalate and
      // return a reconciliation_pending result. The `charge.refunded`
      // webhook will arrive within seconds and write the row via the
      // same canonical path; any user retry with identical arguments
      // hits the same providerIdempotencyKey, gets back the same
      // `providerRefundId`, and either finds the webhook-written row
      // (unique-violation branch above) OR sees the same 202 again —
      // never a second Stripe refund.
      // ----------------------------------------------------------------
      logRefundCritical("ledger_write_failed_after_provider_success", {
        companyId,
        parentPaymentId,
        refundLedgerId,
        providerRefundId: providerResult.providerRefundId,
        error: err instanceof Error ? err.message : String(err),
      });

      return {
        kind: "reconciliation_pending",
        refundLedgerId,
        providerRefundId: providerResult.providerRefundId,
        providerSource: "stripe",
      };
    }
  }

  // Manual branch — ledger-only (unchanged). Cap check runs inside
  // paymentRepository.createRefund → createLedgerAdjustment, which is
  // sufficient since there's no provider side-effect to guard.
  const row = await paymentRepository.createRefund(
    companyId,
    parentPaymentId,
    {
      amount: params.amount,
      method: params.method ?? undefined,
      reference: params.reference ?? null,
      notes: params.notes ?? null,
    },
  );
  return { kind: "settled", row };
}

// ============================================================================
// Webhook application
// ============================================================================

export interface ApplyWebhookResult {
  accepted: NormalizedWebhookEvent[];
  ignored: NormalizedWebhookEvent[];
  replayed: NormalizedWebhookEvent[];
  failed: Array<{ event: NormalizedWebhookEvent; error: string }>;
}

/**
 * 2026-04-21 Patch C1: tagged error thrown by `applyVerifiedWebhookBatch`
 * when one or more handlers surfaced a transient failure. The route
 * maps this to HTTP 500 so Stripe retries.
 *
 * `name` is set so downstream `err.name === "WebhookTransientFailure"`
 * works without instanceof checks across module boundaries (serialized
 * error objects lose prototype chains).
 */
export class WebhookTransientFailureError extends Error {
  readonly name = "WebhookTransientFailure";
  readonly failed: Array<{ event: NormalizedWebhookEvent; error: string }>;
  readonly totalEvents: number;
  constructor(
    failed: Array<{ event: NormalizedWebhookEvent; error: string }>,
    totalEvents: number,
  ) {
    super(
      `Transient webhook processing failure: ${failed.length}/${totalEvents} events could not be recorded`,
    );
    this.failed = failed;
    this.totalEvents = totalEvents;
  }
}

/**
 * Apply a verified, normalized webhook-event batch to the canonical
 * ledger. The provider has already authenticated the payload; this
 * function is provider-blind.
 *
 * 2026-04-21 Patch C1 — ACK-correctness:
 *   Per-event handlers classify their errors into replay / config / transient.
 *   Replay and config errors are kept in the `accepted` / `replayed` /
 *   `ignored` arrays (HTTP 200 from the route). Transient errors propagate
 *   out of the handler, are captured per-event in `failed`, and cause THIS
 *   function to throw `WebhookTransientFailureError` after the loop so the
 *   route returns HTTP 500 and Stripe retries. Pre-patch behavior silently
 *   200-ACKed transient errors and dropped the ledger write.
 */
async function applyVerifiedWebhookBatch(
  providerId: string,
  events: NormalizedWebhookEvent[],
): Promise<ApplyWebhookResult> {
  const out: ApplyWebhookResult = {
    accepted: [],
    ignored: [],
    replayed: [],
    failed: [],
  };

  for (const event of events) {
    try {
      switch (event.kind) {
        case "payment_succeeded": {
          const handled = await handlePaymentSucceeded(providerId, event);
          if (handled === "replay") out.replayed.push(event);
          else out.accepted.push(event);
          break;
        }
        case "refund_created": {
          const handled = await handleRefundCreated(providerId, event);
          if (handled === "replay") out.replayed.push(event);
          else if (handled === "skipped") out.ignored.push(event);
          else out.accepted.push(event);
          break;
        }
        case "payment_failed":
          logInfo("payment_intent_failed", {
            providerId,
            eventId: event.eventId,
            providerPaymentId: event.providerPaymentId,
            lastError: event.lastErrorMessage,
          });
          out.ignored.push(event);
          break;
        case "unsupported":
          logInfo("event_out_of_scope", {
            providerId,
            eventId: event.eventId,
            eventType: event.eventType,
          });
          out.ignored.push(event);
          break;
      }
    } catch (err) {
      // Only transient errors reach here — the per-handler catch already
      // absorbs replay/config. Stash for the post-loop throw so every
      // event in the batch still gets its turn.
      const message = err instanceof Error ? err.message : String(err);
      logAnomaly("handler_transient_failure", {
        providerId,
        eventId: event.eventId,
        kind: event.kind,
        message,
      });
      out.failed.push({ event, error: message });
    }
  }

  if (out.failed.length > 0) {
    throw new WebhookTransientFailureError(out.failed, events.length);
  }

  return out;
}

async function handlePaymentSucceeded(
  providerId: string,
  event: Extract<NormalizedWebhookEvent, { kind: "payment_succeeded" }>,
): Promise<"accepted" | "replay"> {
  const meta = readTenantMetadata(event.metadata);
  if (!meta) {
    logAnomaly("metadata_missing_or_malformed", {
      providerId,
      eventId: event.eventId,
      providerPaymentId: event.providerPaymentId,
      providedMetadata: event.metadata,
    });
    return "accepted";
  }

  const amountDollars = centsToDollarsString(event.amountCents);

  try {
    await paymentRepository.createPayment(meta.companyId, meta.invoiceId, {
      amount: amountDollars,
      method: "credit",
      reference: event.chargeId ?? null,
      notes: null,
      id: meta.prospectivePaymentId,
      providerSource: providerId as "stripe",
      providerEventId: event.eventId,
    });
    logInfo("payment_recorded", {
      providerId,
      eventId: event.eventId,
      providerPaymentId: event.providerPaymentId,
      chargeId: event.chargeId,
      companyId: meta.companyId,
      invoiceId: meta.invoiceId,
      paymentId: meta.prospectivePaymentId,
      amount: amountDollars,
    });

    // Post-payment receipt email — runs AFTER the canonical ledger
    // write so the rendered balance reflects the just-committed row.
    // Failures must not bubble to the webhook ACK.
    try {
      await emailDispatchService.sendPaymentReceiptEmail({
        tenantId: meta.companyId,
        invoiceId: meta.invoiceId,
        paymentAmount: amountDollars,
      });
    } catch (receiptErr: unknown) {
      logAnomaly("payment_receipt_send_failed", {
        providerId,
        eventId: event.eventId,
        invoiceId: meta.invoiceId,
        message:
          receiptErr instanceof Error
            ? receiptErr.message
            : String(receiptErr),
      });
    }
    return "accepted";
  } catch (err: unknown) {
    // 2026-04-21 Patch C1: classify before deciding the ACK path.
    // Transient errors must propagate so Stripe retries — swallowing
    // them was the previous behavior and caused silent payment loss.
    const klass = classifyWebhookError(err);
    if (klass === "final_replay") {
      logInfo("replay_already_ingested", {
        providerId,
        eventId: event.eventId,
        providerPaymentId: event.providerPaymentId,
        companyId: meta.companyId,
        invoiceId: meta.invoiceId,
      });
      return "replay";
    }
    if (klass === "final_config") {
      logAnomaly("create_payment_config_error", {
        providerId,
        eventId: event.eventId,
        providerPaymentId: event.providerPaymentId,
        companyId: meta.companyId,
        invoiceId: meta.invoiceId,
        message: err instanceof Error ? err.message : String(err),
      });
      return "accepted"; // 200-ACK — retry cannot help a config mismatch
    }
    // transient — rethrow. The batch-level aggregator will 500 so
    // Stripe's retry machinery eventually succeeds once the transient
    // condition clears.
    logAnomaly("create_payment_transient_failure_will_retry", {
      providerId,
      eventId: event.eventId,
      providerPaymentId: event.providerPaymentId,
      companyId: meta.companyId,
      invoiceId: meta.invoiceId,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

async function handleRefundCreated(
  providerId: string,
  event: Extract<NormalizedWebhookEvent, { kind: "refund_created" }>,
): Promise<"accepted" | "replay" | "skipped"> {
  // Locate the parent payment by its provider charge id. Tenant-less
  // lookup is safe: the resulting row carries `companyId`.
  const parent = await paymentRepository.findByProviderReference(
    providerId as "stripe",
    event.providerChargeId,
  );
  if (!parent) {
    logAnomaly("refund_for_unknown_charge", {
      providerId,
      eventId: event.eventId,
      chargeId: event.providerChargeId,
    });
    return "skipped";
  }

  const refundDollars = centsToDollarsString(event.amountCents);
  try {
    await paymentRepository.createRefund(parent.companyId, parent.id, {
      amount: refundDollars,
      method: "credit",
      reference: event.providerRefundId,
      notes: event.reason ?? null,
      providerSource: providerId as "stripe",
      // For refund rows, providerEventId is the refund id itself so a
      // multi-refund event still produces unique rows.
      providerEventId: event.providerRefundId,
    });
    logInfo("refund_recorded", {
      providerId,
      eventId: event.eventId,
      chargeId: event.providerChargeId,
      refundId: event.providerRefundId,
      companyId: parent.companyId,
      invoiceId: parent.invoiceId,
      parentPaymentId: parent.id,
      amount: refundDollars,
    });
    return "accepted";
  } catch (err: unknown) {
    // 2026-04-21 Patch C1: same classification as the payment handler.
    // Transient errors propagate → 500 → Stripe retries.
    const klass = classifyWebhookError(err);
    if (klass === "final_replay") {
      logInfo("refund_replay_already_ingested", {
        providerId,
        eventId: event.eventId,
        chargeId: event.providerChargeId,
        refundId: event.providerRefundId,
      });
      return "replay";
    }
    if (klass === "final_config") {
      logAnomaly("create_refund_config_error", {
        providerId,
        eventId: event.eventId,
        chargeId: event.providerChargeId,
        refundId: event.providerRefundId,
        companyId: parent.companyId,
        invoiceId: parent.invoiceId,
        message: err instanceof Error ? err.message : String(err),
      });
      return "accepted";
    }
    logAnomaly("create_refund_transient_failure_will_retry", {
      providerId,
      eventId: event.eventId,
      chargeId: event.providerChargeId,
      refundId: event.providerRefundId,
      companyId: parent.companyId,
      invoiceId: parent.invoiceId,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Extract tenant-resolution metadata written by `createCheckout`. Every
 * field is required; a missing one means the charge cannot be trusted
 * to land on the right tenant.
 */
function readTenantMetadata(
  metadata: Record<string, string> | null | undefined,
): { companyId: string; invoiceId: string; prospectivePaymentId: string } | null {
  if (!metadata) return null;
  const { companyId, invoiceId, prospectivePaymentId } = metadata;
  if (!companyId || !invoiceId || !prospectivePaymentId) return null;
  return { companyId, invoiceId, prospectivePaymentId };
}

// ============================================================================
// Webhook verification wrapper
// ============================================================================

/**
 * 2026-04-21 Patch C1 — thrown on signature / secret-config failures so
 * the route can map signature issues to HTTP 400 while mapping
 * application-layer transient failures to HTTP 500. The two failure
 * classes need different ACK semantics and this marker is how the
 * route tells them apart without relying on error-message matching.
 */
export class WebhookSignatureError extends Error {
  readonly name = "WebhookSignatureError";
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    (this as any).cause = cause;
  }
}

/**
 * Verify + normalize a provider webhook payload. Throws
 * `WebhookSignatureError` on signature / secret-config failure. Returns
 * the normalized events on success. Does NOT apply events to the ledger;
 * the caller is expected to invoke `applyVerifiedWebhookBatch` next.
 *
 * The verify step and the apply step are split so the route can wrap
 * each in its own try/catch and map failures to the correct HTTP status
 * (400 for unverified payloads, 500 for transient processing failures).
 */
async function verifyInboundWebhook(
  providerId: string,
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): Promise<NormalizedWebhookEvent[]> {
  const provider = resolveById(providerId);
  if (!provider) {
    throw createError(404, `Unknown payment provider: ${providerId}`);
  }
  try {
    return await provider.verifyWebhook(rawBody, headers);
  } catch (err) {
    throw new WebhookSignatureError(err);
  }
}

/**
 * End-to-end helper retained for callers that don't need the two-phase
 * split. Verification failures surface as `WebhookSignatureError`;
 * transient processing failures surface as
 * `WebhookTransientFailureError` so either side can be mapped to the
 * correct HTTP status at the route layer.
 */
async function handleInboundWebhook(
  providerId: string,
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): Promise<ApplyWebhookResult> {
  const events = await verifyInboundWebhook(providerId, rawBody, headers);
  return applyVerifiedWebhookBatch(providerId, events);
}

// ============================================================================
// Exports
// ============================================================================

export const paymentApplicationService = {
  createCheckout,
  refundPayment,
  verifyInboundWebhook,
  handleInboundWebhook,
  applyVerifiedWebhookBatch,
};
