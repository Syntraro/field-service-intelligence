/**
 * Time Tracking Routes
 *
 * Endpoints for:
 * - Work Sessions (clock in/out for payroll)
 * - Time Entries (granular time tracking for billing)
 * - Technician Job Status (mobile status updates that drive time entries)
 * - Job Time Summaries
 *
 * Exports two routers:
 * - timeRouter: mounted at /api/time for clock in/out and time entry management
 * - jobTimeRouter: mounted at /api/jobs for job-specific status and time summary
 */

import { Router, type Response } from "express";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { timeTrackingRepository } from "../storage/timeTracking";
import { companyRepository } from "../storage/company";
import { MANAGER_ROLES, TECH_ROLES } from "../auth/roles";
import { requireRole } from "../auth/requireRole";
import type { AuthedRequest } from "../auth/tenantIsolation";
import {
  clockInRequestSchema,
  clockOutRequestSchema,
  startTimeEntryRequestSchema,
  stopTimeEntryRequestSchema,
  createFinishedTimeEntryRequestSchema,
  updateTimeEntrySchema,
  jobStatusUpdateRequestSchema,
  managerUpdateTimeEntrySchema,
  approveWeekRequestSchema,
} from "@shared/schema";
import { z } from "zod";
import { emitDispatch } from "../lib/dispatchBus";
import { db } from "../db";
import { and, desc, eq, gte, isNotNull, lte } from "drizzle-orm";
import { timeEntries, users, jobs, jobVisits } from "@shared/schema";

// Main time tracking router (mounted at /api/time)
const timeRouter = Router();

// Job-specific time routes (mounted at /api/jobs)
const jobTimeRouter = Router();

// Payroll router (mounted at /api/payroll)
const payrollRouter = Router();

// ============================================================================
// WORK SESSIONS - Clock In/Out (mounted at /api/time)
// ============================================================================

/**
 * POST /api/time/clock-in
 * Clock in for the day (creates a new work session)
 * Tech can clock in for themselves
 */
timeRouter.post(
  "/clock-in",
  requireRole(TECH_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const validated = validateSchema(clockInRequestSchema, req.body);

    // 2026-04-08: Resolve the tenant timezone and compute the local YYYY-MM-DD
    // date string here, then pass it to the storage layer as `workDateOverride`.
    // This aligns the stored `work_sessions.workDate` with the tenant-timezone
    // date that `getOpenWorkSession` (Today screen) uses to look up the open
    // session. Previously, storage derived `workDate` from UTC, which silently
    // diverged from the tenant's local "today" during the local-vs-UTC date
    // offset window — producing the "Today screen says Not Clocked In + clock-in
    // throws already-has-open-session" deadlock for any non-UTC tenant.
    //
    // The `en-CA` locale always formats as YYYY-MM-DD, matching the inline
    // helper at `server/routes/techField.ts:61` (`todayInTimezone`). This is
    // the same canonical timezone source — `companyRepository.getCompanyTimezone`
    // — that techField.ts uses (it wraps the same call), so both routes now
    // agree on the date convention without introducing a parallel helper.
    const tz = await companyRepository.getCompanyTimezone(req.companyId!);
    const at = validated.at ? new Date(validated.at) : new Date();
    const workDate = at.toLocaleDateString("en-CA", { timeZone: tz });

    const session = await timeTrackingRepository.clockIn(
      req.companyId!,
      req.user!.id,
      {
        at,
        source: validated.source,
        notes: validated.notes ?? undefined,
        workDateOverride: workDate,
      }
    );

    emitDispatch(req.companyId!, { scope: "time", entityType: "visit", entityId: session.id, ts: new Date().toISOString() });
    res.status(201).json(session);
  })
);

/**
 * POST /api/time/clock-out
 * Clock out for the day (closes the current work session)
 * Tech can clock out for themselves
 */
