import { Router, Response } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { storage } from "../storage/index";
import { db } from "../db";
import {
  insertJobSchema,
  updateJobSchema,
  insertRecurringJobSeriesSchema,
  insertRecurringJobPhaseSchema,
  jobVisits,
  jobs as jobsTable,
  clientLocations,
} from "@shared/schema";
import { clientNotesRepository } from "../storage/clientNotes";
// 2026-05-02 (Audit #2 invoice-flow Phase 2): read-only billable preview
// for the future client-side invoice builder. Pure SELECT-only helper —
// see `server/services/jobBillablePreviewService.ts` for the no-mutation
// contract documented at the top of that file.
import {
  getJobBillablePreview,
  JobBillablePreviewError,
} from "../services/jobBillablePreviewService";
import { assertJobStatusTransition } from "../domain/jobLifecycle";
import { jobStatusEnum, holdReasonEnum, openSubStatusEnum } from "../schemas";
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
import { IS_DEV } from "../utils/devFlags";
import {
  LifecycleTransitionError,
  LIFECYCLE_ROLES,
  type LifecycleIntent,
  type TransitionActor,
} from "../domain/jobLifecycle";
// 2026-03-18: Deprecated service wrapper removed — import canonical repository directly
import { jobVisitsRepository } from "../storage/jobVisits";
// Phase 2: Canonical lifecycle orchestrator — all lifecycle mutations route through here
import * as lifecycle from "../services/jobLifecycleOrchestrator";
// 2026-03-19: Canonical invoice creation service (used by close+invoice_now)
import { createInvoiceFromJob as createInvoiceFromJobService } from "../services/invoiceCreationService";
// Phase 1 Architecture: Event Log + Attention Queue
import { logEventAsync } from "../lib/events";
// 2026-04-12 Phase 7: canonical email pipeline for job emails.
import { emailDispatchService } from "../services/emailDispatchService";
import { templateDataBuilder } from "../services/templateDataBuilder";
import { communicationTemplatesService } from "../services/communicationTemplatesService";
import { recipientResolverService } from "../services/recipientResolverService";
import { recomputeAttentionForEntity } from "../lib/attentionRules";
// Phase 4 Step A5: Canonical jobs feed module
import { getQueryCtx } from "../lib/queryCtx";
import { emitDispatch } from "../lib/dispatchBus";
import { getJobsFeed, getJobHeader, getJobCounts } from "../storage/jobsFeed";
import type { JobFeedFilters } from "../storage/jobsFeed";
// 2026-04-08: P7 — Canonical line-item input schema (shared with invoices/quotes)
import { canonicalLineItemInput } from "@shared/lineItem";

const router = Router();

/**
 * ----------------------------
 * Jobs CRUD
 * ----------------------------
 */

// GET /api/jobs - List all jobs with pagination
// Phase 4 Step A5: Now uses canonical getJobsFeed with correct COALESCE joins
router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const ctx = getQueryCtx(req);

  const status = req.query.status ? String(req.query.status) : undefined;
  const technicianId = req.query.technicianId ? String(req.query.technicianId) : undefined;
  const search = req.query.search ? String(req.query.search) : undefined;
  const locationId = req.query.locationId ? String(req.query.locationId) : undefined;

  // Support scheduledDate param (YYYY-MM-DD) for filtering jobs on a specific date
  let dateRange: { start: string; end: string } | undefined;
  if (req.query.scheduledDate) {
    const dateStr = String(req.query.scheduledDate);
    dateRange = {
      start: `${dateStr}T00:00:00.000Z`,
      end: `${dateStr}T23:59:59.999Z`,
    };
  }

  // Parse pagination from query params
  const { params: pagination } = parsePaginationLenient(req.query);

  // Sort params: sortBy (jobNumber|scheduledStart|status|priority), sortOrder (asc|desc)
  const sortBy = req.query.sortBy ? String(req.query.sortBy) : undefined;
  const sortOrder = req.query.sortOrder === "asc" || req.query.sortOrder === "desc"
    ? req.query.sortOrder : undefined;

  // Hybrid search: searchMode=history searches all job history server-side
  const searchMode = req.query.searchMode ? String(req.query.searchMode) : undefined;
  const isHistoryMode = searchMode === "history";

  if (isHistoryMode) {
    // History mode requires a search term
    if (!search || search.trim().length < 2) {
      res.status(400).json({ error: "Search term required (min 2 characters) for history search" });
      return;
    }
  }

  // Default mode: 1000-row cap for client-side filtering/counts.
  // History mode: honor client-requested limit (default 50).
  const JOBS_LIST_LIMIT = 1000;
  const HISTORY_DEFAULT_LIMIT = 50;
  const effectiveLimit = isHistoryMode
    ? (pagination.limit ?? HISTORY_DEFAULT_LIMIT)
    : JOBS_LIST_LIMIT;

  const openSubStatus = req.query.openSubStatus ? String(req.query.openSubStatus) : undefined;
  const unscheduledOnly = req.query.unscheduledOnly === "true";
  const overdue = req.query.overdue === "true";
  // 2026-04-19 Fix A: canonical "ready to invoice" filter passthrough.
  const readyToInvoiceOnly = req.query.readyToInvoiceOnly === "true";

  const filters: JobFeedFilters = {
    status: isHistoryMode ? undefined : status, // History searches all statuses
    technicianId: isHistoryMode ? undefined : technicianId,
    search,
    locationId: isHistoryMode ? undefined : locationId,
    dateRange: isHistoryMode ? undefined : dateRange,
    openSubStatus: isHistoryMode ? undefined : openSubStatus,
    unscheduledOnly: isHistoryMode ? false : unscheduledOnly,
    overdue: isHistoryMode ? false : overdue,
    readyToInvoiceOnly: isHistoryMode ? false : readyToInvoiceOnly,
    sortBy,
    sortOrder,
    limit: effectiveLimit,
    offset: pagination.offset ?? 0,
  };

  // P3-05: includeCounts=true runs a parallel aggregate for true badge counts
  const includeCounts = req.query.includeCounts === "true";

  if (includeCounts) {
    const [result, counts] = await Promise.all([
      getJobsFeed(ctx, filters),
      getJobCounts(ctx),
    ]);
    res.json({
      ...paginated(result.items, {
        limit: effectiveLimit,
        hasMore: result.items.length >= effectiveLimit,
      }),
      counts,
    });
  } else {
    const result = await getJobsFeed(ctx, filters);
    res.json(paginated(result.items, {
      limit: effectiveLimit,
      hasMore: result.items.length >= effectiveLimit,
    }));
  }
}));

