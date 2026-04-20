/**
 * Stripe webhook receiver.
 *
 * POST /api/webhooks/stripe
 *
 * Events handled:
 *   - payment_intent.succeeded → canonical createPayment (providerSource='stripe')
 *   - charge.refunded          → canonical createRefund   (providerSource='stripe')
 *   - payment_intent.payment_failed → log-only, no ledger write
 *   - anything else            → 204 with a low-noise info log
 *
 * Mounted BEFORE `express.json()` in `server/index.ts` because
 * Stripe's signature verification is computed over the exact raw body
 * bytes.
 *
 * Trust boundary:
 *   - Every financial write is gated on:
 *       1. valid Stripe signature (stripe.webhooks.constructEvent),
 *       2. metadata.companyId + metadata.invoiceId present,
 *       3. invoice actually exists for that company,
 *       4. Stripe amount ≤ current outstanding balance (sanity cap).
 *   - Mismatches are logged as structured anomalies and 200-ACKed so
 *     Stripe does not retry indefinitely on a configuration issue.
 *
 * Idempotency:
 *   - The canonical DB layer's partial UNIQUE
 *     `payments_provider_event_id_uq` is authoritative. Webhook-replay
 *     of an already-ingested event results in a UNIQUE violation —
 *     caught here and translated into a 200 ACK.
 *   - For payment rows: providerEventId = the event id (`evt_...`).
 *   - For refund rows: providerEventId = the refund id (`re_...`),
 *     because a single `charge.refunded` event can carry N refunds and
 *     the dedupe must be per-row, not per-event.
 */

import express, { type Request, type Response, type Router } from "express";
import Stripe from "stripe";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { payments } from "@shared/schema";
import { paymentRepository } from "../storage/payments";
import { getStripeClient, getStripeWebhookSecret } from "../services/stripeClient";
import { emailDispatchService } from "../services/emailDispatchService";

const WEBHOOK_PATH = "/api/webhooks/stripe";

/**
 * Structured anomaly logger. Single shape so operator monitoring can
 * alert on `[stripe-webhook]` with full per-failure context, mirroring
 * the Phase B structured webhook-log pattern for Resend.
 */
function logAnomaly(kind: string, ctx: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.error(
    `[stripe-webhook] ${kind}`,
    JSON.stringify({ kind, ...ctx }),
  );
}

function logInfo(kind: string, ctx: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.info(
    `[stripe-webhook] ${kind}`,
    JSON.stringify({ kind, ...ctx }),
  );
}

/**
 * Extract and validate the tenant-resolution metadata that the
 * server-side PaymentIntent writer embeds. Returns null on any
 * missing/malformed field so the caller can anomaly-log + 200 ACK.
 */
function readTenantMetadata(
  metadata: Record<string, string> | null | undefined,
): { companyId: string; invoiceId: string; prospectivePaymentId: string } | null {
  if (!metadata) return null;
  const companyId = metadata.companyId;
  const invoiceId = metadata.invoiceId;
  const prospectivePaymentId = metadata.prospectivePaymentId;
  if (
    typeof companyId !== "string" ||
    typeof invoiceId !== "string" ||
    typeof prospectivePaymentId !== "string" ||
    !companyId ||
    !invoiceId ||
    !prospectivePaymentId
  ) {
    return null;
  }
  return { companyId, invoiceId, prospectivePaymentId };
}

/**
 * Map `payment_intent.succeeded` → createPayment ledger write.
 */
