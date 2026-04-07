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
import { createError } from "../middleware/errorHandler";
import { activeJobFilter, JOB_ACTIVE_SQL_J } from "./jobFilters";
import { TERMINAL_VISIT_STATUSES, VISIT_TERMINAL_STATUS_SQL } from "../lib/visitPredicates";
import { jobVisitsRepository, isVisitActioned, isVisitEmpty } from "./jobVisits";
import { resolveTechnicianName } from "../lib/resolveTechnicianName";
// Phase 5 Step C2: shared query helpers for bulk resolution
import { bulkResolveTechnicians, bulkResolveCustomerCompanies } from "../lib/queryHelpers";
import { haversineMeters, estimateTravelMinutes } from "../lib/distance";
// ============================================================================
// ARCHITECTURE NOTE: Calendar vs Visit Feed (Phase 3 Step E, updated Phase 5)
// ============================================================================
//
// Calendar is a SEPARATE projection family from the canonical visit/job feeds.
// Do NOT attempt to unify these query paths — they serve different purposes:
//
// Visit Feed (server/storage/visits.ts):
//   - Flat list of visits with job + location joins
//   - RBAC auto-scoping (technicians see only their assigned visits)
//   - Used by: tech field pages, admin visit lists
//   - Query family: ['visits', ...]
//
// Calendar (this file):
//   - Phase 2: Visit-centric query — one event per eligible visit (no ROW_NUMBER dedup)
//   - Technician profile enrichment (colours, display names)
//   - All-day event normalization + backlog logic
//   - Used by: calendar page, dispatch views
//   - Query family: ['/api/calendar', ...] and ['/api/calendar/range', ...]
//
// Shared building blocks consumed from server/lib/queryHelpers.ts (Phase 5 C2):
//   - bulkResolveTechnicians() — batch user+profile lookup → Map<id, {name, color}>
//   - bulkResolveCustomerCompanies() — batch company names → Map<id, name>
//   - resolveTechnicianName() — canonical tech name fallback chain (Phase 4 B)
//
// Calendar does NOT consume the visit or job canonical query builders directly.
// The shared helpers ensure consistency without coupling.
//
// Both paths enforce tenant isolation via companyId.
// ============================================================================
import {
  // Domain helpers - SINGLE SOURCE OF TRUTH for scheduling logic
  BACKLOG_STATUS,
  JOB_TERMINAL_STATUSES,
  deriveScheduleFields,
  hasTechnicianAssigned,
  assertSchedulingInvariants,
  assertTerminalImmutable,
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
import { sanitizeAllDayTimestamps, parseTimestampAsUTC } from "../utils/allDaySanitizer";
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

/** Default duration when converting an all-day visit to a timed visit (minutes). */
export const DEFAULT_VISIT_DURATION_MINUTES = 60;

/**
 * Default calendar visible hours (6am - 7pm)
 */
export const DEFAULT_CALENDAR_START_HOUR = 6;
export const DEFAULT_CALENDAR_END_HOUR = 19;

/**
 * Result from getScheduledJobsInRange with metadata
 */
export interface CalendarRangeResult {
  jobs: ScheduledJobWithDetails[];
  outsideVisibleHoursCount: number;
}

/**
 * Calendar event with joined technician and location info.
 * Phase 2 Dispatch Refactor: Now visit-centric — one event per eligible visit.
 * `id` is the visitId (primary calendar event identity).
 */
export interface ScheduledJobWithDetails {
  /** Phase 2: Event identity = visitId (was jobId in Phase 1) */
  id: string;
  companyId: string;
  jobId: string;
  jobNumber: number;
  jobType: string | null;
  summary: string;
  /** Job-level status (open, completed, invoiced, archived) */
  status: string;
  /** Job workflow sub-status (null, in_progress, on_hold, on_route) — only valid when status='open' */
  openSubStatus: string | null;
  /** Hold reason (parts, customer, access, approval, weather, other) — set when openSubStatus='on_hold' */
  holdReason: string | null;
  locationId: string;
  locationName: string;
  customerCompanyId: string | null;
  customerCompanyName: string | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  isAllDay: boolean;
  /** Scheduled duration in minutes (canonical) */
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
  /** Visit ID — always present for scheduled events, absent for unscheduled backlog */
  visitId?: string;
  /** Visit number within the job (e.g., 1, 2, 3) */
  visitNumber?: number | null;
  /** Visit-level status (scheduled, dispatched, en_route, on_site, etc.) */
  visitStatus?: string;
  /** Visit outcome (completed, needs_parts, needs_followup) — Phase 1 structured column */
  visitOutcome?: string | null;
  /** Visit notes — editable dispatch/office notes on the visit */
  visitNotes?: string | null;
  /** Outcome note — technician-authored note from visit completion */
  outcomeNote?: string | null;
  /** Job description — read-only context from parent job */
  description?: string | null;
  /** Job-level access instructions (e.g., gate code, roof access) */
  accessInstructions?: string | null;
  /** Location contact name */
  contactName?: string | null;
  /** Location contact phone */
  contactPhone?: string | null;
  /** Location notes (site-specific context) */
  locationNotes?: string | null;
  /** Location address fields for display in dispatch detail panel */
  locationAddress?: string | null;
  locationCity?: string | null;
  locationProvinceState?: string | null;
  locationPostalCode?: string | null;
  /** Client location latitude (from client_locations) */
  lat?: string | null;
  /** Client location longitude (from client_locations) */
  lng?: string | null;
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
  scheduledJobs: ScheduledJobWithDetails[],
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

export class SchedulingRepository extends BaseRepository {
  /**
   * PHASE 2 DISPATCH REFACTOR: Visit-centric calendar read path
   *
   * Returns ONE calendar event PER ELIGIBLE VISIT in the date range.
   * Multiple visits for the same job appear as separate calendar events.
   *
   * Eligible visit criteria:
   * - is_active = true, archived_at IS NULL
   * - scheduled_start IS NOT NULL
   * - status NOT IN ('cancelled')
   * - Parent job: not deleted, is_active, not archived
   *
   * NOTE: 'completed' visits are now INCLUDED (they have outcomes to display).
   * Previously excluded — Phase 2 shows all non-cancelled scheduled visits.
   *
   * INVARIANTS:
   * - Calendar shows SCHEDULED VISITS (not jobs)
   * - id = visitId (primary calendar event identity)
   * - Multiple visits per job = multiple calendar events
   * - Range is [startDate, endDate) — exclusive end
   *
   * @param companyId - Tenant ID
   * @param startDate - Range start (inclusive)
   * @param endDate - Range end (EXCLUSIVE)
   */
  async getScheduledJobsInRange(
    companyId: string,
    startDate: Date,
    endDate: Date
  ): Promise<ScheduledJobWithDetails[]> {
    // Phase 2: Direct visit query — no ROW_NUMBER, no per-job dedup
    const visitQuery = await db.execute(sql`
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
        jv.visit_number,
        jv.outcome as visit_outcome,
        jv.visit_notes,
        jv.outcome_note,
        jv.version as visit_version,
        jv.equipment_ids,
        j.description,
        j.access_instructions,
        j.company_id,
        j.job_number,
        j.job_type,
        j.summary,
        j.status,
        j.open_sub_status,
        j.hold_reason,
        j.location_id,
        j.version,
        cl.company_name as location_name,
        cl.parent_company_id as customer_company_id,
        cl.contact_name,
        cl.phone as contact_phone,
        cl.notes as location_notes,
        cl.address as location_address,
        cl.city as location_city,
        cl.province as location_province_state,
        cl.postal_code as location_postal_code,
        cl.lat as location_lat,
        cl.lng as location_lng
      FROM job_visits jv
      JOIN jobs j ON jv.job_id = j.id
      LEFT JOIN client_locations cl ON j.location_id = cl.id
      WHERE jv.company_id = ${companyId}
        AND jv.is_active = true
        AND jv.archived_at IS NULL
        AND jv.scheduled_start IS NOT NULL
        AND jv.status != 'cancelled'
        AND jv.scheduled_start >= ${startDate}
        AND jv.scheduled_start < ${endDate}
        AND ${sql.raw(JOB_ACTIVE_SQL_J)}
        AND j.status != 'archived'
      ORDER BY jv.scheduled_start
    `);

    // Parse raw results — Phase 2: visit_outcome added
    const jobRows = (visitQuery.rows || []) as Array<{
      visit_id: string;
      job_id: string;
      scheduled_start: Date | string;
      scheduled_end: Date | string | null;
      is_all_day: boolean;
      assigned_technician_id: string | null;
      assigned_technician_ids: string[] | null;
      estimated_duration_minutes: number | null;
      visit_number: number | null;
      visit_status: string;
      visit_outcome: string | null;
      visit_notes: string | null;
      outcome_note: string | null;
      visit_version: number;
      equipment_ids: string[] | null;
      description: string | null;
      access_instructions: string | null;
      company_id: string;
      job_number: number;
      job_type: string;
      summary: string;
      status: string;
      open_sub_status: string | null;
      hold_reason: string | null;
      location_id: string;
      version: number;
      location_name: string | null;
      customer_company_id: string | null;
      contact_name: string | null;
      contact_phone: string | null;
      location_notes: string | null;
      location_address: string | null;
      location_city: string | null;
      location_province_state: string | null;
      location_postal_code: string | null;
      location_lat: string | null;
      location_lng: string | null;
    }>;

    // DEV-only debug log
    if (IS_DEV) {
      console.log(
        `[Calendar] getScheduledJobsInRange (PHASE 2 - visit-centric): company=${companyId} range=[${startDate.toISOString()}, ${endDate.toISOString()}) found=${jobRows.length} visit events`
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

    // Phase 5 Step C2: use shared query helpers for bulk resolution
    const technicianMap = await bulkResolveTechnicians(db, Array.from(technicianIdSet));
    const customerCompanyMap = await bulkResolveCustomerCompanies(db, Array.from(customerCompanyIds));

    // Build result with technician details
    // Phase 2: id = visitId (visit-centric identity)
    const results = jobRows.map((row) => {
      const techIds = row.assigned_technician_ids ||
        (row.assigned_technician_id ? [row.assigned_technician_id] : []);
      const technicians = techIds
        .map((id) => technicianMap.get(id))
        .filter((t): t is { id: string; name: string; color: string | null } => t !== undefined);

      // UTC-safe read: parse timestamp-without-timezone values as UTC regardless
      // of server process timezone. Companion to the UTC-safe write path
      // (forceUTCTimestamp / sanitizeSchedulingTimestamps).
      const scheduledStart = parseTimestampAsUTC(row.scheduled_start as Date | string | null);
      const scheduledEnd = parseTimestampAsUTC(row.scheduled_end as Date | string | null);

      // Compute duration from visit data
      let durationMinutes: number | null = null;
      if (!row.is_all_day && scheduledStart && scheduledEnd) {
        durationMinutes = Math.max(15, Math.round((scheduledEnd.getTime() - scheduledStart.getTime()) / 60000));
      }

      return {
        // Phase 2: id = visitId (calendar event identity)
        id: row.visit_id,
        companyId: row.company_id,
        jobId: row.job_id,
        jobNumber: row.job_number,
        jobType: row.job_type,
        summary: row.summary,
        status: row.status,
        openSubStatus: row.open_sub_status ?? null,
        holdReason: row.hold_reason ?? null,
        locationId: row.location_id,
        locationName: row.location_name || "Unknown Location",
        customerCompanyId: row.customer_company_id,
        customerCompanyName: row.customer_company_id
          ? customerCompanyMap.get(row.customer_company_id) || null
          : null,
        scheduledStart,
        scheduledEnd,
        isAllDay: row.is_all_day ?? false,
        durationMinutes,
        assignedTechnicianIds: techIds.length > 0 ? techIds : null,
        primaryTechnicianId: row.assigned_technician_id,
        technicians,
        // Use visit version for scheduled events — rescheduleVisit checks visit.version (2026-03-06)
        version: row.visit_version,
        // Phase 2: Visit fields (always present for scheduled events)
        visitId: row.visit_id,
        visitNumber: row.visit_number,
        visitStatus: row.visit_status,
        visitOutcome: row.visit_outcome,
        visitNotes: row.visit_notes,
        outcomeNote: row.outcome_note,
        description: row.description,
        accessInstructions: row.access_instructions,
        contactName: row.contact_name,
        contactPhone: row.contact_phone,
        locationNotes: row.location_notes,
        locationAddress: row.location_address,
        locationCity: row.location_city,
        locationProvinceState: row.location_province_state,
        locationPostalCode: row.location_postal_code,
        lat: row.location_lat ?? null,
        lng: row.location_lng ?? null,
        equipmentIds: row.equipment_ids ?? null,
      };
    });

    // DEV: Assert calendar results — Phase 2 visit-centric (completed visits now included)
    // Note: assertCalendarQueryResults checks job-level status; with Phase 2, completed
    // visits may belong to non-open jobs, so we only assert scheduledStart is set.
    if (IS_DEV) {
      for (const r of results) {
        if (!r.scheduledStart) {
          console.error(`[storage:getScheduledJobsInRange:PHASE2] INVARIANT VIOLATION: visit ${r.visitId} has no scheduledStart`);
        }
      }
    }

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
  async getUnscheduledJobs(companyId: string): Promise<ScheduledJobWithDetails[]> {
    // 2026-03-22: Added activeVisitId subquery so unscheduled items carry
    // the real visit identity for canonical EditVisitModal opening.
    const activeVisitIdSubquery = sql<string | null>`(
      SELECT jv.id FROM job_visits jv
      WHERE jv.job_id = ${jobs.id}
        AND jv.company_id = ${jobs.companyId}
        AND jv.is_active = true
        AND jv.archived_at IS NULL
        AND jv.status NOT IN (${sql.raw(TERMINAL_VISIT_STATUSES.map(s => `'${s}'`).join(','))})
      ORDER BY jv.visit_number ASC
      LIMIT 1
    )`.as("active_visit_id");

    const jobRows = await db
      .select({
        id: jobs.id,
        companyId: jobs.companyId,
        jobNumber: jobs.jobNumber,
        jobType: jobs.jobType,
        summary: jobs.summary,
        status: jobs.status,
        openSubStatus: jobs.openSubStatus,
        holdReason: jobs.holdReason,
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
        locationAddress: clientLocations.address,
        locationCity: clientLocations.city,
        locationProvinceState: clientLocations.province,
        locationPostalCode: clientLocations.postalCode,
        lat: clientLocations.lat,
        lng: clientLocations.lng,
        activeVisitId: activeVisitIdSubquery,
      })
      .from(jobs)
      .leftJoin(clientLocations, eq(jobs.locationId, clientLocations.id))
      .where(
        and(
          eq(jobs.companyId, companyId),
          // 2026-03-18: Centralized — uses canonical activeJobFilter() from jobFilters.ts
          activeJobFilter(),
          // CANONICAL BACKLOG: scheduledStart IS NULL means unscheduled
          isNull(jobs.scheduledStart),
          // Only 'open' status jobs can be in backlog
          eq(jobs.status, BACKLOG_STATUS),
          // 2026-03-17: Exclude on_hold jobs from generic unscheduled backlog.
          // Jobs placed on_hold (e.g., after visit follow-up) are deliberately parked
          // and should not appear as actionable unscheduled work.
          sql`(${jobs.openSubStatus} IS NULL OR ${jobs.openSubStatus} != 'on_hold')`,
          // Phase B: Exclude jobs needing follow-up (they go in the follow-up section)
          // A job needs follow-up if it has a completed visit with is_follow_up_needed = true
          // and no pending visit already scheduled
          sql`NOT EXISTS (
            SELECT 1 FROM job_visits fv
            WHERE fv.job_id = ${jobs.id}
              AND fv.company_id = ${jobs.companyId}
              AND fv.is_active = true
              AND fv.status = 'completed'
              AND fv.is_follow_up_needed = true
          )`
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

    // Phase 5 Step C2: use shared query helpers for bulk resolution
    const technicianMap = await bulkResolveTechnicians(db, Array.from(technicianIdSet));
    const customerCompanyMap = await bulkResolveCustomerCompanies(db, Array.from(customerCompanyIds));

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
        openSubStatus: job.openSubStatus ?? null,
        holdReason: job.holdReason ?? null,
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
        locationAddress: job.locationAddress,
        locationCity: job.locationCity,
        locationProvinceState: job.locationProvinceState,
        locationPostalCode: job.locationPostalCode,
        // Fix: lat/lng were selected from DB but dropped in results mapping — unscheduled jobs never appeared on dispatch map
        lat: job.lat ?? null,
        lng: job.lng ?? null,
        // 2026-03-22: Real visit ID for canonical EditVisitModal opening
        activeVisitId: job.activeVisitId ?? null,
      };
    });

    // DEV: Assert backlog results meet Model A invariants
    assertBacklogQueryResults(results, "storage:getUnscheduledJobs");

    return results;
  }

  /**
   * Phase B: Get jobs that need a follow-up visit.
   *
   * ELIGIBILITY RULES:
   * 1. Job is active, not deleted, status = "open"
   * 2. Job has at least one completed visit with is_follow_up_needed = true
   * 3. Job does NOT have a pending (non-completed, non-cancelled) visit already scheduled
   *
   * This gives office/admin a list of jobs where the tech said "needs parts"
   * or "needs follow-up" and no next visit has been created yet.
   */
  async getJobsNeedingFollowUp(companyId: string): Promise<(ScheduledJobWithDetails & {
    lastOutcome: string | null;
    lastOutcomeNote: string | null;
    lastVisitCompletedAt: Date | null;
    lastVisitNumber: number | null;
  })[]> {
    // Subquery: jobs that have a completed visit needing follow-up
    // AND do NOT have a pending visit already scheduled
    const rows = await db.execute(sql`
      SELECT DISTINCT ON (j.id)
        j.id,
        j.company_id,
        j.job_number,
        j.job_type,
        j.summary,
        j.status,
        j.open_sub_status,
        j.hold_reason,
        j.location_id,
        j.version,
        j.assigned_technician_ids,
        j.primary_technician_id,
        cl.company_name AS location_name,
        cl.parent_company_id AS customer_company_id,
        -- Last completed visit with follow-up needed
        fv.outcome AS last_outcome,
        fv.outcome_note AS last_outcome_note,
        fv.completed_at AS last_visit_completed_at,
        fv.visit_number AS last_visit_number
      FROM jobs j
      LEFT JOIN client_locations cl ON j.location_id = cl.id
      -- Join to the most recent completed visit that needs follow-up
      -- 2026-03-18: Added archived_at IS NULL to prevent archived visits leaking into follow-up list
      INNER JOIN job_visits fv ON fv.job_id = j.id
        AND fv.company_id = j.company_id
        AND fv.is_active = true
        AND fv.archived_at IS NULL
        AND fv.status = 'completed'
        AND fv.is_follow_up_needed = true
      WHERE j.company_id = ${companyId}
        AND j.deleted_at IS NULL
        AND j.is_active = true
        AND j.status = 'open'
        -- Exclude jobs that already have a pending visit scheduled
        AND NOT EXISTS (
          SELECT 1 FROM job_visits pv
          WHERE pv.job_id = j.id
            AND pv.company_id = j.company_id
            AND pv.is_active = true
            AND pv.status NOT IN (${sql.raw(VISIT_TERMINAL_STATUS_SQL)})
            AND pv.scheduled_start IS NOT NULL
        )
      ORDER BY j.id, fv.completed_at DESC NULLS LAST
    `);

    if (!rows.rows || rows.rows.length === 0) return [];

    // Bulk resolve technicians and customer companies
    const technicianIdSet = new Set<string>();
    const customerCompanyIds = new Set<string>();

    for (const row of rows.rows as any[]) {
      if (row.primary_technician_id) technicianIdSet.add(row.primary_technician_id);
      if (row.assigned_technician_ids) {
        for (const techId of row.assigned_technician_ids) technicianIdSet.add(techId);
      }
      if (row.customer_company_id) customerCompanyIds.add(row.customer_company_id);
    }

    const technicianMap = await bulkResolveTechnicians(db, Array.from(technicianIdSet));
    const customerCompanyMap = await bulkResolveCustomerCompanies(db, Array.from(customerCompanyIds));

    return (rows.rows as any[]).map((row) => {
      const techIds = row.assigned_technician_ids || [];
      const technicians = techIds
        .map((id: string) => technicianMap.get(id))
        .filter((t: any): t is { id: string; name: string; color: string | null } => t !== undefined);

      return {
        id: row.id,
        companyId: row.company_id,
        jobId: row.id,
        jobNumber: row.job_number,
        jobType: row.job_type,
        summary: row.summary,
        status: row.status,
        openSubStatus: row.open_sub_status ?? null,
        holdReason: row.hold_reason ?? null,
        locationId: row.location_id,
        locationName: row.location_name || "Unknown Location",
        customerCompanyId: row.customer_company_id,
        customerCompanyName: row.customer_company_id
          ? customerCompanyMap.get(row.customer_company_id) || null
          : null,
        scheduledStart: null,
        scheduledEnd: null,
        isAllDay: false,
        durationMinutes: null,
        assignedTechnicianIds: row.assigned_technician_ids,
        primaryTechnicianId: row.primary_technician_id,
        technicians,
        version: row.version,
        // Follow-up specific fields
        lastOutcome: row.last_outcome,
        lastOutcomeNote: row.last_outcome_note,
        lastVisitCompletedAt: row.last_visit_completed_at,
        lastVisitNumber: row.last_visit_number,
      };
    });
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
        // 2026-03-18: Centralized — uses canonical activeJobFilter() from jobFilters.ts
        activeJobFilter(),
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
      // Visit Reschedule Architecture: conflict resolution from client
      conflictMode?: 'replace' | 'complete_and_new';
      conflictVisitId?: string;
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

    // Terminal status check — blocks all non-open jobs before any visit mutations.
    // Covers invoiced/archived (via JOB_TERMINAL_STATUSES) and completed.
    // 2026-03-20: Merged late completed-job guard (formerly at post-mutation position,
    // legacy residue from removed Rule D reopen semantics) into this early guard so
    // completed jobs are rejected before visit creation/update, not after.
    if (JOB_TERMINAL_STATUSES.includes(existingJob.status as any) || existingJob.status === 'completed') {
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

    // Visit Reschedule Architecture: 2-case model for single active visit per job.
    // Find the open active non-terminal visit (broader than old placeholder-only check).
    // 2026-03-20: Uses canonical TERMINAL_VISIT_STATUSES from visitPredicates.ts
    const [openVisit] = await db
      .select()
      .from(jobVisits)
      .where(
        and(
          eq(jobVisits.jobId, data.jobId),
          eq(jobVisits.companyId, companyId),
          eq(jobVisits.isActive, true),
          isNull(jobVisits.archivedAt), // Exclude archived visits (2026-03-05)
          notInArray(jobVisits.status, TERMINAL_VISIT_STATUSES),
        )
      )
      .orderBy(asc(jobVisits.visitNumber))
      .limit(1);

    let visit;
    if (!openVisit) {
      // Case 1: No open visit → create new visit
      visit = await jobVisitsRepository.createJobVisit(companyId, data.jobId, {
        scheduledStart,
        scheduledEnd,
        isAllDay,
        assignedTechnicianId: techAssignment.primaryTechnicianId,
        assignedTechnicianIds: techAssignment.assignedTechnicianIds,
        status: 'scheduled',
        visitNotes: data.notes,
      });
    } else if (isVisitEmpty(openVisit) || data.conflictMode === 'replace') {
      // Case 2: Empty visit OR explicit replace → UPDATE IN-PLACE (no duplicate rows)
      // 2026-03-05: Changed from soft-delete+create to in-place update to prevent
      // the "2 visits" duplication bug on the Job Detail page.
      visit = await jobVisitsRepository.updateJobVisit(
        companyId,
        openVisit.id,
        openVisit.version,
        {
          scheduledStart,
          scheduledEnd,
          isAllDay,
          assignedTechnicianId: techAssignment.primaryTechnicianId,
          assignedTechnicianIds: techAssignment.assignedTechnicianIds,
          status: 'scheduled',
          visitNotes: data.notes ?? openVisit.visitNotes,
        }
      );
    } else if (data.conflictMode === 'complete_and_new') {
      // Case 3: Actioned visit + explicit complete_and_new → complete old, create new
      // Labor unification: actualDurationMinutes deprecated — duration derived from time_entries
      const now = new Date();
      await jobVisitsRepository.updateJobVisit(
        companyId,
        openVisit.id,
        openVisit.version,
        {
          status: 'completed',
          outcome: 'completed',
          completedAt: now,
          isFollowUpNeeded: false,
          checkedOutAt: now,
        }
      );
      visit = await jobVisitsRepository.createJobVisit(companyId, data.jobId, {
        scheduledStart,
        scheduledEnd,
        isAllDay,
        assignedTechnicianId: techAssignment.primaryTechnicianId,
        assignedTechnicianIds: techAssignment.assignedTechnicianIds,
        status: 'scheduled',
        visitNotes: data.notes,
      });
    } else {
      // Case 4: Actioned visit + no conflictMode → 409 conflict for frontend dialog
      const err: any = new Error(
        `Visit #${openVisit.visitNumber} is already active and has been actioned. Choose "Replace Visit" or "Complete & Schedule New".`
      );
      err.code = 'VISIT_CONFLICT';
      err.conflictVisitId = openVisit.id;
      throw err;
    }

    // 2026-03-20 BUG FIX: Archive ALL non-terminal, non-current visits for this job.
    // Previously only archived placeholders (scheduledStart IS NULL). Visits that
    // acquired scheduledStart from a prior scheduling cycle but were superseded by
    // a new schedule action retained scheduledStart IS NOT NULL, were NOT archived,
    // and matched the reconciliationActionableVisitFilter — blocking job closure
    // after visit completion (reconciliation saw "remaining actionable visits").
    // Terminal visits (completed, cancelled) are preserved for history.
    if (visit) {
      await db
        .update(jobVisits)
        .set({ archivedAt: new Date() })
        .where(
          and(
            eq(jobVisits.jobId, data.jobId),
            eq(jobVisits.companyId, companyId),
            notInArray(jobVisits.status, TERMINAL_VISIT_STATUSES),
            isNull(jobVisits.archivedAt),
            sql`${jobVisits.id} != ${visit.id}`
          )
        );
    }

    // 2026-03-24: Clear openSubStatus (and hold fields) when scheduling a visit.
    // Two cases:
    // 1. on_hold jobs: Scheduling a visit is the canonical resume path — clear hold
    //    state (openSubStatus, holdReason, holdNotes, nextActionDate, onHoldAt).
    // 2. Stale sub-status on backlog jobs: Jobs returning from completed visits may
    //    retain openSubStatus="in_progress". Clear so dispatch renders correctly.
    if (existingJob.openSubStatus) {
      const clearPatch: Record<string, any> = { openSubStatus: null };
      if (existingJob.openSubStatus === 'on_hold') {
        clearPatch.holdReason = null;
        clearPatch.holdNotes = null;
        clearPatch.nextActionDate = null;
        clearPatch.onHoldAt = null;
      }
      await db
        .update(jobs)
        .set(clearPatch)
        .where(and(eq(jobs.id, data.jobId), eq(jobs.companyId, companyId)));
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

  // REMOVED (2026-03-06): rescheduleJob() — legacy job-centric method.
  // All callers migrated to rescheduleVisit(). See CHANGELOG.

  // REMOVED (2026-03-06): unscheduleJob() — legacy job-centric method.
  // All callers migrated to unscheduleVisit(). See CHANGELOG.

  // ============================================================================
  // PHASE 4 DISPATCH REFACTOR: Visit-Centric Write Methods
  // ============================================================================
  // These methods operate directly on a visitId, skipping the "find eligible visit"
  // lookup. Used by client for existing scheduled visit mutations.
  // Flow A (first schedule) still uses scheduleJob(jobId).
  // ============================================================================

  /**
   * Phase 4: Unschedule an existing visit by visitId.
   * Converts the visit to a placeholder (clears scheduledStart/End).
   */
  async unscheduleVisit(companyId: string, visitId: string, expectedVersion?: number) {
    const visit = await jobVisitsRepository.getJobVisit(companyId, visitId);
    if (!visit) {
      throw new Error('Visit not found');
    }

    const existingJob = await this.getJobById(companyId, visit.jobId);
    if (!existingJob) {
      throw new Error('Parent job not found');
    }

    if (JOB_TERMINAL_STATUSES.includes(existingJob.status as any)) {
      throw new TerminalJobImmutableError(visit.jobId, existingJob.status);
    }

    // 2026-03-24: Block unschedule of terminal visits (completed/cancelled).
    // Uses canonical TERMINAL_VISIT_STATUSES from visitPredicates.ts.
    if (TERMINAL_VISIT_STATUSES.includes(visit.status as string)) {
      throw createError(400, "Cannot unschedule a completed or cancelled visit");
    }

    // Version check using visit version
    if (expectedVersion !== undefined && visit.version !== expectedVersion) {
      throw new VersionMismatchError(expectedVersion, visit.version);
    }

    // 2026-03-23: Convert to placeholder — clear all schedule AND technician fields.
    // Unscheduled = no date, no time, no technician assignment.
    await jobVisitsRepository.updateJobVisit(companyId, visit.id, visit.version, {
      scheduledStart: null,
      scheduledEnd: null,
      scheduledDate: new Date(),
      isAllDay: false,
      assignedTechnicianId: null,
      assignedTechnicianIds: [],
    });

    if (IS_DEV) {
      console.log(`[Calendar] unscheduleVisit (PHASE 4): visitId=${visitId} jobId=${visit.jobId}`);
    }

    // Re-fetch job and visit (for correct visit version in response)
    const result = await this.getJobById(companyId, visit.jobId);
    const updatedVisit = await jobVisitsRepository.getJobVisit(companyId, visitId);
    return { ...result, visitId, visitVersion: updatedVisit?.version ?? result?.version };
  }

  /**
   * Phase 4: Resize an existing visit by visitId.
   * Updates only scheduledEnd on the visit.
   */
  async resizeVisit(companyId: string, visitId: string, newEndTime: Date) {
    const visit = await jobVisitsRepository.getJobVisit(companyId, visitId);
    if (!visit) {
      throw new Error('Visit not found');
    }

    let finalEnd = newEndTime;
    if (visit.isAllDay) {
      finalEnd = new Date(newEndTime);
      finalEnd.setHours(23, 59, 59, 0);
    }

    await jobVisitsRepository.updateJobVisit(companyId, visit.id, visit.version, {
      scheduledEnd: finalEnd,
    });

    if (IS_DEV) {
      console.log(`[Calendar] resizeVisit (PHASE 4): visitId=${visitId} newEnd=${finalEnd.toISOString()}`);
    }

    const result = await this.getJobById(companyId, visit.jobId);
    const updatedVisit = await jobVisitsRepository.getJobVisit(companyId, visitId);
    return { ...result, visitId, visitVersion: updatedVisit?.version ?? result?.version };
  }

  /**
   * Update visit crew roster (multi-tech assignment).
   * Sets assignedTechnicianIds to the full array and primaryTechnicianId to the first.
   * Does NOT change schedule times.
   */
  async updateVisitCrew(
    companyId: string,
    visitId: string,
    technicianUserIds: string[],
    expectedVersion: number,
  ) {
    const visit = await jobVisitsRepository.getJobVisit(companyId, visitId);
    if (!visit) {
      throw new Error('Visit not found');
    }

    if (visit.version !== expectedVersion) {
      throw new VersionMismatchError(expectedVersion, visit.version);
    }

    await jobVisitsRepository.updateJobVisit(companyId, visit.id, visit.version, {
      assignedTechnicianId: technicianUserIds[0],
      assignedTechnicianIds: technicianUserIds,
    });

    if (IS_DEV) {
      console.log(`[Calendar] updateVisitCrew: visitId=${visitId} crew=[${technicianUserIds.join(",")}]`);
    }

    const updatedVisit = await jobVisitsRepository.getJobVisit(companyId, visitId);
    return { jobId: visit.jobId, version: updatedVisit?.version ?? visit.version };
  }

  // 2026-03-20: validateTechnicianBelongsToTenant() and validateJobBelongsToTenant()
  // DELETED — dead code with zero callers. Tenant isolation enforced by middleware + FK constraints.

  // ============================================================================
  // BYPASS FUNCTIONS - NO WORKING HOURS VALIDATION
  // ============================================================================
  // 2026-03-18: scheduleJobBypassWorkingHours() DELETED — dead code with zero callers.
  // See docs/REFACTORING_LOG.md for details.

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
      // Total jobs (excluding soft-deleted and deactivated — canonical activeJobFilter)
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(jobs)
        .where(and(eq(jobs.companyId, companyId), activeJobFilter())),

      // Jobs by status
      db
        .select({
          status: jobs.status,
          count: sql<number>`count(*)::int`,
        })
        .from(jobs)
        .where(and(eq(jobs.companyId, companyId), activeJobFilter()))
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
            activeJobFilter(),
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
            activeJobFilter(),
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
            activeJobFilter(),
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
            activeJobFilter(),
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
            activeJobFilter(),
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
            activeJobFilter(),
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
            activeJobFilter(),
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
            activeJobFilter(),
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

  // REMOVED (2026-03-06): rescheduleJobBypassWorkingHours() — legacy job-centric method.
  // No remaining callers after visit-centric migration. See CHANGELOG.
}

export const schedulingRepository = new SchedulingRepository();

// ============================================================================
// Day Summary (Phase 2: extracted verbatim from routes/scheduling.ts)
// ============================================================================

interface DaySummaryVisitRow {
  visitId: string;
  scheduledStart: Date;
  scheduledEnd: Date | null;
  estimatedDurationMinutes: number | null;
  status: string;
  technicianId: string | null;
  technicianIds: string[] | null;
  locationLat: string | null;
  locationLng: string | null;
}

export async function getDaySummary(companyId: string, dateStr: string) {
  // 1) Fetch all active visits for the date
  const { rows: visitRows } = await db.execute(sql`
    SELECT
      jv.id AS "visitId",
      jv.scheduled_start AS "scheduledStart",
      jv.scheduled_end AS "scheduledEnd",
      jv.estimated_duration_minutes AS "estimatedDurationMinutes",
      jv.status,
      jv.assigned_technician_id AS "technicianId",
      jv.assigned_technician_ids AS "technicianIds",
      cl.lat AS "locationLat",
      cl.lng AS "locationLng"
    FROM job_visits jv
    JOIN jobs j ON j.id = jv.job_id AND j.company_id = ${companyId}
      AND ${sql.raw(JOB_ACTIVE_SQL_J)}
    LEFT JOIN client_locations cl ON cl.id = j.location_id
    WHERE jv.company_id = ${companyId}
      AND jv.is_active = true
      AND jv.archived_at IS NULL
      AND jv.scheduled_start IS NOT NULL
      AND jv.scheduled_start >= ${dateStr}::date
      AND jv.scheduled_start < ${dateStr}::date + INTERVAL '1 day'
      AND jv.status NOT IN ('cancelled')
    ORDER BY jv.scheduled_start ASC
  `);
  const visits = visitRows as unknown as DaySummaryVisitRow[];

  // 2) Fetch live positions
  const { rows: liveRows } = await db.execute(sql`
    SELECT
      lp.technician_id AS "technicianId",
      lp.last_seen_at AS "lastSeenAt",
      lp.speed
    FROM technician_live_positions lp
    WHERE lp.company_id = ${companyId}
  `);
  const liveMap = new Map<string, { lastSeenAt: Date; speed: string | null }>();
  for (const r of liveRows as any[]) {
    liveMap.set(r.technicianId, { lastSeenAt: r.lastSeenAt, speed: r.speed });
  }

  // 3) Fetch open attention items for operational rule types
  const { rows: attRows } = await db.execute(sql`
    SELECT rule_type AS "ruleType", entity_type AS "entityType", entity_id AS "entityId",
           meta
    FROM attention_items
    WHERE tenant_id = ${companyId}
      AND status = 'open'
      AND rule_type IN ('visit.late', 'visit.overdue', 'visit.running_long', 'tech.offline', 'tech.idle')
  `);

  // Build riskCounts per technician
  // For visit-level rules, map visitId → technicianId via visits
  const visitTechMap = new Map<string, string>();
  for (const v of visits) {
    const tid = v.technicianId || (v.technicianIds?.[0] ?? null);
    if (tid) visitTechMap.set(v.visitId, tid);
  }

  const techRisks = new Map<string, Record<string, number>>();
  for (const att of attRows as any[]) {
    let techId: string | null = null;
    if (att.entityType === "technician") {
      techId = att.entityId;
    } else if (att.entityType === "visit") {
      techId = visitTechMap.get(att.entityId) ||
        (att.meta?.technicianId as string) || null;
    }
    if (!techId) continue;
    if (!techRisks.has(techId)) techRisks.set(techId, {});
    const counts = techRisks.get(techId)!;
    const key = att.ruleType.replace("visit.", "").replace("tech.", "");
    counts[key] = (counts[key] || 0) + 1;
  }

  // 4) Fetch technician names
  const { rows: techRows } = await db.execute(sql`
    SELECT id, full_name AS "fullName"
    FROM users
    WHERE company_id = ${companyId}
      AND role IN ('owner', 'admin', 'manager', 'dispatcher', 'technician')
      AND is_active = true
  `);
  const techNames = new Map<string, string>();
  for (const t of techRows as any[]) {
    techNames.set(t.id, t.fullName);
  }

  // 5) Group visits by technician and compute stats
  const techVisitsMap = new Map<string, DaySummaryVisitRow[]>();
  for (const v of visits) {
    const tids = v.technicianIds?.length ? v.technicianIds : v.technicianId ? [v.technicianId] : [];
    for (const tid of tids) {
      if (!techVisitsMap.has(tid)) techVisitsMap.set(tid, []);
      techVisitsMap.get(tid)!.push(v);
    }
  }

  const now = new Date();
  const summaries = [];

  for (const [techId, techVisits] of Array.from(techVisitsMap.entries())) {
    // scheduledMinutes: sum of each visit's duration
    let scheduledMinutes = 0;
    for (const v of techVisits) {
      if (v.scheduledEnd && v.scheduledStart) {
        scheduledMinutes += Math.round((new Date(v.scheduledEnd).getTime() - new Date(v.scheduledStart).getTime()) / 60_000);
      } else {
        scheduledMinutes += v.estimatedDurationMinutes ?? 60;
      }
    }

    // driveMinutesEstimated: haversine-based 30km/h between consecutive visits
    let driveMinutes = 0;
    const sorted = [...techVisits].sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime());
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev.locationLat && prev.locationLng && curr.locationLat && curr.locationLng) {
        driveMinutes += estimateTravelMinutes(
          parseFloat(prev.locationLat), parseFloat(prev.locationLng),
          parseFloat(curr.locationLat), parseFloat(curr.locationLng),
        );
      }
    }

    // Risk
    const riskCounts = techRisks.get(techId) || {};
    const hasHigh = (riskCounts.running_long || 0) > 0 || (riskCounts.overdue || 0) > 0;
    const hasWarn = (riskCounts.late || 0) > 0 || (riskCounts.offline || 0) > 0;
    const risk = hasHigh ? "high" : hasWarn ? "warn" : "ok";

    // Presence
    const live = liveMap.get(techId);
    const online = live ? (now.getTime() - new Date(live.lastSeenAt).getTime()) < 5 * 60_000 : false;

    // Next visit
    const nextVisit = sorted.find((v) => new Date(v.scheduledStart).getTime() > now.getTime());

    summaries.push({
      technicianId: techId,
      name: techNames.get(techId) || techId,
      scheduledMinutes,
      driveMinutesEstimated: driveMinutes,
      visitCount: techVisits.length,
      risk,
      riskCounts,
      online,
      lastSeenAt: live?.lastSeenAt ? new Date(live.lastSeenAt).toISOString() : undefined,
      nextVisit: nextVisit ? {
        visitId: nextVisit.visitId,
        plannedStart: new Date(nextVisit.scheduledStart).toISOString(),
      } : undefined,
    });
  }

  return summaries;
}

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
