import { Router, Response } from "express";
import { z } from "zod";
import { storage } from "../storage/index";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { parsePaginationLenient, applyOffsetPagination } from "../utils/pagination";
import { paginatedCompat } from "../utils/paginatedResponse";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";

const router = Router();

// ========================================
// VALIDATION SCHEMAS
// ========================================

const createPartSchema = z.object({
  partNumber: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  unitPrice: z.number().min(0).max(999999.99).optional(),
  quantityOnHand: z.number().int().min(0).optional().default(0),
  reorderPoint: z.number().int().min(0).optional(),
  preferredVendor: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
}).strict();

const updatePartSchema = createPartSchema.partial().strict();

// ========================================
// ROUTES
// ========================================

// GET /api/parts - List parts with optional search
router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) throw createError(401, "Unauthorized");

  const { params, explicit } = parsePaginationLenient(req.query);
  const q = String((req.query as any)?.q ?? "").trim();

  // Fetch all matching rows (storage already orders by partNumber)
  const allRows = await storage.getParts(companyId, q || undefined);

  // Apply pagination
  const offset = params.offset ?? 0;
  const { items, meta } = applyOffsetPagination(allRows ?? [], offset, params.limit);

  res.json(paginatedCompat(items, meta, explicit));
}));

// POST /api/parts - Create new part
router.post("/", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) throw createError(401, "Unauthorized");

  const validated = validateSchema(createPartSchema, req.body);
  const created = await storage.createPart(companyId, validated);

  res.json(created);
}));

// PUT /api/parts/:id - Update part
router.put("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) throw createError(401, "Unauthorized");

  const validated = validateSchema(updatePartSchema, req.body);
  const updated = await storage.updatePart(companyId, req.params.id, validated);

  res.json(updated);
}));

// DELETE /api/parts/:id - Delete part
router.delete("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) throw createError(401, "Unauthorized");

  const result = await storage.deletePart(companyId, req.params.id);
  res.json(result);
}));

export default router;
