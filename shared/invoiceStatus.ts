/**
 * Canonical invoice status constants — shared between server and client.
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
