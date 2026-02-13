/**
 * Model A Scheduling Domain Logic - SINGLE SOURCE OF TRUTH
 *
 * ALL scheduling normalization MUST go through this module.
 * Routes pass intent; storage calls these helpers before persisting.
 *
 * =============================================================================
 * STATUS MODEL (4 lifecycle values + derived states + workflow sub-status)
 * =============================================================================
 *
 * LIFECYCLE STATES (stored in jobs.status):
 * - "open"      - Active job that can be worked on
 * - "completed" - Work finished (may need invoicing)
 * - "invoiced"  - Invoice created (locked for billing)
 * - "archived"  - Historical archive (includes canceled jobs)
 *
 * DERIVED STATES (NOT stored in status, computed from fields):
 * - "scheduled" is derived from: scheduledStart IS NOT NULL
 *   Use: isJobScheduled(job) from shared/schema.ts
 *   NOTE: isAllDay is a DISPLAY flag only, not a scheduling determinant
 * - "assigned" is derived from: primaryTechnicianId IS NOT NULL OR assignedTechnicianIds.length > 0
 *   Use: isJobAssigned(job) from shared/schema.ts
 *
 * WORKFLOW SUB-STATUS (only valid when status = 'open'):
 * - null           - Default, no special workflow state
 * - "in_progress"  - Work actively being performed
 * - "on_hold"      - Job is blocked (requires holdReason)
 * - "on_route"     - Technician traveling to job site
 * - "needs_review" - Needs supervisor/manager review
 *
 * INVARIANT: openSubStatus must be NULL when status !== 'open'
 *
 * =============================================================================
 * CANONICAL SCHEDULING MODEL:
 * - A job is "scheduled" if and only if scheduledStart IS NOT NULL
 * - isAllDay is a DISPLAY flag only, NOT a scheduling determinant
 * - For all-day events: scheduledStart = midnight (00:00:00), scheduledEnd = 23:59:59
 * - This ensures all scheduled jobs have scheduledStart set, enabling consistent queries
 * =============================================================================
 */

import type { JobStatus, OpenSubStatus } from "@shared/schema";
import { normalizeJobStatus, isJobScheduled, isJobAssigned, isBacklogEligible } from "@shared/schema";
import { TERMINAL_STATUSES } from "../statusRules";

// ============================================================================
// Constants
// ============================================================================

// TERMINAL_STATUSES imported from ../statusRules (canonical source)
// Re-exported for backwards compatibility with existing consumers
export { TERMINAL_STATUSES };

/**
 * Statuses that appear in the unscheduled sidebar (backlog)
 * Note: Only "open" jobs can be in backlog; we filter by scheduling fields, not status
 */
export const BACKLOG_STATUS: JobStatus = "open";

// ============================================================================
// Status Helpers
// ============================================================================

/**
 * Check if a status is terminal (job workflow complete)
 */
export function isTerminalStatus(status: string): boolean {
  const normalized = normalizeJobStatus(status);
  return TERMINAL_STATUSES.includes(normalized);
}

/**
 * Check if a job should appear in the backlog (unscheduled sidebar)
 * Delegates to shared isBacklogEligible() for consistency.
 *
 * A job is in backlog if:
 * - status = 'open'
 * - NOT scheduled (scheduledStart IS NULL)
 */
export function isBacklogJob(job: JobLike): boolean {
  // Normalize status before checking (handles legacy values)
  const normalizedStatus = normalizeJobStatus(job.status ?? "open");
  return isBacklogEligible({ ...job, status: normalizedStatus });
}

/**
 * Check if a job should appear on the calendar
 * A job appears on calendar if:
 * - status = 'open' (active job)
 * - IS scheduled (scheduledStart IS NOT NULL)
 */
export function isCalendarJob(job: JobLike): boolean {
  const normalized = normalizeJobStatus(job.status ?? "open");
  if (normalized !== "open") {
    return false;
  }
  return isJobScheduled(job);
}

// ============================================================================
// Timezone Utilities
// ============================================================================

/** Default timezone when company settings not available */
export const DEFAULT_TIMEZONE = "America/Toronto";

/**
 * Get the start of day (00:00:00.000) for a given date in a specific timezone.
 * Returns the equivalent UTC Date object.
 *
 * @param date - Input date (any timezone)
 * @param timezone - IANA timezone string (e.g., "America/Toronto")
 * @returns Date object representing 00:00:00 in the specified timezone (as UTC)
 */
