/**
 * Payment Routes
 *
 * Handles payment CRUD operations for invoices.
 * Payments auto-update invoice balance and status.
 */

import { Router, Response } from "express";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest, rateLimitPerTenant } from "../auth/tenantIsolation";
import { paymentRepository } from "../storage/payments";
import { invoiceRepository } from "../storage/invoices";
import { isInvoicePaid } from "../lib/invoicePredicates";
import { paymentMethodEnum, payments as paymentsTable } from "@shared/schema";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { logEventAsync } from "../lib/events";
import { getQueryCtx } from "../lib/queryCtx";
// 2026-04-09: Outbound QBO payment sync — fire-and-forget hook called AFTER
// canonical local reconciliation. Helper enforces the company toggle, never
// throws, never mutates invoice financial state. See locked product decisions
// in maybeSyncPayment.ts and QboPaymentService.ts.
import { maybeSyncPaymentToQbo } from "../services/qbo/maybeSyncPayment";
// 2026-04-21 provider-neutral seam. Routes do auth + validation + call the
// application service. Stripe SDK usage lives only behind the Stripe adapter.
import { paymentApplicationService } from "../services/payments/paymentApplicationService";

const router = Router();

// ========================================
// VALIDATION SCHEMAS
// ========================================

const createPaymentSchema = z
  .object({
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid amount format"),
    method: z.enum(paymentMethodEnum),
    reference: z.string().max(100).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    receivedAt: z.string().datetime().optional(),
  })
  .strict();

const updatePaymentSchema = z
  .object({
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    method: z.enum(paymentMethodEnum).optional(),
    reference: z.string().max(100).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    receivedAt: z.string().datetime().optional(),
  })
  .strict();

// ========================================
// ROUTES
// ========================================

// ========================================
// PROVIDER-NEUTRAL CHECKOUT (staff)
// ========================================
// POST /api/invoices/:invoiceId/payments/checkout
// Issues a provider-neutral checkout token for an invoice. Replaces
// the provider-named /stripe/payment-intent route (kept live as a
// forwarder). Response contract is the same for every future provider;
// only the `providerId` + `clientToken` semantics differ.
//
// 2026-04-29 Stripe completion: rate limiter mirrors the portal
// `portal-payment-intent` cap. Staff is authenticated and trusted, but
// every call mints a new Stripe PaymentIntent (a real provider cost).
// 12/min/tenant is double the portal allowance — generous for legitimate
// retries from a busy office while still capping scripted abuse if a
// session is compromised.
const staffPaymentCheckoutLimiter = rateLimitPerTenant({
  scope: "staff-payment-checkout",
  windowMs: 60_000,
  max: 12,
});

const checkoutSchema = z
  .object({
    amount: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, "Invalid amount format")
      .optional(),
    currency: z.string().length(3).optional(),
  })
  .strict();

router.post(
  "/invoices/:invoiceId/payments/checkout",
  requireRole(MANAGER_ROLES),
  staffPaymentCheckoutLimiter,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { amount, currency } = validateSchema(checkoutSchema, req.body ?? {});
    const result = await paymentApplicationService.createCheckout({
      companyId: req.companyId!,
      invoiceId: req.params.invoiceId,
      source: "staff",
      amount,
      currency,
    });
    res.status(201).json(result);
  }),
);

// GET /api/invoices/:invoiceId/payments - List payments for invoice
router.get(
  "/invoices/:invoiceId/payments",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const payments = await paymentRepository.getPayments(
      req.companyId!,
      req.params.invoiceId
    );
    res.json(payments);
  })
);