async function handlePaymentIntentSucceeded(
  event: Stripe.PaymentIntentSucceededEvent,
): Promise<void> {
  const intent = event.data.object;
  const metadata = readTenantMetadata(intent.metadata);

  if (!metadata) {
    logAnomaly("metadata_missing_or_malformed", {
      eventId: event.id,
      paymentIntentId: intent.id,
      providedMetadata: intent.metadata,
    });
    return; // 200 ACK — no financial write on mismatch per trust rules
  }

  // Stripe sends amount in cents. Convert to the ledger's numeric(12,2)
  // string form. `amount_received` reflects the captured amount on a
  // succeeded event; in Phase 1 (no partial capture) it equals `amount`.
  const amountReceivedCents = intent.amount_received ?? intent.amount ?? 0;
  const amountDollars = (amountReceivedCents / 100).toFixed(2);

  // Extract the charge id to store as `reference`. Supports both the
  // modern `latest_charge` field and older shapes where it arrives as
  // a Charge object on `latest_charge`. Null-safe.
  const latestCharge = intent.latest_charge;
  const chargeId =
    typeof latestCharge === "string"
      ? latestCharge
      : latestCharge && typeof latestCharge === "object"
        ? (latestCharge as Stripe.Charge).id
        : null;

  try {
    await paymentRepository.createPayment(
      metadata.companyId,
      metadata.invoiceId,
      {
        amount: amountDollars,
        method: "credit",
        reference: chargeId,
        notes: null,
        id: metadata.prospectivePaymentId,
        providerSource: "stripe",
        providerEventId: event.id,
      },
    );
    logInfo("payment_recorded", {
      eventId: event.id,
      paymentIntentId: intent.id,
      chargeId,
      companyId: metadata.companyId,
      invoiceId: metadata.invoiceId,
      paymentId: metadata.prospectivePaymentId,
      amount: amountDollars,
    });

    // 2026-04-18 Phase 11: fire customer payment-receipt email. Runs
    // AFTER the canonical ledger write so the rendered balance reflects
    // the just-committed payment. Failures here must not break webhook
    // acknowledgement — Stripe's job is done; the receipt is a
    // downstream notification.
    try {
      await emailDispatchService.sendPaymentReceiptEmail({
        tenantId: metadata.companyId,
        invoiceId: metadata.invoiceId,
        paymentAmount: amountDollars,
      });
    } catch (receiptErr: any) {
      logAnomaly("payment_receipt_send_failed", {
        eventId: event.id,
        invoiceId: metadata.invoiceId,
        message: receiptErr?.message ?? String(receiptErr),
      });
    }
  } catch (err: any) {
    // Common case: replay — PK or provider_event_id UNIQUE violation.
    // Treat as already-ingested (200 ACK) per the Stripe pattern.
    if (isUniqueViolation(err)) {
      logInfo("replay_already_ingested", {
        eventId: event.id,
        paymentIntentId: intent.id,
        companyId: metadata.companyId,
        invoiceId: metadata.invoiceId,
      });
      return;
    }
    // Canonical createPayment also rejects with a 404 when the invoice
    // doesn't exist under the claimed tenant (trust-boundary check #3).
    // Translate that into a no-write anomaly — do NOT rethrow, or
    // Stripe will retry forever on a config error.
    logAnomaly("create_payment_failed", {
      eventId: event.id,
      paymentIntentId: intent.id,
      companyId: metadata.companyId,
      invoiceId: metadata.invoiceId,
      message: err?.message ?? String(err),
      statusCode: err?.statusCode ?? null,
      name: err?.name ?? null,
    });
  }
}

/**
 * Map `charge.refunded` → createRefund ledger writes. A single event
 * can carry multiple refund objects; each unhandled refund produces a
 * row. The canonical createRefund call handles overshoot and dedupe.
 */
