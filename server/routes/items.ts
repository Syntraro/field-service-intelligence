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
}).strict();

const updateItemSchema = createItemSchema.partial().strict();

// ========================================
// ROUTES
// ========================================

// GET /api/items - List items with optional search
router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) throw createError(401, "Unauthorized");

  const { params, explicit } = parsePaginationLenient(req.query);
  const q = String((req.query as any)?.q ?? "").trim();

  // Fetch all matching rows (storage already orders by name)
  const allRows = await storage.getItems(companyId, q || undefined);
  console.log("[ITEMS] getItems returned", allRows?.length ?? 0, "rows for company", companyId);

  // Apply pagination
  const offset = params.offset ?? 0;
  const { items, meta } = applyOffsetPagination(allRows ?? [], offset, params.limit);

  const result = paginatedCompat(items, meta, explicit);
  console.log("[ITEMS] Returning response, explicit:", explicit, "structure:", Array.isArray(result) ? "array" : "object", "count:", items.length);
  res.json(result);
}));

// POST /api/items - Create new item
router.post("/", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  console.log("========== CREATE ITEM REQUEST ==========");
  console.log("companyId:", req.companyId);
  console.log("userId:", req.user?.id);
  console.log("body:", req.body);

  const companyId = req.companyId;
  const userId = req.user?.id;

  if (!companyId) {
    console.error("ERROR: Missing companyId");
    throw createError(401, "Unauthorized");
  }
  if (!userId) {
    console.error("ERROR: Missing userId");
    throw createError(401, "User ID required");
  }

  try {
    const validated = validateSchema(createItemSchema, req.body);
    console.log("Validated:", validated);

    console.log("Calling storage.createItem with:", { companyId, userId });
    const created = await storage.createItem(companyId, userId, validated);
    console.log("SUCCESS: Item created:", created.id);

    res.json(created);
  } catch (error: any) {
    console.error("========== CREATE ITEM ERROR ==========");
    console.error("Type:", error.constructor.name);
    console.error("Message:", error.message);
    console.error("Code:", error.code);
    console.error("Detail:", error.detail);
    console.error("Stack:", error.stack);
    throw error;
  }
}));

// PUT /api/items/:id - Update item
router.put("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) throw createError(401, "Unauthorized");

  const validated = validateSchema(updateItemSchema, req.body);
  const updated = await storage.updateItem(companyId, req.params.id, validated);

  res.json(updated);
}));

// DELETE /api/items/:id - Delete item
router.delete("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) throw createError(401, "Unauthorized");

  const result = await storage.deleteItem(companyId, req.params.id);
  res.json(result);
}));

export default router;
