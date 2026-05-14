import type { InvoiceView } from "@/components/invoices/InvoiceListPanel";

/**
 * Centralized query key factory for all receivables React Query caches.
 * Use these helpers for every queryKey and invalidateQueries call in the
 * receivables workspace so invalidation targets are always precise.
 */
export const receivablesKeys = {
  // ["receivables", "views", "counts"]
  viewsCounts: () => ["receivables", "views", "counts"] as const,

  // ["receivables", "invoices"] — root prefix; invalidates ALL view slices at once
  invoicesRoot: () => ["receivables", "invoices"] as const,

  // ["receivables", "invoices", view] — one cache slice per view tab
  invoices: (view: InvoiceView) => ["receivables", "invoices", view] as const,

  // ["receivables", "notes", { invoiceId }] — per-invoice notes stream
  notes: (invoiceId: string | null) =>
    ["receivables", "notes", { invoiceId }] as const,
};