// POST /api/invoices/:invoiceId/payments - Create payment
router.post(
  "/invoices/:invoiceId/payments",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const validated = validateSchema(createPaymentSchema, req.body);

    try {
      const payment = await paymentRepository.createPayment(
        req.companyId!,
        req.params.invoiceId,
        validated
      );

      // 2026-03-20 Phase 4A: Emit invoice.paid event if payment caused fully-paid status
      const postPaymentInvoice = await invoiceRepository.getInvoice(req.companyId!, req.params.invoiceId);
      if (postPaymentInvoice && isInvoicePaid(postPaymentInvoice.status)) {
        logEventAsync(getQueryCtx(req), {
          eventType: "invoice.paid",
          entityType: "invoice",
          entityId: req.params.invoiceId,
          summary: `Invoice #${postPaymentInvoice.invoiceNumber} fully paid`,
          meta: { invoiceNumber: postPaymentInvoice.invoiceNumber, paymentId: payment.id },
        });
      }

      res.status(201).json(payment);

      // 2026-04-09: Outbound QBO payment sync — fire-and-forget AFTER local
      // canonical reconciliation has already committed (paymentRepository.createPayment
      // wraps insert + recalculateInvoiceBalance in a transaction). The helper checks
      // companies.qboPaymentSyncEnabled internally; when disabled this is a quiet no-op.
      // The sync runs after the HTTP response is sent so a slow QBO call cannot
      // block the user. Errors surface on payments.qboSyncStatus, not via res.
      void maybeSyncPaymentToQbo(req.companyId!, payment.id, "create", req.user?.id);
    } catch (error: any) {
      if (error.statusCode) throw error;
      if (error.message?.includes("Cannot add payment")) {
        throw createError(400, error.message);
      }
      throw error;
    }
  })
);

// GET /api/payments/:id - Get single payment
router.get(
  "/payments/:id",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    // Would need a getPayment method - for now redirect to list
    throw createError(501, "Get single payment not implemented");
  })
);

// PATCH /api/payments/:id - Update payment
router.patch(
  "/payments/:id",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const validated = validateSchema(updatePaymentSchema, req.body);

    try {
      const payment = await paymentRepository.updatePayment(
        req.companyId!,
        req.params.id,
        validated
      );

      res.json(payment);

      // 2026-04-09: Outbound QBO payment sync — mirror the local edit to QBO
      // after the response is sent. updatePayment in QboPaymentService falls
      // through to createPayment if the row was never synced before, so this
      // safely handles both first-sync and re-sync.
      void maybeSyncPaymentToQbo(req.companyId!, req.params.id, "update", req.user?.id);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw error;
    }
  })
);

// =============================================================================
// 2026-04-14 Payments Phase 2: refund + reversal writers.
//
// POST /api/payments/:id/refund   — money returned to customer
// POST /api/payments/:id/reversal — valid payment that didn't actually
//                                   happen (NSF, bounced cheque, stopped ACH)
//
// Both create a new ledger row attached to the parent payment via
// `parentPaymentId`. Same role gate as payment create. No QBO sync yet
// (Phase 2 rule 7 — QBO RefundReceipt sync lands in a follow-up).
// =============================================================================

const adjustmentSchema = z
  .object({
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid amount format"),
    method: z.enum(paymentMethodEnum).optional(),
    reference: z.string().max(100).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    receivedAt: z.string().datetime().optional(),
    // 2026-04-21 provider refunds: optional structured reason passed to
    // the provider adapter (ignored for manual rows). Free-text notes
    // continue via `notes`.
    reason: z.string().max(200).nullable().optional(),
  })
  .strict();

