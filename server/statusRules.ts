import type { JobStatus, InvoiceStatus } from "./schemas";

/**
 * Job Status Flow - defines valid transitions between job statuses
 *
 * CURRENT WORKFLOW:
 * Active: draft -> scheduled -> dispatched -> en_route -> on_site -> in_progress
 * Close options:
 *   - "Close & invoice now": in_progress -> invoiced (creates invoice)
 *   - "Close & invoice later": in_progress -> requires_invoicing
 *   - From requires_invoicing: can create invoice -> invoiced
 * Terminal: invoiced -> closed -> archived
 *
 * Special states:
 *   - action_required: unified hold state with required reason
 *   - cancelled: job cancelled
 *   - archived: final terminal state
 *
 * NOTE: "completed" is LEGACY - kept for backward compatibility with existing data.
 * New jobs should use "requires_invoicing" when closed without immediate invoice.
 */
export const JOB_STATUS_FLOW: Record<JobStatus, JobStatus[]> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["dispatched", "on_site", "action_required", "completed", "cancelled"],
  dispatched: ["en_route", "on_site", "action_required", "completed", "cancelled"],
  en_route: ["on_site", "action_required", "completed", "cancelled"],
  on_site: ["in_progress", "action_required", "completed", "cancelled"],
  in_progress: ["requires_invoicing", "invoiced", "action_required", "completed", "cancelled"],
  // action_required - unified hold state with required reason
  action_required: ["scheduled", "dispatched", "en_route", "on_site", "in_progress", "completed", "cancelled"],
  // LEGACY: "completed" treated same as "requires_invoicing" for backward compatibility
  // Reopen/Undo: can go back to any active state
  completed: ["invoiced", "requires_invoicing", "archived", "draft", "scheduled", "dispatched", "en_route", "on_site", "in_progress", "action_required"],
  // requires_invoicing - job done, awaiting invoice creation
  // Reopen/Undo: can go back to any active state
  requires_invoicing: ["invoiced", "archived", "draft", "scheduled", "dispatched", "en_route", "on_site", "in_progress", "action_required"],
  // invoiced: cannot reopen/undo directly (must void/credit invoice first)
  invoiced: ["closed", "archived"],
  closed: ["archived"],
  // archived: can be reopened/undone to any active state (if not invoiced)
  archived: ["draft", "scheduled", "dispatched", "en_route", "on_site", "in_progress", "action_required"],
  cancelled: ["archived"],
};

/**
 * States that can be "closed" by transitioning through completed first
 * Used by the /api/jobs/:id/close endpoint
 */
export const CLOSEABLE_STATES: JobStatus[] = [
  "draft",
  "scheduled",
  "dispatched",
  "en_route",
  "on_site",
  "in_progress",
  "action_required",
];

/**
 * States that can be "reopened" (transitioned back to active work)
 * Used by the /api/jobs/:id/reopen endpoint
 * NOTE: "invoiced" is intentionally excluded - must void/credit invoice first
 */
export const REOPENABLE_STATES: JobStatus[] = [
  "completed",
  "requires_invoicing",
  "archived",
];

/**
 * Invoice Status Flow - defines valid transitions between invoice statuses
 *
 * Canonical workflow: draft → sent → partial_paid/paid
 * Void available from: draft, sent, partial_paid
 * Terminal states: paid, voided
 */
export const INVOICE_STATUS_FLOW: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["sent", "voided"],
  sent: ["partial_paid", "paid", "voided"],
  partial_paid: ["paid", "voided"],
  paid: [], // Terminal state
  voided: [], // Terminal state
};

export function assertJobStatusTransition(from: JobStatus, to: JobStatus) {
  const allowed = JOB_STATUS_FLOW[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid job status transition: ${from} -> ${to}`);
  }
}

export function assertInvoiceStatusTransition(from: InvoiceStatus, to: InvoiceStatus) {
  const allowed = INVOICE_STATUS_FLOW[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid invoice status transition: ${from} -> ${to}`);
  }
}
