/**
 * Reports — Accounts Receivable deep-report aggregator.
 *
 * Backs `GET /api/reports/ar`. Reuses the existing AR Aging report
 * (`reportsRepository.getARAgingReport`) for buckets + the invoice
 * list — no duplicate aging math. Adds the parts unique to the
 * deep-report (KPI comparisons, payment-time trend) on top.
 *
 * Real data only. Sections that can't compute set `hasData: false`
 * and the UI renders an empty state.
 */

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { invoices, payments } from "@shared/schema";
import { reportsRepository } from "./reports";
import {
  type Window,
  buildComparisonWindows,
  evaluateScalar,
  buildMetric,
  round2,
  allZero,
  sharedQueries,
  getTopOutstandingClientsShared,
} from "./reportsCommon";
import type {
  ARAgingDetailSection,
  ARRange,
  ARReportResponse,
  OverdueInvoiceRow,
  OverdueInvoicesSection,
  PaymentTimePoint,
  PaymentTimeTrendSection,
  TopOutstandingClientsARSection,
} from "@shared/reports/ar";

const TOP_CLIENTS_LIMIT = 10;

// ---------------------------------------------------------------------------
// Section: avg payment time trend (daily AVG over current window for
// invoices reaching `paid` that day). Companion to the existing
// `sharedQueries.avgPaymentDays` KPI — same predicate, just bucketed
// by paid date instead of summed across the whole window.
// ---------------------------------------------------------------------------

async function getPaymentTimeTrend(
  companyId: string,
  current: Window,
): Promise<PaymentTimeTrendSection> {
  const rows = await db.execute<{
    date: string;
    avg_days: string;
    invoice_count: number;
  }>(
    sql`
      SELECT
        to_char(last_paid_at::date, 'YYYY-MM-DD') AS date,
        AVG(EXTRACT(EPOCH FROM (last_paid_at - issued_anchor)) / 86400.0)::text AS avg_days,
        COUNT(*)::int AS invoice_count
      FROM (
        SELECT
          ${invoices.id} AS invoice_id,
          COALESCE(${invoices.issuedAt}, ${invoices.issueDate}::timestamp) AS issued_anchor,
          MAX(${payments.receivedAt}) AS last_paid_at
        FROM ${invoices}
        INNER JOIN ${payments} ON ${payments.invoiceId} = ${invoices.id}
        WHERE ${invoices.companyId} = ${companyId}
          AND ${invoices.status} = 'paid'
          AND ${payments.paymentType} = 'payment'
        GROUP BY ${invoices.id}, ${invoices.issuedAt}, ${invoices.issueDate}
        HAVING MAX(${payments.receivedAt}) >= ${current.from}
           AND MAX(${payments.receivedAt}) <  ${current.to}
      ) AS paid_invoices
      GROUP BY last_paid_at::date
      ORDER BY last_paid_at::date
    `,
  );

  const points: PaymentTimePoint[] = rows.rows.map((r) => ({
    date: r.date,
    avgDays: Math.round(parseFloat(r.avg_days ?? "0") * 10) / 10,
    invoiceCount: Number(r.invoice_count ?? 0),
  }));

  return {
    bucket: "daily",
    points,
    hasData: points.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Section assembly — Aging + Overdue table from the canonical
// `getARAgingReport`; no duplicate aging math.
// ---------------------------------------------------------------------------

const AGING_LABEL: Record<"current" | "d30" | "d60" | "d90", string> = {
  current: "Current",
  d30: "1–30 days",
  d60: "30–60 days",
  d90: "60+ days",
};

function buildAgingFromCanonicalReport(
  report: Awaited<ReturnType<typeof reportsRepository.getARAgingReport>>,
  asOf: Date,
): ARAgingDetailSection {
  const buckets = report.buckets.map((b) => ({
    key: b.bucket,
    label: AGING_LABEL[b.bucket],
    amount: round2(b.totalBalance),
    invoiceCount: b.count,
  }));
  const totalOutstanding = round2(report.summary.totalOutstanding);
  const totalOverdue = round2(
    buckets
      .filter((b) => b.key !== "current")
      .reduce((acc, b) => acc + b.amount, 0),
  );
  const hasData = buckets.some((b) => b.amount > 0 || b.invoiceCount > 0);
  return {
    asOfISO: asOf.toISOString(),
    buckets,
    totalOutstanding,
    totalOverdue,
    hasData,
  };
}

function buildOverdueInvoicesFromCanonicalReport(
  report: Awaited<ReturnType<typeof reportsRepository.getARAgingReport>>,
): OverdueInvoicesSection {
  // The canonical AR Aging query orders rows by `daysOverdue DESC`
  // already, so we just filter out current (non-overdue) rows. No
  // re-sort, no re-bucket.
  const items: OverdueInvoiceRow[] = report.invoices
    .filter((inv) => inv.daysOverdue > 0 && parseFloat(inv.balance) > 0)
    .map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      clientName: inv.locationDisplayName ?? "Unnamed Location",
      amount: round2(parseFloat(inv.balance)),
      dueDate: inv.dueDate,
      daysOverdue: inv.daysOverdue,
    }));
  return {
    items,
    totalCount: items.length,
    hasData: items.length > 0,
  };
}

