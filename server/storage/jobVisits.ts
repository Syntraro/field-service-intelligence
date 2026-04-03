import { db } from "../db";
import { and, eq, desc, gte, lte, asc, sql, notInArray, isNull, isNotNull, or } from "drizzle-orm";
import { activeJobFilter } from "./jobFilters";
import { jobVisits, jobs, jobNotes, users, clientLocations, jobEquipment } from "@shared/schema";
import { BaseRepository, clampLimit } from "./base";
import { sanitizeAllDayTimestamps } from "../utils/allDaySanitizer";
import {
  activeVisitGuard,
  scheduleEligibleVisitFilter,
  uncompletedVisitFilter,
} from "../lib/visitPredicates";

// ============================================================================
// ENRICHED VISIT TYPES — shared response shapes for tech + calendar consumers
// ============================================================================

/** Job metadata attached to an enriched visit. */
export interface VisitJobInfo {
  id: string;
  jobNumber: number;
  summary: string;
  jobType: string;
  description: string | null;
  priority: string | null;
}

/** Location metadata attached to an enriched visit. */
export interface VisitLocationInfo {
  id: string;
  companyName: string | null;
  location: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  phone: string | null;
}

/** A visit enriched with job + location data (canonical shape for tech/calendar). */
export interface EnrichedVisit {
  /** All columns from job_visits */
  [key: string]: any;
  job: VisitJobInfo;
  location: VisitLocationInfo | null;
}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export interface JobVisitListFilters {
  companyId: string;
  jobId?: string;
  status?: string;
  assignedTechnicianId?: string;
  fromDate?: Date;
  toDate?: Date;
  offset?: number;
  limit?: number;
}

export interface JobVisitListResult {
  items: any[];
  hasMore: boolean;
}

/**
 * Job Visits repository - handles all job visit database operations.
 * Ensures tenant isolation via companyId scoping.
 * Uses soft delete (isActive flag) for all delete operations.
 */
