/**
 * Reports — Team Performance deep-report canonical contract.
 *
 * One source of truth for the GET /api/reports/team response shape.
 *
 * Sections (in spec order):
 *   1. KPI strip — Total hours · Billable hours · Unbillable hours ·
 *      Unbillable cost. Each gates on `hasData` so tenants without
 *      time-tracking data see empty states instead of fabricated
 *      zeros.
 *   2. Hours by team member — per-user totals over the current window.
 *   3. Unbillable cost by team member — per-user breakdown of the
 *      same cost calculation the Snapshot/Operations tabs use, just
 *      attributed via `time_entries.technicianId`.
 *   4. Jobs completed by team member — attributed via
 *      `job_status_events.changedBy`. Includes avg primary-invoice
 *      total when the user has any invoiced jobs in window.
 *   5. Time distribution — billable vs unbillable share, derived
 *      from the global hour scalars (no extra query).
 *
 * Every section carries `hasData`. The Job Performance / Avg Job
 * Value attribution requires a clean user→job link — when the
 * canonical signal (`job_status_events.changedBy`) is absent, the
 * section's `hasData` flips false and the UI renders an empty
 * state.
 */

import type { MetricCard, SnapshotRange } from "./snapshot";

export type TeamRange = SnapshotRange;

export interface HoursByUserItem {
  userId: string;
  name: string;
  totalHours: number;
  billableHours: number;
  unbillableHours: number;
  entryCount: number;
}

export interface HoursByUserSection {
  /** Sorted desc by `totalHours` server-side. */
  items: HoursByUserItem[];
  hasData: boolean;
}

export interface UnbillableByUserItem {
  userId: string;
  name: string;
  cost: number;
  hours: number;
  entryCount: number;
}

export interface UnbillableByUserSection {
  /** Sorted desc by `cost` server-side. */
  items: UnbillableByUserItem[];
  hasData: boolean;
}

export interface JobsByUserItem {
  userId: string;
  name: string;
  /** Count of `to_status='completed'` events the user wrote. */
  completedCount: number;
  /** Average primary-invoice total for jobs they completed. Null
   *  when none of their jobs have linked invoices. */
  avgInvoiceTotal: number | null;
  /** Count of completed jobs that had a linked invoice — drives the
   *  `avgInvoiceTotal` denominator. */
  invoicedCount: number;
}

export interface JobsByUserSection {
  /** Sorted desc by `completedCount` server-side. */
  items: JobsByUserItem[];
  hasData: boolean;
}

export interface TimeDistributionSection {
  totalHours: number;
  billableHours: number;
  unbillableHours: number;
  /** Share of total hours that were billable, 0–100, rounded to 1dp. */
  billablePercent: number;
  /** Share of total hours that were unbillable, 0–100, rounded to 1dp. */
  unbillablePercent: number;
  hasData: boolean;
}

export interface TeamResponse {
  range: TeamRange;
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
   *   - Total hours worked     (`higher_is_better` — pipeline volume)
   *   - Billable hours         (`higher_is_better`)
   *   - Unbillable hours       (`lower_is_better`)
   *   - Unbillable cost        (`lower_is_better`)
   */
  kpis: { metrics: MetricCard[] };
  hoursByUser: HoursByUserSection;
  unbillableByUser: UnbillableByUserSection;
  jobsByUser: JobsByUserSection;
  timeDistribution: TimeDistributionSection;
}

export type { MetricCard };
