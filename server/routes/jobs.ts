import { Router, Response } from "express";
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
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { parsePagination, parsePaginationLenient, applyOffsetPagination } from "../utils/pagination";
import { paginated, paginatedCompat } from "../utils/paginatedResponse";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";

const router = Router();

/**
 * ----------------------------
 * Jobs CRUD
 * ----------------------------
 */

// GET /api/jobs - List all jobs with pagination
router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
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
}));

// GET /api/jobs/:id - Get single job
router.get("/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;

  const job = await storage.getJob(companyId, req.params.id);
  if (!job) throw createError(404, "Job not found");

  res.json(job);
}));

// POST /api/jobs - Create new job
router.post("/", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;

  const parsed = validateSchema(insertJobSchema, req.body);
  const job = await storage.createJob(companyId, parsed);

  res.status(201).json(job);
}));

// PATCH /api/jobs/:id - Update job with optimistic locking
router.patch("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;

  // Extract version from body before validation
  const { version, ...data } = req.body;
  const parsed = validateSchema(updateJobSchema, data);

  try {
    // Pass version to storage (can be undefined)
    const updated = await storage.updateJob(companyId, req.params.id, version, parsed);

    if (!updated) {
      throw createError(404, "Job not found");
    }

    res.json(updated);
  } catch (error: any) {
    // Check for version mismatch
    if (error.message?.includes('modified by another user')) {
      return res.status(409).json({
        error: error.message,
        code: 'VERSION_MISMATCH'
      });
    }
    throw error;
  }
}));

// DELETE /api/jobs/:id - Delete job
router.delete("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;

  const deleted = await storage.deleteJob(companyId, req.params.id);
  if (!deleted) throw createError(404, "Job not found");

  res.json({ success: true });
}));

/**
 * ----------------------------
 * Status transitions
 * ----------------------------
 */

const statusUpdateSchema = z.object({
  status: jobStatusEnum,
}).strict();

// POST /api/jobs/:id/status - Update job status
router.post("/:id/status", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;

  const { status } = validateSchema(statusUpdateSchema, req.body);

  const existing = await storage.getJob(companyId, req.params.id);
  if (!existing) throw createError(404, "Job not found");

  assertJobStatusTransition(existing.status as JobStatus, status as JobStatus);

  // Use undefined for version to maintain backward compatibility
  const updated = await storage.updateJob(companyId, req.params.id, undefined, { status });
  if (!updated) throw createError(404, "Job not found");

  res.json(updated);
}));

/**
 * ----------------------------
 * Job Parts (tenant-safe calls)
 * ----------------------------
 */

// GET /api/jobs/:jobId/parts - List job parts
router.get("/:jobId/parts", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const { params, explicit } = parsePaginationLenient(req.query);

  const job = await storage.getJob(companyId, req.params.jobId);
  if (!job) throw createError(404, "Job not found");

  const allParts = await storage.getJobParts(companyId, req.params.jobId);

  // Apply pagination
  const offset = params.offset ?? 0;
  const { items, meta } = applyOffsetPagination(allParts, offset, params.limit);

  res.json(paginatedCompat(items, meta, explicit));
}));

const createJobPartSchema = z.object({
  description: z.string().min(1),
  quantity: z.string().or(z.number()),
  unitPrice: z.string().or(z.number()).optional(),
  productId: z.string().optional(),
}).strict();

// POST /api/jobs/:jobId/parts - Add part to job
router.post("/:jobId/parts", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;

  const job = await storage.getJob(companyId, req.params.jobId);
  if (!job) throw createError(404, "Job not found");

  const validated = validateSchema(createJobPartSchema, req.body);

  const jobPart = await storage.createJobPart(companyId, req.params.jobId, {
    ...validated,
    jobId: req.params.jobId,
  });

  res.status(201).json(jobPart);
}));

const updateJobPartSchema = z.object({
  description: z.string().min(1).optional(),
  quantity: z.string().or(z.number()).optional(),
  unitPrice: z.string().or(z.number()).optional(),
  productId: z.string().optional(),
}).strict();

// PUT /api/jobs/:jobId/parts/:id - Update job part
router.put("/:jobId/parts/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;

  const job = await storage.getJob(companyId, req.params.jobId);
  if (!job) throw createError(404, "Job not found");

  const validated = validateSchema(updateJobPartSchema, req.body);
  const jobPart = await storage.updateJobPart(companyId, req.params.id, validated);
  if (!jobPart) throw createError(404, "Job part not found");

  res.json(jobPart);
}));

// DELETE /api/jobs/:jobId/parts/:id - Remove part from job
router.delete("/:jobId/parts/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;

  const job = await storage.getJob(companyId, req.params.jobId);
  if (!job) throw createError(404, "Job not found");

  const deleted = await storage.deleteJobPart(companyId, req.params.id);
  if (!deleted) throw createError(404, "Job part not found");

  res.json({ success: true });
}));

const reorderJobPartsSchema = z.object({
  parts: z.array(z.object({
    id: z.string(),
    sortOrder: z.number(),
  })),
}).strict();

// PATCH /api/jobs/:jobId/parts/reorder - Reorder job parts
router.patch("/:jobId/parts/reorder", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;

  const job = await storage.getJob(companyId, req.params.jobId);
  if (!job) throw createError(404, "Job not found");

  const { parts } = validateSchema(reorderJobPartsSchema, req.body);

  await storage.reorderJobParts(companyId, req.params.jobId, parts);
  res.json({ success: true });
}));

