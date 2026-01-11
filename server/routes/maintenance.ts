import { Router } from "express";
import type { Request, Response } from "express";
import { storage } from "../storage/index";
import { parsePaginationLenient, applyOffsetPagination, MAX_LIMIT } from "../utils/pagination";
import { paginatedCompat } from "../utils/paginatedResponse";
import { asyncHandler, createError } from "../middleware/errorHandler";

// Note: requireAuth and ensureTenantContext middleware already applied globally in routes/index.ts
const router = Router();

// Note: This file only has GET routes, no POST/PUT/PATCH
// No validation needed for GET routes

router.get("/recently-completed", asyncHandler(async (req: Request, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) throw createError(401, "Unauthorized");

  const { params, explicit } = parsePaginationLenient(req.query);

  // Fetch with a bounded limit from storage (use params.limit capped by MAX_LIMIT)
  const rows = await storage.getMaintenanceRecentlyCompleted(companyId, MAX_LIMIT);

  // Apply pagination
  const offset = params.offset ?? 0;
  const { items, meta } = applyOffsetPagination(rows, offset, params.limit);

  res.json(paginatedCompat(items, meta, explicit));
}));

router.get("/statuses", asyncHandler(async (req: Request, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) throw createError(401, "Unauthorized");

  const { params, explicit } = parsePaginationLenient(req.query);

  const rows = await storage.getMaintenanceStatuses(companyId);

  // Apply pagination (statuses are typically small, but we bound them for consistency)
  const offset = params.offset ?? 0;
  const { items, meta } = applyOffsetPagination(rows, offset, params.limit);

  res.json(paginatedCompat(items, meta, explicit));
}));

export default router;
