import { Router, Response } from "express";
// 2026-03-18: Deprecated service wrapper removed — import canonical repository directly
import { jobVisitsRepository } from "../storage/jobVisits";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { parsePaginationLenient } from "../utils/pagination";
import { paginatedCompat } from "../utils/paginatedResponse";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import { jobVisitStatusEnum, visitOutcomeEnum, holdReasonEnum, jobs as jobsTable, clientLocations, customerCompanies } from "../../shared/schema";
import { db } from "../db";
import { logEventAsync } from "../lib/events";
import { getQueryCtx } from "../lib/queryCtx";
import { storage } from "../storage/index";
import { emitDispatch } from "../lib/dispatchBus";
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

// ============================================================================
// PATCH /api/jobs/:jobId/visits/:visitId — METADATA-ONLY contract
// ============================================================================
// 2026-04-21 Phase 1 canonical visit mutation architecture:
//
// This route is the NARROW METADATA PATCH. It may only write lightweight
// fields that have no lifecycle / scheduling / reconciliation side effects:
//
//   - visitNotes    (free text, dispatcher-visible instructions)
//   - equipmentIds  (array of location_equipment IDs pre-loaded for this visit)
//
// Every operational field is REJECTED here by `.strict()`:
//   - scheduledStart / scheduledEnd / scheduledDate / isAllDay /
//     estimatedDurationMinutes → route through PATCH /api/calendar/visit/:id/reschedule
//   - assignedTechnicianIds                                       → route through PATCH /api/calendar/visit/:id/assign-crew
//   - status                                                      → route through POST /api/jobs/:jobId/visits/:visitId/status
//
// DO NOT widen this schema. The whole point of Model B is one narrow
// metadata path + one canonical operational engine. Any new visit field
// that has ANY lifecycle implication (spawn protection, time entry side
// effects, single-active-visit invariants) MUST go through the
// `jobLifecycleOrchestrator`, not through this route.
// 2026-04-21 Phase 1: exported so tests can pin the metadata-only contract.
// Any change to this schema is a source-of-truth violation unless it is a
// lightweight-metadata field with zero lifecycle implications.
export const updateVisitSchema = z.object({
  visitNotes: z.string().max(2000).nullable().optional(),
  // 2026-03-27: Visit equipment selection — location_equipment IDs being worked on this visit
  equipmentIds: z.array(z.string()).nullable().optional(),
}).strict();

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

/* PATCH /api/jobs/:jobId/visits/:visitId - Update visit METADATA only.
 *
 * 2026-04-21 Phase 1 canonical visit mutation architecture: narrow metadata
 * path. Only `visitNotes` and `equipmentIds` may be written here. See the
 * comment above `updateVisitSchema` for the full contract and the canonical
 * routes that own every other visit field. */