export class JobVisitsRepository extends BaseRepository {
  /**
   * List job visits with filters
   */
  async listJobVisits(filters: JobVisitListFilters): Promise<JobVisitListResult> {
    this.assertCompanyId(filters.companyId);

    const where: any[] = [
      eq(jobVisits.companyId, filters.companyId),
      activeVisitGuard(),
    ];

    if (filters.jobId) where.push(eq(jobVisits.jobId, filters.jobId));
    if (filters.status) where.push(eq(jobVisits.status, filters.status));
    if (filters.assignedTechnicianId)
      where.push(eq(jobVisits.assignedTechnicianId, filters.assignedTechnicianId));
    // Part 1: Filter by scheduledStart (not scheduledDate)
    if (filters.fromDate) where.push(gte(jobVisits.scheduledStart, filters.fromDate));
    if (filters.toDate) where.push(lte(jobVisits.scheduledStart, filters.toDate));

    const offset = Math.max(0, filters.offset ?? 0);
    const limit = clampLimit(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const rows = await db
      .select()
      .from(jobVisits)
      .where(and(...where))
      // Part 1: Order by scheduledStart descending
      .orderBy(desc(jobVisits.scheduledStart), desc(jobVisits.id))
      .limit(limit + 1)
      .offset(offset);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return { items, hasMore };
  }

  /**
   * PHASE 4: List ALL visits for a job (including inactive) for Job Detail panel.
   * Returns complete visit history ordered by scheduled_start DESC, created_at DESC.
   * Includes inactive visits so they can be shown in history as "unscheduled".
   */
  async listAllJobVisitsForJob(companyId: string, jobId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    // 2026-03-05: Exclude placeholder visits (scheduledStart IS NULL and no
    // activity) from Job Detail. Placeholders are created during unschedule
    // cycles and show as confusing "No date" rows. Visits that have been
    // checked-in or completed ARE shown even without scheduledStart.
    const rows = await db
      .select()
      .from(jobVisits)
      .where(
        and(
          eq(jobVisits.companyId, companyId),
          eq(jobVisits.jobId, jobId),
          // NO isActive filter - include all for history
          isNull(jobVisits.archivedAt), // Exclude archived visits (2026-03-05)
          // Exclude empty placeholders: must have a scheduled date OR some activity
          or(
            isNotNull(jobVisits.scheduledStart),
            isNotNull(jobVisits.checkedInAt),
            eq(jobVisits.status, 'completed'),
          ),
        )
      )
      .orderBy(
        desc(jobVisits.scheduledStart),
        desc(jobVisits.createdAt)
      );

    return rows;
  }

  /**
   * Get single job visit
   */
  async getJobVisit(companyId: string, visitId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(visitId, "visitId");

    const [visit] = await db
      .select()
      .from(jobVisits)
      .where(
        and(
          eq(jobVisits.id, visitId),
          eq(jobVisits.companyId, companyId),
          activeVisitGuard()
        )
      );

    return visit ?? null;
  }

  /**
   * PHASE 4: Get the "current eligible visit" for a job.
   * Uses same selection logic as calendar read and syncJobScheduleFromVisits:
   * - Eligible: is_active=true, scheduled_start IS NOT NULL, status NOT IN ('cancelled', 'completed')
   * - Selection: earliest future visit if any exist, else most recent past visit
   *
   * @returns The current visit row or null if no eligible visit exists
   */
  async getCurrentEligibleVisit(companyId: string, jobId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    const now = new Date();

    // Pull all schedule-eligible visits for this job
    // 2026-03-18: Uses canonical predicate from visitPredicates.ts
    const visitRows = await db
      .select()
      .from(jobVisits)
      .where(scheduleEligibleVisitFilter(companyId, jobId))
      .orderBy(asc(jobVisits.scheduledStart));

    if (!visitRows.length) {
      return null;
    }

    // Find earliest future visit
    const nextFuture = visitRows.find((v) => {
      const s = v.scheduledStart ? new Date(v.scheduledStart as any) : null;
      return !!s && s.getTime() >= now.getTime();
    });

    if (nextFuture) {
      return nextFuture;
    }

    // No future visits - return most recent past (latest scheduled_start)
    const past = visitRows
      .filter((v) => {
        const s = v.scheduledStart ? new Date(v.scheduledStart as any) : null;
        return !!s && s.getTime() < now.getTime();
      })
      .sort((a, b) => {
        const sa = new Date(a.scheduledStart as any).getTime();
        const sb = new Date(b.scheduledStart as any).getTime();
        return sb - sa; // latest first
      });

    return past[0] ?? visitRows[0];
  }

  // ========================================================================
  // ENRICHED QUERIES — visit detail + assignment validation
  // ========================================================================
  // NOTE: getVisitsForUserInRange has been moved to server/storage/visits.ts
  // (canonical standalone module). Use that for date-range visit queries.

  /**
   * Get a single visit assigned to a user, enriched with job + location + job notes.
   * Includes strict assignment validation — returns null if not assigned to userId.
   * Used by: /api/tech/visits/:visitId detail endpoint.
   */
  async getVisitDetailForUser(
    companyId: string,
    userId: string,
    visitId: string
  ): Promise<{ visit: any; job: VisitJobInfo | null; location: VisitLocationInfo | null; notes: any[] } | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(visitId, "visitId");

    // Fetch visit
    const [visit] = await db
      .select()
      .from(jobVisits)
      .where(
        and(
          eq(jobVisits.id, visitId),
          eq(jobVisits.companyId, companyId),
          activeVisitGuard()
        )
      );

    if (!visit) return null;

    // Assignment check
    const isAssigned =
      visit.assignedTechnicianId === userId ||
      (visit.assignedTechnicianIds && visit.assignedTechnicianIds.includes(userId));
    if (!isAssigned) return null;

    // Fetch job
    const [job] = await db
      .select({
        id: jobs.id,
        jobNumber: jobs.jobNumber,
        summary: jobs.summary,
        jobType: jobs.jobType,
        description: jobs.description,
        priority: jobs.priority,
      })
      .from(jobs)
      .where(and(eq(jobs.id, visit.jobId), eq(jobs.companyId, companyId), activeJobFilter()));

    // Fetch location via job.locationId
    let location: VisitLocationInfo | null = null;
    if (job) {
      const [loc] = await db
        .select({
          id: clientLocations.id,
          companyName: clientLocations.companyName,
          location: clientLocations.location,
          address: clientLocations.address,
          city: clientLocations.city,
          province: clientLocations.province,
          postalCode: clientLocations.postalCode,
          phone: clientLocations.phone,
        })
        .from(clientLocations)
        .innerJoin(jobs, eq(jobs.locationId, clientLocations.id))
        .where(and(eq(jobs.id, visit.jobId), eq(jobs.companyId, companyId)));
      location = loc ?? null;
    }

    // Fetch job notes
    const notes = await db
      .select({
        id: jobNotes.id,
        noteText: jobNotes.noteText,
        imageUrl: jobNotes.imageUrl,
        createdAt: jobNotes.createdAt,
        userId: jobNotes.userId,
        userName: users.fullName,
        userFirstName: users.firstName,
      })
      .from(jobNotes)
      .leftJoin(users, eq(jobNotes.userId, users.id))
      .where(and(eq(jobNotes.companyId, companyId), eq(jobNotes.jobId, visit.jobId)))
      .orderBy(desc(jobNotes.createdAt));

    return {
      visit,
      job: job ?? null,
      location,
      notes,
    };
  }

