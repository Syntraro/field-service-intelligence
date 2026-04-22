/**
 * Payments webhook router.
 *
 * 2026-04-21 provider-neutral refactor: this router mounts the canonical
 * neutral path:
 *
 *   POST /api/webhooks/:provider     — canonical
 *
 * The Stripe-dashboard URL `/api/webhooks/stripe` is matched by this
 * same route with `provider='stripe'`, so the URL registered in the
 * Stripe dashboard stays valid without a separate mount.
 *
 * 2026-04-21 Patch C1 — ACK correctness:
 *   The route now distinguishes THREE failure classes and maps each to
 *   the correct HTTP status so Stripe's retry semantics work as
 *   intended:
 *
 *     - signature / secret-config failure     → HTTP 400 (Stripe retries
 *                                                  until the operator
 *                                                  fixes config)
 *     - transient processing failure
 *       (DB down, pool exhausted, timeout)    → HTTP 500 (Stripe retries
 *                                                  with exponential
 *                                                  backoff over ~72h)
 *     - success / idempotent replay /
 *       config-drift on individual events     → HTTP 200 (final ACK)
 *
 *   Pre-patch, ALL application failures silently 200-ACK'd. A DB outage
 *   during a Stripe traffic spike would lose payment rows permanently.
 *   The classification now lives in paymentApplicationService — this
 *   file is thin and only maps service error types to HTTP statuses.
 *
 * Mounted BEFORE `express.json()` in `server/index.ts` because provider
 * signature verification is computed over the exact raw bytes.
 */

import express, { type Request, type Response, type Router } from "express";
import {
  paymentApplicationService,
  WebhookSignatureError,
  WebhookTransientFailureError,
} from "../services/payments/paymentApplicationService";
import { resolveById } from "../services/payments/providers/resolver";
// 2026-04-22 Payment Ops PR1: persist signature-verification failures
// to the webhook event log alongside the normal delivery outcomes.
// Safe-wrapped — log-write failure never affects the HTTP response.
import { safeRecordPaymentWebhookEvent } from "../storage/paymentWebhookEvents";

const NEUTRAL_PATH = "/api/webhooks/:provider";
const LEGACY_STRIPE_PATH = "/api/webhooks/stripe";

function logAnomaly(kind: string, ctx: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.error(`[payments-webhook] ${kind}`, JSON.stringify({ kind, ...ctx }));
}

/**
 * 2026-04-21 Patch C1 — three-way ACK handler.
 *
 * Flow:
 *   1. Fast 404 for unknown provider ids so we never forward to the
 *      adapter with a bad param.
 *   2. VERIFY phase — authenticates + normalizes the raw payload.
 *      Failures here are signature / config issues; the provider should
 *      keep the event queued, so return 400.
 *   3. APPLY phase — writes normalized events to the canonical ledger.
 *      Individual events that fail transiently cause
 *      `applyVerifiedWebhookBatch` to throw `WebhookTransientFailureError`
 *      so the provider re-delivers after our transient condition clears;
 *      return 500.
 *   4. Otherwise, return 200. Idempotent replays and known-final config
 *      drift stay inside the 200 ACK path — classified at the service
 *      layer, not here.
 */
async function handle(
  providerId: string,
  req: Request,
  res: Response,
): Promise<void> {
  if (!resolveById(providerId)) {
    res.status(404).json({ error: `Unknown payment provider: ${providerId}` });
    return;
  }

  // ---- VERIFY phase ------------------------------------------------
  let events;
  try {
    events = await paymentApplicationService.verifyInboundWebhook(
      providerId,
      req.body as Buffer,
      req.headers as Record<string, string | string[] | undefined>,
    );
  } catch (err: unknown) {
    if (err instanceof WebhookSignatureError) {
      logAnomaly("signature_verification_failed", {
        providerId,
        message: err.message,
      });
      // No stable event id pre-verification — dedupeKey null means each
      // signature failure is its own row (useful for rate-watching).
      void safeRecordPaymentWebhookEvent({
        providerId,
        providerEventId: null,
        eventType: null,
        eventKind: "signature_failed",
        outcome: "signature_failed",
        httpStatus: 400,
        errorMessage: err.message,
        dedupeKey: null,
      });
      res.status(400).json({ error: "Invalid signature" });
      return;
    }
    // Defensive: unknown throw from verify stage. Treat as transient so
    // the provider retries — we don't want to ACK on mystery errors.
    const message = err instanceof Error ? err.message : String(err);
    logAnomaly("verify_unexpected_error", { providerId, message });
    res.status(500).json({ error: "Webhook verification error" });
    return;
  }

  // ---- APPLY phase -------------------------------------------------
  try {
    await paymentApplicationService.applyVerifiedWebhookBatch(
      providerId,
      events,
    );
    res.status(200).json({ ok: true });
    return;
  } catch (err: unknown) {
    if (err instanceof WebhookTransientFailureError) {
      // Transient processing failure — don't ACK, let Stripe retry.
      logAnomaly("transient_processing_failure_not_acked", {
        providerId,
        failedEventCount: err.failed.length,
        totalEventCount: err.totalEvents,
        firstError: err.failed[0]?.error,
      });
      res.status(500).json({
        error: "Temporary processing failure; please retry",
        code: "WEBHOOK_TRANSIENT_FAILURE",
      });
      return;
    }
    // Unexpected error from apply. Conservative default: don't ACK.
    const message = err instanceof Error ? err.message : String(err);
    logAnomaly("apply_unexpected_error", { providerId, message });
    res.status(500).json({ error: "Webhook processing error" });
  }
}

export function buildStripeWebhookRouter(): Router {
  const router = express.Router();

  // Canonical neutral path. Adapters are resolved from the URL param so
  // adding a provider is one resolver entry + one adapter file.
  //
  // The legacy Stripe-named URL `/api/webhooks/stripe` is matched by
  // this same route with `provider='stripe'` — the dashboard webhook
  // URL registered with Stripe stays valid without a separate mount.
  router.post(
    NEUTRAL_PATH,
    express.raw({ type: "application/json", limit: "1mb" }),
    async (req: Request, res: Response) => {
      await handle(req.params.provider, req, res);
    },
  );

  return router;
}

// Preserve the named-constant for operators grepping for `/api/webhooks/stripe`.
void LEGACY_STRIPE_PATH;
