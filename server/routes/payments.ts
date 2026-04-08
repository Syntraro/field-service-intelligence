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
import { paymentMethodEnum } from "@shared/schema";
import { logEventAsync } from "../lib/events";
import { getQueryCtx } from "../lib/queryCtx";

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
      await paymentRepository.deletePayment(req.companyId!, req.params.id);
      res.json({ success: true });
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
