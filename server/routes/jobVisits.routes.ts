import { Router, Response } from "express";
import * as service from "../services/jobVisits.service";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { parsePaginationLenient } from "../utils/pagination";
import { paginatedCompat } from "../utils/paginatedResponse";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import { jobVisitStatusEnum } from "../../shared/schema";
import { logEventAsync } from "../lib/events";
import { getQueryCtx } from "../lib/queryCtx";
import { storage } from "../storage/index";
import { emitDispatch } from "../lib/dispatchBus";
import { normalizeScheduleTimes } from "../domain/scheduling";

const router = Router();

// ========================================
// VALIDATION SCHEMAS
// ========================================

const createVisitSchema = z.object({
  scheduledDate: z.string().datetime(),
  estimatedDurationMinutes: z.number().int().positive().default(60),
  assignedTechnicianId: z.string().uuid().optional(),
  visitNotes: z.string().max(2000).optional(),
}).strict();

const updateVisitSchema = z.object({
  scheduledDate: z.string().datetime().optional(),
  scheduledStart: z.string().datetime().nullable().optional(),
  scheduledEnd: z.string().datetime().nullable().optional(),
  isAllDay: z.boolean().optional(),
  estimatedDurationMinutes: z.number().int().min(0).nullable().optional(),
  assignedTechnicianId: z.string().uuid().nullable().optional(),
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
      const visits = await service.listAllJobVisitsForJob(companyId, req.params.jobId);
      return res.json(visits);
    }

    // Default behavior: paginated active visits only
    const { params, explicit } = parsePaginationLenient(req.query);

    const offset = params.offset ?? 0;
    const limit = params.limit;

    const result = await service.listJobVisits({
      companyId,
      jobId: req.params.jobId,
      status: req.query.status as string | undefined,
      assignedTechnicianId: req.query.assignedTechnicianId as string | undefined,
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

    const visit = await service.createJobVisit(
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

    const visit = await service.getJobVisit(companyId, req.params.visitId);
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
      const updated = await service.updateJobVisit(
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

/* DELETE /api/jobs/:jobId/visits/:visitId - Delete visit (soft delete) */
router.delete(
  "/:jobId/visits/:visitId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;

    // Guard: prevent deleting placeholder visit #1 (visitNumber=1, unscheduled, active)
    const visit = await service.getJobVisit(companyId, req.params.visitId);
    if (!visit) {
      throw createError(404, "Visit not found");
    }
    if (visit.visitNumber === 1 && !visit.scheduledStart && visit.isActive) {
      throw createError(409, "Cannot delete placeholder visit #1. Unschedule or clear it instead.");
    }

    const result = await service.deleteJobVisit(companyId, req.params.visitId);

    // Technician-originated dispatch signal: visit removed from calendar
    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: req.params.visitId, ts: new Date().toISOString() });

    res.json(result);
  })
);

/* POST /api/jobs/:jobId/visits/:visitId/status - Update visit status */
router.post(
  "/:jobId/visits/:visitId/status",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;

    const { status } = validateSchema(updateStatusSchema, req.body);

    // Fix C: Reject uncompleting a visit when job is in a terminal status.
    // Moving a visit away from "completed" on a closed job would create
    // an inconsistent state (completed job with active visit).
    const TERMINAL_JOB_STATUSES = ["completed", "invoiced", "archived"];
    if (status !== "completed") {
      const job = await storage.getJob(companyId, req.params.jobId);
      if (job && TERMINAL_JOB_STATUSES.includes(job.status)) {
        throw createError(409, "Reopen job to uncomplete a visit.");
      }
    }

    const updated = await service.updateJobVisitStatus(
      companyId,
      req.params.visitId,
      status
    );

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
    } else if (status === "completed") {
      logEventAsync(ctx, {
        eventType: "visit.completed",
        entityType: "visit",
        entityId: req.params.visitId,
        summary: `Visit completed (job ${req.params.jobId})`,
        meta: { jobId: req.params.jobId },
      });
    }

    // Technician-originated dispatch signal: visit status dot/checkmark changes on board
    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: req.params.visitId, ts: new Date().toISOString() });

    res.json(updated);
  })
);

/* POST /api/jobs/:jobId/visits/:visitId/check-in - Check in to visit */
router.post(
  "/:jobId/visits/:visitId/check-in",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;

    const visit = await service.checkInJobVisit(companyId, req.params.visitId);

    // Phase 4B.1: Emit visit.started event on check-in
    const ctx = getQueryCtx(req);
    logEventAsync(ctx, {
      eventType: "visit.started",
      entityType: "visit",
      entityId: req.params.visitId,
      summary: `Technician checked in to visit (job ${req.params.jobId})`,
      meta: { jobId: req.params.jobId, trigger: "check-in" },
    });

    // Technician-originated dispatch signal: on_site status dot appears on board
    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: req.params.visitId, ts: new Date().toISOString() });

    res.json(visit);
  })
);

/* POST /api/jobs/:jobId/visits/:visitId/check-out - Check out from visit */
router.post(
  "/:jobId/visits/:visitId/check-out",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;

    const visit = await service.checkOutJobVisit(companyId, req.params.visitId);

    // Phase 4B.1: Emit visit.completed event on check-out
    const ctx = getQueryCtx(req);
    logEventAsync(ctx, {
      eventType: "visit.completed",
      entityType: "visit",
      entityId: req.params.visitId,
      summary: `Technician checked out from visit (job ${req.params.jobId})`,
      meta: { jobId: req.params.jobId, trigger: "check-out" },
    });

    // Technician-originated dispatch signal: completed checkmark appears on board
    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: req.params.visitId, ts: new Date().toISOString() });

    res.json(visit);
  })
);

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
    const visit = await service.getJobVisit(companyId, visitId);
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
    const visit = await service.getJobVisit(companyId, visitId);
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

    const visit = await service.getJobVisit(companyId, visitId);
    if (!visit) throw createError(404, "Visit not found");

    if (visit.archivedAt) {
      throw createError(409, "Visit is already archived");
    }

    const updated = await service.updateJobVisit(
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