timeRouter.post(
  "/clock-out",
  requireRole(TECH_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const validated = validateSchema(clockOutRequestSchema, req.body);

    const session = await timeTrackingRepository.clockOut(
      req.companyId!,
      req.user!.id,
      {
        at: validated.at ? new Date(validated.at) : undefined,
        breakMinutes: validated.breakMinutes,
        notes: validated.notes ?? undefined,
      }
    );

    emitDispatch(req.companyId!, { scope: "time", entityType: "visit", entityId: session.id, ts: new Date().toISOString() });
    res.json(session);
  })
);

// ============================================================================
// TIME ENTRIES - Start/Stop/Create
// ============================================================================

/**
 * POST /api/time/entries/start
 * Start a new time entry (auto-stops any running entry)
 * Tech can start their own entries
 */
timeRouter.post(
  "/entries/start",
  requireRole(TECH_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const validated = validateSchema(startTimeEntryRequestSchema, req.body);

    const entry = await timeTrackingRepository.startTimeEntry(
      req.companyId!,
      req.user!.id,
      {
        type: validated.type,
        jobId: validated.jobId,
        at: validated.at ? new Date(validated.at) : undefined,
        notes: validated.notes,
        billable: validated.billable,
      }
    );

    res.status(201).json(entry);
  })
);

/**
 * POST /api/time/entries/stop
 * Stop a time entry (by ID or current running)
 * Tech can stop their own entries
 */
timeRouter.post(
  "/entries/stop",
  requireRole(TECH_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const validated = validateSchema(stopTimeEntryRequestSchema, req.body);

    const entry = await timeTrackingRepository.stopTimeEntry(
      req.companyId!,
      req.user!.id,
      {
        timeEntryId: validated.timeEntryId,
        at: validated.at ? new Date(validated.at) : undefined,
        notes: validated.notes,
      }
    );

    if (!entry) {
      throw createError(404, "No running time entry found");
    }

    res.json(entry);
  })
);

/**
 * POST /api/time/entries
 * Create a finished time entry (manual entry with start and end times)
 * Tech can create their own entries
 */
timeRouter.post(
  "/entries",
  requireRole(TECH_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const validated = validateSchema(createFinishedTimeEntryRequestSchema, req.body);

    const entry = await timeTrackingRepository.createFinishedTimeEntry(
      req.companyId!,
      req.user!.id,
      {
        type: validated.type,
        jobId: validated.jobId,
        startAt: new Date(validated.startAt),
        endAt: new Date(validated.endAt),
        notes: validated.notes,
        billable: validated.billable,
      }
    );

    res.status(201).json(entry);
  })
);

/**
 * POST /api/time/entries/manager
 * Create a finished time entry for any technician (manager only)
 * Used from Job Detail page to add time entries for assigned technicians
 */
timeRouter.post(
  "/entries/manager",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    // Extended schema that includes technicianId
    const managerCreateSchema = createFinishedTimeEntryRequestSchema.extend({
      technicianId: z.string().uuid(),
    });

    const validated = validateSchema(managerCreateSchema, req.body);

    // Breaks are never billable
    const billable = validated.type === "break" ? false : validated.billable;

    const entry = await timeTrackingRepository.createFinishedTimeEntry(
      req.companyId!,
      validated.technicianId,
      {
        type: validated.type,
        jobId: validated.jobId,
        startAt: new Date(validated.startAt),
        endAt: new Date(validated.endAt),
        notes: validated.notes,
        billable,
        actingUserId: req.user!.id,
        costRateOverride: validated.costRateOverride,
      }
    );

    // Audit log for manager-created entry
    console.log(
      JSON.stringify({
        event: "time_entry_manager_create",
        companyId: req.companyId,
        userId: req.user!.id,
        technicianId: validated.technicianId,
        timeEntryId: entry.id,
        jobId: validated.jobId,
        type: validated.type,
        timestamp: new Date().toISOString(),
      })
    );

    res.status(201).json(entry);
  })
);

/**
 * GET /api/time/entries/:id
 * Get a specific time entry
 */