export function getStartOfDayInTimezone(date: Date, timezone: string): Date {
  // Format the date to get the local date parts in the target timezone
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parseInt(parts.find(p => p.type === "year")?.value || "0", 10);
  const month = parseInt(parts.find(p => p.type === "month")?.value || "0", 10) - 1;
  const day = parseInt(parts.find(p => p.type === "day")?.value || "0", 10);

  // Create a date string representing midnight in the target timezone
  const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00`;

  // Parse this as a time in the target timezone
  const offsetFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "shortOffset",
  });
  const offsetMatch = offsetFormatter.format(date).match(/GMT([+-]\d+)?/);
  let offsetHours = 0;
  if (offsetMatch && offsetMatch[1]) {
    offsetHours = parseInt(offsetMatch[1], 10);
  }

  // Create date in UTC by subtracting the offset
  const result = new Date(`${dateStr}Z`);
  result.setUTCHours(result.getUTCHours() - offsetHours);

  return result;
}

/**
 * Get the start of the next day (00:00:00.000) for a given date in a specific timezone.
 * Returns the equivalent UTC Date object.
 *
 * @param date - Input date (any timezone)
 * @param timezone - IANA timezone string (e.g., "America/Toronto")
 * @returns Date object representing next day 00:00:00 in the specified timezone (as UTC)
 */
export function getStartOfNextDayInTimezone(date: Date, timezone: string): Date {
  const startOfDay = getStartOfDayInTimezone(date, timezone);
  return new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Validate that a timezone string is valid IANA timezone.
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Schedule Time Normalization — SINGLE SOURCE OF TRUTH
// ============================================================================
//
// ALL code paths that compute scheduledStart/scheduledEnd MUST call
// normalizeScheduleTimes(). This guarantees the DB invariants:
//   jobs_all_day_start_midnight_check  →  00:00:00 (no ms)
//   jobs_all_day_end_2359_check        →  23:59:59 (no ms)
//
// IMPORTANT: Use .000Z (zero milliseconds) for both boundaries.
// PostgreSQL EXTRACT(SECOND FROM ts) returns fractional seconds, so
// 23:59:59.999 → EXTRACT = 59.999 ≠ 59 → constraint violation.
// ============================================================================

export interface NormalizeScheduleInput {
  allDay?: boolean;
  date?: string;           // "YYYY-MM-DD"
  startAt?: string | Date; // ISO datetime
  endAt?: string | Date;   // ISO datetime
  durationMinutes?: number;
}

export interface NormalizedScheduleTimes {
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  isAllDay: boolean;
}

/**
 * Compute canonical scheduledStart / scheduledEnd from route-level input.
 *
 * Rules:
 * A) allDay=true + date → start = date 00:00:00.000Z, end = date 23:59:59.000Z
 * B) allDay=true + startAt (no date) → derive date from startAt in UTC, then A
 * C) allDay=false → start from startAt; end from endAt or start+duration (default 60 min)
 *
 * Returns null start/end when no scheduling data is provided.
 */
export function normalizeScheduleTimes(input: NormalizeScheduleInput): NormalizedScheduleTimes {
  const isAllDay = input.allDay === true;

  if (isAllDay) {
    // Derive dateStr: prefer explicit date, else extract from startAt
    let dateStr = input.date ?? null;
    if (!dateStr && input.startAt) {
      const d = typeof input.startAt === "string" ? input.startAt : input.startAt.toISOString();
      dateStr = d.split("T")[0];
    }
    if (!dateStr) {
      return { scheduledStart: null, scheduledEnd: null, isAllDay: true };
    }
    return {
      scheduledStart: new Date(`${dateStr}T00:00:00.000Z`),
      scheduledEnd:   new Date(`${dateStr}T23:59:59.000Z`),
      isAllDay: true,
    };
  }

  // Timed event
  if (!input.startAt) {
    return { scheduledStart: null, scheduledEnd: null, isAllDay: false };
  }

  const start = typeof input.startAt === "string" ? new Date(input.startAt) : new Date(input.startAt.getTime());

  let end: Date;
  if (input.endAt) {
    end = typeof input.endAt === "string" ? new Date(input.endAt) : new Date(input.endAt.getTime());
  } else {
    const mins = input.durationMinutes ?? 60;
    end = new Date(start.getTime() + mins * 60_000);
  }

  return { scheduledStart: start, scheduledEnd: end, isAllDay: false };
}

// ============================================================================
// Schedule Field Derivation (storage-layer interface)
// ============================================================================

export interface DeriveScheduleParams {
  scheduledStart: Date | string | null;
  scheduledEnd?: Date | string | null;
  durationMinutes?: number;
  isAllDay?: boolean;
  timezone?: string;
}

export interface DerivedScheduleFields {
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  isAllDay: boolean;
  durationMinutes: number;
}

/**
 * Derive and normalize schedule fields (storage-layer entry point).
 *
 * CANONICAL SCHEDULING RULES:
 * - If isAllDay=true: scheduledStart = midnight (00:00:00.000Z),
 *   scheduledEnd = 23:59:59.000Z (exact second — no fractional ms)
 * - If timed: end = start + durationMinutes (default 60)
 * - If start is null: all fields cleared (job is unscheduled)
 *
 * IMPORTANT: isAllDay is a DISPLAY flag only. scheduledStart must always be set
 * for scheduled jobs, whether timed or all-day. This ensures isJobScheduled()
 * works correctly by checking scheduledStart IS NOT NULL.
 */
export function deriveScheduleFields(params: DeriveScheduleParams): DerivedScheduleFields {
  if (!params.scheduledStart) {
    return {
      scheduledStart: null,
      scheduledEnd: null,
      isAllDay: false,
      durationMinutes: 0,
    };
  }

  const start = typeof params.scheduledStart === "string"
    ? new Date(params.scheduledStart)
    : new Date(params.scheduledStart);

  const isAllDay = params.isAllDay === true;
  const defaultDuration = isAllDay ? 1440 : 60;
  const durationMinutes = params.durationMinutes ?? defaultDuration;

  if (isAllDay) {
    // Delegate to normalizeScheduleTimes for exact boundary computation
    const norm = normalizeScheduleTimes({ allDay: true, startAt: start });
    return {
      scheduledStart: norm.scheduledStart,
      scheduledEnd: norm.scheduledEnd,
      isAllDay: true,
      durationMinutes: 1440,
    };
  }

  // TIMED EVENT: compute end from duration
  let end: Date;
  if (params.scheduledEnd) {
    end = typeof params.scheduledEnd === "string"
      ? new Date(params.scheduledEnd)
      : new Date(params.scheduledEnd);
  } else {
    end = new Date(start.getTime() + durationMinutes * 60000);
  }

  return {
    scheduledStart: start,
    scheduledEnd: end,
    isAllDay: false,
    durationMinutes,
  };
}

// ============================================================================
// Terminal Immutability Guard
// ============================================================================

export interface SchedulePatchIntent {
  scheduledStart?: Date | string | null;
  scheduledEnd?: Date | string | null;
  isAllDay?: boolean | null;
  status?: string | null;
  openSubStatus?: OpenSubStatus | null;
}

/**
 * Terminal immutability error - thrown when attempting to modify
 * schedule/status of a terminal job
 */
export class TerminalJobImmutableError extends Error {
  public readonly statusCode = 400;
  public readonly code = "TERMINAL_JOB_IMMUTABLE";

  constructor(jobId: string | undefined, currentStatus: string) {
    super(
      `Cannot modify schedule/status for terminal job ${jobId || "unknown"} (status=${currentStatus}). ` +
      `Terminal jobs (${TERMINAL_STATUSES.join(", ")}) require explicit workflow transitions.`
    );
    this.name = "TerminalJobImmutableError";
  }
}

/**
 * Assert that a terminal job is not being modified for schedule/status changes.
 */
export function assertTerminalImmutable(
  existingJob: JobLike | null | undefined,
  patchIntent: SchedulePatchIntent,
  contextLabel: string
): void {
  if (!existingJob?.status) {
    return;
  }

  const currentStatus = normalizeJobStatus(existingJob.status);

  if (!isTerminalStatus(currentStatus)) {
    return;
  }

  const modifiesSchedule =
    patchIntent.scheduledStart !== undefined ||
    patchIntent.scheduledEnd !== undefined ||
    patchIntent.isAllDay !== undefined;

  const modifiesStatusToNonTerminal =
    patchIntent.status !== undefined &&
    patchIntent.status !== null &&
    !isTerminalStatus(patchIntent.status);

  if (modifiesSchedule || modifiesStatusToNonTerminal) {
    if (process.env.NODE_ENV === "development") {
      console.error(
        `[${contextLabel}] TERMINAL IMMUTABILITY VIOLATION: ` +
        `job ${existingJob.id} is terminal (${currentStatus}) but patch attempts to modify ` +
        `${modifiesSchedule ? "schedule" : ""}${modifiesSchedule && modifiesStatusToNonTerminal ? " and " : ""}` +
        `${modifiesStatusToNonTerminal ? `status to ${patchIntent.status}` : ""}`
      );
    }
    throw new TerminalJobImmutableError(existingJob.id, currentStatus);
  }
}

// ============================================================================
// Types
// ============================================================================

export interface JobLike {
  id?: string;
  jobNumber?: number | null;  // For diagnostics
  status?: string | null;
  openSubStatus?: string | null;  // Accepts string from DB, validated at runtime
  scheduledStart?: Date | string | null;
  scheduledEnd?: Date | string | null;
  isAllDay?: boolean | null;
  version?: number | null;
  primaryTechnicianId?: string | null;
  assignedTechnicianIds?: string[] | null;
}

/**
 * Minimal user/technician interface for scheduling checks
 */
export interface UserLike {
  id: string;
  disabled?: boolean | null;
  status?: string | null;
  isSchedulable?: boolean | null;
  fullName?: string | null;
  email?: string | null;
}

// ============================================================================
// Canonical Technician Assignment Model
// ============================================================================

/**
 * CANONICAL TECHNICIAN ASSIGNMENT INVARIANT:
 * If primaryTechnicianId is set, it MUST be included in assignedTechnicianIds.
 *
 * This ensures:
 * - Single source of truth: assignedTechnicianIds is THE array of all assigned techs
 * - Primary is a convenience pointer, not a separate assignment channel
 * - Queries can use assignedTechnicianIds for all "is assigned to this tech?" checks
 */
export function assertTechnicianAssignmentInvariant(
  job: { id?: string; primaryTechnicianId?: string | null; assignedTechnicianIds?: string[] | null },
  contextLabel = "assertTechnicianAssignmentInvariant"
): void {
  const { primaryTechnicianId, assignedTechnicianIds } = job;
  const jobId = job.id || "unknown";

  // If no primary, nothing to check
  if (!primaryTechnicianId) {
    return;
  }

  // If primary is set, assignedTechnicianIds must exist and contain primary
  const assigned = assignedTechnicianIds || [];
  if (!assigned.includes(primaryTechnicianId)) {
    const error = `[${contextLabel}] INVARIANT VIOLATION: job ${jobId} has ` +
      `primaryTechnicianId=${primaryTechnicianId} but it's not in assignedTechnicianIds=[${assigned.join(", ")}]`;
    if (process.env.NODE_ENV === "development") {
      throw new Error(error);
    }
    console.error(error);
  }
}

