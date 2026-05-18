/**
 * Timesheet types for the technician mobile app.
 * Phase 3 (2026-04-04): Real backend-aligned types replacing mock types.
 *
 * Backend time entry types: travel_to_job, on_site, travel_between_jobs,
 * admin, break, task_work, other
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
  // Attribution (from time_entries canonical columns)
  visitId: string | null;
  taskId: string | null;
  // Job context (from server-side join, nullable)
  jobNumber: number | null;
  jobSummary: string | null;
  locationName: string | null;
  /**
   * 2026-04-26: customer-company name pulled via
   * `client_locations.parent_company_id → customer_companies.id`. Null
   * when the location has no parent company (rare — direct-location
   * jobs) or the entry has no `jobId`. Used by the tech-app Day View
   * grouped header so the title reads `#{jobNumber} {clientName}`
   * instead of `#{jobNumber} {jobSummary}`.
   */
  clientName: string | null;
}
