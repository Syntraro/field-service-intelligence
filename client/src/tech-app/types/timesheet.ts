/**
 * Timesheet types for the technician mobile app.
 * Phase 3 (2026-04-04): Real backend-aligned types replacing mock types.
 *
 * Backend time entry types: travel_to_job, on_site, travel_to_supplier,
 * supplier_run, travel_between_jobs, admin, break, other
 */

// ── Work session (from backend work_sessions table) ──

export interface TimesheetWorkSession {
  id: string;
  workDate: string;        // YYYY-MM-DD
  clockInAt: string;       // ISO timestamp
  clockOutAt: string | null;
  breakMinutes: number | null;
}

// ── Time entry (from backend time_entries table) ──

export interface TimesheetEntry {
  id: string;
  type: string;            // Backend TimeEntryType as-is
  jobId: string | null;
  startAt: string;         // ISO timestamp
  endAt: string | null;    // null = currently running
  durationMinutes: number | null;
  notes: string | null;
  billable: boolean;
  // Lock/read-only context from backend
  lockedAt: string | null;
  lockedByInvoiceId: string | null;
  lockReason: string | null;
  // Job context (from server-side join, nullable)
  jobNumber: number | null;
  jobSummary: string | null;
  locationName: string | null;
}