// POST /api/payments/:id/refund - Create a refund attached to a parent payment
//
// 2026-04-21 provider-neutral refund flow + hardening:
//   Delegates to paymentApplicationService.refundPayment, which returns
//   a discriminated union:
//     - `settled`                → 201 with the ledger row (normal path).
//     - `reconciliation_pending` → 202 with a structured body telling
//       the caller "provider has the refund, ledger backfill pending".
//       Returned only when Stripe has definitely moved money but the
//       ledger insert failed for a non-unique reason (DB blip, etc.).
//       A subsequent retry with the same arguments CANNOT cause a
//       second Stripe refund — the service uses a deterministic Stripe
//       idempotency key derived from the request shape, so Stripe
//       collapses retries to a single refund object.
router.post(
  "/payments/:id/refund",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const validated = validateSchema(adjustmentSchema, req.body);
    const result = await paymentApplicationService.refundPayment({
      companyId: req.companyId!,
      parentPaymentId: req.params.id,
      amount: validated.amount,
      method: validated.method,
      reference: validated.reference,
      notes: validated.notes,
      reason: validated.reason ?? null,
    });

    if (result.kind === "reconciliation_pending") {
      // 202 Accepted — request received and the external effect (the
      // refund at Stripe) has been applied, but the server hasn't yet
      // persisted the canonical record. The webhook will reconcile.
      res.status(202).json({
        status: "reconciliation_pending",
        message: "Refund issued. Reconciliation pending.",
        refundLedgerId: result.refundLedgerId,
        providerRefundId: result.providerRefundId,
        providerSource: result.providerSource,
      });
      return;
    }

    const refund = result.row;
    // Refunds/reversals are always children of legacy 1:1 payments, so they
    // inherit a non-null invoiceId from the parent (see
    // PaymentRepository.createLedgerAdjustment). The fallback to the empty
    // string keeps TS quiet for the new nullable column type without
    // changing any existing behavior.
    logEventAsync(getQueryCtx(req), {
      eventType: "invoice.refunded",
      entityType: "invoice",
      entityId: refund.invoiceId ?? "",
      summary: `Refund recorded on invoice`,
      meta: {
        refundId: refund.id,
        parentPaymentId: refund.parentPaymentId,
        amount: refund.amount,
        method: refund.method,
        reference: refund.reference,
        providerSource: refund.providerSource,
      },
    });
    res.status(201).json(refund);
  }),
);

// POST /api/payments/:id/reversal - Create a reversal attached to a parent payment
router.post(
  "/payments/:id/reversal",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const validated = validateSchema(adjustmentSchema, req.body);
    try {
      const reversal = await paymentRepository.createReversal(
        req.companyId!,
        req.params.id,
        validated,
      );
      logEventAsync(getQueryCtx(req), {
        eventType: "invoice.payment_reversed",
        entityType: "invoice",
        // See refund handler above — reversals inherit the parent's invoiceId.
        entityId: reversal.invoiceId ?? "",
        summary: `Payment reversed on invoice`,
        meta: {
          reversalId: reversal.id,
          parentPaymentId: reversal.parentPaymentId,
          amount: reversal.amount,
          method: reversal.method,
          reference: reversal.reference,
        },
      });
      res.status(201).json(reversal);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw error;
    }
  }),
);

// DELETE /api/payments/:id - Delete payment
router.delete(
  "/payments/:id",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    try {
      // 2026-04-09: Snapshot the payment row BEFORE the local delete so the
      // outbound QBO void call can read qboPaymentId / qboSyncToken (which
      // are gone after delete). We pass the snapshot through to the helper.
      // Tenant-isolated by companyId. If the row doesn't exist, paymentRepository
      // will throw notFound below — keep the existing behavior intact.
      const [snapshot] = await db
        .select()
        .from(paymentsTable)
        .where(
          and(
            eq(paymentsTable.id, req.params.id),
            eq(paymentsTable.companyId, req.companyId!),
          ),
        )
        .limit(1);

      await paymentRepository.deletePayment(req.companyId!, req.params.id);
      res.json({ success: true });

      // Fire QBO void after local delete commits. If snapshot is missing the
      // helper logs a skip and exits cleanly — no throw can leak from here.
      if (snapshot) {
        void maybeSyncPaymentToQbo(
          req.companyId!,
          req.params.id,
          "delete",
          req.user?.id,
          snapshot,
        );
      }
    } catch (error: any) {
      if (error.statusCode) throw error;
      if (error.message?.includes("Cannot delete payments")) {
        throw createError(400, error.message);
      }
      throw error;
    }
  })
);

export default router;
