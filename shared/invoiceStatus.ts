/**
 * Canonical invoice status constants and filter types — shared between server and client.
 *
 * Single source of truth for unpaid-status membership. Both runtimes
 * import from here so the list cannot drift.
 *
 * "sent" is a legacy alias for "awaiting_payment" kept for backward
 * read compatibility with pre-lifecycle-redesign rows.
 */

export const UNPAID_INVOICE_STATUSES: string[] = [
  "awaiting_payment",
  "sent",
  "partial_paid",
];

// ── Filter types (client-side, canonical home) ────────────────────────────────

export type InvoiceStatusFilter =
  | "all" | "draft" | "awaiting_payment" | "partial_paid" | "paid"
  | "voided" | "overdue" | "qbo_synced" | "qbo_out_of_sync";

export type InvoiceDatePreset = "this_month" | "last_month" | "last_30_days" | "custom";

export interface InvoiceDateRange {
  preset: InvoiceDatePreset | null;
  start: string | null; // YYYY-MM-DD
  end: string | null;   // YYYY-MM-DD
}
