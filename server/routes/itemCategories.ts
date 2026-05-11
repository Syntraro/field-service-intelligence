/**
 * Item Categories API — mounted at /api/item-categories.
 *
 * GET  /api/item-categories       — list all for tenant + counts + uncategorizedCount
 * POST /api/item-categories       — create user category (MANAGER + pricing.edit)
 * PATCH /api/item-categories/:id  — rename + propagate to items (MANAGER + pricing.edit)
 * DELETE /api/item-categories/:id — delete + null affected items (MANAGER + pricing.edit)
 *
 * "Uncategorized" is NOT a stored category; it is derived from null item.category.
 * The GET response includes `uncategorizedCount` for the UI to display the pseudo-row.
 */
import { Router, type Response } from "express";
import { z } from "zod";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { requireRole } from "../auth/requireRole";
import { requirePermission } from "../permissions";
import { MANAGER_ROLES } from "../auth/roles";
import {
  listCategoriesWithCounts,
  createCategory,
  renameCategory,
  deleteCategory,
} from "../storage/itemCategories";

const router = Router();

const categoryNameSchema = z.object({
  name: z.string().min(1).max(100).trim(),
});

// GET /api/item-categories
// Open read — category names are shared across the tenant for filtering.
router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");

    const result = await listCategoriesWithCounts(companyId);
    res.json(result);
  }),
);

// POST /api/item-categories
router.post(
  "/",
  requireRole(MANAGER_ROLES),
  requirePermission("pricing.edit"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");

    const { name } = validateSchema(categoryNameSchema, req.body);

    try {
      const created = await createCategory(companyId, name);
      res.status(201).json(created);
    } catch (err: any) {
      if (err?.code === "CATEGORY_NAME_CONFLICT") throw createError(409, err.message);
      throw err;
    }
  }),
);

// PATCH /api/item-categories/:id
router.patch(
  "/:id",
  requireRole(MANAGER_ROLES),
  requirePermission("pricing.edit"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");

    const { name } = validateSchema(categoryNameSchema, req.body);

    try {
      const updated = await renameCategory(companyId, req.params.id, name);
      res.json(updated);
    } catch (err: any) {
      if (err?.code === "NOT_FOUND") throw createError(404, err.message);
      if (err?.code === "CATEGORY_NAME_CONFLICT") throw createError(409, err.message);
      throw err;
    }
  }),
);

// DELETE /api/item-categories/:id
router.delete(
  "/:id",
  requireRole(MANAGER_ROLES),
  requirePermission("pricing.edit"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");

    try {
      await deleteCategory(companyId, req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      if (err?.code === "NOT_FOUND") throw createError(404, err.message);
      throw err;
    }
  }),
);

export default router;
