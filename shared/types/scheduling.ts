/**
 * Shared Calendar API Types
 *
 * Single source of truth for calendar API contract between server and client.
 *
 * Phase 2 Dispatch Refactor: Visit-Centric Scheduling
 * - Calendar events are VISITS (one event per eligible visit)
 * - id = visitId (primary calendar event identity)
 * - Multiple visits for the same job appear as separate events
 * - Job metadata (jobNumber, summary, location) attached to each visit event
 */

// ============================================================================
// Technician DTO
// ============================================================================

export interface CalendarTechnicianDto {
  id: string;
  name: string;
  color: string | null;
}

// ============================================================================
// Calendar Event DTO (Job-Centric)
// ============================================================================

/**
 * Calendar event as returned by the API.
 * Phase 2: Represents a VISIT with parent job metadata.
 *
 * INVARIANTS:
 * - id = visitId (visit-centric identity)
 * - jobId = parent job ID (for linking back to job detail)
 * - Multiple events may share the same jobId (multi-visit jobs)
 * - For timed events: startAt and endAt are set, allDay is false
 * - For all-day events: allDay is true, startAt=midnight, endAt=23:59:59
 */
export interface CalendarEventDto {
  /** Phase 2: Visit ID (primary calendar event identity) */
  id: string;
  /** Parent job ID */
  jobId: string;
  /** Human-readable job number */
  jobNumber: number;
  /** Visit ID (explicit — same as id for scheduled events) */
  visitId?: string;
  /** Visit number within the job (e.g., 1, 2, 3) */
  visitNumber?: number | null;
  /** Visit-level status (scheduled, dispatched, en_route, on_site, etc.) */
  visitStatus?: string;
  /** Visit outcome (completed, needs_parts, needs_followup) */
  visitOutcome?: string | null;
  /** Visit notes — editable dispatch/office notes on the visit */
  visitNotes?: string | null;
  /** Outcome note — technician-authored note from visit completion */
  outcomeNote?: string | null;
  /** Job description — read-only context from parent job */
  description?: string | null;
  /** Job-level access instructions (gate code, roof access, etc.) */
  accessInstructions?: string | null;
  /** Location contact name */
  contactName?: string | null;
  /** Location contact phone */
  contactPhone?: string | null;
  /** Location notes (site-specific context) */
  locationNotes?: string | null;
  /** Location address fields for dispatch detail panel */
  locationAddress?: string | null;
  locationCity?: string | null;
  locationProvinceState?: string | null;
  locationPostalCode?: string | null;
  /** Client location latitude (from client_locations, numeric 10,7) */
  lat?: string | null;
  /** Client location longitude (from client_locations, numeric 10,7) */
  lng?: string | null;
  /** Job type (e.g., "PM", "Repair", "Install") */
  jobType: string | null;
  /** Job summary/description */
  summary: string;
  /** Job status (open, completed, invoiced, archived) */
  status: string;
  /** Job workflow sub-status (null, in_progress, on_hold, on_route) — only when status='open' */
  openSubStatus?: string | null;
  /** Hold reason when openSubStatus='on_hold' (parts, customer, access, approval, weather, other) */
  holdReason?: string | null;
  /** Location ID for the job */
  locationId: string;
  /** Location display name */
  locationName: string;
  /** Customer company ID (parent of location) */
  customerCompanyId: string | null;
  /** Customer company name */
  customerCompanyName: string | null;

  // ========== CANONICAL SCHEDULING FIELDS (MODEL A) ==========
  /** Start time (ISO 8601 datetime) - midnight for all-day, actual time for timed */
  startAt: string | null;
  /** End time (ISO 8601 datetime) - 23:59:59 for all-day, actual time for timed */
  endAt: string | null;
  /** Whether this is an all-day event (display flag only) */
  allDay: boolean;
  /** Event date (YYYY-MM-DD) - always set for both timed and all-day */
  date: string;
  /** Duration in minutes (computed from startAt/endAt or default 60) */
  durationMinutes: number;
  /** Job version for optimistic locking */
  version: number;

  /** Canonical crew — the visit's assignedTechnicianIds.
   *  2026-04-12 final cleanup: primaryTechnicianId dropped; read crew[0] locally if a lead is needed. */
  assignedTechnicianIds: string[] | null;
  /** Technician details */
  technicians: CalendarTechnicianDto[];

  // ========== TECHNICIAN VISIBILITY DIAGNOSTICS ==========
  /** True if job is assigned to a technician who is not schedulable/visible */
  hasHiddenTechnician?: boolean;
  /** IDs of technicians who are not schedulable (for diagnostics) */
  hiddenTechnicianIds?: string[];
}

// ============================================================================
// Calendar Range Response DTO
// ============================================================================

/**
 * Response from GET /api/calendar?start=ISO&end=ISO
 *
 * INVARIANTS:
 * - events array is always present (may be empty)
 * - outsideVisibleHoursCount is always present (default 0)
 * - timezone is always present (IANA timezone string)
 */