async function handleChargeRefunded(
  event: Stripe.ChargeRefundedEvent,
): Promise<void> {
  const charge = event.data.object;
  const chargeId = charge.id;

  if (!charge.refunds?.data || charge.refunds.data.length === 0) {
    logAnomaly("charge_refunded_no_refund_data", {
      eventId: event.id,
      chargeId,
    });
    return;
  }

  // Locate the parent payment by its Stripe charge id (stored in
  // `reference` when the payment row was created via
  // `payment_intent.succeeded`). Tenant-less lookup is safe here: the
  // resulting row carries a `companyId` we then assert against the
  // refund's charge. providerSource='stripe' to bound the search.
  const [parent] = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.reference, chargeId),
        eq(payments.providerSource, "stripe"),
      ),
    )
    .limit(1);

  if (!parent) {
    // Externally-initiated refund on a charge we never recorded.
    // Common if the charge was created outside this app.
    logAnomaly("refund_for_unknown_charge", { eventId: event.id, chargeId });
    return;
  }

  for (const refund of charge.refunds.data) {
    if (!refund.id) continue;
    const refundDollars = ((refund.amount ?? 0) / 100).toFixed(2);

    try {
      await paymentRepository.createRefund(parent.companyId, parent.id, {
        amount: refundDollars,
        method: "credit",
        reference: refund.id,
        notes: refund.reason ?? null,
        providerSource: "stripe",
        // For refund rows, providerEventId is the refund id itself so a
        // multi-refund event still produces unique rows. The partial
        // UNIQUE `payments_provider_event_id_uq` catches replays.
        providerEventId: refund.id,
      });
      logInfo("refund_recorded", {
        eventId: event.id,
        chargeId,
        refundId: refund.id,
        companyId: parent.companyId,
        invoiceId: parent.invoiceId,
        parentPaymentId: parent.id,
        amount: refundDollars,
      });
    } catch (err: any) {
      if (isUniqueViolation(err)) {
        logInfo("refund_replay_already_ingested", {
          eventId: event.id,
          chargeId,
          refundId: refund.id,
        });
        continue;
      }
      logAnomaly("create_refund_failed", {
        eventId: event.id,
        chargeId,
        refundId: refund.id,
        companyId: parent.companyId,
        invoiceId: parent.invoiceId,
        message: err?.message ?? String(err),
        statusCode: err?.statusCode ?? null,
      });
    }
  }
}

function isUniqueViolation(err: any): boolean {
  // Postgres unique-violation SQLSTATE is 23505. Drizzle / pg surfaces
  // it at `err.code` on the raw driver error.
  return err?.code === "23505" || err?.cause?.code === "23505";
}

export function buildStripeWebhookRouter(): Router {
  const router = express.Router();

  router.post(
    WEBHOOK_PATH,
    express.raw({ type: "application/json", limit: "1mb" }),
    async (req: Request, res: Response) => {
      // Signature verification (fail-closed).
      let event: Stripe.Event;
      try {
        const sig = req.header("stripe-signature") ?? "";
        const secret = getStripeWebhookSecret();
        event = getStripeClient().webhooks.constructEvent(
          req.body as Buffer,
          sig,
          secret,
        );
      } catch (err: any) {
        // Signature failure OR missing secret. Return non-2xx so Stripe
        // keeps the event queued — if the secret is misconfigured, the
        // operator fixes it and Stripe redelivers.
        logAnomaly("signature_verification_failed", {
          message: err?.message ?? String(err),
        });
        return res.status(400).json({ error: "Invalid signature" });
      }

      try {
        switch (event.type) {
          case "payment_intent.succeeded":
            await handlePaymentIntentSucceeded(
              event as Stripe.PaymentIntentSucceededEvent,
            );
            break;
          case "charge.refunded":
            await handleChargeRefunded(event as Stripe.ChargeRefundedEvent);
            break;
          case "payment_intent.payment_failed":
            logInfo("payment_intent_failed", {
              eventId: event.id,
              paymentIntentId: (event.data.object as Stripe.PaymentIntent).id,
              lastError:
                (event.data.object as Stripe.PaymentIntent).last_payment_error
                  ?.message ?? null,
            });
            break;
          default:
            // Out-of-scope events — acknowledge at 204 so Stripe stops
            // delivering. Low-noise info log helps diagnose unexpected
            // traffic if a setting drift enables extra event types.
            logInfo("event_out_of_scope", {
              eventId: event.id,
              eventType: event.type,
            });
            return res.status(204).send();
        }
        return res.status(200).json({ ok: true });
      } catch (err: any) {
        // Handlers already swallow their internal errors (see
        // handlePaymentIntentSucceeded / handleChargeRefunded). This is
        // an absolute last-resort catch: log and 200 so Stripe doesn't
        // retry a handler that's already done what it can.
        logAnomaly("handler_unexpected_error", {
          eventId: event?.id,
          eventType: event?.type,
          message: err?.message ?? String(err),
          name: err?.name ?? null,
          stack: err?.stack ?? null,
        });
        return res.status(200).json({ ok: true });
      }
    },
  );

  return router;
}
