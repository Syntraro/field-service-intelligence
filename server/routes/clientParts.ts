import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import { storage } from "../storage/index";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";
import { db } from "../db";
import { clientLocations, items } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

const router = Router();

// ========================================
// VALIDATION SCHEMAS
// ========================================

/**
 * PHASE A.1: Strict schema with explicit allowlist
 * Only clientId, partId, and quantity are allowed - all other fields rejected
 */
const clientPartItemSchema = z.object({
  clientId: z.string().uuid(),
  partId: z.string().uuid(),
  quantity: z.number().int().min(0).optional().default(1),
}).strict(); // Reject unknown keys

const bulkClientPartsSchema = z.union([
  z.array(clientPartItemSchema).max(1000), // Direct array
  z.object({ items: z.array(clientPartItemSchema).max(1000) }).strict(), // Wrapped in { items: [] }
]);

// ========================================
// ROUTES
// ========================================

/**
 * POST /api/client-parts/bulk
 * Bulk upsert client parts
 *
 * PHASE A SECURITY FIX: Validates that all referenced clientIds and partIds
 * belong to the authenticated company before processing. Prevents cross-tenant
 * data manipulation via IDOR (Insecure Direct Object Reference) attacks.
 */
router.post("/bulk", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const userId = req.user?.id;
  if (!companyId || !userId) throw createError(401, "Unauthorized");

  const validation = bulkClientPartsSchema.safeParse(req.body);
  if (!validation.success) {
    throw createError(400, `Validation failed: ${validation.error.errors.map(e => e.message).join(", ")}`);
  }

  const itemsList = Array.isArray(validation.data) ? validation.data : validation.data.items;

  // PHASE A FIX: Extract unique IDs and validate ownership
  const uniqueClientIds = Array.from(new Set(itemsList.map(i => i.clientId)));
  const uniquePartIds = Array.from(new Set(itemsList.map(i => i.partId)));

  // Validate all clientIds belong to this company
  if (uniqueClientIds.length > 0) {
    const validClients = await db
      .select({ id: clientLocations.id })
      .from(clientLocations)
      .where(
        and(
          eq(clientLocations.companyId, companyId),
          sql`${clientLocations.id} = ANY(${uniqueClientIds})`
        )
      );
    const validClientIdSet = new Set(validClients.map(c => c.id));
    const invalidClientIds = uniqueClientIds.filter(id => !validClientIdSet.has(id));

    if (invalidClientIds.length > 0) {
      throw createError(400, `Invalid or unauthorized client IDs: ${invalidClientIds.slice(0, 5).join(", ")}${invalidClientIds.length > 5 ? "..." : ""}`);
    }
  }

  // Validate all partIds belong to this company
  if (uniquePartIds.length > 0) {
    const validParts = await db
      .select({ id: items.id })
      .from(items)
      .where(
        and(
          eq(items.companyId, companyId),
          sql`${items.id} = ANY(${uniquePartIds})`
        )
      );
    const validPartIdSet = new Set(validParts.map(p => p.id));
    const invalidPartIds = uniquePartIds.filter(id => !validPartIdSet.has(id));

    if (invalidPartIds.length > 0) {
      throw createError(400, `Invalid or unauthorized part IDs: ${invalidPartIds.slice(0, 5).join(", ")}${invalidPartIds.length > 5 ? "..." : ""}`);
    }
  }

  const result = await storage.upsertClientPartsBulk(companyId, userId, itemsList);
  res.json(result);
}));

export default router;
