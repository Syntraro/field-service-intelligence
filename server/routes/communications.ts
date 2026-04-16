/**
 * Communications — cross-entity read endpoints (Phase 15, 2026-04-12).
 *
 * Currently exposes delivery history for invoices / quotes / jobs via a
 * single shared endpoint. Future write endpoints (Phase 17 resend) will
 * live in the same router.
 */

import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { RESTRICTED_MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import { emailDeliveryTrackingService } from "../services/emailDeliveryTrackingService";
import { communicationTemplateEntityTypeEnum } from "@shared/schema";

const router = Router();

const listQuerySchema = z.object({
  entityType: z.enum(communicationTemplateEntityTypeEnum),
  entityId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/**
 * GET /api/communications/deliveries?entityType=...&entityId=...
 * Returns delivery history for a given entity (newest first).
 */
router.get(
  "/deliveries",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId;
    if (!tenantId) throw createError(401, "Unauthorized");
    const { entityType, entityId, limit } = validateSchema(listQuerySchema, req.query);
    const deliveries = await emailDeliveryTrackingService.getEntityDeliveries({
      tenantId,
      entityType,
      entityId,
      limit,
    });
    res.json(deliveries);
  }),
);

/**
 * POST /api/communications/deliveries/:deliveryId/resend
 * Phase 17 — one-time resend for a failed/bounced delivery. Creates a
 * NEW delivery row, links it to the original via retried_from_delivery_id,
 * and increments the original's resend_count. Policy enforced in
 * `emailDeliveryTrackingService.resendDelivery`.
 */
router.post(
  "/deliveries/:deliveryId/resend",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId;
    if (!tenantId) throw createError(401, "Unauthorized");
    const result = await emailDeliveryTrackingService.resendDelivery({
      tenantId,
      deliveryId: req.params.deliveryId,
      userId: req.user?.id ?? null,
    });
    res.json(result);
  }),
);

export default router;
