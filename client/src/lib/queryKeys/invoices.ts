/**
 * Canonical query key definitions for invoice-related queries.
 *
 * Two parallel key families exist here:
 *   1. Semantic keys under ["invoices", ...] — used by InvoiceDetailPage
 *      and cross-entity references (e.g. job-linked invoice).
 *   2. Receivables workspace keys under ["receivables", ...] — used by
 *      the receivables hub tabs; already has its own factory in
 *      receivablesQueryKeys.ts, which is re-exported here so callers
 *      only need one import.
 *
 * Mutations that modify invoices MUST invalidate both families.
 * Use invalidateInvoice() or invalidateInvoiceFinancials() — do not
 * inline individual key lists in mutation onSuccess handlers.
 */
import { receivablesKeys } from "@/lib/receivablesQueryKeys";
import type { InvoiceView } from "@/components/invoices/InvoiceListPanel";

export const invoiceKeys = {
  /** ["invoices"] — semantic family prefix */
  all: () => ["invoices"] as const,

  /** ["invoices", "detail", id] — full invoice detail */
  detail: (id: string) => ["invoices", "detail", id] as const,

  /** ["invoices", "detail", id, "payments"] — payment list nested under detail */
  payments: (id: string) => ["invoices", "detail", id, "payments"] as const,

  /** ["invoices", "byJob", jobId] — invoice cross-link on JobDetailPage */
  byJob: (jobId: string) => ["invoices", "byJob", jobId] as const,

  /** ["invoices", "list", filters] — filtered invoice list (e.g. { jobId }) */
  list: (filters?: Record<string, unknown>) =>
    ["invoices", "list", filters ?? null] as const,

  // ── Receivables workspace keys (re-exported from receivablesQueryKeys) ──

  /** ["receivables", "invoices"] — receivables hub root prefix */
  receivablesRoot: () => receivablesKeys.invoicesRoot(),

  /** ["receivables", "invoices", view] — one cache slice per receivables tab */
  receivablesView: (view: InvoiceView) => receivablesKeys.invoices(view),

  /** ["receivables", "views", "counts"] — view tab badge counts */
  receivablesCounts: () => receivablesKeys.viewsCounts(),

  /** ["receivables", "notes", { invoiceId }] — per-invoice notes in receivables workspace */
  receivablesNotes: (invoiceId: string | null) =>
    receivablesKeys.notes(invoiceId),
};
