/**
 * PM Templates CRUD API
 * Reusable job content templates for maintenance plans.
 */
import { Router, Response } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { pmTemplates, insertPmTemplateSchema, updatePmTemplateSchema } from "@shared/schema";
import { requireAuth } from "../auth/requireAuth";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";

const router = Router();

// GET /api/pm/templates — list all PM templates for the company
router.get("/", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId } = req.user!;
  const rows = await db.select().from(pmTemplates)
    .where(eq(pmTemplates.companyId, companyId))
    .orderBy(pmTemplates.name);
  res.json(rows);
}));

// POST /api/pm/templates — create a new PM template
router.post("/", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId } = req.user!;
  const data = validateSchema(insertPmTemplateSchema, req.body);
  const [row] = await db.insert(pmTemplates).values({ ...data, companyId }).returning();
  res.status(201).json(row);
}));

// PATCH /api/pm/templates/:id — update an existing PM template
router.patch("/:id", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId } = req.user!;
  const { id } = req.params;
  const data = validateSchema(updatePmTemplateSchema, req.body);

  const [existing] = await db.select({ id: pmTemplates.id }).from(pmTemplates)
    .where(and(eq(pmTemplates.id, id), eq(pmTemplates.companyId, companyId)));
  if (!existing) throw createError(404, "PM template not found");

  const [row] = await db.update(pmTemplates)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(pmTemplates.id, id), eq(pmTemplates.companyId, companyId)))
    .returning();
  res.json(row);
}));

// DELETE /api/pm/templates/:id — delete a PM template
router.delete("/:id", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId } = req.user!;
  const { id } = req.params;

  const [existing] = await db.select({ id: pmTemplates.id }).from(pmTemplates)
    .where(and(eq(pmTemplates.id, id), eq(pmTemplates.companyId, companyId)));
  if (!existing) throw createError(404, "PM template not found");

  await db.delete(pmTemplates)
    .where(and(eq(pmTemplates.id, id), eq(pmTemplates.companyId, companyId)));
  res.json({ success: true });
}));

export default router;
