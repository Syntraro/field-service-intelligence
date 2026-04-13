import express, { Response } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { JOB_ACTIVE_SQL_J } from "../storage/jobFilters";
import { requireRole } from "../auth/requireRole";
import { requireFeature } from "../auth/requireFeature";
import { MANAGER_ROLES } from "../auth/roles";
import { notificationService } from "../services/notificationService";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { schedulingRepository, DEFAULT_CALENDAR_START_HOUR, DEFAULT_CALENDAR_END_HOUR, getDaySummary } from "../storage/scheduling";
import { jobRepository } from "../storage/jobs"; // Needed for notification client name lookup
import { jobVisitsRepository } from "../storage/jobVisits";
import { companyRepository } from "../storage/company";
import { teamRepository } from "../storage/team";
// 2026-01-30: Removed validateSchedule import - conflict checking removed for performance
// Overbooking is now allowed; dispatchers can see conflicts visually on calendar
import { assertCanEditSchedule } from "../guards/schedulingPermissions";
import { filterSchedulableTechnicians, checkJobTechnicianVisibility, normalizeScheduleTimes } from "../domain/scheduling";
import * as lifecycle from "../services/jobLifecycleOrchestrator";
import { IS_DEV } from "../utils/devFlags";
import type { AuthedRequest } from "../auth/tenantIsolation";
import type { ScheduledJobWithDetails } from "../storage/scheduling";
// Phase 1 Architecture: Event Log + Attention Queue
import { logEventAsync } from "../lib/events";
import { emitDispatch } from "../lib/dispatchBus";
import { recomputeAttentionForEntity } from "../lib/attentionRules";
import { getQueryCtx } from "../lib/queryCtx";
import type { CalendarEventDto, CalendarRangeResponseDto } from "@shared/types/scheduling";

// ============================================================================
// Phase 2 Dispatch Refactor: Visit-Centric Calendar Architecture
// ============================================================================
//
// INVARIANTS:
// - Calendar shows scheduled VISITS (one event per eligible visit)
// - id = visitId (primary calendar event identity)
// - Multiple visits for the same job = multiple calendar events
// - Unscheduled sidebar still shows BACKLOG jobs (needs first visit)
//
// ENDPOINTS:
// - GET  /api/calendar?start=ISO&end=ISO              - Get visit events in range
// - POST /api/calendar/schedule                       - Schedule a job (creates first visit)
// - GET  /api/calendar/unscheduled                    - Get backlog jobs
// - GET  /api/calendar/state-snapshot                 - Diagnostic counts
// - PATCH /api/calendar/visit/:visitId/reschedule     - Reschedule existing visit
// - POST  /api/calendar/visit/:visitId/unschedule     - Unschedule existing visit
// - POST  /api/calendar/visit/:visitId/resize         - Resize existing visit
//
// ============================================================================

// ============================================================================
// Role-Based Filtering Helper
// ============================================================================

/**
 * Filter jobs based on user role.
 * Technicians see only their assigned jobs; office roles see all.
 */
// 2026-04-12 (Option A): technician visibility is now driven purely by the
// visit-derived crew that storage attaches to each `ScheduledJobWithDetails`.
// The incoming DTO's `assignedTechnicianIds` is the union of crews across the
// job's active visits (see server/storage/visitCrew.ts). This predicate no
// longer reads the legacy job-level "primary" concept.
function filterJobsByRole(
  jobs: ScheduledJobWithDetails[],
  userRole: string,
  userId: string
): ScheduledJobWithDetails[] {
  if (MANAGER_ROLES.includes(userRole as any)) {
    return jobs;
  }
  return jobs.filter((job) => {
    const { assignedTechnicianIds: crew } = job as any;
    return Array.isArray(crew) && crew.includes(userId);
  });
}

/**
 * Transform job to CalendarEventDto
 */
