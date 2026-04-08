/**
 * Canonical Invoice Predicate Definitions
 *
 * SINGLE SOURCE OF TRUTH for invoice status classification predicates.
 * All consumers must import from this module instead of checking status inline.
 *
 * Follows the same pattern as visitPredicates.ts.
 *
 * Lifecycle status model (canonical):
 *   draft → awaiting_payment → partial_paid → paid
 *                            ↘ voided  (also: draft/awaiting_payment/partial_paid → voided)
 *
 * Status semantics:
 *   - draft            : not issued; structurally editable; never synced to QBO
 *   - awaiting_payment : issued to customer; payments accepted; balance > 0
 *   - partial_paid     : issued; payments recorded but balance > 0
 *   - paid             : terminal; balance == 0
 *   - voided           : terminal; cancelled
 *
 * Legacy alias:
 *   - "sent" is a legacy persisted value equivalent to "awaiting_payment".
 *     Existing rows with status="sent" must continue to render and behave
 *     identically to "awaiting_payment". Modern flows MUST write "awaiting_payment".
 *
 * Derived states (NOT persisted lifecycle statuses):
 *   - overdue : computed from (status in issued set) + balance > 0 + dueDate < today
 *   - viewed  : engagement metadata (not currently persisted as a lifecycle status)
 *
 * 2026-04-08: Created to eliminate predicate drift.
 * 2026-04-08: Removed phantom "overdue" from ISSUED_INVOICE_STATUSES; added
 *             isInvoiceAwaitingPayment() that treats canonical + legacy alias equivalently.
 */

// ============================================================================
// Constants
// ============================================================================

/** Invoice statuses that represent final/irreversible states. */
export const TERMINAL_INVOICE_STATUSES: string[] = ["paid", "voided"];

/**
 * Invoice statuses where the invoice has been issued to the customer.
 * Includes the legacy "sent" alias for backward compatibility with existing rows.
 * Does NOT include "overdue" — overdue is a derived state, not a persisted status.
 */
export const ISSUED_INVOICE_STATUSES: string[] = ["awaiting_payment", "sent", "partial_paid"];

// ============================================================================
// Predicates
// ============================================================================

/** Invoice is in draft — can be edited, deleted, or sent. */
export function isInvoiceDraft(status: string): boolean {
  return status === "draft";
}

/** Invoice is terminal (paid or voided) — no further mutations allowed. */
export function isInvoiceTerminal(status: string): boolean {
  return TERMINAL_INVOICE_STATUSES.includes(status);
}

/** Invoice is editable — only drafts can be structurally modified. */
export function isInvoiceEditable(status: string): boolean {
  return status === "draft";
}

/**
 * Invoice is in an issued state — visible to customer, payments accepted.
 * Includes legacy "sent" alias.
 * Used by portal visibility, QBO sync eligibility, sent-undo checks.
 */
export function isInvoiceIssued(status: string): boolean {
  return ISSUED_INVOICE_STATUSES.includes(status);
}

/**
 * Invoice is awaiting payment (canonical "awaiting_payment" or legacy "sent").
 * Use this for action gating that targets "issued, no payments yet".
 * Treats both states equivalently per legacy alias rules.
 */
export function isInvoiceAwaitingPayment(status: string): boolean {
  return status === "awaiting_payment" || status === "sent";
}

/** Invoice has been partially paid. */
export function isInvoicePartialPaid(status: string): boolean {
  return status === "partial_paid";
}

/** Invoice is fully paid (terminal state). */
export function isInvoicePaid(status: string): boolean {
  return status === "paid";
}

/** Invoice is voided (terminal state). */
export function isInvoiceVoided(status: string): boolean {
  return status === "voided";
}

/**
 * Invoice should be excluded from QBO sync.
 * Draft invoices must NEVER sync to QuickBooks.
 */
export function isInvoiceSyncExcluded(status: string): boolean {
  return status === "draft";
}

/**
 * Invoice can be marked as sent / issued (draft → awaiting_payment).
 */
export function canMarkInvoiceSent(status: string): boolean {
  return status === "draft";
}

/**
 * Invoice sent status can be undone (awaiting_payment / legacy sent → draft).
 * Caller must additionally enforce amountPaid === 0.
 */
export function canUndoInvoiceSent(status: string): boolean {
  return isInvoiceAwaitingPayment(status);
}

/**
 * Invoice can accept a new payment.
 * Allowed states: awaiting_payment (canonical), sent (legacy alias), partial_paid.
 */
export function canAcceptInvoicePayment(status: string): boolean {
  return isInvoiceAwaitingPayment(status) || isInvoicePartialPaid(status);
}
