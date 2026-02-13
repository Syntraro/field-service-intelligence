import { db } from "../db";
import { eq, and, or, gte, lt, isNull, sql, inArray, notInArray, asc, desc } from "drizzle-orm";
import {
  jobs,
  users,
  technicianProfiles,
  clientLocations,
  customerCompanies,
  jobScheduleAudit,
  jobVisits,
} from "@shared/schema";
import { BaseRepository } from "./base";
import { jobVisitsRepository, isVisitActioned } from "./jobVisits";
import { resolveTechnicianName } from "../lib/resolveTechnicianName";
// ============================================================================
// ARCHITECTURE NOTE: Calendar vs Visit Feed (Phase 3 Step E)
// ============================================================================
//
// Calendar is a SEPARATE projection family from the canonical visit feed.
// Do NOT attempt to unify these query paths — they serve different purposes:
//
// Visit Feed (server/storage/visits.ts):
//   - Flat list of visits with job + location joins
//   - RBAC auto-scoping (technicians see only their assigned visits)
//   - Used by: tech field pages, admin visit lists
//   - Query family: ['visits', ...]
//
// Calendar (this file):
//   - CTE-based query with per-job ranking (ROW_NUMBER for current eligible visit)
//   - Technician profile enrichment (colours, display names)
//   - All-day event normalization + backlog logic
//   - Used by: calendar page, dispatch views
//   - Query family: ['/api/calendar', ...] and ['/api/calendar/range', ...]
//
// Both paths enforce tenant isolation via companyId.
// ============================================================================
import {
  // Domain helpers - SINGLE SOURCE OF TRUTH for scheduling logic
  BACKLOG_STATUS,
  TERMINAL_STATUSES,
  deriveScheduleFields,
  hasTechnicianAssigned,
  assertSchedulingInvariants,
  assertTerminalImmutable,
  assertCalendarQueryResults,
  assertBacklogQueryResults,
  assertSchedulingWriteContext,
  assertVersionMatch,
  applyJobSchedulingPatch,
  normalizeScheduleTimes,
  type SchedulingWriteIntent,
  // Technician assignment helpers
  normalizeTechnicianAssignment,
  assertTechnicianAssignmentInvariant,
  // Error classes for optimized version checking
  VersionMismatchError,
  VersionNotInitializedError,
  TerminalJobImmutableError,
} from "../domain/scheduling";
import { sanitizeAllDayTimestamps } from "../utils/allDaySanitizer";
import { IS_DEV } from "../utils/devFlags";

// ============================================================================
// CANONICAL SCHEDULING MODEL
// ============================================================================
//
// All scheduling logic is delegated to server/domain/scheduling.ts
// This file only handles DB queries and persistence.
//
// CANONICAL RULE: A job is scheduled if and only if scheduledStart IS NOT NULL.
//
// IMPORTANT: isAllDay is a DISPLAY flag only, NOT a scheduling determinant.
// For all-day events, scheduledStart is set to midnight (00:00:00) of the day.
// This ensures all scheduled jobs have scheduledStart set, enabling consistent queries.
//
// POLICY:
// 1) "Unscheduled" = scheduledStart IS NULL
// 2) "Scheduled" = scheduledStart IS NOT NULL
// 3) Calendar grid shows jobs with scheduledStart in range
// 4) Backlog shows 'open' jobs with scheduledStart IS NULL
// 5) Terminal statuses (invoiced/archived) never appear in backlog or calendar
//
// ============================================================================

/**
 * Default calendar visible hours (6am - 7pm)
 */
export const DEFAULT_CALENDAR_START_HOUR = 6;
export const DEFAULT_CALENDAR_END_HOUR = 19;

/**
 * Result from getScheduledJobsInRange with metadata
 */
export interface CalendarRangeResult {
  jobs: CalendarJobWithDetails[];
  outsideVisibleHoursCount: number;
}

/**
 * Calendar job with joined technician and location info
 * (Renamed from CalendarJobWithDetails — no separate "assignment" entity exists)
 */
export interface CalendarJobWithDetails {
  id: string;
  companyId: string;
  jobId: string;
  jobNumber: number;
  jobType: string;
  summary: string;
  status: string;
  locationId: string;
  locationName: string;
  customerCompanyId: string | null;
  customerCompanyName: string | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  isAllDay: boolean;
  /** Scheduled job duration in minutes (canonical) */
  durationMinutes: number | null;
  assignedTechnicianIds: string[] | null;
  primaryTechnicianId: string | null;
  technicians: Array<{
    id: string;
    name: string;
    color: string | null;
  }>;
  /** Job version for optimistic locking */
  version: number;
  /** Visit ID (the job_visit driving this calendar event) - ADDITIVE */
  visitId?: string;
  /** Visit number within the job (e.g., 1, 2, 3) - ADDITIVE */
  visitNumber?: number | null;
}

/**
 * Count scheduled jobs outside the visible calendar hours.
 * Only counts timed events (is_all_day = false).
 *
 * A job is counted as "outside visible hours" if:
 * - scheduledStart is before the visible window (hour < startHour)
 * - scheduledStart is at or after the visible window end (hour >= endHour)
 * - scheduledEnd extends beyond the visible window (endHour < scheduledEnd hour)
 *
 * @param scheduledJobs - Calendar jobs to check
 * @param startHour - Calendar visible start hour (inclusive)
 * @param endHour - Calendar visible end hour (exclusive)
 * @returns Count of jobs outside visible hours
 */
export function countOutsideVisibleHours(
  scheduledJobs: CalendarJobWithDetails[],
  startHour: number = DEFAULT_CALENDAR_START_HOUR,
  endHour: number = DEFAULT_CALENDAR_END_HOUR
): number {
  return scheduledJobs.filter((a) => {
    // Skip all-day events
    if (a.isAllDay) return false;
    // Skip if no scheduled start
    if (!a.scheduledStart) return false;

    const startHourOfJob = a.scheduledStart.getHours();
    const startMinOfJob = a.scheduledStart.getMinutes();

    // Job starts before visible window
    if (startHourOfJob < startHour) return true;

    // Job starts at or after visible window end
    if (startHourOfJob >= endHour) return true;

    // Check if job end extends beyond visible window
    if (a.scheduledEnd) {
      const endHourOfJob = a.scheduledEnd.getHours();
      const endMinOfJob = a.scheduledEnd.getMinutes();

      // Job ends after visible window end (comparing time, not just hour)
      // Note: endHour:00 is the exclusive boundary, so ending exactly at endHour:00 is OK
      if (endHourOfJob > endHour || (endHourOfJob === endHour && endMinOfJob > 0)) {
        return true;
      }
    }

    return false;
  }).length;
}

