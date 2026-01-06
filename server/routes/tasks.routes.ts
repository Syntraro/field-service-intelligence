import { Router } from "express";
import type { Request, Response } from "express";
import * as service from "../services/tasks.service.ts";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { parsePaginationLenient } from "../utils/pagination";
import { paginatedCompat } from "../utils/paginatedResponse";

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
});

const closeTaskSchema = z.object({
  userId: z.string().uuid(),
});

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

/* CREATE */
router.post("/", requireRole(MANAGER_ROLES), async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId!; // Derived from session, NOT from body/query
    
    const validation = createTaskSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }

    const task = await service.createTask(companyId, validation.data);
    res.json(task);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* LIST (FILTERED) - companyId from session ONLY */
router.get("/", async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId!; // CRITICAL: Derived from session, NOT query params
    const { params, explicit } = parsePaginationLenient(req.query);
    
    // Use clamped values for pagination
    const offset = params.offset ?? 0;
    const limit = params.limit; // Already clamped by parsePaginationLenient (default 50, max 200)
    
    // Pass tenant-safe filters to service (no companyId from query allowed)
    const result = await service.listTasks({
      companyId, // From session only
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
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* GET SINGLE TASK */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId!;
    const task = await service.getTask(companyId, req.params.id);
    
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }
    
    res.json(task);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* ASSIGN / UNASSIGN */
router.post("/:id/assign", requireRole(MANAGER_ROLES), async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId!;
    
    const validation = assignTaskSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }

    const task = await service.assignTask(companyId, req.params.id, validation.data.assignedToUserId ?? null);
    res.json(task);
  } catch (e: any) {
    if (e.message.includes("not found")) {
      return res.status(404).json({ error: e.message });
    }
    res.status(400).json({ error: e.message });
  }
});

/* CHECK-IN */
router.post("/:id/check-in", requireRole(MANAGER_ROLES), async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId!;
    const task = await service.checkInTask(companyId, req.params.id);
    res.json(task);
  } catch (e: any) {
    if (e.message.includes("not found")) {
      return res.status(404).json({ error: e.message });
    }
    res.status(400).json({ error: e.message });
  }
});

/* CHECK-OUT */
router.post("/:id/check-out", requireRole(MANAGER_ROLES), async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId!;
    const task = await service.checkOutTask(companyId, req.params.id);
    res.json(task);
  } catch (e: any) {
    if (e.message.includes("not found")) {
      return res.status(404).json({ error: e.message });
    }
    res.status(400).json({ error: e.message });
  }
});

/* CLOSE */
router.post("/:id/close", requireRole(MANAGER_ROLES), async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId!;
    
    const validation = closeTaskSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }

    const task = await service.closeTask(companyId, req.params.id, validation.data.userId);
    res.json(task);
  } catch (e: any) {
    if (e.message.includes("not found")) {
      return res.status(404).json({ error: e.message });
    }
    res.status(400).json({ error: e.message });
  }
});

/* ADMIN UPDATE */
router.patch("/:id", requireRole(MANAGER_ROLES), async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId!;
    
    const validation = updateTaskSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }

    const task = await service.updateTask(companyId, req.params.id, validation.data);
    res.json(task);
  } catch (e: any) {
    if (e.message.includes("not found")) {
      return res.status(404).json({ error: e.message });
    }
    res.status(400).json({ error: e.message });
  }
});

/* SUPPLIER VISIT UPDATE (OFFICE) */
router.patch("/:id/supplier-visit", requireRole(MANAGER_ROLES), async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId!;
    
    const validation = updateSupplierVisitSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }

    const result = await service.updateSupplierVisit(companyId, req.params.id, validation.data);
    res.json(result);
  } catch (e: any) {
    if (e.message.includes("not found")) {
      return res.status(404).json({ error: e.message });
    }
    res.status(400).json({ error: e.message });
  }
});

export default router;
