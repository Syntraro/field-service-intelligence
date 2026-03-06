// Calendar constants and utility functions
// Extracted from Calendar.tsx to reduce file size and improve maintainability
// MODEL A: Calendar events ARE jobs — no separate "assignment" entity

import { isJobOverdue } from "@shared/schema";

export const MONTH_ABBREV = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ============================================================================
// CalendarEvent: Normalized shape for all calendar views
// ============================================================================

/**
 * Normalized calendar event used by all views (monthly, weekly, daily).
 * Raw API events are transformed into this shape for consistent handling.
 *
 * MODEL A: There is no separate "assignment" entity. Calendar events ARE jobs.
 * The `assignmentId` field is always equal to the job ID.
 */
export type CalendarEvent = {
  /** Entity type discriminator: "visit" for job visits, "task" for tasks */
  kind: "visit" | "task";
  /** Job ID used as calendar event key (MODEL A: assignmentId === jobId). Kept as
   *  `assignmentId` for backward compat with drag/drop, grid keys, and mutations. */
  assignmentId: string;
  /** Resolved location key (prefers locationId, falls back to clientId) */
  locationKey: string;
  /** Primary technician ID (first from assignedTechnicianIds, or legacy assignedTechnicianId) */
  technicianId: string | null;
  /** All assigned technician IDs */
  technicianIds: string[];
  /** Year of the scheduled date */
  year: number;
  /** Month of the scheduled date (1-12) */
  month: number;
  /** Day of the scheduled date (1-31) */
  day: number;
  /** Date key for indexing (YYYY-MM-DD) */
  dateKey: string;
  /** Scheduled hour (0 for all-day events, actual hour for timed events) */
  scheduledHour: number | null;
  /** Scheduled start within hour in minutes (0-59) */
  scheduledStartMinutes: number | null;
  /** True if this is an all-day event (display flag - MODEL A) */
  isAllDay: boolean;
  /** Absolute start minutes from midnight (hour*60 + scheduledStartMinutes) - 0 for all-day */
  startMinutes: number | null;
  /** Duration in minutes */
  durationMinutes: number;
  /** Whether the job is completed */
  completed: boolean;
  /** Job number if assigned */
  jobNumber: string | null;
  /** Scheduled date as ISO string */
  scheduledDate: string;
  /** Raw API event data for props that need original fields */
  raw: any;
  /** True if job is assigned to non-schedulable technician (for warning display) */
  hasHiddenTechnician?: boolean;
};

/**
 * Get the canonical location identifier from an entity.
 *
 * CANONICAL FIELD: `locationId` is the authoritative identifier for client locations.
 *
 * TEMPORARY FALLBACK: `clientId` is a legacy field that will be removed after the
 * schema migration completes. The fallback exists only to support data created
 * before the migration and should NOT be relied upon for new code.
 *
 * MIGRATION PLAN:
 * 1. All new writes use `locationId`
 * 2. Once all existing records are backfilled, the `clientId` column will be dropped
 * 3. This fallback will be removed at that time
 *
 * @param entity - Object containing locationId and/or clientId
 * @returns The location identifier string, or empty string if neither exists
 */
export function getLocationKey(entity: { locationId?: string; clientId?: string }): string {
  const key = entity.locationId ?? entity.clientId ?? '';

  // DEV-ONLY: Warn if using legacy fallback (helps track migration progress)
  if (process.env.NODE_ENV === 'development' && !entity.locationId && entity.clientId) {
    console.warn(
      '[Calendar] Using legacy clientId fallback. Entity should have locationId:',
      { locationId: entity.locationId, clientId: entity.clientId }
    );
  }

  return key;
}

/**
 * Parse ISO datetime to extract year, month, day, hour, minutes.
 * Returns null if parsing fails.
 */
function parseScheduledDateTime(isoString: string | null | undefined): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minutes: number;
} | null {
  if (!isoString) return null;
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return null;
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1, // 1-12
      day: date.getDate(),
      hour: date.getHours(),
      minutes: date.getMinutes(),
    };
  } catch {
    return null;
  }
}

