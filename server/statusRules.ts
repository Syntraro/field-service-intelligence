import type { JobStatus, InvoiceStatus, OpenSubStatus } from "./schemas";
import { normalizeJobStatus } from "@shared/schema";

/**
 * Job Status Flow - 4-Value Lifecycle Model
 *
 * =============================================================================
 * LIFECYCLE STATES (stored in jobs.status):
 * =============================================================================
 * - "open"      - Active job that can be worked on
 * - "completed" - Work finished (may need invoicing)
 * - "invoiced"  - Invoice created (locked for billing)
 * - "archived"  - Historical archive (includes canceled jobs)
 *
 * =============================================================================
 * DERIVED STATES (NOT stored in status, computed from fields):
 * =============================================================================
 * - "scheduled" is derived from: scheduledStart IS NOT NULL OR isAllDay = true
 * - "assigned" is derived from: primaryTechnicianId IS NOT NULL OR assignedTechnicianIds.length > 0
 *
 * Use helper functions from shared/schema.ts:
 * - isJobScheduled(job) - returns true if job has a schedule
 * - isJobAssigned(job) - returns true if job has technician(s) assigned
 *
 * =============================================================================
 * WORKFLOW SUB-STATUS (only valid when status = 'open'):
 * =============================================================================
 * - null           - Default, no special workflow state
 * - "in_progress"  - Work actively being performed
 * - "on_hold"      - Job is blocked (requires holdReason)
 * - "on_route"     - Technician traveling to job site
 * - "needs_review" - Needs supervisor/manager review
 *
 * INVARIANT: openSubStatus must be NULL when status !== 'open'
 *
 * =============================================================================
 * TRAVEL TRACKING (tracked via timestamps, not status):
 * =============================================================================
 * - travelStartedAt: When technician starts traveling to job
 * - arrivedOnSiteAt: When technician arrives at job site
 * These are independent of status - use openSubStatus='on_route' for display
 */
export const JOB_STATUS_FLOW: Record<JobStatus, JobStatus[]> = {
  // Active job - can transition to completed, invoiced (skip completed), or archived (cancel)
  open: ["completed", "invoiced", "archived"],

  // Work finished - can invoice or archive, or reopen if needed
  completed: ["invoiced", "archived", "open"],

  // Invoice created - can only archive (must void invoice to reopen)
  invoiced: ["archived"],

  // Archived/canceled - can reopen for corrections (rare)
  archived: ["open"],
};

/**
 * Valid transitions for openSubStatus when status = 'open'
 * null represents no sub-status (default state)
 */
export const OPEN_SUB_STATUS_FLOW: Record<OpenSubStatus | "null", (OpenSubStatus | null)[]> = {
  // Default state - can start work, put on hold, or start travel
  null: ["in_progress", "on_hold", "on_route", "needs_review"],

  // Work in progress - can put on hold, complete (via status change), or request review
  in_progress: [null, "on_hold", "needs_review"],

  // Job is blocked - can resume (in_progress), or back to default
  on_hold: [null, "in_progress"],

  // Traveling to job - arrives at site (in_progress), or back to default
  on_route: [null, "in_progress"],

  // Needs review - after review, back to default or in_progress
  needs_review: [null, "in_progress"],
};

/**
 * States that can be "closed" (shortcut to completed → invoiced)
 * Used by the /api/jobs/:id/close endpoint
 */
export const CLOSEABLE_STATUSES: JobStatus[] = ["open"];

/**
 * States that can be "reopened" (transitioned back to open)
 * NOTE: "invoiced" is intentionally excluded - must void/credit invoice first
 */
export const REOPENABLE_STATUSES: JobStatus[] = ["completed", "archived"];

/**
 * Terminal states - jobs in these states are considered "finished"
 * Phase 5 E1: Renamed from TERMINAL_STATUSES to disambiguate from visit terminal statuses
 */
