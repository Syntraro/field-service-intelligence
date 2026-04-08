/**
 * Canonical Quote Predicate Definitions
 *
 * SINGLE SOURCE OF TRUTH for quote status classification predicates.
 * All consumers must import from this module instead of checking status inline.
 *
 * Follows the same pattern as visitPredicates.ts and invoicePredicates.ts.
 *
 * 2026-04-08: Created to eliminate repeated status checks in routes/quotes.ts.
 */

// ============================================================================
// Predicates
// ============================================================================

/** Quote is in draft — can be edited, deleted, have lines added/modified, or sent. */
export function isQuoteDraft(status: string): boolean {
  return status === "draft";
}

/** Quote has been sent — can be approved, declined, or expire. */
export function isQuoteSent(status: string): boolean {
  return status === "sent";
}

/** Quote has been approved — can be converted to a job. */
export function isQuoteApproved(status: string): boolean {
  return status === "approved";
}

/**
 * Quote requires draft status for this operation.
 * Throws-compatible guard: returns true if draft, false if not.
 * Used for: edit, delete, add/edit/remove lines, send.
 */
export function requireQuoteDraft(status: string): boolean {
  return status === "draft";
}
