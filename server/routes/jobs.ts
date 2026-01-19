import { Router, Response } from "express";
import { z } from "zod";
import { storage } from "../storage/index";
import {
  insertJobSchema,
  updateJobSchema,
  insertRecurringJobSeriesSchema,
  insertRecurringJobPhaseSchema,
} from "@shared/schema";
import { assertJobStatusTransition } from "../statusRules";
import { jobStatusEnum } from "../schemas";
import type { JobStatus } from "../schemas";
import { requireRole } from "../auth/requireRole";
import { requireAuth } from "../auth/requireAuth";
import { MANAGER_ROLES, TECH_ROLES } from "../auth/roles";
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

// GET /api/jobs/action-required - Get action required jobs queue
// Prioritized by nextActionDate ASC, then by actionRequiredAt ASC (oldest first)
router.get("/action-required", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;

  const jobs = await storage.getActionRequiredJobs(companyId);

  res.json(jobs);
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
  const job = await storage.createJob(companyId, {
    ...parsed,
    status: parsed.status || "draft",
    priority: parsed.priority || "medium",
    jobType: parsed.jobType || "maintenance",
  });

  res.status(201).json(job);
}));

// PATCH /api/jobs/:id - Update job with optimistic locking
router.patch("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;

  // Extract version from body before validation
  const { version, ...data } = req.body;
  const parsed = validateSchema(updateJobSchema, data);

  // Convert date strings to Date objects for storage
  const updates: Record<string, unknown> = { ...parsed };
  if (parsed.actualStart !== undefined) {
    updates.actualStart = parsed.actualStart ? new Date(parsed.actualStart) : null;
  }
  if (parsed.actualEnd !== undefined) {
    updates.actualEnd = parsed.actualEnd ? new Date(parsed.actualEnd) : null;
  }
  if (parsed.scheduledStart !== undefined) {
    updates.scheduledStart = parsed.scheduledStart ? new Date(parsed.scheduledStart) : null;
  }
  if (parsed.scheduledEnd !== undefined) {
    updates.scheduledEnd = parsed.scheduledEnd ? new Date(parsed.scheduledEnd) : null;
  }

  try {
    // Pass version to storage (can be undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = await storage.updateJob(companyId, req.params.id, version, updates as any);

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
  // Action required fields (required when status === "action_required")
  actionRequiredReason: z.string().nullable().optional(),
  actionRequiredNotes: z.string().nullable().optional(),
  nextActionDate: z.string().nullable().optional(), // ISO date string (YYYY-MM-DD)
});

// Statuses that technicians are allowed to set (field work only)
const TECH_ALLOWED_STATUSES = ["en_route", "on_site", "in_progress", "action_required", "completed"];