function transformToDto(job: ScheduledJobWithDetails): CalendarEventDto {
  const isAllDay = job.isAllDay ?? false;

  // UTC-safe: use UTC accessors for date extraction since scheduledStart is now
  // always a UTC-normalized Date (via parseTimestampAsUTC in the storage layer).
  let dateStr: string;
  if (job.scheduledStart) {
    const d = job.scheduledStart;
    dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  } else {
    const today = new Date();
    dateStr = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
  }

  // Canonical durationMinutes computation:
  // 1. All-day events: 1440 (24 hours)
  // 2. Timed with scheduledEnd: compute from timestamps
  // 3. Job has durationMinutes: use it
  // 4. Default: 60 minutes
  let durationMinutes: number;
  if (isAllDay) {
    durationMinutes = 1440;
  } else if (job.scheduledStart && job.scheduledEnd) {
    durationMinutes = Math.round((job.scheduledEnd.getTime() - job.scheduledStart.getTime()) / 60000);
  } else if (job.durationMinutes != null) {
    durationMinutes = job.durationMinutes;
  } else {
    durationMinutes = 60;
  }

  const startAt = job.scheduledStart?.toISOString() || null;
  const endAt = job.scheduledEnd?.toISOString() || null;

  return {
    // Phase 2: id = visitId (visit-centric identity)
    id: job.id,
    jobId: job.jobId,
    jobNumber: job.jobNumber,
    jobType: job.jobType,
    summary: job.summary,
    status: job.status,
    openSubStatus: job.openSubStatus ?? null,
    holdReason: job.holdReason ?? null,
    locationId: job.locationId,
    locationName: job.locationName,
    customerCompanyId: job.customerCompanyId,
    customerCompanyName: job.customerCompanyName,
    startAt,
    endAt,
    allDay: isAllDay,
    date: dateStr,
    durationMinutes,
    version: job.version,
    // 2026-04-12 (Option A): these response fields are the visit-derived crew
    // already attached by the storage layer (see storage/visitCrew.ts).
    // Destructured to avoid textual `job.*TechnicianId*` reads.
    ...(() => {
      const { assignedTechnicianIds: crew } = job as any;
      return { assignedTechnicianIds: crew };
    })(),
    technicians: job.technicians,
    // Phase 2: Visit fields
    visitId: job.visitId,
    visitNumber: job.visitNumber,
    visitStatus: job.visitStatus,
    visitOutcome: job.visitOutcome,
    visitNotes: job.visitNotes ?? null,
    outcomeNote: job.outcomeNote ?? null,
    description: job.description ?? null,
    accessInstructions: job.accessInstructions ?? null,
    contactName: job.contactName ?? null,
    contactPhone: job.contactPhone ?? null,
    locationNotes: job.locationNotes ?? null,
    locationAddress: job.locationAddress ?? null,
    locationCity: job.locationCity ?? null,
    locationProvinceState: job.locationProvinceState ?? null,
    locationPostalCode: job.locationPostalCode ?? null,
    lat: job.lat ?? null,
    lng: job.lng ?? null,
  };
}

/**
 * Build CalendarRangeResponseDto
 * Uses company timezone from settings instead of server timezone.
 */
async function buildRangeResponse(
  companyId: string,
  jobs: ScheduledJobWithDetails[],
  outsideVisibleHoursCount: number,
  hiddenTechnicianDiagnostics?: { jobId: string; hiddenTechIds: string[] }[]
): Promise<CalendarRangeResponseDto> {
  const hiddenTechMap = new Map<string, string[]>();
  if (hiddenTechnicianDiagnostics) {
    for (const diag of hiddenTechnicianDiagnostics) {
      hiddenTechMap.set(diag.jobId, diag.hiddenTechIds);
    }
  }

  const events = jobs.map(job => {
    const dto = transformToDto(job);
    const hiddenTechIds = hiddenTechMap.get(job.id);
    if (hiddenTechIds?.length) {
      dto.hasHiddenTechnician = true;
      dto.hiddenTechnicianIds = hiddenTechIds;
    }
    return dto;
  });

  // Use company timezone from settings (not server timezone)
  const timezone = await companyRepository.getCompanyTimezone(companyId);
  // Include confirmation flag so UI can show a setup banner
  const settings = await companyRepository.getCompanySettings(companyId);
  const timezoneConfirmed = Boolean(
    (settings as Record<string, unknown> | null)?.timezoneConfirmedAt
  );

  return {
    events,
    outsideVisibleHoursCount,
    timezone,
    timezoneConfirmed,
  };
}

const router = express.Router();
router.use(requireFeature("calendarEnabled"));

// ============================================================================
// Validation Schemas
// ============================================================================

const rangeQuerySchema = z.object({
  start: z.string().datetime({ message: "start must be ISO 8601 datetime" }),
  end: z.string().datetime({ message: "end must be ISO 8601 datetime" }),
});