/**
 * Normalize raw API events into CalendarEvent objects.
 * Transforms raw calendar response data into a consistent shape for all views.
 *
 * MODEL A (Timestamp Canonical):
 * - startAt: ISO 8601 datetime (midnight for all-day, actual time for timed)
 * - endAt: ISO 8601 datetime (23:59:59 for all-day, actual time for timed)
 * - allDay: boolean indicating if this is an all-day event (display flag)
 * - date: YYYY-MM-DD string for the event date (always set)
 * - version: optimistic locking version number
 * - assignmentId is always set to jobId (no separate assignment entity)
 *
 * Classification rules:
 * - allDay === true is the authoritative flag for all-day events
 * - For all-day events, startAt is midnight (00:00:00) but we display in all-day lane
 * - For timed events, extract hour/minutes from startAt
 * - Fallback to legacy fields (scheduledStart, isAllDay, year/month/day/scheduledHour)
 */
export function normalizeAssignments(rawEvents: any[]): CalendarEvent[] {
  // DEV-ONLY: Track stats for debug summary
  let skippedCount = 0;

  // DEV-ONLY: Check first event for field mismatch (legacy vs canonical)
  if (process.env.NODE_ENV === 'development' && rawEvents.length > 0) {
    const first = rawEvents[0];
    const hasCanonical = 'startAt' in first || 'allDay' in first || 'date' in first;
    const hasLegacy = 'scheduledStart' in first || 'isAllDay' in first;
    if (hasLegacy && !hasCanonical) {
      console.warn(
        '[Calendar] API returning LEGACY field names (scheduledStart/isAllDay) instead of CANONICAL (startAt/allDay/date).',
        'Server transformToDto may need updating. First event:',
        { id: first.id, jobNumber: first.jobNumber, keys: Object.keys(first).slice(0, 15) }
      );
    }
  }

  // Filter and map with validation - skip invalid events with warning
  const results = rawEvents
    .map((a): CalendarEvent | null => {
      // DEV-ONLY: Warn if event has no location identifier
      if (process.env.NODE_ENV === 'development' && !a.locationId && !a.clientId) {
        console.warn(
          '[Calendar] Event missing location identifier (no locationId or clientId):',
          { id: a.id, jobNumber: a.jobNumber }
        );
      }

      // Parse canonical fields first (startAt/endAt), fallback to legacy (scheduledStart/scheduledEnd)
      const startIso = a.startAt ?? a.scheduledStart;
      const endIso = a.endAt ?? a.scheduledEnd;
      const parsedStart = parseScheduledDateTime(startIso);
      const parsedEnd = parseScheduledDateTime(endIso);

      // Determine if all-day: canonical allDay > legacy isAllDay > infer from missing time
      const isAllDay = a.allDay === true || a.isAllDay === true ||
        (!parsedStart && (a.scheduledHour === null || a.scheduledHour === undefined));

      // Extract date components: prefer canonical 'date' field, then parsed ISO, then legacy fields
      let year: number | undefined, month: number | undefined, day: number | undefined;
      let scheduledHour: number | null = null;
      let scheduledStartMinutes: number = 0;

      // Try canonical 'date' field first (YYYY-MM-DD)
      if (a.date && typeof a.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.date)) {
        const [y, m, d] = a.date.split('-').map(Number);
        year = y;
        month = m;
        day = d;
        // For timed events, extract hour/minutes from startAt
        if (!isAllDay && parsedStart) {
          scheduledHour = parsedStart.hour;
          scheduledStartMinutes = parsedStart.minutes;
        } else if (!isAllDay) {
          // Timed event but no parsed start - try legacy scheduledHour
          if (a.scheduledHour !== null && a.scheduledHour !== undefined) {
            scheduledHour = a.scheduledHour;
            scheduledStartMinutes = a.scheduledStartMinutes ?? 0;
          } else {
            // Default to 9 AM for timed events with missing time
            scheduledHour = 9;
            scheduledStartMinutes = 0;
          }
        }
      } else if (parsedStart) {
        // Fallback: extract from parsed ISO datetime
        year = parsedStart.year;
        month = parsedStart.month;
        day = parsedStart.day;
        if (!isAllDay) {
          scheduledHour = parsedStart.hour;
          scheduledStartMinutes = parsedStart.minutes;
        }
      } else {
        // Final fallback: legacy year/month/day fields
        year = a.year;
        month = a.month;
        day = a.day;
        if (!isAllDay && a.scheduledHour !== null && a.scheduledHour !== undefined) {
          scheduledHour = a.scheduledHour;
          scheduledStartMinutes = a.scheduledStartMinutes ?? 0;
        } else if (!isAllDay) {
          // Timed event with no time info - default to 9 AM
          scheduledHour = 9;
          scheduledStartMinutes = 0;
        }
      }

      // VALIDATION: Skip events with invalid/missing date components
      if (year === undefined || month === undefined || day === undefined ||
          isNaN(year) || isNaN(month) || isNaN(day) ||
          year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(
            '[Calendar] Skipping event due to invalid/missing date:',
            { id: a.id, jobNumber: a.jobNumber, year, month, day }
          );
        }
        skippedCount++;
        return null;
      }

      // Calculate duration: prefer durationMinutes, then compute from start/end
      let durationMinutes = a.durationMinutes || 60;
      if (parsedStart && parsedEnd && !isAllDay) {
        const startDate = new Date(startIso);
        const endDate = new Date(endIso);
        const calcDuration = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
        if (calcDuration > 0 && calcDuration <= 1440) {
          durationMinutes = calcDuration;
        }
      }
      // Ensure minimum duration for visibility (at least 15 minutes)
      if (durationMinutes < 15) durationMinutes = 15;

      // For timed events, ensure scheduledHour is valid
      if (!isAllDay && (scheduledHour === null || scheduledHour < 0 || scheduledHour > 23)) {
        scheduledHour = 9; // Default to 9 AM
      }

      const startMinutes = isAllDay ? null : (scheduledHour! * 60 + scheduledStartMinutes);

      const techIds = a.assignedTechnicianIds || [];
      const legacyTechId = a.assignedTechnicianId;
      const technicianId = techIds.length > 0 ? techIds[0] : (legacyTechId || null);

      // Build date key (YYYY-MM-DD)
      const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      const locationKey = getLocationKey(a);

      // DEV-ONLY: Warn if locationKey resolved to empty string
      if (process.env.NODE_ENV === 'development' && !locationKey) {
        console.warn(
          '[Calendar] CalendarEvent has null/empty locationKey:',
          { jobId: a.jobId ?? a.id, jobNumber: a.jobNumber }
        );
      }

      // Ensure raw always carries canonical startAt/endAt so downstream code
      // (e.g. new Date(event.raw.startAt)) never hits "Invalid time value".
      // Mutation responses use scheduledStart/scheduledEnd; patch them here.
      const patchedRaw = (a.startAt === undefined && startIso) || (a.endAt === undefined && endIso)
        ? { ...a, startAt: a.startAt ?? startIso ?? null, endAt: a.endAt ?? endIso ?? null }
        : a;

      return {
        // Entity type discriminator — visits from normalizeAssignments, tasks from taskToCalendarItem
        kind: "visit" as const,
        // MODEL A: assignmentId === jobId (no separate assignment entity)
        assignmentId: a.jobId ?? a.id,
        locationKey,
        technicianId,
        technicianIds: techIds.length > 0 ? techIds : (legacyTechId ? [legacyTechId] : []),
        year,
        month,
        day,
        dateKey,
        scheduledHour: isAllDay ? null : scheduledHour,
        scheduledStartMinutes: isAllDay ? null : scheduledStartMinutes,
        isAllDay,
        startMinutes,
        durationMinutes,
        // Terminal statuses: muted + non-draggable on calendar
        completed: a.completed || ['completed', 'invoiced', 'archived'].includes(a.status) || false,
        jobNumber: a.jobNumber || null,
        scheduledDate: a.scheduledDate || dateKey,
        raw: patchedRaw,
        // Include hidden technician flag from server diagnostics
        hasHiddenTechnician: a.hasHiddenTechnician === true,
      };
    })
    .filter((event): event is CalendarEvent => event !== null);

  // DEV-ONLY: Log summary on each normalization (helps diagnose data issues)
  if (process.env.NODE_ENV === 'development' && rawEvents.length > 0) {
    const timedCount = results.filter(e => !e.isAllDay).length;
    const allDayCount = results.filter(e => e.isAllDay).length;
    const first = rawEvents[0];
    console.log(
      `[Calendar] Loaded ${results.length} events (${timedCount} timed, ${allDayCount} all-day, ${skippedCount} skipped)`,
      first ? { sampleKeys: Object.keys(first).slice(0, 10).join(', ') } : {}
    );
  }

  return results;
}

