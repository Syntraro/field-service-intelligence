import { Router, Response } from "express";
// 2026-03-18: Deprecated service wrapper removed — import canonical repository directly
import { jobVisitsRepository } from "../storage/jobVisits";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { parsePaginationLenient } from "../utils/pagination";
import { paginatedCompat } from "../utils/paginatedResponse";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import { jobVisitStatusEnum, visitOutcomeEnum, holdReasonEnum } from "../../shared/schema";
import { logEventAsync } from "../lib/events";
import { getQueryCtx } from "../lib/queryCtx";
import { storage } from "../storage/index";
import { emitDispatch } from "../lib/dispatchBus";
import { normalizeScheduleTimes } from "../domain/scheduling";
import * as lifecycle from "../services/jobLifecycleOrchestrator";

const router = Router();

// ========================================
// VALIDATION SCHEMAS
// ========================================

const createVisitSchema = z.object({
  scheduledDate: z.string().datetime(),
  estimatedDurationMinutes: z.number().int().positive().default(60),
  assignedTechnicianIds: z.array(z.string().uuid()).optional(),
  visitNotes: z.string().max(2000).optional(),
}).strict();

const updateVisitSchema = z.object({
  scheduledDate: z.string().datetime().optional(),
  scheduledStart: z.string().datetime().nullable().optional(),
  scheduledEnd: z.string().datetime().nullable().optional(),
  isAllDay: z.boolean().optional(),
  estimatedDurationMinutes: z.number().int().min(0).nullable().optional(),
  assignedTechnicianIds: z.array(z.string().uuid()).optional(),
  // 2026-03-27: Visit equipment selection — location_equipment IDs being worked on this visit
  equipmentIds: z.array(z.string()).nullable().optional(),
  visitNotes: z.string().max(2000).nullable().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(jobVisitStatusEnum),
}).strict();

// ========================================
// ROUTES
// ========================================

/* GET /api/jobs/:jobId/visits - List visits for a job */
/* Supports ?all=true to include inactive visits for history display */
router.get(
  "/:jobId/visits",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;

    // PHASE 4: If ?all=true, return all visits including inactive for Job Detail panel
    if (req.query.all === "true") {
      const visits = await jobVisitsRepository.listAllJobVisitsForJob(companyId, req.params.jobId);
      return res.json(visits);
    }

    // Default behavior: paginated active visits only
    const { params, explicit } = parsePaginationLenient(req.query);

    const offset = params.offset ?? 0;
    const limit = params.limit;

    const result = await jobVisitsRepository.listJobVisits({
      companyId,
      jobId: req.params.jobId,
      status: req.query.status as string | undefined,
      assignedTechnicianIds: req.query.assignedTechnicianId
        ? [req.query.assignedTechnicianId as string]
        : undefined,
      offset,
      limit,
    });

    const meta = {
      limit,
      hasMore: result.hasMore,
      nextOffset: result.hasMore ? offset + limit : undefined,
    };

    res.json(paginatedCompat(result.items, meta, explicit));
  })
);

/* POST /api/jobs/:jobId/visits - Create new visit */
router.post(
  "/:jobId/visits",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;

    const validated = validateSchema(createVisitSchema, req.body);

    const visit = await jobVisitsRepository.createJobVisit(
      companyId,
      req.params.jobId,
      validated
    );

    // Technician-originated dispatch signal: new visit may appear on calendar
    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: visit.id, ts: new Date().toISOString() });

    res.status(201).json(visit);
  })
);

/* GET /api/jobs/:jobId/visits/:visitId - Get single visit */
router.get(
  "/:jobId/visits/:visitId",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;

    const visit = await jobVisitsRepository.getJobVisit(companyId, req.params.visitId);
    if (!visit) {
      throw createError(404, "Visit not found");
    }

    res.json(visit);
  })
);

