import { Router, Response } from "express";
import { z } from "zod";
import { storage } from "../storage/index";
import {
  insertJobSchema,
  updateJobSchema,
  insertRecurringJobSeriesSchema,
  insertRecurringJobPhaseSchema,
  normalizeJobStatus,
} from "@shared/schema";
import { assertJobStatusTransition } from "../statusRules";
import { jobStatusEnum, holdReasonEnum, openSubStatusEnum, legacyJobStatusEnum } from "../schemas";
import type { JobStatus, OpenSubStatus } from "../schemas";
import { requireRole } from "../auth/requireRole";
import { requireAuth } from "../auth/requireAuth";
import { MANAGER_ROLES, TECH_ROLES } from "../auth/roles";
import { parsePagination, parsePaginationLenient, applyOffsetPagination } from "../utils/pagination";
import { paginated, paginatedCompat } from "../utils/paginatedResponse";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import {
  applyJobSchedulingPatch,
  isSchedulingPatch,
  type SchedulingPatchIntent,
} from "../domain/scheduling";
import { assertCanEditSchedule } from "../guards/schedulingPermissions";
import {
  LifecycleTransitionError,
  LIFECYCLE_ROLES,
  type LifecycleIntent,
  type TransitionActor,
} from "../domain/jobLifecycle";

const router = Router();

/**
 * ----------------------------
 * Jobs CRUD
 * ----------------------------
 */

// GET /api/jobs - List all jobs with pagination
// Supports filters: status, technicianId, search, scheduledDate (YYYY-MM-DD for single day)
router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  // Use lenient pagination to support dashboard queries that only send limit
  const { params: pagination } = parsePaginationLenient(req.query);

  const status = req.query.status ? String(req.query.status) : undefined;
  const technicianId = req.query.technicianId ? String(req.query.technicianId) : undefined;
  const search = req.query.search ? String(req.query.search) : undefined;

  // Support scheduledDate param (YYYY-MM-DD) for filtering jobs on a specific date
  // Converts to startDate/endDate range for storage layer
  let startDate: string | undefined;
  let endDate: string | undefined;

  if (req.query.scheduledDate) {
    const dateStr = String(req.query.scheduledDate);
    // Set startDate to beginning of day, endDate to end of day
    startDate = `${dateStr}T00:00:00.000Z`;
    endDate = `${dateStr}T23:59:59.999Z`;
  }

  const result = await storage.getJobs(companyId, {
    status,
    technicianId,
    search,
    startDate,
    endDate,
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
// SCHEDULING CONSOLIDATION: If scheduling fields provided, route through applyJobSchedulingPatch
router.post("/", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;

  const parsed = validateSchema(insertJobSchema, req.body);

  // Build job data with defaults
  const jobData: Record<string, unknown> = {
    ...parsed,
    priority: parsed.priority || "medium",
    jobType: parsed.jobType || "maintenance",
  };

  // SCHEDULING CONSOLIDATION: If scheduling fields are provided, use domain logic
  if (isSchedulingPatch(parsed)) {
    // Build scheduling patch intent from parsed data
    const patchIntent: SchedulingPatchIntent = {};

    if (parsed.scheduledStart !== undefined) {
      patchIntent.scheduledStart = parsed.scheduledStart ? new Date(parsed.scheduledStart) : null;
    }
    if (parsed.scheduledEnd !== undefined) {
      patchIntent.scheduledEnd = parsed.scheduledEnd ? new Date(parsed.scheduledEnd) : null;
    }
    if (parsed.isAllDay !== undefined) {
      patchIntent.isAllDay = parsed.isAllDay;
    }
    if (parsed.durationMinutes !== undefined) {
      patchIntent.durationMinutes = parsed.durationMinutes;
    }
    // If status is explicitly provided, include it (will be normalized/derived)
    if (parsed.status !== undefined) {
      patchIntent.status = parsed.status;
    }

    // Apply consolidated scheduling patch (normalizes fields, derives status)
    // For new jobs, existingJob is null
    const schedulingResult = applyJobSchedulingPatch(
      null, // No existing job
      patchIntent,
      "route:jobs:create"
    );

    // Merge scheduling result into job data
    jobData.scheduledStart = schedulingResult.scheduledStart;
    jobData.scheduledEnd = schedulingResult.scheduledEnd;
    jobData.isAllDay = schedulingResult.isAllDay;
    jobData.status = schedulingResult.status;

    // Remove durationMinutes from job data (it's computed, not stored)
    delete jobData.durationMinutes;
  } else {
    // No scheduling fields - just normalize status
    const rawStatus = parsed.status || "open";
    jobData.status = normalizeJobStatus(rawStatus);
  }

  const job = await storage.createJob(companyId, jobData as any);

  res.status(201).json(job);
}));

