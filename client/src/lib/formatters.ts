/**
 * Canonical client-side formatters.
 *
 * Scope (this file):
 *   - Standard money values rendered in office-side UI: invoices, quotes,
 *     totals, line items, summary cards.
 *
 * Out of scope (intentional, do NOT consolidate here):
 *   - Portal currency formatting — `pages/portal/portalUtils.ts` parameterizes
 *     `currency` per invoice and is its own SoT for the portal sub-app.
 *   - Whole-dollar KPI tiles (`Dashboard.tsx`, `Jobs.tsx`) — they intentionally
 *     hide cents via `minimumFractionDigits: 0` on the KPI strip.
 *   - Compact / abbreviated chart axis labels (`FinancialDashboard.tsx`) — owns
 *     its own combined whole-dollar + compact helper because both behaviors are
 *     coupled to the chart's axis ticks.
 *   - USD-denominated displays (`PartsBillingCard.tsx`) — explicitly
 *     USD/en-US.
 *   - Manual `$N.NN` rendering with a `"-"` null sentinel
 *     (`components/products-services/types.ts`).
 *   - Server-side PDF rendering (`server/services/invoicePdfService.ts`,
 *     `server/services/quotePdfService.ts`) — server formatters are owned by
 *     those services.
 *
 * 2026-04-08: Created during the formatCurrency consolidation pass to replace
 * 7 byte-equivalent local helpers across the office-side UI.
 */

/**
 * Format a currency value for office-side UI display.
 *
 * Default behavior matches the most common existing client helper:
 *   `Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" })`
 * which renders e.g. `$1,234.56` (Intl default = 2 fraction digits for CAD).
 *
 * Null/undefined and unparseable strings are coerced to 0 (renders `$0.00`)
 * to avoid `$NaN` surprises. Compatible callsites already only pass valid
 * NUMERIC schema values, so this coercion only affects bug paths.
 *
 * The `currency` parameter exists for forward compatibility but defaults to
 * CAD; do NOT use this helper to multiplex currencies — that's the portal's
 * responsibility (see `portalUtils.ts`).
 */
export function formatCurrency(
  amount: number | string | null | undefined,
  currency: string = "CAD",
): string {
  let num: number;
  if (typeof amount === "number") {
    num = Number.isFinite(amount) ? amount : 0;
  } else if (amount == null) {
    num = 0;
  } else {
    const parsed = parseFloat(amount);
    num = Number.isFinite(parsed) ? parsed : 0;
  }
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
  }).format(num);
}

/**
 * 2026-05-04 PR8 — Format an ISO timestamp as a calendar date.
 *
 * Default: en-CA, `MMM d, yyyy` (e.g. `May 4, 2026`). Returns `"—"`
 * for null / undefined / unparseable input — matches the `formatCurrency`
 * convention of coercing bad input to a stable rendered fallback.
 *
 * Use this for dates that don't need time-of-day precision (arrival
 * dates, evidence due-by, created-at on lifecycle tables). For events
 * that need wall-clock specificity (transaction received-at), use
 * `formatDateTime` instead.
 *
 * Lifted out of `PaymentsDashboardPage` in PR8; previously a
 * page-local helper. No canonical client-side date helper existed
 * before this — every page rendered dates ad-hoc.
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Format duration in minutes to a compact display string. Returns `"-"` for null/undefined. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "-";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * 2026-05-04 PR8 — Format an ISO timestamp as a calendar date + wall
 * clock. Default: en-CA, `MMM d, yyyy h:mm AM/PM`. Returns `"—"` on
 * null / unparseable.
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
