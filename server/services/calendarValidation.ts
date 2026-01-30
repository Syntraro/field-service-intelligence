/**
 * Calendar Validation Service - Slice 2
 *
 * Provides schedule validation for calendar assignments:
 * - Working hours validation (technician must be working, time within hours)
 * - Overlap/conflict detection (no double-booking technicians)
 */

import { db } from "../db";
import { eq, and, ne, isNotNull, isNull, sql, or, lt, gt } from "drizzle-orm";
import { jobs, users } from "@shared/schema";
import { IS_DEV } from "../utils/devFlags";

// ============================================================================
// Error Codes
// ============================================================================

export const ScheduleErrorCodes = {
  // OUTSIDE_WORKING_HOURS removed - scheduling allowed on any day
  CROSS_DAY_NOT_ALLOWED: "CROSS_DAY_NOT_ALLOWED",
  TECHNICIAN_OVERBOOKED: "TECHNICIAN_OVERBOOKED",
  TECHNICIAN_NOT_FOUND: "TECHNICIAN_NOT_FOUND",
  // 2026-01-29: Added for all-day vs all-day conflict detection
  ANYTIME_JOB_EXISTS: "ANYTIME_JOB_EXISTS",
} as const;

export type ScheduleErrorCode = typeof ScheduleErrorCodes[keyof typeof ScheduleErrorCodes];

// ============================================================================
// Custom Error Class
// ============================================================================

export interface ScheduleValidationErrorDetails {
  code: ScheduleErrorCode;
  allowedStart?: string;
  allowedEnd?: string;
  dayOfWeek?: number;
  dayName?: string;
  conflictingJobId?: string;
  conflictingJobNumber?: number;
  conflictingTitle?: string;
  conflictingStart?: string;
  conflictingEnd?: string;
}

export class ScheduleValidationError extends Error {
  public readonly statusCode: number;
  public readonly code: ScheduleErrorCode;
  public readonly details: ScheduleValidationErrorDetails;

  constructor(
    statusCode: number,
    message: string,
    code: ScheduleErrorCode,
    details?: Partial<ScheduleValidationErrorDetails>
  ) {
    super(message);
    this.name = "ScheduleValidationError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = { code, ...details };
  }

