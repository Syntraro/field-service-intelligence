/**
 * Canonical invalidation helpers for invoice-related mutations.
 *
 * Invoices exist in two cache families:
 *   1. ["invoices", ...] — detail page + cross-entity references
 *   2. ["receivables", ...] — receivables workspace tabs
 *
 * Every mutation that modifies an invoice MUST invalidate both families.
 * Use these helpers rather than inlining key lists in onSuccess handlers.
 */
import type { QueryClient } from "@tanstack/react-query";
import { invoiceKeys } from "@/lib/queryKeys/invoices";
import { jobKeys } from "@/lib/queryKeys/jobs";

/**
 * Full invoice invalidation: detail + family + both receivables families.
 * Use for create, delete, void, payment, status change, and any mutation
 * that changes the invoice's computed totals or status.
 *
 * Pass jobId when the mutation also affects the originating job (e.g.
 * close-job-with-invoice). This adds invalidation of the job's detail and
 * family so the job's linked-invoice panel refreshes.
 */
export function invalidateInvoice(
  qc: QueryClient,
  invoiceId: string | undefined,
  opts?: { jobId?: string },
): void {
  if (!invoiceId) return;
  qc.invalidateQueries({ queryKey: invoiceKeys.detail(invoiceId) });
  qc.invalidateQueries({ queryKey: invoiceKeys.all() });
  qc.invalidateQueries({ queryKey: invoiceKeys.receivablesRoot() });
  qc.invalidateQueries({ queryKey: invoiceKeys.receivablesCounts() });

  if (opts?.jobId) {
    qc.invalidateQueries({ queryKey: invoiceKeys.byJob(opts.jobId) });
    qc.invalidateQueries({ queryKey: jobKeys.detail(opts.jobId) });
    qc.invalidateQueries({ queryKey: jobKeys.all() });
  }
}

/**
 * Financial-only invoice invalidation: covers totals, line items, payment
 * terms, discount, and any field that affects computed amounts.
 * Same as invalidateInvoice but without the job side-effect path.
 */
export function invalidateInvoiceFinancials(
  qc: QueryClient,
  invoiceId: string | undefined,
): void {
  if (!invoiceId) return;
  qc.invalidateQueries({ queryKey: invoiceKeys.detail(invoiceId) });
  qc.invalidateQueries({ queryKey: invoiceKeys.all() });
  qc.invalidateQueries({ queryKey: invoiceKeys.receivablesRoot() });
  qc.invalidateQueries({ queryKey: invoiceKeys.receivablesCounts() });
}