/**
 * Shared predicate: is this event an all-day / anytime event?
 * Uses both the explicit flag and a fallback check on startMinutes.
 * All views (day columns, day rows, weekly) should use this helper
 * to ensure consistent classification of all-day vs timed events.
 */
export function isAllDayEvent(event: CalendarEvent): boolean {
  return event.isAllDay === true || event.startMinutes === null || event.startMinutes === undefined;
}

/**
 * Compare function for stable event ordering.
 * Sort order: all-day events first, then by startMinutes, then by assignmentId (jobId) tie-breaker.
 * This ensures deterministic rendering across re-renders and React reconciliation.
 */
function compareEventsForStableOrder(a: CalendarEvent, b: CalendarEvent): number {
  // All-day events sort first
  if (a.isAllDay !== b.isAllDay) {
    return a.isAllDay ? -1 : 1;
  }

  // For timed events, sort by start time
  if (!a.isAllDay && !b.isAllDay) {
    const startDiff = (a.startMinutes ?? 0) - (b.startMinutes ?? 0);
    if (startDiff !== 0) return startDiff;
  }

  // Tie-breaker: sort by assignmentId for determinism
  return a.assignmentId.localeCompare(b.assignmentId);
}

/**
 * Build indexes for efficient event lookup.
 * All arrays are sorted for stable, deterministic rendering.
 */