router.patch(
  "/:jobId/visits/:visitId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;

    const { version, ...data } = req.body;
    const validated = validateSchema(updateVisitSchema, data);

    try {
      const updated = await jobVisitsRepository.updateJobVisit(
        companyId,
        req.params.visitId,
        version,
        validated,
      );

      if (!updated) {
        throw createError(404, "Visit not found");
      }

      // Dispatch signal: visit metadata changed — clients refresh notes / equipment panels
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

/* POST /api/jobs/:jobId/visits/:visitId/status — Office visit status route.
 *
 * 2026-04-21 Phase 1 canonical visit mutation architecture:
 * This route is now a THIN DELEGATOR. Every accepted status transition
 * routes through `jobLifecycleOrchestrator` so the invariants (single
 * active visit, time-entry cleanup, schedule sync) fire uniformly
 * regardless of whether the transition came from the tech app or from
 * dispatch. Direct-storage status writes from this route are prohibited.
 *
 * Mapping (target → orchestrator method):
 *   en_route                    → setVisitEnRoute
 *   on_site / in_progress       → startVisit
 *   paused                      → pauseVisit
 *   scheduled   (from en_route) → cancelVisitRoute
 *   scheduled   (from paused)   → resumeVisit-like restore (delegated to orchestrator)
 *   cancelled                   → cancelVisit
 *
 * Rejected at this route:
 *   completed — must POST /complete with explicit outcome
 *   on_hold   — hold is a JOB-level concept, not a visit status
 *   dispatched — not exposed through this office route; use /assign-crew
 *                + the tech-app lifecycle to express "I'm dispatching this"
 */
router.post(
  "/:jobId/visits/:visitId/status",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { jobId, visitId } = req.params;

    const { status } = validateSchema(updateStatusSchema, req.body);

    // Explicitly-rejected targets — point callers at the canonical route.
    if (status === "completed") {
      throw createError(
        400,
        "Visit completion requires an explicit outcome. Use POST /api/jobs/:jobId/visits/:visitId/complete instead.",
      );
    }
    if (status === "on_hold") {
      throw createError(400, "Hold is a job-level state. Use POST /api/jobs/:jobId/status to place the job on hold.");
    }
    if (status === "dispatched") {
      throw createError(400, "Status 'dispatched' is not settable from this route. Assign crew + let the tech app drive lifecycle transitions.");
    }

    // Terminal-job guard kept here because orchestrator methods do not
    // uniformly enforce it for the non-terminal transitions below. If the
    // parent job is already closed, no visit status change should land.
    const TERMINAL_JOB_STATUSES = ["completed", "invoiced", "archived"];
    const job = await storage.getJob(companyId, jobId);
    if (job && TERMINAL_JOB_STATUSES.includes(job.status)) {
      const err = createError(409, "Reopen job to uncomplete a visit.");
      (err as any).code = "JOB_TERMINAL";
      throw err;
    }

    const existing = await jobVisitsRepository.getJobVisit(companyId, visitId);
    if (!existing) throw createError(404, "Visit not found");

    // Delegate to the orchestrator. The route does not own transition logic.
    try {
      if (status === "en_route") {
        await lifecycle.setVisitEnRoute({ type: "SET_VISIT_EN_ROUTE", companyId, visitId, jobId });
      } else if (status === "on_site" || status === "in_progress") {
        await lifecycle.startVisit({ type: "START_VISIT", companyId, visitId, jobId });
      } else if (status === "paused") {
        await lifecycle.pauseVisit({ type: "PAUSE_VISIT", companyId, visitId, jobId });
      } else if (status === "cancelled") {
        await lifecycle.cancelVisit({ type: "CANCEL_VISIT", companyId, visitId, jobId });
      } else if (status === "scheduled") {
        // Revert from whatever actioned state the visit is currently in.
        if (existing.status === "en_route") {
          await lifecycle.cancelVisitRoute({ type: "CANCEL_VISIT_ROUTE", companyId, visitId, jobId });
        } else if (existing.status === "in_progress" || existing.status === "on_site") {
          await lifecycle.cancelVisitStart({ type: "CANCEL_VISIT_START", companyId, visitId, jobId });
        } else if (existing.status === "paused") {
          // Paused → scheduled is not a first-class orchestrator transition today.
          // Reject with a clear error so callers do the right thing.
          throw createError(400, "Resume or cancel the paused visit instead of reverting to 'scheduled'.");
        } else {
          // Already scheduled (or similar non-actioned state) — no-op.
        }
      } else {
        // Defensive: every enum member should be handled above.
        throw createError(400, `Unsupported status transition: ${status}`);
      }
    } catch (error: any) {
      // Orchestrator already emits structured errors; forward the most useful ones.
      if (error?.status === 409) {
        return res.status(409).json({ error: error.message, code: error.code ?? "CONFLICT" });
      }
      throw error;
    }

    const updated = await jobVisitsRepository.getJobVisit(companyId, visitId);

    // Phase 4B.1: Emit milestone event for status transitions (unchanged)
    // 2026-05-07 Activity Feed: also emit visit.on_route for the en_route
    // transition so the global Activity Feed shows "Technician on route".
    const ctx = getQueryCtx(req);
    if (status === "in_progress" || status === "on_site") {
      logEventAsync(ctx, {
        eventType: "visit.started",
        entityType: "visit",
        entityId: visitId,
        summary: `Visit started (job ${jobId})`,
        meta: { jobId, status },
      });
    } else if (status === "en_route") {
      logEventAsync(ctx, {
        eventType: "visit.on_route",
        entityType: "visit",
        entityId: visitId,
        summary: `Technician on route (job ${jobId})`,
        meta: { jobId, status },
      });
    }

    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: visitId, ts: new Date().toISOString() });

    res.json(updated);
  })
);

/* POST /api/jobs/:jobId/visits/:visitId/complete - Complete visit with explicit outcome */
/* 2026-03-17: Primary completion endpoint with outcome selection + parent job reconciliation */
const completeVisitWithOutcomeSchema = z.object({
  outcome: z.enum(visitOutcomeEnum),
  holdReason: z.enum(holdReasonEnum).nullable().optional(),
  holdNotes: z.string().max(2000).nullable().optional(),
  // 2026-05-04: opt-in auto-close. Default false — completing a visit no
  // longer implicitly closes its parent job even when it's the last
  // actionable visit. See CompleteVisitIntent doc-comment.
  autoCloseJobOnLastVisit: z.boolean().optional(),
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

    const { outcome, holdReason, holdNotes, autoCloseJobOnLastVisit } = validateSchema(
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
      autoCloseJobOnLastVisit,
    });

    // Fetch job + client data to enrich the activity feed event
    const [jobMeta] = await db
      .select({
        jobNumber: jobsTable.jobNumber,
        summary: jobsTable.summary,
        address: clientLocations.address,
        city: clientLocations.city,
        clientNameFromCompany: customerCompanies.name,
        clientNameFromLocation: clientLocations.companyName,
      })
      .from(jobsTable)
      .leftJoin(clientLocations, eq(jobsTable.locationId, clientLocations.id))
      .leftJoin(customerCompanies, eq(clientLocations.parentCompanyId, customerCompanies.id))
      .where(and(eq(jobsTable.id, jobId), eq(jobsTable.companyId, companyId)))
      .limit(1);

    const addrParts = [jobMeta?.address, jobMeta?.city].filter(Boolean);
    const locationAddress = addrParts.length > 0 ? addrParts.join(", ") : null;
    const enrichedClientName = jobMeta?.clientNameFromCompany ?? jobMeta?.clientNameFromLocation ?? null;

    // Emit events
    const ctx = getQueryCtx(req);
    logEventAsync(ctx, {
      eventType: "visit.completed",
      entityType: "visit",
      entityId: visitId,
      summary: `Visit completed with outcome=${outcome} (job ${jobId})`,
      meta: {
        jobId,
        outcome,
        holdReason,
        result,
        jobNumber: jobMeta?.jobNumber != null ? String(jobMeta.jobNumber) : null,
        jobSummary: jobMeta?.summary ?? null,
        clientName: enrichedClientName,
        locationAddress,
      },
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
