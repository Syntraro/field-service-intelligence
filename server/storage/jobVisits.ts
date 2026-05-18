import { db } from "../db";
import { and, eq, desc, gte, lte, asc, sql, notInArray, isNull, isNotNull, or, inArray } from "drizzle-orm";
import { activeJobFilter } from "./jobFilters";
import { jobVisits, jobs, jobNotes, users, clientLocations, customerCompanies, jobEquipment, locationEquipment, jobParts, items, jobNoteAttachments, files } from "@shared/schema";
// 2026-05-01: canonical location-name resolver for visit-detail location lookup.
import { locationDisplayNameExpr } from "../lib/queryHelpers";
import { BaseRepository, clampLimit } from "./base";
import { isTechnicianAssignedToVisit } from "../guards/visitAssignmentGuards";
import { sanitizeAllDayTimestamps, sanitizeSchedulingTimestamps, parseTimestampAsUTC } from "../utils/allDaySanitizer";
import {
  activeVisitGuard,
  scheduleEligibleVisitFilter,
  uncompletedVisitFilter,
} from "../lib/visitPredicates";
import { normalizeVisitSchedule } from "../domain/scheduling";

// ============================================================================
// ENRICHED VISIT TYPES — shared response shapes for tech + calendar consumers
// ============================================================================

