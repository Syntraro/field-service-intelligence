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

const updatePartSchema = createPartSchema.partial().strict();

// Convert numeric fields to strings for DB storage
function toDbNumericString(value: string | number | null | undefined): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  return String(value);
}

// ========================================
// ROUTES
// ========================================

// GET /api/parts - List parts with optional search (DB-level pagination)
router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) throw createError(401, "Unauthorized");

  const { params, explicit } = parsePaginationLenient(req.query);
  const q = String((req.query as any)?.q ?? "").trim();
  const offset = params.offset ?? 0;

  // Use DB-level pagination (limit + 1 pattern for hasMore)
  const items = await storage.getParts(companyId, {
    searchQuery: q || undefined,
    limit: params.limit + 1,
    offset,
  });

  const hasMore = items.length > params.limit;
  const resultItems = hasMore ? items.slice(0, params.limit) : items;

  const meta = {
    limit: params.limit,
    hasMore,
    nextOffset: hasMore ? offset + params.limit : undefined,
  };

  res.json(paginatedCompat(resultItems, meta, explicit));
}));

// POST /api/parts - Create new part
router.post("/", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const userId = req.user?.id;
  if (!companyId || !userId) throw createError(401, "Unauthorized");

  const validated = validateSchema(createPartSchema, req.body);
  const created = await storage.createPart(companyId, userId, {
    ...validated,
    cost: toDbNumericString(validated.cost),
    markupPercent: toDbNumericString(validated.markupPercent),
    unitPrice: toDbNumericString(validated.unitPrice),
  });

  res.json(created);
}));

// PUT /api/parts/:id - Update part
router.put("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) throw createError(401, "Unauthorized");

  const validated = validateSchema(updatePartSchema, req.body);
  const updated = await storage.updatePart(companyId, req.params.id, {
    ...validated,
    cost: toDbNumericString(validated.cost),
    markupPercent: toDbNumericString(validated.markupPercent),
    unitPrice: toDbNumericString(validated.unitPrice),
  });

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
