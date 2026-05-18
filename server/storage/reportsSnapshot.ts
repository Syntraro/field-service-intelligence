/**
 * Reports — Company Snapshot aggregator.
 *
 * Computes the canonical /api/reports/snapshot response from real
 * persisted data only. Every metric query is tenant-scoped and bounded
 * to a UTC time window the route resolves up front.
 *
 * Window semantics (range = "last_30_days"):
 *   current      = [now - 30d, now)
 *   prevMonth    = [now - 60d, now - 30d)   // 30-day window shifted -30d
 *   prevQuarter  = [now - 120d, now - 90d)  // 30-day window shifted -90d
 *   prevYear     = [now - 395d, now - 365d) // 30-day window shifted -365d
 *
 * The previous-period windows are equal-length so percent change is a
 * fair like-for-like comparison. Quarter and year deltas are still
 * 30-day spans (NOT 90-day or 365-day) because the spec asks "what was
 * this same metric like at this point a quarter / year ago" — the
 * period length the user picked is the controlling variable.
 *
 * No metric is ever fabricated. When the underlying tables don't carry
 * the inputs needed for a derivation (e.g. unbillable cost requires
 * `time_entries.cost_rate_snapshot`), the metric returns
 * `hasData: false` and the UI shows a "Not enough data yet" empty
 * state. Real zero values pass through with `hasData: true`.
 */

import { and, eq, sql, inArray } from "drizzle-orm";
import { db } from "../db";
import { invoices } from "@shared/schema";
import { UNPAID_INVOICE_STATUSES } from "@shared/invoiceStatus";
import type {
  ARBucket,
  SnapshotRange,
  SnapshotResponse,
} from "@shared/reports/snapshot";
import {
  buildComparisonWindows,
  evaluateScalar,
  buildMetric,
  round2,
  allZero,
  sharedQueries,
} from "./reportsCommon";

// All scalar metrics now route through `sharedQueries` (see
// ./reportsCommon.ts). Earlier passes lifted Revenue / Avg Payment
// Days / AR 30+, then Jobs Completed / Avg Job Invoice Value /
// Unbillable Cost; this pass lifted Leads / Lead Conversion / Quotes
// / Quote Conversion. The Snapshot tab's behavior is unchanged — the
// SQL is byte-for-byte identical, just relocated so every Reports tab
// has one source of truth.

// ---------------------------------------------------------------------------
// AR snapshot — current state, no period comparison.
// ---------------------------------------------------------------------------