timeRouter.get(
  "/entries/:id",
  requireRole(TECH_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const entry = await timeTrackingRepository.getTimeEntry(
      req.companyId!,
      req.params.id
    );

    if (!entry) {
      throw createError(404, "Time entry not found");
    }

    // Tech can only view their own entries unless manager
    const isManager = MANAGER_ROLES.includes(req.user!.role as any);
    if (!isManager && entry.technicianId !== req.user!.id) {
      throw createError(403, "Cannot view another technician's time entry");
    }

    res.json(entry);
  })
);

/**
 * PUT /api/time/entries/:id
 * Update a time entry
 * Tech can edit their own non-invoiced entries
 * Managers can edit any entry (with override for invoiced entries)
 */
timeRouter.put(
  "/entries/:id",
  requireRole(TECH_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const validated = validateSchema(updateTimeEntrySchema, req.body);

    const entry = await timeTrackingRepository.getTimeEntry(
      req.companyId!,
      req.params.id
    );

    if (!entry) {
      throw createError(404, "Time entry not found");
    }

    const isManager = MANAGER_ROLES.includes(req.user!.role as any);

    // Tech can only edit their own entries
    if (!isManager && entry.technicianId !== req.user!.id) {
      throw createError(403, "Cannot edit another technician's time entry");
    }

    const updated = await timeTrackingRepository.updateTimeEntry(
      req.companyId!,
      req.params.id,
      {
        jobId: validated.jobId,
        type: validated.type,
        startAt: validated.startAt ? new Date(validated.startAt) : undefined,
        endAt: validated.endAt !== undefined
          ? validated.endAt
            ? new Date(validated.endAt)
            : null
          : undefined,
        billable: validated.billable,
        notes: validated.notes,
      },
      { overrideInvoiceLock: isManager }
    );

    emitDispatch(req.companyId!, { scope: "time", entityType: "visit", entityId: req.params.id, ts: new Date().toISOString() });
    res.json(updated);
  })
);

/**
 * POST /api/time/entries/:id/link-job
 * Link a time entry to a job (manager tool for unassigned entries)
 * Managers only
 */
timeRouter.post(
  "/entries/:id/link-job",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const linkJobSchema = z.object({
      jobId: z.string().uuid(),
    });

    const validated = validateSchema(linkJobSchema, req.body);

    const updated = await timeTrackingRepository.linkTimeEntryToJob(
      req.companyId!,
      req.params.id,
      validated.jobId,
      { overrideInvoiceLock: true }
    );

    // Audit log for job linking
    console.log(
      JSON.stringify({
        event: "time_entry_link_job",
        companyId: req.companyId,
        userId: req.user!.id,
        timeEntryId: req.params.id,
        jobId: validated.jobId,
        timestamp: new Date().toISOString(),
      })
    );

    res.json(updated);
  })
);

// ============================================================================
// MANAGER-ONLY ENDPOINTS (Phase 3 - Unassigned Time Review)
// ============================================================================

/**
 * GET /api/time/unassigned
 * Get unassigned time entries (jobId is null)
 * Managers only - used to review and link orphaned time entries
 */
timeRouter.get(
  "/unassigned",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { date, from, to, technicianId, includeRunning } = req.query;

    const entries = await timeTrackingRepository.getUnassignedTimeEntries(
      req.companyId!,
      {
        date: date as string | undefined,
        from: from as string | undefined,
        to: to as string | undefined,
        technicianId: technicianId as string | undefined,
        includeRunning: includeRunning === "true",
      }
    );

    res.json(entries);
  })
);

/**
 * PUT /api/time/entries/:id/manager
 * Manager-only edit endpoint for time entries
 * Supports billable toggle, notes, type, and time edits with overlap validation
 * Includes invoice lock override with required reason
 */