// GET /api/jobs/:id - Get single job
// Phase 4 Step A5: Now uses canonical getJobHeader with correct customerCompanies join
router.get("/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const ctx = getQueryCtx(req);

  const job = await getJobHeader(ctx, req.params.id);
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
    // Preserve derived durationMinutes — stored on jobs.duration_minutes column
    // and forwarded to the initial visit's estimatedDurationMinutes
    jobData.durationMinutes = schedulingResult.durationMinutes;
  } else {
    // No scheduling fields - use status directly (canonical values enforced by Zod + DB constraint)
    jobData.status = parsed.status || "open";
  }

  const job = await storage.createJob(companyId, jobData as any);

  // DEV-ONLY: Assert initial visit was created (diagnostic log)
  if (IS_DEV) {
    const visitRows = await db.select({ id: jobVisits.id })
      .from(jobVisits)
      .where(eq(jobVisits.jobId, job.id));
    console.log(
      `[POST /api/jobs DEV] payload scheduledStart: ${req.body.scheduledStart ?? "undefined"}`,
      `| returned job scheduledStart: ${job.scheduledStart ?? "null"}`,
      `| visit count for jobId ${job.id}: ${visitRows.length}`
    );
  }

  // Phase 1: Log event + recompute attention
  logEventAsync(getQueryCtx(req), {
    eventType: "job.created",
    entityType: "job",
    entityId: job.id,
    summary: `Created Job #${job.jobNumber}`,
    meta: { jobNumber: job.jobNumber, summary: job.summary, status: job.status },
  });
  recomputeAttentionForEntity(companyId, "job", job.id).catch(() => {});

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

  // Editable job number: handle separately with uniqueness check + counter bump
  if (parsed.jobNumber !== undefined) {
    try {
      // Load current job to check if number actually changed
      const currentJob = await storage.getJob(companyId, jobId);
      if (!currentJob) throw createError(404, "Job not found");

      if (parsed.jobNumber !== currentJob.jobNumber) {
        await storage.updateJobNumber(companyId, jobId, parsed.jobNumber);
      }
    } catch (err: any) {
      if (err.code === "JOB_NUMBER_DUPLICATE") {
        return res.status(409).json({ error: err.message, code: "JOB_NUMBER_DUPLICATE" });
      }
      throw err;
    }
  }

  // Remove jobNumber from general patch — already handled above
  const { jobNumber: _jn, ...remaining } = parsed;

  // Convert date strings to Date objects for storage
  const updates: Record<string, unknown> = { ...remaining };

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
    // 2026-03-18: status removed from updateJobSchema — lifecycle writes go through orchestrator.
    // Scheduling patch uses existing job status for immutability checks.
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
    // No scheduling fields — status is managed by orchestrator, not generic PATCH
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
  // 2026-03-18: Canonical-only job statuses. No legacy/convenience aliases accepted.
  // Sub-status changes (in_progress, on_hold) must use the openSubStatus field with status="open".
  status: z.enum(["open", "completed", "invoiced", "archived"]),
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

  // Status is canonical (enforced by Zod + DB CHECK constraint)
  const status: JobStatus = parsed.status as JobStatus;
  // Clear openSubStatus when transitioning away from 'open'
  let openSubStatus: OpenSubStatus | null = parsed.openSubStatus ?? null;
  if (status !== "open") {
    openSubStatus = null;
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

  // DB CHECK constraint guarantees canonical status — use directly
  const fromStatus = existing.status as JobStatus;
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

  // 2026-03-18: Route lifecycle mutations through canonical orchestrator

  const actor = { userId: userId || "unknown", role: userRole || "unknown" };
  let updated: any;
  let autoCompletedVisitCount = 0;

  // CASE 1: Job completion → orchestrator forceCloseJob with invoice_later
  if (status === "completed" && fromStatus !== "completed") {
    const result = await lifecycle.forceCloseJob({
      type: "FORCE_CLOSE_JOB",
      companyId,
      jobId: req.params.id,
      version: parsed.version,
      mode: "invoice_later",
      actor,
      autoCompleteOpenVisits: true,
    });
    updated = result.job;
    autoCompletedVisitCount = result.autoCompletedVisitCount;

  // CASE 2: Placing on hold → orchestrator placeJobOnHold
  } else if (openSubStatus === "on_hold" && fromOpenSubStatus !== "on_hold") {
    if (!holdReason) {
      throw createError(400, "holdReason is required when setting openSubStatus to on_hold");
    }
    const result = await lifecycle.placeJobOnHold({
      type: "PLACE_JOB_ON_HOLD",
      companyId,
      jobId: req.params.id,
      holdReason: holdReason as any,
      holdNotes: holdNotes?.trim() || null,
      nextActionDate: nextActionDate ? new Date(nextActionDate) : null,
      changedBy: userId || "unknown",
    });
    updated = result.job;

  // CASE 3: Resuming from hold → orchestrator resumeJob
  } else if (fromOpenSubStatus === "on_hold" && openSubStatus !== "on_hold") {
    const result = await lifecycle.resumeJob({
      type: "RESUME_JOB",
      companyId,
      jobId: req.params.id,
      targetSubStatus: openSubStatus as OpenSubStatus | null,
      changedBy: userId || "unknown",
    });
    updated = result.job;

  // CASE 4: Sub-status change (on_route, in_progress) → orchestrator setJobSubstatus
  } else if (status === "open" && fromStatus === "open" && openSubStatus && openSubStatus !== "on_hold") {
    const result = await lifecycle.setJobSubstatus({
      type: "SET_JOB_SUBSTATUS",
      companyId,
      jobId: req.params.id,
      openSubStatus: openSubStatus as OpenSubStatus,
      changedBy: userId || "unknown",
    });
    updated = result.job;

  // CASE 5: On-hold metadata update (already on_hold, staying on_hold)
  } else if (openSubStatus === "on_hold" && fromOpenSubStatus === "on_hold") {
    const result = await lifecycle.updateHoldMetadata({
      type: "UPDATE_HOLD_METADATA",
      companyId,
      jobId: req.params.id,
      holdReason: holdReason as any,
      holdNotes: holdNotes?.trim() || null,
      nextActionDate: nextActionDate ? new Date(nextActionDate) : undefined,
      changedBy: userId || "unknown",
    });
    updated = result.job;

  // CASE 6: Clearing sub-status (e.g., going from in_progress/on_route back to plain open)
  } else if (status === "open" && fromStatus === "open" && openSubStatus === null && fromOpenSubStatus !== null && fromOpenSubStatus !== "on_hold") {
    const result = await lifecycle.setJobSubstatus({
      type: "SET_JOB_SUBSTATUS",
      companyId,
      jobId: req.params.id,
      openSubStatus: null,
      changedBy: userId || "unknown",
    });
    updated = result.job;

  // NO FALLBACK — reject unrecognized lifecycle mutations
  } else {
    throw createError(400,
      `Unsupported lifecycle transition: status=${status}, openSubStatus=${openSubStatus} ` +
      `(from status=${fromStatus}, openSubStatus=${fromOpenSubStatus}). ` +
      `Use specific lifecycle endpoints (/close, /reopen) for terminal transitions.`
    );
  }

  // Phase 1: Log event + recompute attention
  const statusLabel = status === "completed" ? "Completed" : status === "open" ? (openSubStatus || "Reopened") : status;
  logEventAsync(getQueryCtx(req), {
    eventType: `job.${status === "completed" ? "completed" : status === "open" && fromStatus !== "open" ? "reopened" : "status_changed"}`,
    entityType: "job",
    entityId: req.params.id,
    summary: `Job #${existing.jobNumber} → ${statusLabel}`,
    severity: status === "completed" ? "important" : "info",
    meta: { jobNumber: existing.jobNumber, fromStatus, toStatus: status, openSubStatus, autoCompletedVisitCount },
  });
  recomputeAttentionForEntity(companyId, "job", req.params.id).catch(() => {});

  // 2026-04-05: Emit dispatch SSE so office surfaces refresh after status changes
  // (completion, hold, resume, substatus). Matches convention used by /close and /reopen.
  emitDispatch(companyId, { scope: "calendar", entityType: "job", entityId: req.params.id, ts: new Date().toISOString() });

  res.json({ ...updated, autoCompletedVisitCount });
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

const closeJobSchema = z.object({
  mode: z.enum(["archive", "invoice_later", "invoice_now"]),
  version: z.number().int().nonnegative(),
  // Visit guardrail: when true, auto-complete uncompleted visits before closing
  autoCompleteOpenVisits: z.boolean().optional().default(false),
}).strict(); // PHASE A.1: Reject unknown keys

// POST /api/jobs/:id/close - Close job with specified mode
// LIFECYCLE HARDENING: Uses transitionJobStatus for RBAC, version check, and audit
// VISIT GUARDRAIL: Checks for uncompleted visits and returns 409 if not auto-completing
router.post("/:id/close", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const jobId = req.params.id;
  const userId = req.user?.id || null;
  const userRole = req.user?.role || "unknown";

  const { mode, version, autoCompleteOpenVisits } = validateSchema(closeJobSchema, req.body);

  // Visit guardrail: check for uncompleted visits before closing
  const uncompletedVisits = await jobVisitsRepository.getUncompletedVisits(companyId, jobId);

  if (uncompletedVisits.length > 0 && !autoCompleteOpenVisits) {
    // Return 409 with visit details so UI can show guardrail modal
    return res.status(409).json({
      code: "UNCOMPLETED_VISITS",
      error: `Job has ${uncompletedVisits.length} uncompleted visit(s). Complete them first or use autoCompleteOpenVisits.`,
      visitCount: uncompletedVisits.length,
      visitIds: uncompletedVisits.map((v) => v.id),
    });
  }

  // 2026-03-18: Route through canonical lifecycle orchestrator
  // 2026-04-04: Entire close + invoice flow wrapped in single DB transaction.
  // All steps share one tx — any failure rolls back everything atomically.
  // No orphaned invoices, no partial success, no second-attempt required.

  const actor: TransitionActor = {
    userId: userId || "unknown",
    role: userRole,
  };

  try {
    const txResult = await db.transaction(async (tx) => {
      // Step 1: Close/complete the job.
      // For invoice_now, close as invoice_later first (→ completed),
      // then create invoice and mark invoiced — all within this tx.
      const closeMode = mode === "invoice_now" ? "invoice_later" : mode;
      const result = await lifecycle.forceCloseJob({
        type: "FORCE_CLOSE_JOB",
        companyId,
        jobId,
        version,
        mode: closeMode,
        actor,
        invoiceId: undefined,
        autoCompleteOpenVisits: uncompletedVisits.length > 0 && autoCompleteOpenVisits,
      }, tx);
      let updatedJob = result.job;
      const autoCompletedVisitCount = result.autoCompletedVisitCount;

      // Step 2: For invoice_now, create invoice inside the same transaction.
      let createdInvoice = null;
      if (mode === "invoice_now") {
        const invoiceResult = await createInvoiceFromJobService(
          companyId,
          jobId,
          { markJobCompleted: false },
          "JOB_CLOSE_ROUTE",
          tx
        );
        createdInvoice = invoiceResult.invoice;

        // Step 3: Mark the completed job as invoiced via canonical MARK_INVOICED.
        const invoicedResult = await lifecycle.markInvoiced({
          type: "MARK_INVOICED",
          companyId,
          jobId,
          version: updatedJob.version,
          actor,
          invoiceId: createdInvoice.id,
        }, tx);
        updatedJob = invoicedResult.job;
      }

      return { updatedJob, createdInvoice, autoCompletedVisitCount };
    });

    const { updatedJob, createdInvoice, autoCompletedVisitCount } = txResult;

    // Log events (async, outside transaction — non-critical)
    const closeLabel = mode === "archive" ? "Archived" : mode === "invoice_now" ? "Closed & Invoiced" : "Completed (invoice later)";
    logEventAsync(getQueryCtx(req), {
      eventType: mode === "archive" ? "job.archived" : "job.completed",
      entityType: "job",
      entityId: jobId,
      summary: `Job #${updatedJob.jobNumber} — ${closeLabel}`,
      severity: "important",
      meta: { jobNumber: updatedJob.jobNumber, mode, invoiceId: createdInvoice?.id },
    });

    if (createdInvoice) {
      logEventAsync(getQueryCtx(req), {
        eventType: "invoice.created",
        entityType: "invoice",
        entityId: createdInvoice.id,
        summary: `Invoice #${createdInvoice.invoiceNumber} created from Job #${updatedJob.jobNumber}`,
        meta: { invoiceNumber: createdInvoice.invoiceNumber, jobId, jobNumber: updatedJob.jobNumber },
      });
    }
    recomputeAttentionForEntity(companyId, "job", jobId).catch(() => {});
    emitDispatch(companyId, { scope: "calendar", entityType: "job", entityId: jobId, ts: new Date().toISOString() });

    res.json({
      job: updatedJob,
      invoice: createdInvoice,
      autoCompletedVisitCount,
    });
  } catch (error: any) {
    if (error instanceof LifecycleTransitionError) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
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

  try {
    // 2026-03-18: Route through canonical lifecycle orchestrator
    const result = await lifecycle.reopenJob({
      type: "REOPEN_JOB",
      companyId,
      jobId,
      version: validated.version,
      actor,
      targetOpenSubStatus: targetOpenSubStatus as OpenSubStatus | undefined,
    });
    const updatedJob = result.job;

    // Phase 1: Log event + recompute attention
    logEventAsync(getQueryCtx(req), {
      eventType: "job.reopened",
      entityType: "job",
      entityId: jobId,
      summary: `Reopened Job #${updatedJob.jobNumber}`,
      meta: { jobNumber: updatedJob.jobNumber, targetOpenSubStatus },
    });
    recomputeAttentionForEntity(companyId, "job", jobId).catch(() => {});
    // Hardening: Emit dispatch signal for job reopen
    emitDispatch(companyId, { scope: "calendar", entityType: "job", entityId: jobId, ts: new Date().toISOString() });

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

  try {
    // 2026-03-18: Route through canonical lifecycle orchestrator
    const result = await lifecycle.undoCloseJob({
      type: "UNDO_CLOSE_JOB",
      companyId,
      jobId,
      version,
      actor,
    });

    res.json({ job: result.job });
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

  // 2026-03-18: Route through canonical lifecycle orchestrator
  const result = await lifecycle.setJobSubstatus({
    type: "SET_JOB_SUBSTATUS",
    companyId,
    jobId,
    openSubStatus: "on_route",
    additionalUpdates: { travelStartedAt: new Date() },
    changedBy: userId || "unknown",
  });

  res.json({ job: result.job });
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

  // 2026-03-18: Route through canonical lifecycle orchestrator
  const now = new Date();
  const result = await lifecycle.setJobSubstatus({
    type: "SET_JOB_SUBSTATUS",
    companyId,
    jobId,
    openSubStatus: "in_progress",
    additionalUpdates: {
      arrivedOnSiteAt: now,
      actualStart: now,
      // If travel wasn't started, set it to arrival time (tech drove without clicking start)
      travelStartedAt: existing.travelStartedAt || now,
    },
    changedBy: userId || "unknown",
  });

  res.json({ job: result.job });
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

  // Nothing to update
  if (payload.holdReason === undefined && payload.holdNotes === undefined && payload.nextActionDate === undefined) {
    return res.json({ job: existing });
  }

  // 2026-03-18: Route through canonical lifecycle orchestrator
  const result = await lifecycle.updateHoldMetadata({
    type: "UPDATE_HOLD_METADATA",
    companyId,
    jobId,
    holdReason: payload.holdReason as any,
    holdNotes: payload.holdNotes,
    nextActionDate: payload.nextActionDate ? new Date(payload.nextActionDate) : undefined,
    changedBy: userId || "unknown",
  });

  res.json({ job: result.job });
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

// GET /api/jobs/:id/billable-preview
//
// Read-only preview of the invoice lines that would be created from
// this job. Powers the future `/invoices/new` client-side builder —
// the user picks one or more eligible jobs, the builder hydrates the
// preview lines into local React state, lets the user edit / remove
// them, and submits the curated set on Save via
// `POST /api/invoices/atomic` (Phase 1).
//
// 2026-05-02 (Audit #2 invoice-flow Phase 2). PURE READ. The handler +
// the underlying `getJobBillablePreview` service do not mutate any
// row — see the file header in
// `server/services/jobBillablePreviewService.ts` for the full
// no-mutation list (no invoice row, no counter bump, no
// `invoicedAt` writes, no lifecycle transitions, no SSE emit, no
// QBO touch, no activity log).
//
// Auth + tenant safety: `MANAGER_ROLES` matches the existing
// `POST /api/invoices/from-job/:jobId` role requirement (the preview
// surfaces labor rates + cost data, same sensitivity profile). Tenant
// scoping is enforced inside the service via the `companyId`
// predicate on every SELECT — a stale jobId from another tenant
// returns 404, never the row.
//
// Example response shapes:
//
//   1) Eligible job with billable parts + labor:
//      200 OK
//      {
//        jobId: "…", jobNumber: 1234,
//        summary: "Spring AC tune-up",
//        description: null,
//        customerCompanyId: "cust-uuid",
//        locationId: "loc-uuid",
//        workDescriptionCandidate: "Spring AC tune-up",
//        lines: [
//          {
//            clientKey: "part-<uuid>",
//            sourceType: "part",
//            source: "job",
//            lineItemType: "material",
//            description: "Filter — 16x25",
//            quantity: "2",
//            unitPrice: "12.50",
//            unitCost: "6.00",
//            productId: "item-uuid",
//            jobLineItemId: "<jobParts.id>",
//            technicianId: null,
//            date: null,
//            lineSubtotal: "25.00"
//          },
//          {
//            clientKey: "labor-<techUserId>-regular",
//            sourceType: "labor",
//            source: "job",
//            lineItemType: "service",
//            description: "Labor - Regular (Alex Lee)",
//            quantity: "1.50",                  // hours, post-rules
//            unitPrice: "85.00",                // billed rate, post-rules
//            unitCost: "30.00",                 // cost rate snapshot
//            productId: null,
//            jobLineItemId: null,                // labor groups span entries
//            technicianId: "tech-user-uuid",
//            date: null,
//            lineSubtotal: "127.50"
//          }
//        ]
//      }
//
//   2) Eligible job with no billable items (empty parts + no
//      uninvoiced billable time entries):
//      200 OK
//      { jobId, jobNumber, summary, …, lines: [] }
//
//   3) Job already invoiced:
//      409 Conflict
//      { error: "Job is already invoiced (invoice id: …).",
//        detail: { jobId, invoiceId } }
//
//   4) Job not yet completed:
//      400 Bad Request
//      { error: "Job must be completed before it can be invoiced (current status: in_progress).",
//        detail: { jobId, status } }
//
//   5) Job from another tenant or missing:
//      404 Not Found
//      { error: "Job not found: <id>" }
router.get(
  "/:id/billable-preview",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) {
      throw createError(401, "Company context required.");
    }
    const jobId = req.params.id;

    try {
      const preview = await getJobBillablePreview(companyId, jobId);
      res.status(200).json(preview);
    } catch (err) {
      if (err instanceof JobBillablePreviewError) {
        // Manual response — `createError` doesn't carry structured
        // detail payloads. Mirrors the catch block on
        // `POST /api/invoices/atomic` so future client builders can
        // surface `detail.invoiceId` (already-invoiced) or
        // `detail.status` (not-completed) without string-matching
        // the error message.
        const body: Record<string, unknown> = { error: err.message };
        if (err.detail) body.detail = err.detail;
        res.status(err.status).json(body);
        return;
      }
      throw err;
    }
  }),
);

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

// ============================================================================
// JOB PARTS — canonical subset persistence model
// ----------------------------------------------------------------------------
// IMPORTANT — read this before adding any line-item field to job_parts:
//
// The `job_parts` table is a SUBSET-PERSISTENCE model relative to the canonical
// line-item shape (see shared/lineItem.ts). Job parts only store five fields:
//
//     description, productId, quantity, unitCost, unitPrice
//
// The canonical input schema accepts the FULL line-item contract (taxRate,
// taxAmount, lineSubtotal, lineTotal, lineItemType, source) so that every
// surface in the app talks one shape. The job-parts route handlers then
// PROJECT that input down to the persisted subset using the helper below.
// Anything not in the subset is silently dropped on insert/update.
//
// DO NOT add taxRate / taxAmount / lineSubtotal / lineTotal / lineItemType /
// source persistence to job_parts without an explicit schema migration AND
// updating the projector below — bypassing the projector means future
// canonical fields would silently start landing in the DB column list.
//
// 2026-04-08 P7: Migrated to canonical input.
// 2026-04-08 stabilization: Centralized subset projection (was four ad-hoc
// destructures across POST/PUT and the admin-override POST/PUT).
// ============================================================================
const createJobPartSchema = canonicalLineItemInput.strict();

/**
 * Project a validated canonical line-item input down to the exact set of
 * fields that the `job_parts` table persists. Used by all four job-parts
 * write paths (regular POST/PUT + admin-override POST/PUT) so the canonical
 * → DB projection lives in exactly one place.
 *
 * Behavior:
 *   - `description`, `quantity`, `unitPrice` use canonical defaults if absent.
 *     The canonical Zod schema also applies these defaults at runtime — the
 *     fallbacks here are belt-and-suspenders for type safety because Zod v3's
 *     `.default()` does not always narrow the inferred output type away from
 *     `string | undefined`. Both layers agree on the same default values.
 *   - `productId` defaults to `null` for manual lines.
 *   - `unitCost` is optional in the canonical schema; preserve `undefined` so
 *     the storage layer can distinguish "not set" from "set to 0".
 *   - All other canonical fields are silently dropped (see header comment).
 */
function canonicalToJobPartFields(input: {
  description: string;
  quantity?: string;
  unitPrice?: string;
  unitCost?: string;
  productId?: string | null;
}) {
  return {
    description: input.description,
    productId: input.productId ?? null,
    quantity: input.quantity ?? "1",
    unitCost: input.unitCost,
    unitPrice: input.unitPrice ?? "0.00",
  };
}

/**
 * Partial variant for PUT/PATCH paths. Returns only the fields that the
 * caller actually supplied; absent fields stay `undefined` so the storage
 * layer can leave them unchanged in the DB.
 */
function canonicalToJobPartUpdateFields(input: {
  description?: string;
  quantity?: string;
  unitPrice?: string;
  unitCost?: string;
  productId?: string | null;
}) {
  const out: {
    description?: string;
    productId?: string | null;
    quantity?: string;
    unitCost?: string;
    unitPrice?: string;
  } = {};
  if (input.description !== undefined) out.description = input.description;
  if (input.productId !== undefined) out.productId = input.productId;
  if (input.quantity !== undefined) out.quantity = input.quantity;
  if (input.unitCost !== undefined) out.unitCost = input.unitCost;
  if (input.unitPrice !== undefined) out.unitPrice = input.unitPrice;
  return out;
}

// POST /api/jobs/:jobId/parts - Add part to job
router.post("/:jobId/parts", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;

  const job = await storage.getJob(companyId, req.params.jobId);
  if (!job) throw createError(404, "Job not found");

  const validated = validateSchema(createJobPartSchema, req.body);

  // Project canonical input → job_parts subset (centralized; see top of file)
  const jobPart = await storage.createJobPart(companyId, req.params.jobId, {
    companyId,
    jobId: req.params.jobId,
    ...canonicalToJobPartFields(validated),
  });

  res.status(201).json(jobPart);
}));

