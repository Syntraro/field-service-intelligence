/**
 * PM Parts Routes
 *
 * Endpoints for managing location PM part templates:
 *   GET  /api/locations/:locationId/pm-parts — list active templates (with item details)
 *   PUT  /api/locations/:locationId/pm-parts — bulk upsert (replace full set)
 *
 * Mounted at /api/locations in routes/index.ts.
 */

import { Router, Response } from "express";
import { z } from "zod";
import { pmPartRepository } from "../storage/pmParts";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";

const router = Router();

// Validation schema for bulk upsert payload
const bulkUpsertSchema = z.object({
  parts: z.array(
    z.object({
      productId: z.string().min(1),
      quantity: z.string().min(1),
    })
  ),
});

// GET /api/locations/:locationId/pm-parts — list PM part templates for a location
router.get("/:locationId/pm-parts", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) throw createError(401, "Unauthorized");

  const { locationId } = req.params;
  const parts = await pmPartRepository.getLocationPMParts(companyId, locationId);
  res.json(parts);
}));

// PUT /api/locations/:locationId/pm-parts — bulk upsert PM parts
router.put("/:locationId/pm-parts", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) throw createError(401, "Unauthorized");

  const { locationId } = req.params;
  const { parts } = validateSchema(bulkUpsertSchema, req.body);

  const updated = await pmPartRepository.bulkUpsertPMParts(companyId, locationId, parts);
  res.json(updated);
}));

export default router;
