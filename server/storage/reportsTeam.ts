/**
 * Reports — Team Performance deep-report aggregator.
 *
 * Backs `GET /api/reports/team`. Pure orchestrator — every SQL hit
 * lives in `reportsCommon.ts`. The aggregator's only job is window
 * math + section-shape assembly.
 *
 * Attribution is deliberately conservative:
 *   - Per-user hours / unbillable cost: keyed on the FK-clean
 *     `time_entries.technicianId`.
 *   - Jobs completed / avg invoice value: keyed on
 *     `job_status_events.changedBy` (rows with null `changedBy`
 *     drop out — system-written transitions aren't credited).
 *
 * Multi-tech `job_visits.assignedTechnicianIds` is NOT used. Per
 * spec: "If attribution is unclear → hasData=false."
 */

import {
  buildComparisonWindows,
  evaluateScalar,
  buildMetric,
  round2,
  allZero,
  sharedQueries,
  getHoursByUserShared,
  getUnbillableByUserShared,
  getJobsCompletedByUserShared,
} from "./reportsCommon";
import type {
  HoursByUserSection,
  JobsByUserSection,
  TeamRange,
  TeamResponse,
  TimeDistributionSection,
  UnbillableByUserSection,
} from "@shared/reports/team";

export async function getCompanyTeam(
  companyId: string,
  range: TeamRange,
  now: Date = new Date(),
): Promise<TeamResponse> {
  if (range !== "last_30_days") {
    throw new Error(`Unsupported team range: ${range}`);
  }
  const windows = buildComparisonWindows(now);
  const { current, prevMonth, prevQuarter, prevYear } = windows;

  const [
    totalHoursWorked,
    totalBillableHours,
    totalUnbillableHours,
    unbillableCost,
    unbillableEntries,
    hoursByUserRows,
    unbillableByUserRows,
    jobsByUserRows,
  ] = await Promise.all([
    evaluateScalar(windows, sharedQueries.totalHoursWorked(companyId)),
    evaluateScalar(windows, sharedQueries.totalBillableHours(companyId)),
    evaluateScalar(windows, sharedQueries.totalUnbillableHours(companyId)),
    evaluateScalar(windows, sharedQueries.unbillableCost(companyId)),
    evaluateScalar(windows, sharedQueries.unbillableEntriesWithCostRate(companyId)),
    getHoursByUserShared(companyId, current),
    getUnbillableByUserShared(companyId, current),
    getJobsCompletedByUserShared(companyId, current),
  ]);

  // Section-shape assembly — wrap the row arrays in the contract's
  // `{ items, hasData }` shape with consistent rules:
  //   - hours/unbillable: hasData = at least one user row.
  //   - jobs: hasData = at least one user with a completion event
  //     attributed via changedBy. When nobody is credited, the
  //     section renders the empty state — per spec: "If attribution
  //     is unclear → hasData=false".
  const hoursByUser: HoursByUserSection = {
    items: hoursByUserRows,
    hasData: hoursByUserRows.length > 0,
  };
  const unbillableByUser: UnbillableByUserSection = {
    items: unbillableByUserRows,
    hasData: unbillableByUserRows.length > 0,
  };
  const jobsByUser: JobsByUserSection = {
    items: jobsByUserRows,
    hasData: jobsByUserRows.length > 0,
  };

  // Time distribution derives from the already-evaluated globals —
  // no extra query. `hasData` flips false when no time was logged in
  // window so the UI renders an empty state instead of "0% / 0%".
  const distHasData = totalHoursWorked.current > 0;
  const distBillable = distHasData
    ? Math.round((totalBillableHours.current / totalHoursWorked.current) * 1000) / 10
    : 0;
  const distUnbillable = distHasData
    ? Math.round((totalUnbillableHours.current / totalHoursWorked.current) * 1000) / 10
    : 0;
  const timeDistribution: TimeDistributionSection = {
    totalHours: round2(totalHoursWorked.current),
    billableHours: round2(totalBillableHours.current),
    unbillableHours: round2(totalUnbillableHours.current),
    billablePercent: distBillable,
    unbillablePercent: distUnbillable,
    hasData: distHasData,
  };

  // Unbillable cost is meaningful only when at least one rate-bearing
  // entry exists in the current window. Same rule the Snapshot tab
  // uses — keeps the Team KPI consistent with the global metric.
  const unbillableHasData = unbillableEntries.current > 0;

  const kpis = {
    metrics: [
      buildMetric({
        key: "total_hours",
        label: "Total hours worked",
        unit: "hours",
        polarity: "higher_is_better",
        scalars: {
          current: round2(totalHoursWorked.current),
          prevMonth: round2(totalHoursWorked.prevMonth),
          prevQuarter: round2(totalHoursWorked.prevQuarter),
          prevYear: round2(totalHoursWorked.prevYear),
        },
        hasData: !allZero(totalHoursWorked),
      }),
      buildMetric({
        key: "billable_hours",
        label: "Billable hours",
        unit: "hours",
        polarity: "higher_is_better",
        scalars: {
          current: round2(totalBillableHours.current),
          prevMonth: round2(totalBillableHours.prevMonth),
          prevQuarter: round2(totalBillableHours.prevQuarter),
          prevYear: round2(totalBillableHours.prevYear),
        },
        hasData: !allZero(totalBillableHours),
      }),
      buildMetric({
        key: "unbillable_hours",
        label: "Unbillable hours",
        unit: "hours",
        polarity: "lower_is_better",
        scalars: {
          current: round2(totalUnbillableHours.current),
          prevMonth: round2(totalUnbillableHours.prevMonth),
          prevQuarter: round2(totalUnbillableHours.prevQuarter),
          prevYear: round2(totalUnbillableHours.prevYear),
        },
        hasData: !allZero(totalUnbillableHours),
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
    hoursByUser,
    unbillableByUser,
    jobsByUser,
    timeDistribution,
  };
}