// 2026-04-08: P7 — Migrated to canonical line-item input (partial for PATCH).
const updateJobPartSchema = canonicalLineItemInput.partial().strict();

// PUT /api/jobs/:jobId/parts/:id - Update job part
router.put("/:jobId/parts/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;

  const job = await storage.getJob(companyId, req.params.jobId);
  if (!job) throw createError(404, "Job not found");

  const validated = validateSchema(updateJobPartSchema, req.body);
  // Project canonical partial input → job_parts subset (centralized; see top of file)
  const jobPart = await storage.updateJobPart(
    companyId,
    req.params.id,
    canonicalToJobPartUpdateFields(validated),
  );
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

import { jobNotesRepository } from "../storage/jobNotes";

// =====================================================================
// Billable preview (Phase 8: invoice composition control)
// =====================================================================
//
// GET /api/jobs/:jobId/billable-preview
//
// Returns every item on a job that is eligible to be billed on the NEXT
// invoice — i.e., time entries that haven't been invoiced yet (filtered
// by the canonical `invoicedAt IS NULL` + `isNotNull(endAt)` + `billable`
// predicates) and job parts that aren't already on any sibling invoice's
// `source='job'` lines (using the same `jobLineItemId` allocation
// signal as `refreshInvoiceFromJob`).
//
// Labor amounts are computed through the canonical billing-rules engine
// (`applyBillingRulesToEntries`) so the preview totals match what the
// server will actually write at invoice-creation time.
//
// Response shape:
//   {
//     labor: [{ id, startAt, technicianId, technicianName, type,
//                billedMinutes, billedRate, billedAmount }],
//     parts: [{ id, description, quantity, unitPrice, lineSubtotal }],
//     laborSubtotal: string,   // money string, e.g. "123.45"
//     partsSubtotal: string,
//     subtotal: string,
//   }
//
// Tax is NOT computed here — that's per-invoice via the existing tax
// engine applied at create time. The client previews tax optimistically
// using the job's default tax group; the server remains the source of
// truth at create time.
router.get(
  "/:jobId/billable-preview",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const jobId = req.params.jobId;
    const { invoiceRepository } = await import("../storage/invoices");
    const preview = await invoiceRepository.getBillablePreviewForJob(companyId, jobId);
    res.json(preview);
  }),
);

