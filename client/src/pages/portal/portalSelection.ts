/**
 * Portal invoice-list selection helpers — extracted from
 * `PortalInvoicesList.tsx` so the multi-select rules can be unit-tested
 * without a React Testing Library / jsdom mount.
 *
 * 2026-05-03 PR 3 — Multi-invoice payments UI.
 *
 * The helpers below are PURE — same input → same output, no React,
 * no DOM, no fetch. The page imports them; the test suite at
 * `tests/portal-invoice-list-selection.test.ts` exercises them.
 *
 * Source of truth for "is this invoice payable from the portal?". The
 * server's portal list endpoint already filters drafts / voided
 * server-side via the `UNPAID_INVOICE_STATUSES + 'paid'` set, so the
 * only non-payable status the UI can observe is `paid` (which gets a
 * status row with no checkbox + no Pay Now button).
 */

export interface PortalListInvoice {
  id: string;
  status: string;
  balance: string;
}

/** Mirrors the canonical UNPAID_INVOICE_STATUSES set on the server. */
export const PAYABLE_PORTAL_STATUSES: ReadonlySet<string> = new Set([
  "awaiting_payment",
  "sent",
  "partial_paid",
]);

/**
 * Pure predicate: is this invoice eligible for the per-row Pay Now
 * button AND for inclusion in a Pay Selected batch?
 *
 * Both surfaces require the SAME predicate — we never want a row that
 * shows Pay Now but can't be selected, or vice-versa.
 */
export function isInvoicePayable(inv: PortalListInvoice): boolean {
  if (!PAYABLE_PORTAL_STATUSES.has(inv.status)) return false;
  const n = parseFloat(inv.balance || "0");
  return Number.isFinite(n) && n > 0;
}

/** Filter+map: list of payable ids in input order (preserves UI ordering). */
export function payableIds(invoices: PortalListInvoice[]): string[] {
  return invoices.filter(isInvoicePayable).map((i) => i.id);
}

/**
 * Resolve the "select-all" header checkbox state from the current
 * selection vs. the visible payable list.
 *
 * Three states match the shadcn/Radix Checkbox contract:
 *   - true          : every payable row is selected
 *   - "indeterminate": some payable rows selected (>0, < all)
 *   - false         : nothing selected
 */
export function selectAllState(
  selectedIds: ReadonlySet<string>,
  visiblePayableIds: readonly string[],
): true | "indeterminate" | false {
  if (visiblePayableIds.length === 0) return false;
  let count = 0;
  for (const id of visiblePayableIds) {
    if (selectedIds.has(id)) count += 1;
  }
  if (count === 0) return false;
  if (count === visiblePayableIds.length) return true;
  return "indeterminate";
}

/**
 * Drop ids from the selection that no longer correspond to a visible
 * payable row (e.g. an invoice silently became `paid` between fetches
 * — selection should not "ghost" past the row's disappearance).
 */
export function effectiveSelection(
  selectedIds: ReadonlySet<string>,
  visiblePayableIds: readonly string[],
): string[] {
  const visible = new Set(visiblePayableIds);
  return Array.from(selectedIds).filter((id) => visible.has(id));
}

/**
 * Display-only total in cents for the sticky "Pay Selected — $X.XX"
 * footer. The backend recomputes from invoice balances inside the
 * batch-checkout route + Stripe enforces server-priced line items, so
 * this number is informational; we never trust it for the API call.
 *
 * Inputs: the visible invoice list + the (effective) selection. We
 * iterate the invoice list (not the selection set) so the total
 * reflects the same balances the user sees in the row.
 */
export function selectedTotalCents(
  invoices: PortalListInvoice[],
  effectiveSelectedIds: readonly string[],
): number {
  const set = new Set(effectiveSelectedIds);
  let cents = 0;
  for (const inv of invoices) {
    if (set.has(inv.id)) {
      const n = parseFloat(inv.balance || "0");
      if (Number.isFinite(n)) cents += Math.round(n * 100);
    }
  }
  return cents;
}

/** UI rule: the Pay Selected button is enabled only when ≥1 row is selected. */
export function isPaySelectedEnabled(effectiveSelectedIds: readonly string[]): boolean {
  return effectiveSelectedIds.length > 0;
}
