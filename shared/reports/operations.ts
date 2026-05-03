/**
 * Reports — Operations tab canonical contract.
 *
 * One source of truth for the GET /api/reports/operations response shape.
 * Both server and client import from here so the JSON shape stays in
 * lockstep.
 *
 * Sections (in spec order): KPI strip, Job Completion Trend, Job Status
 * Breakdown, Avg Job Value Trend, Unbillable Time Breakdown.
 *
 * Every section carries `hasData`. UI MUST render an empty state when
 * false rather than fabricating zero/placeholder rows.
 */

import type { MetricCard, SnapshotRange } from "./snapshot";

export type OperationsRange = SnapshotRange;

/** Daily bucket of the trend sections — one point per `YYYY-MM-DD`. */
export interface JobCompletionTrendPoint {
  /** Window start of the bucket (company-local-equivalent date). */
  date: string;
  /** Number of `to_status='completed'` events in the bucket. */
  count: number;
}

export interface JobCompletionTrendSection {
  bucket: "daily";
  points: JobCompletionTrendPoint[];
  hasData: boolean;
}

/**
 * Status breakdown item. Keys mirror `jobStatusEnum` in
 * `shared/schema.ts:2068` — "open" / "completed" / "invoiced" /
 * "archived". The spec mentioned `scheduled` and `cancelled` as
 * possible buckets, but neither exists as a real `jobs.status` value.
 * Per the spec rule "use actual job.status / do not infer missing
 * states", those are NOT fabricated — only real statuses appear.
 */
export type JobStatusKey = "open" | "completed" | "invoiced" | "archived";

export interface JobStatusBreakdownItem {
  key: JobStatusKey;
  label: string;
  count: number;
  /** Share of all (active) jobs, 0–100, rounded to 1 decimal. */
  percentOfTotal: number;
}

export interface JobStatusBreakdownSection {
  items: JobStatusBreakdownItem[];
  totalCount: number;
  hasData: boolean;
}

/** One bucket of the Avg Job Invoice Value trend. The bucket value is
 *  the AVG of `invoices.total` for invoices issued that day with
 *  `jobId IS NOT NULL`. Same definition as the Snapshot tab's
 *  `avg_job_value` metric, just bucketed daily. */
export interface AvgJobValuePoint {
  date: string;
  avgValue: number;
  invoiceCount: number;
}

export interface AvgJobValueTrendSection {
  bucket: "daily";
  points: AvgJobValuePoint[];
  hasData: boolean;
}

/**
 * One row of the unbillable-time breakdown. Items are grouped by
 * `time_entries.type` (the canonical `timeEntryTypeEnum`). Entries
 * without a `costRateSnapshot` are excluded entirely — their cost is
 * unfabricable.
 */
export interface UnbillableBreakdownItem {
  /** `time_entries.type` value, e.g. `admin` / `break` / `travel_*`. */
  type: string;
  /** Human-readable label. Server-emitted so copy stays canonical. */
  label: string;
  /** Total cost in window: SUM(durationMinutes/60 * costRateSnapshot). */
  cost: number;
  hours: number;
  count: number;
  /** Share of section total cost, 0–100, rounded to 1 decimal. */
  percentOfTotal: number;
}

export interface UnbillableBreakdownSection {
  items: UnbillableBreakdownItem[];
  totalCost: number;
  totalHours: number;
  totalCount: number;
  hasData: boolean;
}

export interface OperationsResponse {
  range: OperationsRange;
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
   * Top KPI strip — 3 metrics in spec order:
   * Jobs completed · Avg job invoice value · Unbillable time cost.
   * Same definitions as the Snapshot tab's Jobs & Operations section
   * (the underlying SQL lambdas are imported from `reportsCommon`).
   */
  kpis: { metrics: MetricCard[] };
  completionTrend: JobCompletionTrendSection;
  jobStatus: JobStatusBreakdownSection;
  avgJobValueTrend: AvgJobValueTrendSection;
  unbillableBreakdown: UnbillableBreakdownSection;
}

export type { MetricCard };
