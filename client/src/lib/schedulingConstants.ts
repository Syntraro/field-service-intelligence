/**
 * Canonical Scheduling Constants
 *
 * SINGLE SOURCE OF TRUTH for duration options and day-of-week labels
 * used across scheduling, dispatch, recurring jobs, and team management surfaces.
 *
 * All consumers must import from this module instead of defining locally.
 *
 * 2026-04-08: Extracted from QuickAddJobDialog, JobScheduleFields,
 * DispatchDetailPanel, RecurringJobsPage, and TeamMemberDetail.
 */

// ============================================================================
// Duration options
// ============================================================================

/**
 * Standard duration values in minutes.
 * Used by dispatch (raw numbers + formatDuration) and scheduling forms.
 * Superset: includes all values from all surfaces.
 */
export const DURATION_MINUTES: number[] = [15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480];

/**
 * Duration options with abbreviated labels (for compact forms/dialogs).
 * Subset: 9 most common values for job creation forms.
 */
export const DURATION_OPTIONS_SHORT = [
  { value: 15, label: "15m" },
  { value: 30, label: "30m" },
  { value: 45, label: "45m" },
  { value: 60, label: "1h" },
  { value: 90, label: "1.5h" },
  { value: 120, label: "2h" },
  { value: 180, label: "3h" },
  { value: 240, label: "4h" },
  { value: 480, label: "8h" },
] as const;

/**
 * Duration options with verbose labels (for schedule detail fields).
 */
export const DURATION_OPTIONS_LONG = [
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 45, label: "45 min" },
  { value: 60, label: "1 hour" },
  { value: 90, label: "1.5 hours" },
  { value: 120, label: "2 hours" },
  { value: 180, label: "3 hours" },
  { value: 240, label: "4 hours" },
  { value: 480, label: "8 hours" },
] as const;

// ============================================================================
// Day-of-week labels
// ============================================================================

/**
 * Days of week with abbreviated labels (0=Sunday).
 */
export const DAYS_OF_WEEK_SHORT = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
] as const;

/**
 * Days of week with full labels (0=Sunday).
 */
export const DAYS_OF_WEEK_FULL = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;