// POST /api/jobs/:id/status - Update job status
// Uses requireAuth so both technicians and office users can access
router.post("/:id/status", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const userId = req.user?.id;
  const userRole = req.user?.role;

  // Role detection helpers
  const isTechUser = userRole === "technician";
  const isOfficeUser = userRole && (MANAGER_ROLES as readonly string[]).includes(userRole);

  // Ensure user has a valid role
  if (!isTechUser && !isOfficeUser) {
    throw createError(403, "You don't have permission to update job status.");
  }

  const { status, actionRequiredReason, actionRequiredNotes, nextActionDate } = validateSchema(statusUpdateSchema, req.body);

  // Restrict technicians to field work statuses only
  if (isTechUser && !TECH_ALLOWED_STATUSES.includes(status)) {
    throw createError(403, "You don't have permission to set this status. Technicians can only set: en_route, on_site, in_progress, action_required, or completed.");
  }

  const existing = await storage.getJob(companyId, req.params.id);
  if (!existing) throw createError(404, "Job not found");

  const fromStatus = existing.status;

  // NO-OP DETECTION: If status is unchanged and no fields are changing, return early without event
  if (fromStatus === status) {
    // For action_required, check if any fields are actually changing
    if (status === "action_required") {
      const reasonChanged = actionRequiredReason && actionRequiredReason.trim() !== existing.actionRequiredReason;
      const notesChanged = actionRequiredNotes !== undefined && (actionRequiredNotes || null) !== existing.actionRequiredNotes;
      const dateChanged = nextActionDate !== undefined && nextActionDate !== existing.nextActionDate;

      if (!reasonChanged && !notesChanged && !dateChanged) {
        // No actual changes - return existing job without creating event
        return res.json(existing);
      }
    } else {
      // For non-action_required statuses, same status = no-op
      return res.json(existing);
    }
  }

  assertJobStatusTransition(fromStatus as JobStatus, status as JobStatus);

  // Build update payload based on status
  const additionalUpdates: Record<string, unknown> = {};

  if (status === "action_required") {
    // Require actionRequiredReason when transitioning to action_required
    if (!actionRequiredReason || actionRequiredReason.trim() === "") {
      throw createError(400, "actionRequiredReason is required when setting status to action_required");
    }
    additionalUpdates.actionRequiredReason = actionRequiredReason.trim();
    additionalUpdates.actionRequiredNotes = actionRequiredNotes?.trim() || null;
    additionalUpdates.nextActionDate = nextActionDate || null;
    // Set actionRequiredAt timestamp for aging (only if transitioning INTO action_required)
    if (fromStatus !== "action_required") {
      additionalUpdates.actionRequiredAt = new Date();
      additionalUpdates.actionRequiredEscalatedAt = null; // Clear escalation when entering action_required fresh
    }
  } else {
    // Clear action_required fields when transitioning away from action_required
    additionalUpdates.actionRequiredReason = null;
    additionalUpdates.actionRequiredNotes = null;
    additionalUpdates.nextActionDate = null;
    additionalUpdates.actionRequiredAt = null;
    additionalUpdates.actionRequiredEscalatedAt = null;
  }

  // Atomically update job status and create event in a single transaction
  const updated = await storage.updateJobStatusWithEvent(companyId, req.params.id, {
    fromStatus,
    toStatus: status,
    changedBy: userId || null,
    note: status === "action_required" ? actionRequiredReason : null,
    meta: status === "action_required" ? { reason: actionRequiredReason, notes: actionRequiredNotes, nextActionDate } : null,
    additionalUpdates,
  });

  res.json(updated);
}));

/**
 * ----------------------------
 * Close Job (unified endpoint)
 * ----------------------------
 * Handles closing a job from any "active" state by:
 * 1. Transitioning to "completed" first (if needed)
 * 2. Then performing the final action (archive/invoice_later/invoice_now)
 *
 * PHASE A.1: Invoice creation (mode=invoice_now) uses createInvoiceFromJob()
 * which provides SELECT FOR UPDATE locking and idempotency guarantees.
 */

import { CLOSEABLE_STATES } from "../statusRules";

const closeJobSchema = z.object({
  mode: z.enum(["archive", "invoice_later", "invoice_now"]),
}).strict(); // PHASE A.1: Reject unknown keys

