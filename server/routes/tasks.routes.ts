import { Router } from "express";
import * as service from "../services/tasks.service.ts";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";

const router = Router();

const MANAGER_ROLES = ["owner", "admin", "manager", "dispatcher"];

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
}).passthrough(); // Allow other fields the service might expect

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
}).passthrough();

const updateSupplierVisitSchema = z.object({
  supplierName: z.string().max(200).optional(),
  visitDate: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
}).passthrough();

/* CREATE */
router.post("/", requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    const validation = createTaskSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }

    res.json(await service.createTask(validation.data));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* LIST (FILTERED) */
router.get("/", async (req, res) => {
  try {
    res.json(
      await service.listTasks({
        companyId: req.query.companyId,
        status: req.query.status,
        assignedToUserId: req.query.assignedToUserId,
        unassigned: req.query.unassigned === "true",
        type: req.query.type,
        jobId: req.query.jobId,
        fromDate: req.query.fromDate ? new Date(req.query.fromDate as string) : undefined,
        toDate: req.query.toDate ? new Date(req.query.toDate as string) : undefined,
      })
    );
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* ASSIGN / UNASSIGN */
router.post("/:id/assign", requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    const validation = assignTaskSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }

    res.json(await service.assignTask(req.params.id, validation.data.assignedToUserId ?? null));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* CHECK-IN */
router.post("/:id/check-in", requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    res.json(await service.checkInTask(req.params.id));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* CHECK-OUT */
router.post("/:id/check-out", requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    res.json(await service.checkOutTask(req.params.id));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* CLOSE */
router.post("/:id/close", requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    const validation = closeTaskSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }

    res.json(await service.closeTask(req.params.id, validation.data.userId));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* ADMIN UPDATE */
router.patch("/:id", requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    const validation = updateTaskSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }

    res.json(await service.updateTask(req.params.id, validation.data));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* SUPPLIER VISIT UPDATE (OFFICE) */
router.patch("/:id/supplier-visit", requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    const validation = updateSupplierVisitSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }

    res.json(await service.updateSupplierVisit(req.params.id, validation.data));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

export default router;