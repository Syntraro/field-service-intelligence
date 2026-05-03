/**
 * Reports — Revenue deep-report aggregator.
 *
 * Backs `GET /api/reports/revenue`. Reuses every revenue/payment
 * helper that already exists in `reportsCommon`:
 *   - `sharedQueries.revenue` / `paymentsCollected` / `avgPaymentAmount`
 *     drive the KPI strip.
 *   - `getRevenueTrendShared` drives the revenue trend section
 *     (same query the Financial tab uses).
 *   - `getPaymentBreakdownShared` drives the payment-method section.
 *   - `getRevenueByClientShared` / `getRecentPaymentsShared` are new
 *     helpers in `reportsCommon` introduced for this page.
 *
 * The only Revenue-specific computation here is the calendar-month
 * comparison ("month-over-month") — that's a small per-month sum
 * (not a 30-day window comparison), so it lives inline.
 */

import { and, eq, gte, lt, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { invoices, payments } from "@shared/schema";
import {
  buildComparisonWindows,
  evaluateScalar,
  buildMetric,
  round2,
  allZero,
  sharedQueries,
  getRevenueTrendShared,
  getPaymentBreakdownShared,
  getRevenueByClientShared,
  getRecentPaymentsShared,
} from "./reportsCommon";
import type {
  MonthOverMonthSection,
  RevenueByClientItem,
  RevenueByClientSection,
  RecentPaymentItem,
  RecentPaymentsSection,
  RevenueRange,
  RevenueResponse,
} from "@shared/reports/revenue";

const TOP_CLIENTS_LIMIT = 10;
const RECENT_PAYMENTS_LIMIT = 25;

// ---------------------------------------------------------------------------
// Section: Month-over-month calendar comparison
//
// NOT a 30-day window — calendar months. The current month is the
// month containing `now`; the previous month is the calendar month
// immediately before that. Both are bounded by the month's first day
// (inclusive) and the next month's first day (exclusive). This makes
// the section's numbers match what users see on a calendar.
// ---------------------------------------------------------------------------

interface MonthRange {
  ymd: string; // YYYY-MM
  from: Date;
  to: Date;
}

function monthBounds(now: Date, monthOffset: number): MonthRange {
  // Use UTC math so the boundaries don't drift with the server's
  // local timezone. The aggregator treats `now` as a UTC instant
  // across the codebase.
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + monthOffset;
  const from = new Date(Date.UTC(y, m, 1));
  const to = new Date(Date.UTC(y, m + 1, 1));
  const ymd = `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, "0")}`;
  return { ymd, from, to };
}

async function sumRevenueInRange(
  companyId: string,
  range: MonthRange,
): Promise<number> {
  // 2026-05-03 launch-readiness audit: this helper was missed in the
  // earlier voided-invoice exclusion pass that updated the seven shared
  // revenue helpers in `reportsCommon.ts`. The Revenue page's
  // month-over-month section consumed un-filtered totals, so a voided
  // invoice's payments would leak into both the current and prior
  // calendar-month buckets and contradict the page's clarification
  // note. Adding the same `ne(invoices.status, "voided")` predicate
  // here brings this 8th call site in line with the canonical pattern.
  const rows = await db
    .select({
      total: sql<string>`COALESCE(SUM(CAST(${payments.amount} AS numeric)), 0)::text`,
    })
    .from(payments)
    .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
    .where(
      and(
        eq(invoices.companyId, companyId),
        eq(payments.paymentType, "payment"),
        ne(invoices.status, "voided"),
        gte(payments.receivedAt, range.from),
        lt(payments.receivedAt, range.to),
      ),
    );
  return parseFloat(rows[0]?.total ?? "0");
}

async function getMonthOverMonth(
  companyId: string,
  now: Date,
): Promise<MonthOverMonthSection> {
  const currentMonth = monthBounds(now, 0);
  const previousMonth = monthBounds(now, -1);
  const [currentRevenue, previousRevenue] = await Promise.all([
    sumRevenueInRange(companyId, currentMonth),
    sumRevenueInRange(companyId, previousMonth),
  ]);
  const changePercent =
    previousRevenue === 0
      ? null
      : Math.round(
          ((currentRevenue - previousRevenue) / Math.abs(previousRevenue)) * 1000,
        ) / 10;
  return {
    asOfISO: now.toISOString(),
    currentMonthYmd: currentMonth.ymd,
    previousMonthYmd: previousMonth.ymd,
    currentMonthRevenue: round2(currentRevenue),
    previousMonthRevenue: round2(previousRevenue),
    changePercent,
    // The section is meaningful when at least one of the two months
    // has revenue. Otherwise the user sees "Not enough data yet".
    hasData: currentRevenue > 0 || previousRevenue > 0,
  };
}

// ---------------------------------------------------------------------------
// Wrappers around the shared helpers — adopt the section-shape contract
// (`hasData`).
// ---------------------------------------------------------------------------

async function getRevenueByClient(
  companyId: string,
  current: { from: Date; to: Date },
): Promise<RevenueByClientSection> {
  const rows = await getRevenueByClientShared(companyId, current, TOP_CLIENTS_LIMIT);
  const items: RevenueByClientItem[] = rows.map((r) => ({
    clientId: r.clientId,
    name: r.name,
    totalRevenue: r.totalRevenue,
    paymentCount: r.paymentCount,
  }));
  return {
    items,
    hasData: items.length > 0,
  };
}

async function getRecentPayments(
  companyId: string,
  current: { from: Date; to: Date },
): Promise<RecentPaymentsSection> {
  const rows = await getRecentPaymentsShared(companyId, current, RECENT_PAYMENTS_LIMIT);
  const items: RecentPaymentItem[] = rows.map((r) => ({
    id: r.id,
    receivedAtISO: r.receivedAtISO,
    amount: r.amount,
    method: r.method,
    methodLabel: r.methodLabel,
    invoiceId: r.invoiceId,
    invoiceNumber: r.invoiceNumber,
    clientId: r.clientId,
    clientName: r.clientName,
  }));
  return {
    items,
    hasData: items.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function getCompanyRevenue(
  companyId: string,
  range: RevenueRange,
  now: Date = new Date(),
): Promise<RevenueResponse> {
  if (range !== "last_30_days") {
    throw new Error(`Unsupported revenue range: ${range}`);
  }
  const windows = buildComparisonWindows(now);
  const { current, prevMonth, prevQuarter, prevYear } = windows;

  const [
    revenue,
    paymentsCollected,
    avgPaymentAmount,
    revenueTrend,
    paymentMethods,
    revenueByClient,
    recentPayments,
    monthComparison,
  ] = await Promise.all([
    evaluateScalar(windows, sharedQueries.revenue(companyId)),
    evaluateScalar(windows, sharedQueries.paymentsCollected(companyId)),
    evaluateScalar(windows, sharedQueries.avgPaymentAmount(companyId)),
    getRevenueTrendShared(companyId, current),
    getPaymentBreakdownShared(companyId, current),
    getRevenueByClient(companyId, current),
    getRecentPayments(companyId, current),
    getMonthOverMonth(companyId, now),
  ]);

  // "Revenue change vs previous period" is the percent change current
  // → prevMonth (matching the Snapshot/Financial tabs' month delta on
  // the revenue card). Encoded as a `currency-percent` metric — the
  // current value is the percent change, comparison rows show the
  // raw scalar for each window so the user can see the underlying
  // numbers driving the delta.
  const revenueChange = {
    current:
      revenue.prevMonth === 0
        ? 0
        : Math.round(
            ((revenue.current - revenue.prevMonth) / Math.abs(revenue.prevMonth)) *
              1000,
          ) / 10,
    prevMonth:
      revenue.prevQuarter === 0
        ? 0
        : Math.round(
            ((revenue.prevMonth - revenue.prevQuarter) / Math.abs(revenue.prevQuarter)) *
              1000,
          ) / 10,
    prevQuarter:
      revenue.prevYear === 0
        ? 0
        : Math.round(
            ((revenue.prevQuarter - revenue.prevYear) / Math.abs(revenue.prevYear)) *
              1000,
          ) / 10,
    prevYear: 0,
  };

  const kpis = {
    metrics: [
      buildMetric({
        key: "total_revenue",
        label: "Total revenue",
        unit: "currency",
        polarity: "higher_is_better",
        scalars: {
          current: round2(revenue.current),
          prevMonth: round2(revenue.prevMonth),
          prevQuarter: round2(revenue.prevQuarter),
          prevYear: round2(revenue.prevYear),
        },
        hasData: !allZero(revenue),
      }),
      buildMetric({
        key: "payments_collected",
        label: "Payments collected",
        unit: "count",
        polarity: "higher_is_better",
        scalars: {
          current: paymentsCollected.current,
          prevMonth: paymentsCollected.prevMonth,
          prevQuarter: paymentsCollected.prevQuarter,
          prevYear: paymentsCollected.prevYear,
        },
        hasData: !allZero(paymentsCollected),
      }),
      buildMetric({
        key: "avg_payment_amount",
        label: "Avg payment amount",
        unit: "currency",
        polarity: "higher_is_better",
        scalars: {
          current: round2(avgPaymentAmount.current),
          prevMonth: round2(avgPaymentAmount.prevMonth),
          prevQuarter: round2(avgPaymentAmount.prevQuarter),
          prevYear: round2(avgPaymentAmount.prevYear),
        },
        // hasData follows paymentsCollected — when there are no
        // payments to average over, the value is undefined.
        hasData: !allZero(paymentsCollected),
      }),
      buildMetric({
        key: "revenue_change",
        label: "Revenue change vs previous period",
        unit: "percent",
        polarity: "higher_is_better",
        scalars: {
          current: revenueChange.current,
          prevMonth: revenueChange.prevMonth,
          prevQuarter: revenueChange.prevQuarter,
          prevYear: revenueChange.prevYear,
        },
        // Meaningful only when there's at least some revenue signal.
        hasData: !allZero(revenue),
      }),
    ],
  };

  return {
    range,
    asOfISO: now.toISOString(),
    window: {
      currentFromISO: current.from.toISOString(),
      currentToISO: current.to.toISOString(),
      previousMonthFromISO: prevMonth.from.toISOString(),
      previousMonthToISO: prevMonth.to.toISOString(),
      previousQuarterFromISO: prevQuarter.from.toISOString(),
      previousQuarterToISO: prevQuarter.to.toISOString(),
      previousYearFromISO: prevYear.from.toISOString(),
      previousYearToISO: prevYear.to.toISOString(),
    },
    kpis,
    revenueTrend,
    paymentMethods,
    revenueByClient,
    recentPayments,
    monthComparison,
  };
}
