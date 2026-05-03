/**
 * Reports — Accounts Receivable deep-dive page canonical contract.
 *
 * One source of truth for the GET /api/reports/ar response shape.
 * Both server and client import from here so the JSON shape stays in
 * lockstep.
 *
 * Sections (in spec order):
 *   1. KPI strip — total outstanding, total overdue, avg payment
 *      time, % overdue.
 *   2. Aging buckets (4 — current / 1–30 / 30–60 / 60+).
 *   3. Overdue invoices table (every invoice past due, balance > 0).
 *   4. Top outstanding clients (top N by unpaid balance).
 *   5. Avg payment time trend (daily AVG over current window for
 *      invoices reaching `paid` that day).
 *
 * Every section carries `hasData`. UI MUST render an empty state when
 * false rather than fabricating placeholder rows.
 */

import type {
  ARBucketDetail,
  TopOutstandingClient,
} from "./financial";
import type { MetricCard, SnapshotRange } from "./snapshot";

export type ARRange = SnapshotRange;

/** Aging section. Mirrors the Financial tab's AR shape so renderers
 *  can be reused, but exposes `totalOverdue` directly so the KPI
 *  strip and the section can share one number. */
export interface ARAgingDetailSection {
  /** ISO instant the buckets are evaluated at (typically `now`). */
  asOfISO: string;
  buckets: ARBucketDetail[];
  totalOutstanding: number;
  totalOverdue: number;
  hasData: boolean;
}

export interface OverdueInvoiceRow {
  /** Invoice id — stable across the app. */
  id: string;
  invoiceNumber: string | null;
  /** Display name of the client/location. Always present (server falls
   *  back to "Unnamed Location" if needed). */
  clientName: string;
  /** Amount still owed — invoice BALANCE, not total. A partially-paid
   *  invoice's overdue exposure is the unpaid remainder only. */
  amount: number;
  /** ISO date string (`YYYY-MM-DD`); null only if the invoice has no
   *  due date — those rows are excluded from the overdue table by
   *  construction. */
  dueDate: string | null;
  /** Positive integer days past CURRENT_DATE on the server. */
  daysOverdue: number;
}

export interface OverdueInvoicesSection {
  /** Sorted descending by `daysOverdue` (most overdue first). */
  items: OverdueInvoiceRow[];
  totalCount: number;
  hasData: boolean;
}

export interface TopOutstandingClientsARSection {
  items: TopOutstandingClient[];
  hasData: boolean;
}

export interface PaymentTimePoint {
  /** Bucket date — the day the invoice's final payment landed. */
  date: string;
  /** AVG(paymentDate - issueAnchor) in days, rounded to 1 decimal. */
  avgDays: number;
  /** Count of invoices that closed on this day. */
  invoiceCount: number;
}

export interface PaymentTimeTrendSection {
  bucket: "daily";
  points: PaymentTimePoint[];
  hasData: boolean;
}

export interface ARReportResponse {
  range: ARRange;
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
   * 4 KPIs in spec order: Total outstanding · Total overdue ·
   * Avg payment time · % overdue. All `lower_is_better` polarity —
   * AR up = bad, payment time up = bad, overdue share up = bad.
   */
  kpis: { metrics: MetricCard[] };
  aging: ARAgingDetailSection;
  overdueInvoices: OverdueInvoicesSection;
  topOutstandingClients: TopOutstandingClientsARSection;
  paymentTimeTrend: PaymentTimeTrendSection;
}

export type { ARBucketDetail, TopOutstandingClient, MetricCard };