export const JOB_TERMINAL_STATUSES: JobStatus[] = ["invoiced", "archived"];
/** @deprecated Use JOB_TERMINAL_STATUSES — kept for backward compat during migration */
export const TERMINAL_STATUSES = JOB_TERMINAL_STATUSES;

/**
 * Active states - jobs that are in progress
 */
export const ACTIVE_STATUSES: JobStatus[] = ["open"];

/**
 * Invoice Status Flow - defines valid transitions between invoice statuses
 *
 * Canonical workflow: draft → awaiting_payment → partial_paid/paid
 * "sent" is kept as alias for awaiting_payment for backward compatibility
 * Void available from: draft, awaiting_payment, sent, partial_paid
 * Terminal states: paid, voided
 */
export const INVOICE_STATUS_FLOW: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["awaiting_payment", "sent", "voided"], // sent kept for backward compatibility
  awaiting_payment: ["partial_paid", "paid", "voided"],
  sent: ["partial_paid", "paid", "voided"], // LEGACY: same transitions as awaiting_payment
  partial_paid: ["paid", "voided"],
  paid: [], // Terminal state
  voided: [], // Terminal state
};

/**
 * Assert that a job status transition is valid.
 * Normalizes legacy status values before checking.
 */
export function assertJobStatusTransition(from: JobStatus | string, to: JobStatus | string) {
  // Normalize legacy aliases
  const normalizedFrom = normalizeJobStatus(from);
  const normalizedTo = normalizeJobStatus(to);

  const allowed = JOB_STATUS_FLOW[normalizedFrom] ?? [];

  if (!allowed.includes(normalizedTo)) {
    throw new Error(`Invalid job status transition: ${from} -> ${to}`);
  }
}

/**
 * Assert that an openSubStatus transition is valid.
 * Only valid when status = 'open'.
 */
export function assertOpenSubStatusTransition(
  from: OpenSubStatus | null,
  to: OpenSubStatus | null
) {
  const fromKey = from === null ? "null" : from;
  const allowed = OPEN_SUB_STATUS_FLOW[fromKey] ?? [];

  if (!allowed.includes(to)) {
    throw new Error(`Invalid openSubStatus transition: ${from} -> ${to}`);
  }
}

/**
 * Assert that an invoice status transition is valid.
 */
export function assertInvoiceStatusTransition(from: InvoiceStatus, to: InvoiceStatus) {
  const allowed = INVOICE_STATUS_FLOW[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid invoice status transition: ${from} -> ${to}`);
  }
}

/**
 * Check if a job can be closed (quick complete + optional invoice).
 */
export function canCloseJob(status: JobStatus | string): boolean {
  const normalized = normalizeJobStatus(status);
  return CLOSEABLE_STATUSES.includes(normalized);
}

/**
 * Check if a job can be reopened.
 */
export function canReopenJob(status: JobStatus | string): boolean {
  const normalized = normalizeJobStatus(status);
  return REOPENABLE_STATUSES.includes(normalized);
}

/**
 * Check if a job is in a terminal state.
 */
export function isTerminalStatus(status: JobStatus | string): boolean {
  const normalized = normalizeJobStatus(status);
  return JOB_TERMINAL_STATUSES.includes(normalized);
}

// =============================================================================
// LEGACY COMPATIBILITY
// =============================================================================

/**
 * @deprecated Use CLOSEABLE_STATUSES instead
 */
export const CLOSEABLE_STATES = CLOSEABLE_STATUSES;

/**
 * @deprecated Use REOPENABLE_STATUSES instead
 */
export const REOPENABLE_STATES = REOPENABLE_STATUSES;

/**
 * @deprecated Use JOB_TERMINAL_STATUSES instead
 */
export const TERMINAL_STATES = JOB_TERMINAL_STATUSES;

/**
 * @deprecated Use ACTIVE_STATUSES instead
 */
export const ACTIVE_STATES = ACTIVE_STATUSES;
