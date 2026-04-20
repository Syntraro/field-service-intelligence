/**
 * Canonical status badge display functions.
 *
 * Single source of truth for entity-specific status badge rendering.
 */
import { UNPAID_INVOICE_STATUSES } from "@shared/invoiceStatus";

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
  isPastDue: boolean,
  /** 2026-04-18 Phase 9 (aging clarity): optional due date. When present,
   *  an unpaid non-past-due invoice within DUE_SOON_WINDOW_DAYS gets a
   *  "Due Soon" badge. Omitting the argument preserves the pre-Phase-9
   *  signature behavior exactly (no Due Soon detection). */
  dueDate?: string | Date | null,
): {
  label: string;
  variant: "default" | "destructive" | "secondary" | "outline";
  isOverdue?: boolean;
  isDueSoon?: boolean;
} {
  if (isPastDue) {
    return { label: "Past Due", variant: "destructive", isOverdue: true };
  }
  // Due Soon — only meaningful for awaiting-payment-ish statuses with a
  // dueDate in the near future. Matches the same unpaid set that
  // `computeIsPastDue` uses on the server.
  const DUE_SOON_WINDOW_DAYS = 7;
  if (dueDate && UNPAID_INVOICE_STATUSES.includes(status)) {
    const d = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
    if (!isNaN(d.getTime())) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const threshold = new Date(today.getTime() + DUE_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const dueMidnight = new Date(d);
      dueMidnight.setHours(0, 0, 0, 0);
      if (dueMidnight >= today && dueMidnight <= threshold) {
        return { label: "Due Soon", variant: "secondary", isDueSoon: true };
      }
    }
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
