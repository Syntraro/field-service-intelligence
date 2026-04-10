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
import { AuthedRequest } from "../auth/tenantIsolation";
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
