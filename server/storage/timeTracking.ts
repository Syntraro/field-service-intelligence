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
import { eq, and, sql, desc, isNull, isNotNull, lt, gte, or, asc, lte, inArray } from "drizzle-orm";
import { activeJobFilter, activeWorkJobFilter } from "./jobFilters";
import {
  workSessions,
  timeEntries,
  technicianJobStatusEvents,
  timeApprovals,
  timeEntryLockOverrides,
  users,
  technicianProfiles,
  jobs,
  clientLocations,
  customerCompanies,
  jobVisits,
  type WorkSession,
  type TimeEntry,
  type TechnicianJobStatusEvent,
  type TimeApproval,
  type TimeEntryType,
  type TechnicianJobStatus,
  type JobTimeSummary,
  type TechnicianWeeklySummary,
  type DailyPayrollBreakdown,
} from "@shared/schema";
import { BaseRepository } from "./base";
import { resolveTechnicianName } from "../lib/resolveTechnicianName";
// 2026-05-01: canonical location-name resolver for tech day-view + week-view.
import { locationDisplayNameExpr } from "../lib/queryHelpers";
// 2026-05-04: tenant-user containment predicate.
import { nonPlatformUserPredicate } from "./tenantUserPredicate";
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
  task_work: true, // 2026-04-10: default billable, overridden by task.isBillable at route level
  other: false,
};

/**
 * Derive the source type of a time entry from its attribution fields.
 * Used in output shapes so consumers don't infer source from nullable columns.
 */
function deriveSourceType(
  type: string,
  taskId: string | null,
  visitId: string | null,
): "visit" | "task" | "manual" {
  if (type === "task_work" && taskId) return "task";
  if (visitId) return "visit";
  return "manual";
}

/**
 * Canonical duration helper for work sessions (payroll/timesheet source of truth).
 * Returns worked minutes = (clockOut - clockIn) - breaks.
 * Open sessions (no clockOut) return 0 for server-side totals.
 * Never returns negative.
 */
export function sessionDurationMinutes(session: {
  clockInAt: Date | string;
  clockOutAt: Date | string | null;
  breakMinutes: number | null;
}): number {
  if (!session.clockOutAt) return 0;
  const start = session.clockInAt instanceof Date ? session.clockInAt.getTime() : new Date(session.clockInAt).getTime();
  const end = session.clockOutAt instanceof Date ? session.clockOutAt.getTime() : new Date(session.clockOutAt).getTime();
  const raw = Math.round((end - start) / 60000) - (session.breakMinutes ?? 0);
  return Math.max(0, raw);
}

/**
 * Sum duration of multiple work sessions for a day/range.
 */