timeRouter.put(
  "/entries/:id/manager",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const validated = validateSchema(managerUpdateTimeEntrySchema, req.body);

    const updated = await timeTrackingRepository.updateTimeEntryManager(
      req.companyId!,
      req.params.id,
      {
        billable: validated.billable,
        notes: validated.notes,
        type: validated.type,
        startAt: validated.startAt ? new Date(validated.startAt) : undefined,
        endAt:
          validated.endAt !== undefined
            ? validated.endAt
              ? new Date(validated.endAt)
              : null
            : undefined,
      },
      {
        userId: req.user!.id,
        overrideInvoiceLock: validated.overrideInvoiceLock,
        overrideReason: validated.overrideReason,
      }
    );

    res.json(updated);
  })
);

/**
 * DELETE /api/time/entries/:id
 * Delete a time entry (manager only)
 * Reuses canonical deleteTimeEntry storage method
 */
timeRouter.delete(
  "/entries/:id",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    await timeTrackingRepository.deleteTimeEntry(req.companyId!, req.params.id, {
      userId: req.user!.id,
    });
    res.status(204).end();
  })
);

// ============================================================================
// PAYROLL ROUTES (Phase 4 - Weekly Summary + Approval + CSV)
// ============================================================================

/**
 * GET /api/payroll/weekly
 * Get weekly payroll summary for all technicians
 * Managers only
 *
 * Query params:
 *   weekStart: YYYY-MM-DD (any date in the week, will be normalized to Monday)
 */
payrollRouter.get(
  "/weekly",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { weekStart } = req.query;

    if (!weekStart || typeof weekStart !== "string") {
      throw createError(400, "weekStart query parameter is required (YYYY-MM-DD)");
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(weekStart)) {
      throw createError(400, "weekStart must be in YYYY-MM-DD format");
    }

    const summaries = await timeTrackingRepository.getWeeklyPayrollSummary(
      req.companyId!,
      weekStart
    );

    res.json(summaries);
  })
);

/**
 * POST /api/payroll/approve
 * Approve a week for a technician (locks time entries and work sessions for that week)
 * Managers only
 */
payrollRouter.post(
  "/approve",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const validated = validateSchema(approveWeekRequestSchema, req.body);

    const approval = await timeTrackingRepository.approveWeek(
      req.companyId!,
      validated.technicianId,
      validated.weekStart,
      req.user!.id,
      { notes: validated.notes }
    );

    // Audit log
    console.log(
      JSON.stringify({
        event: "payroll_week_approved",
        companyId: req.companyId,
        userId: req.user!.id,
        technicianId: validated.technicianId,
        weekStart: validated.weekStart,
        approvalId: approval.id,
        timestamp: new Date().toISOString(),
      })
    );

    res.status(201).json(approval);
  })
);

/**
 * GET /api/payroll/weekly.csv
 * Export weekly payroll summary as CSV
 * Managers only
 *
 * Query params:
 *   weekStart: YYYY-MM-DD (any date in the week, will be normalized to Monday)
 */
