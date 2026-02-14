import { db } from "../db";
import { eq, and, gte, lte, sql, desc, asc, or, lt, isNull } from "drizzle-orm";
import { validate as isUUID } from "uuid";
import {
  jobs,
  jobParts,
  jobEquipment,
  jobVisits,
  locationEquipment,
  recurringJobSeries,
  recurringJobPhases,
  companyCounters,
  clients,
  customerCompanies,
  jobStatusEvents,
  jobScheduleAudit,
  users,
} from "@shared/schema";
import type { InsertJob, Job, InsertJobPart, JobPart, InsertJobStatusEvent, JobStatusEvent } from "@shared/schema";
import { BaseRepository } from "./base";
import { sanitizeAllDayTimestamps } from "../utils/allDaySanitizer";
import { IS_DEV } from "../utils/devFlags";
import { resolveTechnicianName } from "../lib/resolveTechnicianName";
import { encodeCursor, decodeCursor } from "../utils/cursor";
import type { PaginationParams } from "../utils/pagination";
import type { PaginatedResult } from "./types";
import {
  applyLifecycleTransition,
  LifecycleTransitionError,
  type LifecycleIntent,
  type TransitionActor,
} from "../domain/jobLifecycle";

interface JobFilters {
  status?: string;
  technicianId?: string;
  locationId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
}

/**
 * Options for operations that can be overridden by manager/admin
 */
export interface JobMutationOptions {
  /**
   * If true, allows mutation even if job is invoiced.
   * Only manager/admin routes should pass this option.
   */
  overrideInvoiceLock?: boolean;
  /**
   * If true, this is a scheduling update and version should be incremented.
   * If false/undefined, version is not touched for non-scheduling updates.
   */
  isSchedulingUpdate?: boolean;
}

/**
 * Status values that indicate a job is locked for billing-related edits
 */
const INVOICED_STATUSES = ["invoiced"] as const;

export class JobRepository extends BaseRepository {

  /**
   * Convert date string fields to Date objects
   * Handles the common date fields in job data
   */
  private normalizeDateFields(data: any): any {
    const result = { ...data };

    // Convert date strings to Date objects for these fields
    const dateFields = ['scheduledStart', 'scheduledEnd', 'actualStart', 'actualEnd'];

    for (const field of dateFields) {
      if (result[field] && typeof result[field] === 'string') {
        result[field] = new Date(result[field]);
      }
    }

    return result;
  }

  /**
   * POST-INVOICE IMMUTABILITY GUARD
   *
   * Checks if a job is in an invoiced state and throws a 409 Conflict error
   * if mutations are attempted without override permission.
   *
   * @param companyId - Company ID for tenant isolation
   * @param jobId - Job ID to check
   * @param options - Mutation options (may include override flag)
   * @throws 409 Conflict if job is invoiced and override not set
   */
  private async assertJobNotInvoiced(
    companyId: string,
    jobId: string,
    options?: JobMutationOptions
  ): Promise<void> {
    // If override is set (manager/admin), skip the check
    if (options?.overrideInvoiceLock) {
      return;
    }

    const job = await this.getJob(companyId, jobId);
    if (!job) {
      throw this.notFoundError("Job");
    }

    if (INVOICED_STATUSES.includes(job.status as any)) {
      const err = new Error("Job is invoiced; edits are locked. Contact a manager to unlock.");
      (err as any).statusCode = 409;
      (err as any).code = "JOB_INVOICED_LOCKED";
      throw err;
    }
  }

  /**
   * Check if a job is invoiced (without throwing)
   */
  async isJobInvoiced(companyId: string, jobId: string): Promise<boolean> {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    const job = await this.getJob(companyId, jobId);
    if (!job) return false;

    return INVOICED_STATUSES.includes(job.status as any);
  }

  /**
   * Get next job number for company
   */
  private async getNextJobNumber(companyId: string): Promise<number> {
    return await db.transaction(async (tx) => {
      // Get or create counter
      let counter = await tx.query.companyCounters.findFirst({
        where: eq(companyCounters.companyId, companyId),
      });

      if (!counter) {
        // Create initial counter with 6-digit job numbers
        const [created] = await tx
          .insert(companyCounters)
          .values({ companyId, nextJobNumber: 100000, nextInvoiceNumber: 1001 })
          .returning();
        counter = created;
      }

      const jobNumber = counter.nextJobNumber;

      // Increment for next time
      await tx
        .update(companyCounters)
        .set({ nextJobNumber: jobNumber + 1 })
        .where(eq(companyCounters.companyId, companyId));

      return jobNumber;
    });
  }




