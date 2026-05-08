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
// 2026-05-07 RALPH (technician time off): preflight check on the
// reschedule path. Returns the overlapping rows when an assignment
// + time range conflicts with a tech's time off. Wrapped in
// try/catch downstream so a missing migration doesn't break
// scheduling.
import { technicianTimeOffRepository } from "../storage/technicianTimeOff";
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
router.use(requireFeature("scheduling_calendar"));

// ============================================================================
// Validation Schemas
// ============================================================================

const rangeQuerySchema = z.object({
  start: z.string().datetime({ message: "start must be ISO 8601 datetime" }),
  end: z.string().datetime({ message: "end must be ISO 8601 datetime" }),
});

const scheduleJobSchema = z.object({
  jobId: z.string().uuid(),
  // 2026-04-18 Phase 1 (multi-visit): explicit visit-targeting field.
  //   - present  → update that exact visit (the canonical flow)
  //   - absent   → create a new visit row; never auto-pick an existing one
  // Together with the Phase 0 unique index, this eliminates the previous
  // single-visit invariant. See ARCH: no-auto-select for details.
  targetVisitId: z.string().uuid().optional(),
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
  // 2026-04-18 Phase 4: pre-multi-visit `conflictMode` + `conflictVisitId`
  // fields removed. All frontend callers were migrated to `targetVisitId`
  // in Phase 2; the one-release compat shim is no longer needed. Any
  // caller still sending these fields will fail Zod `.strict()` parsing
  // with a clear 400 — that's the intentional fail-loud migration signal.
}).strict().refine((data) => {
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
  // 2026-05-07 RALPH (technician time off): when true, the server's
  // time-off conflict check is bypassed. Default false. The client
  // sets this AFTER the user confirms an "Assign anyway" dialog so
  // managers can intentionally book over a tech's time off without
  // being permanently blocked.
  overrideTimeOffConflict: z.boolean().optional(),
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
// GET /api/calendar/lead-visits — Lead-visit dispatch feed (2026-05-05)
// ============================================================================
//
// Sibling to GET /api/calendar — same range query, but returns the
// LEAD-VISIT stream as a separate envelope. The dispatch frontend
// fetches both and merges client-side; lead visits render with a
// "Lead" badge + amber tint and click through to /leads/:id.
//
// NEVER mixed into the job calendar feed. Lead visits do not have
// a jobNumber, do not flow through visit lifecycle states, and
// do not count against job KPIs.
router.get(
  "/lead-visits",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { start, end } = validateSchema(rangeQuerySchema, req.query);
    const startDate = new Date(start);
    const endDate = new Date(end);
    const { getScheduledLeadVisitsInRangeWithMetadata } = await import(
      "../storage/leadVisitsDispatch"
    );
    const result = await getScheduledLeadVisitsInRangeWithMetadata(
      companyId,
      startDate,
      endDate,
    );
    res.json(result);
  }),
);

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

    // 2026-04-18 Phase 4: `targetVisitId` is the sole canonical way to
    // target an existing visit. The Phase 1 legacy-compat mapping for
    // `conflictMode='replace' + conflictVisitId` has been removed.
    let result;
    try {
      result = await schedulingRepository.scheduleJob(companyId, {
        jobId: data.jobId,
        targetVisitId: data.targetVisitId,
        assignedTechnicianIds: scheduledCrewInput,
        startAt,
        endAt,
        notes: data.notes,
        allDay: isAllDay,
        expectedVersion: data.version,
      });
    } catch (error: any) {
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
      // 2026-04-18 Phase 1/2 (multi-visit): canonical array of all active
      // non-terminal visit ids on this backlog job. The deprecated
      // singular `activeVisitId` field was removed in Phase 2 once all
      // frontend consumers migrated.
      visitIds: Array.isArray((job as any).visitIds) ? (job as any).visitIds : [],
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

    // 2026-05-07 RALPH (technician time off): preflight conflict
    // check. We compute the EFFECTIVE crew + time range that the
    // reschedule will produce, then ask the time-off repository
    // whether any of those (tech, range) pairs overlap an existing
    // time-off row. If there's a conflict AND the client did NOT
    // pass `overrideTimeOffConflict: true`, return 409 with a
    // discriminated `TIME_OFF_CONFLICT` code so the client can
    // surface a confirm dialog and retry with override=true.
    //
    // Wrapped in try/catch so a missing `technician_time_off`
    // table (migration not yet applied) cannot break scheduling —
    // matches the same defensive pattern in capacity.ts.
    if (data.overrideTimeOffConflict !== true) {
      try {
        const existingVisit = await jobVisitsRepository.getJobVisit(
          companyId,
          visitId,
        );
        if (existingVisit) {
          // Effective crew: explicit input wins; otherwise inherit
          // from the persisted visit row.
          const effectiveCrew: string[] =
            rescheduleCrewInput === undefined
              ? Array.isArray(existingVisit.assignedTechnicianIds)
                ? existingVisit.assignedTechnicianIds
                : []
              : rescheduleCrewInput === null
                ? []
                : rescheduleCrewInput;
          // Effective time range: explicit computed values win;
          // otherwise inherit from the persisted visit row.
          const effectiveStart =
            computedStartAt ??
            (existingVisit.scheduledStart instanceof Date
              ? existingVisit.scheduledStart
              : existingVisit.scheduledStart
                ? new Date(existingVisit.scheduledStart)
                : null);
          const effectiveEnd =
            computedEndAt ??
            (existingVisit.scheduledEnd instanceof Date
              ? existingVisit.scheduledEnd
              : existingVisit.scheduledEnd
                ? new Date(existingVisit.scheduledEnd)
                : null);
          if (
            effectiveCrew.length > 0 &&
            effectiveStart instanceof Date &&
            effectiveEnd instanceof Date &&
            effectiveEnd > effectiveStart
          ) {
            const overlapping =
              await technicianTimeOffRepository.listOverlapping(companyId, {
                windowStart: effectiveStart,
                windowEnd: effectiveEnd,
              });
            const conflicts = overlapping.filter((row) =>
              effectiveCrew.includes(row.technicianUserId),
            );
            if (conflicts.length > 0) {
              return res.status(409).json({
                error:
                  "Cannot assign visit to technician on time off without override.",
                code: "TIME_OFF_CONFLICT",
                conflicts: conflicts.map((c) => ({
                  id: c.id,
                  technicianUserId: c.technicianUserId,
                  reason: c.reason,
                  startsAt:
                    c.startsAt instanceof Date
                      ? c.startsAt.toISOString()
                      : String(c.startsAt),
                  endsAt:
                    c.endsAt instanceof Date
                      ? c.endsAt.toISOString()
                      : String(c.endsAt),
                  allDay: c.allDay,
                })),
              });
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn(
          `[reschedule] time-off preflight failed; proceeding without conflict check. ${msg}`,
        );
      }
    }

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

    const currentScheduledStart: string | null = result.scheduledStart
      ? (result.scheduledStart instanceof Date ? result.scheduledStart.toISOString() : String(result.scheduledStart))
      : null;
    const currentScheduledEnd: string | null = result.scheduledEnd
      ? (result.scheduledEnd instanceof Date ? result.scheduledEnd.toISOString() : String(result.scheduledEnd))
      : null;
    const currentIsAllDay: boolean = result.isAllDay === true;

    // 2026-04-21 Phase 2 push notifications: schedule-change notification.
    // Fires only on meaningful datetime delta (start/end/allDay); notes-only
    // and crew-only saves produce no notification. The emitter owns actor-
    // skip, preference-gate, dedupe, and best-effort push. Wrapped in try/
    // catch at the route so a notification failure can never break the
    // response — the persistent row and push are both already best-effort
    // inside the service.
    try {
      await notificationService.emitVisitScheduleChange({
        companyId,
        visitId,
        jobId: result.id!,
        jobNumber: result.jobNumber,
        visitVersion: result.visitVersion ?? result.version ?? 0,
        previousScheduledStart: result.previousScheduledStart ?? null,
        previousScheduledEnd: result.previousScheduledEnd ?? null,
        previousIsAllDay: result.previousIsAllDay === true,
        currentScheduledStart,
        currentScheduledEnd,
        currentIsAllDay,
        currentAssignedTechnicianIds: updatedCrew,
        actorUserId: req.user?.id ?? null,
      });
    } catch (err) {
      console.error("[reschedule] emitVisitScheduleChange failed", { visitId, err });
    }

    res.json({
      id: result.id,
      jobId: result.id,
      visitId,
      scheduledStart: currentScheduledStart,
      scheduledEnd: currentScheduledEnd,
      isAllDay: currentIsAllDay,
      version: result.visitVersion ?? result.version,
      status: result.status,
      assignedTechnicianIds: updatedCrew,
    });
  })
);

// POST /api/calendar/visit/:visitId/unschedule - Unschedule existing visit
// 2026-04-21 Phase 1 canonical visit mutation architecture: delegates to
// `lifecycle.unscheduleVisit` so the actioned-visit guard is enforced here
// too (the old direct-storage path silently allowed unscheduling
// in-progress / en_route visits). Same endpoint, same request shape.
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
      result = await lifecycle.unscheduleVisit({
        type: "UNSCHEDULE_VISIT",
        companyId,
        visitId,
        expectedVersion: data.version,
      });
    } catch (error: any) {
      if (error?.code === "VISIT_ACTIONED" || error?.status === 409 && /actioned/i.test(error.message ?? "")) {
        return res.status(409).json({ error: error.message, code: "VISIT_ACTIONED" });
      }
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
// POST /api/calendar/bulk-unschedule
//
// 2026-04-18 Phase 2 (multi-visit): this endpoint is VISIT-SCOPED.
// Input: { visitIds: uuid[] }. Each visit is independently unscheduled
// via the canonical `schedulingRepository.unscheduleVisit()` path.
// Siblings on the same job are never touched implicitly.
//
// The pre-Phase-2 job-scoped shape (`{ jobIds: [] }`) is intentionally
// no longer accepted — it was ambiguous under multi-visit (a job can now
// have multiple open visits; which one should bulk-unschedule pick?).
// Zod validation surfaces a clear 400 if a legacy caller sends `jobIds`
// instead of `visitIds`, so migration fails loudly rather than guessing.
// ============================================================================

const bulkUnscheduleSchema = z.object({
  visitIds: z.array(z.string().uuid()).min(1).max(100),
}).strict();

router.post(
  "/bulk-unschedule",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    assertCanEditSchedule(req.user);

    const { visitIds } = validateSchema(bulkUnscheduleSchema, req.body);

    const succeeded: string[] = [];
    const skipped: { visitId: string; reason: string }[] = [];
    const failed: { visitId: string; reason: string }[] = [];
    const affectedJobIds = new Set<string>();

    // 2026-04-21 Phase 1.5: each visit is unscheduled through the canonical
    // `lifecycle.unscheduleVisit` intent so actioned-visit protection fires
    // uniformly with the single-visit path. Actioned visits (en_route /
    // in_progress / paused / on_site / checkedInAt-present) are routed to
    // `skipped` with a stable reason — NEVER silently overwritten.
    for (const visitId of visitIds) {
      try {
        const visit = await jobVisitsRepository.getJobVisit(companyId, visitId);
        if (!visit) {
          skipped.push({ visitId, reason: "Visit not found" });
          continue;
        }

        try {
          await lifecycle.unscheduleVisit({
            type: "UNSCHEDULE_VISIT",
            companyId,
            visitId: visit.id,
            expectedVersion: visit.version,
          });
        } catch (orchErr: any) {
          // Orchestrator signals actioned-visit rejection via code VISIT_ACTIONED.
          // Bulk-unschedule is batch-by-nature: skip, don't fail the whole batch.
          if (orchErr?.code === "VISIT_ACTIONED") {
            skipped.push({ visitId, reason: orchErr.message || "Visit is actioned" });
            continue;
          }
          throw orchErr;
        }
        affectedJobIds.add(visit.jobId);
        succeeded.push(visitId);

        // Recompute attention for each touched job (deduplicated below)
        recomputeAttentionForEntity(companyId, "job", visit.jobId).catch(() => {});
      } catch (err: any) {
        failed.push({ visitId, reason: err.message || "Failed" });
      }
    }

    // Emit one dispatch signal per affected job so multiple jobs receive
    // independent cache-invalidation events rather than a single batch stub.
    for (const jobId of Array.from(affectedJobIds)) {
      emitDispatch(companyId, {
        scope: "calendar",
        entityType: "job",
        entityId: jobId,
        ts: new Date().toISOString(),
      });
    }

    logEventAsync(getQueryCtx(req), {
      eventType: "visit.bulk_unscheduled",
      entityType: "visit",
      entityId: visitIds[0],
      summary: `Bulk unscheduled ${succeeded.length}/${visitIds.length} visits (${skipped.length} skipped, ${failed.length} failed) across ${affectedJobIds.size} jobs`,
      meta: { succeeded, skipped, failed, affectedJobIds: Array.from(affectedJobIds) },
    });

    res.json({
      totalCount: visitIds.length,
      successCount: succeeded.length,
      skippedCount: skipped.length,
      failedCount: failed.length,
      affectedJobIds: Array.from(affectedJobIds),
      succeeded,
      skipped,
      failed,
    });
  })
);