export interface CalendarRangeResponseDto {
  /** Scheduled jobs (events) in the requested date range */
  events: CalendarEventDto[];
  /** Count of events outside visible calendar hours */
  outsideVisibleHoursCount: number;
  /** Server timezone (IANA format, e.g., "America/Toronto") */
  timezone: string;
  /** Whether the company has explicitly confirmed their timezone (onboarding gate) */
  timezoneConfirmed?: boolean;
}

// ============================================================================
// Unscheduled Job DTO (Backlog)
// ============================================================================

/**
 * Unscheduled job as returned by GET /api/calendar/unscheduled
 *
 * These are jobs that:
 * - Have status = 'open'
 * - Have scheduledStart IS NULL
 */
export interface UnscheduledJobDto {
  /** Job ID */
  id: string;
  /** Job ID (explicit alias) */
  jobId: string;
  /** Human-readable job number */
  jobNumber: number;
  /** Job type */
  jobType: string | null;
  /** Job summary */
  summary: string;
  /** Job status (always 'open' for backlog) */
  status: string;
  /** Job workflow sub-status (null, in_progress, on_hold, on_route) */
  openSubStatus?: string | null;
  /** Hold reason when openSubStatus='on_hold' */
  holdReason?: string | null;
  /** Location ID */
  locationId: string;
  /** Location name */
  locationName: string;
  /** Customer company ID */
  customerCompanyId: string | null;
  /** Customer company name */
  customerCompanyName: string | null;
  /** Canonical crew array (2026-04-12 final cleanup: primaryTechnicianId removed). */
  assignedTechnicianIds: string[] | null;
  /** Technician details */
  technicians: CalendarTechnicianDto[];
  /** Job version for optimistic locking */
  version: number;
  /** Job duration in minutes (from template, for dispatch board block sizing) */
  durationMinutes?: number | null;
  /** Location address fields for dispatch detail panel */
  locationAddress?: string | null;
  locationCity?: string | null;
  locationProvinceState?: string | null;
  locationPostalCode?: string | null;
  /** Client location latitude (from client_locations) — for dispatch map markers */
  lat?: string | null;
  /** Client location longitude (from client_locations) — for dispatch map markers */
  lng?: string | null;
  /** 2026-03-22: Real visit ID from job_visits — enables canonical EditVisitModal opening.
   *  Null if no active non-terminal visit exists (e.g., all visits archived/completed). */
  activeVisitId?: string | null;
}

// ============================================================================
// DEV Validation Helpers
// ============================================================================

/**
 * Required fields for CalendarEventDto (runtime validation in DEV)
 */
export const CALENDAR_EVENT_REQUIRED_FIELDS: (keyof CalendarEventDto)[] = [
  'id',
  'jobId',
  'jobNumber',
  'jobType',
  'summary',
  'status',
  'locationId',
  'locationName',
  'allDay',
  'date',
  'technicians',
  'durationMinutes',
  'version',
];

/**
 * Required fields for CalendarRangeResponseDto (runtime validation in DEV)
 */
export const CALENDAR_RANGE_RESPONSE_REQUIRED_FIELDS: (keyof CalendarRangeResponseDto)[] = [
  'events',
  'outsideVisibleHoursCount',
  'timezone',
];

/**
 * Validate a CalendarEventDto has all required fields.
 * Logs warning if fields are missing.
 */
export function assertCalendarEventDto(
  event: unknown,
  context = 'CalendarEventDto'
): asserts event is CalendarEventDto {
  if (typeof event !== 'object' || event === null) {
    const msg = `[${context}] Expected object, got ${typeof event}`;
    if (process.env.NODE_ENV === 'development') {
      throw new Error(msg);
    }
    console.warn(msg);
    return;
  }

  const obj = event as Record<string, unknown>;
  const missing = CALENDAR_EVENT_REQUIRED_FIELDS.filter(
    (field) => !(field in obj)
  );

  if (missing.length > 0) {
    const msg = `[${context}] Missing required fields: ${missing.join(', ')}`;
    if (process.env.NODE_ENV === 'development') {
      console.warn(msg, obj);
    }
  }
}

/**
 * Validate a CalendarRangeResponseDto has all required fields.
 * Logs warning if fields are missing.
 */
export function assertCalendarRangeResponseDto(
  response: unknown,
  context = 'CalendarRangeResponseDto'
): asserts response is CalendarRangeResponseDto {
  if (typeof response !== 'object' || response === null) {
    const msg = `[${context}] Expected object, got ${typeof response}`;
    if (process.env.NODE_ENV === 'development') {
      throw new Error(msg);
    }
    console.warn(msg);
    return;
  }

  const obj = response as Record<string, unknown>;

  if (!('events' in obj)) {
    const msg = `[${context}] Missing required field: events`;
    if (process.env.NODE_ENV === 'development') {
      console.warn(msg, obj);
    }
  }

  const eventsArray = obj.events as unknown[];
  if (Array.isArray(eventsArray)) {
    eventsArray.forEach((e, i) => {
      assertCalendarEventDto(e, `${context}.events[${i}]`);
    });
  }
}