  toJSON() {
    return {
      message: this.message,
      code: this.code,
      details: this.details,
    };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Parse a time string like "08:00" into minutes from midnight
 */
function parseTimeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Format minutes from midnight to "HH:MM" string
 */
function formatMinutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}

/**
 * Get time of day in minutes from a Date object
 */
function getTimeInMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Check if two dates are on the same calendar day
 */
function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

// ============================================================================
// Main Validation Function
// ============================================================================

export interface ValidateScheduleOptions {
  companyId: string;
  technicianUserId: string;
  startAt: Date;
  endAt: Date;
  excludeJobId?: string;
  /**
   * 2026-01-29: Indicates if the job being scheduled is all-day ("Anytime").
   * - If false/undefined (timed event): ignore existing all-day jobs (non-blocking)
   * - If true (all-day event): conflict with existing all-day jobs for same tech/day
   */
  isAllDay?: boolean;
}

/**
 * Validate a schedule assignment for a technician.
 *
 * Performs:
 * A) Cross-day validation - assignments must start and end on same day
 * B) Technician exists in tenant
 * C) Overlap validation - checks no conflicting jobs for this technician
 *
 * NOTE: Working hours validation has been REMOVED. Scheduling allowed on any day.
 *
 * @throws ScheduleValidationError with appropriate code and details
 */
export async function validateSchedule(options: ValidateScheduleOptions): Promise<void> {
  const { companyId, technicianUserId, startAt, endAt, excludeJobId, isAllDay } = options;

  // DEV-only: Log validation inputs for debugging conflict issues (2026-01-29)
  if (IS_DEV) {
    console.log('[validateSchedule] INPUT:', {
      companyId: companyId?.slice(0, 8) + '...',
      technicianUserId: technicianUserId?.slice(0, 8) + '...',
      startAt: startAt?.toISOString(),
      endAt: endAt?.toISOString(),
      excludeJobId: excludeJobId?.slice(0, 8) + '...',
      isAllDay: isAllDay ?? false,
    });
  }

  // ========================================
  // A) Cross-day validation
  // ========================================
  if (!isSameDay(startAt, endAt)) {
    throw new ScheduleValidationError(
      400,
      "Assignments cannot span multiple days",
      ScheduleErrorCodes.CROSS_DAY_NOT_ALLOWED,
      {
        dayOfWeek: startAt.getDay(),
        dayName: DAY_NAMES[startAt.getDay()],
      }
    );
  }

  // ========================================
  // B) Verify technician exists in tenant
  // ========================================
  const techRows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, technicianUserId), eq(users.companyId, companyId)))
    .limit(1);

  if (techRows.length === 0) {
    throw new ScheduleValidationError(
      400,
      "Technician not found in this company",
      ScheduleErrorCodes.TECHNICIAN_NOT_FOUND
    );
  }

  // ========================================
  // C) Working hours validation - REMOVED
  // ========================================
  // Working hours validation has been completely removed.
  // Scheduling is allowed on ANY day for ANY technician.
  // No warnings, no restrictions, no feature flags.

  // ========================================
  // D) Overlap/conflict validation
  // ========================================
  // 2026-01-29: Conflict semantics for all-day ("Anytime") vs timed jobs:
  // - Timed vs timed: normal overlap check (standard double-booking prevention)
  // - Timed vs all-day: NO conflict (all-day jobs are non-blocking "Anytime" slots)
  // - All-day vs all-day: CONFLICT (only one "Anytime" job per tech per day)
  // - All-day vs timed: NO conflict (scheduling all-day doesn't conflict with timed)
  //
  // Implementation:
  // - If input is timed (isAllDay=false): only check against OTHER timed jobs
  // - If input is all-day (isAllDay=true): only check against OTHER all-day jobs on same day

  const overlapConditions = [
    eq(jobs.companyId, companyId),
    isNotNull(jobs.scheduledStart),
    isNotNull(jobs.scheduledEnd),
    // 2026-01-29: CRITICAL - exclude soft-deleted jobs from conflict check
    isNull(jobs.deletedAt),
    // Technician is assigned (either primary or in the array)
    or(
      eq(jobs.primaryTechnicianId, technicianUserId),
      sql`${technicianUserId} = ANY(${jobs.assignedTechnicianIds})`
    ),
  ];

  // Exclude the job being updated (for PATCH operations)
  if (excludeJobId) {
    overlapConditions.push(ne(jobs.id, excludeJobId));
  }

  // 2026-01-29: Conditional conflict logic based on input type
  if (isAllDay) {
    // All-day input: check only against other all-day jobs on the same day
    // All-day jobs span midnight to 23:59:59, so any overlap means same day
    overlapConditions.push(
      eq(jobs.isAllDay, true),
      // Overlap check: existing.start < new.end AND existing.end > new.start
      lt(jobs.scheduledStart, endAt),
      gt(jobs.scheduledEnd, startAt),
    );
  } else {
    // Timed input: check only against other timed jobs (not all-day)
    // All-day jobs are "Anytime" and don't block specific time slots
    overlapConditions.push(
      eq(jobs.isAllDay, false),
      // Overlap check: existing.start < new.end AND existing.end > new.start
      lt(jobs.scheduledStart, endAt),
      gt(jobs.scheduledEnd, startAt),
    );
  }

  const conflictingJobs = await db
    .select({
      id: jobs.id,
      jobNumber: jobs.jobNumber,
      summary: jobs.summary,
      scheduledStart: jobs.scheduledStart,
      scheduledEnd: jobs.scheduledEnd,
      isAllDay: jobs.isAllDay,
    })
    .from(jobs)
    .where(and(...overlapConditions))
    .limit(1);

  // DEV-only: Log query result for debugging (2026-01-29)
  if (IS_DEV) {
    console.log('[validateSchedule] CONFLICT QUERY RESULT:', {
      inputIsAllDay: isAllDay ?? false,
      foundCount: conflictingJobs.length,
      conflicts: conflictingJobs.map(j => ({
        id: j.id?.slice(0, 8) + '...',
        jobNumber: j.jobNumber,
        isAllDay: j.isAllDay,
        scheduledStart: j.scheduledStart?.toISOString(),
        scheduledEnd: j.scheduledEnd?.toISOString(),
      })),
    });
  }

  if (conflictingJobs.length > 0) {
    const conflict = conflictingJobs[0];

    // DEV-only: Log detailed conflict info (2026-01-29)
    if (IS_DEV) {
      console.log('[validateSchedule] CONFLICT DETECTED:', {
        conflictJobId: conflict.id,
        conflictJobNumber: conflict.jobNumber,
        conflictIsAllDay: conflict.isAllDay,
        conflictStart: conflict.scheduledStart?.toISOString(),
        conflictEnd: conflict.scheduledEnd?.toISOString(),
        inputStart: startAt.toISOString(),
        inputEnd: endAt.toISOString(),
        inputIsAllDay: isAllDay ?? false,
        overlapCheck: {
          conflictStartBeforeInputEnd: conflict.scheduledStart! < endAt,
          conflictEndAfterInputStart: conflict.scheduledEnd! > startAt,
        },
      });
    }

    // 2026-01-29: Use appropriate error code and message based on conflict type
    if (isAllDay && conflict.isAllDay) {
      // All-day vs all-day conflict
      throw new ScheduleValidationError(
        409,
        `Technician already has an Anytime job (#${conflict.jobNumber}) scheduled for this day`,
        ScheduleErrorCodes.ANYTIME_JOB_EXISTS,
        {
          conflictingJobId: conflict.id,
          conflictingJobNumber: conflict.jobNumber,
          conflictingTitle: conflict.summary,
          conflictingStart: conflict.scheduledStart?.toISOString(),
          conflictingEnd: conflict.scheduledEnd?.toISOString(),
        }
      );
    }

    // Timed vs timed conflict (standard double-booking)
    throw new ScheduleValidationError(
      409,
      `Technician is already scheduled for Job #${conflict.jobNumber} during this time`,
      ScheduleErrorCodes.TECHNICIAN_OVERBOOKED,
      {
        conflictingJobId: conflict.id,
        conflictingJobNumber: conflict.jobNumber,
        conflictingTitle: conflict.summary,
        conflictingStart: conflict.scheduledStart?.toISOString(),
        conflictingEnd: conflict.scheduledEnd?.toISOString(),
      }
    );
  }
}

