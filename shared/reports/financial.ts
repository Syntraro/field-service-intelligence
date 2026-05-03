/**
 * Reports — Financial tab canonical contract.
 *
 * One source of truth for the GET /api/reports/financial response shape.
 * Both server and client import from here so the JSON shape stays in
 * lockstep.
 *
 * Section conventions:
 *   - Every section carries a `hasData` flag. UI MUST render an empty
 *     state when false rather than fabricating zeroes / placeholders.
 *   - Currency values are emitted as numbers (server-side rounded to
 *     cents). Counts are integers.
 *   - The MetricCard / SnapshotRange / ARBucket types are reused from
 *     `./snapshot.ts` so the Financial tab inherits the same trend
 *     polarity / null-safe-percent rules the Snapshot tab uses.
 */

import type { ARBucket, MetricCard, SnapshotRange } from "./snapshot";

export type FinancialRange = SnapshotRange;

/**
 * Granularity of the revenue trend. Last-30-days uses daily buckets so
 * the chart has ~30 points; longer ranges (when wired) would switch to
 * weekly. The server emits whichever bucket fits the range so the
 * client never has to bucket on its own.
 */
export type RevenueTrendBucket = "daily" | "weekly";

export interface RevenueTrendPoint {
  /** Window start of the bucket as an ISO date (YYYY-MM-DD in the
   *  company's local calendar). */
  date: string;
  /** Cash-basis revenue (sum of payments received in the bucket). */
  amount: number;
  /** Number of payment events in the bucket. */
  count: number;
}

export interface RevenueTrendSection {
  bucket: RevenueTrendBucket;
  points: RevenueTrendPoint[];
  hasData: boolean;
}

export interface PaymentBreakdownItem {
  /** Canonical payment method key (cash / credit / debit / e-transfer /
   *  cheque / other). Unknown values normalize to `other`. */
  method: string;
  /** Human-readable label for the method. Server-emitted so copy stays
   *  canonical. */
  label: string;
  totalAmount: number;
  /** Share of the section's total amount, 0-100, rounded to 1 decimal. */
  percentOfTotal: number;
  count: number;
}

export interface PaymentBreakdownSection {
  items: PaymentBreakdownItem[];
  totalAmount: number;
  totalCount: number;
  hasData: boolean;
}

export type ARBucketKey = "current" | "d30" | "d60" | "d90";

export interface ARBucketDetail {
  key: ARBucketKey;
  label: string;
  amount: number;
  invoiceCount: number;
}

export interface ARSection {
  asOfISO: string;
  buckets: ARBucketDetail[];
  totalOutstanding: number;
  hasData: boolean;
}

export type InvoiceStatusKey =
  | "draft"
  | "sent"
  | "partial_paid"
  | "paid"
  | "overdue";

export interface InvoiceStatusItem {
  key: InvoiceStatusKey;
  label: string;
  count: number;
  totalAmount: number;
}

export interface InvoiceStatusSection {
  items: InvoiceStatusItem[];
  hasData: boolean;
}

export interface TopOutstandingClient {
  /** The location (client) id — `clientLocations.id`. Stable across the
   *  app; the dashboard's billing surfaces all key off the same id. */
  clientId: string;
  name: string;
  totalOutstanding: number;
  invoiceCount: number;
}

export interface TopOutstandingClientsSection {
  items: TopOutstandingClient[];
  hasData: boolean;
}

export interface FinancialResponse {
  range: FinancialRange;
  window: {
    currentFromISO: string;
    currentToISO: string;
    previousMonthFromISO: string;
    previousMonthToISO: string;
    previousQuarterFromISO: string;
    previousQuarterToISO: string;
    previousYearFromISO: string;
    previousYearToISO: string;
  };
  /**
   * Top KPI strip — 5 metrics in the spec order:
   * Revenue · Payments collected · Outstanding AR · Overdue AR ·
   * Avg invoice payment time.
   */
  kpis: { metrics: MetricCard[] };
  revenueTrend: RevenueTrendSection;
  paymentBreakdown: PaymentBreakdownSection;
  arAging: ARSection;
  invoiceStatus: InvoiceStatusSection;
  /** Single MetricCard. Same shape as the Snapshot's `avg_payment_days` —
   *  this section is the drill-down expanded view. */
  paymentTime: MetricCard;
  topOutstandingClients: TopOutstandingClientsSection;
}

// Re-export so callers can import everything they need from here.
export type { ARBucket, MetricCard };
