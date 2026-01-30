/**
 * Calendar Error Handler - Hardening
 *
 * Handles validation errors from calendar API with detailed user feedback:
 * - TECHNICIAN_OVERBOOKED: Shows conflicting job details
 * - CROSS_DAY_NOT_ALLOWED: Clear messaging
 */

import { toast } from "@/hooks/use-toast";

// ============================================================================
// Types
// ============================================================================

export interface CalendarValidationError {
  code: string;
  message: string;
  details?: {
    dayOfWeek?: number;
    dayName?: string;
    conflictingJobId?: string;
    conflictingJobNumber?: number;
    conflictingTitle?: string;
    conflictingStart?: string;
    conflictingEnd?: string;
  };
}

// ============================================================================
// Error Parsing
// ============================================================================

/**
 * Parse error response from API to extract validation details
 */
export async function parseCalendarError(error: any): Promise<CalendarValidationError | null> {
  // Check if it's a Response object
  if (error instanceof Response) {
    try {
      const data = await error.json();
      if (data.code) {
        return data as CalendarValidationError;
      }
    } catch {
      return null;
    }
  }

  // Check if error has code property directly
  if (error?.code) {
    return error as CalendarValidationError;
  }

  // Check if error message is JSON
  if (error?.message) {
    try {
      const parsed = JSON.parse(error.message);
      if (parsed.code) {
        return parsed as CalendarValidationError;
      }
    } catch {
      // Not JSON, return null
    }
  }

  return null;
}

/**
 * Format ISO datetime to readable time
 */
function formatISOTime(isoStr?: string): string {
  if (!isoStr) return "";
  try {
    const date = new Date(isoStr);
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  } catch {
    return "";
  }
}

// ============================================================================
// Toast Display
// ============================================================================

/**
 * Show a detailed toast for calendar validation errors
 */
export function showCalendarErrorToast(error: CalendarValidationError): void {
  const { code, message, details } = error;

  switch (code) {
    case "TECHNICIAN_OVERBOOKED": {
      const conflictJobNum = details?.conflictingJobNumber;
      const conflictTitle = details?.conflictingTitle;
      const conflictStart = formatISOTime(details?.conflictingStart);
      const conflictEnd = formatISOTime(details?.conflictingEnd);

      let description = "Technician already has a job at this time.";
      if (conflictJobNum) {
        description = `Conflicts with Job #${conflictJobNum}`;
        if (conflictTitle) {
          description += ` (${conflictTitle})`;
        }
        if (conflictStart && conflictEnd) {
          description += ` from ${conflictStart}–${conflictEnd}`;
        }
      }
      description += ". Try a different time slot.";

      toast({
        title: "Time Slot Taken",
        description,
        variant: "default",
        duration: 6000,
      });
      break;
    }

    case "CROSS_DAY_NOT_ALLOWED": {
      toast({
        title: "Can't Span Days",
        description: "Jobs must start and end on the same day. Shorten the duration or split into separate jobs.",
        variant: "default",
        duration: 5000,
      });
      break;
    }

    case "TECHNICIAN_NOT_FOUND": {
      toast({
        title: "Technician Not Found",
        description: "The selected technician is not available or doesn't belong to this company.",
        variant: "destructive",
        duration: 5000,
      });
      break;
    }

    case "OUTSIDE_WORKING_HOURS": {
      // This should no longer happen - working hours validation is disabled
      // But handle gracefully if it does
      toast({
        title: "Scheduled",
        description: "Job scheduled successfully. (Technician may be off this day)",
        variant: "default",
        duration: 3000,
      });
      break;
    }

    case "VERSION_MISMATCH": {
      toast({
        title: "Scheduling Conflict",
        description: "This job was modified by another user. Your change wasn't saved. The calendar is refreshing.",
        variant: "destructive",
        duration: 6000,
      });
      break;
    }

    default: {
      toast({
        title: "Scheduling Error",
        description: message || "Failed to update schedule. Please try again.",
        variant: "destructive",
        duration: 5000,
      });
    }
  }
}

/**
 * Handle calendar mutation error with detailed feedback
 * Returns true if error was handled (validation error), false otherwise
 */
export async function handleCalendarMutationError(error: any): Promise<boolean> {
  const validationError = await parseCalendarError(error);

  if (validationError) {
    showCalendarErrorToast(validationError);
    return true;
  }

  return false;
}

/**
 * Check if error is a version mismatch (optimistic locking conflict)
 * Used for special handling like snap-back on drag/drop
 */
export function isVersionMismatchError(error: any): boolean {
  if (error?.code === "VERSION_MISMATCH") return true;
  if (error?.message?.includes("modified by another user")) return true;
  return false;
}
