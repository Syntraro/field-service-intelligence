import { db } from "../db";
import { eq, and, gte, lte, sql, desc, asc, or, lt } from "drizzle-orm";
import { validate as isUUID } from "uuid";
import {
  jobs,
  jobParts,
  jobEquipment,
  locationEquipment,
  recurringJobSeries,
  recurringJobPhases,
  companyCounters,
  clients,
  customerCompanies,
  jobStatusEvents
} from "@shared/schema";
import type { InsertJob, Job, InsertJobPart, JobPart, InsertJobStatusEvent, JobStatusEvent } from "@shared/schema";
import { BaseRepository } from "./base";
import { encodeCursor, decodeCursor } from "../utils/cursor";
import type { PaginationParams } from "../utils/pagination";
import type { PaginatedResult } from "./types";

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
        // Create initial counter
        const [created] = await tx
          .insert(companyCounters)
          .values({ companyId, nextJobNumber: 10000, nextInvoiceNumber: 1001 })
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
      calendarAssignmentId: jobs.calendarAssignmentId,
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
      .where(eq(jobs.companyId, companyId))
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
        invoiceId: jobs.invoiceId,
        qboInvoiceId: jobs.qboInvoiceId,
        billingNotes: jobs.billingNotes,
        recurringSeriesId: jobs.recurringSeriesId,
        calendarAssignmentId: jobs.calendarAssignmentId,
        // Action required fields
        actionRequiredReason: jobs.actionRequiredReason,
        actionRequiredNotes: jobs.actionRequiredNotes,
        nextActionDate: jobs.nextActionDate,
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
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Create job with auto-generated job number
   */
  async createJob(companyId: string, jobData: InsertJob): Promise<Job> {
    this.assertCompanyId(companyId);

    const jobNumber = await this.getNextJobNumber(companyId);

    // Normalize date strings to Date objects
    const normalizedData = this.normalizeDateFields(jobData);

    const rows = await db
      .insert(jobs)
      .values({
        ...normalizedData,
        companyId,
        jobNumber,
      })
      .returning();

    return rows[0];
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

    // If no version provided, skip version check (backward compatibility)
    if (currentVersion === undefined) {
      const rows = await db
        .update(jobs)
        .set({
          ...normalizedPatch,
          version: sql`${jobs.version} + 1`,
          updatedAt: new Date()
        })
        .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
        .returning();

      return rows[0] ?? null;
    }

    // With version check - optimistic locking
    const rows = await db
      .update(jobs)
      .set({
        ...normalizedPatch,
        version: sql`${jobs.version} + 1`, // Increment version
        updatedAt: new Date(),
      })
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

    // Set timestamps based on status
    if (status === "in_progress" || status === "on_site") {
      updates.actualStart = new Date();
    } else if (status === "completed" || status === "requires_invoicing" || status === "closed") {
      // Set end time when job reaches a closed state
      updates.actualEnd = new Date();
    }

    const rows = await db
      .update(jobs)
      .set(updates)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
      .returning();

    return rows[0] ?? null;
  }

  /**
   * Delete job (soft delete)
   */
  async deleteJob(companyId: string, jobId: string): Promise<boolean> {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    const rows = await db
      .update(jobs)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
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
   * Get action required jobs queue for office/dispatch view
   * Sorted by: nextActionDate ASC NULLS LAST, actionRequiredAt ASC (oldest first)
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
        actionRequiredReason: jobs.actionRequiredReason,
        actionRequiredNotes: jobs.actionRequiredNotes,
        nextActionDate: jobs.nextActionDate,
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
          eq(jobs.status, "action_required")
        )
      )
      .orderBy(
        // nextActionDate ASC NULLS LAST
        sql`${jobs.nextActionDate} ASC NULLS LAST`,
        // actionRequiredAt ASC (oldest first)
        asc(jobs.actionRequiredAt)
      );
  }
}

export const jobRepository = new JobRepository();