// POST /api/jobs/:id/close - Close job with specified mode
router.post("/:id/close", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const jobId = req.params.id;
  const userId = req.user?.id || null;

  const { mode } = validateSchema(closeJobSchema, req.body);

  // Fetch the job
  const existing = await storage.getJob(companyId, jobId);
  if (!existing) throw createError(404, "Job not found");

  // Capture original status BEFORE any transitions (for undo support)
  const originalStatus = existing.status as JobStatus;

  // Determine intermediate and final statuses based on mode
  const needsIntermediateTransition = CLOSEABLE_STATES.includes(originalStatus);
  const intermediateStatus: JobStatus = needsIntermediateTransition ? "completed" : originalStatus;

  // Validate transitions upfront
  if (needsIntermediateTransition) {
    assertJobStatusTransition(originalStatus, "completed");
  }

  let finalStatus: JobStatus;
  let createdInvoice = null;
  const enableUndo = mode === "archive" || mode === "invoice_later";

  // Determine final status and handle invoice_now mode's invoice creation first
  switch (mode) {
    case "archive":
      finalStatus = "archived";
      assertJobStatusTransition(intermediateStatus, finalStatus);
      break;
    case "invoice_later":
      finalStatus = "requires_invoicing";
      assertJobStatusTransition(intermediateStatus, finalStatus);
      break;
    case "invoice_now":
      // Create invoice BEFORE status transitions (separate from status transaction)
      try {
        // PHASE A.1: Pass creation source to satisfy invoice creation guard
        const invoiceResult = await storage.createInvoiceFromJob(
          companyId,
          jobId,
          { markJobCompleted: false },
          "JOB_CLOSE_ROUTE"
        );
        createdInvoice = invoiceResult.invoice;
        await storage.refreshInvoiceFromJob(companyId, createdInvoice.id);
      } catch (error: any) {
        if (error.message?.includes("already has an invoice")) {
          throw createError(400, "Job already has an invoice linked");
        }
        throw error;
      }
      finalStatus = "invoiced";
      assertJobStatusTransition(intermediateStatus, finalStatus);
      break;
    default:
      throw createError(400, `Invalid close mode: ${mode}`);
  }

  // Build transitions array for atomic update
  const transitions: Array<{
    fromStatus: string;
    toStatus: string;
    note?: string | null;
    meta?: Record<string, unknown> | null;
    additionalUpdates?: Record<string, unknown>;
  }> = [];

  // First transition: original -> completed (if needed)
  // This is an auto-step event (system-generated) that should be collapsed in timeline UI
  if (needsIntermediateTransition) {
    transitions.push({
      fromStatus: originalStatus,
      toStatus: "completed",
      note: `Closed via ${mode}`,
      meta: { system: true, via: "close", step: "auto_completed", mode },
      additionalUpdates: {
        actionRequiredReason: null,
        actionRequiredNotes: null,
        nextActionDate: null,
        actionRequiredAt: null,
        actionRequiredEscalatedAt: null,
      },
    });
  }

  // Second transition: intermediate -> final
  // This is the "real" close event visible in timeline
  transitions.push({
    fromStatus: intermediateStatus,
    toStatus: finalStatus,
    note: mode === "invoice_now" ? `Invoice ${createdInvoice?.invoiceNumber || "created"}` : null,
    meta: { via: "close", mode, invoiceId: createdInvoice?.id || null },
    additionalUpdates: {
      previousStatus: enableUndo ? originalStatus : null,
      closedAt: enableUndo ? new Date() : null,
      closedBy: enableUndo ? userId : null,
      ...(mode === "invoice_now" ? { invoiceId: createdInvoice?.id } : {}),
    },
  });

  // Execute all transitions atomically
  const updatedJob = await storage.updateJobStatusWithMultipleEvents(
    companyId,
    jobId,
    transitions,
    userId
  );

  res.json({
    job: updatedJob,
    invoice: createdInvoice,
  });
}));

/**
 * ----------------------------
 * Reopen Job
 * ----------------------------
 * Allows reopening closed jobs (completed/requires_invoicing/archived)
 * Blocks reopening invoiced jobs - must void/credit invoice first
 */

import { REOPENABLE_STATES } from "../statusRules";

const reopenJobSchema = z.object({
  target: z.enum(["scheduled", "in_progress"]).optional(),
});

// POST /api/jobs/:id/reopen - Reopen a closed job
router.post("/:id/reopen", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const jobId = req.params.id;
  const userId = req.user?.id || null;

  const validated = validateSchema(reopenJobSchema, req.body);
  const targetStatus: JobStatus = validated.target || "in_progress";

  // Fetch the job
  const existing = await storage.getJob(companyId, jobId);
  if (!existing) throw createError(404, "Job not found");

  const currentStatus = existing.status as JobStatus;

  // Block reopening invoiced jobs
  if (currentStatus === "invoiced") {
    throw createError(400, "Job is invoiced. Void or credit the invoice before reopening.");
  }

  // Check if job is in a reopenable state
  if (!REOPENABLE_STATES.includes(currentStatus)) {
    throw createError(400, `Cannot reopen job with status "${currentStatus}". Job must be completed, requires_invoicing, or archived.`);
  }

  // Validate the transition
  assertJobStatusTransition(currentStatus, targetStatus);

  // Atomically update status and log event
  const updatedJob = await storage.updateJobStatusWithEvent(companyId, jobId, {
    fromStatus: currentStatus,
    toStatus: targetStatus,
    changedBy: userId,
    note: "Reopened job",
    meta: { action: "reopen" },
  });

  res.json({ job: updatedJob });
}));

/**
 * ----------------------------
 * Undo Close Job
 * ----------------------------
 * Allows undoing a recent close (archive/invoice_later) within 20 seconds.
 * Blocked if job has been invoiced.
 */

const UNDO_WINDOW_MS = 20 * 1000; // 20 seconds