/* PATCH /api/jobs/:jobId/visits/:visitId - Update visit */
router.patch(
  "/:jobId/visits/:visitId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;

    const { version, ...data } = req.body;
    const validated = validateSchema(updateVisitSchema, data);

    // Normalize all-day timestamps through canonical path to guarantee UTC boundaries.
    // This prevents local-timezone Date shifts from violating jobs_all_day_*_check constraints.
    const input: Record<string, unknown> = { ...validated };
    if (validated.isAllDay === true && validated.scheduledStart) {
      const normalized = normalizeScheduleTimes({
        allDay: true,
        startAt: validated.scheduledStart as string,
      });
      input.scheduledStart = normalized.scheduledStart;
      input.scheduledEnd = normalized.scheduledEnd;
      input.isAllDay = true;
    } else {
      // Timed or unscheduled: convert ISO strings to Date objects for Drizzle
      if ("scheduledStart" in input) {
        input.scheduledStart = input.scheduledStart ? new Date(input.scheduledStart as string) : null;
      }
      if ("scheduledEnd" in input) {
        input.scheduledEnd = input.scheduledEnd ? new Date(input.scheduledEnd as string) : null;
      }
    }
    if ("scheduledDate" in input && input.scheduledDate) {
      input.scheduledDate = new Date(input.scheduledDate as string);
    }

    try {
      const updated = await jobVisitsRepository.updateJobVisit(
        companyId,
        req.params.visitId,
        version,
        input
      );

      if (!updated) {
        throw createError(404, "Visit not found");
      }

      // Technician-originated dispatch signal: visit fields changed
      emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: req.params.visitId, ts: new Date().toISOString() });

      res.json(updated);
    } catch (error: any) {
      if (error.message?.includes("modified by another user")) {
        return res.status(409).json({
          error: error.message,
          code: "VERSION_MISMATCH",
        });
      }
      throw error;
    }
  })
);

/* DELETE /api/jobs/:jobId/visits/:visitId - Delete visit (soft delete)
 * 2026-03-24: Placeholder visit #1 guard REMOVED. Any visit can now be deleted.
 * When deleting the last actionable visit on an open job, the job is moved to
 * on_hold via canonical placeJobOnHold() so it surfaces for dispatcher review
 * instead of falling into the unscheduled backlog. */
router.delete(
  "/:jobId/visits/:visitId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const jobId = req.params.jobId;

    const visit = await jobVisitsRepository.getJobVisit(companyId, req.params.visitId);
    if (!visit) {
      throw createError(404, "Visit not found");
    }

    // Soft-delete the visit through canonical storage path (sets isActive=false,
    // calls syncJobScheduleFromVisits which clears job schedule fields if needed)
    const result = await jobVisitsRepository.deleteJobVisit(companyId, req.params.visitId);

    // Post-delete: if zero actionable visits remain on an open job that is not
    // already on_hold, move to on_hold so the job surfaces for dispatcher review
    // instead of appearing as unscheduled backlog.
    const remaining = await jobVisitsRepository.getUncompletedVisits(companyId, jobId);
    if (remaining.length === 0) {
      // Guard: only place on hold if job is open and not already on_hold.
      // Terminal jobs (completed/invoiced/archived) are skipped.
      const job = await storage.getJob(companyId, jobId);
      if (job && job.status === "open" && job.openSubStatus !== "on_hold") {
        await lifecycle.placeJobOnHold({
          type: "PLACE_JOB_ON_HOLD",
          companyId,
          jobId,
          holdReason: "other",
          holdNotes: "All visits removed — needs dispatcher review",
          changedBy: req.user?.id || "system",
        });
      }
    }

    // Dispatch signal: visit removed from calendar
    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: req.params.visitId, ts: new Date().toISOString() });

    res.json(result);
  })
);

