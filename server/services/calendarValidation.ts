/**
 * Calendar Validation Service - Slice 2
 *
 * Provides schedule validation for calendar assignments:
 * - Working hours validation (technician must be working, time within hours)
 * - Overlap/conflict detection (no double-booking technicians)
 */

import { db } from "../db";
import { eq, and, ne, isNotNull, sql, or, lt, gt } from "drizzle-orm";
import { workingHours, jobs, users } from "@shared/schema";

// ============================================================================
// Error Codes
// ============================================================================

export const ScheduleErrorCodes = {
  OUTSIDE_WORKING_HOURS: "OUTSIDE_WORKING_HOURS",
  CROSS_DAY_NOT_ALLOWED: "CROSS_DAY_NOT_ALLOWED",
  TECHNICIAN_OVERBOOKED: "TECHNICIAN_OVERBOOKED",
  TECHNICIAN_NOT_FOUND: "TECHNICIAN_NOT_FOUND",
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
}

/**
 * Validate a schedule assignment for a technician.
 *
 * Performs:
 * A) Working hours validation - checks technician is working that day and time is within hours
 * B) Overlap validation - checks no conflicting jobs for this technician
 *
 * @throws ScheduleValidationError with appropriate code and details
 */
export async function validateSchedule(options: ValidateScheduleOptions): Promise<void> {
  const { companyId, technicianUserId, startAt, endAt, excludeJobId } = options;

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
  // C) Working hours validation
  // ========================================
  const dayOfWeek = startAt.getDay(); // 0 = Sunday, 6 = Saturday
  const dayName = DAY_NAMES[dayOfWeek];

  // Get working hours for this technician on this day
  const hoursRows = await db
    .select()
    .from(workingHours)
    .where(
      and(
        eq(workingHours.userId, technicianUserId),
        eq(workingHours.dayOfWeek, dayOfWeek)
      )
    )
    .limit(1);

  const hours = hoursRows[0];

  // If no working hours record or not working that day
  if (!hours || !hours.isWorking) {
    throw new ScheduleValidationError(
      400,
      `Technician is not scheduled to work on ${dayName}`,
      ScheduleErrorCodes.OUTSIDE_WORKING_HOURS,
      {
        dayOfWeek,
        dayName,
      }
    );
  }

  // Check if start/end times are defined
  if (!hours.startTime || !hours.endTime) {
    throw new ScheduleValidationError(
      400,
      `Technician has no defined working hours for ${dayName}`,
      ScheduleErrorCodes.OUTSIDE_WORKING_HOURS,
      {
        dayOfWeek,
        dayName,
      }
    );
  }

  // Parse working hours
  const workStartMinutes = parseTimeToMinutes(hours.startTime);
  const workEndMinutes = parseTimeToMinutes(hours.endTime);

  // Get assignment times in minutes
  const assignStartMinutes = getTimeInMinutes(startAt);
  const assignEndMinutes = getTimeInMinutes(endAt);

  // Check if assignment is fully within working hours
  if (assignStartMinutes < workStartMinutes || assignEndMinutes > workEndMinutes) {
    throw new ScheduleValidationError(
      400,
      `Assignment time (${formatMinutesToTime(assignStartMinutes)}-${formatMinutesToTime(assignEndMinutes)}) is outside working hours (${hours.startTime}-${hours.endTime}) on ${dayName}`,
      ScheduleErrorCodes.OUTSIDE_WORKING_HOURS,
      {
        dayOfWeek,
        dayName,
        allowedStart: hours.startTime,
        allowedEnd: hours.endTime,
      }
    );
  }

  // ========================================
  // D) Overlap/conflict validation
  // ========================================
  // Find any jobs that overlap with this time slot for the same technician
  // Overlap condition: NOT (existingEnd <= newStart OR existingStart >= newEnd)
  // Which is equivalent to: existingStart < newEnd AND existingEnd > newStart

  const overlapConditions = [
    eq(jobs.companyId, companyId),
    isNotNull(jobs.scheduledStart),
    isNotNull(jobs.scheduledEnd),
    // Technician is assigned (either primary or in the array)
    or(
      eq(jobs.primaryTechnicianId, technicianUserId),
      sql`${technicianUserId} = ANY(${jobs.assignedTechnicianIds})`
    ),
    // Overlap check: existing.start < new.end AND existing.end > new.start
    lt(jobs.scheduledStart, endAt),
    gt(jobs.scheduledEnd, startAt),
  ];

  // Exclude the job being updated (for PATCH operations)
  if (excludeJobId) {
    overlapConditions.push(ne(jobs.id, excludeJobId));
  }

  const conflictingJobs = await db
    .select({
      id: jobs.id,
      jobNumber: jobs.jobNumber,
      summary: jobs.summary,
      scheduledStart: jobs.scheduledStart,
      scheduledEnd: jobs.scheduledEnd,
    })
    .from(jobs)
    .where(and(...overlapConditions))
    .limit(1);

  if (conflictingJobs.length > 0) {
    const conflict = conflictingJobs[0];
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