// POST /api/calendar/visit/:visitId/resize - Resize existing visit
// 2026-04-21 Phase 1 canonical visit mutation architecture: resize is a
// schedule-end change, so it routes through the same canonical engine as
// reschedule (`lifecycle.rescheduleVisit(mode:"replace")`). This closes
// the actioned-visit gap the direct-storage path silently allowed: resizing
// an in-progress visit now goes through the same spawn-on-action decision
// tree as drag-reschedule. Same endpoint + same request shape.
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

    // Read existing visit so we can preserve scheduledStart while only
    // changing the end. The orchestrator will normalize and apply spawn
    // protection if the visit is already actioned.
    const existing = await jobVisitsRepository.getJobVisit(companyId, visitId);
    if (!existing) {
      throw createError(404, "Visit not found or access denied");
    }
    if (!existing.scheduledStart) {
      throw createError(400, "Cannot resize an unscheduled visit");
    }

    let result;
    try {
      result = await lifecycle.rescheduleVisit({
        type: "RESCHEDULE_VISIT",
        companyId,
        visitId,
        // Crew unchanged
        startAt: existing.scheduledStart instanceof Date ? existing.scheduledStart : new Date(existing.scheduledStart as any),
        endAt: new Date(newEndTime),
        allDay: existing.isAllDay ?? false,
        expectedVersion: existing.version,
        // Resize is NEVER a "complete this visit and spawn a new one" operation.
        // If the orchestrator decides the visit is actioned, it will still
        // spawn per its own policy; `"replace"` is the caller-intent hint.
        mode: "replace",
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
// PATCH /api/calendar/visit/:visitId/assign-crew — Canonical visit crew assignment
// ============================================================================
// 2026-04-21 Phase 1 canonical visit mutation architecture:
//   - Canonical field name is `assignedTechnicianIds` — matches the DB
//     column, the shared schema types, every other visit endpoint, and the
//     client `useDispatchPreviewMutations.updateVisitCrew` body shape.
//     The legacy `technicianUserIds` name was a gratuitous divergence and
//     is no longer accepted. Callers that still send it will fail Zod
//     parsing with a clear 400 — that's the intentional fail-loud signal.
//   - Handler is a thin delegator to `lifecycle.assignVisitCrew`, which
//     owns terminal-job / terminal-visit / version guards. No direct
//     storage write from this route.
//   - `[]` is now accepted (legacy `.min(1)` was wrong — clearing crew is
//     a valid operation matching the reschedule contract).

// 2026-04-21 Phase 1: exported so tests can pin the canonical crew contract.
export const assignCrewSchema = z.object({
  assignedTechnicianIds: z.array(z.string().uuid()),
  version: z.number().int(),
}).strict();

router.patch(
  "/visit/:visitId/assign-crew",
  requireRole(MANAGER_ROLES),
  requireFeature("multi_tech_scheduling"), // Multi-tech crew assignment requires the canonical entitlement
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { visitId } = validateSchema(visitIdParamSchema, req.params);
    assertCanEditSchedule(req.user);

    const data = validateSchema(assignCrewSchema, req.body);

    let result;
    try {
      result = await lifecycle.assignVisitCrew({
        type: "ASSIGN_VISIT_CREW",
        companyId,
        visitId,
        assignedTechnicianIds: data.assignedTechnicianIds,
        expectedVersion: data.version,
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

    const crewEmpty = data.assignedTechnicianIds.length === 0;
    logEventAsync(getQueryCtx(req), {
      eventType: crewEmpty ? "job.unassigned" : "job.assigned",
      entityType: "job",
      entityId: result.jobId,
      summary: `Updated crew for visit ${visitId}: ${data.assignedTechnicianIds.length} technician(s)`,
      meta: { visitId, assignedTechnicianIds: data.assignedTechnicianIds },
    });
    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: visitId, ts: new Date().toISOString() });

    // 2026-04-21 Phase 1 push notifications: notify newly-assigned techs.
    // Wrapped in try/catch + awaited so console errors are captured, but
    // any failure inside the service is swallowed there — assignment
    // response is never blocked by a notification/push failure.
    try {
      await notificationService.emitVisitAssignmentChange({
        companyId,
        visitId,
        jobId: result.jobId,
        jobNumber: result.jobNumber,
        // 2026-04-21 Phase 1.1: post-write version anchors the dedupe key.
        // Orchestrator bumps visit.version on every successful write, so
        // two legitimate same-day reassignments get distinct notifications
        // while a retried duplicate PATCH (same expected version) would
        // have already been rejected upstream with 409 VERSION_MISMATCH.
        visitVersion: result.visit.version,
        scheduledStart: result.visit.scheduledStart
          ? (result.visit.scheduledStart instanceof Date
              ? result.visit.scheduledStart.toISOString()
              : String(result.visit.scheduledStart))
          : null,
        previousAssignedTechnicianIds: result.previousAssignedTechnicianIds,
        currentAssignedTechnicianIds: data.assignedTechnicianIds,
        actorUserId: req.user?.id ?? null,
      });
    } catch (err) {
      console.error("[assign-crew] emitVisitAssignmentChange failed", { visitId, err });
    }

    res.json({
      visitId,
      jobId: result.jobId,
      assignedTechnicianIds: data.assignedTechnicianIds,
      version: result.visit.version,
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
