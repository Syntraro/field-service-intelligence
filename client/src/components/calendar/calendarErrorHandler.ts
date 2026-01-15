/**
 * Calendar Error Handler - Hardening
 *
 * Handles validation errors from calendar API with detailed user feedback:
 * - OUTSIDE_WORKING_HOURS: Shows allowed hours
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
    allowedStart?: string;
    allowedEnd?: string;
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
 * Format time string from "HH:MM" to readable format
 */
function formatTime(timeStr?: string): string {
  if (!timeStr) return "";
  const [hours, minutes] = timeStr.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return minutes ? `${displayHours}:${minutes.toString().padStart(2, "0")} ${period}` : `${displayHours} ${period}`;
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
    case "OUTSIDE_WORKING_HOURS": {
      const dayName = details?.dayName || "this day";
      const allowedStart = formatTime(details?.allowedStart);
      const allowedEnd = formatTime(details?.allowedEnd);
      const hoursMsg = allowedStart && allowedEnd
        ? `Working hours on ${dayName}: ${allowedStart} - ${allowedEnd}`
        : `Technician is not scheduled to work on ${dayName}`;

      toast({
        title: "Outside Working Hours",
        description: hoursMsg,
        variant: "destructive",
        duration: 6000,
      });
      break;
    }

    case "TECHNICIAN_OVERBOOKED": {
      const conflictJobNum = details?.conflictingJobNumber;
      const conflictTitle = details?.conflictingTitle;
      const conflictStart = formatISOTime(details?.conflictingStart);
      const conflictEnd = formatISOTime(details?.conflictingEnd);

      let description = "Technician has a scheduling conflict.";
      if (conflictJobNum) {
        description = `Conflicts with Job #${conflictJobNum}`;
        if (conflictTitle) {
          description += ` - ${conflictTitle}`;
        }
        if (conflictStart && conflictEnd) {
          description += ` (${conflictStart} - ${conflictEnd})`;
        }
      }

      toast({
        title: "Scheduling Conflict",
        description,
        variant: "destructive",
        duration: 6000,
      });
      break;
    }

    case "CROSS_DAY_NOT_ALLOWED": {
      toast({
        title: "Invalid Time Range",
        description: "Assignments cannot span multiple days. Please select start and end times on the same day.",
        variant: "destructive",
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