// GET /api/jobs/:jobId/notes - List job notes + inherited client notes (showOnJobs).
// 2026-04-18: dynamic read-time inheritance. Merges entity-owned job_notes with
// matching client_notes (location / customer-company / tenant-wide) where
// show_on_jobs = true. Each row carries `origin` + `editable` so the UI does
// zero derivation.
router.get("/:jobId/notes", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const jobId = req.params.jobId;

  // 1) Entity-owned job notes (existing canonical path; throws 404 if job missing/inactive).
  const ownedRaw = await jobNotesRepository.listJobNotes(companyId, jobId);
  const owned = ownedRaw.map((n) => ({ ...n, origin: "job" as const, editable: true }));

  // 2) Resolve job's location → customer company for inheritance scope.
  const [jobScope] = await db
    .select({
      locationId: jobsTable.locationId,
      customerCompanyId: clientLocations.parentCompanyId,
    })
    .from(jobsTable)
    .leftJoin(clientLocations, eq(jobsTable.locationId, clientLocations.id))
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.companyId, companyId)))
    .limit(1);

  let inherited: any[] = [];
  if (jobScope?.locationId) {
    const rows = await clientNotesRepository.listInheritedForEntity(companyId, {
      locationId: jobScope.locationId,
      customerCompanyId: jobScope.customerCompanyId ?? null,
      surface: "jobs",
    });
    inherited = rows.map((r) => ({
      id: r.id,
      jobId: null,
      equipmentId: null,
      noteText: r.noteText,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      user: null,
      userName: r.createdByName,
      attachments: r.attachments,
      origin: r.origin,
      editable: false,
    }));
  }

  // 3) Merge + sort newest first. UUID PKs guarantee no duplicates across sources.
  const merged = [...owned, ...inherited].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  res.json(merged);
}));

