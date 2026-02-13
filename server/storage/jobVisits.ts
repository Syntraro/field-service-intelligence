import { db } from "../db";
import { and, eq, desc, gte, lte, asc, sql, notInArray, isNull } from "drizzle-orm";
import { activeJobFilter } from "./jobFilters";
import { jobVisits, jobs, jobNotes, users, clientLocations } from "@shared/schema";
import { BaseRepository, clampLimit } from "./base";

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
      eq(jobVisits.isActive, true), // Soft delete filter
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

    const rows = await db
      .select()
      .from(jobVisits)
      .where(
        and(
          eq(jobVisits.companyId, companyId),
          eq(jobVisits.jobId, jobId)
          // NO isActive filter - include all for history
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
          eq(jobVisits.isActive, true) // Soft delete filter
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

    const EXCLUDED: string[] = ["cancelled", "completed"];
    const now = new Date();

    // Pull all eligible visits for this job
    const visitRows = await db
      .select()
      .from(jobVisits)
      .where(
        and(
          eq(jobVisits.companyId, companyId),
          eq(jobVisits.jobId, jobId),
          eq(jobVisits.isActive, true),
          sql`${jobVisits.scheduledStart} IS NOT NULL`,
          notInArray(jobVisits.status, EXCLUDED)
        )
      )
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
  // CANONICAL ENRICHED QUERIES — shared by tech field + calendar consumers
  // ========================================================================

  /**
   * Get visits assigned to a user within a date range, enriched with job + location.
   * Used by: /api/tech/visits/today, tech schedule page.
   * Filters: companyId, isActive, scheduledStart in [start, end], assigned to userId.
   */
  async getVisitsForUserInRange(
    companyId: string,
    userId: string,
    start: Date,
    end: Date
  ): Promise<EnrichedVisit[]> {
    this.assertCompanyId(companyId);

    const rows = await db
      .select({
        visit: jobVisits,
        jobId: jobs.id,
        jobNumber: jobs.jobNumber,
        jobSummary: jobs.summary,
        jobType: jobs.jobType,
        jobDescription: jobs.description,
        jobPriority: jobs.priority,
        locationId: clientLocations.id,
        locationCompanyName: clientLocations.companyName,
        locationLocation: clientLocations.location,
        locationAddress: clientLocations.address,
        locationCity: clientLocations.city,
        locationProvince: clientLocations.province,
        locationPostalCode: clientLocations.postalCode,
        locationPhone: clientLocations.phone,
      })
      .from(jobVisits)
      .innerJoin(jobs, eq(jobVisits.jobId, jobs.id))
      .leftJoin(clientLocations, eq(jobs.locationId, clientLocations.id))
      .where(
        and(
          eq(jobVisits.companyId, companyId),
          eq(jobVisits.isActive, true),
          gte(jobVisits.scheduledStart, start),
          lte(jobVisits.scheduledStart, end),
          sql`(${jobVisits.assignedTechnicianId} = ${userId} OR ${userId} = ANY(${jobVisits.assignedTechnicianIds}))`
        )
      )
      .orderBy(asc(jobVisits.scheduledStart));

    return rows.map((r) => ({
      ...r.visit,
      job: {
        id: r.jobId,
        jobNumber: r.jobNumber,
        summary: r.jobSummary,
        jobType: r.jobType,
        description: r.jobDescription,
        priority: r.jobPriority,
      },
      location: r.locationId
        ? {
            id: r.locationId,
            companyName: r.locationCompanyName,
            location: r.locationLocation,
            address: r.locationAddress,
            city: r.locationCity,
            province: r.locationProvince,
            postalCode: r.locationPostalCode,
            phone: r.locationPhone,
          }
        : null,
    }));
  }

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
          eq(jobVisits.isActive, true)
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
          eq(jobVisits.isActive, true)
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

    // Consider these visit statuses as "not scheduled"
    const EXCLUDED: string[] = ["cancelled", "completed"];

    // Pull candidate visits for this job
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
      .where(
        and(
          eq(jobVisits.companyId, companyId),
          eq(jobVisits.jobId, jobId),
          eq(jobVisits.isActive, true),
          // scheduled_start must exist
          sql`${jobVisits.scheduledStart} IS NOT NULL`,
          // exclude terminal visit states
          notInArray(jobVisits.status, EXCLUDED)
        )
      )
      .orderBy(asc(jobVisits.scheduledStart));

    if (!visitRows.length) {
      // UNSCHEDULE BRANCH: No eligible visits exist (all cancelled/completed or none created).
      // We clear ALL mirrored fields including technician assignments because:
      // - The job's schedule fields are a mirror of the "next visit", not independent data
      // - When there's nothing to mirror, we reset to unscheduled state
      // This is transitional until calendar moves fully to job_visits (Model B).
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

    await db
      .update(jobs)
      .set({
        scheduledStart,
        scheduledEnd,
        isAllDay,
        durationMinutes,
        primaryTechnicianId,
        assignedTechnicianIds,
        updatedAt: new Date(),
        version: sql`${jobs.version} + 1`,
      })
      .where(and(eq(jobs.companyId, companyId), eq(jobs.id, jobId)));
  }

  /**
   * Compute next visit number for a job (max active + 1)
   */
  private async getNextVisitNumber(companyId: string, jobId: string): Promise<number> {
    const [row] = await db
      .select({ maxVisit: sql<number>`COALESCE(MAX(${jobVisits.visitNumber}), 0)` })
      .from(jobVisits)
      .where(
        and(
          eq(jobVisits.companyId, companyId),
          eq(jobVisits.jobId, jobId),
          eq(jobVisits.isActive, true)
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
      const end = new Date(scheduledStart);
      end.setHours(23, 59, 59, 0);
      scheduledEnd = end;
    } else {
      scheduledEnd = new Date(scheduledStart.getTime() + estimatedDurationMinutes * 60_000);
    }

    // Part 2: assignedTechnicianIds fallback from single assignedTechnicianId
    const assignedTechnicianIds =
      input.assignedTechnicianIds ??
      (input.assignedTechnicianId ? [input.assignedTechnicianId] : null);

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

    // Existing fields
    if ("scheduledDate" in input) updates.scheduledDate = input.scheduledDate;
    if ("estimatedDurationMinutes" in input)
      updates.estimatedDurationMinutes = input.estimatedDurationMinutes;
    if ("assignedTechnicianId" in input)
      updates.assignedTechnicianId = input.assignedTechnicianId;
    if ("status" in input) updates.status = input.status;
    if ("visitNotes" in input) updates.visitNotes = input.visitNotes;
    if ("isActive" in input) updates.isActive = input.isActive;

    // Part 2: New schedule fields
    if ("scheduledStart" in input) updates.scheduledStart = input.scheduledStart;
    if ("scheduledEnd" in input) updates.scheduledEnd = input.scheduledEnd;
    if ("isAllDay" in input) updates.isAllDay = input.isAllDay;
    if ("visitNumber" in input) updates.visitNumber = input.visitNumber;
    if ("assignedTechnicianIds" in input) updates.assignedTechnicianIds = input.assignedTechnicianIds;

    const [updated] = await db
      .update(jobVisits)
      .set(updates)
      .where(and(eq(jobVisits.id, visitId), eq(jobVisits.companyId, companyId)))
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
  async updateJobVisitStatus(companyId: string, visitId: string, status: string) {
    const existing = await this.getJobVisit(companyId, visitId);
    if (!existing) {
      throw this.notFoundError("Visit");
    }

    const updates: any = {
      status,
      updatedAt: new Date(),
      version: existing.version + 1,
    };

    // Auto-set timestamps based on status transitions
    if (status === "on_site" && !existing.checkedInAt) {
      updates.checkedInAt = new Date();
    }

    if (status === "completed" && existing.checkedInAt && !existing.checkedOutAt) {
      const checkOutTime = new Date();
      updates.checkedOutAt = checkOutTime;
      const durationMs = checkOutTime.getTime() - new Date(existing.checkedInAt).getTime();
      updates.actualDurationMinutes = Math.round(durationMs / 60000);
    }

    const [updated] = await db
      .update(jobVisits)
      .set(updates)
      .where(and(eq(jobVisits.id, visitId), eq(jobVisits.companyId, companyId)))
      .returning();

    // Step 2.4: Sync job schedule from visits after status change
    await this.syncJobScheduleFromVisits(companyId, existing.jobId);

    return updated;
  }

  /**
   * Check in to a visit
   */
  async checkInJobVisit(companyId: string, visitId: string) {
    const existing = await this.getJobVisit(companyId, visitId);
    if (!existing) {
      throw this.notFoundError("Visit");
    }

    if (existing.checkedInAt) {
      return existing; // Already checked in
    }

    const [updated] = await db
      .update(jobVisits)
      .set({
        checkedInAt: new Date(),
        status: "on_site",
        updatedAt: new Date(),
        version: existing.version + 1,
      })
      .where(and(eq(jobVisits.id, visitId), eq(jobVisits.companyId, companyId)))
      .returning();

    // Step 2.4: Sync job schedule from visits after check-in
    await this.syncJobScheduleFromVisits(companyId, existing.jobId);

    return updated;
  }

  /**
   * Check out from a visit
   */
  async checkOutJobVisit(companyId: string, visitId: string) {
    const existing = await this.getJobVisit(companyId, visitId);
    if (!existing) {
      throw this.notFoundError("Visit");
    }

    if (!existing.checkedInAt) {
      throw this.validationError("Cannot check out before checking in");
    }

    if (existing.checkedOutAt) {
      return existing; // Already checked out
    }

    const checkOutTime = new Date();
    const durationMs = checkOutTime.getTime() - new Date(existing.checkedInAt).getTime();
    const actualDurationMinutes = Math.round(durationMs / 60000);

    const [updated] = await db
      .update(jobVisits)
      .set({
        checkedOutAt: checkOutTime,
        actualDurationMinutes,
        status: "completed",
        updatedAt: new Date(),
        version: existing.version + 1,
      })
      .where(and(eq(jobVisits.id, visitId), eq(jobVisits.companyId, companyId)))
      .returning();

    // Step 2.4: Sync job schedule from visits after check-out
    await this.syncJobScheduleFromVisits(companyId, existing.jobId);

    return updated;
  }
  /**
   * Get uncompleted visits for a job.
   * Uncompleted = is_active=true AND status NOT IN ('completed','cancelled').
   * Used by close-job guardrail to detect visits that need resolution.
   */
  async getUncompletedVisits(companyId: string, jobId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    const TERMINAL: string[] = ["completed", "cancelled"];
    return db
      .select()
      .from(jobVisits)
      .where(
        and(
          eq(jobVisits.companyId, companyId),
          eq(jobVisits.jobId, jobId),
          eq(jobVisits.isActive, true),
          notInArray(jobVisits.status, TERMINAL)
        )
      )
      .orderBy(asc(jobVisits.visitNumber));
  }

  /**
   * Bulk-complete uncompleted visits for a job.
   * Sets status='completed', checkedOutAt=now(), actualDurationMinutes (if checkedInAt exists).
   * Used by close-job with autoCompleteOpenVisits=true.
   */
  async bulkCompleteVisits(companyId: string, jobId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    const uncompleted = await this.getUncompletedVisits(companyId, jobId);
    if (!uncompleted.length) return [];

    const now = new Date();
    const completed = [];

    for (const visit of uncompleted) {
      const updates: any = {
        status: "completed",
        checkedOutAt: now,
        updatedAt: now,
        version: visit.version + 1,
      };
      // Compute duration if checkedInAt exists (matches existing transition logic)
      if (visit.checkedInAt) {
        const durationMs = now.getTime() - new Date(visit.checkedInAt).getTime();
        updates.actualDurationMinutes = Math.round(durationMs / 60000);
      }
      const [updated] = await db
        .update(jobVisits)
        .set(updates)
        .where(and(eq(jobVisits.id, visit.id), eq(jobVisits.companyId, companyId)))
        .returning();
      completed.push(updated);
    }

    // Sync job schedule after bulk completion
    await this.syncJobScheduleFromVisits(companyId, jobId);
    return completed;
  }
}

export const jobVisitsRepository = new JobVisitsRepository();

/**
 * SPAWN-ON-ACTION: Determine if a visit has been "actioned" (work has begun).
 *
 * A visit is considered actioned if ANY of these conditions are true:
 * - checkedInAt is set (technician checked in)
 * - checkedOutAt is set (technician checked out)
 * - actualDurationMinutes is set (time was tracked)
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
  actualDurationMinutes?: number | null;
  status: string;
}): boolean {
  // Strong signals: time tracking fields
  if (visit.checkedInAt) return true;
  if (visit.checkedOutAt) return true;
  if (visit.actualDurationMinutes && visit.actualDurationMinutes > 0) return true;

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
