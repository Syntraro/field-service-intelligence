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

const createItemSchema = z.object({
  type: z.enum(["product", "service"]),
  name: z.string().min(1).max(255),
  sku: z.string().max(100).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  cost: z.string().or(z.number()).optional().nullable(),
  markupPercent: z.string().or(z.number()).optional().nullable(),
  unitPrice: z.string().or(z.number()).optional().nullable(),
  isTaxable: z.boolean().optional().default(true),
  taxCode: z.string().max(50).optional().nullable(),
  category: z.string().max(100).optional().nullable(),
  isActive: z.boolean().optional().default(true),
  estimatedDurationMinutes: z.number().int().min(0).optional().nullable(),
  trackInventory: z.boolean().optional().default(false),
}).strict();

const updateItemSchema = createItemSchema.partial().strict();

// 2026-04-08: P5 — bulk delete schema. Implements the previously-missing
// POST /api/items/bulk-delete that the client was calling 404.
const bulkDeleteItemsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
}).strict();

// Convert numeric fields to strings for DB storage
function toDbNumericString(value: string | number | null | undefined): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  return String(value);
}

// ========================================
// ROUTES
// ========================================

// GET /api/items - List items with optional search
router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) throw createError(401, "Unauthorized");

  const { params, explicit } = parsePaginationLenient(req.query);
  const q = String((req.query as any)?.q ?? "").trim();

  const allRows = await storage.getItems(companyId, q || undefined);

  const offset = params.offset ?? 0;
  const { items, meta } = applyOffsetPagination(allRows ?? [], offset, params.limit);

  res.json(paginatedCompat(items, meta, explicit));
}));

// POST /api/items - Create new item
router.post("/", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const userId = req.user?.id;
  if (!companyId || !userId) throw createError(401, "Unauthorized");

  const validated = validateSchema(createItemSchema, req.body);
  const created = await storage.createItem(companyId, userId, {
    ...validated,
    cost: toDbNumericString(validated.cost),
    markupPercent: toDbNumericString(validated.markupPercent),
    unitPrice: toDbNumericString(validated.unitPrice),
  });

  res.json(created);
}));

// PUT /api/items/:id - Update item
router.put("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) throw createError(401, "Unauthorized");

  const validated = validateSchema(updateItemSchema, req.body);
  const updated = await storage.updateItem(companyId, req.params.id, {
    ...validated,
    cost: toDbNumericString(validated.cost),
    markupPercent: toDbNumericString(validated.markupPercent),
    unitPrice: toDbNumericString(validated.unitPrice),
  });

  res.json(updated);
}));

// DELETE /api/items/:id - Delete item
router.delete("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) throw createError(401, "Unauthorized");

  const result = await storage.deleteItem(companyId, req.params.id);
  res.json(result);
}));

// POST /api/items/bulk-delete - Soft-delete multiple items in one request
// 2026-04-08: P5 — implements the previously-missing endpoint that
// useProductsServices.bulkDeleteMutation was calling 404.
router.post("/bulk-delete", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) throw createError(401, "Unauthorized");

  const { ids } = validateSchema(bulkDeleteItemsSchema, req.body);

  // Per-id soft delete via canonical itemRepository.deleteItem path.
  // Counts successes; partial failures do not abort the batch.
  let deletedCount = 0;
  for (const id of ids) {
    try {
      const result = await storage.deleteItem(companyId, id);
      if (result.success) deletedCount++;
    } catch {
      // Skip failed deletes; client surfaces success count.
    }
  }

  res.json({ deletedCount });
}));

export default router;