  /**
   * Get jobs with optional filters (paginated)
   * Supports cursor-based or offset-based pagination
   * Order: createdAt DESC, id DESC (stable cursor ordering)
   */
  async getJobs(companyId: string, filters?: JobFilters, pagination?: PaginationParams): Promise<PaginatedResult<any>> {
    this.assertCompanyId(companyId);

    const limit = pagination?.limit ?? 50;
    const { cursor, offset } = pagination ?? {};
    const fetchLimit = limit + 1;

    const selectFields = {
      id: jobs.id,
      companyId: jobs.companyId,
      locationId: jobs.locationId,
      jobNumber: jobs.jobNumber,
      primaryTechnicianId: jobs.primaryTechnicianId,
      assignedTechnicianIds: jobs.assignedTechnicianIds,
      status: jobs.status,
      priority: jobs.priority,
      jobType: jobs.jobType,
      summary: jobs.summary,
      description: jobs.description,
      accessInstructions: jobs.accessInstructions,
      scheduledStart: jobs.scheduledStart,
      scheduledEnd: jobs.scheduledEnd,
      actualStart: jobs.actualStart,
      actualEnd: jobs.actualEnd,
      invoiceId: jobs.invoiceId,
      qboInvoiceId: jobs.qboInvoiceId,
      billingNotes: jobs.billingNotes,
      recurringSeriesId: jobs.recurringSeriesId,
      // REMOVED: calendarAssignmentId (Model A - scheduling on jobs table)
      isActive: jobs.isActive,
      version: jobs.version,
      createdAt: jobs.createdAt,
      updatedAt: jobs.updatedAt,
      // Enriched location fields for frontend compatibility
      // Use parent company name if available, otherwise fall back to location's companyName
      locationCompanyName: sql<string>`COALESCE(${customerCompanies.name}, ${clients.companyName})`,
      locationName: clients.location,
      locationCity: clients.city,
      locationAddress: clients.address,
      location: {
        id: clients.id,
        companyName: clients.companyName,
        location: clients.location,
        address: clients.address,
        city: clients.city,
        province: clients.province,
        postalCode: clients.postalCode,
      }
    };

    let query = db
      .select(selectFields)
      .from(jobs)
      .leftJoin(clients, eq(jobs.locationId, clients.id))
      .leftJoin(customerCompanies, eq(clients.parentCompanyId, customerCompanies.id))
      .where(
        and(
          eq(jobs.companyId, companyId),
          // SOFT DELETE + DEACTIVATION: Always exclude deleted/deactivated jobs
          isNull(jobs.deletedAt),
          eq(jobs.isActive, true)
        )
      )
      .$dynamic();

    if (filters?.status) {
      query = query.where(eq(jobs.status, filters.status));
    }

    if (filters?.locationId) {
      this.validateUUID(filters.locationId, "locationId");
      query = query.where(eq(jobs.locationId, filters.locationId));
    }

    if (filters?.technicianId) {
      this.validateUUID(filters.technicianId, "technicianId");
      query = query.where(
        sql`${filters.technicianId} = ANY(${jobs.assignedTechnicianIds})`
      );
    }

    if (filters?.startDate) {
      const startDate = new Date(filters.startDate);
      if (!isNaN(startDate.getTime())) {
        query = query.where(gte(jobs.scheduledStart, startDate));
      }
    }

    if (filters?.endDate) {
      const endDate = new Date(filters.endDate);
      if (!isNaN(endDate.getTime())) {
        query = query.where(lte(jobs.scheduledStart, endDate));
      }
    }

    if (cursor) {
      const { createdAtISO, id: cursorId } = decodeCursor(cursor);
      const cursorDate = new Date(createdAtISO);
      query = query.where(
        or(
          lt(jobs.createdAt, cursorDate),
          and(eq(jobs.createdAt, cursorDate), lt(jobs.id, cursorId))
        )
      );
    }

    query = query
      .orderBy(desc(jobs.createdAt), desc(jobs.id))
      .limit(fetchLimit);

    if (offset !== undefined && !cursor) {
      query = query.offset(offset);
    }

    const rows = await query;
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    const meta: PaginatedResult<any>["meta"] = { limit, hasMore };

    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      if (cursor !== undefined || offset === undefined) {
        meta.nextCursor = encodeCursor(
          (lastItem.createdAt as Date).toISOString(),
          lastItem.id
        );
      } else {
        meta.nextOffset = offset + limit;
      }
    }

