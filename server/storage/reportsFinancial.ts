/**
 * Reports — Financial tab aggregator.
 *
 * Drill-down for money: revenue, payments, AR, invoice statuses,
 * payment time, top outstanding clients. Reuses the Snapshot tab's
 * shared primitives (`reportsCommon.ts`) so the two tabs cannot drift.
 *
 * Real data only — every section is computed from `invoices`,
 * `payments`, and `client_locations` (with `customer_companies` for
 * display names). No fallbacks, no fabricated values; sections that
 * can't compute set `hasData: false` and the UI renders an empty
 * state.
 */

import { and, eq, sql, inArray } from "drizzle-orm";
import { db } from "../db";
import { invoices } from "@shared/schema";
import { UNPAID_INVOICE_STATUSES } from "@shared/invoiceStatus";
import {
  buildComparisonWindows,
  evaluateScalar,
  buildMetric,
  round2,
  allZero,
  sharedQueries,
  getTopOutstandingClientsShared,
  getRevenueTrendShared,
  getPaymentBreakdownShared,
} from "./reportsCommon";
import type {
  ARBucketDetail,
  ARSection,
  FinancialRange,
  FinancialResponse,
  InvoiceStatusItem,
  InvoiceStatusKey,
  InvoiceStatusSection,
  TopOutstandingClientsSection,
} from "@shared/reports/financial";

// ---------------------------------------------------------------------------
// Sections: Revenue trend + Payment breakdown.
//
// 2026-05-03: lifted into `reportsCommon.getRevenueTrendShared` and
// `reportsCommon.getPaymentBreakdownShared` so the Revenue deep-report
// at `/reports/revenue` consumes the EXACT same queries this tab uses.
// The Financial aggregator just calls the shared helpers — no
// duplicate SQL, no risk of drift.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Section: AR aging (4 buckets: current / 1-30 / 31-60 / 61+)
// ---------------------------------------------------------------------------

