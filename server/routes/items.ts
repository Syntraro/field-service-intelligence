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
//
// 2026-04-19: routes through the canonical `createOrGetItem` so concurrent
// tabs / repeat submits can't produce twin rows.
// 2026-04-29: Dedupe is now TYPE-AGNOSTIC — natural key is
// (companyId, lower(trim(name))). A Product "Thermostat" and a Service
// "Thermostat" can no longer coexist; the storage layer returns the
// existing row with `_matched: true` flagged on the response body so the
// client can show "Reusing existing item" instead of "Created". HTTP
// status is also differentiated: 200 OK when matched, 201 Created when
// genuinely inserted. Soft-deleted matches are reactivated rather than
// re-inserted. The matching unique index lives in
// `2026_04_29_items_unique_name_company_active.sql` (replaces the
// type-scoped index from 2026_04_19).
router.post("/", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const userId = req.user?.id;
  if (!companyId || !userId) throw createError(401, "Unauthorized");

  const validated = validateSchema(createItemSchema, req.body);
  const result = await storage.createOrGetItem(companyId, userId, {
    ...validated,
    cost: toDbNumericString(validated.cost),
    markupPercent: toDbNumericString(validated.markupPercent),
    unitPrice: toDbNumericString(validated.unitPrice),
  });

  const matched = (result as any)._matched === true;
  res.status(matched ? 200 : 201).json(result);
}));

// PUT /api/items/:id - Update item
//
// 2026-04-29: Renames are validated against the type-agnostic uniqueness
// rule. If the new name collides with another active item in the tenant
// (regardless of type), the storage layer throws `ITEM_NAME_CONFLICT`
// which we translate to a clean 409. The DB unique index is the final
// safety net but won't be reached.
router.put("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) throw createError(401, "Unauthorized");

  const validated = validateSchema(updateItemSchema, req.body);
  try {
    const updated = await storage.updateItem(companyId, req.params.id, {
      ...validated,
      cost: toDbNumericString(validated.cost),
      markupPercent: toDbNumericString(validated.markupPercent),
      unitPrice: toDbNumericString(validated.unitPrice),
    });
    res.json(updated);
  } catch (err: any) {
    if (err?.code === "ITEM_NAME_CONFLICT") {
      throw createError(409, err.message);
    }
    throw err;
  }
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
