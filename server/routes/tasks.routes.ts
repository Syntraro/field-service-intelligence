import { Router, Response } from "express";
import * as service from "../services/tasks.service.ts";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { parsePaginationLenient } from "../utils/pagination";
import { paginatedCompat } from "../utils/paginatedResponse";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";

const router = Router();

// ========================================
// VALIDATION SCHEMAS
// ========================================

const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(), // Primary field for task notes
  description: z.string().max(2000).optional(), // Backwards compatibility alias for notes
  dueDate: z.string().datetime().optional(),
  assignedToUserId: z.string().uuid().optional(),
  type: z.string().max(50).optional(),
  jobId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  estimatedDurationMinutes: z.number().int().positive().optional(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional().default("pending"),
  scheduledStartAt: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() !== '' ? val : undefined),
    z.string().datetime().optional()
  ),
  scheduledEndAt: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() !== '' ? val : undefined),
    z.string().datetime().optional()
  ),
  allDay: z.boolean().optional(),
}).strict();

const assignTaskSchema = z.object({
  assignedToUserId: z.string().uuid().nullable(),
}).strict();

const closeTaskSchema = z.object({
  userId: z.string().uuid(),
}).strict();

const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).nullable().optional(), // Primary field for task notes
  description: z.string().max(2000).nullable().optional(), // Backwards compatibility alias for notes
  dueDate: z.string().datetime().nullable().optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
  type: z.string().max(50).optional(),
  jobId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  estimatedDurationMinutes: z.number().int().positive().nullable().optional(),
  scheduledStartAt: z.preprocess(
    (val) => (val === null || (typeof val === 'string' && val.trim() === '') ? undefined : val),
    z.string().datetime().optional()
  ),
  scheduledEndAt: z.preprocess(
    (val) => (val === null || (typeof val === 'string' && val.trim() === '') ? undefined : val),
    z.string().datetime().optional()
  ),
  allDay: z.boolean().optional(),
}).strict();

const updateSupplierVisitSchema = z.object({
  supplierId: z.string().uuid().nullable().optional(),
  supplierLocationId: z.string().uuid().nullable().optional(),
  supplierNameOther: z.string().max(200).nullable().optional(),
  poNumber: z.string().max(100).nullable().optional(),
  reconciledByUserId: z.string().uuid().optional(),
  reconcile: z.boolean().optional(),
}).strict();

// ========================================
// ROUTES
// ========================================

/* CREATE */
router.post("/", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;

  const validated = validateSchema(createTaskSchema, req.body);

  if (!req.user?.id) {
    throw createError(401, "Not authenticated");
  }

  const task = await service.createTask(companyId, {
    ...validated,
    createdByUserId: req.user.id,
    // Use notes if provided, otherwise fall back to description for backwards compatibility
    notes: validated.notes ?? (validated as any).description ?? undefined,
    clientId: validated.clientId ?? undefined,
    estimatedDurationMinutes: validated.estimatedDurationMinutes ?? undefined,
    scheduledStartAt: validated.scheduledStartAt ?? undefined,
    scheduledEndAt: validated.scheduledEndAt ?? undefined,
    allDay: validated.allDay ?? false,
  });

  res.json(task);
}));

/* LIST (FILTERED) - companyId from session ONLY */
router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const { params, explicit } = parsePaginationLenient(req.query);

  const offset = params.offset ?? 0;
  const limit = params.limit;

  const result = await service.listTasks({
    companyId,
    status: req.query.status as string | undefined,
    assignedToUserId: req.query.assignedToUserId as string | undefined,
    unassigned: req.query.unassigned === "true",
    type: req.query.type as string | undefined,
    jobId: req.query.jobId as string | undefined,
    fromDate: req.query.fromDate ? new Date(req.query.fromDate as string) : undefined,
    toDate: req.query.toDate ? new Date(req.query.toDate as string) : undefined,
    offset,
    limit,
  });

  const meta = {
    limit,
    hasMore: result.hasMore,
    nextOffset: result.hasMore ? offset + limit : undefined,
  };

  res.json(paginatedCompat(result.items, meta, explicit));
}));

/* GET SINGLE TASK */
router.get("/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const task = await service.getTask(companyId, req.params.id);

  if (!task) {
    throw createError(404, "Task not found");
  }

  res.json(task);
}));

/* ASSIGN / UNASSIGN */
router.post("/:id/assign", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;

  const validated = validateSchema(assignTaskSchema, req.body);
  const task = await service.assignTask(companyId, req.params.id, validated.assignedToUserId ?? null);

  res.json(task);
}));

/* CHECK-IN */
router.post("/:id/check-in", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const task = await service.checkInTask(companyId, req.params.id);

  res.json(task);
}));

/* CHECK-OUT */
router.post("/:id/check-out", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const task = await service.checkOutTask(companyId, req.params.id);

  res.json(task);
}));

/* CLOSE */
router.post("/:id/close", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;

  const validated = validateSchema(closeTaskSchema, req.body);
  const task = await service.closeTask(companyId, req.params.id, validated.userId);

  res.json(task);
}));

/* REOPEN */
router.post("/:id/reopen", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const task = await service.reopenTask(companyId, req.params.id);

  res.json(task);
}));

/* DELETE */
router.delete("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const result = await service.deleteTask(companyId, req.params.id);

  res.json(result);
}));

/* ADMIN UPDATE */
router.patch("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;

  const validated = validateSchema(updateTaskSchema, req.body);

  // Map description to notes for backwards compatibility
  const updates: any = { ...validated };
  if ('description' in validated && !('notes' in validated)) {
    // Only use description as fallback if notes not provided
    updates.notes = (validated as any).description;
  }
  delete updates.description; // Remove description field, we only use notes in service

  const task = await service.updateTask(companyId, req.params.id, updates);

  res.json(task);
}));

/* GET SUPPLIER VISIT DETAILS */
router.get("/:id/supplier-visit", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const taskId = req.params.id;

  // Verify task belongs to company
  const task = await service.getTask(companyId, taskId);
  if (!task) {
    throw createError(404, "Task not found");
  }

  // Get supplier visit details
  const supplierVisit = await service.getSupplierVisitDetails(taskId);

  res.json(supplierVisit || {});
}));

/* SUPPLIER VISIT UPDATE (OFFICE) */
router.patch("/:id/supplier-visit", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;

  const validated = validateSchema(updateSupplierVisitSchema, req.body);
  const result = await service.updateSupplierVisit(companyId, req.params.id, validated);

  res.json(result);
}));

export default router;