// PATCH /api/jobs/:id - Update job with optimistic locking
// SCHEDULING CONSOLIDATION: All scheduling field updates route through applyJobSchedulingPatch
router.patch("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const jobId = req.params.id;

  // Extract version from body before validation
  const { version, ...data } = req.body;
  const parsed = validateSchema(updateJobSchema, data);

  // Convert date strings to Date objects for storage
  const updates: Record<string, unknown> = { ...parsed };

  // Handle non-scheduling date fields
  if (parsed.actualStart !== undefined) {
    updates.actualStart = parsed.actualStart ? new Date(parsed.actualStart) : null;
  }
  if (parsed.actualEnd !== undefined) {
    updates.actualEnd = parsed.actualEnd ? new Date(parsed.actualEnd) : null;
  }

  // SCHEDULING CONSOLIDATION: If patch touches scheduling fields, route through domain logic
  if (isSchedulingPatch(parsed)) {
    // RBAC: Check scheduling permission BEFORE any work
    assertCanEditSchedule(req.user);

    // REQUIRE VERSION for scheduling updates
    if (version === undefined) {
      return res.status(400).json({
        error: "Version is required for scheduling updates. Refresh and try again.",
        code: "VERSION_REQUIRED",
      });
    }

    // Load existing job to check terminal status and derive status
    const existingJob = await storage.getJob(companyId, jobId);
    if (!existingJob) {
      throw createError(404, "Job not found");
    }

    // Build scheduling patch intent from parsed data
    const patchIntent: SchedulingPatchIntent = {};
    if (parsed.scheduledStart !== undefined) {
      patchIntent.scheduledStart = parsed.scheduledStart ? new Date(parsed.scheduledStart) : null;
    }
    if (parsed.scheduledEnd !== undefined) {
      patchIntent.scheduledEnd = parsed.scheduledEnd ? new Date(parsed.scheduledEnd) : null;
    }
    if (parsed.isAllDay !== undefined) {
      patchIntent.isAllDay = parsed.isAllDay;
    }
    if (parsed.durationMinutes !== undefined) {
      patchIntent.durationMinutes = parsed.durationMinutes;
    }
    // If status is explicitly provided, include it (will be normalized)
    if (parsed.status !== undefined) {
      patchIntent.status = parsed.status;
    }
    // Include expected version for optimistic locking
    if (version !== undefined) {
      patchIntent.expectedVersion = version;
    }

    // Apply consolidated scheduling patch (enforces terminal immutability, normalizes, derives status)
    const schedulingResult = applyJobSchedulingPatch(
      existingJob,
      patchIntent,
      "route:jobs:update"
    );

    // Merge scheduling result into updates
    updates.scheduledStart = schedulingResult.scheduledStart;
    updates.scheduledEnd = schedulingResult.scheduledEnd;
    updates.isAllDay = schedulingResult.isAllDay;
    updates.status = schedulingResult.status;

    // Remove durationMinutes from updates (it's a derived/computed field, not stored directly)
    delete updates.durationMinutes;
  } else {
    // No scheduling fields - just normalize status if provided
    if (parsed.status !== undefined) {
      updates.status = normalizeJobStatus(parsed.status);
    }
  }

  try {
    // Pass version to storage with isSchedulingUpdate flag
    // Version only increments for scheduling updates (Task D)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = await storage.updateJob(companyId, jobId, version, updates as any, {
      isSchedulingUpdate: isSchedulingPatch(parsed),
    });

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
    // Re-throw terminal immutability errors with proper status
    if (error.name === 'TerminalJobImmutableError') {
      return res.status(error.statusCode || 400).json({
        error: error.message,
        code: error.code || 'TERMINAL_JOB_IMMUTABLE'
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
  // Accept both new lifecycle status and legacy status values
  status: legacyJobStatusEnum,
  // Workflow sub-status (only valid when status = 'open')
  openSubStatus: openSubStatusEnum.nullable().optional(),
  // Hold state fields (required when openSubStatus === "on_hold")
  holdReason: holdReasonEnum.nullable().optional(),
  holdNotes: z.string().nullable().optional(),
  nextActionDate: z.string().nullable().optional(), // ISO date string (YYYY-MM-DD)
  // TASK 3: Require version for optimistic locking on status changes
  version: z.number().int().nonnegative(),
});

// Statuses/sub-statuses that technicians are allowed to set (field work only)
// Technicians can: set workflow sub-statuses (in_progress, on_hold) or complete jobs
const TECH_ALLOWED_LIFECYCLE_STATUSES: JobStatus[] = ["open", "completed"];
const TECH_ALLOWED_SUB_STATUSES: OpenSubStatus[] = ["in_progress", "on_hold"];

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

  const parsed = validateSchema(statusUpdateSchema, req.body);
  const { holdReason, holdNotes, nextActionDate } = parsed;

  // Map legacy status values to new model:
  // - "in_progress" -> status="open", openSubStatus="in_progress"
  // - "on_hold" -> status="open", openSubStatus="on_hold"
  // - Other values -> normalize to 4-value lifecycle
  let status: JobStatus;
  let openSubStatus: OpenSubStatus | null = parsed.openSubStatus ?? null;

  const rawStatus = parsed.status;
  if (rawStatus === "in_progress") {
    status = "open";
    openSubStatus = "in_progress";
  } else if (rawStatus === "on_hold") {
    status = "open";
    openSubStatus = "on_hold";
  } else {
    status = normalizeJobStatus(rawStatus);
    // Clear openSubStatus when transitioning away from 'open'
    if (status !== "open") {
      openSubStatus = null;
    }
  }

  // Restrict technicians to allowed operations
  if (isTechUser) {
    const isAllowedLifecycle = TECH_ALLOWED_LIFECYCLE_STATUSES.includes(status);
    const isAllowedSubStatus = openSubStatus === null || TECH_ALLOWED_SUB_STATUSES.includes(openSubStatus);
    if (!isAllowedLifecycle || !isAllowedSubStatus) {
      throw createError(403, "You don't have permission to set this status. Technicians can only set: open (with in_progress/on_hold), or completed.");
    }
  }

  const existing = await storage.getJob(companyId, req.params.id);
  if (!existing) throw createError(404, "Job not found");

  // TASK 3: Version check for optimistic locking on status changes
  const expectedVersion = parsed.version;
  const actualVersion = existing.version;

  // Reject VERSION_NOT_INITIALIZED if job has null version
  if (actualVersion === null || actualVersion === undefined) {
    return res.status(409).json({
      error: `Job version is not initialized. Please refresh and try again. (Job ID: ${req.params.id})`,
      code: "VERSION_NOT_INITIALIZED",
    });
  }

  // Reject VERSION_MISMATCH if versions don't match
  if (expectedVersion !== actualVersion) {
    return res.status(409).json({
      error: `Job was modified by another user. Please refresh and try again. (Expected version: ${expectedVersion}, Actual version: ${actualVersion})`,
      code: "VERSION_MISMATCH",
    });
  }

  // Normalize existing status for comparison
  const fromStatus = normalizeJobStatus(existing.status);
  // openSubStatus may not be in the type yet (schema migration pending), so use type assertion
  const fromOpenSubStatus = (existing as { openSubStatus?: string | null }).openSubStatus as OpenSubStatus | null ?? null;

  // NO-OP DETECTION: If status/openSubStatus unchanged and no fields changing, return early
  const statusUnchanged = fromStatus === status && fromOpenSubStatus === openSubStatus;
  if (statusUnchanged) {
    // For on_hold sub-status, check if any fields are actually changing
    if (openSubStatus === "on_hold") {
      const reasonChanged = holdReason && holdReason !== existing.holdReason;
      const notesChanged = holdNotes !== undefined && (holdNotes || null) !== existing.holdNotes;
      const dateChanged = nextActionDate !== undefined && nextActionDate !== existing.nextActionDate;

      if (!reasonChanged && !notesChanged && !dateChanged) {
        return res.json(existing);
      }
    } else {
      return res.json(existing);
    }
  }

  // Validate lifecycle status transition (4-value model)
  if (fromStatus !== status) {
    assertJobStatusTransition(fromStatus as JobStatus, status);
  }

  // Build update payload based on target state
  const additionalUpdates: Record<string, unknown> = {
    openSubStatus,
  };

  if (openSubStatus === "on_hold") {
    // Require holdReason when transitioning to on_hold
    if (!holdReason) {
      throw createError(400, "holdReason is required when setting openSubStatus to on_hold");
    }
    additionalUpdates.holdReason = holdReason;
    additionalUpdates.holdNotes = holdNotes?.trim() || null;
    additionalUpdates.nextActionDate = nextActionDate || null;
    // Set onHoldAt timestamp for aging (only if transitioning INTO on_hold)
    if (fromOpenSubStatus !== "on_hold") {
      additionalUpdates.onHoldAt = new Date();
    }
  } else {
    // Clear on_hold fields when transitioning away from on_hold
    additionalUpdates.holdReason = null;
    additionalUpdates.holdNotes = null;
    additionalUpdates.nextActionDate = null;
    additionalUpdates.onHoldAt = null;
  }

  // Atomically update job status and create event in a single transaction
  const updated = await storage.updateJobStatusWithEvent(companyId, req.params.id, {
    fromStatus,
    toStatus: status,
    changedBy: userId || null,
    note: openSubStatus === "on_hold" ? `On hold: ${holdReason}` : null,
    meta: openSubStatus === "on_hold" ? { holdReason, holdNotes, nextActionDate, openSubStatus } : { openSubStatus },
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
  version: z.number().int().nonnegative(),
}).strict(); // PHASE A.1: Reject unknown keys

// POST /api/jobs/:id/close - Close job with specified mode
// LIFECYCLE HARDENING: Uses transitionJobStatus for RBAC, version check, and audit
router.post("/:id/close", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const jobId = req.params.id;
  const userId = req.user?.id || null;
  const userRole = req.user?.role || "unknown";

  const { mode, version } = validateSchema(closeJobSchema, req.body);

  // Build actor for RBAC check
  const actor: TransitionActor = {
    userId: userId || "unknown",
    role: userRole,
  };

  // For invoice_now mode, create invoice BEFORE lifecycle transition
  let createdInvoice = null;
  if (mode === "invoice_now") {
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
  }

  // Build lifecycle intent based on mode
  const intent: LifecycleIntent = {
    type: "CLOSE_JOB",
    mode,
    invoiceId: createdInvoice?.id,
  };

  try {
    // Execute lifecycle transition via domain + storage layer
    // This enforces: RBAC, version checking, audit logging, schedule clearing
    const updatedJob = await storage.transitionJobStatus(
      companyId,
      jobId,
      version,
      intent,
      actor
    );

    res.json({
      job: updatedJob,
      invoice: createdInvoice,
    });
  } catch (error: any) {
    // Handle lifecycle errors
    if (error instanceof LifecycleTransitionError) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    // Handle version mismatch
    if (error.code === "VERSION_MISMATCH") {
      return res.status(409).json({
        error: error.message,
        code: "VERSION_MISMATCH",
      });
    }
    throw error;
  }
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
  // Target openSubStatus when reopening (status always becomes "open")
  targetOpenSubStatus: openSubStatusEnum.nullable().optional(),
  version: z.number().int().nonnegative(),
});

