import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import { storage } from "../storage/index";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";

const router = Router();

// ========================================
// VALIDATION SCHEMAS
// ========================================

const clientPartItemSchema = z.object({
  clientId: z.string().uuid(),
  partId: z.string().uuid(),
  quantity: z.number().int().min(0).optional().default(1),
});

const bulkClientPartsSchema = z.union([
  z.array(clientPartItemSchema).max(1000), // Direct array
  z.object({ items: z.array(clientPartItemSchema).max(1000) }), // Wrapped in { items: [] }
]);

// ========================================
// ROUTES
// ========================================

// Bulk endpoint expected by frontend: POST /api/client-parts/bulk
// Note: requireAuth and ensureTenantContext middleware already applied globally in routes/index.ts
router.post("/bulk", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const userId = req.user?.id;
  if (!companyId || !userId) throw createError(401, "Unauthorized");

  const validation = bulkClientPartsSchema.safeParse(req.body);
  if (!validation.success) {
    throw createError(400, `Validation failed: ${validation.error.errors.map(e => e.message).join(", ")}`);
  }

  const items = Array.isArray(validation.data) ? validation.data : validation.data.items;
  const result = await storage.upsertClientPartsBulk(companyId, userId, items);
  res.json(result);
}));

export default router;
