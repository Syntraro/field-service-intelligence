/**
 * Reports — Operations tab aggregator.
 *
 * Drill-down for job performance and efficiency. Reuses the Snapshot
 * tab's shared query primitives (`reportsCommon.ts::sharedQueries`)
 * for the KPI strip — Jobs completed, Avg Job Invoice Value, and
 * Unbillable Time Cost are exactly the same queries the Snapshot tab
 * uses, so the two tabs cannot disagree on those numbers.
 *
 * Real data only — every section computes from real persisted tables
 * (`jobs`, `job_status_events`, `invoices`, `time_entries`). Sections
 * that can't compute set `hasData: false` and the UI renders an
 * empty state.
 */

import {
  buildComparisonWindows,
  evaluateScalar,
  buildMetric,
  round2,
  allZero,
  sharedQueries,
  getCompletionTrendShared,
  getJobStatusBreakdownShared,
  getAvgJobValueTrendShared,
  getUnbillableBreakdownShared,
} from "./reportsCommon";
import type {
  OperationsRange,
  OperationsResponse,
} from "@shared/reports/operations";

// ---------------------------------------------------------------------------
// 2026-05-03: every section helper is now a thin wrapper around
// `reportsCommon.get*Shared`. Operations tab output is byte-for-byte
// unchanged — the queries were lifted so the Job Performance
// deep-report at `/reports/jobs` can consume them too.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function getCompanyOperations(
  companyId: string,
  range: OperationsRange,
  now: Date = new Date(),
): Promise<OperationsResponse> {
  if (range !== "last_30_days") {
    throw new Error(`Unsupported operations range: ${range}`);
  }
  const windows = buildComparisonWindows(now);
  const { current, prevMonth, prevQuarter, prevYear } = windows;

  const [
    jobsCompleted,
    avgJobInvoiceValue,
    unbillableCost,
    unbillableEntries,
    completionTrend,
    jobStatus,
    avgJobValueTrend,
    unbillableBreakdown,
  ] = await Promise.all([
    evaluateScalar(windows, sharedQueries.jobsCompleted(companyId)),
    evaluateScalar(windows, sharedQueries.avgJobInvoiceValue(companyId)),
    evaluateScalar(windows, sharedQueries.unbillableCost(companyId)),
    evaluateScalar(windows, sharedQueries.unbillableEntriesWithCostRate(companyId)),
    getCompletionTrendShared(companyId, current),
    getJobStatusBreakdownShared(companyId),
    getAvgJobValueTrendShared(companyId, current),
    getUnbillableBreakdownShared(companyId, current),
  ]);

  // Unbillable cost is meaningful only when at least one rate-bearing
  // entry exists in the current window. Same rule the Snapshot tab uses.
  const unbillableHasData = unbillableEntries.current > 0;

  const kpis = {
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
    completionTrend,
    jobStatus,
    avgJobValueTrend,
    unbillableBreakdown,
  };
}