async function getARAging(companyId: string, asOf: Date): Promise<ARSection> {
  // 2026-05-02 fix: GROUP BY must repeat the CASE expression — see the
  // matching note in `getCurrentARBuckets`. Drizzle does not emit `AS
  // "bucket"` here, so passing the SAME `bucketExpr` reference into
  // both `.select(...)` and `.groupBy(...)` is the canonical pattern.
  const bucketExpr = sql<"current" | "d30" | "d60" | "d90">`
    CASE
      WHEN ${invoices.dueDate} IS NULL OR ${invoices.dueDate} >= CURRENT_DATE THEN 'current'
      WHEN (CURRENT_DATE - ${invoices.dueDate}::date) <= 30 THEN 'd30'
      WHEN (CURRENT_DATE - ${invoices.dueDate}::date) <= 60 THEN 'd60'
      ELSE 'd90'
    END
  `;
  const rows = await db
    .select({
      bucket: bucketExpr,
      count: sql<number>`COUNT(*)::int`,
      totalBalance: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)), 0)::text`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.companyId, companyId),
        inArray(invoices.status, UNPAID_INVOICE_STATUSES),
        sql`CAST(${invoices.balance} AS numeric) > 0`,
      ),
    )
    .groupBy(bucketExpr);

  const totals: Record<"current" | "d30" | "d60" | "d90", { count: number; total: number }> = {
    current: { count: 0, total: 0 },
    d30: { count: 0, total: 0 },
    d60: { count: 0, total: 0 },
    d90: { count: 0, total: 0 },
  };
  for (const r of rows) {
    const k = r.bucket as keyof typeof totals;
    totals[k] = { count: Number(r.count ?? 0), total: parseFloat(r.totalBalance ?? "0") };
  }

  const buckets: ARBucketDetail[] = [
    { key: "current", label: "Current", amount: round2(totals.current.total), invoiceCount: totals.current.count },
    { key: "d30", label: "1–30 days", amount: round2(totals.d30.total), invoiceCount: totals.d30.count },
    { key: "d60", label: "30–60 days", amount: round2(totals.d60.total), invoiceCount: totals.d60.count },
    { key: "d90", label: "60+ days", amount: round2(totals.d90.total), invoiceCount: totals.d90.count },
  ];

  const totalOutstanding = round2(
    buckets.reduce((acc, b) => acc + b.amount, 0),
  );
  const hasData = buckets.some((b) => b.amount > 0 || b.invoiceCount > 0);

  return {
    asOfISO: asOf.toISOString(),
    buckets,
    totalOutstanding,
    hasData,
  };
}

// ---------------------------------------------------------------------------
// Section: Invoice status breakdown (count + total per status)
//
// Statuses are taken from the canonical `invoiceStatusEnum`. The legacy
// 'sent' status folds into the modern 'awaiting_payment' bucket so the
// UI sees one "Sent" entry. 'Overdue' is computed (not stored) — it
// counts unpaid invoices whose dueDate is in the past with a positive
// balance. This DOES overlap with the "Sent" / "Partially paid"
// buckets by design — the user explicitly listed Overdue alongside
// the storage statuses to surface that tail end of the pipeline.
// ---------------------------------------------------------------------------

async function getInvoiceStatusBreakdown(
  companyId: string,
): Promise<InvoiceStatusSection> {
  // One round-trip — all five buckets via SQL FILTER clauses.
  const rows = await db
    .select({
      draftCount: sql<number>`COUNT(*) FILTER (WHERE ${invoices.status} = 'draft')::int`,
      draftTotal: sql<string>`COALESCE(SUM(CAST(${invoices.total} AS numeric)) FILTER (WHERE ${invoices.status} = 'draft'), 0)::text`,
      sentCount: sql<number>`COUNT(*) FILTER (WHERE ${invoices.status} IN ('awaiting_payment', 'sent'))::int`,
      sentTotal: sql<string>`COALESCE(SUM(CAST(${invoices.total} AS numeric)) FILTER (WHERE ${invoices.status} IN ('awaiting_payment', 'sent')), 0)::text`,
      partialCount: sql<number>`COUNT(*) FILTER (WHERE ${invoices.status} = 'partial_paid')::int`,
      partialTotal: sql<string>`COALESCE(SUM(CAST(${invoices.total} AS numeric)) FILTER (WHERE ${invoices.status} = 'partial_paid'), 0)::text`,
      paidCount: sql<number>`COUNT(*) FILTER (WHERE ${invoices.status} = 'paid')::int`,
      paidTotal: sql<string>`COALESCE(SUM(CAST(${invoices.total} AS numeric)) FILTER (WHERE ${invoices.status} = 'paid'), 0)::text`,
      // Overdue: any unpaid status with positive balance + dueDate in past.
      overdueCount: sql<number>`COUNT(*) FILTER (WHERE ${invoices.status} IN ('awaiting_payment', 'sent', 'partial_paid') AND CAST(${invoices.balance} AS numeric) > 0 AND ${invoices.dueDate} IS NOT NULL AND ${invoices.dueDate}::date < CURRENT_DATE)::int`,
      overdueBalance: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)) FILTER (WHERE ${invoices.status} IN ('awaiting_payment', 'sent', 'partial_paid') AND CAST(${invoices.balance} AS numeric) > 0 AND ${invoices.dueDate} IS NOT NULL AND ${invoices.dueDate}::date < CURRENT_DATE), 0)::text`,
    })
    .from(invoices)
    .where(eq(invoices.companyId, companyId));

  const r = rows[0];
  const items: InvoiceStatusItem[] = [
    {
      key: "draft",
      label: "Draft",
      count: Number(r?.draftCount ?? 0),
      totalAmount: round2(parseFloat(r?.draftTotal ?? "0")),
    },
    {
      key: "sent",
      label: "Sent",
      count: Number(r?.sentCount ?? 0),
      totalAmount: round2(parseFloat(r?.sentTotal ?? "0")),
    },
    {
      key: "partial_paid",
      label: "Partially paid",
      count: Number(r?.partialCount ?? 0),
      totalAmount: round2(parseFloat(r?.partialTotal ?? "0")),
    },
    {
      key: "paid",
      label: "Paid",
      count: Number(r?.paidCount ?? 0),
      totalAmount: round2(parseFloat(r?.paidTotal ?? "0")),
    },
    {
      // Overdue uses BALANCE (what's actually owed), not invoice total —
      // a partially-paid invoice's overdue exposure is the unpaid remainder.
      key: "overdue",
      label: "Overdue",
      count: Number(r?.overdueCount ?? 0),
      totalAmount: round2(parseFloat(r?.overdueBalance ?? "0")),
    },
  ];

  const hasData = items.some((i) => i.count > 0 || i.totalAmount > 0);
  return { items, hasData };
}

// ---------------------------------------------------------------------------
// Section: Top outstanding clients (top 10 by sum of unpaid balance)
//
// 2026-05-02: lifted into `reportsCommon.getTopOutstandingClientsShared`
// so the AR deep-report can reuse the same query without duplicating
// the join + groupBy. The Financial tab keeps its own thin wrapper to
// preserve the existing section-shape contract (`hasData`, etc.).
// ---------------------------------------------------------------------------

