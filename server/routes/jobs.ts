import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage } from "../storage/index";
import {
  insertJobSchema,
  updateJobSchema,
  insertRecurringJobSeriesSchema,
  insertRecurringJobPhaseSchema,
  jobStatusEnum,
} from "@shared/schema";
import { assertJobStatusTransition } from "../statusRules";
import type { JobStatus } from "../schemas";
import type { User } from "@shared/schema";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { parsePagination } from "../utils/pagination";
import { paginated } from "../utils/paginatedResponse";

const router = Router();



/**
 * ----------------------------
 * Jobs CRUD
 * ----------------------------
 */

router.get("/", async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId;

    const pagination = parsePagination(req.query);

    const status = req.query.status ? String(req.query.status) : undefined;
    const technicianId = req.query.technicianId ? String(req.query.technicianId) : undefined;
    const search = req.query.search ? String(req.query.search) : undefined;

    const result = await storage.getJobs(companyId, {
      status,
      technicianId,
      search,
    }, pagination);

    res.json(paginated(result.items, result.meta));
  } catch (error: any) {
    if (error.status === 400) {
      return res.status(400).json({ error: error.message });
    }
    console.error("Get jobs error:", error);
    res.status(500).json({ error: error.message || "Failed to get jobs" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId;

    const job = await storage.getJob(companyId, req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });

    // Optional: include location details if your storage supports it
    // (keeps current behavior if storage already hydrates job details).
    res.json(job);
  } catch (error: any) {
    console.error("Get job error:", error);
    res.status(500).json({ error: error.message || "Failed to get job" });
  }
});

router.post("/", requireRole(MANAGER_ROLES), async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId;

    const parsed = insertJobSchema.parse(req.body);
    const job = await storage.createJob(companyId, parsed);
    res.status(201).json(job);
  } catch (error: any) {
    console.error("Create job error:", error);
    if (error?.name === "ZodError") {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    res.status(500).json({ error: error.message || "Failed to create job" });
  }
});

router.patch("/:id", requireRole(MANAGER_ROLES), async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId;

    // Extract version from body before validation
    const { version, ...data } = req.body;
    const parsed = updateJobSchema.parse(data);
    
    // Pass version to storage (can be undefined)
    const updated = await storage.updateJob(companyId, req.params.id, version, parsed);
    
    if (!updated) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.json(updated);
  } catch (error: any) {
    console.error("Update job error:", error);
    
    // Check for version mismatch
    if (error.message?.includes('modified by another user')) {
      return res.status(409).json({ 
        error: error.message,
        code: 'VERSION_MISMATCH'
      });
    }
    
    if (error?.name === "ZodError") {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    
    res.status(500).json({ error: error.message || "Failed to update job" });
  }
});

router.delete("/:id", requireRole(MANAGER_ROLES), async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId;

    const deleted = await storage.deleteJob(companyId, req.params.id);
    if (!deleted) return res.status(404).json({ error: "Job not found" });

    res.json({ success: true });
  } catch (error: any) {
    console.error("Delete job error:", error);
    res.status(500).json({ error: error.message || "Failed to delete job" });
  }
});

/**
 * ----------------------------
 * Status transitions
 * ----------------------------
 */

const statusUpdateSchema = z.object({
  status: jobStatusEnum,
});

router.post("/:id/status", requireRole(MANAGER_ROLES), async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId;

    const { status } = statusUpdateSchema.parse(req.body);

    const existing = await storage.getJob(companyId, req.params.id);
    if (!existing) return res.status(404).json({ error: "Job not found" });

    assertJobStatusTransition(existing.status as JobStatus, status as JobStatus);

    // Use undefined for version to maintain backward compatibility
    const updated = await storage.updateJob(companyId, req.params.id, undefined, { status });
    if (!updated) return res.status(404).json({ error: "Job not found" });

    res.json(updated);
  } catch (error: any) {
    console.error("Update job status error:", error);
    if (error?.name === "ZodError") {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    res.status(500).json({ error: error.message || "Failed to update job status" });
  }
});

/**
 * ----------------------------
 * Job Parts (tenant-safe calls)
 * ----------------------------
 */

router.get("/:jobId/parts", async (req, res) => {
  try {
    const companyId = req.companyId;

    const job = await storage.getJob(companyId, req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const parts = await storage.getJobParts(req.params.jobId);
    res.json(parts);
  } catch (error: any) {
    console.error("Get job parts error:", error);
    res.status(500).json({ error: error.message || "Failed to get job parts" });
  }
});

router.post("/:jobId/parts", requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    const companyId = req.companyId;

    const job = await storage.getJob(companyId, req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    if (!req.body.description || !req.body.quantity) {
      return res.status(400).json({ error: "description and quantity are required" });
    }

    const jobPart = await storage.createJobPart(companyId, req.params.jobId, {
      ...req.body,
      jobId: req.params.jobId,
    });

    res.status(201).json(jobPart);
  } catch (error: any) {
    console.error("Create job part error:", error);
    res.status(500).json({ error: error.message || "Failed to create job part" });
  }
});