/**
 * Normalize technician assignment fields to ensure invariants are maintained.
 * Call this before any write operation that modifies technician assignments.
 *
 * @param technicianUserId - The technician to assign (or null to unassign)
 * @param existingAssigned - Current assignedTechnicianIds (for merging if needed)
 * @returns Normalized { primaryTechnicianId, assignedTechnicianIds } ready for DB write
 */
export function normalizeTechnicianAssignment(
  technicianUserId: string | null | undefined,
  existingAssigned?: string[] | null
): { primaryTechnicianId: string | null; assignedTechnicianIds: string[] } {
  if (!technicianUserId) {
    // Unassigning: clear primary, keep existing array or empty
    // Note: For full unassignment, caller should pass empty existingAssigned
    return {
      primaryTechnicianId: null,
      assignedTechnicianIds: existingAssigned?.filter(id => id !== technicianUserId) || [],
    };
  }

  // Assigning: set primary and ensure they're in the array
  const assigned = existingAssigned || [];
  const newAssigned = assigned.includes(technicianUserId)
    ? assigned
    : [...assigned, technicianUserId];

  return {
    primaryTechnicianId: technicianUserId,
    assignedTechnicianIds: newAssigned,
  };
}

// ============================================================================
// Canonical Schedulable Technician Filter
// ============================================================================