export class CalendarRepository extends BaseRepository {
  /**
   * PHASE 3: Get scheduled jobs for a date range from job_visits
   *
   * MIGRATION: Now reads from job_visits instead of jobs.scheduledStart
   * Uses same selection rules as syncJobScheduleFromVisits:
   * - Eligible visit = is_active=true, scheduled_start NOT NULL, status NOT IN (cancelled, completed)
   * - Selection = earliest future visit if any, else most recent past
   * - Only include jobs whose "next visit" falls in [startDate, endDate)
   *
   * INVARIANTS:
   * - Calendar shows SCHEDULED work only (NOT status-based)
   * - Schedule data comes from job_visits (transitional until Model B)
   * - Technician data comes from visit.assigned_technician_ids
   * - Range is [startDate, endDate) - exclusive end to prevent boundary issues
   *
   * @param companyId - Tenant ID
   * @param startDate - Range start (inclusive)
   * @param endDate - Range end (EXCLUSIVE - use start of next period)
   */
  async getScheduledJobsInRange(
    companyId: string,
    startDate: Date,
    endDate: Date
  ): Promise<CalendarJobWithDetails[]> {
    // PHASE 3: Excluded visit statuses (same as syncJobScheduleFromVisits)
    const EXCLUDED_VISIT_STATUSES = ['cancelled', 'completed'];
    const now = new Date();

    // Step 1: Get all eligible visits for this company, grouped and ranked per job
    // Using raw SQL for the window function ranking
    const rankedVisitsQuery = await db.execute(sql`
      WITH eligible_visits AS (
        SELECT
          jv.id as visit_id,
          jv.job_id,
          jv.scheduled_start,
          jv.scheduled_end,
          jv.is_all_day,
          jv.assigned_technician_id,
          jv.assigned_technician_ids,
          jv.estimated_duration_minutes,
          jv.status as visit_status,
          jv.visit_number
        FROM job_visits jv
        WHERE jv.company_id = ${companyId}
          AND jv.is_active = true
          AND jv.scheduled_start IS NOT NULL
          AND jv.status NOT IN ('cancelled', 'completed')
      ),
      ranked_visits AS (
        SELECT
          ev.*,
          ROW_NUMBER() OVER (
            PARTITION BY ev.job_id
            ORDER BY
              CASE WHEN ev.scheduled_start >= ${now} THEN 0 ELSE 1 END,
              CASE WHEN ev.scheduled_start >= ${now} THEN ev.scheduled_start END ASC NULLS LAST,
              CASE WHEN ev.scheduled_start < ${now} THEN ev.scheduled_start END DESC NULLS LAST
          ) as rn
        FROM eligible_visits ev
      )
      SELECT
        rv.visit_id,
        rv.job_id,
        rv.scheduled_start,
        rv.scheduled_end,
        rv.is_all_day,
        rv.assigned_technician_id,
        rv.assigned_technician_ids,
        rv.estimated_duration_minutes,
        rv.visit_number,
        j.id,
        j.company_id,
        j.job_number,
        j.job_type,
        j.summary,
        j.status,
        j.location_id,
        j.version,
        cl.company_name as location_name,
        cl.parent_company_id as customer_company_id
      FROM ranked_visits rv
      JOIN jobs j ON rv.job_id = j.id
      LEFT JOIN client_locations cl ON j.location_id = cl.id
      WHERE rv.rn = 1
        AND rv.scheduled_start >= ${startDate}
        AND rv.scheduled_start < ${endDate}
        AND j.deleted_at IS NULL AND j.is_active = true
      ORDER BY rv.scheduled_start
    `);

    // Parse raw results
    const jobRows = (rankedVisitsQuery.rows || []) as Array<{
      visit_id: string;
      job_id: string;
      scheduled_start: Date | string;
      scheduled_end: Date | string | null;
      is_all_day: boolean;
      assigned_technician_id: string | null;
      assigned_technician_ids: string[] | null;
      estimated_duration_minutes: number | null;
      visit_number: number | null;
      id: string;
      company_id: string;
      job_number: number;
      job_type: string;
      summary: string;
      status: string;
      location_id: string;
      version: number;
      location_name: string | null;
      customer_company_id: string | null;
    }>;

    // DEV-only debug log
    if (IS_DEV) {
      console.log(
        `[Calendar] getScheduledJobsInRange (PHASE 3 - job_visits): company=${companyId} range=[${startDate.toISOString()}, ${endDate.toISOString()}) found=${jobRows.length} scheduled`
      );
    }

    if (jobRows.length === 0) {
      return [];
    }

    // Collect all technician IDs to fetch in bulk (from VISIT data)
    const technicianIdSet = new Set<string>();
    const customerCompanyIds = new Set<string>();

    for (const row of jobRows) {
      if (row.assigned_technician_id) {
        technicianIdSet.add(row.assigned_technician_id);
      }
      if (row.assigned_technician_ids) {
        for (const techId of row.assigned_technician_ids) {
          technicianIdSet.add(techId);
        }
      }
      if (row.customer_company_id) {
        customerCompanyIds.add(row.customer_company_id);
      }
    }

    // Fetch technicians with their profiles for color
    const technicianIds = Array.from(technicianIdSet);
    const technicianMap = new Map<string, { id: string; name: string; color: string | null }>();

    if (technicianIds.length > 0) {
      const techRows = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          fullName: users.fullName,
          color: technicianProfiles.color,
        })
        .from(users)
        .leftJoin(technicianProfiles, eq(users.id, technicianProfiles.userId))
        .where(inArray(users.id, technicianIds));