router.put("/:jobId/parts/:id", requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    const companyId = req.companyId;

    const job = await storage.getJob(companyId, req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const jobPart = await storage.updateJobPart(companyId, req.params.id, req.body);
    if (!jobPart) return res.status(404).json({ error: "Job part not found" });

    res.json(jobPart);
  } catch (error: any) {
    console.error("Update job part error:", error);
    res.status(500).json({ error: error.message || "Failed to update job part" });
  }
});

router.delete("/:jobId/parts/:id", requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    const companyId = req.companyId;

    const job = await storage.getJob(companyId, req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const deleted = await storage.deleteJobPart(companyId, req.params.id);
    if (!deleted) return res.status(404).json({ error: "Job part not found" });

    res.json({ success: true });
  } catch (error: any) {
    console.error("Delete job part error:", error);
    res.status(500).json({ error: error.message || "Failed to delete job part" });
  }
});

router.patch("/:jobId/parts/reorder", requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    const companyId = req.companyId;

    const job = await storage.getJob(companyId, req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const { parts } = req.body;
    if (!Array.isArray(parts)) {
      return res.status(400).json({ error: "parts array is required" });
    }

    await storage.reorderJobParts(req.params.jobId, parts);
    res.json({ success: true });
  } catch (error: any) {
    console.error("Reorder job parts error:", error);
    res.status(500).json({ error: error.message || "Failed to reorder job parts" });
  }
});

/**
 * ----------------------------
 * Job Equipment (tenant-safe calls)
 * ----------------------------
 */

router.get("/:jobId/equipment", async (req, res) => {
  try {
    const companyId = req.companyId;

    const job = await storage.getJob(companyId, req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const equipment = await storage.getJobEquipment(req.params.jobId);
    res.json(equipment);
  } catch (error: any) {
    console.error("Get job equipment error:", error);
    res.status(500).json({ error: error.message || "Failed to get job equipment" });
  }
});

router.post("/:jobId/equipment", requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    const companyId = req.companyId;

    const job = await storage.getJob(companyId, req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const { equipmentId, notes } = req.body;
    if (!equipmentId) {
      return res.status(400).json({ error: "equipmentId is required" });
    }

    const existingEquipment = await storage.getLocationEquipmentItem(companyId, equipmentId);
    if (!existingEquipment) {
      return res.status(404).json({ error: "Equipment not found" });
    }

    const jobEquipment = await storage.createJobEquipment(companyId, req.params.jobId, {
      jobId: req.params.jobId,
      equipmentId,
      notes,
    });

    res.status(201).json(jobEquipment);
  } catch (error: any) {
    console.error("Create job equipment error:", error);
    res.status(500).json({ error: error.message || "Failed to add equipment to job" });
  }
});

router.put("/:jobId/equipment/:jobEquipmentId", requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    const companyId = req.companyId;

    const job = await storage.getJob(companyId, req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const { notes } = req.body;
    const updated = await storage.updateJobEquipment(companyId, req.params.jobEquipmentId, { notes });

    if (!updated) return res.status(404).json({ error: "Job equipment not found" });
    res.json(updated);
  } catch (error: any) {
    console.error("Update job equipment error:", error);
    res.status(500).json({ error: error.message || "Failed to update job equipment" });
  }
});

router.delete("/:jobId/equipment/:jobEquipmentId", requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    const companyId = req.companyId;

    const job = await storage.getJob(companyId, req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const deleted = await storage.deleteJobEquipment(companyId, req.params.jobEquipmentId);
    if (!deleted) return res.status(404).json({ error: "Job equipment not found" });

    res.json({ success: true });
  } catch (error: any) {
    console.error("Delete job equipment error:", error);
    res.status(500).json({ error: error.message || "Failed to remove equipment from job" });
  }
});

/**
 * ----------------------------
 * Recurring jobs (series/phases)
 * ----------------------------
 */

router.post("/recurring/series", requireRole(MANAGER_ROLES), async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId;
    const parsed = insertRecurringJobSeriesSchema.parse(req.body);
    const created = await storage.createRecurringJobSeries(companyId, parsed);
    res.status(201).json(created);
  } catch (error: any) {
    console.error("Create recurring series error:", error);
    if (error?.name === "ZodError") {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    res.status(500).json({ error: error.message || "Failed to create recurring series" });
  }
});

router.post("/recurring/phases", requireRole(MANAGER_ROLES), async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId;
    const parsed = insertRecurringJobPhaseSchema.parse(req.body);
    const created = await storage.createRecurringJobPhase(companyId, parsed);
    res.status(201).json(created);
  } catch (error: any) {
    console.error("Create recurring phase error:", error);
    if (error?.name === "ZodError") {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    res.status(500).json({ error: error.message || "Failed to create recurring phase" });
  }
});

/**
 * ----------------------------
 * Utility: reconcile Job ↔ Invoice links
 * ----------------------------
 */
router.post("/:id/reconcile-invoice-links", requireRole(MANAGER_ROLES), async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId;
    const { id: jobId } = req.params;

    const result = await storage.reconcileJobInvoiceLinks(companyId, jobId);
    res.json(result);
  } catch (error: any) {
    console.error("Reconcile job/invoice links error:", error);
    res.status(500).json({ error: error.message || "Failed to reconcile job/invoice links" });
  }
});

export default router;