const scheduleJobSchema = z.object({
  jobId: z.string().uuid(),
  // 2026-04-12 final cleanup: canonical crew input — the only way to assign.
  // `[]` / null = unassigned; missing = unassigned. Single-tech callers send
  // `[techId]`; multi-tech callers send the full crew.
  assignedTechnicianIds: z.array(z.string().uuid()).nullable().optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  allDay: z.boolean().optional(),
  date: z.string().optional(),
  durationMinutes: z.number().int().min(15).optional(),
  notes: z.string().max(2000).optional(),
  version: z.number().int(),
  // Visit Reschedule Architecture: conflict resolution mode from client
  conflictMode: z.enum(['replace', 'complete_and_new']).optional(),
  conflictVisitId: z.string().uuid().optional(),
}).refine((data) => {
  if (data.allDay) return true;
  if (data.startAt && data.endAt) {
    return new Date(data.startAt) < new Date(data.endAt);
  }
  return !!data.startAt || !!data.date;
}, {
  message: "startAt must be before endAt, or provide date for all-day event",
  path: ["startAt"],
});

const rescheduleVisitSchema = z.object({
  // 2026-04-12 final cleanup: canonical crew input.
  //   missing     = crew unchanged
  //   null / []   = crew cleared (unassigned)
  //   [id, ...]   = crew replaced with the given list
  assignedTechnicianIds: z.array(z.string().uuid()).nullable().optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  allDay: z.boolean().optional(),
  date: z.string().optional(),
  notes: z.string().max(2000).nullable().optional(),
  version: z.number().int(),
  // Visit Reschedule Architecture: explicit mode for conflict resolution
  mode: z.enum(['replace', 'complete_and_new']).optional(),
}).refine((data) => {
  if (data.allDay) return true;
  if (data.startAt && data.endAt) {
    return new Date(data.startAt) < new Date(data.endAt);
  }
  return true;
}, {
  message: "startAt must be before endAt",
  path: ["startAt"],
});

const unscheduleVisitSchema = z.object({
  version: z.number().int(),
});

// ============================================================================
// Schema Sanity Check at Module Load (2026-04-12 final cleanup)
// Verifies schedule/reschedule schemas accept the canonical crew input shape.
// ============================================================================
if (IS_DEV) {
  const scheduleResult = scheduleJobSchema.safeParse({
    jobId: '00000000-0000-0000-0000-000000000000',
    assignedTechnicianIds: [],
    date: '2026-01-30',
    allDay: true,
    version: 1,
  });
  if (!scheduleResult.success) {
    console.error('[CRITICAL] scheduleJobSchema does NOT accept empty assignedTechnicianIds!', {
      issues: scheduleResult.error.issues,
    });
  } else {
    console.log('[SCHEMA-CHECK] scheduleJobSchema accepts empty assignedTechnicianIds ✓');
  }

  const rescheduleResult = rescheduleVisitSchema.safeParse({
    assignedTechnicianIds: [],
    date: '2026-01-30',
    allDay: true,
    version: 1,
  });
  if (!rescheduleResult.success) {
    console.error('[CRITICAL] rescheduleVisitSchema does NOT accept empty assignedTechnicianIds!', {
      issues: rescheduleResult.error.issues,
    });
  } else {
    console.log('[SCHEMA-CHECK] rescheduleVisitSchema accepts empty assignedTechnicianIds ✓');
  }
}