export function sumSessionMinutes(sessions: Array<{ clockInAt: Date | string; clockOutAt: Date | string | null; breakMinutes: number | null }>): number {
  return sessions.reduce((sum, s) => sum + sessionDurationMinutes(s), 0);
}

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
   * Clock in - creates a new work session for today.
   *
   * 2026-04-08: `workDateOverride` accepted from the route layer so the
   * stored `workDate` matches the tenant timezone (the same convention
   * `getOpenWorkSession` and the Today screen already use). Without this,
   * the inline UTC fallback can drift from the tenant's local "today",
   * which produced the "Today screen says Not Clocked In + clock-in
   * throws already-has-open-session" deadlock for tenants in non-UTC
   * timezones during the local-vs-UTC date offset window.
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
      /**
       * Tenant-timezone YYYY-MM-DD date string. When provided, used as the
       * stored `workDate` for the new session AND for the same-day collision
       * check against any existing open session. The route at
       * `server/routes/timeTracking.ts` resolves the tenant timezone via
       * `companyRepository.getCompanyTimezone` and passes the local date.
       * Falls back to UTC date string if not provided (legacy callers /
       * direct storage usage / scripts) so behavior is unchanged for them.
       */
      workDateOverride?: string;
    }
  ): Promise<WorkSession> {
    this.assertCompanyId(companyId);
    this.validateUUID(technicianId, "technicianId");

    const now = options?.at ?? new Date();
    // Prefer the tenant-timezone date string passed by the route layer.
    // Falls back to UTC for legacy/direct callers; the route always sets it.
    const workDate =
      options?.workDateOverride ?? now.toISOString().split("T")[0]; // YYYY-MM-DD

    // Check approval lock
    await this.enforceApprovalLock(companyId, technicianId, workDate, {
      overrideApprovalLock: options?.overrideApprovalLock,
      overrideReason: options?.overrideReason,
      actingUserId: options?.actingUserId,
    });

    // Check for existing open session — auto-close stale prior-day sessions
    const existingOpen = await this.getAnyOpenWorkSession(companyId, technicianId);
    if (existingOpen) {
      if (existingOpen.workDate === workDate) {
        // Same-day open session → genuine duplicate clock-in, block it
        throw this.conflictError(
          `Technician already has an open session from ${existingOpen.workDate}. ` +
            `Please clock out first.`
        );
      }
      // Prior-day open session → auto-close at midnight of that day
      // This handles the common case where a tech forgot to clock out
      const priorDayMidnight = new Date(existingOpen.workDate + "T23:59:59.000Z");
      await db
        .update(workSessions)
        .set({
          clockOutAt: priorDayMidnight,
          notes: existingOpen.notes
            ? `${existingOpen.notes} [auto-closed: prior-day session]`
            : "[auto-closed: prior-day session]",
          updatedAt: new Date(),
        })
        .where(eq(workSessions.id, existingOpen.id));
      // Also stop any running time entries from the stale session
      await this.stopRunningTimeEntry(companyId, technicianId, { at: priorDayMidnight });
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
  async getTechnicianTodayStatus(companyId: string, technicianId: string, todayDateStr?: string, tzDayStart?: Date, tzDayEnd?: Date) {
    this.assertCompanyId(companyId);
    this.validateUUID(technicianId, "technicianId");

    // Use tenant-timezone-aware bounds if provided, otherwise fall back to UTC
    const today = todayDateStr ?? new Date().toISOString().split("T")[0];
    const startOfToday = tzDayStart ?? new Date(today + "T00:00:00Z");
    const endOfToday = tzDayEnd ?? new Date(today + "T23:59:59Z");

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

    // Payroll/timesheet totals: worked hours from work_sessions (not time_entries)
    const todaySessions = await db
      .select()
      .from(workSessions)
      .where(
        and(
          eq(workSessions.companyId, companyId),
          eq(workSessions.technicianId, technicianId),
          eq(workSessions.workDate, today),
        )
      );
    const totalMinutes = sumSessionMinutes(todaySessions);

    // Billable minutes remain from time_entries (labor classification, not payroll)
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
   * Start a new time entry.
   *
   * 2026-04-10 HARDENING: Mode-based timer enforcement.
   *
   * mode: "strict" (DEFAULT)
   *   - If an active timer exists for this tech → THROW 409.
   *   - Used by: task start, office manual start, any new-context entry.
   *   - Caller must explicitly stop the running entry first if intended.
   *
   * mode: "transition"
   *   - Auto-stops the running entry before inserting the new one.
   *   - Used ONLY by recordJobStatus (visit lifecycle) where sequential
   *     transitions (travel→on_site, pause→resume) are canonical.
   *   - recordJobStatus already does its own autoStopOpen() pre-check;
   *     transition mode is the safety net inside the insert tx.
   */
  async startTimeEntry(
    companyId: string,
    technicianId: string,
    options: {
      type: TimeEntryType;
      jobId?: string | null;
      taskId?: string | null;
      visitId?: string | null;
      notes?: string | null;
      billable?: boolean;
      at?: Date;
      mode?: "strict" | "transition";
      overrideApprovalLock?: boolean;
      overrideReason?: string;
      actingUserId?: string;
    }
  ): Promise<TimeEntry> {
    this.assertCompanyId(companyId);
    this.validateUUID(technicianId, "technicianId");

    const mode = options.mode ?? "strict";

    // If jobId provided, validate it references an active open job
    if (options.jobId) {
      this.validateUUID(options.jobId, "jobId");
      const [targetJob] = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.id, options.jobId), eq(jobs.companyId, companyId), activeWorkJobFilter()))
        .limit(1);
      if (!targetJob) {
        throw this.notFoundError("Job not found or is closed/inactive");
      }
    }

    const now = options.at ?? new Date();

    // ── Mode-based enforcement ──
    if (mode === "strict") {
      // Hard block if any active timer exists
      const running = await this.getRunningTimeEntry(companyId, technicianId);
      if (running) {
        // 2026-04-10: Structured 409 with ACTIVE_TIMER_EXISTS code + context
        const err = this.conflictError("Cannot start: another timer is already running. Stop it first.");
        (err as any).code = "ACTIVE_TIMER_EXISTS";
        (err as any).activeItem = {
          type: running.taskId ? "task" : "visit",
          id: running.taskId ?? running.jobId,
          entryType: running.type,
          jobId: running.jobId,
          taskId: running.taskId,
          notes: running.notes,
        };
        throw err;
      }
    } else {
      // Transition mode: validate the running entry is a valid transition source.
      // Only visit-to-visit transitions within the same job are allowed.
      const running = await this.getRunningTimeEntry(companyId, technicianId);
      if (running) {
        // 2026-04-10 LOCKDOWN: transition mode must NOT stop task_work entries
        if (running.type === "task_work") {
          throw this.conflictError(
            `Cannot transition: active timer is a task entry (task: ${running.taskId}). ` +
            `Stop the task timer first.`
          );
        }
        // Must be same job context
        if (running.jobId !== options.jobId) {
          throw this.conflictError(
            `Cannot transition: active timer is for job ${running.jobId}, ` +
            `but new entry targets job ${options.jobId}. Stop the running timer first.`
          );
        }
        // Validate allowed type pair
        const VALID_TRANSITIONS: Record<string, string[]> = {
          travel_to_job: ["on_site"],
          on_site: ["on_site"],           // pause→resume creates a new on_site
          travel_to_supplier: ["supplier_run"],
          travel_between_jobs: ["on_site", "travel_to_job"],
        };
        const allowed = VALID_TRANSITIONS[running.type];
        if (!allowed || !allowed.includes(options.type)) {
          throw this.conflictError(
            `Invalid transition: ${running.type} → ${options.type} is not allowed.`
          );
        }
      }
      // If no running entry, transition mode proceeds normally (no-op auto-stop)
    }

    // Check approval lock (read-only, safe outside tx)
    await this.enforceApprovalLock(companyId, technicianId, now, {
      overrideApprovalLock: options?.overrideApprovalLock,
      overrideReason: options?.overrideReason,
      actingUserId: options?.actingUserId,
    });

    // Get billable rate snapshot from technician profile (read-only, safe outside tx)
    const billableRateSnapshot = await this.getTechnicianBillableRate(companyId, technicianId);
    const costRateSnapshot = await this.getTechnicianCostRate(companyId, technicianId);
    const billable = options.billable ?? BILLABLE_DEFAULTS[options.type];
    const today = now.toISOString().split("T")[0];
    const openSession = await this.getOpenWorkSession(companyId, technicianId, today);

    // Transaction: insert new entry (transition mode auto-stops first)
    return this.tx(async (txDb) => {
      if (mode === "transition") {
        // Visit lifecycle: auto-stop running entry within the same transaction
        await this.stopRunningTimeEntry(companyId, technicianId, { at: now, txDb });
      }

      const [entry] = await txDb
        .insert(timeEntries)
        .values({
          companyId,
          technicianId,
          workSessionId: openSession?.id ?? null,
          jobId: options.jobId ?? null,
          taskId: options.taskId ?? null,
          visitId: options.visitId ?? null,
          type: options.type,
          startAt: now,
          billable,
          billableRateSnapshot,
          costRateSnapshot,
          notes: options.notes,
        })
        .returning();

      return entry;
    });
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

    if (endAt < entry.startAt) {
      throw this.validationError("End time cannot be before start time");
    }

    const durationMinutes = Math.round(
      (endAt.getTime() - entry.startAt.getTime()) / 60000
    );

    // Transaction: lock overlapping rows → assert no overlap → update
    return this.tx(async (txDb) => {
      await this._assertNoOverlapTx(txDb, companyId, technicianId, entry.startAt, endAt, entry.id);

      const [updated] = await txDb
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
    });
  }

  /**
   * Internal helper to stop running entry without validation
   */
  /**
   * Internal: stop running entry with transactional overlap protection.
   * Accepts optional txDb to participate in an outer transaction.
   */
  private async stopRunningTimeEntry(
    companyId: string,
    technicianId: string,
    options?: { at?: Date; txDb?: typeof db }
  ): Promise<void> {
    const runningEntry = await this.getRunningTimeEntry(companyId, technicianId);
    if (!runningEntry) return;

    const endAt = options?.at ?? new Date();
    const durationMinutes = Math.round(
      (endAt.getTime() - runningEntry.startAt.getTime()) / 60000
    );

    const doStop = async (txDb: typeof db) => {
      await this._assertNoOverlapTx(txDb, companyId, technicianId, runningEntry.startAt, endAt, runningEntry.id);

      await txDb
        .update(timeEntries)
        .set({ endAt, durationMinutes, updatedAt: new Date() })
        .where(eq(timeEntries.id, runningEntry.id));
    };

    if (options?.txDb) {
      await doStop(options.txDb);
    } else {
      await this.tx(doStop);
    }
  }

  /**
   * Check if a time range overlaps with existing entries for a technician.
   * Non-transactional variant — used for pre-flight checks outside transactions.
   */
  async checkTimeEntryOverlap(
    companyId: string,
    technicianId: string,
    startAt: Date,
    endAt: Date,
    excludeEntryId?: string
  ): Promise<TimeEntry[]> {
    return this._overlapQuery(db, companyId, technicianId, startAt, endAt, excludeEntryId);
  }

  /**
   * 2026-04-09: Stop a time entry and discard it if the resulting duration is
   * under 1 minute. Used by tech-side reversible actions (cancel-route,
   * cancel-start, pause) where a tech tap-then-tap-back should not pollute
   * payroll with sub-minute segments.
   *
   * Behavior:
   *   - Stops the running entry (or the explicitly-targeted entry by id).
   *   - If durationMinutes < 1 after stop, hard-deletes the row.
   *   - If durationMinutes >= 1, leaves the stopped entry intact.
   *
   * Returns the stopped entry, OR null if it was discarded as trivial.
   *
   * Locked product decision: ignore accidental sub-1-minute segments. Valid
   * recorded time (>= 1 min) is always preserved.
   */
  async stopAndDiscardIfTrivial(
    companyId: string,
    technicianId: string,
    options?: {
      timeEntryId?: string;
      at?: Date;
    }
  ): Promise<{ stopped: TimeEntry | null; discarded: boolean }> {
    const stopped = await this.stopTimeEntry(companyId, technicianId, options);
    if (!stopped) {
      return { stopped: null, discarded: false };
    }
    // Compute the raw elapsed time in milliseconds. Cannot rely on
    // stopped.durationMinutes here because stopTimeEntry uses Math.round
    // which would map a 30-second segment to "1 minute" — but per the
    // locked product decision, anything under 60 actual seconds is an
    // accidental sub-minute segment and must be discarded.
    const elapsedMs =
      stopped.endAt && stopped.startAt
        ? stopped.endAt.getTime() - stopped.startAt.getTime()
        : 0;
    if (elapsedMs < 60_000) {
      // Discard the trivial segment. Use raw delete (bypassing the admin
      // delete method which would require an actingUserId and would write
      // an audit log we don't want for tech-side cancellations).
      await db
        .delete(timeEntries)
        .where(and(
          eq(timeEntries.id, stopped.id),
          eq(timeEntries.companyId, companyId),
        ));
      console.log(JSON.stringify({
        event: "time_entry_sub_minute_discarded",
        companyId,
        technicianId,
        timeEntryId: stopped.id,
        type: stopped.type,
        elapsedMs,
        durationMinutes: stopped.durationMinutes,
        timestamp: new Date().toISOString(),
      }));
      return { stopped: null, discarded: true };
    }
    return { stopped, discarded: false };
  }

  /**
   * Transactional overlap assertion — locks conflicting rows with FOR UPDATE,
   * then throws 409 if any overlap exists. This is the canonical concurrency-safe
   * enforcement point. All mutation paths must call this inside a transaction.
   */
  private async _assertNoOverlapTx(
    txDb: typeof db,
    companyId: string,
    technicianId: string,
    startAt: Date,
    endAt: Date,
    excludeEntryId?: string
  ): Promise<void> {
    const overlaps = await this._overlapQueryForUpdate(
      txDb, companyId, technicianId, startAt, endAt, excludeEntryId
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

  /**
   * Core overlap query — reusable by both transactional and non-transactional callers.
   */
  private async _overlapQuery(
    queryDb: typeof db,
    companyId: string,
    technicianId: string,
    startAt: Date,
    endAt: Date,
    excludeEntryId?: string
  ): Promise<TimeEntry[]> {
    const conditions = [
      eq(timeEntries.companyId, companyId),
      eq(timeEntries.technicianId, technicianId),
      lt(timeEntries.startAt, endAt),
      or(
        isNull(timeEntries.endAt),
        sql`${timeEntries.endAt} > ${startAt}`
      ),
    ];
    if (excludeEntryId) {
      conditions.push(sql`${timeEntries.id} != ${excludeEntryId}`);
    }
    return queryDb
      .select()
      .from(timeEntries)
      .where(and(...conditions))
      .orderBy(asc(timeEntries.startAt));
  }

  /**
   * Overlap query with FOR UPDATE row locking — serializes concurrent writes
   * for the same technician's time range.
   */
  private async _overlapQueryForUpdate(
    txDb: typeof db,
    companyId: string,
    technicianId: string,
    startAt: Date,
    endAt: Date,
    excludeEntryId?: string
  ): Promise<TimeEntry[]> {
    const conditions = [
      eq(timeEntries.companyId, companyId),
      eq(timeEntries.technicianId, technicianId),
      lt(timeEntries.startAt, endAt),
      or(
        isNull(timeEntries.endAt),
        sql`${timeEntries.endAt} > ${startAt}`
      ),
    ];
    if (excludeEntryId) {
      conditions.push(sql`${timeEntries.id} != ${excludeEntryId}`);
    }
    return (txDb as any)
      .select()
      .from(timeEntries)
      .where(and(...conditions))
      .for("update")
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
      overrideApprovalLock?: boolean;
      overrideReason?: string;
      actingUserId?: string;
      costRateOverride?: string | null;
    }
  ): Promise<TimeEntry> {
    this.assertCompanyId(companyId);
    this.validateUUID(technicianId, "technicianId");

    // 2026-05-05: manual admin entries may target completed/invoiced
    // jobs (corrections + late labor). Soft-deleted/inactive jobs
    // remain blocked. No job-status or invoice side effects.
    // Aligns with the search filter that surfaces these jobs in the
    // Add Time Entry modal's job picker (`getJobsFeed` uses
    // `activeJobFilter`, not `activeWorkJobFilter`). Live-tech flows
    // (`startTimeEntry`, `recordJobStatus`) keep the stricter
    // `activeWorkJobFilter` so techs can't go en route on a closed job.
    if (options.jobId) {
      this.validateUUID(options.jobId, "jobId");
      const [targetJob] = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.id, options.jobId), eq(jobs.companyId, companyId), activeJobFilter()))
        .limit(1);
      if (!targetJob) {
        throw this.notFoundError("Job not found or has been deleted");
      }
    }

    if (options.endAt < options.startAt) {
      throw this.validationError("End time cannot be before start time");
    }

    // Check approval lock (read-only, safe outside tx)
    await this.enforceApprovalLock(companyId, technicianId, options.startAt, {
      overrideApprovalLock: options?.overrideApprovalLock,
      overrideReason: options?.overrideReason,
      actingUserId: options?.actingUserId,
    });

    const durationMinutes = Math.round(
      (options.endAt.getTime() - options.startAt.getTime()) / 60000
    );

    // Get billable rate snapshot; use per-entry cost override if provided
    const billableRateSnapshot = await this.getTechnicianBillableRate(companyId, technicianId);
    const costRateSnapshot = options.costRateOverride != null
      ? options.costRateOverride
      : await this.getTechnicianCostRate(companyId, technicianId);

    const billable = options.billable ?? BILLABLE_DEFAULTS[options.type];

    // Transaction: lock overlapping rows → assert no overlap → insert
    return this.tx(async (txDb) => {
      await this._assertNoOverlapTx(txDb, companyId, technicianId, options.startAt, options.endAt);

      const [entry] = await txDb
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
    });
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

    // 2026-05-05: relax job-link validation to allow re-linking
    // entries to completed/invoiced jobs (corrections flow). Only
    // soft-deleted/inactive jobs are blocked.
    if (patch.jobId !== undefined && patch.jobId !== null) {
      this.validateUUID(patch.jobId, "jobId");
      const [targetJob] = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.id, patch.jobId), eq(jobs.companyId, companyId), activeJobFilter()))
        .limit(1);
      if (!targetJob) {
        throw this.notFoundError("Job not found or has been deleted");
      }
    }

    // Transaction: lock entry → validate → check overlap → update
    return this.tx(async (txDb) => {
      // Lock the entry row to prevent concurrent modification
      const [entry] = await (txDb as any)
        .select()
        .from(timeEntries)
        .where(and(eq(timeEntries.id, timeEntryId), eq(timeEntries.companyId, companyId)))
        .for("update")
        .limit(1);

      if (!entry) {
        throw this.notFoundError("Time entry");
      }

      checkEntryLock(entry, options);

      const newStartAt = patch.startAt ?? entry.startAt;
      const newEndAt = patch.endAt !== undefined ? patch.endAt : entry.endAt;
      const timesChanged =
        (patch.startAt && patch.startAt.getTime() !== entry.startAt.getTime()) ||
        (patch.endAt !== undefined &&
          (patch.endAt === null
            ? entry.endAt !== null
            : entry.endAt === null || patch.endAt.getTime() !== entry.endAt.getTime()));

      if (timesChanged && newEndAt) {
        await this._assertNoOverlapTx(txDb, companyId, entry.technicianId, newStartAt, newEndAt, timeEntryId);
      }

      let durationMinutes = entry.durationMinutes;
      if (newEndAt && newStartAt) {
        if (newEndAt < newStartAt) {
          throw this.validationError("End time cannot be before start time");
        }
        durationMinutes = Math.round((newEndAt.getTime() - newStartAt.getTime()) / 60000);
      } else if (newEndAt === null) {
        durationMinutes = null;
      }

      const [updated] = await txDb
        .update(timeEntries)
        .set({ ...patch, durationMinutes, updatedAt: new Date() })
        .where(eq(timeEntries.id, timeEntryId))
        .returning();

      return updated;
    });
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

    // 2026-05-05: link-to-closed-job is allowed for corrections.
    // Soft-deleted/inactive jobs remain blocked.
    const [job] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId), activeJobFilter()))
      .limit(1);

    if (!job) {
      throw this.notFoundError("Job not found or is closed/inactive");
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

    // Get all time entries for the job with technician info + cost rate.
    // 2026-04-10: task labor (type=task_work) with matching jobId is included
    // automatically — no special filter needed since both visit and task entries
    // carry jobId when they contribute to a job.
    // 2026-04-16: also pull the linked visit's `isActive` flag so the ghost-
    // state guard below can suppress running badges whose visit context is
    // no longer valid (visit was soft-deleted, rolled back, etc.).
    const entries = await db
      .select({
        id: timeEntries.id,
        technicianId: timeEntries.technicianId,
        technicianName: users.fullName,
        type: timeEntries.type,
        taskId: timeEntries.taskId,
        visitId: timeEntries.visitId,
        startAt: timeEntries.startAt,
        endAt: timeEntries.endAt,
        durationMinutes: timeEntries.durationMinutes,
        billable: timeEntries.billable,
        costRateSnapshot: timeEntries.costRateSnapshot,
        invoiceId: timeEntries.invoiceId,
        invoicedAt: timeEntries.invoicedAt,
        visitIsActive: jobVisits.isActive,
      })
      .from(timeEntries)
      .leftJoin(users, eq(timeEntries.technicianId, users.id))
      .leftJoin(jobVisits, eq(timeEntries.visitId, jobVisits.id))
      .where(and(eq(timeEntries.companyId, companyId), eq(timeEntries.jobId, jobId)))
      .orderBy(desc(timeEntries.startAt));

    // Calculate totals
    let travelMinutes = 0;
    let onSiteMinutes = 0;
    let otherMinutes = 0;
    let billableMinutes = 0;
    let totalCostAmount = 0;
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

    // 2026-04-16: ghost-state guard — maximum plausible age of a truly
    // running timer. Real field labour doesn't run uninterrupted this
    // long; anything older has almost certainly been abandoned (visit
    // modified / rolled back, midnight crossed, device lost, etc.).
    // Applied uniformly to both visit-typed and non-visit-typed open
    // entries because we have no visit-lifecycle signal for the latter.
    const STALE_RUNNING_CUTOFF_MS = 12 * 60 * 60 * 1000;
    const nowMs = Date.now();

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

      // 2026-04-16: running-state guard. `endAt IS NULL` alone is not
      // sufficient to show the Labour Summary card's "En Route" / "On
      // Site" badge — it can survive a visit soft-delete, a visit
      // unassignment, a prior-day timer that was never closed, or a
      // visit rollback during testing. Treat an open entry as *running*
      // only when its visit context is still valid AND the timer hasn't
      // been open past the stale cutoff.
      //   - visitIsActive === false → linked visit was soft-deleted,
      //     open timer is orphaned.
      //   - visitIsActive === null AND visitId != null → should not
      //     happen (LEFT JOIN on a present FK), but fail closed.
      //   - age > STALE_RUNNING_CUTOFF_MS → stale timer, don't surface.
      const isOpen = !entry.endAt;
      const hasOrphanedVisit =
        entry.visitId != null && entry.visitIsActive !== true;
      const isStale =
        isOpen &&
        entry.startAt != null &&
        nowMs - new Date(entry.startAt).getTime() > STALE_RUNNING_CUTOFF_MS;
      const isValidRunning = isOpen && !hasOrphanedVisit && !isStale;
      if (isValidRunning) {
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

      // Accumulate labour cost from costRateSnapshot
      if (minutes > 0 && entry.costRateSnapshot) {
        totalCostAmount += (minutes / 60) * parseFloat(entry.costRateSnapshot);
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
      totalCostAmount: Math.round(totalCostAmount * 100) / 100,
      isRunning,
      runningType,
      technicianBreakdown: Array.from(techMap.values()),
      entries: entries.map((e) => ({
        id: e.id,
        technicianId: e.technicianId,
        type: e.type as TimeEntryType,
        taskId: e.taskId,
        visitId: e.visitId,
        sourceType: deriveSourceType(e.type, e.taskId, e.visitId),
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
      visitId?: string | null;
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
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId), activeWorkJobFilter()))
      .limit(1);

    if (!job) {
      throw this.notFoundError("Job");
    }

    const now = options.at ?? new Date();
    const status = options.status;
    let timeEntry: TimeEntry | undefined;

    // 2026-04-10 INTEGRITY: autoStopOpen REMOVED. No silent timer stops.
    // All visit start flows go through startTimeEntry which enforces:
    //   strict mode → 409 if any active timer exists
    //   transition mode → auto-stop only within same-job visit transitions
    // Cross-context overlaps (task running while visit starts) are now rejected.

    // Handle status-specific time entry logic
    switch (status) {
      case "en_route":
        // 2026-04-10: strict mode — reject if any unrelated timer is active.
        // If this tech has a running entry from a different context, they must
        // stop it first. No silent killing of task timers.
        timeEntry = await this.startTimeEntry(companyId, technicianId, {
          type: "travel_to_job",
          jobId,
          visitId: options.visitId ?? null,
          at: now,
          notes: options.notes,
          mode: "strict",
        });
        break;

      case "arrived":
        // transition mode: auto-stops travel_to_job for SAME job only.
        // Rejects if running entry is from different job or is a task timer.
        timeEntry = await this.startTimeEntry(companyId, technicianId, {
          type: "on_site",
          jobId,
          visitId: options.visitId ?? null,
          at: now,
          notes: options.notes,
          mode: "transition",
        });
        break;

      case "paused":
        // Stop current running entry for this technician.
        // 2026-04-09: discard sub-1-minute segments to ignore accidental taps.
        const pausedResult = await this.stopAndDiscardIfTrivial(
          companyId,
          technicianId,
          { at: now },
        );
        timeEntry = pausedResult.stopped ?? undefined;
        break;

      case "resumed":
        // Resume: strict mode — no running entry should exist (was paused).
        // If somehow one exists from a different context, reject.
        timeEntry = await this.startTimeEntry(companyId, technicianId, {
          type: "on_site",
          jobId,
          visitId: options.visitId ?? null,
          at: now,
          notes: options.notes,
          mode: "strict",
        });
        break;

      case "completed":
        // Stop the open entry for this job (if any).
        // 2026-04-09: route the stop through stopAndDiscardIfTrivial so an
        // immediate-complete-after-start (e.g. accidental tap) does not
        // pollute payroll with sub-minute segments.
        const onSiteEntry = await this.getRunningTimeEntry(companyId, technicianId);
        if (onSiteEntry && onSiteEntry.jobId === jobId) {
          const completedResult = await this.stopAndDiscardIfTrivial(
            companyId,
            technicianId,
            { timeEntryId: onSiteEntry.id, at: now },
          );
          timeEntry = completedResult.stopped ?? undefined;
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
      taskId: string | null;
      visitId: string | null;
      sourceType: "visit" | "task" | "manual";
      startAt: Date;
      endAt: Date | null;
      durationMinutes: number | null;
      billable: boolean;
      billableRateSnapshot: string | null;
      costRateSnapshot: string | null;
      notes: string | null;
      invoiceId: string | null;
      invoicedAt: Date | null;
      // Phase 9: Lock fields
      lockedAt: Date | null;
      lockedByInvoiceId: string | null;
      lockReason: string | null;
      createdAt: Date;
      // Visit display context (null for non-visit entries)
      visitLabel: string | null;
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
        taskId: timeEntries.taskId,
        visitId: timeEntries.visitId,
        startAt: timeEntries.startAt,
        endAt: timeEntries.endAt,
        durationMinutes: timeEntries.durationMinutes,
        billable: timeEntries.billable,
        billableRateSnapshot: timeEntries.billableRateSnapshot,
        costRateSnapshot: timeEntries.costRateSnapshot,
        notes: timeEntries.notes,
        invoiceId: timeEntries.invoiceId,
        invoicedAt: timeEntries.invoicedAt,
        // Phase 9: Lock fields
        lockedAt: timeEntries.lockedAt,
        lockedByInvoiceId: timeEntries.lockedByInvoiceId,
        lockReason: timeEntries.lockReason,
        createdAt: timeEntries.createdAt,
        // Visit display context
        visitNumber: jobVisits.visitNumber,
      })
      .from(timeEntries)
      .leftJoin(users, eq(timeEntries.technicianId, users.id))
      .leftJoin(jobVisits, eq(timeEntries.visitId, jobVisits.id))
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
      sourceType: deriveSourceType(e.type, e.taskId, e.visitId),
      visitLabel: e.visitNumber != null ? `Visit #${e.visitNumber}` : null,
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

      // 2026-05-05: manager reassign — allow re-linking to completed/
      // invoiced jobs (corrections flow). Soft-deleted/inactive jobs
      // remain blocked.
      if (patch.jobId !== undefined && patch.jobId !== null) {
        const [targetJob] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.id, patch.jobId), eq(jobs.companyId, companyId), activeJobFilter()))
          .limit(1);
        if (!targetJob) {
          throw this.notFoundError("Target job not found or has been deleted");
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
        // Transactional overlap check with FOR UPDATE locking
        await this._assertNoOverlapTx(tx as any, companyId, entry.technicianId, newStartAt, newEndAt, timeEntryId);
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
        taskId: timeEntries.taskId,
        visitId: timeEntries.visitId,
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
        // 2026-04-16: midnight rollover
        autoPausedAt: timeEntries.autoPausedAt,
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
        `Week ${weekStart} is approved and locked. Cannot modify payroll sessions or labor entries in an approved period.`
      );
    }
  }

  // ============================================================================
  // ADMIN TIMESHEET QUERIES (consolidated from route-level inline queries, 2026-04-03)
  // ============================================================================

  /**
   * List active staff for admin timesheet user switcher
   */
  async getTimesheetUsers(companyId: string) {
    this.assertCompanyId(companyId);
    return db
      .select({
        id: users.id,
        email: users.email,
        phone: users.phone,
        fullName: users.fullName,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        status: users.status,
      })
      .from(users)
      .where(
        and(
          eq(users.companyId, companyId),
          isNull(users.deletedAt),
          eq(users.disabled, false),
          // 2026-05-04: payroll/timesheet user switcher must not list
          // platform-role rows that happen to be parked at this tenant.
          nonPlatformUserPredicate(),
        )
      )
      .orderBy(asc(users.firstName), asc(users.lastName));
  }

  /**
   * Get chronological time entries for a user on a specific date.
   * Returns flat list ordered by startAt — the canonical shape for the daily admin timesheet.
   */
  async getTimesheetDay(
    companyId: string,
    userId: string,
    date: string
  ): Promise<{
    date: string;
    userId: string;
    entries: Array<{
      id: string;
      technicianId: string;
      jobId: string | null;
      taskId: string | null;
      visitId: string | null;
      sourceType: "visit" | "task" | "manual";
      jobNumber: number | null;
      jobSummary: string | null;
      jobType: string | null;
      locationName: string | null;
      locationAddress: string | null;
      locationCity: string | null;
      type: string;
      startAt: Date;
      endAt: Date | null;
      durationMinutes: number | null;
      billable: boolean;
      notes: string | null;
      lockedAt: Date | null;
      lockedByInvoiceId: string | null;
      lockReason: string | null;
      invoiceId: string | null;
      costRateSnapshot: string | null;
      billableRateSnapshot: string | null;
      locationId: string | null;
    }>;
    totalMinutes: number;
  }> {
    this.assertCompanyId(companyId);
    this.validateUUID(userId, "userId");

    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const nextDay = new Date(dayStart.getTime() + 86400000);

    const rows = await db
      .select({
        id: timeEntries.id,
        technicianId: timeEntries.technicianId,
        jobId: timeEntries.jobId,
        type: timeEntries.type,
        startAt: timeEntries.startAt,
        endAt: timeEntries.endAt,
        durationMinutes: timeEntries.durationMinutes,
        billable: timeEntries.billable,
        notes: timeEntries.notes,
        lockedAt: timeEntries.lockedAt,
        lockedByInvoiceId: timeEntries.lockedByInvoiceId,
        lockReason: timeEntries.lockReason,
        invoiceId: timeEntries.invoiceId,
        // 2026-04-10: taskId/visitId for distinguishing labor sources in timesheet
        taskId: timeEntries.taskId,
        visitId: timeEntries.visitId,
        // 2026-04-04: Include rate snapshots so edit modal can hydrate cost/hr
        costRateSnapshot: timeEntries.costRateSnapshot,
        billableRateSnapshot: timeEntries.billableRateSnapshot,
        // 2026-04-04: Include locationId for client detail links in day view
        locationId: jobs.locationId,
        jobNumber: jobs.jobNumber,
        jobSummary: jobs.summary,
        jobType: jobs.jobType,
        // 2026-05-01 bypass cleanup: tech day-view location label resolves
        // through the canonical helper.
        locationName: locationDisplayNameExpr,
        locationAddress: clientLocations.address,
        locationCity: clientLocations.city,
      })
      .from(timeEntries)
      .leftJoin(jobs, eq(timeEntries.jobId, jobs.id))
      .leftJoin(clientLocations, eq(jobs.locationId, clientLocations.id))
      .leftJoin(customerCompanies, eq(clientLocations.parentCompanyId, customerCompanies.id))
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          eq(timeEntries.technicianId, userId),
          gte(timeEntries.startAt, dayStart),
          lt(timeEntries.startAt, nextDay)
        )
      )
      .orderBy(asc(timeEntries.startAt));

    // Worked hours from work_sessions (payroll source of truth)
    const nextDateStr = nextDay.toISOString().split("T")[0];
    const daySessions = await this.getWorkSessionsForTechnician(companyId, userId, date, nextDateStr);
    const totalMinutes = sumSessionMinutes(daySessions);

    const entries = rows.map((r) => {
      return {
        id: r.id,
        technicianId: r.technicianId,
        jobId: r.jobId,
        taskId: r.taskId,
        visitId: r.visitId,
        sourceType: deriveSourceType(r.type, r.taskId, r.visitId),
        jobNumber: r.jobNumber,
        jobSummary: r.jobSummary,
        jobType: r.jobType,
        locationName: r.locationName,
        locationAddress: r.locationAddress,
        locationCity: r.locationCity,
        type: r.type,
        startAt: r.startAt,
        endAt: r.endAt,
        durationMinutes: r.durationMinutes,
        billable: r.billable,
        notes: r.notes,
        lockedAt: r.lockedAt,
        lockedByInvoiceId: r.lockedByInvoiceId,
        lockReason: r.lockReason,
        invoiceId: r.invoiceId,
        costRateSnapshot: r.costRateSnapshot,
        billableRateSnapshot: r.billableRateSnapshot,
        locationId: r.locationId,
      };
    });

    return { date, userId, entries, totalMinutes };
  }

  /**
   * Get all time entries for a technician across a full week (Mon–Sun),
   * with job + location joins. Used by the payroll week grid (2026-04-04).
   */
  async getTimesheetWeek(
    companyId: string,
    userId: string,
    weekStart: string // YYYY-MM-DD (Monday)
  ): Promise<{
    weekStart: string;
    userId: string;
    entries: Array<{
      id: string;
      technicianId: string;
      jobId: string | null;
      taskId: string | null;
      visitId: string | null;
      sourceType: "visit" | "task" | "manual";
      jobNumber: number | null;
      jobSummary: string | null;
      locationName: string | null;
      type: string;
      startAt: Date;
      endAt: Date | null;
      durationMinutes: number | null;
      billable: boolean;
      notes: string | null;
      date: string; // YYYY-MM-DD derived from startAt
    }>;
  }> {
    this.assertCompanyId(companyId);
    this.validateUUID(userId, "userId");

    const mondayStart = new Date(`${weekStart}T00:00:00.000Z`);
    const sundayEnd = new Date(mondayStart.getTime() + 7 * 86400000);

    const rows = await db
      .select({
        id: timeEntries.id,
        technicianId: timeEntries.technicianId,
        jobId: timeEntries.jobId,
        taskId: timeEntries.taskId,
        visitId: timeEntries.visitId,
        type: timeEntries.type,
        startAt: timeEntries.startAt,
        endAt: timeEntries.endAt,
        durationMinutes: timeEntries.durationMinutes,
        billable: timeEntries.billable,
        notes: timeEntries.notes,
        jobNumber: jobs.jobNumber,
        jobSummary: jobs.summary,
        // 2026-05-01 bypass cleanup: tech week-view location label.
        locationName: locationDisplayNameExpr,
      })
      .from(timeEntries)
      .leftJoin(jobs, eq(timeEntries.jobId, jobs.id))
      .leftJoin(clientLocations, eq(jobs.locationId, clientLocations.id))
      .leftJoin(customerCompanies, eq(clientLocations.parentCompanyId, customerCompanies.id))
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          eq(timeEntries.technicianId, userId),
          gte(timeEntries.startAt, mondayStart),
          lt(timeEntries.startAt, sundayEnd)
        )
      )
      .orderBy(asc(timeEntries.startAt));

    const entries = rows.map((r) => {
      const startDate = r.startAt instanceof Date ? r.startAt : new Date(r.startAt);
      return {
        id: r.id,
        technicianId: r.technicianId,
        jobId: r.jobId,
        taskId: r.taskId,
        visitId: r.visitId,
        sourceType: deriveSourceType(r.type, r.taskId, r.visitId),
        jobNumber: r.jobNumber,
        jobSummary: r.jobSummary,
        locationName: r.locationName,
        type: r.type,
        startAt: r.startAt,
        endAt: r.endAt,
        durationMinutes: r.durationMinutes,
        billable: r.billable,
        notes: r.notes,
        // Derive date string from startAt for day bucketing
        date: `${startDate.getUTCFullYear()}-${String(startDate.getUTCMonth() + 1).padStart(2, "0")}-${String(startDate.getUTCDate()).padStart(2, "0")}`,
      };
    });

    return { weekStart, userId, entries };
  }

  /**
   * Reduce total hours for a technician+job+day by deleting/trimming entries.
   * Processes entries from most recent first. Fully consumed entries are deleted;
   * the last partially-consumed entry is trimmed (endAt moved earlier).
   * Used by payroll week grid for hour reductions (2026-04-04).
   */
  async reduceTimeForDay(
    companyId: string,
    technicianId: string,
    jobId: string | null,
    date: string,
    reduceMinutes: number,
    options: { userId: string }
  ): Promise<{ deletedCount: number; trimmedCount: number; reducedMinutes: number }> {
    this.assertCompanyId(companyId);
    this.validateUUID(technicianId, "technicianId");
    this.validateUUID(options.userId, "userId");

    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const nextDay = new Date(dayStart.getTime() + 86400000);

    // Find entries for this tech+job+day, ordered most recent first
    const jobCondition = jobId
      ? eq(timeEntries.jobId, jobId)
      : isNull(timeEntries.jobId);

    const entries = await db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          eq(timeEntries.technicianId, technicianId),
          jobCondition,
          gte(timeEntries.startAt, dayStart),
          lt(timeEntries.startAt, nextDay)
        )
      )
      .orderBy(desc(timeEntries.startAt));

    let remaining = reduceMinutes;
    let deletedCount = 0;
    let trimmedCount = 0;

    for (const entry of entries) {
      if (remaining <= 0) break;

      const entryMinutes = entry.durationMinutes ?? 0;
      if (entryMinutes <= 0) continue;

      // Skip locked/invoiced entries — cannot modify
      if (entry.lockedAt || entry.lockedByInvoiceId || entry.invoiceId) continue;

      if (entryMinutes <= remaining) {
        // Delete entire entry
        await db
          .delete(timeEntries)
          .where(and(eq(timeEntries.id, entry.id), eq(timeEntries.companyId, companyId)));
        remaining -= entryMinutes;
        deletedCount++;
      } else {
        // Trim entry: shorten endAt and recalculate duration
        const newDuration = entryMinutes - remaining;
        const startMs = entry.startAt instanceof Date ? entry.startAt.getTime() : new Date(entry.startAt).getTime();
        const newEndAt = new Date(startMs + newDuration * 60000);
        await db
          .update(timeEntries)
          .set({
            endAt: newEndAt,
            durationMinutes: newDuration,
          })
          .where(and(eq(timeEntries.id, entry.id), eq(timeEntries.companyId, companyId)));
        remaining -= (entryMinutes - newDuration);
        trimmedCount++;
      }
    }

    console.log(JSON.stringify({
      event: "time_reduce_day",
      companyId,
      technicianId,
      jobId,
      date,
      requestedMinutes: reduceMinutes,
      actualMinutes: reduceMinutes - remaining,
      deletedCount,
      trimmedCount,
      skippedLockedMinutes: remaining,
    }));

    return {
      deletedCount,
      trimmedCount,
      reducedMinutes: reduceMinutes - remaining,
    };
  }

  /**
   * Get visits available for time-entry reassignment (active jobs only).
   */
  async getVisitsForReassign(
    companyId: string,
    options: { userId: string; date?: string; search?: string }
  ) {
    this.assertCompanyId(companyId);

    const centerDate = options.date
      ? new Date(`${options.date}T12:00:00.000Z`)
      : new Date();
    const windowStart = new Date(centerDate.getTime() - 7 * 86400000);
    const windowEnd = new Date(centerDate.getTime() + 8 * 86400000);

    const conditions = [
      eq(jobVisits.companyId, companyId),
      eq(jobVisits.isActive, true),
      isNull(jobVisits.archivedAt),
      gte(jobVisits.scheduledStart, windowStart),
      lt(jobVisits.scheduledStart, windowEnd),
      // Active jobs only (2026-04-03)
      activeWorkJobFilter(),
    ];

    // 2026-05-01 strict-search: visit-search by name uses parent
    // customer company name for parented locations and the location's
    // own column ONLY for standalone (parentless) rows. Job summary +
    // job number continue to match unchanged.
    if (options.search?.trim()) {
      const term = `%${options.search.trim()}%`;
      conditions.push(
        sql`(${jobs.summary} ILIKE ${term}
          OR CAST(${jobs.jobNumber} AS TEXT) LIKE ${term}
          OR (${clientLocations.parentCompanyId} IS NOT NULL AND ${customerCompanies.name} ILIKE ${term})
          OR (${clientLocations.parentCompanyId} IS NULL AND ${clientLocations.companyName} ILIKE ${term}))`
      );
    }

    const rows = await db
      .select({
        visitId: jobVisits.id,
        visitNumber: jobVisits.visitNumber,
        scheduledStart: jobVisits.scheduledStart,
        status: jobVisits.status,
        jobId: jobVisits.jobId,
        jobNumber: jobs.jobNumber,
        jobSummary: jobs.summary,
        locationName: locationDisplayNameExpr,
      })
      .from(jobVisits)
      .innerJoin(jobs, eq(jobVisits.jobId, jobs.id))
      .leftJoin(clientLocations, eq(jobs.locationId, clientLocations.id))
      .leftJoin(customerCompanies, eq(clientLocations.parentCompanyId, customerCompanies.id))
      .where(and(...conditions))
      .orderBy(asc(jobVisits.scheduledStart))
      .limit(50);

    const dayStr = options.date ?? centerDate.toISOString().split("T")[0];
    const dayStartMs = new Date(`${dayStr}T00:00:00.000Z`).getTime();
    const dayEndMs = dayStartMs + 86400000;

    return rows.map((r) => {
      const schedMs = r.scheduledStart ? new Date(r.scheduledStart).getTime() : 0;
      return {
        visitId: r.visitId,
        visitNumber: r.visitNumber,
        scheduledStart: r.scheduledStart,
        status: r.status,
        jobId: r.jobId,
        jobNumber: r.jobNumber,
        jobSummary: r.jobSummary,
        locationName: r.locationName,
        label: `#${r.jobNumber} ${r.jobSummary}${r.locationName ? ` (${r.locationName})` : ""}`,
        sameDay: schedMs >= dayStartMs && schedMs < dayEndMs,
      };
    });
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

    const techFilterSessions = options?.technicianId
      ? eq(workSessions.technicianId, options.technicianId)
      : sql`1=1`;

    // Payroll source of truth: work_sessions (clock-in/out attendance)
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
          isNotNull(workSessions.clockOutAt), // Only completed sessions
          techFilterSessions
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

    // Aggregate work sessions by tech + date (payroll source of truth)
    const techDailyMinutes = new Map<string, Map<string, number>>();
    const techNames = new Map<string, string | null>();

    for (const s of sessionsData) {
      techNames.set(s.technicianId, s.technicianName);

      if (!techDailyMinutes.has(s.technicianId)) {
        techDailyMinutes.set(s.technicianId, new Map());
      }

      const dailyMap = techDailyMinutes.get(s.technicianId)!;
      const mins = sessionDurationMinutes(s);
      dailyMap.set(s.workDate, (dailyMap.get(s.workDate) ?? 0) + mins);
    }

    // Build result for each technician
    const summaries: TechnicianWeeklySummary[] = [];

    for (const techId of Array.from(techDailyMinutes.keys())) {
      const dailyMap = techDailyMinutes.get(techId)!;
      const daily: DailyPayrollBreakdown[] = [];
      let weekTotal = 0;

      for (const day of days) {
        const mins = dailyMap.get(day) ?? 0;
        const date = new Date(day + "T00:00:00Z");
        const dayOfWeek = TimeTrackingRepository.DAY_NAMES[date.getUTCDay()];

        daily.push({ date: day, dayOfWeek, totalMinutes: mins });
        weekTotal += mins;
      }

      const approval = approvalMap.get(techId);

      summaries.push({
        technicianId: techId,
        technicianName: techNames.get(techId) ?? null,
        weekStart: normalizedWeekStart,
        weekEnd,
        totalMinutes: weekTotal,
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
  /**
   * Generate CSV for weekly payroll — work_sessions source of truth (realigned 2026-04-06)
   */
  generatePayrollCsv(summaries: TechnicianWeeklySummary[]): string {
    const toHours = (mins: number) => (mins / 60).toFixed(2);

    const headers = [
      "Technician Name",
      "Technician ID",
      "Week Start",
      "Week End",
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
      "Total Hours",
      "Status",
    ];

    const rows: string[] = [headers.join(",")];

    for (const s of summaries) {
      const row: string[] = [
        `"${(s.technicianName ?? "Unknown").replace(/"/g, '""')}"`,
        s.technicianId,
        s.weekStart,
        s.weekEnd,
        ...s.daily.map((d) => toHours(d.totalMinutes)),
        toHours(s.totalMinutes),
        s.approved ? "Approved" : "Pending",
      ];
      rows.push(row.join(","));
    }

    return rows.join("\n");
  }

  // ============================================================================
  // 2026-04-10: TECHNICIAN LIVE STATE — dispatcher visibility projection
  // ============================================================================
  //
  // Pure read projection over canonical sources of truth:
  //   - work_sessions (clock_in_at IS NOT NULL AND clock_out_at IS NULL) → attendance
  //   - job_visits (status IN en_route|on_site|in_progress|paused, is_active=true) → activity
  //
  // Returns one row per technician id passed in. The route layer is responsible
  // for picking which technicians to query (typically the schedulable set used
  // by the dispatch board).
  //
  // Precedence (matches the product spec):
  //   paused > on_site/in_progress > en_route > clocked_in (idle) > clocked_out
  //
  // No new tables. No schema changes. No side effects. Two SELECTs per call.
  //
  // Why a single helper instead of letting the office client stitch fields:
  //   - dispatcher state is derived from TWO unrelated tables (work_sessions
  //     and job_visits). A second source of truth on the client would be
  //     fragile. The helper is the canonical projection — every dispatcher
  //     surface that needs live state goes through here.

  /**
   * Derive a clean dispatcher-facing live state for each technician.
   *
   * @param companyId  tenant id
   * @param technicianIds  user ids to project (typically schedulable techs)
   * @returns one TechnicianLiveState per input id, in input order
   */
  async getTechnicianLiveStates(
    companyId: string,
    technicianIds: string[],
  ): Promise<TechnicianLiveState[]> {
    this.assertCompanyId(companyId);
    if (technicianIds.length === 0) return [];
    for (const id of technicianIds) {
      this.validateUUID(id, "technicianId");
    }

    // ── 1. Attendance: open work session per tech ───────────────────────────
    // Open = clock_out_at IS NULL. Indexed by (company_id, technician_id) via
    // work_sessions_open_idx — narrow scan, no full table read.
    const openSessions = await db
      .select({
        technicianId: workSessions.technicianId,
        clockInAt: workSessions.clockInAt,
      })
      .from(workSessions)
      .where(
        and(
          eq(workSessions.companyId, companyId),
          isNull(workSessions.clockOutAt),
          inArray(workSessions.technicianId, technicianIds),
        ),
      );
    const clockedInMap = new Map<string, Date>();
    for (const s of openSessions) {
      // If a tech somehow has multiple open sessions (legacy bad data), keep
      // the most recent clock-in so we still surface "clocked in" deterministically.
      const prior = clockedInMap.get(s.technicianId);
      if (!prior || s.clockInAt > prior) {
        clockedInMap.set(s.technicianId, s.clockInAt);
      }
    }

    // ── 2. Activity: active visit per tech ──────────────────────────────────
    // Active = status in the live workflow set AND is_active = true.
    // Match the route handler model: a tech "owns" the visit if they are the
    // primary assignee OR appear in assignedTechnicianIds[].
    //
    // Tech-id binding: `inArray(col, jsArray)` for the scalar primary column,
    // and a properly-bound `ARRAY[?, ?, ...]::varchar[]` literal for the
    // Postgres-array overlap. Drizzle's plain `${jsArray}` template
    // interpolation does NOT auto-convert a JS array to a Postgres array, so
    // the literal must be built via sql.join with one bound placeholder per id.
    const techIdsLiteral = sql.join(
      technicianIds.map((id) => sql`${id}`),
      sql`, `,
    );
    const activeVisits = await db
      .select({
        id: jobVisits.id,
        jobId: jobVisits.jobId,
        status: jobVisits.status,
        assignedTechnicianIds: jobVisits.assignedTechnicianIds,
        updatedAt: jobVisits.updatedAt,
      })
      .from(jobVisits)
      .where(
        and(
          eq(jobVisits.companyId, companyId),
          eq(jobVisits.isActive, true),
          sql`${jobVisits.status} IN ('en_route', 'on_site', 'in_progress', 'paused')`,
          sql`${jobVisits.assignedTechnicianIds} && ARRAY[${techIdsLiteral}]::varchar[]`,
        ),
      );

    // Bucket each tech's active visits and pick the highest-precedence one.
    // Precedence rank: paused (4) > on_site/in_progress (3) > en_route (2).
    const rankOf = (status: string): number => {
      switch (status) {
        case "paused": return 4;
        case "on_site":
        case "in_progress": return 3;
        case "en_route": return 2;
        default: return 0;
      }
    };

    type ActiveVisitRow = typeof activeVisits[number];
    const visitByTech = new Map<string, ActiveVisitRow>();
    for (const v of activeVisits) {
      const owners = new Set<string>();
      if (Array.isArray(v.assignedTechnicianIds)) {
        for (const id of v.assignedTechnicianIds) {
          if (id) owners.add(id);
        }
      }
      owners.forEach((techId) => {
        if (!technicianIds.includes(techId)) return;
        const current = visitByTech.get(techId);
        if (
          !current ||
          rankOf(v.status) > rankOf(current.status) ||
          (rankOf(v.status) === rankOf(current.status) &&
            (v.updatedAt?.getTime() ?? 0) > (current.updatedAt?.getTime() ?? 0))
        ) {
          visitByTech.set(techId, v);
        }
      });
    }

    // ── 3. Project per technician ───────────────────────────────────────────
    return technicianIds.map((technicianId) => {
      const isClockedIn = clockedInMap.has(technicianId);
      const activeVisit = visitByTech.get(technicianId);

      // Default: clocked out, no activity
      let attendanceStatus: TechnicianLiveState["attendanceStatus"] = "clocked_out";
      let activityStatus: TechnicianLiveState["activityStatus"] = "idle";
      let label = "Clocked Out";

      if (isClockedIn) {
        attendanceStatus = "clocked_in";
        label = "Clocked In";
      }

      if (activeVisit) {
        // Active workflow always wins over plain "clocked in" — see precedence note above.
        // A tech with an active visit is implicitly clocked in for label purposes,
        // but we report the actual attendance flag honestly so the office can
        // detect the bad-data case (active visit + no open work session).
        switch (activeVisit.status) {
          case "paused":
            activityStatus = "paused";
            label = "Paused";
            break;
          case "on_site":
          case "in_progress":
            activityStatus = "on_site";
            label = "On Site";
            break;
          case "en_route":
            activityStatus = "en_route";
            label = "En Route";
            break;
        }
      }

      return {
        technicianId,
        attendanceStatus,
        activityStatus,
        activeVisitId: activeVisit?.id ?? null,
        activeJobId: activeVisit?.jobId ?? null,
        label,
      };
    });
  }
}

/**
 * 2026-04-10: Dispatcher-facing technician live state.
 *
 * Single canonical projection consumed by the dispatch board sidebar so the
 * office can see "Clocked Out / Clocked In / En Route / On Site / Paused"
 * without inferring state from scattered fields.
 *
 * Derived from work_sessions (attendance) + job_visits (activity). The
 * `label` is the rendered string the UI should display as-is — see
 * getTechnicianLiveStates() for the precedence rule.
 */
export interface TechnicianLiveState {
  technicianId: string;
  attendanceStatus: "clocked_out" | "clocked_in";
  activityStatus: "idle" | "en_route" | "on_site" | "paused";
  activeVisitId: string | null;
  activeJobId: string | null;
  label: string;
}

export const timeTrackingRepository = new TimeTrackingRepository();