/**
 * Validate that an assignment does not span multiple days.
 * This is called for ALL assignments, regardless of technician assignment.
 *
 * @throws ScheduleValidationError with CROSS_DAY_NOT_ALLOWED code
 */
export function validateNoCrossDay(startAt: Date, endAt: Date): void {
  if (!isSameDay(startAt, endAt)) {
    throw new ScheduleValidationError(
      400,
      "Assignments cannot span multiple days",
      ScheduleErrorCodes.CROSS_DAY_NOT_ALLOWED,
      {
        dayOfWeek: startAt.getDay(),
        dayName: DAY_NAMES[startAt.getDay()],
      }
    );
  }
}

/**
 * Validate schedule with optional bypass (for future "manager override" feature)
 * For now, always validates. Returns validation result instead of throwing.
 */
export async function validateScheduleSafe(
  options: ValidateScheduleOptions
): Promise<{ valid: boolean; error?: ScheduleValidationError }> {
  try {
    await validateSchedule(options);
    return { valid: true };
  } catch (error) {
    if (error instanceof ScheduleValidationError) {
      return { valid: false, error };
    }
    throw error;
  }
}

// ============================================================================
// DEV-only Verification (2026-01-29)
// ============================================================================

/**
 * DEV-only: Verify conflict detection logic for all overlap scenarios.
 * Call this function to test the expected conflict behavior matrix:
 *
 * | Input Type | Existing Type | Expected Result |
 * |------------|---------------|-----------------|
 * | Timed      | Timed         | CONFLICT        |
 * | Timed      | All-day       | NO CONFLICT     |
 * | All-day    | Timed         | NO CONFLICT     |
 * | All-day    | All-day       | CONFLICT        |
 *
 * Usage: Import and call from a test route or REPL:
 *   import { verifyConflictSemantics } from "./services/calendarValidation";
 *   await verifyConflictSemantics();
 */
export async function verifyConflictSemantics(): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    console.warn('[verifyConflictSemantics] Skipping - only runs in development');
    return;
  }

  console.log('\n========================================');
  console.log('CONFLICT SEMANTICS VERIFICATION');
  console.log('========================================\n');

  // This function documents the expected behavior without actually running queries.
  // Real verification requires test data. This serves as a specification reference.

  const scenarios = [
    {
      name: 'Timed vs Timed (overlapping)',
      inputIsAllDay: false,
      existingIsAllDay: false,
      expectedConflict: true,
      reason: 'Standard double-booking prevention',
    },
    {
      name: 'Timed vs Timed (non-overlapping)',
      inputIsAllDay: false,
      existingIsAllDay: false,
      expectedConflict: false,
      reason: 'Different time slots, no overlap',
    },
    {
      name: 'Timed vs All-day (same day)',
      inputIsAllDay: false,
      existingIsAllDay: true,
      expectedConflict: false,
      reason: 'All-day ("Anytime") jobs are non-blocking for timed events',
    },
    {
      name: 'All-day vs Timed (same day)',
      inputIsAllDay: true,
      existingIsAllDay: false,
      expectedConflict: false,
      reason: 'Scheduling all-day does not conflict with existing timed jobs',
    },
    {
      name: 'All-day vs All-day (same day)',
      inputIsAllDay: true,
      existingIsAllDay: true,
      expectedConflict: true,
      reason: 'Only one "Anytime" job per technician per day allowed',
    },
    {
      name: 'All-day vs All-day (different day)',
      inputIsAllDay: true,
      existingIsAllDay: true,
      expectedConflict: false,
      reason: 'Different days, no conflict',
    },
  ];

  console.log('Expected Conflict Behavior Matrix:\n');
  console.log('| Scenario                        | Conflict? | Reason                                    |');
  console.log('|---------------------------------|-----------|-------------------------------------------|');

  for (const s of scenarios) {
    const conflictStr = s.expectedConflict ? 'YES' : 'NO';
    console.log(`| ${s.name.padEnd(31)} | ${conflictStr.padEnd(9)} | ${s.reason.padEnd(41)} |`);
  }

  console.log('\n----------------------------------------');
  console.log('Implementation Notes:');
  console.log('- isAllDay=true input: query filters for isAllDay=true in DB (all-day vs all-day)');
  console.log('- isAllDay=false input: query filters for isAllDay=false in DB (timed vs timed)');
  console.log('- Cross-type comparisons (timed vs all-day) never match due to filter');
  console.log('- Error code: ANYTIME_JOB_EXISTS for all-day conflicts');
  console.log('- Error code: TECHNICIAN_OVERBOOKED for timed conflicts');
  console.log('========================================\n');
}