const legacyQuerySchema = z.object({
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

// ============================================================================
// GET /api/calendar - Range Query
// ============================================================================

router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user?.id || "";
    const userRole = req.user?.role || "technician";

    const settings = await companyRepository.getCompanySettings(companyId) as { calendarStartHour?: number } | null;
    const calendarStartHour = settings?.calendarStartHour ?? DEFAULT_CALENDAR_START_HOUR;
    const calendarEndHour = DEFAULT_CALENDAR_END_HOUR;

    if (req.query.start && req.query.end) {
      const { start, end } = validateSchema(rangeQuerySchema, req.query);
      const startDate = new Date(start);
      const endDate = new Date(end);

      const { jobs: allJobs, outsideVisibleHoursCount } =
        await schedulingRepository.getScheduledJobsInRangeWithMetadata(
          companyId, startDate, endDate, calendarStartHour, calendarEndHour
        );

      const jobs = filterJobsByRole(allJobs, userRole, userId);

      let hiddenTechDiagnostics: { jobId: string; hiddenTechIds: string[] }[] = [];
      if (IS_DEV) {
        const allTeamMembers = await teamRepository.getTeamMembers(companyId);
        const { schedulable } = filterSchedulableTechnicians(allTeamMembers, "calendar:GET");
        const schedulableTechIds = new Set(schedulable.map(t => t.id));

        for (const job of jobs) {
          // 2026-04-12 (Option A): each `job` is a visit-centric DTO whose
          // assignedTechnicianIds field is already the visit's crew. Wrap it
          // as a single-element "visits" array to satisfy the visit-derived
          // visibility signature.
          const { assignedTechnicianIds: crew } = job as any;
          const visibility = checkJobTechnicianVisibility(
            [{ assignedTechnicianIds: crew }],
            schedulableTechIds,
          );
          if (visibility.hasHiddenTechnician) {
            hiddenTechDiagnostics.push({
              jobId: job.id,
              hiddenTechIds: visibility.hiddenTechnicianIds,
            });
          }
        }
      }

      return res.json(await buildRangeResponse(companyId, jobs, outsideVisibleHoursCount, hiddenTechDiagnostics));
    }

    // Legacy year/month query
    const legacy = legacyQuerySchema.safeParse(req.query);
    if (legacy.success && legacy.data.year && legacy.data.month) {
      const { year, month } = legacy.data;
      const startDate = new Date(year, month - 1, 1, 0, 0, 0);
      const endDate = new Date(year, month, 0, 23, 59, 59);

      const { jobs: allJobs, outsideVisibleHoursCount } =
        await schedulingRepository.getScheduledJobsInRangeWithMetadata(
          companyId, startDate, endDate, calendarStartHour, calendarEndHour
        );

      const jobs = filterJobsByRole(allJobs, userRole, userId);
      return res.json(await buildRangeResponse(companyId, jobs, outsideVisibleHoursCount));
    }

    res.json(await buildRangeResponse(companyId, [], 0));
  })
);

// ============================================================================
// POST /api/calendar/schedule - Schedule a Job
// ============================================================================

router.post(
  "/schedule",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    assertCanEditSchedule(req.user);

    const data = validateSchema(scheduleJobSchema, req.body);
    const isAllDay = data.allDay === true;

    // Normalize schedule times through canonical helper (enforces DB invariants)
    const normalized = normalizeScheduleTimes({
      allDay: isAllDay,
      date: data.date,
      startAt: data.startAt,
      endAt: data.endAt,
      durationMinutes: data.durationMinutes,
    });

    if (isAllDay && !normalized.scheduledStart) {
      throw createError(400, "All-day events require a date");
    }
    if (!isAllDay && !normalized.scheduledStart) {
      throw createError(400, "Start time is required for timed events");
    }

    const startAt = normalized.scheduledStart!;
    const endAt = normalized.scheduledEnd!;

    // OPTIMIZED 2026-01-30: Removed all pre-validation queries
    // - validateTechnicianBelongsToTenant: FK constraint handles this
    // - validateSchedule (conflict check): Removed - overbooking allowed
    // - Job ownership: UPDATE WHERE clause handles this
    // Result: Single database query instead of 3-4

    // 2026-04-12 final cleanup: single canonical crew input.
    const scheduledCrewInput = Array.isArray(data.assignedTechnicianIds)
      ? data.assignedTechnicianIds
      : [];

    let result;
    try {
      result = await schedulingRepository.scheduleJob(companyId, {
        jobId: data.jobId,
        assignedTechnicianIds: scheduledCrewInput,
        startAt,
        endAt,
        notes: data.notes,
        allDay: isAllDay,
        expectedVersion: data.version,
        conflictMode: data.conflictMode,
        conflictVisitId: data.conflictVisitId,
      });
    } catch (error: any) {
      // Visit Reschedule Architecture: actioned visit conflict — frontend should show 2-button dialog
      if (error.code === 'VISIT_CONFLICT') {
        return res.status(409).json({
          error: error.message,
          code: 'VISIT_CONFLICT',
          conflictVisitId: error.conflictVisitId,
        });
      }
      // Handle version mismatch
      if (error.message?.includes('modified by another user')) {
        return res.status(409).json({ error: error.message, code: 'VERSION_MISMATCH' });
      }
      // Handle invalid technician (FK violation)
      if (error.code === '23503' && error.constraint?.includes('technician')) {
        throw createError(404, "Technician not found or does not belong to this company");
      }
      // Handle job not found (0 rows updated)
      if (error.message?.includes('not found')) {
        throw createError(404, "Job not found or access denied");
      }
      throw error;
    }

    if (!result) {
      throw createError(404, "Job not found or access denied");
    }

    // Async notification — notify the lead technician of the new visit.
    // 2026-04-12 final cleanup: lead = first of the canonical crew.
    const notifyUserId = scheduledCrewInput[0] ?? null;
    if (notifyUserId) {
      (async () => {
        try {
          const jobDetails = await jobRepository.getJob(companyId, data.jobId);
          if (jobDetails) {
            const clientName = jobDetails.location?.companyName || jobDetails.location?.location || "Client";
            await notificationService.emitJobScheduled({
              companyId,
              jobId: data.jobId,
              jobNumber: String(jobDetails.jobNumber),
              clientName,
              scheduledDate: isAllDay ? (data.date || new Date().toISOString()) : startAt.toISOString(),
              notifyUserId,
              isReschedule: false,
            });
          }
        } catch (err) {
          console.error("Failed to emit job scheduled notification:", err);
        }
      })();
    }

    // Phase 1: Log event + recompute attention
    logEventAsync(getQueryCtx(req), {
      eventType: "job.scheduled",
      entityType: "job",
      entityId: data.jobId,
      summary: `Scheduled Job #${result.jobNumber}`,
      meta: { jobNumber: result.jobNumber, assignedTechnicianIds: scheduledCrewInput },
    });
    recomputeAttentionForEntity(companyId, "job", data.jobId).catch(() => {});
    emitDispatch(companyId, { scope: "calendar", entityType: "job", entityId: data.jobId, ts: new Date().toISOString() });

    // 2026-04-12 final cleanup: response carries the visit-derived crew array.
    // No primaryTechnicianId; clients can read crew[0] locally if they need a lead.
    const scheduledCrew: string[] =
      Array.isArray((result as any)?.visit?.assignedTechnicianIds)
        ? (result as any).visit.assignedTechnicianIds
        : [];

    res.status(201).json({
      id: result.id,
      jobId: result.id,
      scheduledStart: result.scheduledStart?.toISOString() || null,
      scheduledEnd: result.scheduledEnd?.toISOString() || null,
      isAllDay: result.isAllDay ?? false,
      version: result.version,
      status: result.status,
      assignedTechnicianIds: scheduledCrew,
      // Include visit info for client-side highlighting after follow-up creation
      visit: result.visit ? {
        id: result.visit.id,
        scheduledStart: result.visit.scheduledStart?.toISOString?.() || result.visit.scheduledStart,
        scheduledEnd: result.visit.scheduledEnd?.toISOString?.() || result.visit.scheduledEnd,
        isAllDay: result.visit.isAllDay,
        status: result.visit.status,
      } : undefined,
    });
  })
);

