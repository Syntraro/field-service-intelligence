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
  description: z.string().max(2000).optional(),
  dueDate: z.string().datetime().optional(),
  assignedToUserId: z.string().uuid().optional(),
  type: z.string().max(50).optional(),
  jobId: z.string().uuid().optional(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional().default("pending"),
}).strict();

const assignTaskSchema = z.object({
  assignedToUserId: z.string().uuid().nullable(),
}).strict();

const closeTaskSchema = z.object({
  userId: z.string().uuid(),
}).strict();

const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  dueDate: z.string().datetime().optional(),
  assignedToUserId: z.string().uuid().optional(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
  type: z.string().max(50).optional(),
}).strict();

const updateSupplierVisitSchema = z.object({
  supplierName: z.string().max(200).optional(),
  visitDate: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
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
    notes: (validated as any).description ?? undefined,
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

/* ADMIN UPDATE */
router.patch("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;

  const validated = validateSchema(updateTaskSchema, req.body);
  const task = await service.updateTask(companyId, req.params.id, validated);

  res.json(task);
}));

/* SUPPLIER VISIT UPDATE (OFFICE) */
router.patch("/:id/supplier-visit", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;

  const validated = validateSchema(updateSupplierVisitSchema, req.body);
  const result = await service.updateSupplierVisit(companyId, req.params.id, validated);

  res.json(result);
}));

export default router;