export function buildEventIndexes(events: CalendarEvent[]) {
  const eventsByDateKey = new Map<string, CalendarEvent[]>();
  const eventsByTechnician = new Map<string | null, CalendarEvent[]>();
  const allDayEventsByDateKey = new Map<string, CalendarEvent[]>();
  const timedEventsByDateKey = new Map<string, CalendarEvent[]>();

  for (const event of events) {
    // Index by date
    const dateEvents = eventsByDateKey.get(event.dateKey) || [];
    dateEvents.push(event);
    eventsByDateKey.set(event.dateKey, dateEvents);

    // Index by technician (null for unassigned)
    const techKey = event.technicianId;
    const techEvents = eventsByTechnician.get(techKey) || [];
    techEvents.push(event);
    eventsByTechnician.set(techKey, techEvents);

    // Index all-day vs timed
    if (event.isAllDay) {
      const allDayEvents = allDayEventsByDateKey.get(event.dateKey) || [];
      allDayEvents.push(event);
      allDayEventsByDateKey.set(event.dateKey, allDayEvents);
    } else {
      const timedEvents = timedEventsByDateKey.get(event.dateKey) || [];
      timedEvents.push(event);
      timedEventsByDateKey.set(event.dateKey, timedEvents);
    }
  }

  // Sort all arrays for stable, deterministic rendering
  // Using Array.from() for TypeScript compatibility with Map.values()
  Array.from(eventsByDateKey.values()).forEach(arr => arr.sort(compareEventsForStableOrder));
  Array.from(eventsByTechnician.values()).forEach(arr => arr.sort(compareEventsForStableOrder));
  Array.from(allDayEventsByDateKey.values()).forEach(arr => arr.sort(compareEventsForStableOrder));
  Array.from(timedEventsByDateKey.values()).forEach(arr => arr.sort(compareEventsForStableOrder));

  return {
    eventsByDateKey,
    eventsByTechnician,
    allDayEventsByDateKey,
    timedEventsByDateKey,
  };
}

