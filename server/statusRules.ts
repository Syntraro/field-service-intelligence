import type { JobStatus, InvoiceStatus } from "./schemas";

/**
 * Job Status Flow - defines valid transitions between job statuses
 *
 * Workflow: draft -> scheduled -> dispatched -> en_route -> on_site -> in_progress -> completed -> invoiced -> closed
 * Special states: needs_parts (hold for parts), on_hold (general hold), archived, cancelled
 */
export const JOB_STATUS_FLOW: Record<JobStatus, JobStatus[]> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["dispatched", "on_site", "cancelled"],
  dispatched: ["en_route", "on_site", "cancelled"],
  en_route: ["on_site", "cancelled"],
  on_site: ["in_progress", "on_hold", "needs_parts", "cancelled"],
  in_progress: ["completed", "on_hold", "needs_parts", "cancelled"],
  needs_parts: ["in_progress", "on_hold", "cancelled"],
  on_hold: ["in_progress", "needs_parts", "cancelled"],
  completed: ["invoiced", "archived"],
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