// POST /api/jobs/:id/undo-close - Undo a recent job close
router.post("/:id/undo-close", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const jobId = req.params.id;
  const userId = req.user?.id || null;

  // Fetch the job
  const existing = await storage.getJob(companyId, jobId);
  if (!existing) throw createError(404, "Job not found");

  // Check if there's anything to undo
  if (!existing.closedAt || !existing.previousStatus) {
    throw createError(400, "Nothing to undo. Job was not recently closed or undo info is missing.");
  }

  // Check if undo window has expired
  const closedAtTime = new Date(existing.closedAt).getTime();
  const now = Date.now();
  if (now - closedAtTime > UNDO_WINDOW_MS) {
    throw createError(400, "Undo window expired. Job was closed more than 20 seconds ago.");
  }

  // Block undo if job is invoiced or has an invoice linked
  if (existing.status === "invoiced" || existing.invoiceId) {
    throw createError(400, "Cannot undo close after invoicing. Void or credit the invoice first.");
  }

  const currentStatus = existing.status as JobStatus;
  const previousStatus = existing.previousStatus as JobStatus;

  // Validate the transition back to previous status
  assertJobStatusTransition(currentStatus, previousStatus);

  // Atomically update status, clear undo info, and log event
  const updatedJob = await storage.updateJobStatusWithEvent(companyId, jobId, {
    fromStatus: currentStatus,
    toStatus: previousStatus,
    changedBy: userId,
    note: "Undo close",
    meta: { action: "undo_close" },
    additionalUpdates: {
      previousStatus: null,
      closedAt: null,
      closedBy: null,
    },
  });

  res.json({ job: updatedJob });
}));

/**
 * ----------------------------
 * Action Required Escalation
 * ----------------------------
 * Marks an action_required job as escalated (one-time manual action)
 */

// POST /api/jobs/:id/mark-action-required-escalated - Mark job as escalated
router.post("/:id/mark-action-required-escalated", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const jobId = req.params.id;
  const userId = req.user?.id || null;

  // Fetch the job
  const existing = await storage.getJob(companyId, jobId);
  if (!existing) throw createError(404, "Job not found");

  // Only allow escalation for jobs in action_required status
  if (existing.status !== "action_required") {
    throw createError(400, "Job must be in action_required status to escalate.");
  }

  // Check if already escalated
  if (existing.actionRequiredEscalatedAt) {
    throw createError(400, "Job has already been escalated.");
  }

  // Atomically set escalation timestamp and log event
  // Note: fromStatus and toStatus are the same since escalation doesn't change status
  const updatedJob = await storage.updateJobStatusWithEvent(companyId, jobId, {
    fromStatus: "action_required",
    toStatus: "action_required",
    changedBy: userId,
    note: "Job escalated",
    meta: { action: "escalate", escalated: true },
    additionalUpdates: {
      actionRequiredEscalatedAt: new Date(),
    },
  });

  res.json({ job: updatedJob });
}));

// PATCH /api/jobs/:id/action-required - Update action required fields without changing status
const actionRequiredUpdateSchema = z.object({
  actionRequiredReason: z.string().optional(),
  actionRequiredNotes: z.string().nullable().optional(),
  nextActionDate: z.string().nullable().optional(), // ISO date string (YYYY-MM-DD) or null
});

router.patch("/:id/action-required", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const jobId = req.params.id;
  const userId = req.user?.id || null;

  // Validate payload
  const payload = validateSchema(actionRequiredUpdateSchema, req.body);

  // Fetch the job
  const existing = await storage.getJob(companyId, jobId);
  if (!existing) throw createError(404, "Job not found");

  // Only allow updates for jobs in action_required status
  if (existing.status !== "action_required") {
    throw createError(400, "Job must be in action_required status to update action required fields.");
  }

  // Build the updates object
  const additionalUpdates: Record<string, unknown> = {};
  const changedFields: string[] = [];

  if (payload.actionRequiredReason !== undefined) {
    additionalUpdates.actionRequiredReason = payload.actionRequiredReason;
    changedFields.push("reason");
  }
  if (payload.actionRequiredNotes !== undefined) {
    additionalUpdates.actionRequiredNotes = payload.actionRequiredNotes;
    changedFields.push("notes");
  }
  if (payload.nextActionDate !== undefined) {
    additionalUpdates.nextActionDate = payload.nextActionDate;
    changedFields.push("nextActionDate");
  }

  // Nothing to update
  if (Object.keys(additionalUpdates).length === 0) {
    return res.json({ job: existing });
  }

  // Atomically update fields and log event
  const updatedJob = await storage.updateJobStatusWithEvent(companyId, jobId, {
    fromStatus: "action_required",
    toStatus: "action_required",
    changedBy: userId,
    note: `Updated action required fields: ${changedFields.join(", ")}`,
    meta: { action: "update_action_required_fields", changedFields, ...payload },
    additionalUpdates,
  });

  res.json({ job: updatedJob });
}));