/* POST /api/jobs/:jobId/visits/:visitId/status - Update visit status (non-terminal only) */
/* 2026-03-18: Completion redirected to orchestrator via /complete endpoint */
router.post(
  "/:jobId/visits/:visitId/status",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;

    const { status } = validateSchema(updateStatusSchema, req.body);

    // Reject completion via this endpoint — must use /complete with outcome
    if (status === "completed") {
      throw createError(400, "Visit completion requires an explicit outcome. Use POST /api/jobs/:jobId/visits/:visitId/complete instead.");
    }

    // Fix C: Reject uncompleting a visit when job is in a terminal status.
    const TERMINAL_JOB_STATUSES = ["completed", "invoiced", "archived"];
    const job = await storage.getJob(companyId, req.params.jobId);
    if (job && TERMINAL_JOB_STATUSES.includes(job.status)) {
      const err = createError(409, "Reopen job to uncomplete a visit.");
      (err as any).code = "JOB_TERMINAL";
      throw err;
    }

    // Non-terminal status transitions — not lifecycle, just workflow
    const updated = await jobVisitsRepository.updateJobVisitStatus(companyId, req.params.visitId, status);

    // Phase 4B.1: Emit milestone event for status transitions
    const ctx = getQueryCtx(req);
    if (status === "in_progress" || status === "on_site") {
      logEventAsync(ctx, {
        eventType: "visit.started",
        entityType: "visit",
        entityId: req.params.visitId,
        summary: `Visit started (job ${req.params.jobId})`,
        meta: { jobId: req.params.jobId, status },
      });
    }

    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: req.params.visitId, ts: new Date().toISOString() });

    res.json(updated);
  })
);

/* POST /api/jobs/:jobId/visits/:visitId/complete - Complete visit with explicit outcome */
/* 2026-03-17: Primary completion endpoint with outcome selection + parent job reconciliation */
const completeVisitWithOutcomeSchema = z.object({
  outcome: z.enum(visitOutcomeEnum),
  holdReason: z.enum(holdReasonEnum).nullable().optional(),
  holdNotes: z.string().max(2000).nullable().optional(),
}).strict().refine(
  (data) => {
    // holdReason required when outcome is not "completed"
    if (data.outcome !== "completed" && !data.holdReason) return false;
    return true;
  },
  { message: "Hold reason is required when outcome is 'needs_parts' or 'needs_followup'" }
);

router.post(
  "/:jobId/visits/:visitId/complete",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { jobId, visitId } = req.params;

    const { outcome, holdReason, holdNotes } = validateSchema(
      completeVisitWithOutcomeSchema,
      req.body
    );

    // 2026-03-18: Delegate entirely to the lifecycle orchestrator
    const result = await lifecycle.completeVisit({
      type: "COMPLETE_VISIT",
      companyId,
      visitId,
      jobId,
      outcome,
      holdReason,
      holdNotes,
      completedByUserId: req.user?.id || "unknown",
    });

    // Emit events
    const ctx = getQueryCtx(req);
    logEventAsync(ctx, {
      eventType: "visit.completed",
      entityType: "visit",
      entityId: visitId,
      summary: `Visit completed with outcome=${outcome} (job ${jobId})`,
      meta: { jobId, outcome, holdReason, result },
    });

    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: visitId, ts: new Date().toISOString() });

    res.json(result);
  })
);

/* POST /api/jobs/:jobId/visits/:visitId/reopen - Reopen a completed visit */
/* 2026-03-20: Auto-reopens parent job if terminal, then resets visit to scheduled. */
router.post(
  "/:jobId/visits/:visitId/reopen",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { jobId, visitId } = req.params;
    const userId = req.user?.id || "unknown";
    const userRole = req.user?.role || "unknown";

    const result = await lifecycle.reopenVisit({
      type: "REOPEN_VISIT",
      companyId,
      visitId,
      jobId,
      actor: { userId, role: userRole },
    });

    const ctx = getQueryCtx(req);
    logEventAsync(ctx, {
      eventType: "visit.reopened",
      entityType: "visit",
      entityId: visitId,
      summary: `Visit reopened (job ${jobId})${result.jobWasReopened ? " — parent job auto-reopened" : ""}`,
      meta: { jobId, jobWasReopened: result.jobWasReopened },
    });

    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: visitId, ts: new Date().toISOString() });
    if (result.jobWasReopened) {
      emitDispatch(companyId, { scope: "calendar", entityType: "job", entityId: jobId, ts: new Date().toISOString() });
    }

    res.json(result);
  })
);

