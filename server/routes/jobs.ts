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

const router = Router();

/**
 * Minimal auth gate for this router.
 * Note: Your app may also enforce auth/tenant higher up in server/routes/index.ts.
 * Keeping this here makes this router safe if it is ever mounted without those guards.
 */
function isAuthenticated(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user as User | undefined;
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  next();
}

function getCompanyIdOrThrow(req: Request): string {
  const user = (req as any).user as User | undefined;
  const companyId = (req as any).companyId || user?.companyId;
  if (!companyId) {
    // Tenant middleware should normally set this; treat missing as a wiring/security issue.
    throw new Error("Tenant context missing (companyId)");
  }
  return companyId;
}

/**
 * ----------------------------
 * Jobs CRUD
 * ----------------------------
 */

router.get("/", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyIdOrThrow(req);

    const status = req.query.status ? String(req.query.status) : undefined;
    const technicianId = req.query.technicianId ? String(req.query.technicianId) : undefined;
    const search = req.query.search ? String(req.query.search) : undefined;

    const jobs = await storage.getJobs(companyId, {
      status,
      technicianId,
      search,
    });

    res.json(jobs);
  } catch (error: any) {
    console.error("Get jobs error:", error);
    res.status(500).json({ error: error.message || "Failed to get jobs" });
  }
});

router.get("/:id", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyIdOrThrow(req);

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

router.post("/", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyIdOrThrow(req);

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

router.patch("/:id", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyIdOrThrow(req);

    const parsed = updateJobSchema.parse(req.body);
    const updated = await storage.updateJob(companyId, req.params.id, parsed);
    if (!updated) return res.status(404).json({ error: "Job not found" });

    res.json(updated);
  } catch (error: any) {
    console.error("Update job error:", error);
    if (error?.name === "ZodError") {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    res.status(500).json({ error: error.message || "Failed to update job" });
  }
});

router.delete("/:id", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyIdOrThrow(req);

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

router.post("/:id/status", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyIdOrThrow(req);

    const { status } = statusUpdateSchema.parse(req.body);

    const existing = await storage.getJob(companyId, req.params.id);
    if (!existing) return res.status(404).json({ error: "Job not found" });

    assertJobStatusTransition(existing.status as JobStatus, status as JobStatus);

    const updated = await storage.updateJob(companyId, req.params.id, { status });
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

router.get("/:jobId/parts", isAuthenticated, async (req, res) => {
  try {
    const companyId = getCompanyIdOrThrow(req);

    const job = await storage.getJob(companyId, req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const parts = await storage.getJobParts(req.params.jobId);
    res.json(parts);
  } catch (error: any) {
    console.error("Get job parts error:", error);
    res.status(500).json({ error: error.message || "Failed to get job parts" });
  }
});

router.post("/:jobId/parts", isAuthenticated, async (req, res) => {
  try {
    const companyId = getCompanyIdOrThrow(req);

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

router.put("/:jobId/parts/:id", isAuthenticated, async (req, res) => {
  try {
    const companyId = getCompanyIdOrThrow(req);

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

router.delete("/:jobId/parts/:id", isAuthenticated, async (req, res) => {
  try {
    const companyId = getCompanyIdOrThrow(req);

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

router.patch("/:jobId/parts/reorder", isAuthenticated, async (req, res) => {
  try {
    const companyId = getCompanyIdOrThrow(req);

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

router.get("/:jobId/equipment", isAuthenticated, async (req, res) => {
  try {
    const companyId = getCompanyIdOrThrow(req);

    const job = await storage.getJob(companyId, req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const equipment = await storage.getJobEquipment(req.params.jobId);
    res.json(equipment);
  } catch (error: any) {
    console.error("Get job equipment error:", error);
    res.status(500).json({ error: error.message || "Failed to get job equipment" });
  }
});

router.post("/:jobId/equipment", isAuthenticated, async (req, res) => {
  try {
    const companyId = getCompanyIdOrThrow(req);

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

router.put("/:jobId/equipment/:jobEquipmentId", isAuthenticated, async (req, res) => {
  try {
    const companyId = getCompanyIdOrThrow(req);

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

router.delete("/:jobId/equipment/:jobEquipmentId", isAuthenticated, async (req, res) => {
  try {
    const companyId = getCompanyIdOrThrow(req);

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

router.post("/recurring/series", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyIdOrThrow(req);
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

router.post("/recurring/phases", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyIdOrThrow(req);
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
router.post("/:id/reconcile-invoice-links", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyIdOrThrow(req);
    const { id: jobId } = req.params;

    const result = await storage.reconcileJobInvoiceLinks(companyId, jobId);
    res.json(result);
  } catch (error: any) {
    console.error("Reconcile job/invoice links error:", error);
    res.status(500).json({ error: error.message || "Failed to reconcile job/invoice links" });
  }
});

export default router;