async function getTopOutstandingForAR(
  companyId: string,
): Promise<TopOutstandingClientsARSection> {
  const items = await getTopOutstandingClientsShared(companyId, TOP_CLIENTS_LIMIT);
  return { items, hasData: items.length > 0 };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function getCompanyAR(
  companyId: string,
  range: ARRange,
  now: Date = new Date(),
): Promise<ARReportResponse> {
  if (range !== "last_30_days") {
    throw new Error(`Unsupported AR range: ${range}`);
  }
  const windows = buildComparisonWindows(now);
  const { current, prevMonth, prevQuarter, prevYear } = windows;

  // Run sections concurrently. The canonical AR aging report drives
  // both the aging section and the overdue table — one query, two
  // shapes. Plus the four KPI scalar evaluations and the new
  // payment-time trend.
  const [
    agingReport,
    totalOutstanding,
    totalOverdue,
    avgPaymentDays,
    topClients,
    paymentTimeTrend,
  ] = await Promise.all([
    reportsRepository.getARAgingReport(companyId),
    evaluateScalar(windows, sharedQueries.totalOutstandingAtPoint(companyId)),
    evaluateScalar(windows, sharedQueries.totalOverdueAtPoint(companyId)),
    evaluateScalar(windows, sharedQueries.avgPaymentDays(companyId)),
    getTopOutstandingForAR(companyId),
    getPaymentTimeTrend(companyId, current),
  ]);

  // % overdue = totalOverdue / totalOutstanding × 100, evaluated per
  // window. Null-safe: when there's nothing outstanding, the share is
  // undefined and we emit 0. The KPI's `hasData` is gated on
  // `totalOutstanding` having any signal (allZero check).
  const ratioPercent = (overdue: number, outstanding: number): number =>
    outstanding > 0 ? Math.round((overdue / outstanding) * 1000) / 10 : 0;
  const overdueShare = {
    current: ratioPercent(totalOverdue.current, totalOutstanding.current),
    prevMonth: ratioPercent(totalOverdue.prevMonth, totalOutstanding.prevMonth),
    prevQuarter: ratioPercent(
      totalOverdue.prevQuarter,
      totalOutstanding.prevQuarter,
    ),
    prevYear: ratioPercent(totalOverdue.prevYear, totalOutstanding.prevYear),
  };

  // `avgPaymentDays.hasData` rule mirrors the Snapshot/Financial tabs.
  const avgPaymentDaysHasData =
    avgPaymentDays.current > 0
    || avgPaymentDays.prevMonth > 0
    || avgPaymentDays.prevQuarter > 0
    || avgPaymentDays.prevYear > 0;

  const aging = buildAgingFromCanonicalReport(agingReport, now);
  const overdueInvoices = buildOverdueInvoicesFromCanonicalReport(agingReport);

  const kpis = {
    metrics: [
      buildMetric({
        key: "total_outstanding",
        label: "Total outstanding",
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
        key: "total_overdue",
        label: "Total overdue",
        unit: "currency",
        polarity: "lower_is_better",
        scalars: {
          current: round2(totalOverdue.current),
          prevMonth: round2(totalOverdue.prevMonth),
          prevQuarter: round2(totalOverdue.prevQuarter),
          prevYear: round2(totalOverdue.prevYear),
        },
        hasData: !allZero(totalOverdue),
      }),
      buildMetric({
        key: "avg_payment_days",
        label: "Avg payment time",
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
      buildMetric({
        key: "overdue_share",
        label: "% overdue",
        unit: "percent",
        polarity: "lower_is_better",
        scalars: {
          current: overdueShare.current,
          prevMonth: overdueShare.prevMonth,
          prevQuarter: overdueShare.prevQuarter,
          prevYear: overdueShare.prevYear,
        },
        // The share is meaningful only when there is at least some
        // outstanding AR in any window. With zero outstanding the
        // share is undefined for every window — empty state.
        hasData: !allZero(totalOutstanding),
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
    aging,
    overdueInvoices,
    topOutstandingClients: topClients,
    paymentTimeTrend,
  };
}
