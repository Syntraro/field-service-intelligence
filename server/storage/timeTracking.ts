/**
 * Time Tracking Storage Layer
 *
 * Provides storage operations for:
 * - Work Sessions (clock in/out for payroll)
 * - Time Entries (granular time tracking for billing)
 * - Technician Job Status Events (mobile status updates that drive time entries)
 * - Job Time Summaries (aggregated time data for job screens)
 */

import { db } from "../db";
import { eq, and, sql, desc, isNull, isNotNull, lt, gte, or, asc, lte } from "drizzle-orm";
import { activeJobFilter } from "./jobFilters";
import {
  workSessions,
  timeEntries,
  technicianJobStatusEvents,
  timeApprovals,
  timeEntryLockOverrides,
  users,
  technicianProfiles,
  jobs,
  type WorkSession,
  type TimeEntry,
  type TechnicianJobStatusEvent,
  type TimeApproval,
  type TimeEntryType,
  type TechnicianJobStatus,
  type JobTimeSummary,
  type TechnicianWeeklySummary,
  type DailyPayrollBreakdown,
  type WeeklyAnalyticsData,
  type WeeklyAnalyticsResponse,
  type TechnicianAnalytics,
  type TechnicianAnalyticsResponse,
  type TimeByTypeBreakdown,
} from "@shared/schema";
import { BaseRepository } from "./base";
import {
  isEntryLocked,
  checkEntryLock,
  getLockingInvoiceId,
  requireOverrideReason,
} from "../utils/timeEntryLock";

// Types for billable defaults by entry type
const BILLABLE_DEFAULTS: Record<TimeEntryType, boolean> = {
  travel_to_job: true,
  on_site: true,
  travel_to_supplier: true,
  supplier_run: true,
  travel_between_jobs: true,
  admin: false,
  break: false,
  other: false,
};

export class TimeTrackingRepository extends BaseRepository {
  // ============================================================================
  // WORK SESSIONS
  // ============================================================================

  /**
   * Get open work session for a technician on a specific date
   */
  async getOpenWorkSession(
    companyId: string,
    technicianId: string,
    workDate: string
  ): Promise<WorkSession | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(technicianId, "technicianId");

    const rows = await db
      .select()
      .from(workSessions)
      .where(
        and(
          eq(workSessions.companyId, companyId),
          eq(workSessions.technicianId, technicianId),
          eq(workSessions.workDate, workDate),
          isNull(workSessions.clockOutAt)
        )
      )
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Get any open work session for a technician (regardless of date)
   */
  async getAnyOpenWorkSession(
    companyId: string,
    technicianId: string
  ): Promise<WorkSession | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(technicianId, "technicianId");

    const rows = await db
      .select()
      .from(workSessions)
      .where(
        and(
          eq(workSessions.companyId, companyId),
          eq(workSessions.technicianId, technicianId),
          isNull(workSessions.clockOutAt)
        )
      )
      .orderBy(desc(workSessions.clockInAt))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Clock in - creates a new work session for today
   */
  async clockIn(
    companyId: string,
    technicianId: string,
    options?: {
      at?: Date;
      source?: "mobile" | "web" | "import";
      notes?: string;
      overrideApprovalLock?: boolean;
      overrideReason?: string;
      actingUserId?: string;
    }
  ): Promise<WorkSession> {
    this.assertCompanyId(companyId);
    this.validateUUID(technicianId, "technicianId");

    const now = options?.at ?? new Date();
    const workDate = now.toISOString().split("T")[0]; // YYYY-MM-DD

    // Check approval lock
    await this.enforceApprovalLock(companyId, technicianId, workDate, {
      overrideApprovalLock: options?.overrideApprovalLock,
      overrideReason: options?.overrideReason,
      actingUserId: options?.actingUserId,
    });

    // Check for existing open session
    const existingOpen = await this.getAnyOpenWorkSession(companyId, technicianId);
    if (existingOpen) {
      throw this.conflictError(
        `Technician already has an open session from ${existingOpen.workDate}. ` +
          `Please clock out first.`
      );
    }

    const [session] = await db
      .insert(workSessions)
      .values({
        companyId,
        technicianId,
        workDate,
        clockInAt: now,
        source: options?.source ?? "web",
        notes: options?.notes,
      })
      .returning();

    return session;
  }

  /**
   * Clock out - closes the current open session
   */
  async clockOut(
    companyId: string,
    technicianId: string,
    options?: {
      at?: Date;
      breakMinutes?: number;
      notes?: string;
      overrideApprovalLock?: boolean;
      overrideReason?: string;
      actingUserId?: string;
    }
  ): Promise<WorkSession> {
    this.assertCompanyId(companyId);
    this.validateUUID(technicianId, "technicianId");

    const openSession = await this.getAnyOpenWorkSession(companyId, technicianId);
    if (!openSession) {
      throw this.notFoundError("No open work session found");
    }

    const clockOutAt = options?.at ?? new Date();

    // Check approval lock (for the session's work date)
    await this.enforceApprovalLock(companyId, technicianId, openSession.workDate, {
      overrideApprovalLock: options?.overrideApprovalLock,
      overrideReason: options?.overrideReason,
      actingUserId: options?.actingUserId,
    });

    // Validate clock out is after clock in
    if (clockOutAt < openSession.clockInAt) {
      throw this.validationError("Clock out time cannot be before clock in time");
    }

    const [updated] = await db
      .update(workSessions)
      .set({
        clockOutAt,
        breakMinutes: options?.breakMinutes ?? openSession.breakMinutes,
        notes: options?.notes ?? openSession.notes,
        updatedAt: new Date(),
      })
      .where(eq(workSessions.id, openSession.id))
      .returning();

    // Also stop any running time entries for this technician
    await this.stopRunningTimeEntry(companyId, technicianId, { at: clockOutAt });

    return updated;
  }

  /**
   * Get work session by ID
   */
  async getWorkSession(companyId: string, sessionId: string): Promise<WorkSession | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(sessionId, "sessionId");