  /**
   * Get an assigned visit row for mutation endpoints (en-route, start, complete).
   * Returns the raw visit row or null. Does NOT enrich with job/location.
   */
  async getAssignedVisit(companyId: string, visitId: string, userId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(visitId, "visitId");

    const [visit] = await db
      .select()
      .from(jobVisits)
      .where(
        and(
          eq(jobVisits.id, visitId),
          eq(jobVisits.companyId, companyId),
          activeVisitGuard()
        )
      );

    if (!visit) return null;

    const isAssigned =
      visit.assignedTechnicianId === userId ||
      (visit.assignedTechnicianIds && visit.assignedTechnicianIds.includes(userId));

    return isAssigned ? visit : null;
  }

  /**
   * PHASE 4: Public wrapper for syncJobScheduleFromVisits.
   * Called by calendar write endpoints after modifying job_visits.
   */
  async syncJobToVisits(companyId: string, jobId: string) {
    return this.syncJobScheduleFromVisits(companyId, jobId);
  }

  /**
   * STEP 2.4 - Compatibility mirror:
   * Mirror the "next scheduled visit" onto jobs.scheduled_* so Model A calendar keeps working.
   * Rules:
   * - "Active scheduled visit" = is_active=true, scheduled_start IS NOT NULL, status NOT IN (cancelled, completed)
   * - "Next" = earliest future visit if any, else earliest overall
   * - If no active visits: unschedule the job
   */
  private async syncJobScheduleFromVisits(companyId: string, jobId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    // Pull schedule-eligible visits for this job
    // 2026-03-18: Uses canonical predicate from visitPredicates.ts
    const visitRows = await db
      .select({
        id: jobVisits.id,
        scheduledStart: jobVisits.scheduledStart,
        scheduledEnd: jobVisits.scheduledEnd,
        isAllDay: jobVisits.isAllDay,
        assignedTechnicianId: jobVisits.assignedTechnicianId,
        assignedTechnicianIds: jobVisits.assignedTechnicianIds,
        status: jobVisits.status,
        isActive: jobVisits.isActive,
      })
      .from(jobVisits)
      .where(scheduleEligibleVisitFilter(companyId, jobId))
      .orderBy(asc(jobVisits.scheduledStart));

    if (!visitRows.length) {
      // UNSCHEDULE BRANCH: No eligible visits exist (all cancelled/completed or none created).
      // 2026-03-18: Guard against clearing schedule fields on completed/on_hold jobs.
      // When reconciliation has already set the job to a non-backlog state, clearing
      // schedule fields would cause the job to appear as unscheduled backlog in the
      // window between sync and reconciliation, or after reconciliation has run.
      const [currentJob] = await db
        .select({ status: jobs.status, openSubStatus: jobs.openSubStatus })
        .from(jobs)
        .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)));

      if (currentJob) {
        // Don't clear schedule for completed/invoiced/archived jobs — they're done
        if (currentJob.status !== "open") return;
        // Don't clear schedule for on_hold jobs — they're deliberately parked, not backlog
        if (currentJob.openSubStatus === "on_hold") return;
      }

      // Genuine unschedule: job is open with no eligible visits and not on hold
      await db
        .update(jobs)
        .set({
          scheduledStart: null,
          scheduledEnd: null,
          isAllDay: false,
          durationMinutes: null,
          primaryTechnicianId: null,
          assignedTechnicianIds: null,
          updatedAt: new Date(),
          version: sql`${jobs.version} + 1`,
        })
        .where(and(eq(jobs.companyId, companyId), eq(jobs.id, jobId)));

      return;
    }

    const now = new Date();

    const nextFuture = visitRows.find(v => {
      const s = v.scheduledStart ? new Date(v.scheduledStart as any) : null;
      return !!s && s.getTime() >= now.getTime();
    });

    // If no future visits exist, prefer the most recent past visit (latest scheduled_start)
    let chosen = nextFuture;
    if (!chosen) {
      const past = visitRows
        .filter(v => {
          const s = v.scheduledStart ? new Date(v.scheduledStart as any) : null;
          return !!s && s.getTime() < now.getTime();
        })
        .sort((a, b) => {
          const sa = new Date(a.scheduledStart as any).getTime();
          const sb = new Date(b.scheduledStart as any).getTime();
          return sb - sa; // latest first
        });

      chosen = past[0] ?? visitRows[0];
    }

    const scheduledStart = chosen.scheduledStart ? new Date(chosen.scheduledStart as any) : null;
    const scheduledEnd = chosen.scheduledEnd ? new Date(chosen.scheduledEnd as any) : null;
    const isAllDay = Boolean(chosen.isAllDay);

    // durationMinutes mirror:
    // - all-day: NULL (jobs calendar code computes 1440 if isAllDay true)
    // - timed: compute from start/end if present
    let durationMinutes: number | null = null;
    if (!isAllDay && scheduledStart && scheduledEnd) {
      durationMinutes = Math.max(15, Math.round((scheduledEnd.getTime() - scheduledStart.getTime()) / 60000));
    }

    // Mirror technician fields
    const primaryTechnicianId = chosen.assignedTechnicianId ?? null;
    const assignedTechnicianIds = chosen.assignedTechnicianIds ?? (primaryTechnicianId ? [primaryTechnicianId] : null);

    // Build update payload, then sanitize all-day timestamps for DB constraint compliance
    const jobUpdate: any = {
      scheduledStart,
      scheduledEnd,
      isAllDay,
      durationMinutes,
      primaryTechnicianId,
      assignedTechnicianIds,
      updatedAt: new Date(),
      version: sql`${jobs.version} + 1`,
    };

    // Sanitize all-day timestamps: replaces Date objects with UTC-safe SQL expressions
    // to prevent node-pg timezone serialization from violating jobs_all_day_*_check constraints
    sanitizeAllDayTimestamps(jobUpdate, jobId);

    await db
      .update(jobs)
      .set(jobUpdate)
      .where(and(eq(jobs.companyId, companyId), eq(jobs.id, jobId)));
  }

  /**
   * Compute next visit number for a job (max across ALL visits + 1).
   * Visit Reschedule Architecture fix: removed isActive filter because the
   * unique constraint job_visits_job_visit_number_uq covers ALL rows including
   * inactive ones. Without this fix, soft-deleting visit #1 then creating a
   * new visit would try to reuse #1, causing a constraint violation.
   */
  private async getNextVisitNumber(companyId: string, jobId: string): Promise<number> {
    const [row] = await db
      .select({ maxVisit: sql<number>`COALESCE(MAX(${jobVisits.visitNumber}), 0)` })
      .from(jobVisits)
      .where(
        and(
          eq(jobVisits.companyId, companyId),
          eq(jobVisits.jobId, jobId)
        )
      );
    return (Number(row?.maxVisit) || 0) + 1;
  }

  /**
   * Create job visit
   * Part 2: Inserts scheduledStart, scheduledEnd, isAllDay, visitNumber, assignedTechnicianIds
   */
  async createJobVisit(companyId: string, jobId: string, input: any) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    // Verify job exists and belongs to company (exclude soft-deleted/inactive)
    const [job] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId), activeJobFilter()));

    if (!job) {
      throw this.notFoundError("Job");
    }

    // Part 2: Compute visitNumber if not provided
    const visitNumber = input.visitNumber ?? await this.getNextVisitNumber(companyId, jobId);

    // Part 2: Normalize scheduling fields
    const rawStart = input.scheduledStart ?? input.scheduledDate;
    const scheduledStart = rawStart instanceof Date ? rawStart : new Date(rawStart);
    const scheduledDate = scheduledStart; // legacy mirror

    const isAllDay = Boolean(input.isAllDay ?? false);
    const estimatedDurationMinutes = Number(input.estimatedDurationMinutes ?? 60);

    // Compute scheduledEnd if not provided
    let scheduledEnd: Date;
    if (input.scheduledEnd) {
      scheduledEnd = input.scheduledEnd instanceof Date
        ? input.scheduledEnd
        : new Date(input.scheduledEnd);
    } else if (isAllDay) {
      // UTC-safe: setUTCHours ensures 23:59:59 UTC regardless of server timezone
      const end = new Date(scheduledStart);
      end.setUTCHours(23, 59, 59, 0);
      scheduledEnd = end;
    } else {
      scheduledEnd = new Date(scheduledStart.getTime() + estimatedDurationMinutes * 60_000);
    }

    // Part 2: assignedTechnicianIds fallback from single assignedTechnicianId
    const assignedTechnicianIds =
      input.assignedTechnicianIds ??
      (input.assignedTechnicianId ? [input.assignedTechnicianId] : null);

    // Inherit job-level equipment if no explicit visit equipment provided
    let equipmentIds: string[] | null = input.equipmentIds ?? null;
    if (equipmentIds == null) {
      const jobEquipRows = await db
        .select({ equipmentId: jobEquipment.equipmentId })
        .from(jobEquipment)
        .where(and(eq(jobEquipment.companyId, companyId), eq(jobEquipment.jobId, jobId)));
      if (jobEquipRows.length > 0) {
        equipmentIds = jobEquipRows.map(r => r.equipmentId);
      }
    }

    const [visit] = await db
      .insert(jobVisits)
      .values({
        companyId,
        jobId,
        scheduledDate,
        scheduledStart,
        scheduledEnd,
        isAllDay,
        estimatedDurationMinutes,
        assignedTechnicianId: input.assignedTechnicianId ?? null,
        assignedTechnicianIds,
        status: input.status ?? "scheduled",
        visitNumber,
        visitNotes: input.visitNotes ?? null,
        equipmentIds,
      })
      .returning();

    // Step 2.4: Sync job schedule from visits after create
    await this.syncJobScheduleFromVisits(companyId, jobId);

    return visit;
  }

  /**
   * Update job visit (with optimistic locking)
   */
  async updateJobVisit(
    companyId: string,
    visitId: string,
    version: number | undefined,
    input: any
  ) {
    const existing = await this.getJobVisit(companyId, visitId);
    if (!existing) {
      throw this.notFoundError("Visit");
    }

    // Optimistic locking check
    if (version !== undefined && existing.version !== version) {
      throw this.conflictError(
        `Visit was modified by another user. Expected version ${version}, but current version is ${existing.version}. Please refresh and try again.`
      );
    }

    const updates: any = { updatedAt: new Date(), version: existing.version + 1 };

    // =========================================================================
    // Schedule field normalization (2026-03-05)
    // Some scheduling flows write scheduledDate but not scheduledStart. The map,
    // eligible-visit, and list-filter queries all depend on scheduledStart IS NOT
    // NULL. Normalize here — the single canonical write path — so every caller
    // gets consistent DB rows.
    // =========================================================================

    // 1) scheduledDate provided without scheduledStart → mirror to scheduledStart
    if ("scheduledDate" in input && !("scheduledStart" in input) && input.scheduledDate != null) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[jobVisits] scheduledDate without scheduledStart; normalized", { visitId, jobId: existing.jobId });
      }
      updates.scheduledStart = input.scheduledDate;
      updates.scheduledDate = input.scheduledDate;
    } else {
      if ("scheduledDate" in input) updates.scheduledDate = input.scheduledDate;
      if ("scheduledStart" in input) updates.scheduledStart = input.scheduledStart;
    }

    // 2) Default duration: ensure estimatedDurationMinutes is never null/0
    if ("estimatedDurationMinutes" in input) {
      updates.estimatedDurationMinutes = (input.estimatedDurationMinutes && input.estimatedDurationMinutes > 0)
        ? input.estimatedDurationMinutes
        : 60;
    }

    // 3) Explicit unschedule: if scheduledStart is cleared, also clear end + date
    if ("scheduledStart" in input && input.scheduledStart == null) {
      updates.scheduledEnd = null;
      updates.scheduledDate = input.scheduledDate ?? existing.scheduledDate; // preserve legacy date or keep as-is
    }

    // Non-schedule fields
    if ("assignedTechnicianId" in input)
      updates.assignedTechnicianId = input.assignedTechnicianId;
    if ("status" in input) updates.status = input.status;
    if ("visitNotes" in input) updates.visitNotes = input.visitNotes;
    if ("isActive" in input) updates.isActive = input.isActive;

    // Archive fields (2026-03-05)
    if ("archivedAt" in input) updates.archivedAt = input.archivedAt;
    if ("archivedByUserId" in input) updates.archivedByUserId = input.archivedByUserId;
    if ("archivedReason" in input) updates.archivedReason = input.archivedReason;

    // Part 2: Additional schedule fields
    if ("scheduledEnd" in input && !("scheduledStart" in input && input.scheduledStart == null)) {
      // Only apply explicit scheduledEnd if we didn't already clear it above (unschedule path)
      updates.scheduledEnd = input.scheduledEnd;
    }
    if ("isAllDay" in input) updates.isAllDay = input.isAllDay;
    if ("visitNumber" in input) updates.visitNumber = input.visitNumber;
    if ("assignedTechnicianIds" in input) updates.assignedTechnicianIds = input.assignedTechnicianIds;
    if ("equipmentIds" in input) updates.equipmentIds = input.equipmentIds;

    // 4) Compute scheduledEnd when we have a start but no explicit end yet
    // Skip if scheduledStart was explicitly cleared (unschedule path already handled above)
    const startWasCleared = "scheduledStart" in input && input.scheduledStart == null;
    const finalStart = startWasCleared ? null : (updates.scheduledStart ?? existing.scheduledStart);
    if (finalStart && !("scheduledEnd" in updates)) {
      const isAllDay = updates.isAllDay ?? existing.isAllDay ?? false;
      const duration = updates.estimatedDurationMinutes ?? existing.estimatedDurationMinutes ?? 60;
      if (isAllDay) {
        const d = finalStart instanceof Date ? finalStart : new Date(finalStart);
        const endOfDay = new Date(d);
        endOfDay.setUTCHours(23, 59, 59, 0);
        updates.scheduledEnd = endOfDay;
      } else {
        const startMs = finalStart instanceof Date ? finalStart.getTime() : new Date(finalStart).getTime();
        updates.scheduledEnd = new Date(startMs + Number(duration) * 60_000);
      }
    }

    const [updated] = await db
      .update(jobVisits)
      .set(updates)
      // 2026-03-18: SQL-level soft-delete guard — defense-in-depth alongside getJobVisit() prefetch
      .where(and(
        eq(jobVisits.id, visitId),
        eq(jobVisits.companyId, companyId),
        activeVisitGuard()
      ))
      .returning();

    // Step 2.4: Sync job schedule from visits after update
    await this.syncJobScheduleFromVisits(companyId, existing.jobId);

    return updated;
  }

  /**
   * Delete job visit (soft delete)
   * Part 4: Calls mirrorNextVisitToJob after soft delete
   */
  async deleteJobVisit(companyId: string, visitId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(visitId, "visitId");

    // Part 4: Fetch visit first to get jobId for mirroring
    const existing = await this.getJobVisit(companyId, visitId);
    if (!existing) {
      throw this.notFoundError("Visit");
    }

    const [deleted] = await db
      .update(jobVisits)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(jobVisits.id, visitId), eq(jobVisits.companyId, companyId)))
      .returning();

    if (!deleted) {
      throw this.notFoundError("Visit");
    }

    // Step 2.4: Sync job schedule from visits after delete
    await this.syncJobScheduleFromVisits(companyId, deleted.jobId);

    return { success: true };
  }

  /**
   * Update visit status with auto timestamps
   * Part 4: Calls mirrorNextVisitToJob after status change
   */
  async updateJobVisitStatus(companyId: string, visitId: string, status: string, options?: { skipSync?: boolean }) {
    const existing = await this.getJobVisit(companyId, visitId);
    if (!existing) {
      throw this.notFoundError("Visit");
    }

    const updates: any = {
      status,
      updatedAt: new Date(),
      version: existing.version + 1,
    };

    // Auto-set checkedInAt when office sets status to on_site (manual status flow).
    // This is the canonical check-in path for the office status endpoint.
    if (status === "on_site" && !existing.checkedInAt) {
      updates.checkedInAt = new Date();
    }

    // 2026-03-20: Removed unreachable completed-status auto-timestamp branch.
    // Visit completion is canonically owned by the orchestrator (COMPLETE_VISIT intent).
    // The route at jobVisits.routes.ts:224 rejects status="completed" before reaching here.
    // The only other caller (cancelVisit) passes "cancelled". No path can trigger completed.

    const [updated] = await db
      .update(jobVisits)
      .set(updates)
      // 2026-03-18: SQL-level soft-delete guard — defense-in-depth alongside getJobVisit() prefetch
      .where(and(
        eq(jobVisits.id, visitId),
        eq(jobVisits.companyId, companyId),
        activeVisitGuard()
      ))
      .returning();

    // Step 2.4: Sync job schedule from visits after status change
    // 2026-03-18: skipSync allows completion paths to reconcile job FIRST, then sync
    if (!options?.skipSync) {
      await this.syncJobScheduleFromVisits(companyId, existing.jobId);
    }

    return updated;
  }

  // Labor unification: checkInJobVisit() REMOVED — manager check-in now uses
  // lifecycle.startVisit() + timeTrackingRepository.recordJobStatus() in the route handler.
  // The old method set status="on_site" which was inconsistent with the lifecycle's "in_progress".

  // 2026-03-18: checkOutJobVisit() DELETED — check-out is now metadata-only (recorded
  // via updateJobVisit in the route handler). Visit completion goes through the
  // canonical lifecycle orchestrator's COMPLETE_VISIT intent.
  /**
   * Get uncompleted visits for a job.
   * Uncompleted = is_active=true AND status NOT IN ('completed','cancelled').
   * Used by close-job guardrail to detect visits that need resolution.
   */
  async getUncompletedVisits(companyId: string, jobId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    // 2026-03-18: Uses canonical predicate from visitPredicates.ts
    return db
      .select()
      .from(jobVisits)
      .where(uncompletedVisitFilter(companyId, jobId))
      .orderBy(asc(jobVisits.visitNumber));
  }

  // 2026-03-18: bulkCompleteVisits() DELETED — the orchestrator's BULK_COMPLETE_VISITS
  // intent now owns this logic and writes structured outcome fields (outcome, completedAt,
  // isFollowUpNeeded) that the old helper omitted.
}

