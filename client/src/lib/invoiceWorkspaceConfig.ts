/**
 * Shared invoice workspace configuration — views, filters, URL helpers.
 *
 * Single source of truth for both the v1 (/receivables) and v2 (/invoices-v2)
 * invoice workspaces. Neither page may define these locally.
 */

import type { InvoiceView } from "@/components/invoices/InvoiceListPanel";
import type { InvoiceStatusFilter } from "@shared/invoiceStatus";

export type { InvoiceView, InvoiceStatusFilter };

// ── Views ─────────────────────────────────────────────────────────────────────

export const VALID_VIEWS: readonly InvoiceView[] = [
  "all", "overdue", "awaiting-payment", "drafts", "paid",
  "needs-follow-up", "sent-this-week", "no-recent-contact",
  "high-balance", "disputed", "promised-payment",
];

/** Views that appear in the Filters dropdown rather than the primary chip row. */
export const SECONDARY_VIEWS: readonly InvoiceView[] = [
  "no-recent-contact", "sent-this-week", "high-balance", "drafts", "paid",
];

/** Maps legacy ?filter= query-param values to their InvoiceView equivalents. */
export const FILTER_TO_VIEW: Record<string, InvoiceView> = {
  overdue:          "overdue",
  draft:            "drafts",
  awaiting_payment: "awaiting-payment",
  paid:             "paid",
};

// ── Status filters ────────────────────────────────────────────────────────────

export const INVOICE_STATUS_FILTERS: readonly InvoiceStatusFilter[] = [
  "all", "draft", "awaiting_payment", "partial_paid", "paid", "overdue", "voided",
];

// ── URL helpers ───────────────────────────────────────────────────────────────

/** Resolves the active InvoiceView from the current URL search string. */
export function readViewFromSearch(search: string): InvoiceView {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  if (view && (VALID_VIEWS as readonly string[]).includes(view)) return view as InvoiceView;
  const filter = params.get("filter");
  if (filter && FILTER_TO_VIEW[filter]) return FILTER_TO_VIEW[filter];
  return "all";
}

/** Human-readable label for an InvoiceStatusFilter value. */
export function filterLabel(f: InvoiceStatusFilter): string {
  if (f === "all") return "All";
  if (f === "awaiting_payment") return "Unpaid";
  if (f === "partial_paid") return "Partial";
  if (f === "overdue") return "Overdue";
  return f.charAt(0).toUpperCase() + f.slice(1);
}