// Technician color palette - colors for left border indicator
export const TECHNICIAN_COLORS = [
  { bg: 'bg-blue-50 dark:bg-blue-950/20', border: 'border-blue-500', borderLeft: 'border-l-blue-500', dot: 'bg-blue-500', text: 'text-blue-700 dark:text-blue-300', label: 'Blue' },
  { bg: 'bg-green-50 dark:bg-green-950/20', border: 'border-green-500', borderLeft: 'border-l-green-500', dot: 'bg-green-500', text: 'text-green-700 dark:text-green-300', label: 'Green' },
  { bg: 'bg-purple-50 dark:bg-purple-950/20', border: 'border-purple-500', borderLeft: 'border-l-purple-500', dot: 'bg-purple-500', text: 'text-purple-700 dark:text-purple-300', label: 'Purple' },
  { bg: 'bg-amber-50 dark:bg-amber-950/20', border: 'border-amber-500', borderLeft: 'border-l-amber-500', dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300', label: 'Amber' },
  { bg: 'bg-rose-50 dark:bg-rose-950/20', border: 'border-rose-500', borderLeft: 'border-l-rose-500', dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-300', label: 'Rose' },
  { bg: 'bg-cyan-50 dark:bg-cyan-950/20', border: 'border-cyan-500', borderLeft: 'border-l-cyan-500', dot: 'bg-cyan-500', text: 'text-cyan-700 dark:text-cyan-300', label: 'Cyan' },
  { bg: 'bg-orange-50 dark:bg-orange-950/20', border: 'border-orange-500', borderLeft: 'border-l-orange-500', dot: 'bg-orange-500', text: 'text-orange-700 dark:text-orange-300', label: 'Orange' },
  { bg: 'bg-indigo-50 dark:bg-indigo-950/20', border: 'border-indigo-500', borderLeft: 'border-l-indigo-500', dot: 'bg-indigo-500', text: 'text-indigo-700 dark:text-indigo-300', label: 'Indigo' },
];

export type TechnicianColor = typeof TECHNICIAN_COLORS[0];

export type CalendarDensity = 'compact' | 'comfortable' | 'expanded';

export const DRAG_ENABLED = true;

// DENSITY_STYLES - Only "expanded" is used (other modes removed for simplicity)
// Jobber-inspired sizing: readable at a glance, sufficient padding, clear text
export const DENSITY_STYLES = {
  // Legacy modes kept for type compatibility but all point to expanded values
  compact: { card: 'py-1.5 px-2.5', row: 'min-h-10', gap: 'gap-1', rowHeight: 56, monthCard: 'py-1 px-2', minCardHeight: 30 },
  comfortable: { card: 'py-1.5 px-2.5', row: 'min-h-10', gap: 'gap-1', rowHeight: 56, monthCard: 'py-1 px-2', minCardHeight: 30 },
  // Expanded: Jobber-like readable cards
  // rowHeight 56px = ~1 job per hour block, comfortable 2-line cards
  // card padding: py-1.5 px-2.5 for comfortable touch targets
  // minCardHeight 30px ensures minimum visibility for short jobs
  expanded: { card: 'py-1.5 px-2.5', row: 'min-h-10', gap: 'gap-1', rowHeight: 56, monthCard: 'py-1 px-2', minCardHeight: 30 },
};

// All-day row heights - increased for readability
export const ALLDAY_ROW_HEIGHTS: Record<string, number> = { compact: 84, comfortable: 84, expanded: 84 };

// ============================================================================
// Safe Date Parsing Utilities
// Prevent "Invalid time value" runtime errors from malformed date inputs
// ============================================================================

/**
 * Safely convert any value to a valid Date object.
 * Returns null for invalid inputs instead of throwing "Invalid time value".
 *
 * @param value - Date string, Date object, timestamp, or year/month/day object
 * @param month - Optional month (1-12) if value is year
 * @param day - Optional day (1-31) if value is year
 * @returns Valid Date or null
 */
export function toValidDate(
  value: unknown,
  month?: number,
  day?: number
): Date | null {
  try {
    // Handle year/month/day triplet
    if (typeof value === 'number' && month !== undefined && day !== undefined) {
      const year = value;
      // Validate ranges
      if (year < 1900 || year > 2100) return null;
      if (month < 1 || month > 12) return null;
      if (day < 1 || day > 31) return null;
      const date = new Date(year, month - 1, day);
      return isNaN(date.getTime()) ? null : date;
    }

    // Handle Date object
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? null : value;
    }

    // Handle timestamp number
    if (typeof value === 'number') {
      const date = new Date(value);
      return isNaN(date.getTime()) ? null : date;
    }

    // Handle ISO string or other string formats
    if (typeof value === 'string' && value.length > 0) {
      const date = new Date(value);
      return isNaN(date.getTime()) ? null : date;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Safely convert year/month/day to ISO date string (YYYY-MM-DD).
 * Returns empty string for invalid inputs.
 *
 * @param year - Year (e.g., 2024)
 * @param month - Month (1-12)
 * @param day - Day (1-31)
 * @returns ISO date string or empty string
 */
export function toISODateString(year: unknown, month: unknown, day: unknown): string {
  const y = typeof year === 'number' ? year : parseInt(String(year), 10);
  const m = typeof month === 'number' ? month : parseInt(String(month), 10);
  const d = typeof day === 'number' ? day : parseInt(String(day), 10);

  // Validate ranges
  if (isNaN(y) || isNaN(m) || isNaN(d)) return '';
  if (y < 1900 || y > 2100) return '';
  if (m < 1 || m > 12) return '';
  if (d < 1 || d > 31) return '';

  // Build ISO string
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Safely create a Date object for scheduling operations.
 * Falls back to current date if inputs are invalid.
 *
 * @param year - Year (e.g., 2024)
 * @param month - Month (1-12)
 * @param day - Day (1-31)
 * @returns Valid Date (falls back to today on invalid input)
 */
export function toScheduleDate(year: unknown, month: unknown, day: unknown): Date {
  const date = toValidDate(
    typeof year === 'number' ? year : parseInt(String(year), 10),
    typeof month === 'number' ? month : parseInt(String(month), 10),
    typeof day === 'number' ? day : parseInt(String(day), 10)
  );
  return date ?? new Date();
}

/**
 * Thin adapter that delegates overdue logic to the canonical shared
 * `isJobOverdue()` predicate in `shared/schema.ts`.
 *
 * Maps CalendarEvent / raw fields to the shape isJobOverdue expects:
 *   status          → raw.status ?? "open"
 *   scheduledStart  → raw.startAt ?? raw.scheduledStart
 *   scheduledEnd    → raw.endAt   ?? raw.scheduledEnd
 *   durationMinutes → event.durationMinutes
 *
 * No local fallbacks — the single shared rule is the only source of truth.
 */
export function isCalendarEventOverdue(event: CalendarEvent, now: Date = new Date()): boolean {
  const raw = event.raw ?? {};
  return isJobOverdue(
    {
      status: raw.status ?? "open",
      scheduledStart: raw.startAt ?? raw.scheduledStart ?? null,
      scheduledEnd: raw.endAt ?? raw.scheduledEnd ?? null,
      durationMinutes: event.durationMinutes ?? null,
    } as any,
    now,
  );
}

/**
 * Get start minutes from midnight for an assignment.
 *
 * Canonical path: derives from `startAt` (or `scheduledStart`) ISO datetime
 * so the value always matches the actual scheduled time, even after
 * `toCanonicalEvent()` / `canonicalizeCalendarCache()` updates.
 *
 * Legacy fallback: uses `scheduledHour` + `scheduledStartMinutes` for events
 * that predate the canonical timestamp fields.
 */
export function getAssignmentStartMinutes(a: any): number {
  if (a == null) return 0;

  // Canonical path: derive from startAt ISO datetime
  const startIso = a.startAt ?? a.scheduledStart;
  if (startIso) {
    try {
      const d = new Date(startIso);
      if (!isNaN(d.getTime())) {
        return d.getHours() * 60 + d.getMinutes();
      }
    } catch { /* fall through to legacy path */ }
  }

  // Legacy path: use scheduledHour/scheduledStartMinutes
  const hour = a.scheduledHour;
  if (hour == null) return 0;
  const offset = a.scheduledStartMinutes != null ? Number(a.scheduledStartMinutes) : 0;
  return hour * 60 + offset;
}

// Calculate lanes for overlapping jobs
export function calculateLanes(assignments: any[]): Map<string, { laneIndex: number; totalLanes: number }> {
  const laneMap = new Map<string, { laneIndex: number; totalLanes: number }>();

  if (assignments.length === 0) return laneMap;

  // Get time range for each assignment
  const getTimeRange = (a: any) => {
    const start = getAssignmentStartMinutes(a);
    const duration = a.durationMinutes || 60;
    return { start, end: start + duration };
  };

  // Sort by start time
  const sorted = [...assignments].sort((a, b) => {
    return getTimeRange(a).start - getTimeRange(b).start;
  });

  // Track active lanes (each lane has an end time)
  const lanes: number[] = [];

  // First pass: assign lane indices using greedy allocation
  for (const assignment of sorted) {
    const range = getTimeRange(assignment);

    // Find the first lane that's free (ends before this job starts)
    let laneIndex = lanes.findIndex(laneEnd => laneEnd <= range.start);

    if (laneIndex === -1) {
      // No free lane, create a new one
      laneIndex = lanes.length;
      lanes.push(range.end);
    } else {
      // Use this lane and update its end time
      lanes[laneIndex] = range.end;
    }

    laneMap.set(assignment.id, { laneIndex, totalLanes: 1 });
  }

  // Second pass: use sweep-line to find max concurrent at each moment
  type Event = { time: number; type: 'start' | 'end'; id: string };
  const events: Event[] = [];
  for (const assignment of assignments) {
    const range = getTimeRange(assignment);
    events.push({ time: range.start, type: 'start', id: assignment.id });
    events.push({ time: range.end, type: 'end', id: assignment.id });
  }
  // Sort: by time, then 'end' before 'start' at same time
  events.sort((a, b) => a.time - b.time || (a.type === 'end' ? -1 : 1));

  // Track max concurrent for each active assignment during sweep
  const maxConcurrentMap = new Map<string, number>();
  const activeSet = new Set<string>();

  for (const event of events) {
    if (event.type === 'start') {
      activeSet.add(event.id);
      const currentCount = activeSet.size;
      // Update max concurrent for ALL currently active assignments
      activeSet.forEach(id => {
        const existing = maxConcurrentMap.get(id) || 1;
        maxConcurrentMap.set(id, Math.max(existing, currentCount));
      });
    } else {
      activeSet.delete(event.id);
    }
  }

  // Apply max concurrent to lane map
  for (const assignment of assignments) {
    const lane = laneMap.get(assignment.id);
    if (lane) {
      lane.totalLanes = maxConcurrentMap.get(assignment.id) || 1;
    }
  }

  // Third pass: ensure directly overlapping assignments share the same totalLanes
  for (const assignment of assignments) {
    const range = getTimeRange(assignment);
    const lane = laneMap.get(assignment.id);
    if (!lane) continue;

    for (const other of assignments) {
      if (other.id === assignment.id) continue;
      const otherRange = getTimeRange(other);
      const otherLane = laneMap.get(other.id);
      if (!otherLane) continue;

      // If they directly overlap, ensure same totalLanes (take max)
      if (otherRange.start < range.end && otherRange.end > range.start) {
        const maxLanes = Math.max(lane.totalLanes, otherLane.totalLanes);
        lane.totalLanes = maxLanes;
        otherLane.totalLanes = maxLanes;
      }
    }
  }

  return laneMap;
}

/**
 * Format time from minutes since midnight.
 * Supports 12h (default) and 24h formats based on company regional settings.
 */
export function formatTimeFromMinutes(minutes: number, timeFormat: "12h" | "24h" = "12h"): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const min = minutes % 60;
  if (timeFormat === "24h") {
    return `${String(h24).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(min).padStart(2, '0')} ${ampm}`;
}

/**
 * Get the start of the week for a given date.
 * Respects company regional setting for week start day.
 * @param date - Reference date
 * @param weekStartsOn - "monday" (default, ISO standard) or "sunday"
 */
export function getWeekStart(date: Date, weekStartsOn: "monday" | "sunday" = "monday"): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, ... 6=Sat
  if (weekStartsOn === "sunday") {
    d.setDate(d.getDate() - day);
  } else {
    const daysToMonday = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - daysToMonday);
  }
  return d;
}

// Create technician color map
export function createTechnicianColorMap(technicians: any[]): Map<string, TechnicianColor> {
  const map = new Map<string, TechnicianColor>();
  technicians.forEach((tech: any, index: number) => {
    map.set(tech.id, TECHNICIAN_COLORS[index % TECHNICIAN_COLORS.length]);
  });
  return map;
}

// Get technician color for an assignment
export function getTechnicianColorForAssignment(
  assignment: any,
  colorMap: Map<string, TechnicianColor>
): TechnicianColor {
  const techIds = assignment?.assignedTechnicianIds || [];
  const legacyTechId = assignment?.assignedTechnicianId;

  if (techIds.length > 0) {
    return colorMap.get(techIds[0]) || TECHNICIAN_COLORS[0];
  }
  if (legacyTechId) {
    return colorMap.get(legacyTechId) || TECHNICIAN_COLORS[0];
  }
  // Unassigned - use neutral color
  return {
    bg: 'bg-muted/50',
    border: 'border-muted-foreground/30',
    borderLeft: 'border-l-muted-foreground/30',
    dot: 'bg-muted-foreground/30',
    text: 'text-muted-foreground',
    label: 'Unassigned'
  };
}

// ============================================================================
// Shared Click Router — single decision point for calendar entity clicks
// ============================================================================

/**
 * Determines whether a calendar event is a task based on the `kind` discriminator.
 * Falls back to checking assignmentId prefix for backwards compatibility.
 */
export function isTaskEvent(event: CalendarEvent): boolean {
  return event.kind === "task" ||
    (typeof event.assignmentId === "string" && event.assignmentId.startsWith("task-"));
}

/**
 * Extracts the task ID from a task calendar event.
 */
export function getTaskIdFromEvent(event: CalendarEvent): string {
  if (event.kind === "task") {
    return event.raw?.id ?? event.assignmentId.replace("task-", "");
  }
  return event.assignmentId.replace("task-", "");
}

// ============================================================================
// Canonical Display Helpers — single source of truth for all calendar views
// ============================================================================

/** Canonical task color used everywhere tasks are rendered on the calendar. */
export const TASK_COLOR: TechnicianColor = {
  bg: 'bg-violet-50 dark:bg-violet-950/20',
  border: 'border-violet-400',
  borderLeft: 'border-l-violet-400',
  dot: 'bg-violet-400',
  text: 'text-violet-700 dark:text-violet-300',
  label: 'Task',
};

/**
 * Canonical title for a calendar event.
 * Tasks use their own title; visits use client company name with fallbacks.
 *
 * @param event - Canonical CalendarEvent
 * @param client - Resolved client (from findClientByEvent), may be null
 * @param options.compact - If true, prefix tasks with 📋 (for month chips)
 */
export function getEventTitle(
  event: CalendarEvent,
  client?: { companyName?: string } | null,
  options?: { compact?: boolean },
): string {
  if (event.kind === "task") {
    const base = event.raw?.title || "Task";
    return options?.compact ? `📋 ${base}` : base;
  }
  return client?.companyName || event.raw?.summary || "Untitled";
}

/**
 * Canonical overdue check. Tasks are never overdue.
 */
export function getEventOverdue(event: CalendarEvent, now?: Date): boolean {
  if (event.kind === "task") return false;
  return isCalendarEventOverdue(event, now);
}

/**
 * Canonical color for a calendar event.
 * Tasks always get TASK_COLOR; visits use technician color.
 */
export function getEventColor(
  event: CalendarEvent,
  getTechnicianColor?: (raw: any) => TechnicianColor,
): TechnicianColor {
  if (event.kind === "task") return TASK_COLOR;
  return getTechnicianColor?.(event.raw) || TECHNICIAN_COLORS[0];
}

/**
 * Canonical capabilities for a calendar event by view context.
 * Controls drag, resize, remove, and reschedule permissions.
 */
export function getEventCapabilities(event: CalendarEvent): {
  draggable: boolean;
  resizable: boolean;
  removable: boolean;
  reschedulable: boolean;
} {
  const isTask = event.kind === "task";
  return {
    draggable: !isTask && !event.completed,
    resizable: !isTask && !event.completed,
    removable: !isTask,
    reschedulable: !isTask,
  };
}

/**
 * Build the client display object for a task event.
 * Tasks don't have a real client — uses the task title as companyName
 * so downstream components (JobCard/DraggableClient) render the task title.
 */
export function getEventClient(
  event: CalendarEvent,
  client: { companyName?: string; location?: string; id?: string } | null | undefined,
): { companyName: string; location?: string; id?: string } {
  if (event.kind === "task") {
    return { ...client, companyName: event.raw?.title || "Task" };
  }
  return { companyName: "Unknown", ...client };
}