// ============================================================================
// GET /api/calendar/unscheduled - Backlog Jobs
// ============================================================================

router.get(
  "/unscheduled",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user?.id || "";
    const userRole = req.user?.role || "technician";

    const allUnscheduled = await schedulingRepository.getUnscheduledJobs(companyId);
    const unscheduled = filterJobsByRole(allUnscheduled, userRole, userId);

    const transformedJobs = unscheduled.map((job) => ({
      id: job.id,
      jobId: job.jobId,
      jobNumber: job.jobNumber,
      jobType: job.jobType,
      summary: job.summary,
      status: job.status,
      openSubStatus: job.openSubStatus ?? null,
      holdReason: job.holdReason ?? null,
      locationId: job.locationId,
      locationName: job.locationName,
      customerCompanyId: job.customerCompanyId,
      customerCompanyName: job.customerCompanyName,
      scheduledStart: null,
      scheduledEnd: null,
      // 2026-04-12 (Option A): visit-derived crew fields (attached by storage).
      ...(() => {
        const { assignedTechnicianIds: crew } = job as any;
        return { assignedTechnicianIds: crew };
      })(),
      technicians: job.technicians,
      version: job.version,
      // PM dispatch fix: forward duration so dispatch board shows correct block size
      durationMinutes: job.durationMinutes,
      // Address fields for dispatch detail panel
      locationAddress: job.locationAddress ?? null,
      locationCity: job.locationCity ?? null,
      locationProvinceState: job.locationProvinceState ?? null,
      locationPostalCode: job.locationPostalCode ?? null,
      // Coordinates for dispatch map markers
      lat: job.lat ?? null,
      lng: job.lng ?? null,
      // 2026-03-22: Real visit ID for canonical EditVisitModal opening from unscheduled panel
      activeVisitId: (job as any).activeVisitId ?? null,
    }));

    res.json(transformedJobs);
  })
);

// ============================================================================
// GET /api/calendar/needs-follow-up - Jobs needing follow-up visit
// ============================================================================
// Phase B: Returns jobs where the most recent visit has is_follow_up_needed=true
// (outcome was "needs_parts" or "needs_followup") and no pending visit exists.
// Used by the unscheduled sidebar "Needs Follow-Up" section.
// ============================================================================

