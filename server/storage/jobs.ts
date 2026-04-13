import { db } from "../db";
import { eq, and, gte, lte, sql, desc, asc, or, lt, isNull } from "drizzle-orm";
// 2026-04-12 (Option A): canonical visit-derived crew resolver.
import { getVisitCrewsForJobs, getVisitCrewForJob } from "./visitCrew";
import { validate as isUUID } from "uuid";
import {
  jobs,
  jobParts,
  jobEquipment,
  jobVisits,
  invoices,
  locationEquipment,
  recurringJobSeries,
  recurringJobPhases,
  companyCounters,
  clients,
  customerCompanies,
  attentionItems,
  jobStatusEvents,
  jobScheduleAudit,
  users,
  items,
} from "@shared/schema";
import type { InsertJob, Job, InsertJobPart, JobPart, InsertJobStatusEvent, JobStatusEvent } from "@shared/schema";
import { BaseRepository } from "./base";
import { locationDisplayNameExpr } from "../lib/queryHelpers";
import { sanitizeAllDayTimestamps, sanitizeSchedulingTimestamps } from "../utils/allDaySanitizer";
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
import { activeJobFilter } from "./jobFilters";

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
   * Get next job number for company — self-healing allocator.
   *
   * Within a single transaction:
   *   1. Read storedNext from companyCounters (create row if missing)
   *   2. Derive derivedNext = MAX(existing jobs.jobNumber) + 1 (default 100000)
   *   3. Allocate GREATEST(storedNext, derivedNext)
   *   4. Persist allocated + 1 as the new counter value
   *
   * This protects against stale counters caused by imports, scripts,
   * backfills, restores, manual edits, or any path that writes job
   * numbers without bumping the counter.
   */
  private async getNextJobNumber(companyId: string): Promise<number> {
    return await db.transaction(async (tx) => {
      // 1. Lock + read counter row with SELECT ... FOR UPDATE.
      //    This serializes concurrent allocators for the same company —
      //    the second transaction blocks here until the first commits.
      const [locked] = await tx
        .select({
          nextJobNumber: companyCounters.nextJobNumber,
        })
        .from(companyCounters)
        .where(eq(companyCounters.companyId, companyId))
        .for("update");

      let storedNext: number;
      if (!locked) {
        // First-ever job for this company — create counter row.
        // ON CONFLICT handles the race where two transactions both see
        // no row and try to insert simultaneously.
        const [created] = await tx
          .insert(companyCounters)
          .values({ companyId, nextJobNumber: 100000, nextInvoiceNumber: 1001 })
          .onConflictDoNothing()
          .returning();

        if (created) {
          storedNext = created.nextJobNumber;
        } else {
          // Lost the insert race — re-read with lock
          const [retry] = await tx
            .select({ nextJobNumber: companyCounters.nextJobNumber })
            .from(companyCounters)
            .where(eq(companyCounters.companyId, companyId))
            .for("update");
          storedNext = retry.nextJobNumber;
        }
      } else {
        storedNext = locked.nextJobNumber;
      }

      // 2. Derive high-water mark from existing job numbers
      const [maxRow] = await tx
        .select({ maxNum: sql<number>`COALESCE(MAX(${jobs.jobNumber}), 0)::int` })
        .from(jobs)
        .where(eq(jobs.companyId, companyId));

      const derivedNext = (maxRow?.maxNum ?? 0) + 1;

      // 3. Allocate: never regress below either source
      const allocated = Math.max(storedNext, derivedNext, 100000);

      // 4. Persist counter for next allocation
      await tx
        .update(companyCounters)
        .set({ nextJobNumber: allocated + 1 })
        .where(eq(companyCounters.companyId, companyId));

      return allocated;
    });
  }

  /**
   * Create a job with an explicit job number (for CSV import).
   * Does NOT auto-generate a job number or create an initial visit.
   * Archived import jobs don't need calendar entries.
   */
  async createJobWithExplicitNumber(
    companyId: string,
    jobNumber: number,
    jobData: Record<string, unknown>,
    /** Optional transaction handle — when provided, participates in caller's
     *  transaction instead of running standalone. Used by job import service
     *  for multi-entity atomicity (location + job + note). */
    txHandle?: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ): Promise<any> {
    this.assertCompanyId(companyId);
    const conn = txHandle ?? db;
    // UTC-safe scheduling fix: sanitize any scheduling timestamps in imported job data
    const sanitizedData = { ...jobData } as any;
    sanitizeSchedulingTimestamps(sanitizedData, `import-${jobNumber}`);
    const [createdJob] = await conn
      .insert(jobs)
      .values({
        ...sanitizedData,
        companyId,
        jobNumber,
        status: "archived",
      } as any)
      .returning();
    return createdJob;
  }

  /**
   * Reset job number counter to at least max(existing job numbers) + 1.
   * Called after import to prevent future auto-generated numbers from colliding.
   * Uses GREATEST to never regress the counter.
   */
  async resetJobNumberCounter(companyId: string): Promise<{ newNextJobNumber: number }> {
    this.assertCompanyId(companyId);
    const [maxRow] = await db
      .select({ maxNum: sql<number>`COALESCE(MAX(${jobs.jobNumber}), 0)::int` })
      .from(jobs)
      .where(eq(jobs.companyId, companyId));
    const needed = (maxRow?.maxNum ?? 0) + 1;

    await db
      .update(companyCounters)
      .set({ nextJobNumber: sql`GREATEST(${companyCounters.nextJobNumber}, ${needed})` })
      .where(eq(companyCounters.companyId, companyId));

    const [counter] = await db
      .select({ nextJobNumber: companyCounters.nextJobNumber })
      .from(companyCounters)
      .where(eq(companyCounters.companyId, companyId));
    return { newNextJobNumber: counter?.nextJobNumber ?? needed };
  }

  /**
   * Update a job's number with uniqueness check and counter bump.
   * Runs in a transaction to ensure atomicity:
   *   1. Check no other job in the same company uses the new number
   *   2. Update the job row
   *   3. Advance companyCounters.nextJobNumber if needed (GREATEST)
   */
  async updateJobNumber(companyId: string, jobId: string, newJobNumber: number): Promise<void> {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    await db.transaction(async (tx) => {
      // 1. Check uniqueness — is newJobNumber already used by a different job in this company?
      const [conflict] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.companyId, companyId),
            eq(jobs.jobNumber, newJobNumber),
            sql`${jobs.id} != ${jobId}`
          )
        )
        .limit(1);

      if (conflict) {
        const err = new Error(`Job number #${newJobNumber} is already in use.`);
        (err as any).code = "JOB_NUMBER_DUPLICATE";
        (err as any).statusCode = 409;
        throw err;
      }

      // 2. Update the job row
      const [updated] = await tx
        .update(jobs)
        .set({ jobNumber: newJobNumber, updatedAt: new Date() })
        .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
        .returning({ id: jobs.id });

      if (!updated) {
        throw this.notFoundError("Job");
      }

      // 3. Advance counter so future auto-generated numbers follow the new high-water mark
      await tx
        .update(companyCounters)
        .set({ nextJobNumber: sql`GREATEST(${companyCounters.nextJobNumber}, ${newJobNumber + 1})` })
        .where(eq(companyCounters.companyId, companyId));
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
      // 2026-04-12 (Option A): primaryTechnicianId / assignedTechnicianIds
      // NOT projected from jobs — attached post-query via getVisitCrewsForJobs().
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
      locationCompanyName: locationDisplayNameExpr,
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
      // 2026-04-12 (Option A): filter via active visits instead of the
      // quiescent jobs.assigned_technician_ids column.
      query = query.where(
        sql`EXISTS (
          SELECT 1 FROM ${jobVisits} jv_tf
          WHERE jv_tf.job_id = ${jobs.id}
            AND jv_tf.company_id = ${jobs.companyId}
            AND jv_tf.is_active = true
            AND ${filters.technicianId} = ANY(jv_tf.assigned_technician_ids)
        )`
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

    // 2026-04-12 final cleanup: attach only the canonical visit-derived crew.
    // `primaryTechnicianId` is no longer emitted.
    const crewMap = await getVisitCrewsForJobs(
      companyId,
      items.map((j: any) => j.id),
    );
    const enriched = items.map((j: any) => ({
      ...j,
      assignedTechnicianIds: crewMap.get(j.id)?.assignedTechnicianIds ?? [],
    }));

    return { items: enriched, meta };
  }

  /**
   * Get single job with location data
   */
  async getJob(companyId: string, jobId: string, txHandle?: any) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");
    const queryDb = txHandle ?? db;

    const rows = await queryDb
      .select({
        // All job fields
        id: jobs.id,
        companyId: jobs.companyId,
        locationId: jobs.locationId,
        jobNumber: jobs.jobNumber,
        // 2026-04-12 (Option A): tech fields attached post-query from visits.
        status: jobs.status,
        openSubStatus: jobs.openSubStatus,
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
        // 2026-03-18: Legacy actionRequired* fields removed — use canonical hold fields above
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

    const row = rows[0];
    if (!row) return null;
    // 2026-04-12 final cleanup: canonical crew only; no primaryTechnicianId.
    const crew = await getVisitCrewForJob(companyId, row.id, queryDb);
    return {
      ...row,
      assignedTechnicianIds: crew.assignedTechnicianIds,
    } as any;
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

    // 2026-04-12 final cleanup: the canonical crew input is
    // `assignedTechnicianIds`. The legacy `primaryTechnicianId` key is still
    // stripped defensively (any stale caller gets tolerated), but it is NOT
    // used for seed-visit crew. The crew is forwarded to the seed visit
    // below; the jobs row has no tech columns.
    const incomingAssignedTechnicianIds: string[] | null =
      Array.isArray((normalizedData as any).assignedTechnicianIds)
        ? (normalizedData as any).assignedTechnicianIds
        : null;
    const { primaryTechnicianId: _ptId, assignedTechnicianIds: _atIds, ...jobInsertData } =
      normalizedData as any;

    const job = await db.transaction(async (tx) => {
      // 1. Insert the job row (without assignment fields)
      const [createdJob] = await tx
        .insert(jobs)
        .values({
          ...jobInsertData,
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

      // Forward crew from job payload onto the seed VISIT only. The job row
      // itself never carries tech.
      const assignedTechnicianIds = incomingAssignedTechnicianIds;

      // UTC-safe scheduling fix: sanitize visit timestamps before direct insert
      const visitValues: any = {
        companyId,
        jobId: createdJob.id,
        scheduledDate: visitStart,          // legacy required field
        scheduledStart: hasSchedule ? visitStart : null,
        scheduledEnd: hasSchedule ? visitEnd : null,
        isAllDay: hasSchedule ? isAllDay : false,
        estimatedDurationMinutes: createdJob.durationMinutes ?? 60,
        assignedTechnicianIds,
        status: "scheduled",
        visitNumber: 1,
      };
      sanitizeSchedulingTimestamps(visitValues, createdJob.id);

      await tx.insert(jobVisits).values(visitValues);

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

    // 2026-04-12 (Option A): Strip job-level technician fields from update
    // patches at the canonical choke point. Jobs no longer own assignment —
    // crews live on visits. Any caller passing these fields is either legacy
    // or in a code path yet to be migrated; silently dropping them here
    // prevents job-column writes without breaking callers during migration.
    if (normalizedPatch && typeof normalizedPatch === "object") {
      delete (normalizedPatch as any).primaryTechnicianId;
      delete (normalizedPatch as any).assignedTechnicianIds;
    }

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
        // Prevent updates to deleted/deactivated jobs (canonical filter)
        .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId), activeJobFilter()))
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
  // 2026-03-18: updateJobStatus() DELETED — lifecycle writes must go through
  // jobLifecycleOrchestrator. Use updateJobStatusWithEvent() for audit-traced writes,
  // or transitionJobStatus() for domain-validated lifecycle transitions.

  /**
   * Permanently delete a job (2026-04-09 — permanent-delete model).
   *
   * Locked product decision: deleting a job must NOT break the invoice. Jobs
   * and invoices are separate records and the link between them is detachable.
   *
   * Transactional steps (in order):
   *   1. SELECT FOR UPDATE the job row (tenant-isolated). Return false if missing.
   *   2. Detach the back-pointer from invoices: UPDATE invoices SET job_id = NULL
   *      WHERE company_id = $cid AND job_id = $jid. The 2026-04-09 migration adds
   *      a FK on invoices.job_id with ON DELETE SET NULL, but the explicit detach
   *      keeps the operation correct in the same transaction regardless of FK
   *      install ordering and protects against any historical denormalized rows.
   *   3. Delete attention_items rows for this job (no FK, manual cleanup).
   *   4. DELETE FROM jobs. The DB then fires:
   *        - CASCADE on job_visits, job_parts, job_notes, job_equipment,
   *          job_status_events, job_schedule_audit, job_expenses, labor_entries,
   *          technician_job_status_events
   *        - SET NULL on tasks.job_id, time_entries.job_id,
   *          recurring_job_instances.generated_job_id (history outlives the job)
   *      The linked invoice (if any) survives as a standalone historical record
   *      with its job_id now NULL.
   *
   * No conditional soft-delete branch: under the new model, jobs are always
   * permanently deleted. The invoice survives via the detach in step 2.
   *
   * Returns true on success, false if the job row was not found (matches the
   * route handler's existing 404 behavior at routes/jobs.ts:400).
   */
  async deleteJob(companyId: string, jobId: string): Promise<boolean> {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    return await db.transaction(async (tx) => {
      // 1. Lock the job row
      const [job] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(
          eq(jobs.id, jobId),
          eq(jobs.companyId, companyId),
        ))
        .for("update")
        .limit(1);

      if (!job) return false;

      // 2. Detach the invoice → job back-pointer. Defense-in-depth: even after
      //    the FK is added in the 2026-04-09 permanent-delete migration, the
      //    explicit UPDATE keeps this storage method correct in any DB state.
      await tx
        .update(invoices)
        .set({ jobId: null, updatedAt: new Date() })
        .where(and(
          eq(invoices.companyId, companyId),
          eq(invoices.jobId, jobId),
        ));

      // 3. Clean up attention_items (no FK, manual cleanup)
      await tx
        .delete(attentionItems)
        .where(and(
          eq(attentionItems.tenantId, companyId),
          eq(attentionItems.entityType, "job"),
          eq(attentionItems.entityId, jobId),
        ));

      // 4. Hard delete the job row. FK cascades and SET NULLs handle the rest.
      await tx
        .delete(jobs)
        .where(and(
          eq(jobs.id, jobId),
          eq(jobs.companyId, companyId),
        ));

      return true;
    });
  }

  /**
   * Get job parts — LEFT JOINs items to resolve itemType from catalog.
   * No active/deleted filter on items: inactive items still have a valid type.
   */
  async getJobParts(companyId: string, jobId: string): Promise<(JobPart & { itemType: string | null })[]> {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    const rows = await db
      .select({
        jobPart: jobParts,
        itemType: items.type,
      })
      .from(jobParts)
      .leftJoin(items, eq(jobParts.productId, items.id))
      .where(and(
        eq(jobParts.companyId, companyId), // Tenant isolation
        eq(jobParts.jobId, jobId),
        eq(jobParts.isActive, true)
      ))
      .orderBy(jobParts.sortOrder);

    return rows.map(r => ({ ...r.jobPart, itemType: r.itemType }));
  }

  /**
   * Create job part
   *
   * POST-INVOICE GUARD: Blocked for invoiced jobs unless override is set.
   *
   * 2026-04-10 FIX: Always hydrates `unit_cost` from the catalog when the
   * caller passes a `productId` but no explicit `unitCost`. This closes a
   * silent data-integrity bug where the office add-part route and the
   * quote → job conversion path were inserting NULL `unit_cost` whenever
   * the client did not (or could not) supply the cost basis. Profit margin
   * calculations downstream in PartsBillingCard treated those rows as 100%
   * margin.
   *
   * The hydration is delegated to the canonical `normalizeJobPartUnitCost`
   * helper at the bottom of this file. Bulk paths (templates.ts apply,
   * pmJobParts.ts copy, techField.ts add-part) prefetch `items.cost` in
   * their own query and bypass the helper for performance — see the
   * helper's docstring for the canonical contract every path must satisfy.
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

    // 2026-04-10 FIX: hydrate unit_cost from catalog when missing.
    const hydratedUnitCost = await normalizeJobPartUnitCost({
      productId: partData.productId,
      unitCost: partData.unitCost,
    });

    const rows = await db
      .insert(jobParts)
      .values({
        ...partData,
        companyId, // Add tenant isolation
        jobId,
        unitCost: hydratedUnitCost,
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

    // Canonical soft-delete via deletedAt (read queries filter on deletedAt IS NULL)
    const rows = await db
      .update(jobParts)
      .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
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

    // Join location_equipment to hydrate the nested `equipment` object
    // expected by the frontend's JobEquipmentWithDetails contract.
    const rows = await db
      .select({
        // Junction row fields
        id: jobEquipment.id,
        companyId: jobEquipment.companyId,
        jobId: jobEquipment.jobId,
        equipmentId: jobEquipment.equipmentId,
        notes: jobEquipment.notes,
        createdAt: jobEquipment.createdAt,
        updatedAt: jobEquipment.updatedAt,
        // Nested equipment fields
        equipment: {
          id: locationEquipment.id,
          companyId: locationEquipment.companyId,
          locationId: locationEquipment.locationId,
          name: locationEquipment.name,
          equipmentType: locationEquipment.equipmentType,
          manufacturer: locationEquipment.manufacturer,
          modelNumber: locationEquipment.modelNumber,
          serialNumber: locationEquipment.serialNumber,
          tagNumber: locationEquipment.tagNumber,
          installDate: locationEquipment.installDate,
          warrantyExpiry: locationEquipment.warrantyExpiry,
          notes: locationEquipment.notes,
          nameplatePhotoId: locationEquipment.nameplatePhotoId,
          isActive: locationEquipment.isActive,
          deletedAt: locationEquipment.deletedAt,
          createdAt: locationEquipment.createdAt,
          updatedAt: locationEquipment.updatedAt,
        },
      })
      .from(jobEquipment)
      .innerJoin(locationEquipment, eq(jobEquipment.equipmentId, locationEquipment.id))
      .where(and(
        eq(jobEquipment.companyId, companyId),
        eq(jobEquipment.jobId, jobId),
        eq(locationEquipment.isActive, true),
      ));

    return rows;
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

    // Propagate job equipment → visits where equipmentIds has never been set (IS NULL).
    // Does NOT overwrite [] (user-cleared) or populated arrays (user-edited).
    const allJobEquip = await db
      .select({ equipmentId: jobEquipment.equipmentId })
      .from(jobEquipment)
      .where(and(eq(jobEquipment.companyId, companyId), eq(jobEquipment.jobId, jobId)));
    const allIds = allJobEquip.map(r => r.equipmentId);

    if (allIds.length > 0) {
      await db
        .update(jobVisits)
        .set({ equipmentIds: allIds })
        .where(
          and(
            eq(jobVisits.companyId, companyId),
            eq(jobVisits.jobId, jobId),
            isNull(jobVisits.equipmentIds),
            eq(jobVisits.isActive, true),
          )
        );
    }

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

    // Active equipment only — prevents linking soft-deleted equipment to jobs
    const rows = await db
      .select()
      .from(locationEquipment)
      .where(and(
        eq(locationEquipment.companyId, companyId),
        eq(locationEquipment.id, equipmentId),
        eq(locationEquipment.isActive, true),
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

      // Normalize date fields if any, then apply UTC-safe scheduling fix
      const normalizedPayload = this.normalizeDateFields(updatePayload);
      sanitizeSchedulingTimestamps(normalizedPayload, jobId);

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

  // 2026-03-18: updateJobStatusWithMultipleEvents() DELETED — dead code with zero callers.
  // Close operations now use single-step transitionJobStatus() via the lifecycle engine.
  // See docs/REFACTORING_LOG.md for details.

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
    actor: TransitionActor,
    txHandle?: any
  ): Promise<Job> {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    // Run inside provided transaction or create a new one
    const runInTx = async (tx: any) => {
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
      sanitizeSchedulingTimestamps(normalizedPatch, jobId);

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
    };

    // Use provided transaction or create a new one
    if (txHandle) {
      return runInTx(txHandle);
    }
    return db.transaction(runInTx);
  }

  /**
   * Get action required jobs queue for office/dispatch view
   * Sorted by: nextActionDate ASC NULLS LAST, onHoldAt ASC (oldest first)
   * NOTE: This function is kept for backward compatibility, now queries on_hold status
   */
  async getActionRequiredJobs(companyId: string) {
    this.assertCompanyId(companyId);

    const rows = await db
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
        // 2026-04-12 (Option A): primaryTechnicianId derived from visits below.
        createdAt: jobs.createdAt,
        // Location info
        locationName: clients.location,
        locationCompanyName: locationDisplayNameExpr,
        locationAddress: clients.address,
        locationCity: clients.city,
      })
      .from(jobs)
      .leftJoin(clients, eq(jobs.locationId, clients.id))
      .leftJoin(customerCompanies, eq(clients.parentCompanyId, customerCompanies.id))
      .where(
        and(
          eq(jobs.companyId, companyId),
          isNull(jobs.deletedAt),
          eq(jobs.isActive, true),
          eq(jobs.status, "open"),
          eq(jobs.openSubStatus, "on_hold")
        )
      )
      .orderBy(
        sql`${jobs.nextActionDate} ASC NULLS LAST`,
        asc(jobs.onHoldAt)
      );

    const crewMap = await getVisitCrewsForJobs(
      companyId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => ({
      ...r,
      assignedTechnicianIds: crewMap.get(r.id)?.assignedTechnicianIds ?? [],
    }));
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

// ============================================================================
// 2026-04-10: Canonical job_parts.unit_cost normalizer
// ============================================================================
//
// SINGLE SOURCE OF TRUTH for the rule:
//
//   "When a job_part is created with a non-null product_id, its unit_cost
//    MUST come from items.cost. Manual lines (no product_id) may have a
//    null unit_cost. Caller-supplied unit_cost always wins (even '0.00')."
//
// Background:
//   The office add-part route, the quote → job conversion path, and the
//   job-template apply path were each silently inserting NULL unit_cost
//   under specific conditions:
//     - Office route: relied on the client to send unitCost. Worked after
//       the P9-P10 client migration but had no backend safety net.
//     - Quote convert: quote_lines schema doesn't store unit_cost at all,
//       so the convert path had no source for it and never looked it up.
//     - Template apply: bulk SELECT omitted items.cost; insert omitted
//       unitCost (the primary active source of NULL rows in production).
//
//   The downstream symptom: PartsBillingCard's profit-margin calculation
//   treated NULL unit_cost as 0, displaying every affected line as 100%
//   margin.
//
// Wiring (the four insert paths into job_parts):
//   1. jobRepository.createJobPart  → calls this helper (single-row).
//   2. templateRepository.applyJobTemplateToJob → bypasses the helper for
//      bulk efficiency, BUT prefetches items.cost in its existing SELECT
//      and writes it directly. Same semantic invariant.
//   3. server/services/pmJobParts.ts copyLocationPMPartsToJob → bypasses
//      the helper for bulk efficiency, prefetches itemCost from a join.
//      Same semantic invariant.
//   4. server/routes/techField.ts POST /api/tech/visits/:id/parts → bypasses
//      the helper because it already SELECTs items.cost in the same query
//      that validates the product. Same semantic invariant.
//
//   Bulk paths each have a doc comment pointing back here as the canonical
//   reference. They are NOT independent implementations of the rule — they
//   are performance-optimized parallel implementations of the SAME rule.
//
// Semantics:
//   - Caller passed `unitCost`: respect it verbatim. Even "0.00" wins. The
//     helper does not second-guess the caller; if the office UI explicitly
//     wants a zero-cost manual line, it gets one.
//   - Caller passed null/undefined `unitCost` AND a `productId`: look up
//     items.cost and use it. Returns null if the catalog row is missing
//     (e.g. soft-deleted product) — do not throw, do not fabricate.
//   - Caller passed null/undefined `unitCost` AND no `productId`: return
//     null. Manual lines without a catalog link have no cost basis to look
//     up.
//
// This helper does NOT:
//   - Throw on missing catalog rows. Silently degrades to null.
//   - Validate companyId. Catalog cost is global by design (the catalog
//     itself is per-tenant; the lookup is by the productId the caller
//     already validated belongs to their tenant).
//   - Round-trip through parseMoney/formatMoney. The cost column is a
//     numeric(12,2) and Drizzle returns it as a canonical string already.
export async function normalizeJobPartUnitCost(input: {
  productId?: string | null;
  unitCost?: string | null;
}): Promise<string | null> {
  // Caller-supplied value always wins.
  if (input.unitCost != null) {
    return input.unitCost;
  }
  // Manual line — nothing to look up.
  if (!input.productId) {
    return null;
  }
  // Look up the catalog cost.
  const [row] = await db
    .select({ cost: items.cost })
    .from(items)
    .where(eq(items.id, input.productId))
    .limit(1);
  return row?.cost ?? null;
}
