/**
 * Reports — Revenue deep-report canonical contract.
 *
 * One source of truth for the GET /api/reports/revenue response shape.
 * Both server and client import from here so the JSON shape stays in
 * lockstep.
 *
 * Sections (in spec order):
 *   1. KPI strip — Total revenue · Payments collected ·
 *      Avg payment amount · Revenue change vs previous period.
 *   2. Revenue trend — daily cash-basis bars (reuses Financial's
 *      shared helper).
 *   3. Payment methods — total + percent per method (reuses
 *      Financial's shared helper).
 *   4. Revenue by client — top N by sum of payments received.
 *   5. Recent payments — newest-first activity list.
 *   6. Month-over-month — calendar-month aligned current/previous
 *      revenue with % change.
 *
 * Every section carries `hasData`. UI MUST render an empty state when
 * false rather than fabricating placeholder rows.
 */

import type {
  PaymentBreakdownItem,
  PaymentBreakdownSection,
  RevenueTrendPoint,
  RevenueTrendSection,
} from "./financial";
import type { MetricCard, SnapshotRange } from "./snapshot";

export type RevenueRange = SnapshotRange;

export interface RevenueByClientItem {
  clientId: string;
  name: string;
  totalRevenue: number;
  paymentCount: number;
}

export interface RevenueByClientSection {
  /** Sorted desc by `totalRevenue`. Server-side cap (top N). */
  items: RevenueByClientItem[];
  hasData: boolean;
}

export interface RecentPaymentItem {
  id: string;
  /** Payment receipt instant. ISO UTC; client renders in local tz. */
  receivedAtISO: string;
  amount: number;
  /** Canonical method key (cash / credit / debit / e-transfer / cheque
   *  / other). Unknown values normalize to "other". */
  method: string;
  methodLabel: string;
  invoiceId: string;
  invoiceNumber: string | null;
  clientId: string;
  clientName: string;
}

export interface RecentPaymentsSection {
  /** Sorted desc by `receivedAtISO` (newest first). Server-side cap. */
  items: RecentPaymentItem[];
  hasData: boolean;
}

export interface MonthOverMonthSection {
  /** ISO instant the comparison was evaluated at. */
  asOfISO: string;
  /** Calendar-month label of the current month, e.g. `"2026-05"`. */
  currentMonthYmd: string;
  /** Calendar-month label of the previous month, e.g. `"2026-04"`. */
  previousMonthYmd: string;
  currentMonthRevenue: number;
  previousMonthRevenue: number;
  /** Percent change current vs previous, rounded to 1 decimal. Null
   *  when the previous month had zero revenue (the ratio is undefined
   *  — UI must render "—" instead of fabricating "Infinity%"). */
  changePercent: number | null;
  hasData: boolean;
}

export interface RevenueResponse {
  range: RevenueRange;
  asOfISO: string;
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
   * 4 KPIs in spec order. All `higher_is_better`:
   * Total revenue · Payments collected · Avg payment amount ·
   * Revenue change vs previous period.
   */
  kpis: { metrics: MetricCard[] };
  revenueTrend: RevenueTrendSection;
  paymentMethods: PaymentBreakdownSection;
  revenueByClient: RevenueByClientSection;
  recentPayments: RecentPaymentsSection;
  monthComparison: MonthOverMonthSection;
}

export type {
  MetricCard,
  PaymentBreakdownItem,
  PaymentBreakdownSection,
  RevenueTrendPoint,
  RevenueTrendSection,
};