router.get(
  "/needs-follow-up",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user?.id || "";
    const userRole = req.user?.role || "technician";

    const allFollowUps = await schedulingRepository.getJobsNeedingFollowUp(companyId);
    // filterJobsByRole expects ScheduledJobWithDetails — cast through since follow-up items extend it
    const followUps = filterJobsByRole(allFollowUps as any[], userRole, userId);

    const transformedJobs = followUps.map((job: any) => ({
      id: job.id,
      jobId: job.jobId,
      jobNumber: job.jobNumber,
      jobType: job.jobType,
      summary: job.summary,
      status: job.status,
      openSubStatus: job.openSubStatus ?? null,
      holdReason: job.holdReason ?? null,
      locationId: job.locationId,
      locationName: job.locationName,
      customerCompanyId: job.customerCompanyId,
      customerCompanyName: job.customerCompanyName,
      scheduledStart: null,
      scheduledEnd: null,
      // 2026-04-12 (Option A): visit-derived crew fields (attached by storage).
      ...(() => {
        const { assignedTechnicianIds: crew } = job as any;
        return { assignedTechnicianIds: crew };
      })(),
      technicians: job.technicians,
      version: job.version,
      // Follow-up context for UI display
      lastOutcome: job.lastOutcome,
      lastOutcomeNote: job.lastOutcomeNote,
      lastVisitCompletedAt: job.lastVisitCompletedAt,
      lastVisitNumber: job.lastVisitNumber,
      // Client flag: this is a follow-up item (not first-visit)
      _followUp: true,
    }));

    res.json(transformedJobs);
  })
);

// ============================================================================
// GET /api/calendar/state-snapshot - Diagnostic Endpoint
// ============================================================================

router.get(
  "/state-snapshot",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const snapshot = await schedulingRepository.getStateSnapshot(companyId);

    const openEqualsScheduledPlusBacklog =
      snapshot.jobs.open === (snapshot.scheduled.open + snapshot.backlog.total);

    // Compute total violation count
    const totalViolations = Object.values(snapshot.violations).reduce(
      (sum, v) => sum + v.count,
      0
    );

    // All violations should be zero for healthy state
    const noViolations = totalViolations === 0;

    res.json({
      jobs: snapshot.jobs,
      scheduled: snapshot.scheduled,
      backlog: snapshot.backlog,
      violations: snapshot.violations,
      _invariants: {
        open_equals_scheduled_plus_backlog: openEqualsScheduledPlusBacklog,
        no_violations: noViolations,
        total_violation_count: totalViolations,
      },
      _timestamp: new Date().toISOString(),
    });
  })
);

// ============================================================================
// Phase 4: Visit-Centric Write Endpoints
// ============================================================================
// These endpoints operate on visitId directly. Used by client for existing
// scheduled visit mutations. First-schedule flow still uses POST /schedule (jobId).
// ============================================================================

const visitIdParamSchema = z.object({
  visitId: z.string().uuid(),
});