// POST /api/jobs/:id/reopen - Reopen a closed job
// LIFECYCLE HARDENING: Uses transitionJobStatus for RBAC, version check, and audit
// In the new model, reopen always transitions to status="open" with optional openSubStatus
router.post("/:id/reopen", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const jobId = req.params.id;
  const userId = req.user?.id || null;
  const userRole = req.user?.role || "unknown";

  const validated = validateSchema(reopenJobSchema, req.body);
  const targetOpenSubStatus = validated.targetOpenSubStatus ?? null;

  // Build actor for RBAC check
  const actor: TransitionActor = {
    userId: userId || "unknown",
    role: userRole,
  };

  // Build lifecycle intent - target is always "open" in the new 4-value model
  const intent: LifecycleIntent = {
    type: "REOPEN_JOB",
    targetOpenSubStatus: targetOpenSubStatus as OpenSubStatus | undefined,
  };

  try {
    // Execute lifecycle transition via domain + storage layer
    const updatedJob = await storage.transitionJobStatus(
      companyId,
      jobId,
      validated.version,
      intent,
      actor
    );

    res.json({ job: updatedJob });
  } catch (error: any) {
    // Handle lifecycle errors
    if (error instanceof LifecycleTransitionError) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    // Handle version mismatch
    if (error.code === "VERSION_MISMATCH") {
      return res.status(409).json({
        error: error.message,
        code: "VERSION_MISMATCH",
      });
    }
    throw error;
  }
}));