// 2026-04-12: Office check-in / check-out endpoints removed.
// Product rule: only technicians check themselves in/out, and only from the
// tech app. Office/dispatcher/admin users manage labor exclusively through
// manual time entries (see server/routes/timeTracking.ts). Any caller that
// still hits the old paths below will now 404, which is the intended signal.
//
//   POST /api/jobs/:jobId/visits/:visitId/check-in   — REMOVED
//   POST /api/jobs/:jobId/visits/:visitId/check-out  — REMOVED

// ========================================
// POST /api/jobs/:jobId/visits/:visitId/arrived — Phase 4B.1: Technician arrived on site
// ========================================

router.post(
  "/:jobId/visits/:visitId/arrived",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { jobId, visitId } = req.params;

    // Verify visit exists and belongs to company
    const visit = await jobVisitsRepository.getJobVisit(companyId, visitId);
    if (!visit) throw createError(404, "Visit not found");

    // Log tech.arrived milestone event
    const ctx = getQueryCtx(req);
    logEventAsync(ctx, {
      eventType: "tech.arrived",
      entityType: "visit",
      entityId: visitId,
      summary: `Technician arrived at site (job ${jobId})`,
      meta: { jobId, visitId },
    });

    // Technician-originated dispatch signal: refreshes activity timeline in open panel
    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: visitId, ts: new Date().toISOString() });

    res.json({ success: true, event: "tech.arrived" });
  })
);

// ========================================
// POST /api/jobs/:jobId/visits/:visitId/departed — Phase 4B.1: Technician departed site
// ========================================

router.post(
  "/:jobId/visits/:visitId/departed",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { jobId, visitId } = req.params;

    // Verify visit exists and belongs to company
    const visit = await jobVisitsRepository.getJobVisit(companyId, visitId);
    if (!visit) throw createError(404, "Visit not found");

    // Log tech.departed milestone event
    const ctx = getQueryCtx(req);
    logEventAsync(ctx, {
      eventType: "tech.departed",
      entityType: "visit",
      entityId: visitId,
      summary: `Technician departed from site (job ${jobId})`,
      meta: { jobId, visitId },
    });

    // Technician-originated dispatch signal: refreshes activity timeline in open panel
    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: visitId, ts: new Date().toISOString() });

    res.json({ success: true, event: "tech.departed" });
  })
);

// ========================================
// POST /api/jobs/:jobId/visits/:visitId/archive — Soft-delete via archive (2026-03-05)
// Sets archivedAt, archivedByUserId, archivedReason. Does NOT delete related data.
// ========================================

const archiveVisitSchema = z.object({
  reason: z.string().max(500).optional(),
}).strict();

router.post(
  "/:jobId/visits/:visitId/archive",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;
    const { visitId } = req.params;
    const { reason } = validateSchema(archiveVisitSchema, req.body || {});

    const visit = await jobVisitsRepository.getJobVisit(companyId, visitId);
    if (!visit) throw createError(404, "Visit not found");

    if (visit.archivedAt) {
      throw createError(409, "Visit is already archived");
    }

    const updated = await jobVisitsRepository.updateJobVisit(
      companyId,
      visitId,
      visit.version,
      {
        archivedAt: new Date(),
        archivedByUserId: userId,
        archivedReason: reason || null,
      }
    );

    // Technician-originated dispatch signal: archived visit removed from active calendar
    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: visitId, ts: new Date().toISOString() });

    res.json(updated);
  })
);

export default router;