/**
 * CANONICAL SCHEDULABLE CHECK - Single Source of Truth
 *
 * A technician is "schedulable" (visible in calendar/assignment dropdowns) if:
 * 1. disabled !== true
 * 2. isSchedulable !== false (treat null/undefined as true)
 *
 * NOT filtered by:
 * - status (invited users can still be assigned to jobs)
 * - role (schedulability is explicit, not role-based)
 *
 * @param user - User object with scheduling-relevant fields
 * @returns true if user should appear in scheduling UI, false otherwise
 */
export function isTechnicianSchedulable(user: UserLike): boolean {
  // Rule 1: disabled users are never schedulable
  if (user.disabled === true) {
    return false;
  }

  // Rule 2: explicitly marked as not schedulable
  if (user.isSchedulable === false) {
    return false;
  }

  // Default: schedulable
  return true;
}

/**
 * Get diagnostic reason why a technician is NOT schedulable.
 * Returns null if technician IS schedulable.
 */
export function getTechnicianExclusionReason(user: UserLike): string | null {
  if (user.disabled === true) {
    return `disabled=true`;
  }
  if (user.isSchedulable === false) {
    return `isSchedulable=false`;
  }
  return null;
}

/**
 * Filter and diagnose technician list for scheduling UI.
 * Returns schedulable technicians plus diagnostic info about excluded ones.
 *
 * @param users - Full list of team members
 * @param contextLabel - Label for diagnostic logging
 * @returns { schedulable, excluded } where excluded has reasons
 */
export function filterSchedulableTechnicians<T extends UserLike>(
  users: T[],
  contextLabel = "filterSchedulableTechnicians"
): {
  schedulable: T[];
  excluded: Array<{ user: T; reason: string }>;
} {
  const schedulable: T[] = [];
  const excluded: Array<{ user: T; reason: string }> = [];

  for (const user of users) {
    const reason = getTechnicianExclusionReason(user);
    if (reason) {
      excluded.push({ user, reason });
      if (process.env.NODE_ENV === "development") {
        const name = user.fullName || user.email || user.id;
        console.log(`[${contextLabel}] Excluded technician "${name}" (${user.id}): ${reason}`);
      }
    } else {
      schedulable.push(user);
    }
  }

  return { schedulable, excluded };
}

/**
 * Check if a job is assigned to a technician who is NOT schedulable.
 * Used for calendar rendering - jobs assigned to hidden techs need special handling.
 *
 * @param job - Job with technician assignments
 * @param schedulableTechIds - Set of schedulable technician IDs
 * @returns Object with diagnostic info if assigned to non-schedulable tech
 */
export function checkJobTechnicianVisibility(
  job: JobLike,
  schedulableTechIds: Set<string>
): {
  hasHiddenTechnician: boolean;
  hiddenTechnicianIds: string[];
  visibleTechnicianIds: string[];
} {
  const assigned = job.assignedTechnicianIds || [];
  const hiddenTechnicianIds: string[] = [];
  const visibleTechnicianIds: string[] = [];

  for (const techId of assigned) {
    if (schedulableTechIds.has(techId)) {
      visibleTechnicianIds.push(techId);
    } else {
      hiddenTechnicianIds.push(techId);
    }
  }

  return {
    hasHiddenTechnician: hiddenTechnicianIds.length > 0,
    hiddenTechnicianIds,
    visibleTechnicianIds,
  };
}

// ============================================================================
// DEV-Only Invariant Assertions
// ============================================================================

/**
 * Assert scheduling invariants (DEV-only).
 *
 * CANONICAL SCHEDULING INVARIANTS:
 * 1. isAllDay=true REQUIRES scheduledStart IS NOT NULL (set to midnight)
 * 2. scheduledStart requires scheduledEnd
 * 3. scheduledEnd must be >= scheduledStart (all-day events have same-day start/end)
 * 4. openSubStatus requires status='open'
 */
export function assertSchedulingInvariants(job: JobLike, contextLabel: string): void {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  const status = job.status ? normalizeJobStatus(job.status) : null;
  const scheduledStart = job.scheduledStart
    ? (typeof job.scheduledStart === "string" ? new Date(job.scheduledStart) : job.scheduledStart)
    : null;
  const scheduledEnd = job.scheduledEnd
    ? (typeof job.scheduledEnd === "string" ? new Date(job.scheduledEnd) : job.scheduledEnd)
    : null;
  const isAllDay = job.isAllDay === true;

  const jobId = job.id || "unknown";

  // INVARIANT 1: CANONICAL SCHEDULING - isAllDay=true REQUIRES scheduledStart
  // isAllDay is a display flag; scheduledStart IS the scheduling determinant
  if (isAllDay && scheduledStart === null) {
    throw new Error(
      `[${contextLabel}] INVARIANT VIOLATION: job ${jobId} isAllDay=true but scheduledStart IS NULL. ` +
      `All-day events must have scheduledStart set to midnight of the day.`
    );
  }

  // INVARIANT 2: scheduledStart requires scheduledEnd
  if (scheduledStart && !scheduledEnd) {
    throw new Error(
      `[${contextLabel}] INVARIANT VIOLATION: job ${jobId} has scheduledStart but no scheduledEnd`
    );
  }

  // INVARIANT 3: scheduledEnd must be >= scheduledStart
  // Note: All-day events have end at 23:59:59 which is > start at 00:00:00
  if (scheduledStart && scheduledEnd && scheduledEnd < scheduledStart) {
    throw new Error(
      `[${contextLabel}] INVARIANT VIOLATION: job ${jobId} scheduledEnd < scheduledStart`
    );
  }

  // INVARIANT 4: openSubStatus requires status='open'
  if (job.openSubStatus && status !== "open") {
    throw new Error(
      `[${contextLabel}] INVARIANT VIOLATION: job ${jobId} has openSubStatus='${job.openSubStatus}' but status='${status}' (must be 'open')`
    );
  }
}

