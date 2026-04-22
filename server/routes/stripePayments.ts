/**
 * Staff-initiated card payment route — Stripe-named alias.
 *
 * 2026-04-21 provider-neutral refactor: the canonical route is now
 *   POST /api/invoices/:invoiceId/payments/checkout
 * (see `server/routes/payments.ts`). This file remains mounted at
 *   POST /api/invoices/:invoiceId/stripe/payment-intent
 * to preserve backward compatibility with any existing clients or
 * external integrations that hard-coded the old URL. Both paths are
 * served by the same `paymentApplicationService.createCheckout`
 * orchestration — there is no parallel flow.
 *
 * Delete this file once access logs confirm zero hits on the old URL
 * for a full release cycle.
 */

import { Router, type Response } from "express";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { asyncHandler } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { paymentApplicationService } from "../services/payments/paymentApplicationService";

const router = Router();

const legacyIntentSchema = z
  .object({
    amount: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, "Invalid amount format"),
  })
  .strict();

router.post(
  "/invoices/:invoiceId/stripe/payment-intent",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { amount } = validateSchema(legacyIntentSchema, req.body);
    const result = await paymentApplicationService.createCheckout({
      companyId: req.companyId!,
      invoiceId: req.params.invoiceId,
      source: "staff",
      amount,
    });
    // Preserve the exact response shape the legacy callers expect.
    // The neutral route's response is a superset — we keep only the
    // three fields the old clients read.
    res.status(201).json({
      clientSecret: result.clientToken,
      paymentIntentId: result.providerPaymentId,
      prospectivePaymentId: result.prospectivePaymentId,
    });
  }),
);

export default router;