const TOP_CLIENTS_LIMIT = 10;

async function getTopOutstandingClients(
  companyId: string,
): Promise<TopOutstandingClientsSection> {
  const items = await getTopOutstandingClientsShared(companyId, TOP_CLIENTS_LIMIT);
  return {
    items,
    hasData: items.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function getCompanyFinancial(
  companyId: string,
  range: FinancialRange,
  now: Date = new Date(),
): Promise<FinancialResponse> {
  if (range !== "last_30_days") {
    throw new Error(`Unsupported financial range: ${range}`);
  }
  const windows = buildComparisonWindows(now);
  const { current, prevMonth, prevQuarter, prevYear } = windows;

  // Run every section concurrently.
  const [
    revenue,
    paymentsCollected,
    totalOutstanding,
    ar30Plus,
    avgPaymentDays,
    revenueTrend,
    paymentBreakdown,
    arAging,
    invoiceStatus,
    topClients,
  ] = await Promise.all([
    evaluateScalar(windows, sharedQueries.revenue(companyId)),
    evaluateScalar(windows, sharedQueries.paymentsCollected(companyId)),
    evaluateScalar(windows, sharedQueries.totalOutstandingAtPoint(companyId)),
    evaluateScalar(windows, sharedQueries.ar30PlusAtPoint(companyId)),
    evaluateScalar(windows, sharedQueries.avgPaymentDays(companyId)),
    getRevenueTrendShared(companyId, current),
    getPaymentBreakdownShared(companyId, current),
    getARAging(companyId, now),
    getInvoiceStatusBreakdown(companyId),
    getTopOutstandingClients(companyId),
  ]);

  // Avg payment days is meaningful only when at least one window has a
  // paid invoice. Same rule the Snapshot tab uses for parity.
  const avgPaymentDaysHasData =
    avgPaymentDays.current > 0
    || avgPaymentDays.prevMonth > 0
    || avgPaymentDays.prevQuarter > 0
    || avgPaymentDays.prevYear > 0;

  const kpis = {
    metrics: [
      buildMetric({
        key: "revenue",
        label: "Revenue",
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
        key: "outstanding_ar",
        label: "Outstanding AR",
        unit: "currency",
        polarity: "lower_is_better",
        scalars: {
          current: round2(totalOutstanding.current),
          prevMonth: round2(totalOutstanding.prevMonth),
          prevQuarter: round2(totalOutstanding.prevQuarter),
          prevYear: round2(totalOutstanding.prevYear),
        },
        hasData: !allZero(totalOutstanding),
      }),
      buildMetric({
        key: "overdue_ar",
        label: "Overdue AR (30+ days)",
        unit: "currency",
        polarity: "lower_is_better",
        scalars: {
          current: round2(ar30Plus.current),
          prevMonth: round2(ar30Plus.prevMonth),
          prevQuarter: round2(ar30Plus.prevQuarter),
          prevYear: round2(ar30Plus.prevYear),
        },
        hasData: !allZero(ar30Plus),
      }),
      buildMetric({
        key: "avg_payment_days",
        label: "Avg invoice payment time",
        unit: "days",
        polarity: "lower_is_better",
        scalars: {
          current: Math.round(avgPaymentDays.current * 10) / 10,
          prevMonth: Math.round(avgPaymentDays.prevMonth * 10) / 10,
          prevQuarter: Math.round(avgPaymentDays.prevQuarter * 10) / 10,
          prevYear: Math.round(avgPaymentDays.prevYear * 10) / 10,
        },
        hasData: avgPaymentDaysHasData,
      }),
    ],
  };

  // Standalone payment-time card mirrors the Snapshot tab's metric so
  // the Financial tab can render the same comparison view in its own
  // section. Same numbers, same hasData rule.
  const paymentTime = buildMetric({
    key: "avg_payment_days",
    label: "Average invoice payment time",
    unit: "days",
    polarity: "lower_is_better",
    scalars: {
      current: Math.round(avgPaymentDays.current * 10) / 10,
      prevMonth: Math.round(avgPaymentDays.prevMonth * 10) / 10,
      prevQuarter: Math.round(avgPaymentDays.prevQuarter * 10) / 10,
      prevYear: Math.round(avgPaymentDays.prevYear * 10) / 10,
    },
    hasData: avgPaymentDaysHasData,
  });

  return {
    range,
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
    paymentBreakdown,
    arAging,
    invoiceStatus,
    paymentTime,
    topOutstandingClients: topClients,
  };
}