// POST /api/jobs/:jobId/notes - Create job note (with optional attachmentFileIds)
router.post("/:jobId/notes", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const userId = req.user!.id;

  const { noteText, attachmentFileIds, equipmentId } = req.body;

  if (!noteText || typeof noteText !== 'string' || noteText.trim().length === 0) {
    throw createError(400, "noteText is required and must be a non-empty string");
  }

  const note = await jobNotesRepository.createJobNote(companyId, req.params.jobId, userId, noteText.trim(), equipmentId ?? null);

  // Attach files if provided
  if (Array.isArray(attachmentFileIds) && attachmentFileIds.length > 0 && note) {
    const { jobNoteAttachmentRepository } = await import("../storage/jobNoteAttachments");
    for (const fileId of attachmentFileIds) {
      if (typeof fileId === "string" && fileId.length > 0) {
        await jobNoteAttachmentRepository.attach(companyId, userId, note.id, fileId);
      }
    }
  }

  // Realtime: notify tech app + cross-tab office sessions about new note on this job
  emitDispatch(companyId, { scope: "calendar", entityType: "job", entityId: req.params.jobId, ts: new Date().toISOString() });

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

  const note = await jobNotesRepository.updateJobNote(companyId, req.params.noteId, userId, noteText.trim());

  // Realtime: notify tech app + cross-tab office about edited note
  emitDispatch(companyId, { scope: "calendar", entityType: "job", entityId: req.params.jobId, ts: new Date().toISOString() });

  res.json(note);
}));