/**
 * MODEL A INVARIANT: Assert all-day jobs have proper midnight timestamps.
 *
 * Rules:
 * - If isAllDay=true and job is scheduled:
 *   - scheduledStart MUST be midnight (00:00:00)
 *   - scheduledEnd MUST be 23:59:59 (same day) OR next day 00:00:00 (exclusive)
 * - If isAllDay=false:
 *   - scheduledEnd must be > scheduledStart
 *
 * @param job - Job to validate
 * @param contextLabel - Label for error messages
 * @throws Error if invariant is violated
 */
export function assertAllDayTimestampInvariant(
  job: {
    id?: string;
    scheduledStart?: Date | string | null;
    scheduledEnd?: Date | string | null;
    isAllDay?: boolean | null;
  },
  contextLabel = "assertAllDayTimestampInvariant"
): void {
  const jobId = job.id || "unknown";
  const isAllDay = job.isAllDay === true;

  if (!isAllDay) {
    // Timed event: just check end > start
    if (job.scheduledStart && job.scheduledEnd) {
      const start = typeof job.scheduledStart === "string" ? new Date(job.scheduledStart) : job.scheduledStart;
      const end = typeof job.scheduledEnd === "string" ? new Date(job.scheduledEnd) : job.scheduledEnd;
      if (end <= start) {
        throw new Error(
          `[${contextLabel}] INVARIANT VIOLATION: job ${jobId} timed event has end <= start`
        );
      }
    }
    return;
  }

  // All-day event: check midnight boundaries
  if (!job.scheduledStart) {
    throw new Error(
      `[${contextLabel}] INVARIANT VIOLATION: job ${jobId} isAllDay=true but scheduledStart IS NULL. ` +
      `All-day events must have scheduledStart set to midnight.`
    );
  }

  const start = typeof job.scheduledStart === "string" ? new Date(job.scheduledStart) : job.scheduledStart;

  // Check if start is midnight (00:00:00)
  if (start.getUTCHours() !== 0 || start.getUTCMinutes() !== 0 || start.getUTCSeconds() !== 0) {
    throw new Error(
      `[${contextLabel}] INVARIANT VIOLATION: job ${jobId} isAllDay=true but scheduledStart is not midnight. ` +
      `Got: ${start.toISOString()}`
    );
  }

  // If end is provided, check it matches DB constraint exactly: 23:59:59 same day
  // DB enforces: EXTRACT(HOUR)=23, EXTRACT(MINUTE)=59, EXTRACT(SECOND)=59
  if (job.scheduledEnd) {
    const end = typeof job.scheduledEnd === "string" ? new Date(job.scheduledEnd) : job.scheduledEnd;
    const startDay = start.toISOString().split("T")[0];
    const endDay = end.toISOString().split("T")[0];

    const isEndOfDay = startDay === endDay
      && end.getUTCHours() === 23
      && end.getUTCMinutes() === 59
      && end.getUTCSeconds() === 59;

    if (!isEndOfDay) {
      throw new Error(
        `[${contextLabel}] INVARIANT VIOLATION: job ${jobId} isAllDay=true but scheduledEnd is invalid. ` +
        `Expected ${startDay}T23:59:59.000Z. Got: ${end.toISOString()}`
      );
    }
  }
}

// ============================================================================
// Query Result Assertions (DEV-only)
// ============================================================================

/**
 * Assert calendar query results meet invariants.
 * All returned jobs must be scheduled and have status='open'.
 */
export function assertCalendarQueryResults(results: JobLike[], contextLabel: string): void {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  for (const job of results) {
    const status = job.status ? normalizeJobStatus(job.status) : null;

    // Calendar results must be open
    if (status !== "open") {
      console.warn(
        `[${contextLabel}] WARNING: calendar query returned non-open job ${job.id} (status=${status})`
      );
    }

    // Calendar results must have schedule
    if (!isJobScheduled(job)) {
      throw new Error(
        `[${contextLabel}] INVARIANT VIOLATION: calendar query returned unscheduled job ${job.id}`
      );
    }
  }
}

/**
 * Assert backlog query results meet invariants.
 * All returned jobs must be unscheduled and have status='open'.
 */
export function assertBacklogQueryResults(results: JobLike[], contextLabel: string): void {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  for (const job of results) {
    const status = job.status ? normalizeJobStatus(job.status) : null;

    // Backlog results must be open
    if (status !== "open") {
      throw new Error(
        `[${contextLabel}] INVARIANT VIOLATION: backlog query returned non-open job ${job.id} (status=${status})`
      );
    }

    // Backlog results must NOT have schedule
    if (isJobScheduled(job)) {
      throw new Error(
        `[${contextLabel}] INVARIANT VIOLATION: backlog query returned scheduled job ${job.id}`
      );
    }
  }
}

// ============================================================================
// Utility Exports
// ============================================================================

