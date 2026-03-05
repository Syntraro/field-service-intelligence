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
import { logEventAsync } from "../lib/events";
import { getQueryCtx } from "../lib/queryCtx";
import { IS_DEV } from "../utils/devFlags";

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

  if (IS_DEV) console.log("[TASKS_DIAG] POST /api/tasks body:", JSON.stringify(req.body));
  const validated = validateSchema(createTaskSchema, req.body);

  if (!req.user?.id) {
    throw createError(401, "Not authenticated");
  }

  try {
    const task = await service.createTask(companyId, {
      title: validated.title,
      type: validated.type || "GENERAL",
      status: validated.status,
      createdByUserId: req.user.id,
      assignedToUserId: validated.assignedToUserId,
      notes: validated.notes ?? (validated as any).description ?? undefined,
      clientId: validated.clientId ?? undefined,
      jobId: validated.jobId,
      estimatedDurationMinutes: validated.estimatedDurationMinutes ?? undefined,
      scheduledStartAt: (validated.scheduledStartAt && typeof validated.scheduledStartAt === 'string') ? validated.scheduledStartAt : undefined,
      scheduledEndAt: (validated.scheduledEndAt && typeof validated.scheduledEndAt === 'string') ? validated.scheduledEndAt : undefined,
      allDay: validated.allDay ?? false,
    });

    if (IS_DEV) console.log("[TASKS_DIAG] POST /api/tasks created:", { id: task.id, type: task.type });
    res.json(task);
  } catch (error: any) {
    if (error.statusCode || error.status) throw error;
    const msg = error?.message || "";
    if (msg.includes("violates foreign key constraint") || error?.code === "23503") {
      throw createError(400, "A referenced record (job, technician, or client) does not exist.");
    }
    console.error("[TASKS] create failed:", { error: msg, code: error?.code });
    throw createError(500, "Failed to create task. Please try again.");
  }
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
    // Calendar integration: filter by scheduledStartAt date range
    scheduledFromDate: req.query.scheduledFromDate ? new Date(req.query.scheduledFromDate as string) : undefined,
    scheduledToDate: req.query.scheduledToDate ? new Date(req.query.scheduledToDate as string) : undefined,
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

  // Phase 4B.1: Emit task.completed milestone event
  const ctx = getQueryCtx(req);
  logEventAsync(ctx, {
    eventType: "task.completed",
    entityType: "task",
    entityId: req.params.id,
    summary: `Task completed: ${(task as any).title || req.params.id}`,
    meta: { taskId: req.params.id, closedBy: validated.userId },
  });

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

  if (IS_DEV) console.log("[TASKS_DIAG] PATCH /api/tasks/" + req.params.id + " body:", JSON.stringify(req.body));
  const validated = validateSchema(updateTaskSchema, req.body);

  // Map description to notes for backwards compatibility
  const updates: any = { ...validated };
  if ('description' in validated && !('notes' in validated)) {
    updates.notes = (validated as any).description;
  }
  delete updates.description;

  const task = await service.updateTask(companyId, req.params.id, updates);
  if (IS_DEV) console.log("[TASKS_DIAG] PATCH /api/tasks/" + req.params.id + " updated:", { id: task.id, scheduledStartAt: task.scheduledStartAt });

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
  const supplierVisit = await service.getSupplierVisitDetails(companyId, taskId);

  res.json(supplierVisit || {});
}));

/* SUPPLIER VISIT UPDATE (OFFICE) */
router.patch("/:id/supplier-visit", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const taskId = req.params.id;

  if (IS_DEV) console.log("[TASKS_DIAG] PATCH /api/tasks/" + taskId + "/supplier-visit body:", JSON.stringify(req.body));
  const validated = validateSchema(updateSupplierVisitSchema, req.body);

  try {
    const result = await service.updateSupplierVisit(companyId, taskId, validated);
    if (IS_DEV) console.log("[TASKS_DIAG] PATCH /api/tasks/" + taskId + "/supplier-visit OK:", { taskId: result.taskId, supplierId: result.supplierId });
    res.json(result);
  } catch (error: any) {
    // Re-throw known app errors (they already have statusCode)
    if (error.statusCode || error.status) throw error;

    // Convert DB constraint violations to 4xx
    const msg = error?.message || "";
    const detail = error?.detail || "";
    if (msg.includes("violates foreign key constraint") || error?.code === "23503") {
      const hint = detail.includes("supplier_id")
        ? "The selected supplier does not exist."
        : detail.includes("supplier_location_id")
        ? "The selected supplier location does not exist."
        : "A referenced record does not exist.";
      throw createError(400, hint);
    }
    if (msg.includes("violates unique constraint") || error?.code === "23505") {
      throw createError(409, "Supplier visit details already exist for this task.");
    }

    // Unknown DB error — log and return safe message
    console.error("[TASKS] supplier-visit update failed:", { taskId, error: msg, code: error?.code, detail });
    throw createError(500, "Failed to save supplier visit details. Please try again.");
  }
}));

export default router;
