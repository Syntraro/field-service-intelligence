/**
 * Stripe Payments — staff-initiated in-app card payment endpoint.
 *
 * POST /api/invoices/:invoiceId/stripe/payment-intent
 *
 * Creates a Stripe PaymentIntent bound to the given invoice. Returns
 * `{ clientSecret, paymentIntentId, prospectivePaymentId }` so a future
 * client-side Stripe Elements flow can confirm the payment. The
 * PaymentIntent carries server-set metadata (`companyId`, `invoiceId`,
 * `prospectivePaymentId`) which the webhook handler reads back to
 * resolve the tenant and to pre-set the payments row id.
 *
 * Auth: staff only (`requireRole(MANAGER_ROLES)`). Portal self-pay is
 * out of scope for this phase.
 */

import { Router, type Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import { invoiceRepository } from "../storage/invoices";
import { canAcceptInvoicePayment } from "../lib/invoicePredicates";
import { getStripeClient } from "../services/stripeClient";

const router = Router();

const createIntentSchema = z
  .object({
    // Amount in dollars, string to match the rest of the payments API
    // (numeric 12,2). Route converts to cents at the Stripe boundary.
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid amount format"),
  })
  .strict();

/**
 * POST /api/invoices/:invoiceId/stripe/payment-intent
 */
router.post(
  "/invoices/:invoiceId/stripe/payment-intent",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { invoiceId } = req.params;
    const { amount } = validateSchema(createIntentSchema, req.body);

    // Fail-closed if Stripe isn't configured. 503 tells the caller the
    // service is temporarily unavailable — not a client error.
    if (!process.env.STRIPE_SECRET_KEY) {
      throw createError(503, "Stripe is not configured on this server");
    }

    // Canonical invoice-payable check (same predicate used by the manual
    // payment path). Keeps the "when can money attach to this invoice"
    // rule in one place.
    const invoice = await invoiceRepository.getInvoice(companyId, invoiceId);
    if (!invoice) throw createError(404, "Invoice not found");
    if (!canAcceptInvoicePayment(invoice.status)) {
      throw createError(
        400,
        `Cannot take payment on invoice with status "${invoice.status}".`,
      );
    }

    // Sanity check: requested amount must be > 0 and ≤ outstanding
    // balance. Prevents over-charge via the Stripe path. Overshoot
    // handling for partial-capture is out of scope this phase.
    const cents = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      throw createError(400, "Amount must be a positive number");
    }
    const balanceCents = Math.round(parseFloat(invoice.balance ?? "0") * 100);
    if (cents > balanceCents) {
      throw createError(
        400,
        `Requested amount exceeds outstanding invoice balance (${(balanceCents / 100).toFixed(2)}).`,
      );
    }

    // 2026-04-14 Stripe Phase 1: pre-generate the UUID that will become
    // the payments row id on webhook success. It doubles as the Stripe
    // Idempotency-Key so a retried PaymentIntent create never produces
    // a duplicate ledger row (via the partial UNIQUE on
    // payments_provider_event_id_uq + PK collision on id). Mirrors the
    // Phase A email pattern (delivery.id as Resend Idempotency-Key).
    const prospectivePaymentId = randomUUID();

    const stripe = getStripeClient();
    const intent = await stripe.paymentIntents.create(
      {
        amount: cents,
        currency: "usd",
        automatic_payment_methods: { enabled: true },
        metadata: {
          companyId,
          invoiceId,
          prospectivePaymentId,
          invoiceNumber: String(invoice.invoiceNumber ?? ""),
        },
      },
      { idempotencyKey: prospectivePaymentId },
    );

    res.status(201).json({
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      prospectivePaymentId,
    });
  }),
);

export default router;
