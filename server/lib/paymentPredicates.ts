/**
 * Payment-row predicates. Mirrors `server/lib/invoicePredicates.ts` —
 * the canonical single location for row-level yes/no questions about a
 * payment without pulling in the full repository.
 *
 * Every predicate is a pure function of a payment row's data. Consumers:
 * storage layer (`updatePayment`, `deletePayment`, future refund writers),
 * QBO sync helpers, future Stripe writer.
 */

/**
 * 2026-04-14 Payments Phase 3 — provider-linkage predicate.
 *
 * Recognizes BOTH the legacy `qboPaymentId`-only signal and the new
 * `providerSource` enum. A row is provider-linked when any external
 * system is the source of truth for its financial identity — which is
 * exactly when the service layer must block edits to amount, method,
 * and receivedAt (see updatePayment guard, Phase 3).
 *
 * Accepts a partial row shape so callers can pass freshly-read rows,
 * full records, or hand-constructed patches interchangeably.
 */
export function isProviderLinked(row: {
  qboPaymentId?: string | null;
  providerSource?: string | null;
  providerEventId?: string | null;
}): boolean {
  // Legacy signal — set by the QBO payment sync service on first
  // successful QBO POST. Present on pre-Phase-3 rows even when
  // `providerSource` hasn't been backfilled.
  if (row.qboPaymentId) return true;

  // New signal — explicit enum on the row. 'manual' means no provider
  // owns this row; 'qbo' and 'stripe' both imply provider ownership.
  if (row.providerSource === "qbo" || row.providerSource === "stripe") {
    return true;
  }

  return false;
}