payrollRouter.get(
  "/weekly.csv",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { weekStart } = req.query;

    if (!weekStart || typeof weekStart !== "string") {
      throw createError(400, "weekStart query parameter is required (YYYY-MM-DD)");
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(weekStart)) {
      throw createError(400, "weekStart must be in YYYY-MM-DD format");
    }

    const summaries = await timeTrackingRepository.getWeeklyPayrollSummary(
      req.companyId!,
      weekStart
    );

    const { weekStart: normalizedWeekStart } =
      timeTrackingRepository.getWeekRange(weekStart);

    const csv = timeTrackingRepository.generatePayrollCsv(summaries);

    // Set headers for CSV download
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="payroll_${normalizedWeekStart}.csv"`
    );

    res.send(csv);
  })
);

// ============================================================================
// JOB STATUS - Mobile Flow (mounted at /api/jobs)
// ============================================================================

/**
 * POST /api/jobs/:jobId/status
 * Update job status from mobile (triggers time entry creation/stopping)
 * Tech can update status for jobs they are assigned to
 */
jobTimeRouter.post(
  "/:jobId/status",
  requireRole(TECH_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const validated = validateSchema(jobStatusUpdateRequestSchema, req.body);

    const result = await timeTrackingRepository.recordJobStatus(
      req.companyId!,
      req.user!.id,
      req.params.jobId,
      {
        status: validated.status,
        at: validated.at ? new Date(validated.at) : undefined,
        notes: validated.notes,
        source: validated.source,
      }
    );

    res.status(201).json(result);
  })
);

/**
 * GET /api/jobs/:jobId/status-events
 * Get all status events for a job
 */
jobTimeRouter.get(
  "/:jobId/status-events",
  requireRole(TECH_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const events = await timeTrackingRepository.getJobStatusEvents(
      req.companyId!,
      req.params.jobId
    );

    res.json(events);
  })
);

// ============================================================================
// JOB TIME SUMMARY & ENTRIES
// ============================================================================

/**
 * GET /api/jobs/:jobId/time-summary
 * Get time summary for a job (totals + breakdown by technician)
 */
jobTimeRouter.get(
  "/:jobId/time-summary",
  requireRole(TECH_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const summary = await timeTrackingRepository.getJobTimeSummary(
      req.companyId!,
      req.params.jobId
    );

    res.json(summary);
  })
);

/**
 * GET /api/jobs/:jobId/time-entries
 * Get all time entries for a job (read-only listing)
 * Returns entries with technician name for display
 */
jobTimeRouter.get(
  "/:jobId/time-entries",
  requireRole(TECH_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const entries = await timeTrackingRepository.getJobTimeEntries(
      req.companyId!,
      req.params.jobId
    );

    res.json(entries);
  })
);

// ============================================================================
// MIDNIGHT ROLLOVER REPORTING (2026-04-16)
// ============================================================================

/**
 * GET /api/time/auto-paused
 * Office/admin visibility into entries closed by the midnight rollover
 * worker. Returns the most recent auto-paused time entries with job,
 * visit, and technician context so managers can see which jobs had
 * overnight labour activity.
 *
 * Query params:
 *   from   ISO date-time, optional — inclusive lower bound on
 *          `auto_paused_at`. Defaults to 7 days ago.
 *   to     ISO date-time, optional — inclusive upper bound on
 *          `auto_paused_at`. Defaults to now.
 *   limit  number, optional — max rows (default 200, hard cap 500).
 */
const autoPausedQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

timeRouter.get(
  "/auto-paused",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const parsed = autoPausedQuerySchema.parse(req.query);
    const to = parsed.to ? new Date(parsed.to) : new Date();
    const from = parsed.from
      ? new Date(parsed.from)
      : new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    const limit = parsed.limit ?? 200;

    const rows = await db
      .select({
        id: timeEntries.id,
        technicianId: timeEntries.technicianId,
        technicianName: users.fullName,
        jobId: timeEntries.jobId,
        jobNumber: jobs.jobNumber,
        visitId: timeEntries.visitId,
        visitIsActive: jobVisits.isActive,
        type: timeEntries.type,
        startAt: timeEntries.startAt,
        endAt: timeEntries.endAt,
        durationMinutes: timeEntries.durationMinutes,
        autoPausedAt: timeEntries.autoPausedAt,
      })
      .from(timeEntries)
      .leftJoin(users, eq(timeEntries.technicianId, users.id))
      .leftJoin(jobs, eq(timeEntries.jobId, jobs.id))
      .leftJoin(jobVisits, eq(timeEntries.visitId, jobVisits.id))
      .where(
        and(
          eq(timeEntries.companyId, req.companyId!),
          isNotNull(timeEntries.autoPausedAt),
          gte(timeEntries.autoPausedAt, from),
          lte(timeEntries.autoPausedAt, to),
        ),
      )
      .orderBy(desc(timeEntries.autoPausedAt))
      .limit(limit);

    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      count: rows.length,
      entries: rows,
    });
  }),
);

// Export routers
export { timeRouter, jobTimeRouter, payrollRouter };
export default timeRouter;