/**
 * Check if job has a valid schedule
 * @deprecated Use isJobScheduled from shared/schema.ts instead
 */
export function hasSchedule(job: JobLike): boolean {
  return isJobScheduled(job);
}

/**
 * Check if job has a technician assigned
 * @deprecated Use isJobAssigned from shared/schema.ts instead
 */
export function hasTechnicianAssigned(job: {
  primaryTechnicianId?: string | null;
  assignedTechnicianIds?: string[] | null;
}): boolean {
  return isJobAssigned(job);
}

// ============================================================================
// Scheduling Diagnostics
// ============================================================================

export interface SchedulingDiagnostics {
  totalJobs: number;
  scheduledByScheduledStart: number;  // Jobs with scheduledStart IS NOT NULL
  scheduledByIsAllDay: number;        // Jobs with isAllDay=true (should have scheduledStart too)
  allDayWithoutScheduledStart: number; // INVALID: isAllDay=true but scheduledStart IS NULL
  unscheduled: number;                // Jobs with scheduledStart IS NULL and isAllDay != true
  mismatches: Array<{
    jobId: string;
    jobNumber: number;
    issue: string;
    scheduledStart: string | null;
    isAllDay: boolean;
  }>;
}

/**
 * Compute scheduling diagnostics for a set of jobs.
 * Returns counts and any mismatches between expected invariants and actual data.
 */
export function computeSchedulingDiagnostics(jobs: JobLike[]): SchedulingDiagnostics {
  const result: SchedulingDiagnostics = {
    totalJobs: jobs.length,
    scheduledByScheduledStart: 0,
    scheduledByIsAllDay: 0,
    allDayWithoutScheduledStart: 0,
    unscheduled: 0,
    mismatches: [],
  };

  for (const job of jobs) {
    const hasScheduledStart = job.scheduledStart != null;
    const isAllDay = job.isAllDay === true;

    if (hasScheduledStart) {
      result.scheduledByScheduledStart++;
    }

    if (isAllDay) {
      result.scheduledByIsAllDay++;

      // CANONICAL INVARIANT CHECK: isAllDay=true MUST have scheduledStart
      if (!hasScheduledStart) {
        result.allDayWithoutScheduledStart++;
        result.mismatches.push({
          jobId: job.id || "unknown",
          jobNumber: job.jobNumber ?? 0,
          issue: "isAllDay=true but scheduledStart IS NULL (invalid - should be midnight)",
          scheduledStart: job.scheduledStart?.toString() || null,
          isAllDay,
        });
      }
    }

    if (!hasScheduledStart && !isAllDay) {
      result.unscheduled++;
    }
  }

  return result;
}

/**
 * Log scheduling diagnostics to console (DEV-only).
 */
export function logSchedulingDiagnostics(diagnostics: SchedulingDiagnostics, contextLabel: string): void {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  console.log(`[${contextLabel}] Scheduling Diagnostics:`);
  console.log(`  Total jobs: ${diagnostics.totalJobs}`);
  console.log(`  Scheduled (by scheduledStart): ${diagnostics.scheduledByScheduledStart}`);
  console.log(`  All-day events: ${diagnostics.scheduledByIsAllDay}`);
  console.log(`  All-day WITHOUT scheduledStart (INVALID): ${diagnostics.allDayWithoutScheduledStart}`);
  console.log(`  Unscheduled: ${diagnostics.unscheduled}`);

  if (diagnostics.mismatches.length > 0) {
    console.warn(`  MISMATCHES (${diagnostics.mismatches.length}):`);
    for (const m of diagnostics.mismatches.slice(0, 10)) {
      console.warn(`    Job #${m.jobNumber} (${m.jobId}): ${m.issue}`);
    }
    if (diagnostics.mismatches.length > 10) {
      console.warn(`    ... and ${diagnostics.mismatches.length - 10} more`);
    }
  }
}

// ============================================================================
// Scheduling Write Context Audit
// ============================================================================

export const SCHEDULING_WRITE_CONTEXTS = new Set([
  "storage:createAssignment",
  "storage:updateAssignment",
  "storage:deleteAssignment",
  "route:jobs:create",
  "route:jobs:update",
  "storage:jobs:statusTransition",
] as const);

export type SchedulingWriteContext = typeof SCHEDULING_WRITE_CONTEXTS extends Set<infer T> ? T : string;

/**
 * DEV-only: Assert that a scheduling write is using a sanctioned context.
 */
export function assertSchedulingWriteContext(contextLabel: string): void {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  if (!SCHEDULING_WRITE_CONTEXTS.has(contextLabel as SchedulingWriteContext)) {
    console.error(
      `[SCHEDULING AUDIT] UNSANCTIONED WRITE CONTEXT: "${contextLabel}" is not in SCHEDULING_WRITE_CONTEXTS.`
    );
    throw new Error(
      `Scheduling write from unsanctioned context: "${contextLabel}". ` +
      `Allowed contexts: ${Array.from(SCHEDULING_WRITE_CONTEXTS).join(", ")}`
    );
  }
}

// ============================================================================
// Consolidated Scheduling Patch Intent
// ============================================================================

export interface SchedulingPatchIntent {
  scheduledStart?: Date | string | null;
  scheduledEnd?: Date | string | null;
  isAllDay?: boolean;
  durationMinutes?: number;
  status?: string | null;
  openSubStatus?: OpenSubStatus | null;
  timezone?: string;
  expectedVersion?: number;
}

export interface SchedulingPatchResult {
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  isAllDay: boolean;
  status: JobStatus;
  openSubStatus: OpenSubStatus | null;
  durationMinutes: number;
  writeIntent?: SchedulingWriteIntent;
}

