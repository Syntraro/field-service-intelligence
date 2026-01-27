import { db } from "../db";
import { eq, and, or, gte, lt, isNull, sql, inArray } from "drizzle-orm";
import {
  jobs,
  users,
  technicianProfiles,
  clientLocations,
  customerCompanies,
  jobScheduleAudit,
} from "@shared/schema";
import { BaseRepository } from "./base";
import {
  // Domain helpers - SINGLE SOURCE OF TRUTH for scheduling logic
  BACKLOG_STATUS,
  deriveScheduleFields,
  hasTechnicianAssigned,
  assertSchedulingInvariants,
  assertTerminalImmutable,
  assertCalendarQueryResults,
  assertBacklogQueryResults,
  assertSchedulingWriteContext,
  assertVersionMatch,
  applyJobSchedulingPatch,
  type SchedulingWriteIntent,
  // Technician assignment helpers
  normalizeTechnicianAssignment,
  assertTechnicianAssignmentInvariant,
} from "../domain/scheduling";

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
 * Result from getAssignmentsInRange with metadata
 */
export interface CalendarRangeResult {
  assignments: CalendarAssignmentWithDetails[];
  outsideVisibleHoursCount: number;
}

/**
 * Calendar Assignment with joined technician and job info
 */
export interface CalendarAssignmentWithDetails {
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
  assignedTechnicianIds: string[] | null;
  primaryTechnicianId: string | null;
  technicians: Array<{
    id: string;
    name: string;
    color: string | null;
  }>;
  /** Job version for optimistic locking */
  version: number;
}

/**
 * Count assignments scheduled outside the visible calendar hours.
 * Only counts timed events (is_all_day = false).
 *
 * An assignment is counted as "outside visible hours" if:
 * - scheduledStart is before the visible window (hour < startHour)
 * - scheduledStart is at or after the visible window end (hour >= endHour)
 * - scheduledEnd extends beyond the visible window (endHour < scheduledEnd hour)
 *
 * @param assignments - Calendar assignments to check
 * @param startHour - Calendar visible start hour (inclusive)
 * @param endHour - Calendar visible end hour (exclusive)
 * @returns Count of assignments outside visible hours
 */
