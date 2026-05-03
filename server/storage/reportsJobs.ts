/**
 * Reports — Job Performance deep-report aggregator.
 *
 * Backs `GET /api/reports/jobs`. Reuses every Operations section
 * helper that was lifted into `reportsCommon` in this pass:
 *   - `getCompletionTrendShared` — daily completion bars
 *   - `getJobStatusBreakdownShared` — current-state status mix
 *   - `getAvgJobValueTrendShared` — daily AVG(invoices.total) where job linked
 *   - `getUnbillableBreakdownShared` — cost-only by activity type
 *
 * The KPI strip routes through `sharedQueries` (Jobs Completed,
 * Avg Job Invoice Value, Unbillable Cost) — same numbers the Snapshot
 * + Operations tabs show. The "Active jobs" KPI is new and uses the
 * `sharedQueries.activeJobsAtPoint` lambda introduced in this pass.
 *
 * The only NEW computation here is the completed-jobs activity table,
 * served by `getCompletedJobsListShared`.
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
  getCompletedJobsListShared,
} from "./reportsCommon";
import type {
  CompletedJobItem,
  CompletedJobsSection,
  JobsRange,
  JobsResponse,
} from "@shared/reports/jobs";

const COMPLETED_JOBS_LIMIT = 50;

async function getCompletedJobs(
  companyId: string,
  current: { from: Date; to: Date },
): Promise<CompletedJobsSection> {
  const rows = await getCompletedJobsListShared(
    companyId,
    current,
    COMPLETED_JOBS_LIMIT,
  );
  const items: CompletedJobItem[] = rows.map((r) => ({
    eventId: r.eventId,
    jobId: r.jobId,
    jobNumber: r.jobNumber,
    summary: r.summary,
    completedAtISO: r.completedAtISO,
    clientId: r.clientId,
    clientName: r.clientName,
    locationName: r.locationName,
    invoiceId: r.invoiceId,
    invoiceNumber: r.invoiceNumber,
    invoiceTotal: r.invoiceTotal,
  }));
  return { items, hasData: items.length > 0 };
}

export async function getCompanyJobs(
  companyId: string,
  range: JobsRange,
  now: Date = new Date(),
): Promise<JobsResponse> {
  if (range !== "last_30_days") {
    throw new Error(`Unsupported jobs range: ${range}`);
  }
  const windows = buildComparisonWindows(now);
  const { current, prevMonth, prevQuarter, prevYear } = windows;

  const [
    jobsCompleted,
    avgJobInvoiceValue,
    unbillableCost,
    unbillableEntries,
    activeJobs,
    completionTrend,
    jobStatus,
    avgJobValueTrend,
    unbillableBreakdown,
    completedJobs,
  ] = await Promise.all([
    evaluateScalar(windows, sharedQueries.jobsCompleted(companyId)),
    evaluateScalar(windows, sharedQueries.avgJobInvoiceValue(companyId)),
    evaluateScalar(windows, sharedQueries.unbillableCost(companyId)),
    evaluateScalar(windows, sharedQueries.unbillableEntriesWithCostRate(companyId)),
    evaluateScalar(windows, sharedQueries.activeJobsAtPoint(companyId)),
    getCompletionTrendShared(companyId, current),
    getJobStatusBreakdownShared(companyId),
    getAvgJobValueTrendShared(companyId, current),
    getUnbillableBreakdownShared(companyId, current),
    getCompletedJobs(companyId, current),
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
      buildMetric({
        key: "active_jobs",
        label: "Active jobs",
        unit: "count",
        // Pipeline volume — more open jobs = more work in flight.
        polarity: "higher_is_better",
        scalars: {
          current: activeJobs.current,
          prevMonth: activeJobs.prevMonth,
          prevQuarter: activeJobs.prevQuarter,
          prevYear: activeJobs.prevYear,
        },
        hasData: !allZero(activeJobs),
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
    completionTrend,
    jobStatus,
    avgJobValueTrend,
    unbillableBreakdown,
    completedJobs,
  };
}