export interface SchedulingWriteIntent {
  expectedVersion?: number;
  newVersion: number;
  contextLabel: string;
  oldFields: {
    scheduledStart: Date | string | null;
    scheduledEnd: Date | string | null;
    isAllDay: boolean | null;
    status: string | null;
    openSubStatus: string | null;
    version: number | null;
  } | null;
  newFields: {
    scheduledStart: Date | null;
    scheduledEnd: Date | null;
    isAllDay: boolean;
    status: string;
    openSubStatus: string | null;
    version: number;
  };
}

/**
 * Apply a scheduling patch intent to a job.
 *
 * This is the SINGLE ENTRYPOINT for all scheduling field modifications.
 * It enforces:
 * - Terminal immutability (cannot reschedule closed/invoiced jobs)
 * - Schedule normalization (all-day boundary alignment)
 * - Status stays as 'open' (scheduling doesn't change lifecycle status)
 * - openSubStatus invariant (must be null if status !== 'open')
 * - Optimistic locking intent (expectedVersion -> newVersion)
 * - Audit log preparation
 * - DEV-only invariant assertions
 */
export function applyJobSchedulingPatch(
  existingJob: JobLike | null,
  patchIntent: SchedulingPatchIntent,
  contextLabel: string
): SchedulingPatchResult {
  // DEV: Assert sanctioned context
  assertSchedulingWriteContext(contextLabel);

  // TERMINAL IMMUTABILITY: Block schedule changes on terminal jobs
  assertTerminalImmutable(existingJob, patchIntent, contextLabel);

  // Determine effective values (merge patch with existing)
  const effectiveStart = patchIntent.scheduledStart !== undefined
    ? patchIntent.scheduledStart
    : existingJob?.scheduledStart ?? null;

  const effectiveEnd = patchIntent.scheduledEnd !== undefined
    ? patchIntent.scheduledEnd
    : existingJob?.scheduledEnd ?? null;

  const effectiveIsAllDay = patchIntent.isAllDay !== undefined
    ? patchIntent.isAllDay
    : existingJob?.isAllDay ?? false;

  // NORMALIZE: Use domain helper for schedule field derivation
  const schedule = deriveScheduleFields({
    scheduledStart: effectiveStart,
    scheduledEnd: effectiveEnd,
    durationMinutes: patchIntent.durationMinutes,
    isAllDay: effectiveIsAllDay,
    timezone: patchIntent.timezone,
  });

  // STATUS: Scheduling doesn't change lifecycle status - it stays 'open' for active jobs
  const existingStatus = existingJob?.status ? normalizeJobStatus(existingJob.status) : "open";
  const status = patchIntent.status !== undefined && patchIntent.status !== null
    ? normalizeJobStatus(patchIntent.status)
    : existingStatus;

  // OPEN SUB-STATUS: Preserve or update based on patch
  // INVARIANT: openSubStatus must be null if status !== 'open'
  let openSubStatus: OpenSubStatus | null = null;
  if (status === "open") {
    openSubStatus = patchIntent.openSubStatus !== undefined
      ? patchIntent.openSubStatus ?? null
      : (existingJob?.openSubStatus as OpenSubStatus | null) ?? null;
  }

  // VERSIONING: Calculate new version for optimistic lock
  // TASK 1: No ?? 0 fallback - existing jobs must have initialized version
  // For new jobs (existingJob is null), version will be set to 1 by the caller
  const currentVersion = existingJob?.version ?? 0; // Only null for brand new jobs
  const newVersion = currentVersion + 1;

  // BUILD WRITE INTENT
  const writeIntent: SchedulingWriteIntent = {
    expectedVersion: patchIntent.expectedVersion,
    newVersion,
    contextLabel,
    oldFields: existingJob
      ? {
          scheduledStart: existingJob.scheduledStart ?? null,
          scheduledEnd: existingJob.scheduledEnd ?? null,
          isAllDay: existingJob.isAllDay ?? null,
          status: existingJob.status ?? null,
          openSubStatus: existingJob.openSubStatus ?? null,
          version: existingJob.version ?? null,
        }
      : null,
    newFields: {
      scheduledStart: schedule.scheduledStart,
      scheduledEnd: schedule.scheduledEnd,
      isAllDay: schedule.isAllDay,
      status,
      openSubStatus,
      version: newVersion,
    },
  };

  const result: SchedulingPatchResult = {
    scheduledStart: schedule.scheduledStart,
    scheduledEnd: schedule.scheduledEnd,
    isAllDay: schedule.isAllDay,
    status,
    openSubStatus,
    durationMinutes: schedule.durationMinutes,
    writeIntent,
  };

  // DEV: Assert final result meets invariants
  assertSchedulingInvariants(
    {
      id: existingJob?.id,
      status: result.status,
      openSubStatus: result.openSubStatus,
      scheduledStart: result.scheduledStart,
      scheduledEnd: result.scheduledEnd,
      isAllDay: result.isAllDay,
    },
    contextLabel
  );

  return result;
}

/**
 * VERSION MISMATCH error for optimistic locking conflicts
 */
export class VersionMismatchError extends Error {
  public readonly statusCode = 409;
  public readonly code = "VERSION_MISMATCH";

  constructor(expectedVersion: number, actualVersion: number) {
    super(
      `Scheduling was modified by another user. Please refresh and try again. ` +
      `(Expected version: ${expectedVersion}, Actual version: ${actualVersion})`
    );
    this.name = "VersionMismatchError";
  }
}

