/**
 * Payment refundability helpers (2026-04-29 Stripe completion)
 *
 * Pure, dependency-free predicates the UI uses to decide whether to
 * render a "Refund" affordance on a payment-history row, and to seed
 * the refund dialog's "remaining refundable" default.
 *
 * THESE ARE UX HINTS, NOT AUTHORITATIVE CHECKS.
 *   The canonical cap is enforced server-side by
 *   `paymentRepository.assertRefundAmountWithinParent()` (and again at
 *   the DB via `payments_provider_event_id_uq` /
 *   `payments_company_parent_reference_uq` partial uniques). The UI
 *   uses these helpers only so the button doesn't render after the
 *   parent is fully offset, and so the dialog can pre-fill a sensible
 *   default amount.
 *
 *   NEVER use these to validate a refund request before mutation —
 *   always go through the canonical service.
 *
 * Lives in `shared/` because both the React component and the vitest
 * suite consume it. No client/server split required; pure arithmetic
 * over the row shape.
 */

export interface RefundabilityRow {
  id: string;
  amount: string;
  paymentType: "payment" | "refund" | "reversal" | string;
  parentPaymentId: string | null;
}

/**
 * Sum of |amount| across every row whose `parentPaymentId` matches the
 * supplied parent id. Refund and reversal rows are stored with negative
 * amounts; this helper takes the absolute value so callers can reason
 * about the total offset against the parent independently of sign.
 */
export function computeAlreadyOffset(
  parentId: string,
  rows: ReadonlyArray<RefundabilityRow>,
): number {
  let total = 0;
  for (const row of rows) {
    if (row.parentPaymentId !== parentId) continue;
    const amt = parseFloat(row.amount || "0");
    if (Number.isFinite(amt)) total += Math.abs(amt);
  }
  return total;
}

/**
 * True when a payment-history row should show a Refund button. Rules,
 * in evaluation order:
 *
 *   1. Only `paymentType='payment'` parents are refundable. Refund and
 *      reversal child rows themselves are never refunded directly —
 *      the user reverses or refunds the original parent.
 *   2. Parent amount must be a positive finite number (defensive — the
 *      `payments_ledger_shape_chk` DB constraint enforces this, but
 *      the UI must not crash on a malformed row).
 *   3. The cumulative |amount| of every child attached to this parent
 *      must be strictly less than the parent amount (modulo 1e-9 for
 *      float jitter on penny-precise rows). Once the parent is fully
 *      offset there is nothing left to refund.
 */
export function isPaymentRefundable(
  row: RefundabilityRow,
  allRows: ReadonlyArray<RefundabilityRow>,
): boolean {
  if (row.paymentType !== "payment") return false;
  const parentAmount = parseFloat(row.amount || "0");
  if (!Number.isFinite(parentAmount) || parentAmount <= 0) return false;
  const offset = computeAlreadyOffset(row.id, allRows);
  return offset + 1e-9 < parentAmount;
}

/**
 * Remaining refundable amount = parent − offset, clamped to non-negative.
 * Useful for seeding the refund dialog's amount input.
 */
export function remainingRefundable(
  row: RefundabilityRow,
  allRows: ReadonlyArray<RefundabilityRow>,
): number {
  const parentAmount = parseFloat(row.amount || "0");
  if (!Number.isFinite(parentAmount) || parentAmount <= 0) return 0;
  const offset = computeAlreadyOffset(row.id, allRows);
  return Math.max(0, parentAmount - offset);
}