      for (const tech of techRows) {
        // Phase 4 Step B2: canonical tech name resolution
        const name = resolveTechnicianName(tech);
        technicianMap.set(tech.id, {
          id: tech.id,
          name,
          color: tech.color,
        });
      }
    }

    // Fetch customer company names
    const customerCompanyMap = new Map<string, string>();
    if (customerCompanyIds.size > 0) {
      const companyRows = await db
        .select({
          id: customerCompanies.id,
          name: customerCompanies.name,
        })
        .from(customerCompanies)
        .where(inArray(customerCompanies.id, Array.from(customerCompanyIds)));

      for (const cc of companyRows) {
        customerCompanyMap.set(cc.id, cc.name);
      }
    }

    // Build result with technician details
    // PHASE 3: Use visit data for schedule fields, job data for everything else
    const results = jobRows.map((row) => {
      // Technician IDs from visit (fallback to single tech if array is null)
      const techIds = row.assigned_technician_ids ||
        (row.assigned_technician_id ? [row.assigned_technician_id] : []);
      const technicians = techIds
        .map((id) => technicianMap.get(id))
        .filter((t): t is { id: string; name: string; color: string | null } => t !== undefined);

      // Parse dates (may be strings from raw SQL)
      const scheduledStart = row.scheduled_start
        ? (row.scheduled_start instanceof Date ? row.scheduled_start : new Date(row.scheduled_start))
        : null;
      const scheduledEnd = row.scheduled_end
        ? (row.scheduled_end instanceof Date ? row.scheduled_end : new Date(row.scheduled_end))
        : null;

      // Compute duration from visit data
      let durationMinutes: number | null = null;
      if (!row.is_all_day && scheduledStart && scheduledEnd) {
        durationMinutes = Math.max(15, Math.round((scheduledEnd.getTime() - scheduledStart.getTime()) / 60000));
      }

      return {
        id: row.job_id,
        companyId: row.company_id,
        jobId: row.job_id,
        jobNumber: row.job_number,
        jobType: row.job_type,
        summary: row.summary,
        status: row.status,
        locationId: row.location_id,
        locationName: row.location_name || "Unknown Location",
        customerCompanyId: row.customer_company_id,
        customerCompanyName: row.customer_company_id
          ? customerCompanyMap.get(row.customer_company_id) || null
          : null,
        // PHASE 3: Schedule data from visit
        scheduledStart,
        scheduledEnd,
        isAllDay: row.is_all_day ?? false,
        durationMinutes,
        // PHASE 3: Technician data from visit
        assignedTechnicianIds: techIds.length > 0 ? techIds : null,
        primaryTechnicianId: row.assigned_technician_id,
        technicians,
        version: row.version,
        // ADDITIVE: Visit info for calendar cards
        visitId: row.visit_id,
        visitNumber: row.visit_number,
      };
    });

    // DEV: Assert calendar results meet Model A invariants
    assertCalendarQueryResults(results, "storage:getScheduledJobsInRange:PHASE3");

    return results;
  }

  /**
   * MODEL A: Get scheduled jobs with metadata for a date range
   *
   * Same as getScheduledJobsInRange but also returns:
   * - outsideVisibleHoursCount: number of timed events outside visible hours
   *
   * @param companyId - Tenant ID
   * @param startDate - Range start (inclusive)
   * @param endDate - Range end (EXCLUSIVE)
   * @param calendarStartHour - Visible start hour (default: 6)
   * @param calendarEndHour - Visible end hour (default: 19)
   */
  async getScheduledJobsInRangeWithMetadata(
    companyId: string,
    startDate: Date,
    endDate: Date,
    calendarStartHour: number = DEFAULT_CALENDAR_START_HOUR,
    calendarEndHour: number = DEFAULT_CALENDAR_END_HOUR
  ): Promise<CalendarRangeResult> {
    const scheduledJobs = await this.getScheduledJobsInRange(companyId, startDate, endDate);
    const outsideVisibleHoursCount = countOutsideVisibleHours(
      scheduledJobs,
      calendarStartHour,
      calendarEndHour
    );

    if (IS_DEV && outsideVisibleHoursCount > 0) {
      console.log(
        `[Calendar] getScheduledJobsInRangeWithMetadata: ${outsideVisibleHoursCount} jobs outside visible hours (${calendarStartHour}:00-${calendarEndHour}:00)`
      );
    }

    return { jobs: scheduledJobs, outsideVisibleHoursCount };
  }

  /**
   * CANONICAL BACKLOG: Get unscheduled jobs (backlog sidebar)
   *
   * CANONICAL PREDICATE: isBacklogEligible(job) = status==='open' && scheduledStart IS NULL
   *
   * INVARIANTS:
   * - Backlog = ALL open jobs that are NOT scheduled
   * - Unscheduled = scheduledStart IS NULL (canonical check)
   * - All-day events have scheduledStart set (to midnight), so they appear on calendar
   * - Status must be 'open' (active lifecycle state)
   * - NO filtering by technician assignment - backlog includes assigned AND unassigned
   * - Terminal statuses (completed, invoiced, archived) NEVER appear
   *
   * @param companyId - Tenant ID
   */
  async getUnscheduledJobs(companyId: string): Promise<CalendarJobWithDetails[]> {
    const jobRows = await db
      .select({
        id: jobs.id,
        companyId: jobs.companyId,
        jobNumber: jobs.jobNumber,
        jobType: jobs.jobType,
        summary: jobs.summary,
        status: jobs.status,
        locationId: jobs.locationId,
        scheduledStart: jobs.scheduledStart,
        scheduledEnd: jobs.scheduledEnd,
        isAllDay: jobs.isAllDay,
        durationMinutes: jobs.durationMinutes,
        assignedTechnicianIds: jobs.assignedTechnicianIds,
        primaryTechnicianId: jobs.primaryTechnicianId,
        locationName: clientLocations.companyName,
        customerCompanyId: clientLocations.parentCompanyId,
        version: jobs.version,
      })
      .from(jobs)
      .leftJoin(clientLocations, eq(jobs.locationId, clientLocations.id))
      .where(
        and(
          eq(jobs.companyId, companyId),
          // Exclude soft-deleted/deactivated jobs
          isNull(jobs.deletedAt),
          eq(jobs.isActive, true),
          // CANONICAL BACKLOG: scheduledStart IS NULL means unscheduled
          // All-day events have scheduledStart set (to midnight), so they won't appear here
          isNull(jobs.scheduledStart),
          // Only 'open' status jobs can be in backlog (canonical predicate)
          // Terminal statuses (completed, invoiced, archived) never appear in backlog
          eq(jobs.status, BACKLOG_STATUS)
          // NOTE: NO technician filter - backlog includes ALL unscheduled open jobs
        )
      )
      .orderBy(jobs.jobNumber);

    // DEV-only debug log
    if (IS_DEV) {
      console.log(
        `[Calendar] getUnscheduledJobs: company=${companyId} status=${BACKLOG_STATUS} found=${jobRows.length} backlog`
      );
    }

    if (jobRows.length === 0) {
      return [];
    }

    // Collect all technician IDs to fetch in bulk
    const technicianIdSet = new Set<string>();
    const customerCompanyIds = new Set<string>();

    for (const job of jobRows) {
      if (job.primaryTechnicianId) {
        technicianIdSet.add(job.primaryTechnicianId);
      }
      if (job.assignedTechnicianIds) {
        for (const techId of job.assignedTechnicianIds) {
          technicianIdSet.add(techId);
        }
      }
      if (job.customerCompanyId) {
        customerCompanyIds.add(job.customerCompanyId);
      }
    }

    // Fetch technicians with their profiles for color
    const technicianIds = Array.from(technicianIdSet);
    const technicianMap = new Map<string, { id: string; name: string; color: string | null }>();

    if (technicianIds.length > 0) {
      const techRows = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          fullName: users.fullName,
          color: technicianProfiles.color,
        })
        .from(users)
        .leftJoin(technicianProfiles, eq(users.id, technicianProfiles.userId))
        .where(inArray(users.id, technicianIds));

      for (const tech of techRows) {
        // Phase 4 Step B2: canonical tech name resolution
        const name = resolveTechnicianName(tech);
        technicianMap.set(tech.id, {
          id: tech.id,
          name,
          color: tech.color,
        });
      }
    }

    // Fetch customer company names
    const customerCompanyMap = new Map<string, string>();
    if (customerCompanyIds.size > 0) {
      const companyRows = await db
        .select({
          id: customerCompanies.id,
          name: customerCompanies.name,
        })
        .from(customerCompanies)
        .where(inArray(customerCompanies.id, Array.from(customerCompanyIds)));

      for (const cc of companyRows) {
        customerCompanyMap.set(cc.id, cc.name);
      }
    }

    // Build result with technician details
    const results = jobRows.map((job) => {
      const techIds = job.assignedTechnicianIds || [];
      const technicians = techIds
        .map((id) => technicianMap.get(id))
        .filter((t): t is { id: string; name: string; color: string | null } => t !== undefined);

      return {
        id: job.id,
        companyId: job.companyId,
        jobId: job.id,
        jobNumber: job.jobNumber,
        jobType: job.jobType,
        summary: job.summary,
        status: job.status,
        locationId: job.locationId,
        locationName: job.locationName || "Unknown Location",
        customerCompanyId: job.customerCompanyId,
        customerCompanyName: job.customerCompanyId
          ? customerCompanyMap.get(job.customerCompanyId) || null
          : null,
        scheduledStart: job.scheduledStart,
        scheduledEnd: job.scheduledEnd,
        isAllDay: job.isAllDay ?? false,
        durationMinutes: job.durationMinutes,
        assignedTechnicianIds: job.assignedTechnicianIds,
        primaryTechnicianId: job.primaryTechnicianId,
        technicians,
        version: job.version,
      };
    });

    // DEV: Assert backlog results meet Model A invariants
    assertBacklogQueryResults(results, "storage:getUnscheduledJobs");

    return results;
  }

  /**
   * Get a single job by ID (for update/delete validation).
   * Excludes soft-deleted and deactivated jobs.
   */
  async getJobById(companyId: string, jobId: string) {
    const rows = await db
      .select()
      .from(jobs)
      .where(and(
        eq(jobs.id, jobId),
        eq(jobs.companyId, companyId),
        isNull(jobs.deletedAt),
        eq(jobs.isActive, true),
      ))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Write a scheduling audit log entry.
   * Used by scheduling mutations to track changes.
   */
  private async writeScheduleAudit(
    tx: { insert: typeof db.insert },
    params: {
      jobId: string;
      companyId: string;
      userId?: string | null;
      contextLabel: string;
      oldFields: Record<string, unknown> | null;
      newFields: Record<string, unknown>;
    }
  ) {
    await tx.insert(jobScheduleAudit).values({
      jobId: params.jobId,
      companyId: params.companyId,
      userId: params.userId || null,
      contextLabel: params.contextLabel,
      oldFields: params.oldFields,
      newFields: params.newFields,
    });
  }

  /**
   * PHASE 4: Schedule a job (place it on the calendar)
   *
   * MIGRATION: Now writes to job_visits instead of jobs table.
   * The jobs table is updated via syncJobScheduleFromVisits for backwards compat.
   *
   * BEHAVIOR:
   * - Creates a new job_visit row with scheduled_start/end, technician assignment
   * - visit_number is auto-computed as max(existing)+1
   * - Calls syncJobScheduleFromVisits to mirror to jobs table
   * - Returns the job row (after sync) for API response compatibility
   *
   * INVARIANTS:
   * - job_visits.scheduled_start is always set for scheduled events
   * - jobs.* schedule fields are driven ONLY by syncJobScheduleFromVisits
   */
  async scheduleJob(
    companyId: string,
    data: {
      jobId: string;
      technicianUserId?: string | null;
      startAt: Date;
      endAt: Date;
      notes?: string;
      allDay?: boolean;
      timezone?: string;
      expectedVersion?: number;
    }
  ) {
    // Normalize schedule times through canonical helper
    const normalized = normalizeScheduleTimes({
      allDay: data.allDay,
      startAt: data.startAt,
      endAt: data.endAt,
    });

    // Sanitize for all-day if needed
    let scheduledStart = normalized.scheduledStart;
    let scheduledEnd = normalized.scheduledEnd;
    const isAllDay = normalized.isAllDay;

    // Build technician assignment
    const techAssignment = normalizeTechnicianAssignment(data.technicianUserId || null);

    if (IS_DEV) {
      console.log('[SCHEDULE-DEBUG] scheduleJob (PHASE 4 - job_visits) called:', {
        jobId: data.jobId,
        allDay: data.allDay,
        isAllDay,
        scheduledStart: scheduledStart?.toISOString(),
        scheduledEnd: scheduledEnd?.toISOString(),
        expectedVersion: data.expectedVersion,
      });
    }

    // First verify job exists, belongs to tenant, and check version + terminal status
    const existingJob = await this.getJobById(companyId, data.jobId);
    if (!existingJob) {
      throw new Error('Job not found');
    }

    // Terminal status check
    if (TERMINAL_STATUSES.includes(existingJob.status as any)) {
      throw new TerminalJobImmutableError(data.jobId, existingJob.status);
    }

    // Version check (optimistic locking against job version)
    if (data.expectedVersion !== undefined) {
      if (existingJob.version === null || existingJob.version === undefined) {
        throw new VersionNotInitializedError(data.jobId);
      }
      if (existingJob.version !== data.expectedVersion) {
        throw new VersionMismatchError(data.expectedVersion, existingJob.version);
      }
    }

    // PHASE 4: Create job_visit row
    const visit = await jobVisitsRepository.createJobVisit(companyId, data.jobId, {
      scheduledStart,
      scheduledEnd,
      isAllDay,
      assignedTechnicianId: techAssignment.primaryTechnicianId,
      assignedTechnicianIds: techAssignment.assignedTechnicianIds,
      status: 'scheduled',
      visitNotes: data.notes,
    });

    // JOBBER-LIKE BEHAVIOR: Reopen completed jobs when scheduling a follow-up visit.
    // Rationale: A completed job means "the work is done". Scheduling another visit
    // means "more work is needed", so the job should return to 'open' status.
    // This is a valid status transition per JOB_STATUS_FLOW: completed -> open.
    // syncJobScheduleFromVisits only mirrors schedule fields, not status.
    if (existingJob.status === 'completed') {
      await db
        .update(jobs)
        .set({
          status: 'open',
          openSubStatus: null, // Clear any sub-status
          updatedAt: new Date(),
          // Note: version is already incremented by syncJobScheduleFromVisits
        })
        .where(and(eq(jobs.id, data.jobId), eq(jobs.companyId, companyId)));

      if (IS_DEV) {
        console.log(`[Calendar] scheduleJob: Reopened completed job ${data.jobId} to 'open' status`);
      }
    }

    // syncJobScheduleFromVisits is called inside createJobVisit, which updates jobs table
    // Re-fetch job to return updated data
    const result = await this.getJobById(companyId, data.jobId);

    // Write audit log
    const wasReopened = existingJob.status === 'completed';
    await db.insert(jobScheduleAudit).values({
      jobId: data.jobId,
      companyId,
      userId: null,
      contextLabel: wasReopened ? 'storage:scheduleJob:PHASE4:reopen' : 'storage:scheduleJob:PHASE4',
      oldFields: wasReopened ? { status: 'completed' } : null,
      newFields: {
        visitId: visit.id,
        scheduledStart: result?.scheduledStart,
        scheduledEnd: result?.scheduledEnd,
        isAllDay: result?.isAllDay,
        version: result?.version,
        ...(wasReopened && { status: 'open', statusChange: 'completed -> open' }),
      },
    });

    if (IS_DEV) {
      console.log(
        `[Calendar] scheduleJob (PHASE 4): job=${data.jobId} visitId=${visit.id} scheduledStart=${result?.scheduledStart?.toISOString()} isAllDay=${result?.isAllDay} version=${result?.version}`
      );
    }

    // Return job with visit info for client-side highlighting
    return {
      ...result,
      visit: {
        id: visit.id,
        scheduledStart: visit.scheduledStart,
        scheduledEnd: visit.scheduledEnd,
        isAllDay: visit.isAllDay,
        status: visit.status,
      },
    };
  }

  /**
   * PHASE 4: Reschedule a job (update schedule/reassign technician)
   *
   * MIGRATION: Now writes to job_visits instead of jobs table.
   * The jobs table is updated via syncJobScheduleFromVisits for backwards compat.
   *
   * SPAWN-ON-ACTION BEHAVIOR:
   * - Finds the "current eligible visit" (same selection as calendar read)
   * - If visit has NO activity: updates that visit's fields (no new visit created)
   * - If visit IS actioned (checkedIn, status progressed, etc.):
   *   - Soft-deletes old visit (is_active=false) to preserve history
   *   - Creates a new visit with the requested schedule fields
   * - Respects optimistic locking via job.version (not visit.version) for API compat
   * - Calls syncJobScheduleFromVisits to mirror to jobs table
   * - Returns the job row (after sync) for API response compatibility
   *
   * INVARIANT: Dragging an untouched visit back and forth does NOT create extra visits.
   */
  async rescheduleJob(
    companyId: string,
    jobId: string,
    data: {
      technicianUserId?: string | null;
      startAt?: Date;
      endAt?: Date;
      notes?: string;
      allDay?: boolean;
      timezone?: string;
      expectedVersion?: number;
    }
  ) {
    if (IS_DEV) {
      console.log('[SCHEDULE-DEBUG] rescheduleJob (PHASE 4 - spawn-on-action) called:', {
        jobId,
        allDay: data.allDay,
        startAt: data.startAt?.toISOString(),
        endAt: data.endAt?.toISOString(),
        technicianUserId: data.technicianUserId,
        expectedVersion: data.expectedVersion,
      });
    }

    // First verify job exists, belongs to tenant, and check version + terminal status
    const existingJob = await this.getJobById(companyId, jobId);
    if (!existingJob) {
      throw new Error('Job not found');
    }

    // Terminal status check
    if (TERMINAL_STATUSES.includes(existingJob.status as any)) {
      throw new TerminalJobImmutableError(jobId, existingJob.status);
    }

    // Version check (optimistic locking against job version for API compat)
    if (data.expectedVersion !== undefined) {
      if (existingJob.version === null || existingJob.version === undefined) {
        throw new VersionNotInitializedError(jobId);
      }
      if (existingJob.version !== data.expectedVersion) {
        throw new VersionMismatchError(data.expectedVersion, existingJob.version);
      }
    }

    // PHASE 4: Find current eligible visit
    const currentVisit = await jobVisitsRepository.getCurrentEligibleVisit(companyId, jobId);
    if (!currentVisit) {
      // No eligible visit exists - create one instead (job was unscheduled)
      // This handles the edge case where job had no visits
      if (data.startAt) {
        const normalized = normalizeScheduleTimes({
          allDay: data.allDay,
          startAt: data.startAt,
          endAt: data.endAt,
        });
        const techAssignment = normalizeTechnicianAssignment(data.technicianUserId || null);

        await jobVisitsRepository.createJobVisit(companyId, jobId, {
          scheduledStart: normalized.scheduledStart,
          scheduledEnd: normalized.scheduledEnd,
          isAllDay: normalized.isAllDay,
          assignedTechnicianId: techAssignment.primaryTechnicianId,
          assignedTechnicianIds: techAssignment.assignedTechnicianIds,
          status: 'scheduled',
          visitNotes: data.notes,
        });
      }
      return await this.getJobById(companyId, jobId);
    }

    // SPAWN-ON-ACTION: Check if visit has been actioned
    const visitIsActioned = isVisitActioned(currentVisit);

    if (IS_DEV) {
      console.log('[RESCHEDULE-DEBUG] Spawn-on-action check:', {
        visitId: currentVisit.id,
        isActioned: visitIsActioned,
        checkedInAt: currentVisit.checkedInAt,
        checkedOutAt: currentVisit.checkedOutAt,
        actualDurationMinutes: currentVisit.actualDurationMinutes,
        status: currentVisit.status,
      });
    }

    if (visitIsActioned) {
      // ACTIONED: Soft-delete old visit and create new one
      // This preserves history of the actioned visit

      // Step 1: Soft-delete old visit (is_active=false)
      await jobVisitsRepository.updateJobVisit(
        companyId,
        currentVisit.id,
        currentVisit.version,
        { isActive: false }
      );

      if (IS_DEV) {
        console.log(`[RESCHEDULE-DEBUG] Soft-deleted actioned visit: ${currentVisit.id}`);
      }

      // Step 2: Create new visit with requested schedule
      // Normalize scheduling fields
      const normalized = normalizeScheduleTimes({
        allDay: data.allDay,
        startAt: data.startAt,
        endAt: data.endAt,
      });

      // Technician: use new value if provided, else carry forward from old visit
      const techAssignment = data.technicianUserId !== undefined
        ? normalizeTechnicianAssignment(data.technicianUserId || null)
        : normalizeTechnicianAssignment(currentVisit.assignedTechnicianId || null);

      const newVisit = await jobVisitsRepository.createJobVisit(companyId, jobId, {
        scheduledStart: normalized.scheduledStart,
        scheduledEnd: normalized.scheduledEnd,
        isAllDay: normalized.isAllDay,
        assignedTechnicianId: techAssignment.primaryTechnicianId,
        assignedTechnicianIds: techAssignment.assignedTechnicianIds,
        status: 'scheduled',
        visitNotes: data.notes,
      });

      if (IS_DEV) {
        console.log(`[RESCHEDULE-DEBUG] Created new visit: ${newVisit.id} (spawn-on-action)`);
      }

      // Write audit log for spawn-on-action
      await db.insert(jobScheduleAudit).values({
        jobId,
        companyId,
        userId: null,
        contextLabel: 'storage:rescheduleJob:spawn-on-action',
        oldFields: {
          visitId: currentVisit.id,
          scheduledStart: currentVisit.scheduledStart,
          status: currentVisit.status,
        },
        newFields: {
          visitId: newVisit.id,
          scheduledStart: newVisit.scheduledStart,
          action: 'spawned-new-visit',
        },
      });

    } else {
      // NOT ACTIONED: Update the existing visit in place
      // Build update payload for the visit
      const visitUpdate: any = {};

      // Apply scheduling field updates if provided
      if (data.startAt !== undefined || data.allDay !== undefined) {
        const normalized = normalizeScheduleTimes({
          allDay: data.allDay,
          startAt: data.startAt,
          endAt: data.endAt,
        });
        visitUpdate.scheduledStart = normalized.scheduledStart;
        visitUpdate.scheduledEnd = normalized.scheduledEnd;
        visitUpdate.isAllDay = normalized.isAllDay;
      }

      // Apply technician assignment if provided
      if (data.technicianUserId !== undefined) {
        const techAssignment = normalizeTechnicianAssignment(data.technicianUserId || null);
        visitUpdate.assignedTechnicianId = techAssignment.primaryTechnicianId;
        visitUpdate.assignedTechnicianIds = techAssignment.assignedTechnicianIds;

        if (IS_DEV) {
          console.log('[RESCHEDULE-DEBUG] Technician update:', {
            inputTechnicianUserId: data.technicianUserId,
            normalizedPrimary: techAssignment.primaryTechnicianId,
            normalizedAssigned: techAssignment.assignedTechnicianIds,
          });
        }
      }

      if (data.notes !== undefined) {
        visitUpdate.visitNotes = data.notes;
      }

      // Update the visit (this calls syncJobScheduleFromVisits internally)
      if (Object.keys(visitUpdate).length > 0) {
        await jobVisitsRepository.updateJobVisit(
          companyId,
          currentVisit.id,
          currentVisit.version, // Use visit version for visit-level locking
          visitUpdate
        );
      }

      if (IS_DEV) {
        console.log(`[RESCHEDULE-DEBUG] Updated existing visit in place: ${currentVisit.id}`);
      }
    }

    // Re-fetch job to return updated data (jobs table was synced)
    const result = await this.getJobById(companyId, jobId);

    if (IS_DEV) {
      console.log(
        `[Calendar] rescheduleJob (PHASE 4): job=${jobId} scheduledStart=${result?.scheduledStart?.toISOString()} version=${result?.version} actioned=${visitIsActioned}`
      );
    }

    return result;
  }

  /**
   * PHASE 4: Unschedule a job (returns job to backlog)
   *
   * MIGRATION: Now writes to job_visits instead of jobs table.
   * The jobs table is updated via syncJobScheduleFromVisits for backwards compat.
   *
   * BEHAVIOR:
   * - Finds the "current eligible visit" (same selection as calendar read)
   * - Sets is_active=false to soft-delete the visit (consistent with repository pattern)
   * - Calls syncJobScheduleFromVisits to update jobs table
   *   (which will clear schedule fields if no other eligible visits exist)
   * - Returns the job row (after sync) for API response compatibility
   */
  async unscheduleJob(companyId: string, jobId: string, expectedVersion?: number) {
    if (IS_DEV) {
      console.log('[SCHEDULE-DEBUG] unscheduleJob (PHASE 4 - job_visits) called:', {
        jobId,
        expectedVersion,
      });
    }

    // First verify job exists, belongs to tenant, and check version + terminal status
    const existingJob = await this.getJobById(companyId, jobId);
    if (!existingJob) {
      throw new Error('Job not found');
    }

    // Terminal status check
    if (TERMINAL_STATUSES.includes(existingJob.status as any)) {
      throw new TerminalJobImmutableError(jobId, existingJob.status);
    }

    // Version check (optimistic locking against job version for API compat)
    if (expectedVersion !== undefined) {
      if (existingJob.version === null || existingJob.version === undefined) {
        throw new VersionNotInitializedError(jobId);
      }
      if (existingJob.version !== expectedVersion) {
        throw new VersionMismatchError(expectedVersion, existingJob.version);
      }
    }

    // PHASE 4: Find current eligible visit to soft-delete
    const currentVisit = await jobVisitsRepository.getCurrentEligibleVisit(companyId, jobId);
    if (currentVisit) {
      // Set is_active=false (consistent with repository's soft-delete pattern)
      // This calls syncJobScheduleFromVisits internally, which will update jobs table
      await jobVisitsRepository.updateJobVisit(
        companyId,
        currentVisit.id,
        currentVisit.version,
        { isActive: false }
      );

      if (IS_DEV) {
        console.log(`[Calendar] unscheduleJob (PHASE 4): soft-deleted visitId=${currentVisit.id}`);
      }
    } else {
      // No eligible visit exists - just ensure jobs table is synced
      // This handles edge case where job has no visits but has schedule fields
      await jobVisitsRepository.syncJobToVisits(companyId, jobId);
    }

    // Write audit log
    await db.insert(jobScheduleAudit).values({
      jobId,
      companyId,
      userId: null,
      contextLabel: 'storage:unscheduleJob:PHASE4',
      oldFields: null,
      newFields: {
        visitId: currentVisit?.id || null,
        action: 'soft-delete',
      },
    });

    // Re-fetch job to return updated data
    const result = await this.getJobById(companyId, jobId);

    if (IS_DEV) {
      console.log(
        `[Calendar] unscheduleJob (PHASE 4): job=${jobId} status->${result?.status} version=${result?.version} scheduledStart=${result?.scheduledStart}`
      );
    }

    return result;
  }

  /**
   * Validate that a technician belongs to the tenant
   */
  async validateTechnicianBelongsToTenant(
    companyId: string,
    technicianUserId: string
  ): Promise<boolean> {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, technicianUserId), eq(users.companyId, companyId)))
      .limit(1);

    return rows.length > 0;
  }

  /**
   * Validate that a job belongs to the tenant
   */
  async validateJobBelongsToTenant(
    companyId: string,
    jobId: string
  ): Promise<boolean> {
    const rows = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
      .limit(1);

    return rows.length > 0;
  }

  // ============================================================================
  // BYPASS FUNCTIONS - NO WORKING HOURS VALIDATION
  // ============================================================================
  // These functions perform the same DB writes as normal functions but
  // NEVER call validateSchedule() or any working hours checks.
  // Use when OUTSIDE_WORKING_HOURS must be bypassed.
  // ============================================================================

  /**
   * Schedule job WITHOUT working hours validation.
   *
   * GUARANTEES:
   * - NO validateSchedule() call
   * - NO working hours checks
   * - Enforces MODEL A: all-day gets midnight timestamps (NOT null)
   * - Enforces same-day clamp for timed events
   * - Handles version increment
   */
  async scheduleJobBypassWorkingHours(
    companyId: string,
    data: {
      jobId: string;
      // 2026-01-30: Accept null for explicit unassignment
      technicianUserId?: string | null;
      startAt: Date;
      endAt: Date;
      notes?: string;
      allDay?: boolean;
      expectedVersion?: number;
    }
  ) {
    // Fetch existing job for version check
    const existingJob = await this.getJobById(companyId, data.jobId);

    // VERSION CHECK (if provided)
    // TASK 1: Reject VERSION_NOT_INITIALIZED instead of defaulting to 0
    if (data.expectedVersion !== undefined && existingJob) {
      const { VersionMismatchError, VersionNotInitializedError } = await import("../domain/scheduling");
      if (existingJob.version === null || existingJob.version === undefined) {
        throw new VersionNotInitializedError(data.jobId);
      }
      if (existingJob.version !== data.expectedVersion) {
        throw new VersionMismatchError(data.expectedVersion, existingJob.version);
      }
    }

    // TASK 1: For jobs with null version (pre-migration), start at 1
    const currentVersion = existingJob?.version ?? 0;
    const newVersion = currentVersion + 1;
    const isAllDay = data.allDay === true;

    // COMPUTE FINAL TIMES via canonical normalizeScheduleTimes helper
    const normalized = normalizeScheduleTimes({
      allDay: isAllDay,
      startAt: data.startAt,
      endAt: data.endAt,
    });
    let finalStart: Date | null = normalized.scheduledStart;
    let finalEnd: Date | null = normalized.scheduledEnd;

    if (!isAllDay && finalStart && finalEnd) {
      // TIMED: Clamp to same day (never throw, just adjust)
      const startDay = finalStart.toISOString().split('T')[0];
      const endDay = finalEnd.toISOString().split('T')[0];
      if (startDay !== endDay) {
        finalEnd = new Date(startDay + 'T23:59:59.000Z');
      }
    }

    // Status is always "open" - scheduling/assignment are derived states
    // A job is "scheduled" when it has scheduledStart IS NOT NULL (derived, not status)
    // A job is "assigned" when it has technicians (derived, not status)
    const status = 'open';

    const updateData: any = {
      scheduledStart: finalStart,
      scheduledEnd: finalEnd,
      isAllDay: isAllDay,
      status,
      updatedAt: new Date(),
      version: newVersion,
    };

    // CANONICAL: Use normalizeTechnicianAssignment for consistent invariant enforcement
    const techAssignment = normalizeTechnicianAssignment(data.technicianUserId || null);
    updateData.primaryTechnicianId = techAssignment.primaryTechnicianId;
    updateData.assignedTechnicianIds = techAssignment.assignedTechnicianIds;

    if (data.notes) {
      updateData.description = data.notes;
    }

    // Sanitize all-day timestamps for UTC-safe DB write
    sanitizeAllDayTimestamps(updateData, data.jobId);

    // DIRECT DB WRITE - NO VALIDATION
    const rows = await db
      .update(jobs)
      .set(updateData)
      .where(and(eq(jobs.id, data.jobId), eq(jobs.companyId, companyId)))
      .returning();

    const result = rows[0] ?? null;

    // Assert technician invariant after write
    if (result) {
      assertTechnicianAssignmentInvariant(result, "storage:scheduleJobBypassWorkingHours");
    }

    if (IS_DEV) {
      console.log(
        `[Calendar] scheduleJobBypassWorkingHours: job=${data.jobId} ` +
        `scheduledStart=${finalStart?.toISOString() ?? 'null'} isAllDay=${isAllDay} ` +
        `status=${status} version=${newVersion} [BYPASS]`
      );
    }

    return result;
  }

  /**
   * STATE SNAPSHOT: Get job counts for diagnostics
   *
   * Returns counts by status and scheduling state to verify invariants:
   * - jobs: { total, open, completed, invoiced, archived }
   * - scheduled: { total, open, completed } (jobs with scheduledStart IS NOT NULL)
   * - backlog: { total } (open jobs with scheduledStart IS NULL)
   *
   * INVARIANT: jobs.open === scheduled.open + backlog.total
   */
  async getStateSnapshot(companyId: string): Promise<{
    jobs: { total: number; open: number; completed: number; invoiced: number; archived: number };
    scheduled: { total: number; open: number; completed: number };
    backlog: { total: number };
    violations: {
      invalidStatus: { count: number; jobIds: string[] };
      orphanedOpenSubStatus: { count: number; jobIds: string[] };
      endWithoutStart: { count: number; jobIds: string[] };
      allDayStartNotMidnight: { count: number; jobIds: string[] };
      allDayEndNot2359: { count: number; jobIds: string[] };
      endBeforeStart: { count: number; jobIds: string[] };
    };
  }> {
    // Get all counts in parallel for efficiency
    const [
      totalJobsResult,
      jobsByStatusResult,
      scheduledResult,
      backlogResult,
      // Violation queries
      invalidStatusResult,
      orphanedOpenSubStatusResult,
      endWithoutStartResult,
      allDayStartNotMidnightResult,
      allDayEndNot2359Result,
      endBeforeStartResult,
    ] = await Promise.all([
      // Total jobs (excluding soft-deleted)
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(jobs)
        .where(and(eq(jobs.companyId, companyId), isNull(jobs.deletedAt))),

      // Jobs by status
      db
        .select({
          status: jobs.status,
          count: sql<number>`count(*)::int`,
        })
        .from(jobs)
        .where(and(eq(jobs.companyId, companyId), isNull(jobs.deletedAt)))
        .groupBy(jobs.status),

      // Scheduled jobs (scheduledStart IS NOT NULL) by status
      db
        .select({
          status: jobs.status,
          count: sql<number>`count(*)::int`,
        })
        .from(jobs)
        .where(
          and(
            eq(jobs.companyId, companyId),
            isNull(jobs.deletedAt),
            sql`${jobs.scheduledStart} IS NOT NULL`
          )
        )
        .groupBy(jobs.status),

      // Backlog: open jobs with scheduledStart IS NULL
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(jobs)
        .where(
          and(
            eq(jobs.companyId, companyId),
            isNull(jobs.deletedAt),
            isNull(jobs.scheduledStart),
            eq(jobs.status, BACKLOG_STATUS)
          )
        ),

      // VIOLATION 1: Invalid status (not in open, completed, invoiced, archived)
      db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.companyId, companyId),
            isNull(jobs.deletedAt),
            sql`${jobs.status} NOT IN ('open', 'completed', 'invoiced', 'archived')`
          )
        )
        .limit(100),

      // VIOLATION 2: openSubStatus set but status !== 'open'
      db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.companyId, companyId),
            isNull(jobs.deletedAt),
            sql`${jobs.openSubStatus} IS NOT NULL`,
            sql`${jobs.status} <> 'open'`
          )
        )
        .limit(100),

      // VIOLATION 3: scheduledEnd set but scheduledStart is NULL
      db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.companyId, companyId),
            isNull(jobs.deletedAt),
            sql`${jobs.scheduledEnd} IS NOT NULL`,
            isNull(jobs.scheduledStart)
          )
        )
        .limit(100),

      // VIOLATION 4: All-day event with scheduledStart not at midnight
      db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.companyId, companyId),
            isNull(jobs.deletedAt),
            eq(jobs.isAllDay, true),
            sql`${jobs.scheduledStart} IS NOT NULL`,
            sql`EXTRACT(HOUR FROM ${jobs.scheduledStart}) <> 0
                OR EXTRACT(MINUTE FROM ${jobs.scheduledStart}) <> 0
                OR EXTRACT(SECOND FROM ${jobs.scheduledStart}) <> 0`
          )
        )
        .limit(100),

      // VIOLATION 5: All-day event with scheduledEnd not at 23:59:59
      db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.companyId, companyId),
            isNull(jobs.deletedAt),
            eq(jobs.isAllDay, true),
            sql`${jobs.scheduledEnd} IS NOT NULL`,
            sql`NOT (EXTRACT(HOUR FROM ${jobs.scheduledEnd}) = 23
                AND EXTRACT(MINUTE FROM ${jobs.scheduledEnd}) = 59
                AND EXTRACT(SECOND FROM ${jobs.scheduledEnd}) = 59)`
          )
        )
        .limit(100),

      // VIOLATION 6: scheduledEnd before scheduledStart
      db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.companyId, companyId),
            isNull(jobs.deletedAt),
            sql`${jobs.scheduledStart} IS NOT NULL`,
            sql`${jobs.scheduledEnd} IS NOT NULL`,
            sql`${jobs.scheduledEnd} < ${jobs.scheduledStart}`
          )
        )
        .limit(100),
    ]);

    // Parse results
    const totalJobs = totalJobsResult[0]?.count ?? 0;

    const statusCounts: Record<string, number> = {};
    for (const row of jobsByStatusResult) {
      statusCounts[row.status ?? 'unknown'] = row.count;
    }

    const scheduledStatusCounts: Record<string, number> = {};
    for (const row of scheduledResult) {
      scheduledStatusCounts[row.status ?? 'unknown'] = row.count;
    }

    const backlogCount = backlogResult[0]?.count ?? 0;
    const scheduledTotal = Object.values(scheduledStatusCounts).reduce((sum, c) => sum + c, 0);

    // Parse violation results
    const toViolation = (rows: { id: string }[]) => ({
      count: rows.length,
      jobIds: rows.map(r => r.id),
    });

    return {
      jobs: {
        total: totalJobs,
        open: statusCounts['open'] ?? 0,
        completed: statusCounts['completed'] ?? 0,
        invoiced: statusCounts['invoiced'] ?? 0,
        archived: statusCounts['archived'] ?? 0,
      },
      scheduled: {
        total: scheduledTotal,
        open: scheduledStatusCounts['open'] ?? 0,
        completed: scheduledStatusCounts['completed'] ?? 0,
      },
      backlog: {
        total: backlogCount,
      },
      violations: {
        invalidStatus: toViolation(invalidStatusResult),
        orphanedOpenSubStatus: toViolation(orphanedOpenSubStatusResult),
        endWithoutStart: toViolation(endWithoutStartResult),
        allDayStartNotMidnight: toViolation(allDayStartNotMidnightResult),
        allDayEndNot2359: toViolation(allDayEndNot2359Result),
        endBeforeStart: toViolation(endBeforeStartResult),
      },
    };
  }

  /**
   * Reschedule job WITHOUT working hours validation.
   *
   * GUARANTEES:
   * - NO validateSchedule() call
   * - NO working hours checks
   * - Enforces MODEL A: all-day gets midnight timestamps (NOT null)
   * - Enforces same-day clamp for timed events
   * - Handles version increment
   */
  async rescheduleJobBypassWorkingHours(
    companyId: string,
    jobId: string,
    data: {
      technicianUserId?: string;
      startAt?: Date;
      endAt?: Date;
      notes?: string;
      allDay?: boolean;
      expectedVersion?: number;
    }
  ) {
    // Fetch existing job for version check and merging
    const existingJob = await this.getJobById(companyId, jobId);
    if (!existingJob) {
      throw new Error(`Job ${jobId} not found`);
    }

    // VERSION CHECK (if provided)
    // TASK 1: Reject VERSION_NOT_INITIALIZED instead of defaulting to 0
    if (data.expectedVersion !== undefined) {
      const { VersionMismatchError, VersionNotInitializedError } = await import("../domain/scheduling");
      if (existingJob.version === null || existingJob.version === undefined) {
        throw new VersionNotInitializedError(jobId);
      }
      if (existingJob.version !== data.expectedVersion) {
        throw new VersionMismatchError(data.expectedVersion, existingJob.version);
      }
    }

    // TASK 1: For jobs with null version (pre-migration), start at 1
    const currentVersion = existingJob.version ?? 0;
    const newVersion = currentVersion + 1;

    // Determine final values (merge with existing)
    const isAllDay = data.allDay !== undefined ? data.allDay : (existingJob.isAllDay ?? false);

    // COMPUTE FINAL TIMES via canonical normalizeScheduleTimes helper
    let finalStart: Date | null;
    let finalEnd: Date | null;

    if (isAllDay) {
      const sourceDate = data.startAt ?? existingJob.scheduledStart ?? new Date();
      const normalized = normalizeScheduleTimes({
        allDay: true,
        startAt: sourceDate,
      });
      finalStart = normalized.scheduledStart;
      finalEnd = normalized.scheduledEnd;
    } else {
      // TIMED: Use provided or existing
      finalStart = data.startAt !== undefined ? data.startAt : existingJob.scheduledStart;
      finalEnd = data.endAt !== undefined ? data.endAt : existingJob.scheduledEnd;

      // Clamp to same day (never throw, just adjust)
      if (finalStart && finalEnd) {
        const startDay = finalStart.toISOString().split('T')[0];
        const endDay = finalEnd.toISOString().split('T')[0];
        if (startDay !== endDay) {
          finalEnd = new Date(startDay + 'T23:59:59.000Z');
        }
      }
    }

    const updateData: any = {
      updatedAt: new Date(),
      version: newVersion,
    };

    // Only set scheduling fields if they changed
    if (data.startAt !== undefined || data.allDay !== undefined) {
      updateData.scheduledStart = finalStart;
      updateData.scheduledEnd = finalEnd;
      updateData.isAllDay = isAllDay;
    }

    if (data.technicianUserId !== undefined) {
      // CANONICAL: Use normalizeTechnicianAssignment for consistent invariant enforcement
      const techAssignment = normalizeTechnicianAssignment(data.technicianUserId || null);
      updateData.primaryTechnicianId = techAssignment.primaryTechnicianId;
      updateData.assignedTechnicianIds = techAssignment.assignedTechnicianIds;
    }

    if (data.notes !== undefined) {
      updateData.description = data.notes;
    }

    // Sanitize all-day timestamps for UTC-safe DB write
    sanitizeAllDayTimestamps(updateData, jobId);

    // DIRECT DB WRITE - NO VALIDATION
    const rows = await db
      .update(jobs)
      .set(updateData)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
      .returning();

    const result = rows[0] ?? null;

    // Assert technician invariant after write
    if (result) {
      assertTechnicianAssignmentInvariant(result, "storage:rescheduleJobBypassWorkingHours");
    }

    if (IS_DEV) {
      console.log(
        `[Calendar] rescheduleJobBypassWorkingHours: job=${jobId} ` +
        `scheduledStart=${finalStart?.toISOString() ?? 'null'} isAllDay=${isAllDay} ` +
        `version=${newVersion} [BYPASS]`
      );
    }

    return result;
  }
}

export const calendarRepository = new CalendarRepository();

// ============================================================================
// DATA CLEANUP REFERENCE (DO NOT AUTO-RUN)
// ============================================================================
//
// The following SQL can be used to fix existing data drift where
// status='scheduled' but no schedule exists. Run manually if needed.
//
// -- Find and fix jobs with status='scheduled' but no schedule
// UPDATE jobs
// SET
//   status = CASE
//     WHEN primary_technician_id IS NOT NULL
//          OR COALESCE(array_length(assigned_technician_ids, 1), 0) > 0
//     THEN 'assigned'
//     ELSE 'open'
//   END,
//   updated_at = NOW()
// WHERE status = 'scheduled'
//   AND scheduled_start IS NULL
//   AND (is_all_day IS NULL OR is_all_day = false);
//
// -- Verify: count should be 0 after fix
// SELECT COUNT(*)
// FROM jobs
// WHERE status = 'scheduled'
//   AND scheduled_start IS NULL
//   AND (is_all_day IS NULL OR is_all_day = false);
//
// ============================================================================
