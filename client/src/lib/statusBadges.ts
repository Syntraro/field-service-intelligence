/**
 * Canonical status badge display functions.
 *
 * Single source of truth for entity-specific status badge rendering.
 */

/**
 * Get display badge for an invoice status.
 * Uses server-computed isPastDue flag — canonical overdue rule:
 * status IN (awaiting_payment, sent, partial_paid) + balance > 0 + dueDate < today.
 *
 * Lifecycle statuses: draft, awaiting_payment, partial_paid, paid, voided.
 * Legacy alias: "sent" — existing rows render as "Awaiting Payment" to match
 * the canonical lifecycle. New code should never write "sent".
 *
 * Past Due is a derived state, not a persisted status.
 */
export function getInvoiceStatusBadge(
  status: string,
  isPastDue: boolean
): {
  label: string;
  variant: "default" | "destructive" | "secondary" | "outline";
  isOverdue?: boolean;
} {
  if (isPastDue) {
    return { label: "Past Due", variant: "destructive", isOverdue: true };
  }
  switch (status) {
    case "draft":            return { label: "Draft", variant: "outline" };
    case "awaiting_payment": return { label: "Awaiting Payment", variant: "default" };
    case "sent":             return { label: "Awaiting Payment", variant: "default" }; // legacy alias
    case "partial_paid":     return { label: "Partial", variant: "secondary" };
    case "paid":             return { label: "Paid", variant: "default" };
    case "voided":           return { label: "Voided", variant: "outline" };
    default:                 return { label: status, variant: "outline" };
  }
}

export function getQuoteStatusBadge(status: string): {
  label: string;
  variant: "default" | "destructive" | "secondary" | "outline";
} {
  switch (status) {
    case "draft":
      return { label: "Draft", variant: "outline" };
    case "sent":
      return { label: "Sent", variant: "default" };
    case "approved":
      return { label: "Approved", variant: "default" };
    case "declined":
      return { label: "Declined", variant: "destructive" };
    case "expired":
      return { label: "Expired", variant: "secondary" };
    case "converted":
      return { label: "Converted", variant: "secondary" };
    default:
      return { label: status, variant: "outline" };
  }
}