// DELETE /api/jobs/:jobId/notes/:noteId/attachments/:attachmentId - Detach a single attachment
// 2026-04-13: canonical per-attachment removal for the unified
// EntityNoteDialog. Cascade on note delete stays the only path to drop
// all attachments at once.
router.delete(
  "/:jobId/notes/:noteId/attachments/:attachmentId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const { jobNoteAttachmentRepository } = await import("../storage/jobNoteAttachments");
    const removed = await jobNoteAttachmentRepository.detach(companyId, req.params.attachmentId);
    if (!removed) throw createError(404, "Attachment not found");
    emitDispatch(companyId, { scope: "calendar", entityType: "job", entityId: req.params.jobId, ts: new Date().toISOString() });
    res.json({ success: true });
  })
);

// DELETE /api/jobs/:jobId/notes/:noteId - Delete job note
router.delete("/:jobId/notes/:noteId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const userId = req.user!.id;

  const result = await jobNotesRepository.deleteJobNote(companyId, req.params.noteId, userId);

  // Realtime: notify tech app + cross-tab office about deleted note
  emitDispatch(companyId, { scope: "calendar", entityType: "job", entityId: req.params.jobId, ts: new Date().toISOString() });

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

  // Project canonical input → job_parts subset (centralized; see top of file)
  const jobPart = await storage.createJobPart(
    companyId,
    jobId,
    {
      companyId,
      jobId,
      ...canonicalToJobPartFields(validated),
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
  // Project canonical partial input → job_parts subset (centralized; see top of file)
  const jobPart = await storage.updateJobPart(
    companyId,
    partId,
    canonicalToJobPartUpdateFields(validated),
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

// ============================================================================
// 2026-04-12 Phase 7: Job email dispatch
// ============================================================================
// Canonical path (matches invoice/quote): validate → dispatch → log.
// No PDF attachment in v1.

const jobEmailBodySchema = z.object({
  recipients: z.array(z.string().email()).min(1, "At least one recipient required"),
  subjectOverride: z
    .string()
    .optional()
    .refine((v) => v === undefined || v.trim().length > 0, { message: "subjectOverride cannot be blank" }),
  bodyOverride: z
    .string()
    .optional()
    .refine((v) => v === undefined || v.trim().length > 0, { message: "bodyOverride cannot be blank" }),
}).passthrough();

const renderJobEmailSchema = z.object({
  recipients: z.array(z.string().email()).optional(),
}).passthrough();

router.post(
  "/:id/render-email",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId!;
    const jobId = req.params.id;
    const { recipients } = validateSchema(renderJobEmailSchema, req.body ?? {});
    const data = await templateDataBuilder.buildJobTemplateData(tenantId, jobId);
    const rendered = await communicationTemplatesService.renderTemplateForEntity(
      tenantId, "job", "email", data,
    );
    if (!rendered) throw createError(500, "No template or default available for job email");
    res.json({ subject: rendered.subject, body: rendered.body, recipients: recipients ?? [] });
  }),
);

router.get(
  "/:id/email-recipients",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    res.json(
      await recipientResolverService.getDefaultRecipients({
        tenantId: req.companyId!, entityType: "job", entityId: req.params.id,
      }),
    );
  }),
);

router.post(
  "/:id/email",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId!;
    const jobId = req.params.id;
    const { recipients, subjectOverride, bodyOverride } = validateSchema(
      jobEmailBodySchema,
      req.body ?? {},
    );

    const dispatch = await emailDispatchService.sendJobEmail({
      tenantId,
      jobId,
      recipients,
      subjectOverride,
      bodyOverride,
      createdByUserId: req.user?.id ?? null,
    });

    logEventAsync(getQueryCtx(req), {
      eventType: "job.emailed",
      entityType: "job",
      entityId: jobId,
      summary: `Job email dispatched to ${dispatch.recipients.length} recipient(s)`,
      meta: {
        recipients: dispatch.recipients,
        resendId: dispatch.emailId,
      },
    });

    res.json({
      dispatch: {
        emailId: dispatch.emailId,
        recipients: dispatch.recipients,
        subject: dispatch.subject,
        attachmentFilename: dispatch.attachmentFilename,
      },
    });
  }),
);

export default router;