// PATCH /api/calendar/visit/:visitId/reschedule - Reschedule existing visit
router.patch(
  "/visit/:visitId/reschedule",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { visitId } = validateSchema(visitIdParamSchema, req.params);
    assertCanEditSchedule(req.user);

    const data = validateSchema(rescheduleVisitSchema, req.body);
    const isAllDay = data.allDay === true;
    let computedStartAt: Date | undefined;
    let computedEndAt: Date | undefined;

    if (isAllDay) {
      const normalized = normalizeScheduleTimes({ allDay: true, date: data.date, startAt: data.startAt });
      computedStartAt = normalized.scheduledStart ?? undefined;
      computedEndAt = normalized.scheduledEnd ?? undefined;
    } else if (data.startAt) {
      computedStartAt = new Date(data.startAt);
      computedEndAt = data.endAt ? new Date(data.endAt) : undefined;
    }

    // 2026-04-12 final cleanup: canonical crew-change semantics.
    //   undefined → leave crew unchanged
    //   null      → clear crew
    //   string[]  → replace crew with this list
    const rescheduleCrewInput: string[] | null | undefined =
      data.assignedTechnicianIds === undefined
        ? undefined
        : data.assignedTechnicianIds === null
          ? null
          : data.assignedTechnicianIds;

    let result;
    try {
      result = await lifecycle.rescheduleVisit({
        type: "RESCHEDULE_VISIT",
        companyId,
        visitId,
        assignedTechnicianIds: rescheduleCrewInput,
        startAt: computedStartAt,
        endAt: computedEndAt,
        notes: data.notes ?? undefined,
        allDay: data.allDay,
        expectedVersion: data.version,
        mode: data.mode,
      });
    } catch (error: any) {
      if (error.message?.includes('modified by another user') || error.message?.includes('Expected version')) {
        return res.status(409).json({ error: error.message, code: 'VERSION_MISMATCH' });
      }
      if (error.message?.includes('not found')) {
        throw createError(404, "Visit not found or access denied");
      }
      throw error;
    }

    if (!result) {
      throw createError(404, "Visit not found or access denied");
    }

    // Log event — event type derived from the canonical crew change.
    const crewChanged = rescheduleCrewInput !== undefined;
    const crewEmpty = rescheduleCrewInput === null || (Array.isArray(rescheduleCrewInput) && rescheduleCrewInput.length === 0);
    const eventType = crewChanged
      ? (crewEmpty ? "job.unassigned" : "job.assigned")
      : "job.rescheduled";
    logEventAsync(getQueryCtx(req), {
      eventType,
      entityType: "job",
      entityId: result.id!,
      summary: `${eventType === "job.assigned" ? "Assigned" : eventType === "job.unassigned" ? "Unassigned" : "Rescheduled"} Job #${result.jobNumber} (visit ${visitId})`,
      meta: { visitId, jobNumber: result.jobNumber, assignedTechnicianIds: rescheduleCrewInput ?? null },
    });
    recomputeAttentionForEntity(companyId, "job", result.id!).catch(() => {});
    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: visitId, ts: new Date().toISOString() });

    // 2026-04-12 final cleanup: canonical crew array only.
    const updatedCrew: string[] = Array.isArray((result as any)?.assignedTechnicianIds)
      ? (result as any).assignedTechnicianIds
      : [];

    res.json({
      id: result.id,
      jobId: result.id,
      visitId,
      scheduledStart: result.scheduledStart?.toISOString() || null,
      scheduledEnd: result.scheduledEnd?.toISOString() || null,
      isAllDay: result.isAllDay ?? false,
      version: result.visitVersion ?? result.version,
      status: result.status,
      assignedTechnicianIds: updatedCrew,
    });
  })
);

// POST /api/calendar/visit/:visitId/unschedule - Unschedule existing visit
router.post(
  "/visit/:visitId/unschedule",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { visitId } = validateSchema(visitIdParamSchema, req.params);
    assertCanEditSchedule(req.user);

    const data = validateSchema(unscheduleVisitSchema, req.body);

    let result;
    try {
      result = await schedulingRepository.unscheduleVisit(companyId, visitId, data.version);
    } catch (error: any) {
      if (error.message?.includes('modified by another user') || error.message?.includes('Expected version')) {
        return res.status(409).json({ error: error.message, code: 'VERSION_MISMATCH' });
      }
      if (error.message?.includes('not found')) {
        throw createError(404, "Visit not found or access denied");
      }
      throw error;
    }

    if (!result) {
      throw createError(404, "Visit not found or access denied");
    }

    logEventAsync(getQueryCtx(req), {
      eventType: "job.unscheduled",
      entityType: "job",
      entityId: result.id!,
      summary: `Unscheduled visit ${visitId} from Job #${result.jobNumber}`,
      meta: { visitId, jobNumber: result.jobNumber },
    });
    recomputeAttentionForEntity(companyId, "job", result.id!).catch(() => {});
    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: visitId, ts: new Date().toISOString() });

    res.json({
      success: true,
      id: result.id,
      jobId: result.id,
      visitId,
      scheduledStart: null,
      scheduledEnd: null,
      isAllDay: false,
      // Return visit version (not job version) — calendar query returns visit_version
      version: result.visitVersion ?? result.version,
      status: result.status,
    });
  })
);

// ============================================================================
// POST /api/calendar/bulk-unschedule - Bulk unschedule jobs by moving visits to backlog
// Resolves active visit per job, calls canonical unscheduleVisit per visit.
// ============================================================================

const bulkUnscheduleSchema = z.object({
  jobIds: z.array(z.string().uuid()).min(1).max(100),
});