export const jobVisitsRepository = new JobVisitsRepository();

/**
 * SPAWN-ON-ACTION: Determine if a visit has been "actioned" (work has begun).
 *
 * A visit is considered actioned if ANY of these conditions are true:
 * - checkedInAt is set (technician checked in)
 * - checkedOutAt is set (technician checked out)
 * - status has progressed beyond 'scheduled' (dispatched, en_route, on_site, in_progress, on_hold, completed)
 *
 * Note: visitNotes alone does NOT trigger actioned status (adding notes before starting is common).
 *
 * When a visit is actioned, reschedule operations should create a new visit
 * rather than updating the existing one (preserving history).
 */
export function isVisitActioned(visit: {
  checkedInAt?: Date | null;
  checkedOutAt?: Date | null;
  status: string;
}): boolean {
  // Strong signals: operational timestamps
  if (visit.checkedInAt) return true;
  if (visit.checkedOutAt) return true;
  // Labor unification: actualDurationMinutes removed — redundant with checkedInAt check above.
  // If duration > 0, checkedInAt was necessarily set, so line above already returns true.

  // Status progression signals (anything beyond 'scheduled' means work has started)
  const ACTIONED_STATUSES = [
    'dispatched',
    'en_route',
    'on_site',
    'in_progress',
    'on_hold',
    'completed',
  ];
  if (ACTIONED_STATUSES.includes(visit.status)) return true;

  return false;
}

/**
 * Inverse of isVisitActioned — returns true if the visit has no meaningful activity.
 * An empty visit can be silently replaced when scheduling a new visit for the same job.
 *
 * NOTE: When visit-level checklists, expenses, or attachments are added to the schema
 * in the future, those checks should be incorporated here (and in isVisitActioned).
 */
export function isVisitEmpty(visit: {
  checkedInAt?: Date | null;
  checkedOutAt?: Date | null;
  status: string;
}): boolean {
  return !isVisitActioned(visit);
}