/**
 * ----------------------------
 * Undo Close Job
 * ----------------------------
 * Allows undoing a recent close (archive/invoice_later) within 20 seconds.
 * Blocked if job has been invoiced.
 */

const undoCloseSchema = z.object({
  version: z.number().int().nonnegative(),
});

// POST /api/jobs/:id/undo-close - Undo a recent job close
// LIFECYCLE HARDENING: Uses transitionJobStatus for RBAC, version check, and audit
router.post("/:id/undo-close", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const jobId = req.params.id;
  const userId = req.user?.id || null;
  const userRole = req.user?.role || "unknown";

  const { version } = validateSchema(undoCloseSchema, req.body);

  // Build actor for RBAC check
  const actor: TransitionActor = {
    userId: userId || "unknown",
    role: userRole,
  };

  // Build lifecycle intent
  const intent: LifecycleIntent = {
    type: "UNDO_CLOSE",
  };

  try {
    // Execute lifecycle transition via domain + storage layer
    // Domain module checks undo window, previous status, and invoiced state
    const updatedJob = await storage.transitionJobStatus(
      companyId,
      jobId,
      version,
      intent,
      actor
    );

    res.json({ job: updatedJob });
  } catch (error: any) {
    // Handle lifecycle errors
    if (error instanceof LifecycleTransitionError) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    // Handle version mismatch
    if (error.code === "VERSION_MISMATCH") {
      return res.status(409).json({
        error: error.message,
        code: "VERSION_MISMATCH",
      });
    }
    throw error;
  }
}));