async function getCurrentARBuckets(companyId: string): Promise<ARBucket[]> {
  // 2026-05-02 fix: GROUP BY must repeat the CASE expression — Drizzle's
  // `select({ bucket: sql`CASE…` })` does NOT emit `AS "bucket"` in the
  // generated SQL, so a bare `GROUP BY bucket` referenced an alias that
  // didn't exist and Postgres errored with `column "bucket" does not
  // exist`. Defining the expression once as a const and passing it into
  // BOTH `.select(...)` and `.groupBy(...)` is the canonical pattern
  // used by `server/storage/reports.ts::agingBucketExpr` and avoids the
  // alias-quoting trap entirely.
  const bucketExpr = sql<"current" | "d30" | "d60_plus">`
    CASE
      WHEN ${invoices.dueDate} IS NULL OR ${invoices.dueDate} >= CURRENT_DATE THEN 'current'
      WHEN (CURRENT_DATE - ${invoices.dueDate}::date) <= 30 THEN 'd30'
      ELSE 'd60_plus'
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

  const totals: Record<"current" | "d30" | "d60_plus", { count: number; total: number }> = {
    current: { count: 0, total: 0 },
    d30: { count: 0, total: 0 },
    d60_plus: { count: 0, total: 0 },
  };
  for (const r of rows) {
    const k = r.bucket as keyof typeof totals;
    totals[k] = { count: Number(r.count ?? 0), total: parseFloat(r.totalBalance ?? "0") };
  }

  const totalOverdueAmount = round2(totals.d30.total + totals.d60_plus.total);
  const totalOverdueCount = totals.d30.count + totals.d60_plus.count;

  return [
    { key: "current", label: "Current AR", amount: round2(totals.current.total), invoiceCount: totals.current.count },
    { key: "d30", label: "1–30 days overdue", amount: round2(totals.d30.total), invoiceCount: totals.d30.count },
    { key: "d60_plus", label: "60+ days overdue", amount: round2(totals.d60_plus.total), invoiceCount: totals.d60_plus.count },
    { key: "total_overdue", label: "Total overdue", amount: totalOverdueAmount, invoiceCount: totalOverdueCount },
  ];
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

export async function getCompanySnapshot(
  companyId: string,
  range: SnapshotRange,
  now: Date = new Date(),
): Promise<SnapshotResponse> {
  if (range !== "last_30_days") {
    throw new Error(`Unsupported snapshot range: ${range}`);
  }
  // Window math — current is a 30-day span ending now; comparisons are
  // the same span shifted back by month/quarter/year.
  const windows = buildComparisonWindows(now);
  const { current, prevMonth, prevQuarter, prevYear } = windows;

  // Run every metric concurrently. Each query is tenant-scoped + indexed.
  // Revenue / Avg Payment Days / AR 30+ come from `sharedQueries` so the
  // Financial tab and the Snapshot tab cannot disagree on them.
  const [
    revenue,
    avgPaymentDays,
    ar30Plus,
    jobsCompleted,
    avgJobInvoiceValue,
    unbillableCost,
    unbillableEntries,
    leadsCreated,
    leadConversion,
    quotesCreated,
    quoteConversion,
    arBuckets,
  ] = await Promise.all([
    evaluateScalar(windows, sharedQueries.revenue(companyId)),
    evaluateScalar(windows, sharedQueries.avgPaymentDays(companyId)),
    evaluateScalar(windows, sharedQueries.ar30PlusAtPoint(companyId)),
    evaluateScalar(windows, sharedQueries.jobsCompleted(companyId)),
    evaluateScalar(windows, sharedQueries.avgJobInvoiceValue(companyId)),
    evaluateScalar(windows, sharedQueries.unbillableCost(companyId)),
    evaluateScalar(windows, sharedQueries.unbillableEntriesWithCostRate(companyId)),
    evaluateScalar(windows, sharedQueries.leadsCreated(companyId)),
    evaluateScalar(windows, sharedQueries.leadConversionPercent(companyId)),
    evaluateScalar(windows, sharedQueries.quotesCreated(companyId)),
    evaluateScalar(windows, sharedQueries.quoteConversionPercent(companyId)),
    getCurrentARBuckets(companyId),
  ]);

  // Direct hasData rules — the server is the sole authority for these.
  // A metric with zero events across ALL four windows is structurally
  // missing for this tenant; no period gives meaningful trend signal.

  // Unbillable cost has a stricter rule: even if costs were charted,
  // any window with zero rate-bearing entries can't compute. We mark
  // hasData=false unless the CURRENT window has at least one
  // rate-bearing unbillable entry — that's what the user is looking
  // at right now.
  const unbillableHasData = unbillableEntries.current > 0;

  // Average payment days needs at least one paid invoice in current
  // window for the value to mean anything.
  const avgPaymentDaysHasData = avgPaymentDays.current > 0
    || avgPaymentDays.prevMonth > 0
    || avgPaymentDays.prevQuarter > 0
    || avgPaymentDays.prevYear > 0;

  const revenueCashFlow = {
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
        key: "avg_payment_days",
        label: "Invoice payment time",
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
        key: "ar_30_plus",
        label: "AR 30+ days",
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
    ],
  };

  const jobsOperations = {
    metrics: [
      buildMetric({
        key: "jobs_completed",
        label: "Jobs completed",
        unit: "count",
        polarity: "higher_is_better",
        scalars: {
          current: jobsCompleted.current,
          prevMonth: jobsCompleted.prevMonth,
          prevQuarter: jobsCompleted.prevQuarter,
          prevYear: jobsCompleted.prevYear,
        },
        hasData: !allZero(jobsCompleted),
      }),
      buildMetric({
        key: "avg_job_value",
        label: "Avg job invoice value",
        unit: "currency",
        polarity: "higher_is_better",
        scalars: {
          current: round2(avgJobInvoiceValue.current),
          prevMonth: round2(avgJobInvoiceValue.prevMonth),
          prevQuarter: round2(avgJobInvoiceValue.prevQuarter),
          prevYear: round2(avgJobInvoiceValue.prevYear),
        },
        hasData: !allZero(avgJobInvoiceValue),
      }),
      buildMetric({
        key: "unbillable_cost",
        label: "Unbillable time cost",
        unit: "currency",
        polarity: "lower_is_better",
        scalars: {
          current: round2(unbillableCost.current),
          prevMonth: round2(unbillableCost.prevMonth),
          prevQuarter: round2(unbillableCost.prevQuarter),
          prevYear: round2(unbillableCost.prevYear),
        },
        hasData: unbillableHasData,
      }),
    ],
  };

  const sales = {
    metrics: [
      buildMetric({
        key: "leads_created",
        label: "Leads created",
        unit: "count",
        polarity: "higher_is_better",
        scalars: {
          current: leadsCreated.current,
          prevMonth: leadsCreated.prevMonth,
          prevQuarter: leadsCreated.prevQuarter,
          prevYear: leadsCreated.prevYear,
        },
        hasData: !allZero(leadsCreated),
      }),
      buildMetric({
        key: "lead_conversion",
        label: "Lead conversion",
        unit: "percent",
        polarity: "higher_is_better",
        scalars: {
          current: Math.round(leadConversion.current * 10) / 10,
          prevMonth: Math.round(leadConversion.prevMonth * 10) / 10,
          prevQuarter: Math.round(leadConversion.prevQuarter * 10) / 10,
          prevYear: Math.round(leadConversion.prevYear * 10) / 10,
        },
        // Conversion is meaningful only when there were leads to convert.
        hasData: !allZero(leadsCreated),
      }),
      buildMetric({
        key: "quotes_created",
        label: "Quotes created",
        unit: "count",
        polarity: "higher_is_better",
        scalars: {
          current: quotesCreated.current,
          prevMonth: quotesCreated.prevMonth,
          prevQuarter: quotesCreated.prevQuarter,
          prevYear: quotesCreated.prevYear,
        },
        hasData: !allZero(quotesCreated),
      }),
      buildMetric({
        key: "quote_conversion",
        label: "Quote conversion",
        unit: "percent",
        polarity: "higher_is_better",
        scalars: {
          current: Math.round(quoteConversion.current * 10) / 10,
          prevMonth: Math.round(quoteConversion.prevMonth * 10) / 10,
          prevQuarter: Math.round(quoteConversion.prevQuarter * 10) / 10,
          prevYear: Math.round(quoteConversion.prevYear * 10) / 10,
        },
        hasData: !allZero(quotesCreated),
      }),
    ],
  };

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
    revenueCashFlow,
    jobsOperations,
    sales,
    accountsReceivable: {
      asOfISO: now.toISOString(),
      buckets: arBuckets,
    },
  };
}
