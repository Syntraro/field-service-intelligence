/**
 * Reports — Job Performance deep-report canonical contract.
 *
 * One source of truth for the GET /api/reports/jobs response shape.
 *
 * Sections (in spec order):
 *   1. KPI strip — Jobs completed · Avg job invoice value ·
 *      Unbillable time cost · Active/open jobs.
 *   2. Job completion trend (daily; reuses Operations helper).
 *   3. Job status breakdown (reuses Operations helper).
 *   4. Avg job value trend (reuses Operations helper; invoice-based).
 *   5. Unbillable time breakdown (reuses Operations helper).
 *   6. Completed jobs activity table.
 *
 * Every section carries `hasData`. UI MUST render an empty state when
 * false. The contract reuses the Operations response section types so
 * the two surfaces consume identical shapes.
 */

import type {
  AvgJobValueTrendSection,
  JobCompletionTrendSection,
  JobStatusBreakdownSection,
  UnbillableBreakdownSection,
} from "./operations";
import type { MetricCard, SnapshotRange } from "./snapshot";

export type JobsRange = SnapshotRange;

export interface CompletedJobItem {
  /** `job_status_events.id` — distinct per completion transition. A
   *  job re-completed twice in window appears as two rows here, which
   *  matches the Jobs Completed KPI count. */
  eventId: string;
  /** Job identity. Stable across re-completions. */
  jobId: string;
  jobNumber: number;
  summary: string;
  /** ISO instant of the `to_status='completed'` transition. */
  completedAtISO: string;
  clientId: string;
  clientName: string;
  /** Free-form location label (e.g. "Main office"); null when the
   *  client_location row has no name set. */
  locationName: string | null;
  /** Primary invoice's id when one is linked via `jobs.invoiceId`.
   *  Null when the job has no invoice yet. */
  invoiceId: string | null;
  invoiceNumber: string | null;
  /** Primary invoice total. Null when no invoice is linked. */
  invoiceTotal: number | null;
}

export interface CompletedJobsSection {
  items: CompletedJobItem[];
  hasData: boolean;
}

export interface JobsResponse {
  range: JobsRange;
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
   * 4 KPIs in spec order:
   *   - Jobs completed         (`higher_is_better`)
   *   - Avg job invoice value  (`higher_is_better`)
   *   - Unbillable time cost   (`lower_is_better`)
   *   - Active jobs            (neutral; tracked as `higher_is_better`
   *                              — pipeline volume up = good)
   */
  kpis: { metrics: MetricCard[] };
  completionTrend: JobCompletionTrendSection;
  jobStatus: JobStatusBreakdownSection;
  avgJobValueTrend: AvgJobValueTrendSection;
  unbillableBreakdown: UnbillableBreakdownSection;
  completedJobs: CompletedJobsSection;
}

export type {
  AvgJobValueTrendSection,
  JobCompletionTrendSection,
  JobStatusBreakdownSection,
  MetricCard,
  UnbillableBreakdownSection,
};