export function countOutsideVisibleHours(
  assignments: CalendarAssignmentWithDetails[],
  startHour: number = DEFAULT_CALENDAR_START_HOUR,
  endHour: number = DEFAULT_CALENDAR_END_HOUR
): number {
  return assignments.filter((a) => {
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
   * CANONICAL SCHEDULING: Get scheduled jobs for a date range
   *
   * INVARIANTS:
   * - Calendar shows SCHEDULED work only (NOT status-based)
   * - Scheduled = scheduledStart IS NOT NULL (canonical check)
   * - All-day events have scheduledStart = midnight of their day
   * - Range is [startDate, endDate) - exclusive end to prevent boundary issues
   *
   * @param companyId - Tenant ID
   * @param startDate - Range start (inclusive)
   * @param endDate - Range end (EXCLUSIVE - use start of next period)
   */
  async getAssignmentsInRange(
    companyId: string,
    startDate: Date,
    endDate: Date
  ): Promise<CalendarAssignmentWithDetails[]> {
    // MODEL A: Filter by schedule existence, NOT by status
    // Range is [startDate, endDate) - exclusive end for clean boundaries
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
          // Exclude soft-deleted jobs
          isNull(jobs.deletedAt),
          // CANONICAL SCHEDULING: scheduledStart IS NOT NULL means scheduled
          // All-day events also have scheduledStart set (to midnight of the day)
          sql`${jobs.scheduledStart} IS NOT NULL`,
          // Range filter: scheduledStart >= startDate AND scheduledStart < endDate (exclusive end)
          gte(jobs.scheduledStart, startDate),
          lt(jobs.scheduledStart, endDate)
        )
      )
      .orderBy(jobs.scheduledStart);

    // DEV-only debug log
    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[Calendar] getAssignmentsInRange: company=${companyId} range=[${startDate.toISOString()}, ${endDate.toISOString()}) found=${jobRows.length} scheduled`
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
        const name = tech.fullName ||
          (tech.firstName && tech.lastName ? `${tech.firstName} ${tech.lastName}` : tech.firstName || "Unknown");
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
        assignedTechnicianIds: job.assignedTechnicianIds,
        primaryTechnicianId: job.primaryTechnicianId,
        technicians,
        version: job.version,
      };
    });

    // DEV: Assert calendar results meet Model A invariants
    assertCalendarQueryResults(results, "storage:getAssignmentsInRange");

    return results;
  }

  /**
   * MODEL A: Get calendar assignments with metadata for a date range
   *
   * Same as getAssignmentsInRange but also returns:
   * - outsideVisibleHoursCount: number of timed events outside visible hours
   *
   * @param companyId - Tenant ID
   * @param startDate - Range start (inclusive)
   * @param endDate - Range end (EXCLUSIVE)
   * @param calendarStartHour - Visible start hour (default: 6)
   * @param calendarEndHour - Visible end hour (default: 19)
   */
  async getAssignmentsInRangeWithMetadata(
    companyId: string,
    startDate: Date,
    endDate: Date,
    calendarStartHour: number = DEFAULT_CALENDAR_START_HOUR,
    calendarEndHour: number = DEFAULT_CALENDAR_END_HOUR
  ): Promise<CalendarRangeResult> {
    const assignments = await this.getAssignmentsInRange(companyId, startDate, endDate);
    const outsideVisibleHoursCount = countOutsideVisibleHours(
      assignments,
      calendarStartHour,
      calendarEndHour
    );

    if (process.env.NODE_ENV === 'development' && outsideVisibleHoursCount > 0) {
      console.log(
        `[Calendar] getAssignmentsInRangeWithMetadata: ${outsideVisibleHoursCount} jobs outside visible hours (${calendarStartHour}:00-${calendarEndHour}:00)`
      );
    }

    return { assignments, outsideVisibleHoursCount };
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
  async getUnscheduledJobs(companyId: string): Promise<CalendarAssignmentWithDetails[]> {
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
          // Exclude soft-deleted jobs
          isNull(jobs.deletedAt),
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
    if (process.env.NODE_ENV === 'development') {
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
        const name = tech.fullName ||
          (tech.firstName && tech.lastName ? `${tech.firstName} ${tech.lastName}` : tech.firstName || "Unknown");
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
   * Get a single job/assignment by ID (for update/delete validation)
   */
  async getAssignmentById(companyId: string, jobId: string) {
    const rows = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
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
   * MODEL A: Create a calendar assignment (schedule a job)
   *
   * INVARIANTS (MODEL A - Timestamp Canonical):
   * - Sets scheduledStart/scheduledEnd for ALL scheduled events (timed AND all-day)
   * - All-day events: scheduledStart=midnight, scheduledEnd=end-of-day (NOT NULL)
   * - Status is set to 'scheduled' ONLY if schedule exists
   * - If schedule somehow missing, status is downgraded to 'assigned' or 'open'
   * - Ensures assignedTechnicianIds is never NULL when assignment exists
   *
   * UNIFIED PATTERN: Uses applyJobSchedulingPatch for normalization, version, and audit
   */
  async createAssignment(
    companyId: string,
    data: {
      jobId: string;
      technicianUserId?: string;
      startAt: Date;
      endAt: Date;
      notes?: string;
      allDay?: boolean;
      timezone?: string;
      expectedVersion?: number;
    }
  ) {
    // Fetch existing job for terminal check and version
    const existingJob = await this.getAssignmentById(companyId, data.jobId);

    // UNIFIED: Use domain layer for normalization, version prep, and audit data
    const patchResult = applyJobSchedulingPatch(
      existingJob,
      {
        scheduledStart: data.startAt,
        scheduledEnd: data.endAt,
        isAllDay: data.allDay,
        timezone: data.timezone,
        expectedVersion: data.expectedVersion,
      },
      "storage:createAssignment"
    );

    // OPTIMISTIC LOCKING: Check version using unified helper
    if (patchResult.writeIntent) {
      assertVersionMatch(patchResult.writeIntent, existingJob?.version);
    }

    const updateData: any = {
      scheduledStart: patchResult.scheduledStart,
      scheduledEnd: patchResult.scheduledEnd,
      isAllDay: patchResult.isAllDay,
      status: patchResult.status,
      updatedAt: new Date(),
      version: patchResult.writeIntent?.newVersion ?? 1,
    };

    // ========================================================================
    // CANONICAL SCHEDULING: All-day events MUST have scheduledStart set to midnight
    // isAllDay is a DISPLAY flag; scheduledStart IS the scheduling determinant
    // ========================================================================
    if (updateData.isAllDay === true || data.allDay === true) {
      updateData.isAllDay = true;
      // For all-day events, scheduledStart = midnight of the day, scheduledEnd = end of day
      // This ensures isJobScheduled() returns true (scheduledStart IS NOT NULL)
      if (data.startAt) {
        const dayStr = data.startAt.toISOString().split('T')[0];
        updateData.scheduledStart = new Date(dayStr + 'T00:00:00.000Z');
        updateData.scheduledEnd = new Date(dayStr + 'T23:59:59.999Z');
      }
    }

    // CANONICAL: Use normalizeTechnicianAssignment for consistent invariant enforcement
    const techAssignment = normalizeTechnicianAssignment(data.technicianUserId || null);
    updateData.primaryTechnicianId = techAssignment.primaryTechnicianId;
    updateData.assignedTechnicianIds = techAssignment.assignedTechnicianIds;

    // Notes go to description if provided
    if (data.notes) {
      updateData.description = data.notes;
    }

    // ATOMIC: Wrap update + audit in transaction
    const result = await db.transaction(async (tx) => {
      const rows = await tx
        .update(jobs)
        .set(updateData)
        .where(and(eq(jobs.id, data.jobId), eq(jobs.companyId, companyId)))
        .returning();

      const updated = rows[0] ?? null;

      // AUDIT: Log scheduling change using writeIntent data
      if (updated && patchResult.writeIntent) {
        await this.writeScheduleAudit(tx, {
          jobId: data.jobId,
          companyId,
          userId: null,
          contextLabel: patchResult.writeIntent.contextLabel,
          oldFields: patchResult.writeIntent.oldFields,
          newFields: patchResult.writeIntent.newFields,
        });
      }

      return updated;
    });

    // DEV: Assert result meets invariants
    if (result) {
      assertSchedulingInvariants(result, "storage:createAssignment:result");
      assertTechnicianAssignmentInvariant(result, "storage:createAssignment:result");
    }

    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[Calendar] createAssignment: job=${data.jobId} scheduledStart=${patchResult.scheduledStart?.toISOString()} isAllDay=${patchResult.isAllDay} status=${patchResult.status} version=${patchResult.writeIntent?.newVersion}`
      );
    }

    return result;
  }

  /**
   * MODEL A: Update a calendar assignment (reschedule/reassign)
   *
   * INVARIANTS delegated to domain/scheduling.ts:
   * - Schedule normalization (all-day boundaries)
   * - Status derivation
   * - Invariant assertions
   *
   * UNIFIED PATTERN: Uses applyJobSchedulingPatch for normalization, version, and audit
   */
  async updateAssignment(
    companyId: string,
    jobId: string,
    data: {
      technicianUserId?: string;
      startAt?: Date;
      endAt?: Date;
      notes?: string;
      allDay?: boolean;
      timezone?: string;
      expectedVersion?: number;
    }
  ) {
    // Fetch existing job for terminal check and version
    const existingJob = await this.getAssignmentById(companyId, jobId);

    // Determine if scheduling fields are being modified
    const hasSchedulingChanges = data.startAt !== undefined || data.allDay !== undefined;

    // UNIFIED: Use domain layer for normalization, version prep, and audit data
    // Only invoke domain logic if scheduling fields are changing
    let patchResult: ReturnType<typeof applyJobSchedulingPatch> | null = null;

    if (hasSchedulingChanges) {
      patchResult = applyJobSchedulingPatch(
        existingJob,
        {
          scheduledStart: data.startAt,
          scheduledEnd: data.endAt,
          isAllDay: data.allDay,
          timezone: data.timezone,
          expectedVersion: data.expectedVersion,
        },
        "storage:updateAssignment"
      );

      // OPTIMISTIC LOCKING: Check version using unified helper
      if (patchResult.writeIntent) {
        assertVersionMatch(patchResult.writeIntent, existingJob?.version);
      }
    } else {
      // No scheduling changes - still check version if provided
      // TASK 1: Reject VERSION_NOT_INITIALIZED instead of defaulting to 0
      if (data.expectedVersion !== undefined && existingJob) {
        const { VersionMismatchError, VersionNotInitializedError } = await import("../domain/scheduling");
        if (existingJob.version === null || existingJob.version === undefined) {
          throw new VersionNotInitializedError(jobId);
        }
        if (existingJob.version !== data.expectedVersion) {
          throw new VersionMismatchError(data.expectedVersion, existingJob.version);
        }
      }
    }

    // TASK 1: Calculate new version - if patchResult has it, use it; otherwise increment existing
    // For jobs with null version (pre-migration), start at 1
    const currentVersion = existingJob?.version ?? 0;
    const updateData: any = {
      updatedAt: new Date(),
      version: patchResult?.writeIntent?.newVersion ?? (currentVersion + 1),
    };

    // Apply scheduling field updates if provided
    if (patchResult) {
      updateData.scheduledStart = patchResult.scheduledStart;
      updateData.scheduledEnd = patchResult.scheduledEnd;
      updateData.isAllDay = patchResult.isAllDay;
    }

    // ========================================================================
    // CANONICAL SCHEDULING: All-day events MUST have scheduledStart set to midnight
    // isAllDay is a DISPLAY flag; scheduledStart IS the scheduling determinant
    // ========================================================================
    if (updateData.isAllDay === true || data.allDay === true) {
      updateData.isAllDay = true;
      // For all-day events, scheduledStart = midnight of the day, scheduledEnd = end of day
      // This ensures isJobScheduled() returns true (scheduledStart IS NOT NULL)
      if (data.startAt) {
        const dayStr = data.startAt.toISOString().split('T')[0];
        updateData.scheduledStart = new Date(dayStr + 'T00:00:00.000Z');
        updateData.scheduledEnd = new Date(dayStr + 'T23:59:59.999Z');
      }
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

    // ATOMIC: Wrap update + audit in transaction
    const result = await db.transaction(async (tx) => {
      const rows = await tx
        .update(jobs)
        .set(updateData)
        .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
        .returning();

      const updated = rows[0] ?? null;

      // Assert technician invariant after write
      if (updated) {
        assertTechnicianAssignmentInvariant(updated, "storage:updateAssignment");
      }

      // AUDIT: Log scheduling change (only if scheduling fields changed)
      if (updated && patchResult?.writeIntent) {
        await this.writeScheduleAudit(tx, {
          jobId,
          companyId,
          userId: null,
          contextLabel: patchResult.writeIntent.contextLabel,
          oldFields: patchResult.writeIntent.oldFields,
          newFields: patchResult.writeIntent.newFields,
        });
      }

      return updated;
    });

    // DEV: Assert result meets invariants
    if (result) {
      assertSchedulingInvariants(result, "storage:updateAssignment:result");
    }

    return result;
  }

  /**
   * MODEL A: Delete/unschedule an assignment (returns job to backlog)
   *
   * INVARIANTS delegated to domain/scheduling.ts:
   * - Clears scheduledStart/scheduledEnd/isAllDay (job no longer has assignment)
   * - Status derived from deriveStatusFromSchedule (returns to backlog)
   *
   * UNIFIED PATTERN: Uses applyJobSchedulingPatch for normalization, version, and audit
   */
  async deleteAssignment(companyId: string, jobId: string, expectedVersion?: number) {
    // First get current job to determine appropriate status
    const existing = await this.getAssignmentById(companyId, jobId);

    // UNIFIED: Use domain layer for normalization, version prep, and audit data
    // Clearing schedule = setting start/end to null
    const patchResult = applyJobSchedulingPatch(
      existing,
      {
        scheduledStart: null,
        scheduledEnd: null,
        isAllDay: false,
        expectedVersion,
      },
      "storage:deleteAssignment"
    );

    // OPTIMISTIC LOCKING: Check version using unified helper
    if (patchResult.writeIntent) {
      assertVersionMatch(patchResult.writeIntent, existing?.version);
    }

    // ATOMIC: Wrap update + audit in transaction
    const result = await db.transaction(async (tx) => {
      const rows = await tx
        .update(jobs)
        .set({
          scheduledStart: null,
          scheduledEnd: null,
          isAllDay: false,
          status: patchResult.status,
          updatedAt: new Date(),
          version: patchResult.writeIntent?.newVersion ?? 1,
        })
        .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
        .returning();

      const updated = rows[0] ?? null;

      // AUDIT: Log scheduling change
      if (updated && patchResult.writeIntent) {
        await this.writeScheduleAudit(tx, {
          jobId,
          companyId,
          userId: null,
          contextLabel: patchResult.writeIntent.contextLabel,
          oldFields: patchResult.writeIntent.oldFields,
          newFields: patchResult.writeIntent.newFields,
        });
      }

      return updated;
    });

    // DEV: Assert result meets invariants
    if (result) {
      assertSchedulingInvariants(result, "storage:deleteAssignment:result");
    }

    if (process.env.NODE_ENV === 'development') {
      const hasTechnician = hasTechnicianAssigned(existing || {});
      console.log(
        `[Calendar] deleteAssignment: job=${jobId} status->${patchResult.status} hasTech=${hasTechnician} version=${patchResult.writeIntent?.newVersion}`
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
   * Create assignment WITHOUT working hours validation.
   *
   * GUARANTEES:
   * - NO validateSchedule() call
   * - NO working hours checks
   * - Enforces MODEL A: all-day gets midnight timestamps (NOT null)
   * - Enforces same-day clamp for timed events
   * - Handles version increment
   */
  async createAssignmentBypassWorkingHours(
    companyId: string,
    data: {
      jobId: string;
      technicianUserId?: string;
      startAt: Date;
      endAt: Date;
      notes?: string;
      allDay?: boolean;
      expectedVersion?: number;
    }
  ) {
    // Fetch existing job for version check
    const existingJob = await this.getAssignmentById(companyId, data.jobId);

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

    // COMPUTE FINAL TIMES
    let finalStart: Date | null = data.startAt;
    let finalEnd: Date | null = data.endAt;

    if (isAllDay) {
      // MODEL A: All-day gets midnight timestamps (NOT null)
      // This ensures isJobScheduled() returns true (scheduledStart IS NOT NULL)
      const dayStr = data.startAt.toISOString().split('T')[0];
      finalStart = new Date(dayStr + 'T00:00:00.000Z');
      finalEnd = new Date(dayStr + 'T23:59:59.999Z');
    } else {
      // TIMED: Clamp to same day (never throw, just adjust)
      const startDay = data.startAt.toISOString().split('T')[0];
      const endDay = data.endAt.toISOString().split('T')[0];
      if (startDay !== endDay) {
        finalEnd = new Date(startDay + 'T23:59:59.999Z');
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

    // DIRECT DB WRITE - NO VALIDATION
    const rows = await db
      .update(jobs)
      .set(updateData)
      .where(and(eq(jobs.id, data.jobId), eq(jobs.companyId, companyId)))
      .returning();

    const result = rows[0] ?? null;

    // Assert technician invariant after write
    if (result) {
      assertTechnicianAssignmentInvariant(result, "storage:createAssignmentBypassWorkingHours");
    }

    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[Calendar] createAssignmentBypassWorkingHours: job=${data.jobId} ` +
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
  }> {
    // Get all counts in parallel for efficiency
    const [
      totalJobsResult,
      jobsByStatusResult,
      scheduledResult,
      backlogResult,
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
    };
  }

  /**
   * Update assignment WITHOUT working hours validation.
   *
   * GUARANTEES:
   * - NO validateSchedule() call
   * - NO working hours checks
   * - Enforces MODEL A: all-day gets midnight timestamps (NOT null)
   * - Enforces same-day clamp for timed events
   * - Handles version increment
   */
  async updateAssignmentBypassWorkingHours(
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
    const existingJob = await this.getAssignmentById(companyId, jobId);
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

    // COMPUTE FINAL TIMES
    let finalStart: Date | null;
    let finalEnd: Date | null;

    if (isAllDay) {
      // MODEL A: All-day gets midnight timestamps (NOT null)
      // This ensures isJobScheduled() returns true (scheduledStart IS NOT NULL)
      const sourceDate = data.startAt ?? existingJob.scheduledStart ?? new Date();
      const dayStr = sourceDate.toISOString().split('T')[0];
      finalStart = new Date(dayStr + 'T00:00:00.000Z');
      finalEnd = new Date(dayStr + 'T23:59:59.999Z');
    } else {
      // TIMED: Use provided or existing
      finalStart = data.startAt !== undefined ? data.startAt : existingJob.scheduledStart;
      finalEnd = data.endAt !== undefined ? data.endAt : existingJob.scheduledEnd;

      // Clamp to same day (never throw, just adjust)
      if (finalStart && finalEnd) {
        const startDay = finalStart.toISOString().split('T')[0];
        const endDay = finalEnd.toISOString().split('T')[0];
        if (startDay !== endDay) {
          finalEnd = new Date(startDay + 'T23:59:59.999Z');
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

    // DIRECT DB WRITE - NO VALIDATION
    const rows = await db
      .update(jobs)
      .set(updateData)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
      .returning();

    const result = rows[0] ?? null;

    // Assert technician invariant after write
    if (result) {
      assertTechnicianAssignmentInvariant(result, "storage:updateAssignmentBypassWorkingHours");
    }

    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[Calendar] updateAssignmentBypassWorkingHours: job=${jobId} ` +
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