/**
 * ----------------------------
 * Job Status Events (audit trail)
 * ----------------------------
 */

// GET /api/jobs/:id/status-events - Get job status change history
router.get("/:id/status-events", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const jobId = req.params.id;

  // Verify job exists and belongs to company
  const job = await storage.getJob(companyId, jobId);
  if (!job) throw createError(404, "Job not found");

  // Get status events sorted by changedAt desc
  const events = await storage.getJobStatusEvents(companyId, jobId);

  res.json(events);
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
  unitCost: z.string().or(z.number()).optional(),
  unitPrice: z.string().or(z.number()).optional(),
  productId: z.string().nullable().optional(),
  source: z.string().optional(), // Frontend tracking field (not persisted)
});

// POST /api/jobs/:jobId/parts - Add part to job
router.post("/:jobId/parts", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;

  const job = await storage.getJob(companyId, req.params.jobId);
  if (!job) throw createError(404, "Job not found");

  const validated = validateSchema(createJobPartSchema, req.body);

  const jobPart = await storage.createJobPart(companyId, req.params.jobId, {
    description: validated.description,
    companyId,
    jobId: req.params.jobId,
    productId: validated.productId ?? null,
    quantity: String(validated.quantity),
    unitCost: validated.unitCost !== undefined ? String(validated.unitCost) : null,
    unitPrice: validated.unitPrice !== undefined ? String(validated.unitPrice) : null,
  });

  res.status(201).json(jobPart);
}));

const updateJobPartSchema = z.object({
  description: z.string().min(1).optional(),
  quantity: z.string().or(z.number()).optional(),
  unitCost: z.string().or(z.number()).optional(),
  unitPrice: z.string().or(z.number()).optional(),
  productId: z.string().nullable().optional(),
  source: z.string().optional(), // Frontend tracking field (not persisted)
});

// PUT /api/jobs/:jobId/parts/:id - Update job part
router.put("/:jobId/parts/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;

  const job = await storage.getJob(companyId, req.params.jobId);
  if (!job) throw createError(404, "Job not found");

  const validated = validateSchema(updateJobPartSchema, req.body);
  const jobPart = await storage.updateJobPart(companyId, req.params.id, {
    description: validated.description,
    productId: validated.productId,
    quantity: validated.quantity !== undefined ? String(validated.quantity) : undefined,
    unitCost: validated.unitCost !== undefined ? String(validated.unitCost) : undefined,
    unitPrice: validated.unitPrice !== undefined ? String(validated.unitPrice) : undefined,
  });
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

/**
 * ----------------------------
 * Admin Override for Invoiced Jobs
 * ----------------------------
 * These endpoints allow managers to modify jobs that are locked due to invoicing.
 * All operations are logged with a reason for audit purposes.
 * Returns 409 if job is not invoiced (use regular endpoints instead).
 */

const adminOverrideSchema = z.object({
  reason: z.string().min(1, "Reason is required for admin override"),
});

// Helper to verify job is invoiced (for admin override endpoints)
async function requireInvoicedJob(companyId: string, jobId: string): Promise<void> {
  const job = await storage.getJob(companyId, jobId);
  if (!job) {
    const err = new Error("Job not found");
    (err as any).statusCode = 404;
    throw err;
  }
  const INVOICED_STATUSES = ["invoiced", "paid", "payment_pending"];
  if (!INVOICED_STATUSES.includes(job.status)) {
    const err = new Error("Job is not invoiced. Use regular endpoints for unlocked jobs.");
    (err as any).statusCode = 409;
    (err as any).code = "JOB_NOT_LOCKED";
    throw err;
  }
}

// POST /api/jobs/:jobId/admin/parts - Add part to invoiced job (manager override)
router.post("/:jobId/admin/parts", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const jobId = req.params.jobId;
  const userId = req.user?.id;

  // Extract reason from body
  const { reason, ...partData } = req.body;
  validateSchema(adminOverrideSchema, { reason });

  await requireInvoicedJob(companyId, jobId);

  const validated = validateSchema(createJobPartSchema, partData);

  const jobPart = await storage.createJobPart(
    companyId,
    jobId,
    {
      description: validated.description,
      companyId,
      jobId,
      productId: validated.productId ?? null,
      quantity: String(validated.quantity),
      unitCost: validated.unitCost !== undefined ? String(validated.unitCost) : null,
      unitPrice: validated.unitPrice !== undefined ? String(validated.unitPrice) : null,
    },
    { overrideInvoiceLock: true }
  );

  // Log the admin override action
  console.log(`[AdminOverride] User ${userId} added part to invoiced job ${jobId}: ${reason}`);

  res.status(201).json({ ...jobPart, _adminOverride: true, _reason: reason });
}));