    const rows = await db
      .select()
      .from(workSessions)
      .where(and(eq(workSessions.id, sessionId), eq(workSessions.companyId, companyId)))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Get today's status for a technician (session + running entry + entries summary)
   */
  async getTechnicianTodayStatus(companyId: string, technicianId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(technicianId, "technicianId");

    const today = new Date().toISOString().split("T")[0];
    const startOfToday = new Date(today + "T00:00:00Z");
    const endOfToday = new Date(today + "T23:59:59Z");

    // Get open session
    const openSession = await this.getOpenWorkSession(companyId, technicianId, today);

    // Get running time entry
    const runningEntry = await this.getRunningTimeEntry(companyId, technicianId);

    // Get today's completed entries
    const todayEntries = await db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          eq(timeEntries.technicianId, technicianId),
          gte(timeEntries.startAt, startOfToday),
          lt(timeEntries.startAt, endOfToday)
        )
      )
      .orderBy(desc(timeEntries.startAt));

    // Calculate totals
    const totalMinutes = todayEntries.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);
    const billableMinutes = todayEntries
      .filter((e) => e.billable)
      .reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);

    return {
      openSession,
      runningEntry,
      todayEntries,
      summary: {
        totalMinutes,
        billableMinutes,
        entriesCount: todayEntries.length,
      },
    };
  }

  // ============================================================================
  // TIME ENTRIES
  // ============================================================================

  /**
   * Get the currently running time entry for a technician
   */
  async getRunningTimeEntry(
    companyId: string,
    technicianId: string
  ): Promise<TimeEntry | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(technicianId, "technicianId");

    const rows = await db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          eq(timeEntries.technicianId, technicianId),
          isNull(timeEntries.endAt)
        )
      )
      .orderBy(desc(timeEntries.startAt))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Start a new time entry
   * Automatically stops any currently running entry (for better UX)
   */
  async startTimeEntry(
    companyId: string,
    technicianId: string,
    options: {
      type: TimeEntryType;
      jobId?: string | null;
      notes?: string | null;
      billable?: boolean;
      at?: Date;
      overrideApprovalLock?: boolean;
      overrideReason?: string;
      actingUserId?: string;
    }
  ): Promise<TimeEntry> {
    this.assertCompanyId(companyId);
    this.validateUUID(technicianId, "technicianId");
    if (options.jobId) {
      this.validateUUID(options.jobId, "jobId");
    }

    const now = options.at ?? new Date();

    // Check approval lock
    await this.enforceApprovalLock(companyId, technicianId, now, {
      overrideApprovalLock: options?.overrideApprovalLock,
      overrideReason: options?.overrideReason,
      actingUserId: options?.actingUserId,
    });

    // Auto-stop any running entry
    await this.stopRunningTimeEntry(companyId, technicianId, { at: now });

    // Get billable rate snapshot from technician profile
    const billableRateSnapshot = await this.getTechnicianBillableRate(companyId, technicianId);
    const costRateSnapshot = await this.getTechnicianCostRate(companyId, technicianId);

    // Determine billable default based on type
    const billable = options.billable ?? BILLABLE_DEFAULTS[options.type];

    // Get current open work session (optional link)
    const today = now.toISOString().split("T")[0];
    const openSession = await this.getOpenWorkSession(companyId, technicianId, today);

    const [entry] = await db
      .insert(timeEntries)
      .values({
        companyId,
        technicianId,
        workSessionId: openSession?.id ?? null,
        jobId: options.jobId ?? null,
        type: options.type,
        startAt: now,
        billable,
        billableRateSnapshot,
        costRateSnapshot,
        notes: options.notes,
      })
      .returning();

    return entry;
  }

  /**
   * Stop a time entry (by ID or stop current running)
   * Phase 9: Now checks invoice lock before stopping
   */
  async stopTimeEntry(
    companyId: string,
    technicianId: string,
    options?: {
      timeEntryId?: string;
      at?: Date;
      notes?: string | null;
      overrideApprovalLock?: boolean;
      overrideInvoiceLock?: boolean;
      overrideReason?: string;
      actingUserId?: string;
    }
  ): Promise<TimeEntry | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(technicianId, "technicianId");

    let entry: TimeEntry | null;

    if (options?.timeEntryId) {
      this.validateUUID(options.timeEntryId, "timeEntryId");
      entry = await this.getTimeEntry(companyId, options.timeEntryId);
      if (!entry) {
        throw this.notFoundError("Time entry");
      }
      if (entry.technicianId !== technicianId) {
        throw this.forbiddenError("Cannot stop another technician's time entry");
      }
    } else {
      entry = await this.getRunningTimeEntry(companyId, technicianId);
    }

    if (!entry || entry.endAt) {
      return null; // Already stopped or not found
    }

    // Check approval lock (for the entry's start date)
    await this.enforceApprovalLock(companyId, technicianId, entry.startAt, {
      overrideApprovalLock: options?.overrideApprovalLock,
      overrideReason: options?.overrideReason,
      actingUserId: options?.actingUserId,
    });

    // Phase 9: Check invoice lock (running entries shouldn't be locked, but be defensive)
    checkEntryLock(entry, { overrideInvoiceLock: options?.overrideInvoiceLock });

    const endAt = options?.at ?? new Date();

    // Validate end time is after start time
    if (endAt < entry.startAt) {
      throw this.validationError("End time cannot be before start time");
    }

    // Calculate duration in minutes
    const durationMinutes = Math.round(
      (endAt.getTime() - entry.startAt.getTime()) / 60000
    );

    const [updated] = await db
      .update(timeEntries)
      .set({
        endAt,
        durationMinutes,
        notes: options?.notes ?? entry.notes,
        updatedAt: new Date(),
      })
      .where(eq(timeEntries.id, entry.id))
      .returning();

    return updated;
  }

  /**
   * Internal helper to stop running entry without validation
   */
  private async stopRunningTimeEntry(
    companyId: string,
    technicianId: string,
    options?: { at?: Date }
  ): Promise<void> {
    const runningEntry = await this.getRunningTimeEntry(companyId, technicianId);
    if (!runningEntry) return;

    const endAt = options?.at ?? new Date();
    const durationMinutes = Math.round(
      (endAt.getTime() - runningEntry.startAt.getTime()) / 60000
    );

    await db
      .update(timeEntries)
      .set({
        endAt,
        durationMinutes,
        updatedAt: new Date(),
      })
      .where(eq(timeEntries.id, runningEntry.id));
  }

  /**
   * Check if a time range overlaps with existing entries for a technician
   * Returns the overlapping entries if any exist
   */
  async checkTimeEntryOverlap(
    companyId: string,
    technicianId: string,
    startAt: Date,
    endAt: Date,
    excludeEntryId?: string
  ): Promise<TimeEntry[]> {
    this.assertCompanyId(companyId);
    this.validateUUID(technicianId, "technicianId");

    // Overlap condition: existing.startAt < newEnd AND existing.endAt > newStart
    // For running entries (endAt is null), they overlap if existing.startAt < newEnd
    const conditions = [
      eq(timeEntries.companyId, companyId),
      eq(timeEntries.technicianId, technicianId),
      lt(timeEntries.startAt, endAt),
      or(
        isNull(timeEntries.endAt), // Running entries overlap with any future time
        sql`${timeEntries.endAt} > ${startAt}`
      ),
    ];

    // Exclude a specific entry (useful for updates)
    if (excludeEntryId) {
      this.validateUUID(excludeEntryId, "excludeEntryId");
      conditions.push(sql`${timeEntries.id} != ${excludeEntryId}`);
    }

    return db
      .select()
      .from(timeEntries)
      .where(and(...conditions))
      .orderBy(asc(timeEntries.startAt));
  }

  /**
   * Create a finished time entry (manual entry with start and end)
   * Validates for overlaps with existing entries
   */
  async createFinishedTimeEntry(
    companyId: string,
    technicianId: string,
    options: {
      type: TimeEntryType;
      jobId?: string | null;
      startAt: Date;
      endAt: Date;
      notes?: string | null;
      billable?: boolean;
      skipOverlapCheck?: boolean;
      overrideApprovalLock?: boolean;
      overrideReason?: string;
      actingUserId?: string;
    }
  ): Promise<TimeEntry> {
    this.assertCompanyId(companyId);
    this.validateUUID(technicianId, "technicianId");
    if (options.jobId) {
      this.validateUUID(options.jobId, "jobId");
    }

    if (options.endAt < options.startAt) {
      throw this.validationError("End time cannot be before start time");
    }

    // Check approval lock
    await this.enforceApprovalLock(companyId, technicianId, options.startAt, {
      overrideApprovalLock: options?.overrideApprovalLock,
      overrideReason: options?.overrideReason,
      actingUserId: options?.actingUserId,
    });

    // Validate no overlaps (unless explicitly skipped for system-generated entries)
    if (!options.skipOverlapCheck) {
      const overlaps = await this.checkTimeEntryOverlap(
        companyId,
        technicianId,
        options.startAt,
        options.endAt
      );
      if (overlaps.length > 0) {
        const overlapInfo = overlaps.map(e =>
          `${e.type} (${e.startAt.toISOString()} - ${e.endAt?.toISOString() ?? 'running'})`
        ).join(", ");
        throw this.conflictError(
          `Time entry overlaps with existing entries: ${overlapInfo}`
        );
      }
    }

    const durationMinutes = Math.round(
      (options.endAt.getTime() - options.startAt.getTime()) / 60000
    );

    // Get billable rate snapshot
    const billableRateSnapshot = await this.getTechnicianBillableRate(companyId, technicianId);
    const costRateSnapshot = await this.getTechnicianCostRate(companyId, technicianId);

    const billable = options.billable ?? BILLABLE_DEFAULTS[options.type];

    const [entry] = await db
      .insert(timeEntries)
      .values({
        companyId,
        technicianId,
        jobId: options.jobId ?? null,
        type: options.type,
        startAt: options.startAt,
        endAt: options.endAt,
        durationMinutes,
        billable,
        billableRateSnapshot,
        costRateSnapshot,
        notes: options.notes,
      })
      .returning();

    return entry;
  }

  /**
   * Get time entry by ID
   */
  async getTimeEntry(companyId: string, timeEntryId: string): Promise<TimeEntry | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(timeEntryId, "timeEntryId");

    const rows = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.id, timeEntryId), eq(timeEntries.companyId, companyId)))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Update time entry (with invoice lock protection)
   * Phase 9: Uses centralized lock check from timeEntryLock utility
   */
  async updateTimeEntry(
    companyId: string,
    timeEntryId: string,
    patch: {
      jobId?: string | null;
      type?: TimeEntryType;
      startAt?: Date;
      endAt?: Date | null;
      billable?: boolean;
      notes?: string | null;
    },
    options?: { overrideInvoiceLock?: boolean }
  ): Promise<TimeEntry> {
    this.assertCompanyId(companyId);
    this.validateUUID(timeEntryId, "timeEntryId");

    const entry = await this.getTimeEntry(companyId, timeEntryId);
    if (!entry) {
      throw this.notFoundError("Time entry");
    }

    // Phase 9: Check lock status using centralized helper
    checkEntryLock(entry, options);

    // Recalculate duration if times changed
    let durationMinutes = entry.durationMinutes;
    const startAt = patch.startAt ?? entry.startAt;
    const endAt = patch.endAt !== undefined ? patch.endAt : entry.endAt;

    if (endAt && startAt) {
      if (endAt < startAt) {
        throw this.validationError("End time cannot be before start time");
      }
      durationMinutes = Math.round((endAt.getTime() - startAt.getTime()) / 60000);
    } else if (endAt === null) {
      durationMinutes = null;
    }

    const [updated] = await db
      .update(timeEntries)
      .set({
        ...patch,
        durationMinutes,
        updatedAt: new Date(),
      })
      .where(eq(timeEntries.id, timeEntryId))
      .returning();

    return updated;
  }

  /**
   * Link time entry to a job (manager tool for unassigned entries)
   */
  async linkTimeEntryToJob(
    companyId: string,
    timeEntryId: string,
    jobId: string,
    options?: {
      overrideInvoiceLock?: boolean;
      overrideApprovalLock?: boolean;
      overrideReason?: string;
      actingUserId?: string;
    }
  ): Promise<TimeEntry> {
    this.assertCompanyId(companyId);
    this.validateUUID(timeEntryId, "timeEntryId");
    this.validateUUID(jobId, "jobId");

    // Get entry to check approval lock
    const entry = await this.getTimeEntry(companyId, timeEntryId);
    if (!entry) {
      throw this.notFoundError("Time entry");
    }

    // Check approval lock
    await this.enforceApprovalLock(companyId, entry.technicianId, entry.startAt, {
      overrideApprovalLock: options?.overrideApprovalLock,
      overrideReason: options?.overrideReason,
      actingUserId: options?.actingUserId,
    });

    // Verify job exists and belongs to company
    const [job] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
      .limit(1);

    if (!job) {
      throw this.notFoundError("Job");
    }

    return this.updateTimeEntry(companyId, timeEntryId, { jobId }, {
      overrideInvoiceLock: options?.overrideInvoiceLock,
    });
  }

  // ============================================================================
  // JOB TIME SUMMARY
  // ============================================================================

  /**
   * Get time summary for a job (aggregated totals and breakdown by technician)
   * Optimized to avoid N+1 queries
   */
  async getJobTimeSummary(companyId: string, jobId: string): Promise<JobTimeSummary> {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    // Get all time entries for the job with technician info
    const entries = await db
      .select({
        id: timeEntries.id,
        technicianId: timeEntries.technicianId,
        technicianName: users.fullName,
        type: timeEntries.type,
        startAt: timeEntries.startAt,
        endAt: timeEntries.endAt,
        durationMinutes: timeEntries.durationMinutes,
        billable: timeEntries.billable,
        invoiceId: timeEntries.invoiceId,
        invoicedAt: timeEntries.invoicedAt,
      })
      .from(timeEntries)
      .leftJoin(users, eq(timeEntries.technicianId, users.id))
      .where(and(eq(timeEntries.companyId, companyId), eq(timeEntries.jobId, jobId)))
      .orderBy(desc(timeEntries.startAt));

    // Calculate totals
    let travelMinutes = 0;
    let onSiteMinutes = 0;
    let otherMinutes = 0;
    let billableMinutes = 0;
    let isRunning = false;
    let runningType: TimeEntryType | null = null;

    // Build technician breakdown map
    const techMap = new Map<
      string,
      {
        technicianId: string;
        technicianName: string | null;
        travelMinutes: number;
        onSiteMinutes: number;
        otherMinutes: number;
        billableMinutes: number;
        isRunning: boolean;
      }
    >();

    for (const entry of entries) {
      const minutes = entry.durationMinutes ?? 0;
      const type = entry.type as TimeEntryType;

      // Get or create tech entry
      if (!techMap.has(entry.technicianId)) {
        techMap.set(entry.technicianId, {
          technicianId: entry.technicianId,
          technicianName: entry.technicianName,
          travelMinutes: 0,
          onSiteMinutes: 0,
          otherMinutes: 0,
          billableMinutes: 0,
          isRunning: false,
        });
      }
      const tech = techMap.get(entry.technicianId)!;

      // Check if running
      if (!entry.endAt) {
        isRunning = true;
        runningType = type;
        tech.isRunning = true;
      }

      // Categorize by type
      if (type === "travel_to_job" || type === "travel_between_jobs") {
        travelMinutes += minutes;
        tech.travelMinutes += minutes;
      } else if (type === "on_site") {
        onSiteMinutes += minutes;
        tech.onSiteMinutes += minutes;
      } else {
        otherMinutes += minutes;
        tech.otherMinutes += minutes;
      }

      // Count billable
      if (entry.billable) {
        billableMinutes += minutes;
        tech.billableMinutes += minutes;
      }
    }

    const totalMinutes = travelMinutes + onSiteMinutes + otherMinutes;

    return {
      jobId,
      travelMinutes,
      onSiteMinutes,
      otherMinutes,
      billableMinutes,
      totalMinutes,
      isRunning,
      runningType,
      technicianBreakdown: Array.from(techMap.values()),
      entries: entries.map((e) => ({
        id: e.id,
        technicianId: e.technicianId,
        type: e.type as TimeEntryType,
        startAt: e.startAt,
        endAt: e.endAt,
        durationMinutes: e.durationMinutes,
        billable: e.billable,
        invoiced: !!e.invoicedAt,
      })),
    };
  }

  // ============================================================================
  // TECHNICIAN JOB STATUS EVENTS
  // ============================================================================

  /**
   * Record a job status event and auto-manage time entries
   *
   * Status transitions and their effects:
   * - en_route: start travel_to_job time entry
   * - arrived: stop travel_to_job, start on_site time entry
   * - paused: stop current running entry
   * - completed: stop on_site time entry
   */
  async recordJobStatus(
    companyId: string,
    technicianId: string,
    jobId: string,
    options: {
      status: TechnicianJobStatus;
      at?: Date;
      notes?: string | null;
      source?: "mobile" | "web";
    }
  ): Promise<{ event: TechnicianJobStatusEvent; timeEntry?: TimeEntry }> {
    this.assertCompanyId(companyId);
    this.validateUUID(technicianId, "technicianId");
    this.validateUUID(jobId, "jobId");

    // Verify job exists and belongs to company (exclude soft-deleted/inactive)
    const [job] = await db
      .select({ id: jobs.id, status: jobs.status })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId), activeJobFilter()))
      .limit(1);

    if (!job) {
      throw this.notFoundError("Job");
    }

    const now = options.at ?? new Date();
    const status = options.status;
    let timeEntry: TimeEntry | undefined;

    // ── Overlap guard: auto-stop any open entry before starting a new one ──
    // This prevents phantom/overlapping segments across all status transitions.
    const autoStopOpen = async (reason: string) => {
      const running = await this.getRunningTimeEntry(companyId, technicianId);
      if (!running) return;

      // Stop the running entry
      await this.stopTimeEntry(companyId, technicianId, {
        timeEntryId: running.id,
        at: now,
      });

      // Record an auto-stop audit event
      await db.insert(technicianJobStatusEvents).values({
        companyId,
        jobId: running.jobId ?? jobId,
        technicianId,
        status: "auto_stop",
        at: now,
        source: options.source ?? "mobile",
        notes: `Auto-stopped ${running.type} entry (${reason}). Previous entry: ${running.id}, job: ${running.jobId}`,
        timeEntryId: running.id,
      });

      console.log(JSON.stringify({
        event: "time_entry_auto_stopped",
        companyId,
        technicianId,
        stoppedEntryId: running.id,
        stoppedType: running.type,
        stoppedJobId: running.jobId,
        reason,
        newStatus: status,
        newJobId: jobId,
        timestamp: now.toISOString(),
      }));
    };

    // Handle status-specific time entry logic
    switch (status) {
      case "en_route":
        // Auto-stop any open entry before starting travel
        await autoStopOpen("tech started en_route to new visit");
        timeEntry = await this.startTimeEntry(companyId, technicianId, {
          type: "travel_to_job",
          jobId,
          at: now,
          notes: options.notes,
        });
        break;

      case "arrived":
        // Auto-stop any open entry (travel or work for any job) before starting on_site
        await autoStopOpen("tech arrived at visit");
        timeEntry = await this.startTimeEntry(companyId, technicianId, {
          type: "on_site",
          jobId,
          at: now,
          notes: options.notes,
        });
        break;

      case "paused":
        // Stop current running entry for this technician
        const pausedEntry = await this.stopTimeEntry(companyId, technicianId, { at: now });
        timeEntry = pausedEntry ?? undefined;
        break;

      case "completed":
        // Stop the open entry for this job (if any)
        const onSiteEntry = await this.getRunningTimeEntry(companyId, technicianId);
        if (onSiteEntry && onSiteEntry.jobId === jobId) {
          timeEntry = (await this.stopTimeEntry(companyId, technicianId, {
            timeEntryId: onSiteEntry.id,
            at: now,
          })) ?? undefined;
        }
        // If no running entry for this job, no-op (don't create phantom entries)
        break;

      case "dispatched":
        // No automatic time entry for dispatched - just record the event
        break;
    }

    // Record the status event
    const [event] = await db
      .insert(technicianJobStatusEvents)
      .values({
        companyId,
        jobId,
        technicianId,
        status,
        at: now,
        source: options.source ?? "mobile",
        notes: options.notes,
        timeEntryId: timeEntry?.id ?? null,
      })
      .returning();

    return { event, timeEntry };
  }

  /**
   * Get job status events for a job
   */
  async getJobStatusEvents(
    companyId: string,
    jobId: string
  ): Promise<TechnicianJobStatusEvent[]> {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    return db
      .select()
      .from(technicianJobStatusEvents)
      .where(
        and(
          eq(technicianJobStatusEvents.companyId, companyId),
          eq(technicianJobStatusEvents.jobId, jobId)
        )
      )
      .orderBy(desc(technicianJobStatusEvents.at));
  }

  // ============================================================================
  // JOB TIME ENTRIES LISTING
  // ============================================================================

  /**
   * Get all time entries for a job (read-only listing)
   * Returns entries with technician name for display
   */
  async getJobTimeEntries(
    companyId: string,
    jobId: string
  ): Promise<
    Array<{
      id: string;
      technicianId: string;
      technicianName: string | null;
      type: TimeEntryType;
      startAt: Date;
      endAt: Date | null;
      durationMinutes: number | null;
      billable: boolean;
      billableRateSnapshot: string | null;
      notes: string | null;
      invoiceId: string | null;
      invoicedAt: Date | null;
      // Phase 9: Lock fields
      lockedAt: Date | null;
      lockedByInvoiceId: string | null;
      lockReason: string | null;
      createdAt: Date;
    }>
  > {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    const entries = await db
      .select({
        id: timeEntries.id,
        technicianId: timeEntries.technicianId,
        technicianName: users.fullName,
        type: timeEntries.type,
        startAt: timeEntries.startAt,
        endAt: timeEntries.endAt,
        durationMinutes: timeEntries.durationMinutes,
        billable: timeEntries.billable,
        billableRateSnapshot: timeEntries.billableRateSnapshot,
        notes: timeEntries.notes,
        invoiceId: timeEntries.invoiceId,
        invoicedAt: timeEntries.invoicedAt,
        // Phase 9: Lock fields
        lockedAt: timeEntries.lockedAt,
        lockedByInvoiceId: timeEntries.lockedByInvoiceId,
        lockReason: timeEntries.lockReason,
        createdAt: timeEntries.createdAt,
      })
      .from(timeEntries)
      .leftJoin(users, eq(timeEntries.technicianId, users.id))
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          eq(timeEntries.jobId, jobId)
        )
      )
      .orderBy(desc(timeEntries.startAt));

    return entries.map((e) => ({
      ...e,
      type: e.type as TimeEntryType,
    }));
  }

  // ============================================================================
  // UNASSIGNED TIME ENTRIES (Phase 3 - Manager Review)
  // ============================================================================

  /**
   * Get unassigned time entries (jobId is null)
   * Used by managers to review and link orphaned time entries
   */
  async getUnassignedTimeEntries(
    companyId: string,
    params?: {
      date?: string; // YYYY-MM-DD, defaults to today
      from?: string; // ISO datetime
      to?: string; // ISO datetime
      technicianId?: string;
      includeRunning?: boolean;
    }
  ): Promise<
    Array<{
      id: string;
      technicianId: string;
      technicianName: string | null;
      type: TimeEntryType;
      startAt: Date;
      endAt: Date | null;
      durationMinutes: number | null;
      billable: boolean;
      billableRateSnapshot: string | null;
      notes: string | null;
      invoiced: boolean;
      // Phase 9: Lock fields
      lockedAt: Date | null;
      lockedByInvoiceId: string | null;
      lockReason: string | null;
      createdAt: Date;
    }>
  > {
    this.assertCompanyId(companyId);

    // Build date range conditions
    let startRange: Date;
    let endRange: Date;

    if (params?.from && params?.to) {
      startRange = new Date(params.from);
      endRange = new Date(params.to);
    } else {
      // Default to today
      const dateStr = params?.date ?? new Date().toISOString().split("T")[0];
      startRange = new Date(dateStr + "T00:00:00Z");
      endRange = new Date(dateStr + "T23:59:59.999Z");
    }

    const conditions: ReturnType<typeof eq>[] = [
      eq(timeEntries.companyId, companyId),
      isNull(timeEntries.jobId), // Unassigned entries only
      gte(timeEntries.startAt, startRange),
      lt(timeEntries.startAt, endRange),
    ];

    // Filter by technician if provided
    if (params?.technicianId) {
      this.validateUUID(params.technicianId, "technicianId");
      conditions.push(eq(timeEntries.technicianId, params.technicianId));
    }

    // Exclude running entries by default
    if (!params?.includeRunning) {
      conditions.push(isNotNull(timeEntries.endAt));
    }

    const entries = await db
      .select({
        id: timeEntries.id,
        technicianId: timeEntries.technicianId,
        technicianName: users.fullName,
        type: timeEntries.type,
        startAt: timeEntries.startAt,
        endAt: timeEntries.endAt,
        durationMinutes: timeEntries.durationMinutes,
        billable: timeEntries.billable,
        billableRateSnapshot: timeEntries.billableRateSnapshot,
        notes: timeEntries.notes,
        invoiceId: timeEntries.invoiceId,
        invoicedAt: timeEntries.invoicedAt,
        // Phase 9: Lock fields
        lockedAt: timeEntries.lockedAt,
        lockedByInvoiceId: timeEntries.lockedByInvoiceId,
        lockReason: timeEntries.lockReason,
        createdAt: timeEntries.createdAt,
      })
      .from(timeEntries)
      .leftJoin(users, eq(timeEntries.technicianId, users.id))
      .where(and(...conditions))
      .orderBy(asc(timeEntries.startAt));

    return entries.map((e) => ({
      id: e.id,
      technicianId: e.technicianId,
      technicianName: e.technicianName,
      type: e.type as TimeEntryType,
      startAt: e.startAt,
      endAt: e.endAt,
      durationMinutes: e.durationMinutes,
      billable: e.billable,
      billableRateSnapshot: e.billableRateSnapshot,
      notes: e.notes,
      invoiced: !!(e.invoiceId || e.invoicedAt),
      // Phase 9: Lock fields
      lockedAt: e.lockedAt,
      lockedByInvoiceId: e.lockedByInvoiceId,
      lockReason: e.lockReason,
      createdAt: e.createdAt,
    }));
  }

  /**
   * Manager-only update for time entries
   * Enforces overlap validation, invoice lock protection, and approval lock
   * Includes structured logging for audit trail
   *
   * PHASE A FIX: Uses SELECT FOR UPDATE within transaction to prevent TOCTOU race
   * Previously: Entry fetched, then validated, then updated (race window)
   * Now: Entry locked with FOR UPDATE, validation and update are atomic
   *
   * Phase 9: Uses centralized lock helpers and records overrides to audit table
   */
  async updateTimeEntryManager(
    companyId: string,
    timeEntryId: string,
    patch: {
      billable?: boolean;
      notes?: string | null;
      type?: TimeEntryType;
      startAt?: Date;
      endAt?: Date | null;
      jobId?: string | null;
    },
    options: {
      overrideInvoiceLock?: boolean;
      overrideApprovalLock?: boolean;
      overrideReason?: string;
      userId: string; // Manager's user ID for audit logging
    }
  ): Promise<TimeEntry> {
    this.assertCompanyId(companyId);
    this.validateUUID(timeEntryId, "timeEntryId");
    this.validateUUID(options.userId, "userId");

    // PHASE A FIX: Use transaction with FOR UPDATE to prevent TOCTOU race
    return await db.transaction(async (tx) => {
      // Lock the time entry row - prevents concurrent modifications
      const [entry] = await tx
        .select()
        .from(timeEntries)
        .where(and(eq(timeEntries.id, timeEntryId), eq(timeEntries.companyId, companyId)))
        .for("update")
        .limit(1);

      if (!entry) {
        throw this.notFoundError("Time entry");
      }

      // Check approval lock (managers can override with reason)
      // Note: enforceApprovalLock is read-only, safe to call in transaction
      await this.enforceApprovalLock(companyId, entry.technicianId, entry.startAt, {
        overrideApprovalLock: options.overrideApprovalLock,
        overrideReason: options.overrideReason,
        actingUserId: options.userId,
      });

      // Phase 9: Use centralized lock check (now under FOR UPDATE lock)
      const entryIsLocked = isEntryLocked(entry);

      // Check lock (throws 409 if locked and no override)
      checkEntryLock(entry, { overrideInvoiceLock: options.overrideInvoiceLock });

      // Require reason if overriding lock
      requireOverrideReason(entry, options.overrideInvoiceLock, options.overrideReason);

      // Validate jobId reassignment: new job must belong to same tenant
      if (patch.jobId !== undefined && patch.jobId !== null) {
        const [targetJob] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.id, patch.jobId), eq(jobs.companyId, companyId)))
          .limit(1);
        if (!targetJob) {
          throw this.notFoundError("Target job for reassignment");
        }
      }

      // Compute new times
      const newStartAt = patch.startAt ?? entry.startAt;
      const newEndAt = patch.endAt !== undefined ? patch.endAt : entry.endAt;

      // Validate time order
      if (newEndAt && newStartAt && newEndAt < newStartAt) {
        throw this.validationError("End time cannot be before start time");
      }

      // If times are changing, check for overlaps
      const timesChanged =
        (patch.startAt && patch.startAt.getTime() !== entry.startAt.getTime()) ||
        (patch.endAt !== undefined &&
          (patch.endAt === null
            ? entry.endAt !== null
            : entry.endAt === null || patch.endAt.getTime() !== entry.endAt.getTime()));

      if (timesChanged && newEndAt) {
        // Check overlaps within transaction (uses same connection)
        const overlaps = await tx
          .select()
          .from(timeEntries)
          .where(
            and(
              eq(timeEntries.companyId, companyId),
              eq(timeEntries.technicianId, entry.technicianId),
              lt(timeEntries.startAt, newEndAt),
              or(
                isNull(timeEntries.endAt),
                sql`${timeEntries.endAt} > ${newStartAt}`
              ),
              sql`${timeEntries.id} != ${timeEntryId}` // Exclude current entry
            )
          );

        if (overlaps.length > 0) {
          const overlapInfo = overlaps
            .map(
              (e) =>
                `${e.type} (${e.startAt.toISOString()} - ${e.endAt?.toISOString() ?? "running"})`
            )
            .join(", ");
          throw this.conflictError(
            `Time entry would overlap with existing entries: ${overlapInfo}`
          );
        }
      }

      // Recalculate duration if times changed
      let durationMinutes = entry.durationMinutes;
      if (newEndAt && newStartAt) {
        durationMinutes = Math.round(
          (newEndAt.getTime() - newStartAt.getTime()) / 60000
        );
      } else if (newEndAt === null) {
        durationMinutes = null;
      }

      // Build update object, only including changed fields
      const updateFields: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (patch.billable !== undefined) updateFields.billable = patch.billable;
      if (patch.notes !== undefined) updateFields.notes = patch.notes;
      if (patch.type !== undefined) updateFields.type = patch.type;
      if (patch.startAt !== undefined) updateFields.startAt = patch.startAt;
      if (patch.endAt !== undefined) updateFields.endAt = patch.endAt;
      if (patch.jobId !== undefined) updateFields.jobId = patch.jobId;
      if (durationMinutes !== entry.durationMinutes)
        updateFields.durationMinutes = durationMinutes;

      // Structured audit logging
      const changedFields = Object.keys(updateFields).filter(
        (k) => k !== "updatedAt" && k !== "durationMinutes"
      );
      const isLockOverride = entryIsLocked && options.overrideInvoiceLock;

      console.log(
        JSON.stringify({
          event: "time_entry_manager_update",
          companyId,
          userId: options.userId,
          timeEntryId,
          technicianId: entry.technicianId,
          changedFields,
          invoiceOverride: isLockOverride,
          overrideReason: options.overrideReason || null,
          timestamp: new Date().toISOString(),
        })
      );

      // Perform the update (within same transaction)
      const [updated] = await tx
        .update(timeEntries)
        .set(updateFields)
        .where(eq(timeEntries.id, timeEntryId))
        .returning();

      // Phase 9: Insert audit row for lock override (within same transaction)
      if (isLockOverride && options.overrideReason) {
        // Create minimal before/after snapshots
        const beforeSnapshot = {
          id: entry.id,
          billable: entry.billable,
          type: entry.type,
          jobId: entry.jobId,
          startAt: entry.startAt?.toISOString(),
          endAt: entry.endAt?.toISOString(),
          durationMinutes: entry.durationMinutes,
          notes: entry.notes,
        };
        const afterSnapshot = {
          id: updated.id,
          billable: updated.billable,
          type: updated.type,
          jobId: updated.jobId,
          startAt: updated.startAt?.toISOString(),
          endAt: updated.endAt?.toISOString(),
          durationMinutes: updated.durationMinutes,
          notes: updated.notes,
        };

        await tx.insert(timeEntryLockOverrides).values({
          companyId,
          timeEntryId,
          invoiceId: getLockingInvoiceId(entry),
          userId: options.userId,
          reason: options.overrideReason,
          beforeJson: JSON.stringify(beforeSnapshot),
          afterJson: JSON.stringify(afterSnapshot),
        });

        console.log(
          JSON.stringify({
            event: "time_entry_lock_override_recorded",
            companyId,
            userId: options.userId,
            timeEntryId,
            invoiceId: getLockingInvoiceId(entry),
            reason: options.overrideReason,
            timestamp: new Date().toISOString(),
          })
        );
      }

      return updated;
    });
  }

  /**
   * Helper to quickly toggle billable status (manager only)
   */
  async setTimeEntryBillable(
    companyId: string,
    timeEntryId: string,
    billable: boolean,
    options: {
      userId: string;
      overrideInvoiceLock?: boolean;
      overrideReason?: string;
    }
  ): Promise<TimeEntry> {
    return this.updateTimeEntryManager(
      companyId,
      timeEntryId,
      { billable },
      options
    );
  }

  /**
   * Delete a time entry (manager/admin only). Hard delete.
   * Validates tenant isolation and checks invoice lock.
   */
  async deleteTimeEntry(
    companyId: string,
    timeEntryId: string,
    options: {
      userId: string;
      overrideInvoiceLock?: boolean;
      overrideReason?: string;
    }
  ): Promise<void> {
    this.assertCompanyId(companyId);
    this.validateUUID(timeEntryId, "timeEntryId");
    this.validateUUID(options.userId, "userId");

    const [entry] = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.id, timeEntryId), eq(timeEntries.companyId, companyId)))
      .limit(1);

    if (!entry) {
      throw this.notFoundError("Time entry");
    }

    // Check invoice lock
    checkEntryLock(entry, { overrideInvoiceLock: options.overrideInvoiceLock });

    // Check approval lock
    await this.enforceApprovalLock(companyId, entry.technicianId, entry.startAt, {
      overrideApprovalLock: true,
      overrideReason: options.overrideReason || "Admin delete",
      actingUserId: options.userId,
    });

    console.log(
      JSON.stringify({
        event: "time_entry_admin_delete",
        companyId,
        userId: options.userId,
        timeEntryId,
        technicianId: entry.technicianId,
        jobId: entry.jobId,
        type: entry.type,
        startAt: entry.startAt?.toISOString(),
        endAt: entry.endAt?.toISOString(),
        durationMinutes: entry.durationMinutes,
        timestamp: new Date().toISOString(),
      })
    );

    await db
      .delete(timeEntries)
      .where(and(eq(timeEntries.id, timeEntryId), eq(timeEntries.companyId, companyId)));
  }

  // ============================================================================
  // INVOICE INTEGRATION
  // ============================================================================

  /**
   * Get uninvoiced billable time entries for a job
   * Used when creating invoice from job to add labor lines
   */
  async getUninvoicedBillableTimeEntriesForJob(
    companyId: string,
    jobId: string
  ): Promise<
    Array<
      TimeEntry & {
        technicianName: string | null;
      }
    >
  > {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    const entries = await db
      .select({
        id: timeEntries.id,
        companyId: timeEntries.companyId,
        technicianId: timeEntries.technicianId,
        workSessionId: timeEntries.workSessionId,
        jobId: timeEntries.jobId,
        type: timeEntries.type,
        startAt: timeEntries.startAt,
        endAt: timeEntries.endAt,
        durationMinutes: timeEntries.durationMinutes,
        billable: timeEntries.billable,
        billableRateSnapshot: timeEntries.billableRateSnapshot,
        costRateSnapshot: timeEntries.costRateSnapshot,
        notes: timeEntries.notes,
        invoiceId: timeEntries.invoiceId,
        invoiceLineId: timeEntries.invoiceLineId,
        invoicedAt: timeEntries.invoicedAt,
        billedMinutesSnapshot: timeEntries.billedMinutesSnapshot,
        billedRateSnapshot: timeEntries.billedRateSnapshot,
        billingRulesHash: timeEntries.billingRulesHash,
        // Phase 9: Lock fields
        lockedAt: timeEntries.lockedAt,
        lockedByInvoiceId: timeEntries.lockedByInvoiceId,
        lockReason: timeEntries.lockReason,
        createdAt: timeEntries.createdAt,
        updatedAt: timeEntries.updatedAt,
        technicianName: users.fullName,
      })
      .from(timeEntries)
      .leftJoin(users, eq(timeEntries.technicianId, users.id))
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          eq(timeEntries.jobId, jobId),
          eq(timeEntries.billable, true),
          isNotNull(timeEntries.endAt), // Only completed entries
          isNull(timeEntries.invoicedAt) // Not yet invoiced
        )
      )
      .orderBy(timeEntries.startAt);

    return entries;
  }

  /**
   * Mark time entries as invoiced
   * Called within invoice creation transaction
   */
  async markTimeEntriesInvoiced(
    companyId: string,
    timeEntryIds: string[],
    invoiceId: string,
    invoiceLineId?: string
  ): Promise<void> {
    this.assertCompanyId(companyId);
    this.validateUUID(invoiceId, "invoiceId");

    if (timeEntryIds.length === 0) return;

    await db
      .update(timeEntries)
      .set({
        invoiceId,
        invoiceLineId: invoiceLineId ?? null,
        invoicedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          sql`${timeEntries.id} = ANY(${timeEntryIds})`
        )
      );
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * Get technician's billable rate from profile
   */
  private async getTechnicianBillableRate(
    companyId: string,
    technicianId: string
  ): Promise<string | null> {
    const [profile] = await db
      .select({ billableRatePerHour: technicianProfiles.billableRatePerHour })
      .from(technicianProfiles)
      .where(eq(technicianProfiles.userId, technicianId))
      .limit(1);

    return profile?.billableRatePerHour ?? null;
  }

  /**
   * Get technician's cost rate from profile
   */
  private async getTechnicianCostRate(
    companyId: string,
    technicianId: string
  ): Promise<string | null> {
    const [profile] = await db
      .select({ laborCostPerHour: technicianProfiles.laborCostPerHour })
      .from(technicianProfiles)
      .where(eq(technicianProfiles.userId, technicianId))
      .limit(1);

    return profile?.laborCostPerHour ?? null;
  }

  /**
   * Get time entries for a technician in a date range
   */
  async getTimeEntriesForTechnician(
    companyId: string,
    technicianId: string,
    startDate: Date,
    endDate: Date
  ): Promise<TimeEntry[]> {
    this.assertCompanyId(companyId);
    this.validateUUID(technicianId, "technicianId");

    return db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          eq(timeEntries.technicianId, technicianId),
          gte(timeEntries.startAt, startDate),
          lt(timeEntries.startAt, endDate)
        )
      )
      .orderBy(desc(timeEntries.startAt));
  }

  /**
   * Get work sessions for a technician in a date range
   */
  async getWorkSessionsForTechnician(
    companyId: string,
    technicianId: string,
    startDate: string,
    endDate: string
  ): Promise<WorkSession[]> {
    this.assertCompanyId(companyId);
    this.validateUUID(technicianId, "technicianId");

    return db
      .select()
      .from(workSessions)
      .where(
        and(
          eq(workSessions.companyId, companyId),
          eq(workSessions.technicianId, technicianId),
          gte(workSessions.workDate, startDate),
          lt(workSessions.workDate, endDate)
        )
      )
      .orderBy(desc(workSessions.workDate));
  }

  // ============================================================================
  // PHASE 4: PAYROLL APPROVAL
  // ============================================================================

  /**
   * Day of week names for display
   */
  private static readonly DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  /**
   * Get week range from a Monday date
   * @param weekStart YYYY-MM-DD (should be a Monday)
   * @returns weekStart, weekEnd, and array of all 7 days
   */
  getWeekRange(weekStart: string): {
    weekStart: string;
    weekEnd: string;
    days: string[];
  } {
    const start = new Date(weekStart + "T00:00:00Z");
    const days: string[] = [];

    for (let i = 0; i < 7; i++) {
      const day = new Date(start);
      day.setUTCDate(start.getUTCDate() + i);
      days.push(day.toISOString().split("T")[0]);
    }

    return {
      weekStart,
      weekEnd: days[6],
      days,
    };
  }

  /**
   * Normalize any date to the Monday of its week
   */
  normalizeToMonday(dateStr: string): string {
    const date = new Date(dateStr + "T00:00:00Z");
    const dayOfWeek = date.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
    const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    date.setUTCDate(date.getUTCDate() - daysToSubtract);
    return date.toISOString().split("T")[0];
  }

  /**
   * Check if a week is approved for a technician
   */
  async isWeekApproved(
    companyId: string,
    technicianId: string,
    weekStart: string
  ): Promise<TimeApproval | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(technicianId, "technicianId");

    const normalizedWeekStart = this.normalizeToMonday(weekStart);

    const [approval] = await db
      .select()
      .from(timeApprovals)
      .where(
        and(
          eq(timeApprovals.companyId, companyId),
          eq(timeApprovals.technicianId, technicianId),
          eq(timeApprovals.weekStart, normalizedWeekStart)
        )
      )
      .limit(1);

    return approval ?? null;
  }

  /**
   * Approve a week for a technician
   * Idempotent: returns existing approval if already approved
   */
  async approveWeek(
    companyId: string,
    technicianId: string,
    weekStart: string,
    approvedByUserId: string,
    options?: { notes?: string | null }
  ): Promise<TimeApproval> {
    this.assertCompanyId(companyId);
    this.validateUUID(technicianId, "technicianId");
    this.validateUUID(approvedByUserId, "approvedByUserId");

    const normalizedWeekStart = this.normalizeToMonday(weekStart);
    const { weekEnd } = this.getWeekRange(normalizedWeekStart);

    // Check if already approved
    const existing = await this.isWeekApproved(companyId, technicianId, normalizedWeekStart);
    if (existing) {
      return existing;
    }

    // Create new approval
    const [approval] = await db
      .insert(timeApprovals)
      .values({
        companyId,
        technicianId,
        weekStart: normalizedWeekStart,
        weekEnd,
        approvedByUserId,
        notes: options?.notes ?? null,
      })
      .returning();

    // Audit log
    console.log(
      JSON.stringify({
        event: "week_approved",
        companyId,
        technicianId,
        weekStart: normalizedWeekStart,
        weekEnd,
        approvedByUserId,
        timestamp: new Date().toISOString(),
      })
    );

    return approval;
  }

  /**
   * Enforce approval lock for a given date
   * Throws 409 if the week containing that date is approved
   */
  async enforceApprovalLock(
    companyId: string,
    technicianId: string,
    targetDate: string | Date,
    options?: { overrideApprovalLock?: boolean; overrideReason?: string; actingUserId?: string }
  ): Promise<void> {
    const dateStr = typeof targetDate === "string"
      ? targetDate.split("T")[0]
      : targetDate.toISOString().split("T")[0];

    const weekStart = this.normalizeToMonday(dateStr);
    const approval = await this.isWeekApproved(companyId, technicianId, weekStart);

    if (approval) {
      if (options?.overrideApprovalLock) {
        if (!options.overrideReason) {
          throw this.validationError("A reason is required when overriding approval lock");
        }

        // Log the override
        console.log(
          JSON.stringify({
            event: "approval_lock_override",
            companyId,
            technicianId,
            weekStart,
            actingUserId: options.actingUserId,
            reason: options.overrideReason,
            timestamp: new Date().toISOString(),
          })
        );
        return; // Allow the operation
      }

      throw this.conflictError(
        `Week ${weekStart} is approved and locked. Cannot modify time entries or work sessions.`
      );
    }
  }

  /**
   * Get weekly payroll summary for all technicians (or one technician)
   */
  async getWeeklyPayrollSummary(
    companyId: string,
    weekStart: string,
    options?: { technicianId?: string }
  ): Promise<TechnicianWeeklySummary[]> {
    this.assertCompanyId(companyId);

    const normalizedWeekStart = this.normalizeToMonday(weekStart);
    const { weekEnd, days } = this.getWeekRange(normalizedWeekStart);

    // Build technician filter
    const techFilter = options?.technicianId
      ? eq(workSessions.technicianId, options.technicianId)
      : sql`1=1`;

    const techFilterEntries = options?.technicianId
      ? eq(timeEntries.technicianId, options.technicianId)
      : sql`1=1`;

    // Query 1: Work sessions grouped by technician + date
    const sessionsData = await db
      .select({
        technicianId: workSessions.technicianId,
        technicianName: users.fullName,
        workDate: workSessions.workDate,
        clockInAt: workSessions.clockInAt,
        clockOutAt: workSessions.clockOutAt,
        breakMinutes: workSessions.breakMinutes,
      })
      .from(workSessions)
      .leftJoin(users, eq(workSessions.technicianId, users.id))
      .where(
        and(
          eq(workSessions.companyId, companyId),
          gte(workSessions.workDate, normalizedWeekStart),
          lte(workSessions.workDate, weekEnd),
          isNotNull(workSessions.clockOutAt),
          techFilter
        )
      );

    // Query 2: Time entries grouped by technician + date
    // We need to extract date from startAt
    const entriesData = await db
      .select({
        technicianId: timeEntries.technicianId,
        technicianName: users.fullName,
        startAt: timeEntries.startAt,
        durationMinutes: timeEntries.durationMinutes,
        billable: timeEntries.billable,
      })
      .from(timeEntries)
      .leftJoin(users, eq(timeEntries.technicianId, users.id))
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          gte(timeEntries.startAt, new Date(normalizedWeekStart + "T00:00:00Z")),
          lt(timeEntries.startAt, new Date(weekEnd + "T23:59:59.999Z")),
          isNotNull(timeEntries.endAt), // Only completed entries
          techFilterEntries
        )
      );

    // Query 3: Approvals for the week
    const approvalsData = await db
      .select({
        technicianId: timeApprovals.technicianId,
        approvedAt: timeApprovals.approvedAt,
        approvedByName: users.fullName,
      })
      .from(timeApprovals)
      .leftJoin(users, eq(timeApprovals.approvedByUserId, users.id))
      .where(
        and(
          eq(timeApprovals.companyId, companyId),
          eq(timeApprovals.weekStart, normalizedWeekStart),
          options?.technicianId
            ? eq(timeApprovals.technicianId, options.technicianId)
            : sql`1=1`
        )
      );

    // Build approval map
    const approvalMap = new Map<string, { approvedAt: Date; approvedByName: string | null }>();
    for (const a of approvalsData) {
      approvalMap.set(a.technicianId, {
        approvedAt: a.approvedAt,
        approvedByName: a.approvedByName,
      });
    }

    // Aggregate sessions by tech + date
    const techDailyWorked = new Map<string, Map<string, number>>();
    const techNames = new Map<string, string | null>();

    for (const s of sessionsData) {
      techNames.set(s.technicianId, s.technicianName);

      if (!techDailyWorked.has(s.technicianId)) {
        techDailyWorked.set(s.technicianId, new Map());
      }
      const dailyMap = techDailyWorked.get(s.technicianId)!;

      // Calculate worked minutes for this session
      const clockIn = new Date(s.clockInAt).getTime();
      const clockOut = new Date(s.clockOutAt!).getTime();
      const workedMs = clockOut - clockIn;
      const workedMinutes = Math.round(workedMs / 60000) - (s.breakMinutes ?? 0);

      const current = dailyMap.get(s.workDate) ?? 0;
      dailyMap.set(s.workDate, current + Math.max(0, workedMinutes));
    }

    // Aggregate entries by tech + date
    const techDailyTracked = new Map<string, Map<string, number>>();
    const techDailyBillable = new Map<string, Map<string, number>>();

    for (const e of entriesData) {
      techNames.set(e.technicianId, e.technicianName);

      if (!techDailyTracked.has(e.technicianId)) {
        techDailyTracked.set(e.technicianId, new Map());
      }
      if (!techDailyBillable.has(e.technicianId)) {
        techDailyBillable.set(e.technicianId, new Map());
      }

      const dateStr = e.startAt.toISOString().split("T")[0];
      const trackedMap = techDailyTracked.get(e.technicianId)!;
      const billableMap = techDailyBillable.get(e.technicianId)!;

      const mins = e.durationMinutes ?? 0;
      const currentTracked = trackedMap.get(dateStr) ?? 0;
      trackedMap.set(dateStr, currentTracked + mins);

      if (e.billable) {
        const currentBillable = billableMap.get(dateStr) ?? 0;
        billableMap.set(dateStr, currentBillable + mins);
      }
    }

    // Build result for each technician
    const allTechIds = new Set([
      ...Array.from(techDailyWorked.keys()),
      ...Array.from(techDailyTracked.keys()),
    ]);

    const summaries: TechnicianWeeklySummary[] = [];

    for (const techId of Array.from(allTechIds)) {
      const workedMap = techDailyWorked.get(techId) ?? new Map<string, number>();
      const trackedMap = techDailyTracked.get(techId) ?? new Map<string, number>();
      const billableMap = techDailyBillable.get(techId) ?? new Map<string, number>();

      const daily: DailyPayrollBreakdown[] = [];
      let totalWorked = 0;
      let totalTracked = 0;
      let totalBillable = 0;

      for (const day of days) {
        const worked = workedMap.get(day) ?? 0;
        const tracked = trackedMap.get(day) ?? 0;
        const billable = billableMap.get(day) ?? 0;

        const date = new Date(day + "T00:00:00Z");
        const dayOfWeek = TimeTrackingRepository.DAY_NAMES[date.getUTCDay()];

        daily.push({
          date: day,
          dayOfWeek,
          workedMinutes: worked,
          trackedMinutes: tracked,
          billableMinutes: billable,
        });

        totalWorked += worked;
        totalTracked += tracked;
        totalBillable += billable;
      }

      const approval = approvalMap.get(techId);

      summaries.push({
        technicianId: techId,
        technicianName: techNames.get(techId) ?? null,
        weekStart: normalizedWeekStart,
        weekEnd,
        totals: {
          workedMinutes: totalWorked,
          trackedMinutes: totalTracked,
          billableMinutes: totalBillable,
          untrackedMinutesRaw: totalWorked - totalTracked,
        },
        daily,
        approved: !!approval,
        approvedAt: approval?.approvedAt ?? null,
        approvedByName: approval?.approvedByName ?? null,
      });
    }

    // Sort by technician name
    summaries.sort((a, b) =>
      (a.technicianName ?? "").localeCompare(b.technicianName ?? "")
    );

    return summaries;
  }

  /**
   * Generate CSV content for weekly payroll export
   */
  generatePayrollCsv(summaries: TechnicianWeeklySummary[]): string {
    // Helper to format minutes as decimal hours
    const toHours = (mins: number) => (mins / 60).toFixed(2);

    // Header row
    const headers = [
      "Technician Name",
      "Technician ID",
      "Week Start",
      "Week End",
      "Worked Hours",
      "Tracked Hours",
      "Billable Hours",
      "Untracked Hours",
      "Approved",
    ];

    // Add day columns
    const dayAbbrevs = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    for (const day of dayAbbrevs) {
      headers.push(`${day} Worked`);
      headers.push(`${day} Tracked`);
      headers.push(`${day} Billable`);
    }

    const rows: string[] = [headers.join(",")];

    for (const s of summaries) {
      const row: string[] = [
        `"${(s.technicianName ?? "Unknown").replace(/"/g, '""')}"`,
        s.technicianId,
        s.weekStart,
        s.weekEnd,
        toHours(s.totals.workedMinutes),
        toHours(s.totals.trackedMinutes),
        toHours(s.totals.billableMinutes),
        toHours(Math.max(0, s.totals.untrackedMinutesRaw)),
        s.approved ? "Yes" : "No",
      ];

      // Add daily breakdown (Mon-Sun order)
      // The daily array is already in order Mon-Sun based on how we built it
      for (const day of s.daily) {
        row.push(toHours(day.workedMinutes));
        row.push(toHours(day.trackedMinutes));
        row.push(toHours(day.billableMinutes));
      }

      rows.push(row.join(","));
    }

    return rows.join("\n");
  }

  // ============================================================================
  // ANALYTICS (Phase 5)
  // ============================================================================

  /**
   * Get weekly analytics data for time tracking
   * Returns aggregated data per week for worked, tracked, billable, unassigned, and by-type minutes
   */
  async getWeeklyAnalytics(
    companyId: string,
    params: {
      weeks?: number;
      weekStart?: string;
      technicianId?: string;
    } = {}
  ): Promise<WeeklyAnalyticsResponse> {
    this.assertCompanyId(companyId);

    const numWeeks = Math.min(Math.max(params.weeks ?? 8, 1), 26);
    const anchorWeekStart = params.weekStart
      ? this.normalizeToMonday(params.weekStart)
      : this.normalizeToMonday(new Date().toISOString().split("T")[0]);

    // Calculate the range of weeks (going backwards from anchor)
    const weekRanges: { weekStart: string; weekEnd: string }[] = [];
    let currentMonday = new Date(anchorWeekStart + "T00:00:00Z");

    for (let i = 0; i < numWeeks; i++) {
      const { weekStart, weekEnd } = this.getWeekRange(
        currentMonday.toISOString().split("T")[0]
      );
      weekRanges.unshift({ weekStart, weekEnd }); // Add to front for chronological order
      currentMonday.setDate(currentMonday.getDate() - 7);
    }

    const oldestWeekStart = weekRanges[0].weekStart;
    const newestWeekEnd = weekRanges[weekRanges.length - 1].weekEnd;

    // Build technician filter
    const techFilter = params.technicianId
      ? eq(workSessions.technicianId, params.technicianId)
      : sql`1=1`;
    const techFilterEntries = params.technicianId
      ? eq(timeEntries.technicianId, params.technicianId)
      : sql`1=1`;

    // Query 1: Work sessions grouped by week
    // work_date is already YYYY-MM-DD, just need to normalize to Monday
    const workSessionsQuery = await db
      .select({
        workDate: workSessions.workDate,
        technicianId: workSessions.technicianId,
        clockInAt: workSessions.clockInAt,
        clockOutAt: workSessions.clockOutAt,
        breakMinutes: workSessions.breakMinutes,
      })
      .from(workSessions)
      .where(
        and(
          eq(workSessions.companyId, companyId),
          gte(workSessions.workDate, oldestWeekStart),
          lte(workSessions.workDate, newestWeekEnd),
          isNotNull(workSessions.clockOutAt), // Exclude open sessions
          techFilter
        )
      );

    // Query 2: Time entries grouped by week, type, and jobId null status
    // Only include entries with endAt (not running)
    const timeEntriesQuery = await db
      .select({
        id: timeEntries.id,
        technicianId: timeEntries.technicianId,
        startAt: timeEntries.startAt,
        endAt: timeEntries.endAt,
        type: timeEntries.type,
        billable: timeEntries.billable,
        jobId: timeEntries.jobId,
        durationMinutes: timeEntries.durationMinutes,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          gte(timeEntries.startAt, new Date(oldestWeekStart + "T00:00:00Z")),
          lt(timeEntries.startAt, new Date(newestWeekEnd + "T23:59:59Z")),
          isNotNull(timeEntries.endAt), // Exclude running entries
          techFilterEntries
        )
      );

    // Initialize week data map
    const weekDataMap = new Map<string, {
      workedMinutes: number;
      trackedMinutes: number;
      billableMinutes: number;
      unassignedMinutes: number;
      byType: Map<string, number>;
    }>();

    for (const week of weekRanges) {
      weekDataMap.set(week.weekStart, {
        workedMinutes: 0,
        trackedMinutes: 0,
        billableMinutes: 0,
        unassignedMinutes: 0,
        byType: new Map<string, number>(),
      });
    }

    // Process work sessions
    for (const ws of workSessionsQuery) {
      const weekStart = this.normalizeToMonday(ws.workDate);
      const data = weekDataMap.get(weekStart);
      if (!data) continue;

      // Calculate worked minutes
      if (ws.clockInAt && ws.clockOutAt) {
        const clockInTime = new Date(ws.clockInAt).getTime();
        const clockOutTime = new Date(ws.clockOutAt).getTime();
        const totalMinutes = Math.floor((clockOutTime - clockInTime) / 60000);
        const breakMins = ws.breakMinutes ?? 0;
        data.workedMinutes += Math.max(0, totalMinutes - breakMins);
      }
    }

    // Process time entries
    for (const entry of timeEntriesQuery) {
      const entryDate = entry.startAt.toISOString().split("T")[0];
      const weekStart = this.normalizeToMonday(entryDate);
      const data = weekDataMap.get(weekStart);
      if (!data) continue;

      const duration = entry.durationMinutes ?? 0;
      data.trackedMinutes += duration;

      if (entry.billable) {
        data.billableMinutes += duration;
      }

      if (!entry.jobId) {
        data.unassignedMinutes += duration;
      }

      // Aggregate by type
      const currentTypeMinutes = data.byType.get(entry.type) ?? 0;
      data.byType.set(entry.type, currentTypeMinutes + duration);
    }

    // Build result
    const weeks: WeeklyAnalyticsData[] = [];
    let totalWorked = 0;
    let totalTracked = 0;
    let totalBillable = 0;
    let totalUnassigned = 0;

    for (const weekRange of weekRanges) {
      const data = weekDataMap.get(weekRange.weekStart)!;

      const byTypeMinutes: TimeByTypeBreakdown = {
        travel_to_job: data.byType.get("travel_to_job") ?? 0,
        on_site: data.byType.get("on_site") ?? 0,
        travel_to_supplier: data.byType.get("travel_to_supplier") ?? 0,
        supplier_run: data.byType.get("supplier_run") ?? 0,
        travel_between_jobs: data.byType.get("travel_between_jobs") ?? 0,
        admin: data.byType.get("admin") ?? 0,
        break: data.byType.get("break") ?? 0,
        other: data.byType.get("other") ?? 0,
      };

      const travelMinutes =
        byTypeMinutes.travel_to_job +
        byTypeMinutes.travel_to_supplier +
        byTypeMinutes.travel_between_jobs;

      const supplierMinutes =
        byTypeMinutes.travel_to_supplier +
        byTypeMinutes.supplier_run;

      const untrackedMinutesRaw = data.workedMinutes - data.trackedMinutes;

      weeks.push({
        weekStart: weekRange.weekStart,
        weekEnd: weekRange.weekEnd,
        workedMinutes: data.workedMinutes,
        trackedMinutes: data.trackedMinutes,
        billableMinutes: data.billableMinutes,
        untrackedMinutesRaw,
        unassignedMinutes: data.unassignedMinutes,
        byTypeMinutes,
        travelMinutes,
        onSiteMinutes: byTypeMinutes.on_site,
        supplierMinutes,
        adminMinutes: byTypeMinutes.admin,
        breakMinutes: byTypeMinutes.break,
        otherMinutes: byTypeMinutes.other,
      });

      totalWorked += data.workedMinutes;
      totalTracked += data.trackedMinutes;
      totalBillable += data.billableMinutes;
      totalUnassigned += data.unassignedMinutes;
    }

    return {
      weeks,
      totals: {
        workedMinutes: totalWorked,
        trackedMinutes: totalTracked,
        billableMinutes: totalBillable,
        untrackedMinutesRaw: totalWorked - totalTracked,
        unassignedMinutes: totalUnassigned,
      },
    };
  }

  /**
   * Get technician-level analytics for a specific week
   */
  async getTechnicianAnalytics(
    companyId: string,
    params: {
      weekStart: string;
      technicianId?: string;
    }
  ): Promise<TechnicianAnalyticsResponse> {
    this.assertCompanyId(companyId);

    const normalizedWeekStart = this.normalizeToMonday(params.weekStart);
    const { weekEnd } = this.getWeekRange(normalizedWeekStart);

    // Build technician filter
    const techFilter = params.technicianId
      ? eq(workSessions.technicianId, params.technicianId)
      : sql`1=1`;
    const techFilterEntries = params.technicianId
      ? eq(timeEntries.technicianId, params.technicianId)
      : sql`1=1`;

    // Query work sessions for the week
    const workSessionsQuery = await db
      .select({
        technicianId: workSessions.technicianId,
        clockInAt: workSessions.clockInAt,
        clockOutAt: workSessions.clockOutAt,
        breakMinutes: workSessions.breakMinutes,
      })
      .from(workSessions)
      .where(
        and(
          eq(workSessions.companyId, companyId),
          gte(workSessions.workDate, normalizedWeekStart),
          lte(workSessions.workDate, weekEnd),
          isNotNull(workSessions.clockOutAt),
          techFilter
        )
      );

    // Query time entries for the week
    const timeEntriesQuery = await db
      .select({
        technicianId: timeEntries.technicianId,
        type: timeEntries.type,
        billable: timeEntries.billable,
        jobId: timeEntries.jobId,
        durationMinutes: timeEntries.durationMinutes,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          gte(timeEntries.startAt, new Date(normalizedWeekStart + "T00:00:00Z")),
          lt(timeEntries.startAt, new Date(weekEnd + "T23:59:59Z")),
          isNotNull(timeEntries.endAt),
          techFilterEntries
        )
      );

    // Get technician info
    const techniciansQuery = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(users)
      .innerJoin(technicianProfiles, eq(users.id, technicianProfiles.userId))
      .where(
        and(
          eq(users.companyId, companyId),
          params.technicianId ? eq(users.id, params.technicianId) : sql`1=1`
        )
      );

    const techNameMap = new Map<string, string>();
    for (const t of techniciansQuery) {
      const name = t.firstName && t.lastName
        ? `${t.firstName} ${t.lastName}`
        : t.firstName || t.lastName || t.email;
      techNameMap.set(t.id, name);
    }

    // Initialize per-technician data
    const techDataMap = new Map<string, {
      workedMinutes: number;
      trackedMinutes: number;
      billableMinutes: number;
      unassignedMinutes: number;
      byType: Map<string, number>;
    }>();

    // Process work sessions
    for (const ws of workSessionsQuery) {
      if (!techDataMap.has(ws.technicianId)) {
        techDataMap.set(ws.technicianId, {
          workedMinutes: 0,
          trackedMinutes: 0,
          billableMinutes: 0,
          unassignedMinutes: 0,
          byType: new Map<string, number>(),
        });
      }
      const data = techDataMap.get(ws.technicianId)!;

      if (ws.clockInAt && ws.clockOutAt) {
        const clockInTime = new Date(ws.clockInAt).getTime();
        const clockOutTime = new Date(ws.clockOutAt).getTime();
        const totalMinutes = Math.floor((clockOutTime - clockInTime) / 60000);
        const breakMins = ws.breakMinutes ?? 0;
        data.workedMinutes += Math.max(0, totalMinutes - breakMins);
      }
    }

    // Process time entries
    for (const entry of timeEntriesQuery) {
      if (!techDataMap.has(entry.technicianId)) {
        techDataMap.set(entry.technicianId, {
          workedMinutes: 0,
          trackedMinutes: 0,
          billableMinutes: 0,
          unassignedMinutes: 0,
          byType: new Map<string, number>(),
        });
      }
      const data = techDataMap.get(entry.technicianId)!;

      const duration = entry.durationMinutes ?? 0;
      data.trackedMinutes += duration;

      if (entry.billable) {
        data.billableMinutes += duration;
      }

      if (!entry.jobId) {
        data.unassignedMinutes += duration;
      }

      const currentTypeMinutes = data.byType.get(entry.type) ?? 0;
      data.byType.set(entry.type, currentTypeMinutes + duration);
    }

    // Build result
    const technicians: TechnicianAnalytics[] = [];

    for (const [techId, data] of Array.from(techDataMap.entries())) {
      const travelMinutes =
        (data.byType.get("travel_to_job") ?? 0) +
        (data.byType.get("travel_to_supplier") ?? 0) +
        (data.byType.get("travel_between_jobs") ?? 0);

      const supplierMinutes =
        (data.byType.get("travel_to_supplier") ?? 0) +
        (data.byType.get("supplier_run") ?? 0);

      const billablePct = data.trackedMinutes > 0
        ? Math.round((data.billableMinutes / data.trackedMinutes) * 100)
        : 0;

      technicians.push({
        technicianId: techId,
        technicianName: techNameMap.get(techId) ?? null,
        workedMinutes: data.workedMinutes,
        trackedMinutes: data.trackedMinutes,
        billableMinutes: data.billableMinutes,
        untrackedMinutesRaw: data.workedMinutes - data.trackedMinutes,
        unassignedMinutes: data.unassignedMinutes,
        billablePct,
        travelMinutes,
        onSiteMinutes: data.byType.get("on_site") ?? 0,
        supplierMinutes,
        adminMinutes: data.byType.get("admin") ?? 0,
        breakMinutes: data.byType.get("break") ?? 0,
        otherMinutes: data.byType.get("other") ?? 0,
      });
    }

    // Sort by technician name
    technicians.sort((a, b) =>
      (a.technicianName ?? "").localeCompare(b.technicianName ?? "")
    );

    return {
      weekStart: normalizedWeekStart,
      weekEnd,
      technicians,
    };
  }
}

export const timeTrackingRepository = new TimeTrackingRepository();