/**
 * ----------------------------
 * Job Equipment (tenant-safe calls)
 * ----------------------------
 */

// GET /api/jobs/:jobId/equipment - List job equipment
router.get("/:jobId/equipment", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const { params, explicit } = parsePaginationLenient(req.query);

  const job = await storage.getJob(companyId, req.params.jobId);
  if (!job) throw createError(404, "Job not found");

  const allEquipment = await storage.getJobEquipment(companyId, req.params.jobId);

  // Apply pagination
  const offset = params.offset ?? 0;
  const { items, meta } = applyOffsetPagination(allEquipment, offset, params.limit);

  res.json(paginatedCompat(items, meta, explicit));
}));

const createJobEquipmentSchema = z.object({
  equipmentId: z.string().min(1),
  notes: z.string().optional(),
}).strict();

// POST /api/jobs/:jobId/equipment - Add equipment to job
router.post("/:jobId/equipment", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;

  const job = await storage.getJob(companyId, req.params.jobId);
  if (!job) throw createError(404, "Job not found");

  const { equipmentId, notes } = validateSchema(createJobEquipmentSchema, req.body);

  const existingEquipment = await storage.getLocationEquipmentItem(companyId, equipmentId);
  if (!existingEquipment) {
    throw createError(404, "Equipment not found");
  }

  const jobEquipment = await storage.createJobEquipment(companyId, req.params.jobId, {
    jobId: req.params.jobId,
    equipmentId,
    notes,
  });

  res.status(201).json(jobEquipment);
}));

const updateJobEquipmentSchema = z.object({
  notes: z.string().optional(),
}).strict();

// PUT /api/jobs/:jobId/equipment/:jobEquipmentId - Update job equipment
router.put("/:jobId/equipment/:jobEquipmentId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;

  const job = await storage.getJob(companyId, req.params.jobId);
  if (!job) throw createError(404, "Job not found");

  const { notes } = validateSchema(updateJobEquipmentSchema, req.body);
  const updated = await storage.updateJobEquipment(companyId, req.params.jobEquipmentId, { notes });

  if (!updated) throw createError(404, "Job equipment not found");
  res.json(updated);
}));

// DELETE /api/jobs/:jobId/equipment/:jobEquipmentId - Remove equipment from job
router.delete("/:jobId/equipment/:jobEquipmentId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;

  const job = await storage.getJob(companyId, req.params.jobId);
  if (!job) throw createError(404, "Job not found");

  const deleted = await storage.deleteJobEquipment(companyId, req.params.jobEquipmentId);
  if (!deleted) throw createError(404, "Job equipment not found");

  res.json({ success: true });
}));

/**
 * ----------------------------
 * Recurring jobs (series/phases)
 * ----------------------------
 */

// POST /api/jobs/recurring/series - Create recurring job series
router.post("/recurring/series", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;

  const parsed = validateSchema(insertRecurringJobSeriesSchema, req.body);
  const created = await storage.createRecurringJobSeries(companyId, parsed);

  res.status(201).json(created);
}));

// POST /api/jobs/recurring/phases - Create recurring job phase
router.post("/recurring/phases", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;

  const parsed = validateSchema(insertRecurringJobPhaseSchema, req.body);
  const created = await storage.createRecurringJobPhase(companyId, parsed);

  res.status(201).json(created);
}));

/**
 * ----------------------------
 * Utility: reconcile Job ↔ Invoice links
 * ----------------------------
 */

// POST /api/jobs/:id/reconcile-invoice-links - Reconcile job/invoice links
router.post("/:id/reconcile-invoice-links", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const { id: jobId } = req.params;

  const result = await storage.reconcileJobInvoiceLinks(companyId, jobId);
  res.json(result);
}));

/**
 * ----------------------------
 * Job Notes (simple comments on jobs)
 * ----------------------------
 */

import * as jobNotesService from "../services/jobNotes.service.js";

// GET /api/jobs/:jobId/notes - List job notes
router.get("/:jobId/notes", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;

  const notes = await jobNotesService.listJobNotes(companyId, req.params.jobId);
  res.json(notes);
}));

// POST /api/jobs/:jobId/notes - Create job note
router.post("/:jobId/notes", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const userId = req.user!.id;

  const { noteText } = req.body;

  if (!noteText || typeof noteText !== 'string' || noteText.trim().length === 0) {
    throw createError(400, "noteText is required and must be a non-empty string");
  }

  const note = await jobNotesService.createJobNote(
    companyId,
    req.params.jobId,
    userId,
    noteText.trim()
  );

  res.status(201).json(note);
}));

// PATCH /api/jobs/:jobId/notes/:noteId - Update job note
router.patch("/:jobId/notes/:noteId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const userId = req.user!.id;

  const { noteText } = req.body;

  if (!noteText || typeof noteText !== 'string' || noteText.trim().length === 0) {
    throw createError(400, "noteText is required and must be a non-empty string");
  }

  const note = await jobNotesService.updateJobNote(
    companyId,
    req.params.noteId,
    userId,
    noteText.trim()
  );

  res.json(note);
}));

// DELETE /api/jobs/:jobId/notes/:noteId - Delete job note
router.delete("/:jobId/notes/:noteId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const userId = req.user!.id;

  const result = await jobNotesService.deleteJobNote(companyId, req.params.noteId, userId);
  res.json(result);
}));

export default router;