/** Job metadata attached to an enriched visit. */
export interface VisitJobInfo {
  id: string;
  jobNumber: number;
  summary: string;
  jobType: string | null;
  description: string | null;
  priority: string | null;
  accessInstructions?: string | null;
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
  /** Geocoded latitude (numeric column → string from drizzle, parsed to number
   *  in API response). Null when the address has not been geocoded. */
  lat: number | null;
  /** Geocoded longitude. See `lat`. */
  lng: number | null;
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
  assignedTechnicianIds?: string[];
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
    if (filters.assignedTechnicianIds && filters.assignedTechnicianIds.length > 0) {
      const literal = sql.join(filters.assignedTechnicianIds.map((id) => sql`${id}`), sql`, `);
      where.push(sql`${jobVisits.assignedTechnicianIds} && ARRAY[${literal}]::varchar[]`);
    }
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
  ): Promise<{ visit: any; job: VisitJobInfo | null; location: VisitLocationInfo | null; equipment: any[]; notes: any[]; parts: any[] } | null> {
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

    // 2026-04-12 scalar removal: crew membership is the sole eligibility check.
    const isAssigned =
      Array.isArray(visit.assignedTechnicianIds) && visit.assignedTechnicianIds.includes(userId);
    if (!isAssigned) return null;

    // Fetch job
    // Phase 2 fix: include accessInstructions for tech field display
    const [job] = await db
      .select({
        id: jobs.id,
        jobNumber: jobs.jobNumber,
        summary: jobs.summary,
        jobType: jobs.jobType,
        description: jobs.description,
        priority: jobs.priority,
        accessInstructions: jobs.accessInstructions,
        version: jobs.version,
      })
      .from(jobs)
      .where(and(eq(jobs.id, visit.jobId), eq(jobs.companyId, companyId), activeJobFilter()));

    // Fetch location via job.locationId
    // 2026-05-01 bypass cleanup: companyName resolves through the
    // canonical helper. LEFT JOIN customer_companies so the helper has
    // the parent row to consult; uses idx_client_locations_parent_company.
    let location: VisitLocationInfo | null = null;
    if (job) {
      const [loc] = await db
        .select({
          id: clientLocations.id,
          companyName: locationDisplayNameExpr,
          location: clientLocations.location,
          address: clientLocations.address,
          city: clientLocations.city,
          province: clientLocations.province,
          postalCode: clientLocations.postalCode,
          phone: clientLocations.phone,
          lat: clientLocations.lat,
          lng: clientLocations.lng,
        })
        .from(clientLocations)
        .innerJoin(jobs, eq(jobs.locationId, clientLocations.id))
        .leftJoin(customerCompanies, eq(clientLocations.parentCompanyId, customerCompanies.id))
        .where(and(eq(jobs.id, visit.jobId), eq(jobs.companyId, companyId)));
      location = loc
        ? {
            ...loc,
            lat: loc.lat == null ? null : Number(loc.lat),
            lng: loc.lng == null ? null : Number(loc.lng),
          }
        : null;
    }

    // Fetch hydrated equipment for this job (via job_equipment → location_equipment)
    const equipment = await db
      .select({
        jobEquipmentId: jobEquipment.id,
        id: locationEquipment.id,
        name: locationEquipment.name,
        equipmentType: locationEquipment.equipmentType,
        manufacturer: locationEquipment.manufacturer,
        modelNumber: locationEquipment.modelNumber,
        serialNumber: locationEquipment.serialNumber,
        tagNumber: locationEquipment.tagNumber,
        locationId: locationEquipment.locationId,
      })
      .from(jobEquipment)
      .innerJoin(locationEquipment, eq(jobEquipment.equipmentId, locationEquipment.id))
      .where(
        and(
          eq(jobEquipment.companyId, companyId),
          eq(jobEquipment.jobId, visit.jobId),
          eq(locationEquipment.isActive, true),
        )
      );

    // Fetch job notes (includes optional equipmentId for equipment-linked notes)
    const noteRows = await db
      .select({
        id: jobNotes.id,
        noteText: jobNotes.noteText,
        imageUrl: jobNotes.imageUrl,
        equipmentId: jobNotes.equipmentId,
        createdAt: jobNotes.createdAt,
        userId: jobNotes.userId,
        userName: users.fullName,
        userFirstName: users.firstName,
      })
      .from(jobNotes)
      .leftJoin(users, eq(jobNotes.userId, users.id))
      .where(and(eq(jobNotes.companyId, companyId), eq(jobNotes.jobId, visit.jobId)))
      .orderBy(desc(jobNotes.createdAt));

    // Hydrate attachments in one pass so tech-app NoteCard can display them
    // uniformly with the office view. Filters soft-deleted file rows.
    const noteIds = noteRows.map((n) => n.id);
    const attachmentRows = noteIds.length > 0
      ? await db
          .select({
            id: jobNoteAttachments.id,
            noteId: jobNoteAttachments.noteId,
            fileId: jobNoteAttachments.fileId,
            originalName: files.originalName,
            mimeType: files.mimeType,
            size: files.size,
            storageProvider: files.storageProvider,
            status: files.status,
          })
          .from(jobNoteAttachments)
          .innerJoin(files, eq(jobNoteAttachments.fileId, files.id))
          .where(and(
            eq(jobNoteAttachments.companyId, companyId),
            inArray(jobNoteAttachments.noteId, noteIds),
            eq(files.status, "uploaded"),
          ))
      : [];
    const attachmentsByNote = new Map<string, typeof attachmentRows>();
    for (const a of attachmentRows) {
      const list = attachmentsByNote.get(a.noteId) ?? [];
      list.push(a);
      attachmentsByNote.set(a.noteId, list);
    }
    const notes = noteRows.map((n) => ({
      ...n,
      attachments: attachmentsByNote.get(n.id) ?? [],
    }));

    // Fetch job parts (canonical billing line items for this job)
    const parts = await db
      .select({
        id: jobParts.id,
        description: jobParts.description,
        quantity: jobParts.quantity,
        unitPrice: jobParts.unitPrice,
        equipmentId: jobParts.equipmentId,
        productId: jobParts.productId,
        createdAt: jobParts.createdAt,
      })
      .from(jobParts)
      .where(and(eq(jobParts.companyId, companyId), eq(jobParts.jobId, visit.jobId), isNull(jobParts.deletedAt)))
      .orderBy(desc(jobParts.createdAt));

    return {
      visit,
      job: job ?? null,
      location,
      equipment,
      notes,
      parts,
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
    return isTechnicianAssignedToVisit(userId, visit) ? visit : null;
  }

  /**
   * PHASE 4: Public wrapper for syncJobScheduleFromVisits.
   * Called by calendar write endpoints after modifying job_visits.
   */
  async syncJobToVisits(companyId: string, jobId: string, txHandle?: any) {
    return this.syncJobScheduleFromVisits(companyId, jobId, txHandle);
  }

  /**
   * STEP 2.4 - Compatibility mirror:
   * Mirror the "next scheduled visit" onto jobs.scheduled_* so Model A calendar keeps working.
   * Rules:
   * - "Active scheduled visit" = is_active=true, scheduled_start IS NOT NULL, status NOT IN (cancelled, completed)
   * - "Next" = earliest future visit if any, else earliest overall
   * - If no active visits: unschedule the job
   */
  private async syncJobScheduleFromVisits(companyId: string, jobId: string, txHandle?: any) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");
    const queryDb = txHandle ?? db;

    // Pull schedule-eligible visits for this job
    // 2026-03-18: Uses canonical predicate from visitPredicates.ts
    const visitRows: Array<{
      id: string; scheduledStart: Date | null; scheduledEnd: Date | null;
      isAllDay: boolean;
      assignedTechnicianIds: string[] | null; status: string; isActive: boolean;
    }> = await queryDb
      .select({
        id: jobVisits.id,
        scheduledStart: jobVisits.scheduledStart,
        scheduledEnd: jobVisits.scheduledEnd,
        isAllDay: jobVisits.isAllDay,
        // 2026-04-12 scalar removal: crew array only.
        assignedTechnicianIds: jobVisits.assignedTechnicianIds,
        status: jobVisits.status,
        isActive: jobVisits.isActive,
      })
      .from(jobVisits)
      .where(scheduleEligibleVisitFilter(companyId, jobId))
      .orderBy(asc(jobVisits.scheduledStart));

    if (!visitRows.length) {
      // UNSCHEDULE BRANCH: No schedule-eligible visits exist.
      // Clear the job's scheduling mirror unconditionally so the job returns
      // to the unscheduled backlog. Previous guards (status !== "open",
      // openSubStatus === "on_hold") created an orphan state where the visit
      // was unscheduled but the job-level scheduledStart remained set, making
      // the visit invisible on both the scheduled board and unscheduled panel.
      // The job-level schedule must always reflect the actual visit state.
      // 2026-04-12 (Option A): scheduling mirror only. Job-level technician
      // columns are quiescent — they are not cleared here (or anywhere) and
      // must not be relied on.
      await queryDb
        .update(jobs)
        .set({
          scheduledStart: null,
          scheduledEnd: null,
          isAllDay: false,
          durationMinutes: null,
          updatedAt: new Date(),
          version: sql`${jobs.version} + 1`,
        })
        .where(and(eq(jobs.companyId, companyId), eq(jobs.id, jobId)));

      return;
    }

    const now = new Date();

    const nextFuture = visitRows.find(v => {
      const s = parseTimestampAsUTC(v.scheduledStart as Date | string | null);
      return !!s && s.getTime() >= now.getTime();
    });

    // If no future visits exist, prefer the most recent past visit (latest scheduled_start)
    let chosen = nextFuture;
    if (!chosen) {
      const past = visitRows
        .filter(v => {
          const s = parseTimestampAsUTC(v.scheduledStart as Date | string | null);
          return !!s && s.getTime() < now.getTime();
        })
        .sort((a, b) => {
          const sa = parseTimestampAsUTC(a.scheduledStart as Date | string | null)!.getTime();
          const sb = parseTimestampAsUTC(b.scheduledStart as Date | string | null)!.getTime();
          return sb - sa; // latest first
        });

      chosen = past[0] ?? visitRows[0];
    }

    // UTC-safe read: parse timestamp-without-timezone from Drizzle as UTC
    const scheduledStart = parseTimestampAsUTC(chosen.scheduledStart as Date | string | null);
    const scheduledEnd = parseTimestampAsUTC(chosen.scheduledEnd as Date | string | null);
    const isAllDay = Boolean(chosen.isAllDay);

    // durationMinutes mirror:
    // - all-day: NULL (jobs calendar code computes 1440 if isAllDay true)
    // - timed: compute from start/end if present
    let durationMinutes: number | null = null;
    if (!isAllDay && scheduledStart && scheduledEnd) {
      durationMinutes = Math.max(15, Math.round((scheduledEnd.getTime() - scheduledStart.getTime()) / 60000));
    }

    // 2026-04-12 (Option A): Technician mirror REMOVED. Jobs no longer own
    // assignment — visits are canonical. This sync still mirrors scheduling
    // (scheduledStart/scheduledEnd/isAllDay/durationMinutes) from the chosen
    // visit onto the job, but assignedTechnicianIds / primaryTechnicianId on
    // the job row are quiescent and must not be written.
    const jobUpdate: any = {
      scheduledStart,
      scheduledEnd,
      isAllDay,
      durationMinutes,
      updatedAt: new Date(),
      version: sql`${jobs.version} + 1`,
    };

    // UTC-safe scheduling fix: replaces Date objects with UTC-safe SQL expressions
    // for both timed and all-day timestamps. Prevents node-pg timezone-sensitive
    // serialization from producing shifted values (timed) or violating CHECK
    // constraints (all-day).
    sanitizeSchedulingTimestamps(jobUpdate, jobId);

    await queryDb
      .update(jobs)
      .set(jobUpdate)
      .where(and(eq(jobs.companyId, companyId), eq(jobs.id, jobId)));
  }

  /**
   * Compute next visit number for a job (max across ALL visits + 1).
   *
   * Visit Reschedule Architecture fix: removed isActive filter because the
   * uniqueness guard covers ALL rows including inactive ones (canonical
   * 3-col index job_visits_company_job_visit_number_uq as of 2026-04-18
   * Phase 0). Without this, soft-deleting visit #1 then creating a new
   * visit would try to reuse #1, causing a constraint violation.
   *
   * 2026-04-18 Phase 0 — race-condition caveat: `MAX + 1` is read, then
   * used by the caller for an INSERT. Two concurrent creates on the same
   * job can read the same max and collide on INSERT. The canonical DB
   * unique index now surfaces that collision as 23505, which
   * `createJobVisit` catches and retries with a freshly recomputed
   * max+1. This method is intentionally NOT in a transaction with its
   * caller — the retry loop is the protection, not locking.
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

    // Prevent visit creation on terminal jobs. User must reopen the job first.
    if (job.status === "completed" || job.status === "invoiced" || job.status === "archived") {
      const err = new Error("Visits can only be created on open jobs. Reopen the job first.");
      (err as any).statusCode = 409;
      (err as any).code = "JOB_NOT_OPEN";
      throw err;
    }

    // Part 2: Compute visitNumber if not provided. Caller-supplied values
    // are trusted and not auto-retried — only repository-computed numbers
    // participate in the race-recovery loop below.
    const callerProvidedVisitNumber = input.visitNumber != null;
    let visitNumber: number = callerProvidedVisitNumber
      ? input.visitNumber
      : await this.getNextVisitNumber(companyId, jobId);

    // Part 2: Normalize scheduling fields through the canonical guard.
    // 2026-05-04: replaces the prior inline start/end/duration computation.
    // The helper guarantees `scheduledEnd > scheduledStart`, defaults
    // duration to 60 min, and floors it at 30 — same rules as updateJobVisit
    // and createJob's seed-visit path. Insert callers always supply a
    // start (route schema requires `scheduledDate`) so the normalized
    // start/end are guaranteed non-null here.
    const rawStart = input.scheduledStart ?? input.scheduledDate;
    const norm = normalizeVisitSchedule({
      scheduledStart: rawStart,
      scheduledEnd: input.scheduledEnd,
      durationMinutes: input.estimatedDurationMinutes,
      isAllDay: input.isAllDay,
    });
    if (!norm.scheduledStart || !norm.scheduledEnd) {
      throw new Error(
        `[createJobVisit] normalizeVisitSchedule produced null start/end (jobId=${jobId}); ` +
          `caller must supply a valid scheduledStart/scheduledDate.`,
      );
    }
    const scheduledStart = norm.scheduledStart;
    const scheduledDate = scheduledStart; // legacy mirror
    const scheduledEnd = norm.scheduledEnd;
    const isAllDay = norm.isAllDay;
    const estimatedDurationMinutes = norm.durationMinutes;

    const assignedTechnicianIds: string[] | null = Array.isArray(input.assignedTechnicianIds)
      ? input.assignedTechnicianIds
      : null;

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

    // UTC-safe scheduling fix: replace Date objects with SQL expressions that
    // bypass node-pg's timezone-sensitive serialization. Covers both timed and
    // all-day events in one pass.
    const visitValues: any = {
      companyId,
      jobId,
      scheduledDate,
      scheduledStart,
      scheduledEnd,
      isAllDay,
      estimatedDurationMinutes,
      assignedTechnicianIds,
      status: input.status ?? "scheduled",
      visitNumber,
      visitNotes: input.visitNotes ?? null,
      equipmentIds,
    };
    sanitizeSchedulingTimestamps(visitValues, jobId);

    // 2026-04-18 Phase 0 — collision-safe create.
    //
    // The canonical unique index
    //   UNIQUE(company_id, job_id, visit_number)
    //   [job_visits_company_job_visit_number_uq]
    // makes the DB the source of truth for visit-number uniqueness. If two
    // concurrent calls read the same MAX and both attempt INSERT with the
    // same computed number, exactly one succeeds and the other throws a
    // 23505 unique-violation. We catch that specific error, recompute
    // MAX+1 with a tiny jittered backoff, and retry. The winning insert
    // is authoritative; the loser takes the next number. No transaction
    // or row lock is needed — DB uniqueness is the arbiter.
    //
    // MAX_ATTEMPTS is sized for realistic contention (typical dispatcher
    // bulk-create + a small safety margin). Caller-supplied visit numbers
    // are never auto-rewritten — the caller's intent is respected and the
    // 23505 propagates unmodified so the integration layer can surface it.
    //
    // Error detection intentionally checks BOTH `err.code === "23505"`
    // AND a message/constraint substring match. The Neon serverless
    // driver does not always populate `err.constraint`, but the error
    // message always carries the constraint name on a unique violation.
    const MAX_ATTEMPTS = 20;
    let visit: typeof jobVisits.$inferSelect | undefined;
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        [visit] = await db
          .insert(jobVisits)
          .values(visitValues)
          .returning();
        break;
      } catch (err: any) {
        const isUniqueViolation = err?.code === "23505";
        const hint = `${err?.constraint ?? ""} ${err?.message ?? ""}`;
        const isVisitNumberConflict =
          isUniqueViolation && hint.includes("visit_number");
        if (
          isVisitNumberConflict &&
          !callerProvidedVisitNumber &&
          attempt < MAX_ATTEMPTS - 1
        ) {
          // Small jittered backoff so concurrent retriers don't all
          // re-read MAX in lockstep again on the next iteration.
          await new Promise((r) => setTimeout(r, 5 + Math.floor(Math.random() * 15)));
          visitNumber = await this.getNextVisitNumber(companyId, jobId);
          visitValues.visitNumber = visitNumber;
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    if (!visit) {
      // Exhausted retries. Surface the last unique-violation so the
      // caller sees the exact DB error, not a generic "undefined visit".
      throw lastErr ?? new Error("createJobVisit: insert produced no row");
    }

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

    if ("assignedTechnicianIds" in input) {
      const crew = Array.isArray(input.assignedTechnicianIds) ? input.assignedTechnicianIds : [];
      updates.assignedTechnicianIds = crew;
    }
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
    // 2026-04-12: assignedTechnicianIds handled in the canonical paired
    // crew-write block above — do NOT re-assign here or the scalar lead
    // column would stay stale.
    //
    // 2026-04-21 Phase 1 canonical visit mutation architecture: equipmentIds
    // on `job_visits` IS writable through this storage method. It is the
    // visit-scoped equipment selection that pre-loads the tech's mobile view
    // (metadata, not a lifecycle field). The `job_equipment` join table is a
    // separate, orthogonal concern — tech-app adds equipment to the JOB from
    // the field; this array records which of those the office wants
    // highlighted for the current VISIT. Writing `null` here means "no
    // explicit selection"; writing `[]` means "explicitly empty selection".
    if ("equipmentIds" in input) updates.equipmentIds = input.equipmentIds;

    // 4) FINAL pass: enforce schedule integrity through the canonical
    // normalizer. 2026-05-04: replaces the inline duration → end compute.
    // Skipped on unschedule (start cleared) — that branch already set
    // scheduledEnd = null at step 3. For every other case, normalize
    // sees the merged-but-not-yet-written state and produces the
    // canonical { start, end, durationMinutes, isAllDay } triple,
    // guaranteeing end > start AND duration ≥ 30.
    const startWasCleared = "scheduledStart" in input && input.scheduledStart == null;
    if (!startWasCleared) {
      const finalStartCandidate =
        ("scheduledStart" in updates ? updates.scheduledStart : existing.scheduledStart) ?? null;
      if (finalStartCandidate) {
        const finalEndCandidate =
          ("scheduledEnd" in updates ? updates.scheduledEnd : existing.scheduledEnd) ?? null;
        const finalDuration =
          ("estimatedDurationMinutes" in updates
            ? updates.estimatedDurationMinutes
            : existing.estimatedDurationMinutes) ?? null;
        const finalIsAllDay =
          ("isAllDay" in updates ? updates.isAllDay : existing.isAllDay) ?? false;
        const norm = normalizeVisitSchedule({
          scheduledStart: finalStartCandidate,
          scheduledEnd: finalEndCandidate,
          durationMinutes: finalDuration,
          isAllDay: finalIsAllDay,
        });
        if (norm.scheduledStart && norm.scheduledEnd) {
          updates.scheduledStart = norm.scheduledStart;
          updates.scheduledEnd = norm.scheduledEnd;
          updates.estimatedDurationMinutes = norm.durationMinutes;
        }
      }
    }

    // 2026-04-17: active-workflow status coercion.
    // Integrity rule: a visit in an active-workflow status (en_route / on_site /
    // in_progress / paused) implies there's live labour tied to a real slot and
    // real crew. If the same update unschedules the visit or empties the crew,
    // the active semantics are stale — downstream read models (Job Detail
    // Visits card, dispatch board) render "In Progress" on a row with no date
    // and no assignee, which is the integrity drift reported 2026-04-17.
    // Coerce back to 'scheduled' (the canonical inactive workflow state; also
    // used for Schedule-Later placeholders with scheduledStart=null) in the
    // same UPDATE so no extra round-trip and no window where UI sees drift.
    const ACTIVE_WORKFLOW_STATUSES = ["en_route", "on_site", "in_progress", "paused"];
    const unschedulingNow = "scheduledStart" in input && input.scheduledStart == null;
    const unassigningNow =
      "assignedTechnicianIds" in input &&
      Array.isArray(updates.assignedTechnicianIds) &&
      updates.assignedTechnicianIds.length === 0;
    const statusBeingSetExplicitly = "status" in input;
    if (
      !statusBeingSetExplicitly &&
      (unschedulingNow || unassigningNow) &&
      ACTIVE_WORKFLOW_STATUSES.includes(existing.status)
    ) {
      updates.status = "scheduled";
    }

    // UTC-safe scheduling fix: replace Date objects with SQL expressions
    sanitizeSchedulingTimestamps(updates, visitId);

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

    // 2026-04-10 micro-patch: clear the cancel-start restore marker on terminal
    // transitions. previousStatus is captured by startVisit so cancelVisitStart
    // can restore the prior state — once the visit reaches a terminal state
    // the marker has no semantic meaning and must not linger. In practice the
    // only caller that reaches here with a terminal status is cancelVisit
    // (CANCEL_VISIT intent → "cancelled"); "completed" is owned by the
    // orchestrator's COMPLETE_VISIT path and rejected upstream by the route.
    // We list both for defense-in-depth.
    if (status === "cancelled" || status === "completed") {
      updates.previousStatus = null;
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