    return { items, meta };
  }

  /**
   * Get single job with location data
   */
  async getJob(companyId: string, jobId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    const rows = await db
      .select({
        // All job fields
        id: jobs.id,
        companyId: jobs.companyId,
        locationId: jobs.locationId,
        jobNumber: jobs.jobNumber,
        primaryTechnicianId: jobs.primaryTechnicianId,
        assignedTechnicianIds: jobs.assignedTechnicianIds,
        status: jobs.status,
        priority: jobs.priority,
        jobType: jobs.jobType,
        summary: jobs.summary,
        description: jobs.description,
        accessInstructions: jobs.accessInstructions,
        scheduledStart: jobs.scheduledStart,
        scheduledEnd: jobs.scheduledEnd,
        actualStart: jobs.actualStart,
        actualEnd: jobs.actualEnd,
        // Travel tracking fields
        travelStartedAt: jobs.travelStartedAt,
        arrivedOnSiteAt: jobs.arrivedOnSiteAt,
        invoiceId: jobs.invoiceId,
        qboInvoiceId: jobs.qboInvoiceId,
        billingNotes: jobs.billingNotes,
        recurringSeriesId: jobs.recurringSeriesId,
        // REMOVED: calendarAssignmentId (Model A - scheduling on jobs table)
        // Hold state fields (new system)
        holdReason: jobs.holdReason,
        holdNotes: jobs.holdNotes,
        nextActionDate: jobs.nextActionDate,
        onHoldAt: jobs.onHoldAt,
        // Legacy action required fields (kept for backward compatibility)
        actionRequiredReason: jobs.actionRequiredReason,
        actionRequiredNotes: jobs.actionRequiredNotes,
        actionRequiredAt: jobs.actionRequiredAt,
        actionRequiredEscalatedAt: jobs.actionRequiredEscalatedAt,
        // Undo close support
        previousStatus: jobs.previousStatus,
        closedAt: jobs.closedAt,
        closedBy: jobs.closedBy,
        isActive: jobs.isActive,
        version: jobs.version,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
        // Add location data
        location: {
          id: clients.id,
          companyName: clients.companyName,
          location: clients.location,
          address: clients.address,
          city: clients.city,
          province: clients.province,
          postalCode: clients.postalCode,
        }
      })
      .from(jobs)
      .leftJoin(clients, eq(jobs.locationId, clients.id))
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.companyId, companyId),
          // SOFT DELETE + DEACTIVATION: Exclude deleted/deactivated jobs
          isNull(jobs.deletedAt),
          eq(jobs.isActive, true)
        )
      )
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Create job with auto-generated job number.
   * Atomically creates an initial visit so the job is immediately visible
   * on calendar / dashboard surfaces.
   *
   * Visit scheduling logic:
   *   - scheduledStart present → "scheduled" visit with matching start/end/isAllDay
   *   - scheduledStart absent  → "scheduled" visit with scheduledDate = now (unscheduled placeholder)
   * Technician assignment is forwarded from job payload when present.
   */
  async createJob(companyId: string, jobData: InsertJob): Promise<Job> {
    this.assertCompanyId(companyId);

    const jobNumber = await this.getNextJobNumber(companyId);

    // Normalize date strings to Date objects
    const normalizedData = this.normalizeDateFields(jobData);

    // Sanitize all-day timestamps for UTC-safe DB write (prevents constraint violation)
    sanitizeAllDayTimestamps(normalizedData, normalizedData.id ?? 'new-job');

    const job = await db.transaction(async (tx) => {
      // 1. Insert the job row
      const [createdJob] = await tx
        .insert(jobs)
        .values({
          ...normalizedData,
          companyId,
          jobNumber,
        })
        .returning();

      // 2. Build initial visit from job scheduling fields
      const hasSchedule = !!createdJob.scheduledStart;
      const isAllDay = Boolean(createdJob.isAllDay);
      const now = new Date();

      let visitStart: Date;
      let visitEnd: Date;

      if (hasSchedule) {
        visitStart = new Date(createdJob.scheduledStart as any);
        if (createdJob.scheduledEnd) {
          visitEnd = new Date(createdJob.scheduledEnd as any);
        } else if (isAllDay) {
          const end = new Date(visitStart);
          end.setHours(23, 59, 59, 0);
          visitEnd = end;
        } else {
          const durationMs = (createdJob.durationMinutes ?? 60) * 60_000;
          visitEnd = new Date(visitStart.getTime() + durationMs);
        }
      } else {
        // Unscheduled job: use current timestamp as placeholder for legacy scheduledDate
        visitStart = now;
        visitEnd = now;
      }

      // Forward technician assignment from job payload
      const assignedTechnicianId =
        (normalizedData as any).primaryTechnicianId ?? null;
      const assignedTechnicianIds =
        (normalizedData as any).assignedTechnicianIds ??
        (assignedTechnicianId ? [assignedTechnicianId] : null);

      await tx.insert(jobVisits).values({
        companyId,
        jobId: createdJob.id,
        scheduledDate: visitStart,          // legacy required field
        scheduledStart: hasSchedule ? visitStart : null,
        scheduledEnd: hasSchedule ? visitEnd : null,
        isAllDay: hasSchedule ? isAllDay : false,
        estimatedDurationMinutes: createdJob.durationMinutes ?? 60,
        assignedTechnicianId,
        assignedTechnicianIds,
        status: "scheduled",
        visitNumber: 1,
      });

      if (IS_DEV) {
        console.log(
          `[createJob] Job #${createdJob.jobNumber} (${createdJob.id}): initial visit created, scheduled=${hasSchedule}`
        );
      }

      return createdJob;
    });

    return job;
  }

 /**
   * Update job with optimistic locking
   * @param currentVersion - Current version from client (for optimistic locking)
   * @param options - Mutation options (can include override for invoiced jobs)
   */
  async updateJob(
    companyId: string,
    jobId: string,
    currentVersion: number | undefined,
    patch: Partial<InsertJob>,
    options?: JobMutationOptions
  ): Promise<Job | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    // POST-INVOICE GUARD: Check if job is invoiced and block certain field changes
    // Status changes to/from invoiced are always allowed for workflow purposes
    const isBillingRelatedUpdate =
      patch.hasOwnProperty('billingNotes') ||
      patch.hasOwnProperty('invoiceId') ||
      patch.hasOwnProperty('qboInvoiceId');

    // Only guard billing-related updates when job is invoiced
    if (isBillingRelatedUpdate) {
      await this.assertJobNotInvoiced(companyId, jobId, options);
    }

    // Normalize date strings to Date objects
    const normalizedPatch = this.normalizeDateFields(patch);

    // Sanitize all-day timestamps for UTC-safe DB write (prevents constraint violation)
    sanitizeAllDayTimestamps(normalizedPatch, jobId);

    // Determine if we should increment version
    // Version only increments for scheduling updates (Task D requirement)
    const shouldIncrementVersion = options?.isSchedulingUpdate === true;

    // If no version provided, skip version check (backward compatibility)
    if (currentVersion === undefined) {
      const updateData: Record<string, unknown> = {
        ...normalizedPatch,
        updatedAt: new Date(),
      };
      // Only increment version for scheduling updates
      if (shouldIncrementVersion) {
        updateData.version = sql`${jobs.version} + 1`;
      }

      const rows = await db
        .update(jobs)
        .set(updateData)
        // Prevent updates to deleted/deactivated jobs
        .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId), isNull(jobs.deletedAt), eq(jobs.isActive, true)))
        .returning();

      return rows[0] ?? null;
    }

    // With version check - optimistic locking (always increment when checking)
    const updateData: Record<string, unknown> = {
      ...normalizedPatch,
      version: sql`${jobs.version} + 1`, // Increment version (required for locking)
      updatedAt: new Date(),
    };

    const rows = await db
      .update(jobs)
      .set(updateData)
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.companyId, companyId),
          eq(jobs.version, currentVersion) // Check version matches!
        )
      )
      .returning();

    if (rows.length === 0) {
      // Either job doesn't exist OR version mismatch
      const existing = await this.getJob(companyId, jobId);
      if (!existing) {
        throw this.notFoundError("Job");
      }

      // Version mismatch
      throw new Error(
        `Job was modified by another user. Please reload and try again. ` +
        `(Expected version: ${currentVersion}, Actual version: ${existing.version})`
      );
    }

    return rows[0];
  }
  /**
   * Update job status (increments version)
   */
  async updateJobStatus(
    companyId: string,
    jobId: string,
    status: string
  ): Promise<Job | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    const updates: any = {
      status,
      version: sql`${jobs.version} + 1`, // Increment version
      updatedAt: new Date()
    };

    // Set timestamps based on status and openSubStatus
    // "in_progress" is now an openSubStatus, not a status
    // "completed" is the terminal status for finished work
    if (status === "completed") {
      // Set end time when job reaches completed state
      updates.actualEnd = new Date();
    }

    const rows = await db
      .update(jobs)
      .set(updates)
      // Prevent status updates to deleted/deactivated jobs
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId), isNull(jobs.deletedAt), eq(jobs.isActive, true)))
      .returning();

    return rows[0] ?? null;
  }

  /**
   * Delete job (soft delete)
   * Sets deletedAt timestamp and increments version for optimistic locking.
   * Also sets isActive = false for legacy compatibility.
   */
  async deleteJob(companyId: string, jobId: string): Promise<boolean> {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    const now = new Date();
    const rows = await db
      .update(jobs)
      .set({
        deletedAt: now,
        isActive: false,
        version: sql`${jobs.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.companyId, companyId),
          // Only delete if not already deleted
          isNull(jobs.deletedAt)
        )
      )
      .returning();

    return rows.length > 0;
  }

  /**
   * Get job parts
   */
  async getJobParts(companyId: string, jobId: string): Promise<JobPart[]> {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    return await db
      .select()
      .from(jobParts)
      .where(and(
        eq(jobParts.companyId, companyId), // Tenant isolation
        eq(jobParts.jobId, jobId),
        eq(jobParts.isActive, true)
      ))
      .orderBy(jobParts.sortOrder);
  }

  /**
   * Create job part
   *
   * POST-INVOICE GUARD: Blocked for invoiced jobs unless override is set.
   *
   * @param options - Mutation options (can include override for invoiced jobs)
   */
  async createJobPart(
    companyId: string,
    jobId: string,
    partData: InsertJobPart,
    options?: JobMutationOptions
  ): Promise<JobPart> {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    // Ensure the job belongs to this company (prevents cross-tenant writes via jobId)
    const job = await this.getJob(companyId, jobId);
    if (!job) {
      throw this.notFoundError("Job");
    }

    // POST-INVOICE GUARD: Check if job is invoiced
    await this.assertJobNotInvoiced(companyId, jobId, options);

    const rows = await db
      .insert(jobParts)
      .values({
        ...partData,
        companyId, // Add tenant isolation
        jobId
      })
      .returning();

    return rows[0];
  }

  /**
   * Update job part
   *
   * POST-INVOICE GUARD: Blocked for invoiced jobs unless override is set.
   *
   * @param options - Mutation options (can include override for invoiced jobs)
   */
  async updateJobPart(
    companyId: string,
    partId: string,
    patch: Partial<InsertJobPart>,
    options?: JobMutationOptions
  ): Promise<JobPart | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(partId, "partId");

    // First, get the part to find its jobId for the invoice lock check
    const [existingPart] = await db
      .select()
      .from(jobParts)
      .where(and(
        eq(jobParts.companyId, companyId),
        eq(jobParts.id, partId)
      ))
      .limit(1);

    if (!existingPart) {
      return null;
    }

    // POST-INVOICE GUARD: Check if job is invoiced
    await this.assertJobNotInvoiced(companyId, existingPart.jobId, options);

    // Direct tenant isolation via companyId column
    const rows = await db
      .update(jobParts)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(
        eq(jobParts.companyId, companyId), // Tenant isolation
        eq(jobParts.id, partId)
      ))
      .returning();

    return rows[0] ?? null;
  }

  /**
   * Delete job part (soft delete)
   *
   * POST-INVOICE GUARD: Blocked for invoiced jobs unless override is set.
   *
   * @param options - Mutation options (can include override for invoiced jobs)
   */
  async deleteJobPart(
    companyId: string,
    partId: string,
    options?: JobMutationOptions
  ): Promise<boolean> {
    this.assertCompanyId(companyId);
    this.validateUUID(partId, "partId");

    // First, get the part to find its jobId for the invoice lock check
    const [existingPart] = await db
      .select()
      .from(jobParts)
      .where(and(
        eq(jobParts.companyId, companyId),
        eq(jobParts.id, partId)
      ))
      .limit(1);

    if (!existingPart) {
      return false;
    }

    // POST-INVOICE GUARD: Check if job is invoiced
    await this.assertJobNotInvoiced(companyId, existingPart.jobId, options);

    // Direct tenant isolation via companyId column
    const rows = await db
      .update(jobParts)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(
        eq(jobParts.companyId, companyId), // Tenant isolation
        eq(jobParts.id, partId)
      ))
      .returning();

    return rows.length > 0;
  }

  /**
   * Reorder job parts
   *
   * POST-INVOICE GUARD: Blocked for invoiced jobs unless override is set.
   *
   * @param options - Mutation options (can include override for invoiced jobs)
   */
  async reorderJobParts(
    companyId: string,
    jobId: string,
    parts: Array<{ id: string; sortOrder: number }>,
    options?: JobMutationOptions
  ): Promise<void> {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    // POST-INVOICE GUARD: Check if job is invoiced
    await this.assertJobNotInvoiced(companyId, jobId, options);

    await db.transaction(async (tx) => {
      for (const part of parts) {
        this.validateUUID(part.id, "partId");
        await tx
          .update(jobParts)
          .set({ sortOrder: part.sortOrder })
          .where(and(
            eq(jobParts.companyId, companyId), // Tenant isolation
            eq(jobParts.id, part.id),
            eq(jobParts.jobId, jobId)
          ));
      }
    });
  }

  /**
   * Create recurring job series with optional phases
   * Automatically creates a default phase if none provided
   */
  async createRecurringJobSeries(companyId: string, data: any) {
    this.assertCompanyId(companyId);

    // Use transaction for atomic series + phases creation
    return await db.transaction(async (tx) => {
      // Create series
      const [series] = await tx
        .insert(recurringJobSeries)
        .values({
          companyId,
          locationId: data.locationId,
          baseSummary: data.baseSummary || data.name || 'Recurring Job',
          baseDescription: data.baseDescription || data.description || null,
          baseJobType: data.baseJobType || 'maintenance',
          basePriority: data.basePriority || 'medium',
          defaultTechnicianId: data.defaultTechnicianId || null,
          startDate: data.startDate || new Date().toISOString().split('T')[0],
          timezone: data.timezone || 'America/Toronto',
          notes: data.notes || null,
          isActive: data.isActive ?? true,
          createdByUserId: data.createdByUserId || null,
        })
        .returning();

      // Create phases - either provided or default
      const phasesToCreate = data.phases && data.phases.length > 0
        ? data.phases.map((phase: any, index: number) => ({
            seriesId: series.id,
            orderIndex: phase.orderIndex ?? phase.phaseOrder ?? index,
            frequency: phase.frequency || 'monthly',
            interval: phase.interval ?? 1,
            occurrences: phase.occurrences || null,
            untilDate: phase.untilDate || null,
          }))
        : [{
            seriesId: series.id,
            orderIndex: 0,
            frequency: 'monthly',
            interval: 1,
            occurrences: null,
            untilDate: null,
          }];

      await tx.insert(recurringJobPhases).values(phasesToCreate);

      return series;
    });
  }

  /**
   * Create a phase within an existing recurring series
   * Validates series ownership before creating phase
   */
  async createRecurringJobPhase(companyId: string, data: any) {
    this.assertCompanyId(companyId);
    this.validateUUID(data.seriesId, 'seriesId');

    // Verify series exists and belongs to company
    const series = await this.getRecurringSeries(companyId, data.seriesId);
    if (!series) {
      throw this.notFoundError('Recurring series');
    }

    // Create phase
    const [phase] = await db
      .insert(recurringJobPhases)
      .values({
        seriesId: data.seriesId,
        orderIndex: data.orderIndex ?? data.phaseOrder ?? 0,
        frequency: data.frequency || 'monthly',
        interval: data.interval ?? 1,
        occurrences: data.occurrences || null,
        untilDate: data.untilDate || null,
      })
      .returning();

    return phase;
  }




  /**
   * Get job equipment
   */
  async getJobEquipment(companyId: string, jobId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    return await db
      .select()
      .from(jobEquipment)
      .where(and(
        eq(jobEquipment.companyId, companyId), // Tenant isolation
        eq(jobEquipment.jobId, jobId)
      ));
  }

  /**
   * Create job equipment link
   *
   * POST-INVOICE GUARD: Blocked for invoiced jobs unless override is set.
   */
  async createJobEquipment(
    companyId: string,
    jobId: string,
    data: { equipmentId: string; notes?: string | null },
    options?: JobMutationOptions
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");
    this.validateUUID(data.equipmentId, "equipmentId");

    const job = await this.getJob(companyId, jobId);
    if (!job) {
      throw this.notFoundError("Job");
    }

    // POST-INVOICE GUARD: Check if job is invoiced
    await this.assertJobNotInvoiced(companyId, jobId, options);

    const rows = await db
      .insert(jobEquipment)
      .values({
        ...data,
        companyId, // Add tenant isolation
        jobId
      })
      .returning();

    return rows[0];
  }

  /**
   * Update job equipment
   *
   * POST-INVOICE GUARD: Blocked for invoiced jobs unless override is set.
   */
  async updateJobEquipment(
    companyId: string,
    jobEquipmentId: string,
    patch: any,
    options?: JobMutationOptions
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobEquipmentId, "jobEquipmentId");

    // First, get the job equipment to find its jobId for the invoice lock check
    const [existing] = await db
      .select()
      .from(jobEquipment)
      .where(and(
        eq(jobEquipment.companyId, companyId),
        eq(jobEquipment.id, jobEquipmentId)
      ))
      .limit(1);

    if (!existing) {
      return null;
    }

    // POST-INVOICE GUARD: Check if job is invoiced
    await this.assertJobNotInvoiced(companyId, existing.jobId, options);

    // Direct tenant isolation via companyId column
    const rows = await db
      .update(jobEquipment)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(
        eq(jobEquipment.companyId, companyId), // Tenant isolation
        eq(jobEquipment.id, jobEquipmentId)
      ))
      .returning();

    return rows[0] ?? null;
  }

  /**
   * Delete job equipment link
   *
   * POST-INVOICE GUARD: Blocked for invoiced jobs unless override is set.
   */
  async deleteJobEquipment(
    companyId: string,
    jobEquipmentId: string,
    options?: JobMutationOptions
  ): Promise<boolean> {
    this.assertCompanyId(companyId);
    this.validateUUID(jobEquipmentId, "jobEquipmentId");

    // First, get the job equipment to find its jobId for the invoice lock check
    const [existing] = await db
      .select()
      .from(jobEquipment)
      .where(and(
        eq(jobEquipment.companyId, companyId),
        eq(jobEquipment.id, jobEquipmentId)
      ))
      .limit(1);

    if (!existing) {
      return false;
    }

    // POST-INVOICE GUARD: Check if job is invoiced
    await this.assertJobNotInvoiced(companyId, existing.jobId, options);

    // Direct tenant isolation via companyId column
    const result = await db
      .delete(jobEquipment)
      .where(and(
        eq(jobEquipment.companyId, companyId), // Tenant isolation
        eq(jobEquipment.id, jobEquipmentId)
      ))
      .returning();

    return result.length > 0;
  }

  /**
   * Get location equipment item
   */
  async getLocationEquipmentItem(companyId: string, equipmentId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(equipmentId, "equipmentId");

    // Direct tenant isolation via companyId column
    const rows = await db
      .select()
      .from(locationEquipment)
      .where(and(
        eq(locationEquipment.companyId, companyId), // Tenant isolation
        eq(locationEquipment.id, equipmentId)
      ))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Get recurring series
   */
  async getRecurringSeries(companyId: string, seriesId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(seriesId, "seriesId");

    const rows = await db
      .select()
      .from(recurringJobSeries)
      .where(
        and(
          eq(recurringJobSeries.id, seriesId),
          eq(recurringJobSeries.companyId, companyId)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Reconcile job-invoice links
   * Ensures job.invoiceId and invoice.jobId are in sync
   */
  async reconcileJobInvoiceLinks(companyId: string, jobId: string) {
    const job = await this.getJob(companyId, jobId);
    if (!job) {
      throw this.notFoundError("Job");
    }

    return {
      jobId: job.id,
      invoiceId: job.invoiceId,
      reconciled: true,
    };
  }

  /**
   * Create a job status event for audit trail
   */
  async createJobStatusEvent(
    companyId: string,
    jobId: string,
    event: InsertJobStatusEvent
  ): Promise<JobStatusEvent> {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    const [inserted] = await db
      .insert(jobStatusEvents)
      .values({
        ...event,
        companyId,
        jobId,
      })
      .returning();

    return inserted;
  }

  /**
   * Atomically update job status and create a status event in a single transaction.
   * This ensures that if either operation fails, both are rolled back.
   *
   * @param companyId - Company ID for tenant isolation
   * @param jobId - Job ID to update
   * @param params - Status change parameters
   * @returns Updated job
   */
  async updateJobStatusWithEvent(
    companyId: string,
    jobId: string,
    params: {
      fromStatus: string;
      toStatus: string;
      changedBy: string | null;
      note?: string | null;
      meta?: Record<string, unknown> | null;
      additionalUpdates?: Record<string, unknown>;
    }
  ): Promise<Job> {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    const { fromStatus, toStatus, changedBy, note, meta, additionalUpdates } = params;

    return await db.transaction(async (tx) => {
      // Step 1: Update job status and any additional fields
      const updatePayload: Record<string, unknown> = {
        status: toStatus,
        ...additionalUpdates,
      };

      // Normalize date fields if any
      const normalizedPayload = this.normalizeDateFields(updatePayload);

      const [updatedJob] = await tx
        .update(jobs)
        .set({
          ...normalizedPayload,
          version: sql`${jobs.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
        .returning();

      if (!updatedJob) {
        throw this.notFoundError("Job");
      }

      // Step 2: Create status event
      await tx
        .insert(jobStatusEvents)
        .values({
          companyId,
          jobId,
          changedBy,
          fromStatus,
          toStatus,
          note: note || null,
          meta: meta || null,
        });

      return updatedJob;
    });
  }

  /**
   * Atomically perform multiple status transitions and log events for each.
   * Used by the close endpoint which may have intermediate states.
   *
   * @param companyId - Company ID for tenant isolation
   * @param jobId - Job ID to update
   * @param transitions - Array of status transitions to perform
   * @param changedBy - User ID who triggered the change
   * @returns Updated job after all transitions
   */
  async updateJobStatusWithMultipleEvents(
    companyId: string,
    jobId: string,
    transitions: Array<{
      fromStatus: string;
      toStatus: string;
      note?: string | null;
      meta?: Record<string, unknown> | null;
      additionalUpdates?: Record<string, unknown>;
    }>,
    changedBy: string | null
  ): Promise<Job> {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    if (transitions.length === 0) {
      throw new Error("At least one transition is required");
    }

    return await db.transaction(async (tx) => {
      let updatedJob: Job | null = null;

      for (const transition of transitions) {
        const { fromStatus, toStatus, note, meta, additionalUpdates } = transition;

        // Update job with the current transition
        const updatePayload: Record<string, unknown> = {
          status: toStatus,
          ...additionalUpdates,
        };

        const normalizedPayload = this.normalizeDateFields(updatePayload);

        const [job] = await tx
          .update(jobs)
          .set({
            ...normalizedPayload,
            version: sql`${jobs.version} + 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
          .returning();

        if (!job) {
          throw this.notFoundError("Job");
        }

        updatedJob = job;

        // Create status event for this transition
        await tx
          .insert(jobStatusEvents)
          .values({
            companyId,
            jobId,
            changedBy,
            fromStatus,
            toStatus,
            note: note || null,
            meta: meta || null,
          });
      }

      return updatedJob!;
    });
  }

  /**
   * Get job status events for audit trail, sorted by changedAt desc
   */
  async getJobStatusEvents(
    companyId: string,
    jobId: string
  ): Promise<JobStatusEvent[]> {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    return db
      .select()
      .from(jobStatusEvents)
      .where(
        and(
          eq(jobStatusEvents.companyId, companyId),
          eq(jobStatusEvents.jobId, jobId)
        )
      )
      .orderBy(desc(jobStatusEvents.changedAt));
  }

  /**
   * Transactionally apply a lifecycle transition to a job.
   *
   * This is the SINGLE entry point for all lifecycle transitions (close, cancel, archive, reopen, undo).
   * It enforces:
   * - RBAC: Only LIFECYCLE_ROLES can perform transitions (403 FORBIDDEN if not)
   * - Optimistic locking: Version must match (409 VERSION_MISMATCH if not)
   * - Audit: All transitions are logged to job_status_events
   * - Schedule clearing: Terminal transitions clear scheduling fields
   *
   * @param companyId - Company ID for tenant isolation
   * @param jobId - Job ID to transition
   * @param expectedVersion - Expected job version for optimistic locking
   * @param intent - The lifecycle intent (CLOSE_JOB, CANCEL_JOB, etc.)
   * @param actor - User performing the transition (for RBAC and audit)
   * @returns Updated job after transition
   * @throws LifecycleTransitionError with code FORBIDDEN (403) if not authorized
   * @throws Error with code VERSION_MISMATCH (409) if version doesn't match
   */
  async transitionJobStatus(
    companyId: string,
    jobId: string,
    expectedVersion: number,
    intent: LifecycleIntent,
    actor: TransitionActor
  ): Promise<Job> {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    // All logic is inside the transaction for atomicity
    return await db.transaction(async (tx) => {
      // Step 1: Load job and verify it exists (exclude deleted)
      const [job] = await tx
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.id, jobId),
            eq(jobs.companyId, companyId),
            // SOFT DELETE + DEACTIVATION: Cannot update status of deleted/deactivated job
            isNull(jobs.deletedAt),
            eq(jobs.isActive, true)
          )
        )
        .limit(1);

      if (!job) {
        throw this.notFoundError("Job");
      }

      // Step 2: Check version BEFORE applying domain logic
      // This prevents RBAC/domain errors from affecting version checking
      if (job.version !== expectedVersion) {
        const err = new Error(
          `Job was modified by another user. Expected version: ${expectedVersion}, actual: ${job.version}`
        );
        (err as any).code = "VERSION_MISMATCH";
        (err as any).statusCode = 409;
        throw err;
      }

      // Step 3: Apply domain logic (includes RBAC check)
      // If RBAC fails, LifecycleTransitionError is thrown and transaction rolls back
      // No version increment or audit happens on RBAC failure
      let transitionResult;
      try {
        transitionResult = applyLifecycleTransition(job, intent, actor);
      } catch (e) {
        if (e instanceof LifecycleTransitionError) {
          // Re-throw RBAC and domain errors as-is (no version/audit)
          throw e;
        }
        throw e;
      }

      const { patch, auditEvents, finalStatus } = transitionResult;

      // Step 4: Update job with patch (includes version increment)
      const normalizedPatch = this.normalizeDateFields(patch);

      const [updatedJob] = await tx
        .update(jobs)
        .set({
          ...normalizedPatch,
          version: sql`${jobs.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
        .returning();

      if (!updatedJob) {
        throw this.notFoundError("Job");
      }

      // Step 5: Insert audit events
      for (const event of auditEvents) {
        await tx.insert(jobStatusEvents).values({
          companyId,
          jobId,
          changedBy: actor.userId,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          note: event.note || null,
          meta: event.meta || null,
        });
      }

      return updatedJob;
    });
  }

  /**
   * Get action required jobs queue for office/dispatch view
   * Sorted by: nextActionDate ASC NULLS LAST, onHoldAt ASC (oldest first)
   * NOTE: This function is kept for backward compatibility, now queries on_hold status
   */
  async getActionRequiredJobs(companyId: string) {
    this.assertCompanyId(companyId);

    return db
      .select({
        id: jobs.id,
        companyId: jobs.companyId,
        locationId: jobs.locationId,
        jobNumber: jobs.jobNumber,
        status: jobs.status,
        priority: jobs.priority,
        jobType: jobs.jobType,
        summary: jobs.summary,
        scheduledStart: jobs.scheduledStart,
        scheduledEnd: jobs.scheduledEnd,
        // New hold fields
        holdReason: jobs.holdReason,
        holdNotes: jobs.holdNotes,
        nextActionDate: jobs.nextActionDate,
        onHoldAt: jobs.onHoldAt,
        // Legacy fields (kept for backward compatibility)
        actionRequiredReason: jobs.actionRequiredReason,
        actionRequiredNotes: jobs.actionRequiredNotes,
        actionRequiredAt: jobs.actionRequiredAt,
        actionRequiredEscalatedAt: jobs.actionRequiredEscalatedAt,
        primaryTechnicianId: jobs.primaryTechnicianId,
        createdAt: jobs.createdAt,
        // Location info
        locationName: clients.location,
        locationCompanyName: sql<string>`COALESCE(${customerCompanies.name}, ${clients.companyName})`,
        locationAddress: clients.address,
        locationCity: clients.city,
      })
      .from(jobs)
      .leftJoin(clients, eq(jobs.locationId, clients.id))
      .leftJoin(customerCompanies, eq(clients.parentCompanyId, customerCompanies.id))
      .where(
        and(
          eq(jobs.companyId, companyId),
          // SOFT DELETE + DEACTIVATION: Exclude deleted/deactivated jobs
          isNull(jobs.deletedAt),
          eq(jobs.isActive, true),
          eq(jobs.status, "open"),
          sql`${jobs.openSubStatus} IN ('on_hold', 'needs_review')`
        )
      )
      .orderBy(
        // nextActionDate ASC NULLS LAST
        sql`${jobs.nextActionDate} ASC NULLS LAST`,
        // onHoldAt ASC (oldest first)
        asc(jobs.onHoldAt)
      );
  }

  /**
   * Get job schedule audit history
   * Returns recent scheduling changes with user info and change summaries
   */
  async getJobScheduleHistory(
    companyId: string,
    jobId: string,
    limit: number = 10
  ): Promise<Array<{
    id: string;
    createdAt: Date;
    contextLabel: string;
    userId: string | null;
    userName: string | null;
    userEmail: string | null;
    oldFields: Record<string, unknown> | null;
    newFields: Record<string, unknown>;
    changeSummary: string;
  }>> {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    const rows = await db
      .select({
        id: jobScheduleAudit.id,
        createdAt: jobScheduleAudit.createdAt,
        contextLabel: jobScheduleAudit.contextLabel,
        userId: jobScheduleAudit.userId,
        oldFields: jobScheduleAudit.oldFields,
        newFields: jobScheduleAudit.newFields,
        // Phase 4 Step B6: select name parts for canonical resolution
        userFullName: users.fullName,
        userFirstName: users.firstName,
        userLastName: users.lastName,
        userEmail: users.email,
      })
      .from(jobScheduleAudit)
      .leftJoin(users, eq(jobScheduleAudit.userId, users.id))
      .where(
        and(
          eq(jobScheduleAudit.companyId, companyId),
          eq(jobScheduleAudit.jobId, jobId)
        )
      )
      .orderBy(desc(jobScheduleAudit.createdAt))
      .limit(limit);

    // Generate change summaries
    return rows.map((row) => {
      const oldFields = row.oldFields as Record<string, unknown> | null;
      const newFields = row.newFields as Record<string, unknown>;

      const summary = this.generateScheduleChangeSummary(oldFields, newFields);

      return {
        id: row.id,
        createdAt: row.createdAt,
        contextLabel: row.contextLabel,
        userId: row.userId,
        // Phase 4 Step B6: canonical tech name resolution
        userName: resolveTechnicianName({
          fullName: row.userFullName,
          firstName: row.userFirstName,
          lastName: row.userLastName,
          email: row.userEmail,
        }),
        userEmail: row.userEmail,
        oldFields,
        newFields,
        changeSummary: summary,
      };
    });
  }

  /**
   * Generate a human-readable summary of schedule changes
   */
  private generateScheduleChangeSummary(
    oldFields: Record<string, unknown> | null,
    newFields: Record<string, unknown>
  ): string {
    const parts: string[] = [];

    const formatTime = (dateStr: unknown): string | null => {
      if (!dateStr) return null;
      try {
        const d = new Date(dateStr as string);
        return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
      } catch {
        return null;
      }
    };

    const formatDate = (dateStr: unknown): string | null => {
      if (!dateStr) return null;
      try {
        const d = new Date(dateStr as string);
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      } catch {
        return null;
      }
    };

    const oldIsAllDay = oldFields?.isAllDay;
    const newIsAllDay = newFields.isAllDay;
    const oldStart = oldFields?.scheduledStart;
    const newStart = newFields.scheduledStart;

    // Check for unschedule (clear)
    if (oldStart && !newStart) {
      return "Unscheduled";
    }

    // Check for initial schedule
    if (!oldStart && newStart) {
      if (newIsAllDay) {
        const dateStr = formatDate(newStart);
        return `Scheduled all-day${dateStr ? ` on ${dateStr}` : ""}`;
      }
      const timeStr = formatTime(newStart);
      const dateStr = formatDate(newStart);
      return `Scheduled${dateStr ? ` ${dateStr}` : ""}${timeStr ? ` at ${timeStr}` : ""}`;
    }

    // Check for all-day toggle
    if (oldIsAllDay !== newIsAllDay) {
      if (newIsAllDay) {
        parts.push("Changed to all-day");
      } else {
        const timeStr = formatTime(newStart);
        parts.push(`Changed to timed${timeStr ? ` at ${timeStr}` : ""}`);
      }
    } else if (oldStart && newStart) {
      // Time/date change
      const oldTime = formatTime(oldStart);
      const newTime = formatTime(newStart);
      const oldDate = formatDate(oldStart);
      const newDate = formatDate(newStart);

      if (oldDate !== newDate) {
        parts.push(`Moved ${oldDate || ""}${newDate ? ` → ${newDate}` : ""}`);
      } else if (oldTime !== newTime && !newIsAllDay) {
        parts.push(`Moved ${oldTime || ""}${newTime ? ` → ${newTime}` : ""}`);
      }
    }

    return parts.length > 0 ? parts.join(", ") : "Schedule updated";
  }
}

export const jobRepository = new JobRepository();