/**
 * ----------------------------
 * Travel Tracking
 * ----------------------------
 * Records travel timestamps for billing drive time.
 * Travel tracking uses openSubStatus ("on_route", "in_progress") while status stays "open".
 */

import { isJobScheduled } from "@shared/schema";

// POST /api/jobs/:id/start-travel - Record when technician starts traveling to job
router.post("/:id/start-travel", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const jobId = req.params.id;
  const userId = req.user?.id || null;

  // Fetch the job
  const existing = await storage.getJob(companyId, jobId);
  if (!existing) throw createError(404, "Job not found");

  // Only allow starting travel for scheduled, open jobs
  if (existing.status !== "open" || !isJobScheduled(existing)) {
    throw createError(400, "Can only start travel for scheduled open jobs.");
  }

  // Check if travel already started
  if (existing.travelStartedAt) {
    throw createError(400, "Travel has already been started for this job.");
  }

  // Record travel start time and set openSubStatus to "on_route"
  const updatedJob = await storage.updateJobStatusWithEvent(companyId, jobId, {
    fromStatus: "open",
    toStatus: "open",
    changedBy: userId,
    note: "Started travel to job",
    meta: { action: "start_travel", openSubStatus: "on_route" },
    additionalUpdates: {
      travelStartedAt: new Date(),
      openSubStatus: "on_route",
    },
  });

  res.json({ job: updatedJob });
}));