/**
 * VERSION NOT INITIALIZED error - job has null version (pre-migration data)
 * TASK 1: No ?? 0 fallback allowed - must reject uninitialized versions
 */
export class VersionNotInitializedError extends Error {
  public readonly statusCode = 409;
  public readonly code = "VERSION_NOT_INITIALIZED";

  constructor(jobId?: string) {
    super(
      `Job version is not initialized. Please refresh and try again.` +
      (jobId ? ` (Job ID: ${jobId})` : "")
    );
    this.name = "VersionNotInitializedError";
  }
}

/**
 * INVARIANT VIOLATION error - job data violates scheduling/status invariants.
 * Used for runtime enforcement in production (not just dev mode).
 */
export class InvariantViolationError extends Error {
  public readonly statusCode = 400;
  public readonly code = "INVARIANT_VIOLATION";
  public readonly violations: string[];

  constructor(violations: string[], jobId?: string) {
    const prefix = jobId ? `Job ${jobId}: ` : "";
    super(`${prefix}${violations.join("; ")}`);
    this.name = "InvariantViolationError";
    this.violations = violations;
  }
}

/**
 * Validate job invariants for production use.
 * Throws InvariantViolationError if any invariant is violated.
 *
 * Invariants checked:
 * 1. status must be one of: open, completed, invoiced, archived
 * 2. openSubStatus must be NULL unless status = 'open'
 * 3. scheduledEnd requires scheduledStart (no end without start)
 * 4. All-day events: scheduledStart must be at midnight (00:00:00)
 * 5. All-day events: scheduledEnd must be at 23:59:59
 * 6. scheduledEnd must be >= scheduledStart
 */
export function assertJobInvariants(
  job: {
    id?: string;
    status?: string | null;
    openSubStatus?: string | null;
    scheduledStart?: Date | string | null;
    scheduledEnd?: Date | string | null;
    isAllDay?: boolean | null;
  },
  contextLabel = "assertJobInvariants"
): void {
  const violations: string[] = [];
  const jobId = job.id || "unknown";

  // Parse dates
  const scheduledStart = job.scheduledStart
    ? (typeof job.scheduledStart === "string" ? new Date(job.scheduledStart) : job.scheduledStart)
    : null;
  const scheduledEnd = job.scheduledEnd
    ? (typeof job.scheduledEnd === "string" ? new Date(job.scheduledEnd) : job.scheduledEnd)
    : null;
  const isAllDay = job.isAllDay === true;

  // INVARIANT 1: status must be one of the 4 lifecycle values
  const validStatuses = ["open", "completed", "invoiced", "archived"];
  if (job.status && !validStatuses.includes(job.status)) {
    violations.push(`status '${job.status}' is not valid (must be: ${validStatuses.join(", ")})`);
  }

  // INVARIANT 2: openSubStatus must be NULL unless status = 'open'
  if (job.openSubStatus && job.status !== "open") {
    violations.push(`openSubStatus='${job.openSubStatus}' requires status='open', but status='${job.status}'`);
  }

  // INVARIANT 3: scheduledEnd requires scheduledStart
  if (scheduledEnd && !scheduledStart) {
    violations.push("scheduledEnd is set but scheduledStart is NULL");
  }

  // INVARIANT 4: All-day events must have scheduledStart at midnight
  if (isAllDay && scheduledStart) {
    const hours = scheduledStart.getUTCHours();
    const minutes = scheduledStart.getUTCMinutes();
    const seconds = scheduledStart.getUTCSeconds();
    if (hours !== 0 || minutes !== 0 || seconds !== 0) {
      violations.push(`all-day event scheduledStart must be midnight (00:00:00), got ${hours}:${minutes}:${seconds}`);
    }
  }

  // INVARIANT 5: All-day events must have scheduledEnd at 23:59:59
  if (isAllDay && scheduledEnd) {
    const hours = scheduledEnd.getUTCHours();
    const minutes = scheduledEnd.getUTCMinutes();
    const seconds = scheduledEnd.getUTCSeconds();
    if (hours !== 23 || minutes !== 59 || seconds !== 59) {
      violations.push(`all-day event scheduledEnd must be 23:59:59, got ${hours}:${minutes}:${seconds}`);
    }
  }

  // INVARIANT 6: scheduledEnd must be >= scheduledStart
  if (scheduledStart && scheduledEnd && scheduledEnd < scheduledStart) {
    violations.push("scheduledEnd is before scheduledStart");
  }

  if (violations.length > 0) {
    throw new InvariantViolationError(violations, jobId);
  }
}

/**
 * Check version and throw if mismatch or not initialized.
 * TASK 1: No ?? 0 fallback - must reject VERSION_NOT_INITIALIZED
 */
export function assertVersionMatch(
  writeIntent: SchedulingWriteIntent,
  actualVersion: number | null | undefined,
  jobId?: string
): void {
  if (writeIntent.expectedVersion === undefined) {
    return;
  }

  // TASK 1: Reject uninitialized versions instead of defaulting to 0
  if (actualVersion === null || actualVersion === undefined) {
    throw new VersionNotInitializedError(jobId);
  }

  if (writeIntent.expectedVersion !== actualVersion) {
    throw new VersionMismatchError(writeIntent.expectedVersion, actualVersion);
  }
}

/**
 * Check if a patch intent modifies any scheduling fields.
 */
export function isSchedulingPatch(patch: Record<string, unknown>): boolean {
  return (
    patch.hasOwnProperty("scheduledStart") ||
    patch.hasOwnProperty("scheduledEnd") ||
    patch.hasOwnProperty("isAllDay") ||
    patch.hasOwnProperty("durationMinutes")
  );
}