// PUT /api/jobs/:jobId/admin/parts/:id - Update part on invoiced job (manager override)
router.put("/:jobId/admin/parts/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const jobId = req.params.jobId;
  const partId = req.params.id;
  const userId = req.user?.id;

  const { reason, ...partData } = req.body;
  validateSchema(adminOverrideSchema, { reason });

  await requireInvoicedJob(companyId, jobId);

  const validated = validateSchema(updateJobPartSchema, partData);
  const jobPart = await storage.updateJobPart(
    companyId,
    partId,
    {
      description: validated.description,
      productId: validated.productId,
      quantity: validated.quantity !== undefined ? String(validated.quantity) : undefined,
      unitCost: validated.unitCost !== undefined ? String(validated.unitCost) : undefined,
      unitPrice: validated.unitPrice !== undefined ? String(validated.unitPrice) : undefined,
    },
    { overrideInvoiceLock: true }
  );

  if (!jobPart) throw createError(404, "Job part not found");

  console.log(`[AdminOverride] User ${userId} updated part ${partId} on invoiced job ${jobId}: ${reason}`);

  res.json({ ...jobPart, _adminOverride: true, _reason: reason });
}));

// DELETE /api/jobs/:jobId/admin/parts/:id - Delete part from invoiced job (manager override)
router.delete("/:jobId/admin/parts/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const jobId = req.params.jobId;
  const partId = req.params.id;
  const userId = req.user?.id;

  const { reason } = validateSchema(adminOverrideSchema, req.body);

  await requireInvoicedJob(companyId, jobId);

  const deleted = await storage.deleteJobPart(companyId, partId, { overrideInvoiceLock: true });
  if (!deleted) throw createError(404, "Job part not found");

  console.log(`[AdminOverride] User ${userId} deleted part ${partId} from invoiced job ${jobId}: ${reason}`);

  res.json({ success: true, _adminOverride: true, _reason: reason });
}));

// POST /api/jobs/:jobId/admin/equipment - Add equipment to invoiced job (manager override)
router.post("/:jobId/admin/equipment", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const jobId = req.params.jobId;
  const userId = req.user?.id;

  const { reason, ...equipmentData } = req.body;
  validateSchema(adminOverrideSchema, { reason });

  await requireInvoicedJob(companyId, jobId);

  const { equipmentId, notes } = validateSchema(createJobEquipmentSchema, equipmentData);

  const existingEquipment = await storage.getLocationEquipmentItem(companyId, equipmentId);
  if (!existingEquipment) {
    throw createError(404, "Equipment not found");
  }

  const jobEquipment = await storage.createJobEquipment(
    companyId,
    jobId,
    { equipmentId, notes },
    { overrideInvoiceLock: true }
  );

  console.log(`[AdminOverride] User ${userId} added equipment to invoiced job ${jobId}: ${reason}`);

  res.status(201).json({ ...jobEquipment, _adminOverride: true, _reason: reason });
}));

// DELETE /api/jobs/:jobId/admin/equipment/:jobEquipmentId - Delete equipment from invoiced job (manager override)
router.delete("/:jobId/admin/equipment/:jobEquipmentId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const jobId = req.params.jobId;
  const jobEquipmentId = req.params.jobEquipmentId;
  const userId = req.user?.id;

  const { reason } = validateSchema(adminOverrideSchema, req.body);

  await requireInvoicedJob(companyId, jobId);

  const deleted = await storage.deleteJobEquipment(companyId, jobEquipmentId, { overrideInvoiceLock: true });
  if (!deleted) throw createError(404, "Job equipment not found");

  console.log(`[AdminOverride] User ${userId} deleted equipment ${jobEquipmentId} from invoiced job ${jobId}: ${reason}`);

  res.json({ success: true, _adminOverride: true, _reason: reason });
}));

export default router;
