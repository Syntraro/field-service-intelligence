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
 *   - needs_parts: job waiting for parts
 *   - on_hold: general hold
 *   - cancelled: job cancelled
 *   - archived: final terminal state
 *
 * NOTE: "completed" is LEGACY - kept for backward compatibility with existing data.
 * New jobs should use "requires_invoicing" when closed without immediate invoice.
 */
export const JOB_STATUS_FLOW: Record<JobStatus, JobStatus[]> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["dispatched", "on_site", "cancelled"],
  dispatched: ["en_route", "on_site", "cancelled"],
  en_route: ["on_site", "cancelled"],
  on_site: ["in_progress", "on_hold", "needs_parts", "cancelled"],
  in_progress: ["requires_invoicing", "invoiced", "on_hold", "needs_parts", "cancelled"],
  needs_parts: ["in_progress", "on_hold", "cancelled"],
  on_hold: ["in_progress", "needs_parts", "cancelled"],
  // LEGACY: "completed" treated same as "requires_invoicing" for backward compatibility
  completed: ["invoiced", "requires_invoicing", "archived"],
  // NEW: requires_invoicing - job done, awaiting invoice creation
  requires_invoicing: ["invoiced", "archived"],
  invoiced: ["closed", "archived"],
  closed: ["archived"],
  archived: [],
  cancelled: ["archived"],
};

/**
 * Invoice Status Flow - defines valid transitions between invoice statuses
 *
 * Workflow: draft -> pending -> sent -> paid/partial_paid
 * Special states: voided, cancelled
 */
export const INVOICE_STATUS_FLOW: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["pending", "sent", "cancelled"],
  pending: ["sent", "cancelled"],
  sent: ["paid", "partial_paid", "voided"],
  paid: [], // Terminal state
  partial_paid: ["paid", "voided"],
  voided: [], // Terminal state
  cancelled: [], // Terminal state
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