// POST /api/jobs/:id/arrive-on-site - Record when technician arrives at job site
router.post("/:id/arrive-on-site", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const jobId = req.params.id;
  const userId = req.user?.id || null;

  // Fetch the job
  const existing = await storage.getJob(companyId, jobId);
  if (!existing) throw createError(404, "Job not found");

  // Allow arriving on site from scheduled open jobs
  if (existing.status !== "open" || !isJobScheduled(existing)) {
    throw createError(400, "Can only arrive on site for scheduled open jobs.");
  }

  // Check if already arrived
  if (existing.arrivedOnSiteAt) {
    throw createError(400, "Already marked as arrived on site.");
  }

  // Record arrival and transition to in_progress sub-status
  const now = new Date();
  const updatedJob = await storage.updateJobStatusWithEvent(companyId, jobId, {
    fromStatus: "open",
    toStatus: "open", // Status stays "open", workflow tracked via openSubStatus
    changedBy: userId,
    note: "Arrived on site",
    meta: { action: "arrive_on_site", openSubStatus: "in_progress" },
    additionalUpdates: {
      arrivedOnSiteAt: now,
      openSubStatus: "in_progress",
      actualStart: now, // Also set actual start time
      // If travel wasn't started, set it to arrival time (tech drove without clicking start)
      travelStartedAt: existing.travelStartedAt || now,
    },
  });

  res.json({ job: updatedJob });
}));

/**
 * ----------------------------
 * On Hold Management
 * ----------------------------
 * Update on_hold fields without changing openSubStatus
 */

// PATCH /api/jobs/:id/on-hold - Update on_hold fields without changing openSubStatus
const onHoldUpdateSchema = z.object({
  holdReason: holdReasonEnum.optional(),
  holdNotes: z.string().nullable().optional(),
  nextActionDate: z.string().nullable().optional(), // ISO date string (YYYY-MM-DD) or null
});

router.patch("/:id/on-hold", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const jobId = req.params.id;
  const userId = req.user?.id || null;

  // Validate payload
  const payload = validateSchema(onHoldUpdateSchema, req.body);

  // Fetch the job
  const existing = await storage.getJob(companyId, jobId);
  if (!existing) throw createError(404, "Job not found");

  // Only allow updates for jobs in on_hold openSubStatus
  // openSubStatus may not be in the type yet (schema migration pending), so use type assertion
  const currentSubStatus = (existing as { openSubStatus?: string | null }).openSubStatus;
  if (currentSubStatus !== "on_hold") {
    throw createError(400, "Job must have openSubStatus='on_hold' to update hold fields.");
  }

  // Build the updates object
  const additionalUpdates: Record<string, unknown> = {};
  const changedFields: string[] = [];

  if (payload.holdReason !== undefined) {
    additionalUpdates.holdReason = payload.holdReason;
    changedFields.push("reason");
  }
  if (payload.holdNotes !== undefined) {
    additionalUpdates.holdNotes = payload.holdNotes;
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

  // Atomically update fields and log event (status stays "open", openSubStatus stays "on_hold")
  const updatedJob = await storage.updateJobStatusWithEvent(companyId, jobId, {
    fromStatus: "open",
    toStatus: "open",
    changedBy: userId,
    note: `Updated hold fields: ${changedFields.join(", ")}`,
    meta: { action: "update_hold_fields", changedFields, openSubStatus: "on_hold", ...payload },
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

/**
 * ----------------------------
 * Scheduling History (Audit Trail)
 * ----------------------------
 */

// GET /api/jobs/:id/schedule-history - Get scheduling change history
router.get("/:id/schedule-history", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const jobId = req.params.id;
  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 10, 1), 50);

  // Verify job exists and belongs to tenant
  const job = await storage.getJob(companyId, jobId);
  if (!job) throw createError(404, "Job not found");

  // Fetch schedule audit history
  const history = await storage.getJobScheduleHistory(companyId, jobId, limit);

  res.json({
    jobId,
    jobNumber: job.jobNumber,
    history,
  });
}));

export default router;