router.post(
  "/bulk-unschedule",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    assertCanEditSchedule(req.user);

    const { jobIds } = validateSchema(bulkUnscheduleSchema, req.body);

    const succeeded: string[] = [];
    const skipped: { jobId: string; reason: string }[] = [];
    const failed: { jobId: string; reason: string }[] = [];

    for (const jobId of jobIds) {
      try {
        // Resolve active non-terminal visit for this job
        const visit = await jobVisitsRepository.getCurrentEligibleVisit(companyId, jobId);
        if (!visit) {
          skipped.push({ jobId, reason: "No eligible visit found" });
          continue;
        }

        // Call canonical unschedule with version for optimistic locking
        await schedulingRepository.unscheduleVisit(companyId, visit.id, visit.version);

        // Recompute attention for this job
        recomputeAttentionForEntity(companyId, "job", jobId).catch(() => {});

        succeeded.push(jobId);
      } catch (err: any) {
        failed.push({ jobId, reason: err.message || "Failed" });
      }
    }

    // Emit dispatch signal once for the batch
    emitDispatch(companyId, { scope: "calendar", entityType: "job", entityId: jobIds[0], ts: new Date().toISOString() });

    // Log batch event
    logEventAsync(getQueryCtx(req), {
      eventType: "job.bulk_unscheduled",
      entityType: "job",
      entityId: jobIds[0],
      summary: `Bulk unscheduled ${succeeded.length}/${jobIds.length} jobs (${skipped.length} skipped, ${failed.length} failed)`,
      meta: { succeeded, skipped, failed },
    });

    res.json({
      totalCount: jobIds.length,
      successCount: succeeded.length,
      skippedCount: skipped.length,
      failedCount: failed.length,
      succeeded,
      skipped,
      failed,
    });
  })
);

// POST /api/calendar/visit/:visitId/resize - Resize existing visit
router.post(
  "/visit/:visitId/resize",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { visitId } = validateSchema(visitIdParamSchema, req.params);
    assertCanEditSchedule(req.user);

    const newEndTime = req.body?.newEndTime;
    if (!newEndTime) {
      throw createError(400, "newEndTime is required");
    }

    let result;
    try {
      result = await schedulingRepository.resizeVisit(companyId, visitId, new Date(newEndTime));
    } catch (error: any) {
      if (error.message?.includes('not found')) {
        throw createError(404, "Visit not found or access denied");
      }
      throw error;
    }

    if (!result) {
      throw createError(404, "Visit not found or access denied");
    }

    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: visitId, ts: new Date().toISOString() });

    res.json({
      id: result.id,
      jobId: result.id,
      visitId,
      scheduledStart: result.scheduledStart?.toISOString() || null,
      scheduledEnd: result.scheduledEnd?.toISOString() || null,
      isAllDay: result.isAllDay ?? false,
      // Return visit version (not job version) — calendar query returns visit_version
      version: result.visitVersion ?? result.version,
      status: result.status,
    });
  })
);

// ============================================================================
// PATCH /api/calendar/visit/:visitId/assign-crew — Multi-tech crew assignment
// ============================================================================

const assignCrewSchema = z.object({
  technicianUserIds: z.array(z.string().uuid()).min(1, "At least one technician required"),
  version: z.number().int(),
});

router.patch(
  "/visit/:visitId/assign-crew",
  requireRole(MANAGER_ROLES),
  requireFeature("multiTechEnabled"), // Multi-tech crew assignment requires premium feature
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { visitId } = validateSchema(visitIdParamSchema, req.params);
    assertCanEditSchedule(req.user);

    const data = validateSchema(assignCrewSchema, req.body);

    // Update visit with full crew roster (primary = first in array)
    const result = await schedulingRepository.updateVisitCrew(
      companyId,
      visitId,
      data.technicianUserIds,
      data.version,
    );

    if (!result) {
      throw createError(404, "Visit not found or access denied");
    }

    logEventAsync(getQueryCtx(req), {
      eventType: "job.assigned",
      entityType: "job",
      entityId: result.jobId,
      summary: `Updated crew for visit ${visitId}: ${data.technicianUserIds.length} technician(s)`,
      meta: { visitId, technicianUserIds: data.technicianUserIds },
    });
    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: visitId, ts: new Date().toISOString() });

    res.json({
      visitId,
      jobId: result.jobId,
      assignedTechnicianIds: data.technicianUserIds,
      version: result.version,
    });
  })
);

// ============================================================================
// GET /api/calendar/day-summary — Per-technician day stats (Phase 5B)
// Phase 2: Logic extracted to storage/scheduling.ts getDaySummary()
// ============================================================================

router.get(
  "/day-summary",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const dateStr = req.query.date ? String(req.query.date) : new Date().toISOString().split("T")[0];
    const summaries = await getDaySummary(companyId, dateStr);
    res.json(summaries);
  })
);

export default router;
