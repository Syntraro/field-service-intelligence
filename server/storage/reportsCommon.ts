/**
 * Shared primitives for the Reports aggregators.
 *
 * Both `reportsSnapshot.ts` (the Snapshot tab) and `reportsFinancial.ts`
 * (the Financial tab) build their responses out of:
 *
 *   - A 4-window comparison structure (current / prevMonth / prevQuarter /
 *     prevYear), each window the same span as `current`, shifted back
 *     by 30 / 90 / 365 days so percent-change is a like-for-like metric.
 *   - Per-metric query lambdas that take a window and return one scalar.
 *   - `buildMetric` to assemble a `MetricCard` from per-window scalars
 *     with consistent `hasData` and null-safe percent-change rules.
 *
 * Extracting these helpers lets the Financial tab reuse the Revenue,
 * Avg Payment Days, and AR-30+ queries the Snapshot tab already
 * defined — no duplicate logic, no risk of the two tabs diverging.
 *
 * The Financial aggregator adds its own queries (payments-collected
 * count, total outstanding AR, etc.) but routes them through the
 * SAME `evaluateScalar` + `buildMetric` plumbing.
 */

import { and, asc, desc, eq, gte, lt, ne, sql, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  invoices,
  payments,
  jobs,
  jobStatusEvents,
  jobVisits,
  timeEntries,
  timeEntryTypeEnum,
  leads,
  quotes,
  leadStatusEnum,
  quoteStatusEnum,
  clientLocations,
  customerCompanies,
  users,
  items,
  locationPMPartTemplates,
} from "@shared/schema";
import { UNPAID_INVOICE_STATUSES } from "@shared/invoiceStatus";
import { locationDisplayNameExpr } from "../lib/queryHelpers";
import type { MetricCard, MetricPolarity, MetricUnit } from "@shared/reports/snapshot";
import type {
  PaymentBreakdownItem,
  PaymentBreakdownSection,
  RevenueTrendPoint,
  RevenueTrendSection,
} from "@shared/reports/financial";
import type {
  AvgJobValuePoint,
  AvgJobValueTrendSection,
  JobCompletionTrendPoint,
  JobCompletionTrendSection,
  JobStatusBreakdownItem,
  JobStatusBreakdownSection,
  JobStatusKey,
  UnbillableBreakdownItem,
  UnbillableBreakdownSection,
} from "@shared/reports/operations";
import type {
  LeadStatusBreakdownItem,
  LeadStatusBreakdownSection,
  LeadStatusKey,
  QuoteStatusBreakdownItem,
  QuoteStatusBreakdownSection,
  QuoteStatusKey,
  SalesConversionTrendPoint,
  SalesConversionTrendSection,
  SalesCountTrendPoint,
  SalesCountTrendSection,
} from "@shared/reports/sales";
import type {
  MissingPartsItem,
  PartsByLocationVisitItem,
  PartsNeededItem,
} from "@shared/reports/partsForecast";

export const DAY_MS = 86_400_000;

export interface Window {
  from: Date;
  to: Date;
}

export interface ComparisonWindows {
  current: Window;
  prevMonth: Window;
  prevQuarter: Window;
  prevYear: Window;
}

export function shiftWindow(base: Window, offsetDays: number): Window {
  return {
    from: new Date(base.from.getTime() - offsetDays * DAY_MS),
    to: new Date(base.to.getTime() - offsetDays * DAY_MS),
  };
}

/** Build the canonical 4-window comparison set for "Last 30 days" semantics.
 *  All four windows are 30-day spans; the comparisons are shifted back by
 *  one month / one quarter / one year. */
export function buildComparisonWindows(now: Date): ComparisonWindows {
  const current: Window = { from: new Date(now.getTime() - 30 * DAY_MS), to: now };
  return {
    current,
    prevMonth: shiftWindow(current, 30),
    prevQuarter: shiftWindow(current, 90),
    prevYear: shiftWindow(current, 365),
  };
}

/** Scalar evaluator: caller passes the same query-builder lambda four
 *  times against four windows so each metric definition lives in ONE
 *  place. Returns numeric values (NaN-safe — falls back to 0). */
export async function evaluateScalar(
  windows: ComparisonWindows,
  query: (w: Window) => Promise<number>,
): Promise<{ current: number; prevMonth: number; prevQuarter: number; prevYear: number }> {
  const [current, prevMonth, prevQuarter, prevYear] = await Promise.all([
    query(windows.current),
    query(windows.prevMonth),
    query(windows.prevQuarter),
    query(windows.prevYear),
  ]);
  return {
    current: Number.isFinite(current) ? current : 0,
    prevMonth: Number.isFinite(prevMonth) ? prevMonth : 0,
    prevQuarter: Number.isFinite(prevQuarter) ? prevQuarter : 0,
    prevYear: Number.isFinite(prevYear) ? prevYear : 0,
  };
}

export type WindowedScalars = {
  current: number;
  prevMonth: number;
  prevQuarter: number;
  prevYear: number;
};

/** Percent change from prev → current. Null when prev is zero (the
 *  ratio is undefined) so the UI renders "—" instead of fabricating
 *  a number. Rounded to 1 decimal so the JSON stays compact. */
export function percentChange(current: number, prev: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(prev)) return null;
  if (prev === 0) return null;
  const raw = ((current - prev) / Math.abs(prev)) * 100;
  if (!Number.isFinite(raw)) return null;
  return Math.round(raw * 10) / 10;
}

/** Build a canonical MetricCard from per-window scalars. `hasData` is
 *  true unless the metric is structurally absent (caller passes false —
 *  e.g. no time_entries carry cost rates). When false, every value
 *  field is nulled so the UI MUST render an empty state. */
export function buildMetric(opts: {
  key: string;
  label: string;
  unit: MetricUnit;
  polarity: MetricPolarity;
  scalars: {
    current: number | null;
    prevMonth: number | null;
    prevQuarter: number | null;
    prevYear: number | null;
  };
  hasData: boolean;
}): MetricCard {
  const { scalars, hasData } = opts;
  const current = scalars.current;
  return {
    key: opts.key,
    label: opts.label,
    unit: opts.unit,
    polarity: opts.polarity,
    currentValue: hasData ? current : null,
    previousMonthValue: hasData ? scalars.prevMonth : null,
    previousQuarterValue: hasData ? scalars.prevQuarter : null,
    previousYearValue: hasData ? scalars.prevYear : null,
    monthChangePercent:
      hasData && current != null && scalars.prevMonth != null
        ? percentChange(current, scalars.prevMonth)
        : null,
    quarterChangePercent:
      hasData && current != null && scalars.prevQuarter != null
        ? percentChange(current, scalars.prevQuarter)
        : null,
    yearChangePercent:
      hasData && current != null && scalars.prevYear != null
        ? percentChange(current, scalars.prevYear)
        : null,
    hasData,
  };
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** True when every window scalar is exactly 0. Signals the metric is
 *  structurally missing for this tenant (no period gives any signal). */
export function allZero(s: WindowedScalars): boolean {
  return (
    s.current === 0 && s.prevMonth === 0 && s.prevQuarter === 0 && s.prevYear === 0
  );
}

// ---------------------------------------------------------------------------
// Shared section helpers
// ---------------------------------------------------------------------------

/** One row of the "top outstanding clients" report — used by the
 *  Financial tab and the AR deep-report page. Same shape so both
 *  surfaces consume the same renderer-friendly payload. */
export interface TopOutstandingClientRow {
  clientId: string;
  name: string;
  totalOutstanding: number;
  invoiceCount: number;
}

/** Top N client locations by sum of unpaid invoice balance. Reused by
 *  the Financial tab and the AR deep-report page so the two surfaces
 *  cannot diverge on the definition. Uses the canonical
 *  `locationDisplayNameExpr` so client names match the rest of the app. */
export async function getTopOutstandingClientsShared(
  companyId: string,
  limit: number,
): Promise<TopOutstandingClientRow[]> {
  const rows = await db
    .select({
      clientId: clientLocations.id,
      name: locationDisplayNameExpr,
      totalOutstanding: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)), 0)::text`,
      invoiceCount: sql<number>`COUNT(*)::int`,
    })
    .from(invoices)
    .innerJoin(clientLocations, eq(invoices.locationId, clientLocations.id))
    .leftJoin(
      customerCompanies,
      eq(clientLocations.parentCompanyId, customerCompanies.id),
    )
    .where(
      and(
        eq(invoices.companyId, companyId),
        inArray(invoices.status, UNPAID_INVOICE_STATUSES),
        sql`CAST(${invoices.balance} AS numeric) > 0`,
      ),
    )
    .groupBy(
      clientLocations.id,
      customerCompanies.name,
      clientLocations.companyName,
      clientLocations.address,
      clientLocations.city,
      clientLocations.province,
    )
    .orderBy(desc(sql`SUM(CAST(${invoices.balance} AS numeric))`))
    .limit(limit);

  return rows.map((r) => ({
    clientId: r.clientId,
    name: r.name ?? "Unnamed Location",
    totalOutstanding: round2(parseFloat(r.totalOutstanding ?? "0")),
    invoiceCount: Number(r.invoiceCount ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// Cash-basis revenue trend (daily buckets). Lifted from
// `reportsFinancial.ts` so the Revenue deep-report can reuse the exact
// same query as the Financial tab. Both surfaces show the SAME daily
// revenue numbers — drift between them is now structurally impossible.
// ---------------------------------------------------------------------------

export async function getRevenueTrendShared(
  companyId: string,
  current: Window,
): Promise<RevenueTrendSection> {
  const rows = await db
    .select({
      date: sql<string>`to_char(${payments.receivedAt}::date, 'YYYY-MM-DD')`,
      amount: sql<string>`COALESCE(SUM(CAST(${payments.amount} AS numeric)), 0)::text`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(payments)
    .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
    .where(
      and(
        eq(invoices.companyId, companyId),
        eq(payments.paymentType, "payment"),
        ne(invoices.status, "voided"),
        gte(payments.receivedAt, current.from),
        lt(payments.receivedAt, current.to),
      ),
    )
    .groupBy(sql`${payments.receivedAt}::date`)
    .orderBy(sql`${payments.receivedAt}::date`);

  const points: RevenueTrendPoint[] = rows.map((r) => ({
    date: r.date,
    amount: round2(parseFloat(r.amount ?? "0")),
    count: Number(r.count ?? 0),
  }));

  return {
    bucket: "daily",
    points,
    hasData: points.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Cash-basis payment-method breakdown. Lifted from `reportsFinancial.ts`
// so the Revenue deep-report consumes the same canonical normalization
// (unknown methods → "other") + sort + percent math.
// ---------------------------------------------------------------------------

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  credit: "Credit card",
  debit: "Debit card",
  "e-transfer": "E-transfer",
  cheque: "Cheque",
  other: "Other",
};
const KNOWN_PAYMENT_METHODS = new Set(Object.keys(PAYMENT_METHOD_LABELS));

export async function getPaymentBreakdownShared(
  companyId: string,
  current: Window,
): Promise<PaymentBreakdownSection> {
  const rows = await db
    .select({
      method: payments.method,
      total: sql<string>`COALESCE(SUM(CAST(${payments.amount} AS numeric)), 0)::text`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(payments)
    .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
    .where(
      and(
        eq(invoices.companyId, companyId),
        eq(payments.paymentType, "payment"),
        ne(invoices.status, "voided"),
        gte(payments.receivedAt, current.from),
        lt(payments.receivedAt, current.to),
      ),
    )
    .groupBy(payments.method);

  // Normalize: anything outside the canonical set folds into "other".
  // Multiple rows can collapse into one entry — re-aggregate.
  const acc: Record<string, { amount: number; count: number }> = {};
  let totalAmount = 0;
  let totalCount = 0;
  for (const r of rows) {
    const raw = (r.method ?? "other").toLowerCase();
    const key = KNOWN_PAYMENT_METHODS.has(raw) ? raw : "other";
    const amount = parseFloat(r.total ?? "0");
    const count = Number(r.count ?? 0);
    if (!acc[key]) acc[key] = { amount: 0, count: 0 };
    acc[key].amount += amount;
    acc[key].count += count;
    totalAmount += amount;
    totalCount += count;
  }

  const items: PaymentBreakdownItem[] = Object.entries(acc)
    .map(([method, v]) => ({
      method,
      label: PAYMENT_METHOD_LABELS[method] ?? "Other",
      totalAmount: round2(v.amount),
      percentOfTotal:
        totalAmount > 0 ? Math.round((v.amount / totalAmount) * 1000) / 10 : 0,
      count: v.count,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);

  return {
    items,
    totalAmount: round2(totalAmount),
    totalCount,
    hasData: items.length > 0 && totalAmount > 0,
  };
}

// ---------------------------------------------------------------------------
// Revenue by client (top N) — cash basis. Groups payments by the
// invoice's `locationId`, so each row represents one client location's
// share of the revenue. Sorts desc by amount and caps at `limit`.
// ---------------------------------------------------------------------------

export interface RevenueByClientRow {
  clientId: string;
  name: string;
  totalRevenue: number;
  paymentCount: number;
}

export async function getRevenueByClientShared(
  companyId: string,
  current: Window,
  limit: number,
): Promise<RevenueByClientRow[]> {
  const rows = await db
    .select({
      clientId: clientLocations.id,
      name: locationDisplayNameExpr,
      totalRevenue: sql<string>`COALESCE(SUM(CAST(${payments.amount} AS numeric)), 0)::text`,
      paymentCount: sql<number>`COUNT(*)::int`,
    })
    .from(payments)
    .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
    .innerJoin(clientLocations, eq(invoices.locationId, clientLocations.id))
    .leftJoin(
      customerCompanies,
      eq(clientLocations.parentCompanyId, customerCompanies.id),
    )
    .where(
      and(
        eq(invoices.companyId, companyId),
        eq(payments.paymentType, "payment"),
        ne(invoices.status, "voided"),
        gte(payments.receivedAt, current.from),
        lt(payments.receivedAt, current.to),
      ),
    )
    .groupBy(
      clientLocations.id,
      customerCompanies.name,
      clientLocations.companyName,
      clientLocations.address,
      clientLocations.city,
      clientLocations.province,
    )
    .orderBy(desc(sql`SUM(CAST(${payments.amount} AS numeric))`))
    .limit(limit);

  return rows.map((r) => ({
    clientId: r.clientId,
    name: r.name ?? "Unnamed Location",
    totalRevenue: round2(parseFloat(r.totalRevenue ?? "0")),
    paymentCount: Number(r.paymentCount ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// Recently received payments — denormalized rows for the Revenue page's
// activity table. Sorted desc by `receivedAt` (newest first), capped at
// `limit`. Includes invoice number + client display name so the table
// row is renderable without additional fetches.
// ---------------------------------------------------------------------------

export interface RecentPaymentRow {
  id: string;
  receivedAtISO: string;
  amount: number;
  method: string;
  methodLabel: string;
  invoiceId: string;
  invoiceNumber: string | null;
  clientId: string;
  clientName: string;
}

export async function getRecentPaymentsShared(
  companyId: string,
  current: Window,
  limit: number,
): Promise<RecentPaymentRow[]> {
  const rows = await db
    .select({
      id: payments.id,
      receivedAt: payments.receivedAt,
      amount: payments.amount,
      method: payments.method,
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      clientId: clientLocations.id,
      clientName: locationDisplayNameExpr,
    })
    .from(payments)
    .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
    .innerJoin(clientLocations, eq(invoices.locationId, clientLocations.id))
    .leftJoin(
      customerCompanies,
      eq(clientLocations.parentCompanyId, customerCompanies.id),
    )
    .where(
      and(
        eq(invoices.companyId, companyId),
        eq(payments.paymentType, "payment"),
        ne(invoices.status, "voided"),
        gte(payments.receivedAt, current.from),
        lt(payments.receivedAt, current.to),
      ),
    )
    .orderBy(desc(payments.receivedAt))
    .limit(limit);

  return rows.map((r) => {
    const rawMethod = (r.method ?? "other").toLowerCase();
    const method = KNOWN_PAYMENT_METHODS.has(rawMethod) ? rawMethod : "other";
    return {
      id: r.id,
      receivedAtISO: (r.receivedAt as Date).toISOString(),
      amount: round2(parseFloat(String(r.amount ?? "0"))),
      method,
      methodLabel: PAYMENT_METHOD_LABELS[method] ?? "Other",
      invoiceId: r.invoiceId,
      invoiceNumber: r.invoiceNumber,
      clientId: r.clientId,
      clientName: r.clientName ?? "Unnamed Location",
    };
  });
}

// ---------------------------------------------------------------------------
// Operations section helpers — completion trend, job status breakdown,
// avg job value trend, unbillable breakdown. Lifted from
// `reportsOperations.ts` so the Job Performance deep-report at
// `/reports/jobs` can reuse the EXACT same queries. Operations tab
// behavior is unchanged — its aggregator now calls these helpers.
// ---------------------------------------------------------------------------

export async function getCompletionTrendShared(
  companyId: string,
  current: Window,
): Promise<JobCompletionTrendSection> {
  const rows = await db
    .select({
      date: sql<string>`to_char(${jobStatusEvents.changedAt}::date, 'YYYY-MM-DD')`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(jobStatusEvents)
    .where(
      and(
        eq(jobStatusEvents.companyId, companyId),
        eq(jobStatusEvents.toStatus, "completed"),
        gte(jobStatusEvents.changedAt, current.from),
        lt(jobStatusEvents.changedAt, current.to),
      ),
    )
    .groupBy(sql`${jobStatusEvents.changedAt}::date`)
    .orderBy(sql`${jobStatusEvents.changedAt}::date`);

  const points: JobCompletionTrendPoint[] = rows.map((r) => ({
    date: r.date,
    count: Number(r.count ?? 0),
  }));
  return { bucket: "daily", points, hasData: points.length > 0 };
}

const JOB_STATUS_LABELS: Record<JobStatusKey, string> = {
  open: "Open",
  completed: "Completed",
  invoiced: "Invoiced",
  archived: "Archived",
};

export async function getJobStatusBreakdownShared(
  companyId: string,
): Promise<JobStatusBreakdownSection> {
  const rows = await db
    .select({
      status: jobs.status,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.companyId, companyId),
        // Soft-deleted rows are not active jobs — exclude them.
        isNull(jobs.deletedAt),
      ),
    )
    .groupBy(jobs.status);

  const totals: Record<JobStatusKey, number> = {
    open: 0,
    completed: 0,
    invoiced: 0,
    archived: 0,
  };
  let totalCount = 0;
  for (const r of rows) {
    const key = r.status as JobStatusKey;
    if (!(key in totals)) continue;
    totals[key] = Number(r.count ?? 0);
    totalCount += totals[key];
  }

  const items: JobStatusBreakdownItem[] = (Object.keys(totals) as JobStatusKey[])
    .map((key) => ({
      key,
      label: JOB_STATUS_LABELS[key],
      count: totals[key],
      percentOfTotal:
        totalCount > 0 ? Math.round((totals[key] / totalCount) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return { items, totalCount, hasData: totalCount > 0 };
}

export async function getAvgJobValueTrendShared(
  companyId: string,
  current: Window,
): Promise<AvgJobValueTrendSection> {
  // 2026-05-03 audit fix: per-JOB average, not per-invoice. Multi-
  // invoice jobs (e.g. progress billing) used to inflate the
  // denominator; the new math collapses them onto a single job
  // contribution per day. `invoiceCount` continues to expose the
  // count-of-invoices that day (separate from the AVG denominator)
  // as informational metadata.
  const rows = await db
    .select({
      date: sql<string>`to_char(${invoices.issueDate}::date, 'YYYY-MM-DD')`,
      avgValue: sql<string>`COALESCE(SUM(CAST(${invoices.total} AS numeric)) / NULLIF(COUNT(DISTINCT ${invoices.jobId}), 0), 0)::text`,
      invoiceCount: sql<number>`COUNT(*)::int`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.companyId, companyId),
        isNotNull(invoices.jobId),
        gte(sql`${invoices.issueDate}::timestamp`, current.from),
        lt(sql`${invoices.issueDate}::timestamp`, current.to),
      ),
    )
    .groupBy(sql`${invoices.issueDate}::date`)
    .orderBy(sql`${invoices.issueDate}::date`);

  const points: AvgJobValuePoint[] = rows.map((r) => ({
    date: r.date,
    avgValue: round2(parseFloat(r.avgValue ?? "0")),
    invoiceCount: Number(r.invoiceCount ?? 0),
  }));
  return { bucket: "daily", points, hasData: points.length > 0 };
}

const UNBILLABLE_TYPE_LABELS: Record<string, string> = {
  travel_to_job: "Travel to job",
  on_site: "On site",
  travel_between_jobs: "Travel between jobs",
  admin: "Admin",
  break: "Break",
  task_work: "Task work",
  other: "Other",
};
const KNOWN_UNBILLABLE_TYPES = new Set(timeEntryTypeEnum as readonly string[]);

export async function getUnbillableBreakdownShared(
  companyId: string,
  current: Window,
): Promise<UnbillableBreakdownSection> {
  const rows = await db
    .select({
      type: timeEntries.type,
      cost: sql<string>`COALESCE(SUM((${timeEntries.durationMinutes}::numeric / 60.0) * CAST(${timeEntries.costRateSnapshot} AS numeric)), 0)::text`,
      minutes: sql<string>`COALESCE(SUM(${timeEntries.durationMinutes}::numeric), 0)::text`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.companyId, companyId),
        eq(timeEntries.billable, false),
        // Exclude entries without a cost rate — their cost is
        // unfabricable. Drives the section's `hasData` flag.
        isNotNull(timeEntries.costRateSnapshot),
        isNotNull(timeEntries.durationMinutes),
        gte(timeEntries.startAt, current.from),
        lt(timeEntries.startAt, current.to),
      ),
    )
    .groupBy(timeEntries.type);

  const acc: Record<string, { cost: number; minutes: number; count: number }> = {};
  let totalCost = 0;
  let totalMinutes = 0;
  let totalCount = 0;
  for (const r of rows) {
    const raw = (r.type ?? "other").toLowerCase();
    const key = KNOWN_UNBILLABLE_TYPES.has(raw) ? raw : "other";
    const cost = parseFloat(r.cost ?? "0");
    const minutes = parseFloat(r.minutes ?? "0");
    const count = Number(r.count ?? 0);
    if (!acc[key]) acc[key] = { cost: 0, minutes: 0, count: 0 };
    acc[key].cost += cost;
    acc[key].minutes += minutes;
    acc[key].count += count;
    totalCost += cost;
    totalMinutes += minutes;
    totalCount += count;
  }

  const items: UnbillableBreakdownItem[] = Object.entries(acc)
    .map(([type, v]) => ({
      type,
      label: UNBILLABLE_TYPE_LABELS[type] ?? "Other",
      cost: round2(v.cost),
      hours: Math.round((v.minutes / 60) * 100) / 100,
      count: v.count,
      percentOfTotal:
        totalCost > 0 ? Math.round((v.cost / totalCost) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.cost - a.cost);

  return {
    items,
    totalCost: round2(totalCost),
    totalHours: Math.round((totalMinutes / 60) * 100) / 100,
    totalCount,
    hasData: items.length > 0 && totalCost > 0,
  };
}

// ---------------------------------------------------------------------------
// Completed jobs list — denormalized rows for the Job Performance
// deep-report's activity table. One row per `to_status='completed'`
// transition in window (re-completions appear as separate rows, which
// matches the Jobs Completed KPI count). Sorted desc by `changedAt`
// (newest first), capped at `limit`. Tech assignment is intentionally
// NOT joined — the canonical source is `job_visits.assignedTechnicianIds`
// (multi-row, multi-tech), which is ambiguous to surface here. Per
// spec: "Do not infer tech/client if relationship is unclear."
// ---------------------------------------------------------------------------

export interface CompletedJobRow {
  /** `job_status_events.id` — distinct per completion transition. */
  eventId: string;
  /** `jobs.id` — stable across re-completions. */
  jobId: string;
  jobNumber: number;
  summary: string;
  /** ISO instant of the completion transition. */
  completedAtISO: string;
  clientId: string;
  clientName: string;
  locationName: string | null;
  /** Primary invoice's total when one is linked. Null when the job
   *  has no invoice yet. Multi-invoice jobs surface only the primary
   *  pointer (`jobs.invoiceId`); see schema comment. */
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceTotal: number | null;
}

export async function getCompletedJobsListShared(
  companyId: string,
  current: Window,
  limit: number,
): Promise<CompletedJobRow[]> {
  const rows = await db
    .select({
      eventId: jobStatusEvents.id,
      jobId: jobs.id,
      jobNumber: jobs.jobNumber,
      summary: jobs.summary,
      completedAt: jobStatusEvents.changedAt,
      clientId: clientLocations.id,
      clientName: locationDisplayNameExpr,
      locationName: clientLocations.location,
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceTotal: invoices.total,
    })
    .from(jobStatusEvents)
    .innerJoin(jobs, eq(jobStatusEvents.jobId, jobs.id))
    .innerJoin(clientLocations, eq(jobs.locationId, clientLocations.id))
    .leftJoin(
      customerCompanies,
      eq(clientLocations.parentCompanyId, customerCompanies.id),
    )
    .leftJoin(invoices, eq(jobs.invoiceId, invoices.id))
    .where(
      and(
        eq(jobStatusEvents.companyId, companyId),
        eq(jobStatusEvents.toStatus, "completed"),
        gte(jobStatusEvents.changedAt, current.from),
        lt(jobStatusEvents.changedAt, current.to),
        // Soft-deleted jobs are excluded — their completion events
        // are operationally moot.
        isNull(jobs.deletedAt),
      ),
    )
    .orderBy(desc(jobStatusEvents.changedAt))
    .limit(limit);

  return rows.map((r) => ({
    eventId: r.eventId,
    jobId: r.jobId,
    jobNumber: Number(r.jobNumber ?? 0),
    summary: r.summary,
    completedAtISO: (r.completedAt as Date).toISOString(),
    clientId: r.clientId,
    clientName: r.clientName ?? "Unnamed Location",
    locationName: r.locationName,
    invoiceId: r.invoiceId,
    invoiceNumber: r.invoiceNumber,
    invoiceTotal:
      r.invoiceTotal == null ? null : round2(parseFloat(String(r.invoiceTotal))),
  }));
}

// ---------------------------------------------------------------------------
// Sales section helpers — lead/quote creation + conversion trends + the
// two status breakdowns. Lifted from `reportsSales.ts` so the Sales
// Funnel deep-report at `/reports/sales-funnel` can reuse the EXACT
// same queries. Sales tab behavior is unchanged — its aggregator now
// calls these helpers.
//
// Conversion predicates match the canonical signals already used by
// the Snapshot tab + the Sales tab + the rest of the app:
//   - lead converted ⇔ `convertedAt IS NOT NULL OR status = 'won'`
//   - quote converted ⇔ `convertedAt IS NOT NULL OR
//                        status IN ('converted', 'approved')`
// No new inferred-conversion signals.
// ---------------------------------------------------------------------------

export async function getLeadCreationTrendShared(
  companyId: string,
  current: Window,
): Promise<SalesCountTrendSection> {
  const rows = await db
    .select({
      date: sql<string>`to_char(${leads.createdAt}::date, 'YYYY-MM-DD')`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(leads)
    .where(
      and(
        eq(leads.companyId, companyId),
        eq(leads.isActive, true),
        gte(leads.createdAt, current.from),
        lt(leads.createdAt, current.to),
      ),
    )
    .groupBy(sql`${leads.createdAt}::date`)
    .orderBy(sql`${leads.createdAt}::date`);

  const points: SalesCountTrendPoint[] = rows.map((r) => ({
    date: r.date,
    count: Number(r.count ?? 0),
  }));
  return { bucket: "daily", points, hasData: points.length > 0 };
}

export async function getLeadConversionTrendShared(
  companyId: string,
  current: Window,
): Promise<SalesConversionTrendSection> {
  const rows = await db
    .select({
      date: sql<string>`to_char(${leads.createdAt}::date, 'YYYY-MM-DD')`,
      total: sql<number>`COUNT(*)::int`,
      converted: sql<number>`COUNT(*) FILTER (WHERE ${leads.convertedAt} IS NOT NULL OR ${leads.status} = 'won')::int`,
    })
    .from(leads)
    .where(
      and(
        eq(leads.companyId, companyId),
        eq(leads.isActive, true),
        gte(leads.createdAt, current.from),
        lt(leads.createdAt, current.to),
      ),
    )
    .groupBy(sql`${leads.createdAt}::date`)
    .orderBy(sql`${leads.createdAt}::date`);

  const points: SalesConversionTrendPoint[] = rows.map((r) => {
    const created = Number(r.total ?? 0);
    const converted = Number(r.converted ?? 0);
    return {
      date: r.date,
      createdCount: created,
      convertedCount: converted,
      conversionPercent:
        created > 0 ? Math.round((converted / created) * 1000) / 10 : 0,
    };
  });
  return { bucket: "daily", points, hasData: points.length > 0 };
}

export async function getQuoteCreationTrendShared(
  companyId: string,
  current: Window,
): Promise<SalesCountTrendSection> {
  const rows = await db
    .select({
      date: sql<string>`to_char(${quotes.createdAt}::date, 'YYYY-MM-DD')`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(quotes)
    .where(
      and(
        eq(quotes.companyId, companyId),
        gte(quotes.createdAt, current.from),
        lt(quotes.createdAt, current.to),
      ),
    )
    .groupBy(sql`${quotes.createdAt}::date`)
    .orderBy(sql`${quotes.createdAt}::date`);

  const points: SalesCountTrendPoint[] = rows.map((r) => ({
    date: r.date,
    count: Number(r.count ?? 0),
  }));
  return { bucket: "daily", points, hasData: points.length > 0 };
}

export async function getQuoteConversionTrendShared(
  companyId: string,
  current: Window,
): Promise<SalesConversionTrendSection> {
  const rows = await db
    .select({
      date: sql<string>`to_char(${quotes.createdAt}::date, 'YYYY-MM-DD')`,
      total: sql<number>`COUNT(*)::int`,
      converted: sql<number>`COUNT(*) FILTER (WHERE ${quotes.convertedAt} IS NOT NULL OR ${quotes.status} = 'converted' OR ${quotes.status} = 'approved')::int`,
    })
    .from(quotes)
    .where(
      and(
        eq(quotes.companyId, companyId),
        gte(quotes.createdAt, current.from),
        lt(quotes.createdAt, current.to),
      ),
    )
    .groupBy(sql`${quotes.createdAt}::date`)
    .orderBy(sql`${quotes.createdAt}::date`);

  const points: SalesConversionTrendPoint[] = rows.map((r) => {
    const created = Number(r.total ?? 0);
    const converted = Number(r.converted ?? 0);
    return {
      date: r.date,
      createdCount: created,
      convertedCount: converted,
      conversionPercent:
        created > 0 ? Math.round((converted / created) * 1000) / 10 : 0,
    };
  });
  return { bucket: "daily", points, hasData: points.length > 0 };
}

const LEAD_STATUS_LABELS: Record<LeadStatusKey, string> = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};
const LEAD_STATUS_KEYS = leadStatusEnum as readonly LeadStatusKey[];

export async function getLeadStatusBreakdownShared(
  companyId: string,
): Promise<LeadStatusBreakdownSection> {
  const rows = await db
    .select({
      status: leads.status,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(leads)
    .where(and(eq(leads.companyId, companyId), eq(leads.isActive, true)))
    .groupBy(leads.status);

  // Only canonical statuses — unknown values are dropped, NEVER
  // bucketed into a fabricated catch-all.
  const totals: Record<LeadStatusKey, number> = {
    new: 0,
    contacted: 0,
    quoted: 0,
    won: 0,
    lost: 0,
  };
  let totalCount = 0;
  for (const r of rows) {
    const key = r.status as LeadStatusKey;
    if (!(key in totals)) continue;
    totals[key] = Number(r.count ?? 0);
    totalCount += totals[key];
  }

  const items: LeadStatusBreakdownItem[] = LEAD_STATUS_KEYS.map((key) => ({
    key,
    label: LEAD_STATUS_LABELS[key],
    count: totals[key],
    percentOfTotal:
      totalCount > 0 ? Math.round((totals[key] / totalCount) * 1000) / 10 : 0,
  })).sort((a, b) => b.count - a.count);

  return { items, totalCount, hasData: totalCount > 0 };
}

const QUOTE_STATUS_LABELS: Record<QuoteStatusKey, string> = {
  draft: "Draft",
  sent: "Sent",
  approved: "Approved",
  declined: "Declined",
  expired: "Expired",
  converted: "Converted",
};
const QUOTE_STATUS_KEYS = quoteStatusEnum as readonly QuoteStatusKey[];

export async function getQuoteStatusBreakdownShared(
  companyId: string,
): Promise<QuoteStatusBreakdownSection> {
  const rows = await db
    .select({
      status: quotes.status,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(quotes)
    .where(eq(quotes.companyId, companyId))
    .groupBy(quotes.status);

  const totals: Record<QuoteStatusKey, number> = {
    draft: 0,
    sent: 0,
    approved: 0,
    declined: 0,
    expired: 0,
    converted: 0,
  };
  let totalCount = 0;
  for (const r of rows) {
    const key = r.status as QuoteStatusKey;
    if (!(key in totals)) continue;
    totals[key] = Number(r.count ?? 0);
    totalCount += totals[key];
  }

  const items: QuoteStatusBreakdownItem[] = QUOTE_STATUS_KEYS.map((key) => ({
    key,
    label: QUOTE_STATUS_LABELS[key],
    count: totals[key],
    percentOfTotal:
      totalCount > 0 ? Math.round((totals[key] / totalCount) * 1000) / 10 : 0,
  })).sort((a, b) => b.count - a.count);

  return { items, totalCount, hasData: totalCount > 0 };
}

// ---------------------------------------------------------------------------
// Conversion lag — average days from createdAt → convertedAt for leads
// and quotes that converted in window. Drives the Sales Funnel deep-
// report's "Conversion lag" section. When `convertedAt` is null on
// every relevant row (e.g. tenants where the canonical signal is the
// status enum but `convertedAt` was never written), the section's
// `hasData` flag flips to false and the UI renders an empty state —
// per spec: "If timestamps missing: hasData=false."
// ---------------------------------------------------------------------------

export interface ConversionLagBucket {
  /** Average days from creation → conversion. 0 when no rows match. */
  avgDays: number;
  /** Count of converted entities driving the average. Drives hasData. */
  count: number;
  /** 2026-05-03 audit fix: share of total converted records (canonical
   *  predicate) that have a `convertedAt` timestamp. Lets the UI tell
   *  the user how representative `avgDays` is of their actual
   *  conversion volume. `null` when no canonical conversions in
   *  window — the metric is undefined. Range 0–100, rounded to 1dp. */
  coveragePercent: number | null;
}

export interface ConversionLagShared {
  leads: ConversionLagBucket;
  quotes: ConversionLagBucket;
}

export async function getConversionLagShared(
  companyId: string,
  current: Window,
): Promise<ConversionLagShared> {
  // Each side runs ONE query that computes both:
  //   - the timestamped subset (convertedAt IN window) — drives
  //     avgDays + the existing `count`
  //   - the total-converted denominator (canonical predicate
  //     attributed to the window via `convertedAt` when present, else
  //     `updatedAt` for status-only conversions)
  // coveragePercent = timestampedCount / totalConvertedCount * 100.
  // When the denominator is 0 (no conversions attributable to the
  // window) we return null so the UI surfaces "—" instead of 100%
  // which would be misleading on an empty population.
  const [leadRows, quoteRows] = await Promise.all([
    db
      .select({
        avgDays: sql<string>`COALESCE(AVG(EXTRACT(EPOCH FROM (${leads.convertedAt} - ${leads.createdAt})) / 86400.0) FILTER (WHERE ${leads.convertedAt} IS NOT NULL AND ${leads.convertedAt} >= ${current.from} AND ${leads.convertedAt} < ${current.to}), 0)::text`,
        timestampedCount: sql<number>`COUNT(*) FILTER (WHERE ${leads.convertedAt} IS NOT NULL AND ${leads.convertedAt} >= ${current.from} AND ${leads.convertedAt} < ${current.to})::int`,
        totalConvertedCount: sql<number>`COUNT(*) FILTER (WHERE
          (${leads.convertedAt} IS NOT NULL AND ${leads.convertedAt} >= ${current.from} AND ${leads.convertedAt} < ${current.to})
          OR
          (${leads.convertedAt} IS NULL AND ${leads.status} = 'won' AND ${leads.updatedAt} IS NOT NULL AND ${leads.updatedAt} >= ${current.from} AND ${leads.updatedAt} < ${current.to})
        )::int`,
      })
      .from(leads)
      .where(
        and(
          eq(leads.companyId, companyId),
          eq(leads.isActive, true),
        ),
      ),
    db
      .select({
        avgDays: sql<string>`COALESCE(AVG(EXTRACT(EPOCH FROM (${quotes.convertedAt} - ${quotes.createdAt})) / 86400.0) FILTER (WHERE ${quotes.convertedAt} IS NOT NULL AND ${quotes.convertedAt} >= ${current.from} AND ${quotes.convertedAt} < ${current.to}), 0)::text`,
        timestampedCount: sql<number>`COUNT(*) FILTER (WHERE ${quotes.convertedAt} IS NOT NULL AND ${quotes.convertedAt} >= ${current.from} AND ${quotes.convertedAt} < ${current.to})::int`,
        totalConvertedCount: sql<number>`COUNT(*) FILTER (WHERE
          (${quotes.convertedAt} IS NOT NULL AND ${quotes.convertedAt} >= ${current.from} AND ${quotes.convertedAt} < ${current.to})
          OR
          (${quotes.convertedAt} IS NULL AND ${quotes.status} IN ('converted', 'approved') AND ${quotes.updatedAt} IS NOT NULL AND ${quotes.updatedAt} >= ${current.from} AND ${quotes.updatedAt} < ${current.to})
        )::int`,
      })
      .from(quotes)
      .where(eq(quotes.companyId, companyId)),
  ]);

  const computeCoverage = (timestamped: number, total: number): number | null => {
    if (total <= 0) return null;
    return Math.round((timestamped / total) * 1000) / 10;
  };

  const leadTimestamped = Number(leadRows[0]?.timestampedCount ?? 0);
  const leadTotal = Number(leadRows[0]?.totalConvertedCount ?? 0);
  const quoteTimestamped = Number(quoteRows[0]?.timestampedCount ?? 0);
  const quoteTotal = Number(quoteRows[0]?.totalConvertedCount ?? 0);

  return {
    leads: {
      avgDays: Math.round(parseFloat(leadRows[0]?.avgDays ?? "0") * 10) / 10,
      count: leadTimestamped,
      coveragePercent: computeCoverage(leadTimestamped, leadTotal),
    },
    quotes: {
      avgDays: Math.round(parseFloat(quoteRows[0]?.avgDays ?? "0") * 10) / 10,
      count: quoteTimestamped,
      coveragePercent: computeCoverage(quoteTimestamped, quoteTotal),
    },
  };
}

// ---------------------------------------------------------------------------
// Team Performance helpers — per-user attribution. These rely ONLY on
// FK-clean relationships:
//   - `time_entries.technicianId` → `users.id` (declared FK)
//   - `job_status_events.changedBy` → user id string (text column,
//     written by the canonical job-status writer; reliable enough to
//     join, but rows with null `changedBy` are excluded)
//
// Job-visit assigned-tech arrays (`job_visits.assignedTechnicianIds`)
// are NOT used here — that's a multi-tech/multi-row relationship that
// the spec explicitly forbids inferring on. Per spec: "If attribution
// is unclear → hasData=false."
// ---------------------------------------------------------------------------

/** Canonical display-name expression for a user. Mirrors the
 *  visual order used elsewhere in the app: full_name → first/last →
 *  email. Falls back to "Unknown user" only when the join misses
 *  entirely (which shouldn't happen with the FK in place but
 *  guards against soft-deleted users surfacing as null). */
const userDisplayNameExpr = sql<string>`COALESCE(
  NULLIF(${users.fullName}, ''),
  NULLIF(CONCAT_WS(' ', NULLIF(${users.firstName}, ''), NULLIF(${users.lastName}, '')), ''),
  ${users.email},
  'Unknown user'
)`;

export interface HoursByUserRow {
  userId: string;
  name: string;
  totalHours: number;
  billableHours: number;
  unbillableHours: number;
  entryCount: number;
}

/** Per-user hours over the current window. Excludes entries with no
 *  technician (FK guarantees non-null but defensive `IS NOT NULL`
 *  filters belt-and-braces). Uses `time_entries.startAt` for window
 *  membership — same anchor `unbillableCost` uses. */
export async function getHoursByUserShared(
  companyId: string,
  current: Window,
): Promise<HoursByUserRow[]> {
  const rows = await db
    .select({
      userId: users.id,
      name: userDisplayNameExpr,
      totalMinutes: sql<string>`COALESCE(SUM(${timeEntries.durationMinutes}::numeric), 0)::text`,
      billableMinutes: sql<string>`COALESCE(SUM(${timeEntries.durationMinutes}::numeric) FILTER (WHERE ${timeEntries.billable} = true), 0)::text`,
      unbillableMinutes: sql<string>`COALESCE(SUM(${timeEntries.durationMinutes}::numeric) FILTER (WHERE ${timeEntries.billable} = false), 0)::text`,
      entryCount: sql<number>`COUNT(*)::int`,
    })
    .from(timeEntries)
    .innerJoin(users, eq(timeEntries.technicianId, users.id))
    .where(
      and(
        eq(timeEntries.companyId, companyId),
        isNotNull(timeEntries.durationMinutes),
        gte(timeEntries.startAt, current.from),
        lt(timeEntries.startAt, current.to),
      ),
    )
    .groupBy(users.id, users.fullName, users.firstName, users.lastName, users.email)
    .orderBy(desc(sql`SUM(${timeEntries.durationMinutes}::numeric)`));

  const minutesToHours = (s: string | null | undefined) =>
    Math.round((parseFloat(s ?? "0") / 60) * 100) / 100;

  return rows.map((r) => ({
    userId: r.userId,
    name: r.name ?? "Unknown user",
    totalHours: minutesToHours(r.totalMinutes),
    billableHours: minutesToHours(r.billableMinutes),
    unbillableHours: minutesToHours(r.unbillableMinutes),
    entryCount: Number(r.entryCount ?? 0),
  }));
}

export interface UnbillableByUserRow {
  userId: string;
  name: string;
  cost: number;
  hours: number;
  entryCount: number;
}

/** Per-user unbillable cost over the current window. Excludes entries
 *  without a `costRateSnapshot` — the cost is unfabricable. Same
 *  exclusion rule the canonical `sharedQueries.unbillableCost`
 *  global lambda uses, so the per-user breakdown sums to the global
 *  KPI exactly. */
export async function getUnbillableByUserShared(
  companyId: string,
  current: Window,
): Promise<UnbillableByUserRow[]> {
  const rows = await db
    .select({
      userId: users.id,
      name: userDisplayNameExpr,
      cost: sql<string>`COALESCE(SUM((${timeEntries.durationMinutes}::numeric / 60.0) * CAST(${timeEntries.costRateSnapshot} AS numeric)), 0)::text`,
      minutes: sql<string>`COALESCE(SUM(${timeEntries.durationMinutes}::numeric), 0)::text`,
      entryCount: sql<number>`COUNT(*)::int`,
    })
    .from(timeEntries)
    .innerJoin(users, eq(timeEntries.technicianId, users.id))
    .where(
      and(
        eq(timeEntries.companyId, companyId),
        eq(timeEntries.billable, false),
        isNotNull(timeEntries.costRateSnapshot),
        isNotNull(timeEntries.durationMinutes),
        gte(timeEntries.startAt, current.from),
        lt(timeEntries.startAt, current.to),
      ),
    )
    .groupBy(users.id, users.fullName, users.firstName, users.lastName, users.email)
    .orderBy(desc(sql`SUM((${timeEntries.durationMinutes}::numeric / 60.0) * CAST(${timeEntries.costRateSnapshot} AS numeric))`));

  return rows.map((r) => ({
    userId: r.userId,
    name: r.name ?? "Unknown user",
    cost: round2(parseFloat(r.cost ?? "0")),
    hours: Math.round((parseFloat(r.minutes ?? "0") / 60) * 100) / 100,
    entryCount: Number(r.entryCount ?? 0),
  }));
}

export interface JobsByUserRow {
  userId: string;
  name: string;
  completedCount: number;
  /** Average primary-invoice total for jobs the user completed in
   *  window. Null when the user has no jobs with linked invoices —
   *  that's intentionally distinct from "0", which would imply the
   *  invoices exist with zero totals. */
  avgInvoiceTotal: number | null;
  invoicedCount: number;
}

/** Per-user "jobs completed" attribution via
 *  `job_status_events.changedBy`. Excludes events with null
 *  `changedBy` (unattributed transitions — usually system writes
 *  that we shouldn't credit to a user). Joins `users` for the
 *  display name; users that have been deleted but still appear in
 *  `changedBy` text fields drop out via the inner join.
 *
 *  Avg invoice total is the AVG of `invoices.total` for the
 *  primary-invoice pointer (`jobs.invoiceId`). Multi-invoice jobs
 *  surface only the primary one — same convention the Job
 *  Performance completed-jobs table uses. */
export async function getJobsCompletedByUserShared(
  companyId: string,
  current: Window,
): Promise<JobsByUserRow[]> {
  const rows = await db
    .select({
      userId: users.id,
      name: userDisplayNameExpr,
      completedCount: sql<number>`COUNT(*)::int`,
      avgInvoice: sql<string>`AVG(CAST(${invoices.total} AS numeric))::text`,
      invoicedCount: sql<number>`COUNT(${invoices.id})::int`,
    })
    .from(jobStatusEvents)
    .innerJoin(users, eq(sql`${jobStatusEvents.changedBy}`, users.id))
    .innerJoin(jobs, eq(jobStatusEvents.jobId, jobs.id))
    .leftJoin(invoices, eq(jobs.invoiceId, invoices.id))
    .where(
      and(
        eq(jobStatusEvents.companyId, companyId),
        eq(jobStatusEvents.toStatus, "completed"),
        isNotNull(jobStatusEvents.changedBy),
        gte(jobStatusEvents.changedAt, current.from),
        lt(jobStatusEvents.changedAt, current.to),
        isNull(jobs.deletedAt),
      ),
    )
    .groupBy(users.id, users.fullName, users.firstName, users.lastName, users.email)
    .orderBy(desc(sql`COUNT(*)`));

  return rows.map((r) => {
    const invoicedCount = Number(r.invoicedCount ?? 0);
    const avgInvoice = invoicedCount > 0 ? parseFloat(r.avgInvoice ?? "0") : null;
    return {
      userId: r.userId,
      name: r.name ?? "Unknown user",
      completedCount: Number(r.completedCount ?? 0),
      avgInvoiceTotal: avgInvoice == null ? null : round2(avgInvoice),
      invoicedCount,
    };
  });
}

// ---------------------------------------------------------------------------
// Parts Forecast — shared per-section helpers
// ---------------------------------------------------------------------------
// Forecast unit = "scheduled PM visit × active location PM part template"
// row. Each scheduled PM visit (jobs.jobType='maintenance' joined to
// job_visits in window) contributes one (visit × part) row per active
// `location_pm_part_templates` row at the location. The
// `quantityPerVisit` field is summed (decimal-safe) for KPIs and the
// product/location/visit roll-ups; visits are NOT deduplicated by
// location — per spec: "If a location has 2 PM visits in the window,
// its configured location parts must be counted once per visit."
//
// Active filters (locked here so every section agrees):
//   - jobs.jobType = 'maintenance' AND jobs.deletedAt IS NULL
//   - job_visits.scheduledStart IN window AND job_visits.isActive = true
//     AND job_visits.archivedAt IS NULL
//   - location_pm_part_templates.isActive = true
//     AND location_pm_part_templates.deletedAt IS NULL

/**
 * Reusable WHERE clause for "scheduled PM visit in window". Pulled out
 * so the parts-needed / parts-by-location / missing-parts queries can
 * share the SAME visit predicate — eliminates the risk of one section
 * counting a visit the other excludes.
 */
const pmVisitInWindowWhere = (companyId: string, w: Window) =>
  and(
    eq(jobVisits.companyId, companyId),
    eq(jobVisits.isActive, true),
    isNull(jobVisits.archivedAt),
    isNotNull(jobVisits.scheduledStart),
    gte(jobVisits.scheduledStart, w.from),
    lt(jobVisits.scheduledStart, w.to),
    eq(jobs.jobType, "maintenance"),
    isNull(jobs.deletedAt),
  );

/** Active filter for `location_pm_part_templates`: not soft-deleted +
 *  `isActive` true. Matches what the PM Parts repository uses. */
const activePMPartWhere = and(
  eq(locationPMPartTemplates.isActive, true),
  isNull(locationPMPartTemplates.deletedAt),
);

/**
 * Parts needed grouped by product. ONE row per product across all PM
 * visits in window. `totalQuantity` is the SUM of `quantityPerVisit`
 * across the (visit × part) join — so a location with 2 visits in
 * window contributes its template quantity twice. Visit and location
 * counts are DISTINCT so the forecast doesn't over-report reach.
 *
 * Sorted desc by `totalQuantity` so the heaviest demand surfaces
 * first. Limited at the caller; the SQL itself returns the full
 * group-by output for the window.
 */
export async function getForecastPartsNeededShared(
  companyId: string,
  w: Window,
): Promise<PartsNeededItem[]> {
  const rows = await db
    .select({
      productId: locationPMPartTemplates.productId,
      itemName: items.name,
      itemSku: items.sku,
      itemCategory: items.category,
      totalQuantity: sql<string>`COALESCE(SUM(CAST(${locationPMPartTemplates.quantityPerVisit} AS numeric)), 0)::text`,
      locationCount: sql<number>`COUNT(DISTINCT ${jobs.locationId})::int`,
      visitCount: sql<number>`COUNT(DISTINCT ${jobVisits.id})::int`,
    })
    .from(jobVisits)
    .innerJoin(jobs, eq(jobVisits.jobId, jobs.id))
    .innerJoin(
      locationPMPartTemplates,
      eq(locationPMPartTemplates.locationId, jobs.locationId),
    )
    .innerJoin(items, eq(locationPMPartTemplates.productId, items.id))
    .where(and(pmVisitInWindowWhere(companyId, w), activePMPartWhere))
    .groupBy(
      locationPMPartTemplates.productId,
      items.name,
      items.sku,
      items.category,
    )
    .orderBy(
      desc(sql`SUM(CAST(${locationPMPartTemplates.quantityPerVisit} AS numeric))`),
    );

  return rows.map((r) => ({
    productId: r.productId,
    itemName: r.itemName ?? "Unnamed part",
    itemSku: r.itemSku ?? null,
    itemCategory: r.itemCategory ?? null,
    totalQuantity: round2(parseFloat(r.totalQuantity ?? "0")),
    locationCount: Number(r.locationCount ?? 0),
    visitCount: Number(r.visitCount ?? 0),
  }));
}

/**
 * One row per (visit × part) joined to the location/customer
 * display names, then folded in TS into the per-visit shape the
 * UI consumes. The SQL returns the long form so we don't fight
 * with PostgreSQL `json_agg` ordering — the TS roll-up sorts
 * visits by `scheduledStart` and dedupes parts within a visit.
 */
export async function getForecastPartsByLocationShared(
  companyId: string,
  w: Window,
): Promise<PartsByLocationVisitItem[]> {
  const rows = await db
    .select({
      visitId: jobVisits.id,
      jobId: jobVisits.jobId,
      scheduledAt: jobVisits.scheduledStart,
      locationId: jobs.locationId,
      locationName: locationDisplayNameExpr,
      customerName: customerCompanies.name,
      productId: locationPMPartTemplates.productId,
      itemName: items.name,
      quantity: locationPMPartTemplates.quantityPerVisit,
    })
    .from(jobVisits)
    .innerJoin(jobs, eq(jobVisits.jobId, jobs.id))
    .innerJoin(clientLocations, eq(jobs.locationId, clientLocations.id))
    .leftJoin(
      customerCompanies,
      eq(clientLocations.parentCompanyId, customerCompanies.id),
    )
    .innerJoin(
      locationPMPartTemplates,
      eq(locationPMPartTemplates.locationId, jobs.locationId),
    )
    .innerJoin(items, eq(locationPMPartTemplates.productId, items.id))
    .where(and(pmVisitInWindowWhere(companyId, w), activePMPartWhere))
    .orderBy(asc(jobVisits.scheduledStart), asc(items.name));

  // Roll up per-visit. Within a visit, dedupe by productId — if a
  // location somehow has two active templates pointing at the same
  // product, treat it as one entry summing the quantities (the
  // expected case is one template per product, but we don't trust
  // the data shape blindly).
  const byVisit = new Map<string, PartsByLocationVisitItem>();
  for (const r of rows) {
    if (!r.scheduledAt) continue;
    let visit = byVisit.get(r.visitId);
    if (!visit) {
      visit = {
        visitId: r.visitId,
        jobId: r.jobId,
        scheduledAtISO: new Date(r.scheduledAt as Date).toISOString(),
        locationId: r.locationId,
        locationName: r.locationName ?? "Unnamed Location",
        customerName: r.customerName ?? null,
        parts: [],
      };
      byVisit.set(r.visitId, visit);
    }
    const qty = round2(parseFloat(r.quantity ?? "0"));
    const existing = visit.parts.find((p) => p.productId === r.productId);
    if (existing) {
      existing.quantity = round2(existing.quantity + qty);
    } else {
      visit.parts.push({
        productId: r.productId,
        itemName: r.itemName ?? "Unnamed part",
        quantity: qty,
      });
    }
  }
  return Array.from(byVisit.values()).sort((a, b) =>
    a.scheduledAtISO.localeCompare(b.scheduledAtISO),
  );
}

/**
 * PM visits in window whose location has zero ACTIVE PM part
 * templates configured. Flags incomplete setup before the visit
 * happens. Uses a NOT EXISTS subquery rather than a LEFT JOIN +
 * IS NULL so we don't have to fight with row counts when a
 * location has tags / soft-deleted rows.
 */
export async function getForecastMissingPartsShared(
  companyId: string,
  w: Window,
): Promise<MissingPartsItem[]> {
  const rows = await db
    .select({
      visitId: jobVisits.id,
      jobId: jobVisits.jobId,
      jobNumber: jobs.jobNumber,
      visitNumber: jobVisits.visitNumber,
      scheduledAt: jobVisits.scheduledStart,
      locationId: jobs.locationId,
      locationName: locationDisplayNameExpr,
      customerName: customerCompanies.name,
    })
    .from(jobVisits)
    .innerJoin(jobs, eq(jobVisits.jobId, jobs.id))
    .innerJoin(clientLocations, eq(jobs.locationId, clientLocations.id))
    .leftJoin(
      customerCompanies,
      eq(clientLocations.parentCompanyId, customerCompanies.id),
    )
    .where(
      and(
        pmVisitInWindowWhere(companyId, w),
        sql`NOT EXISTS (
          SELECT 1 FROM ${locationPMPartTemplates} lpt
          WHERE lpt.location_id = ${jobs.locationId}
            AND lpt.is_active = true
            AND lpt.deleted_at IS NULL
        )`,
      ),
    )
    .orderBy(asc(jobVisits.scheduledStart));

  return rows.map((r) => ({
    visitId: r.visitId,
    jobId: r.jobId,
    scheduledAtISO: r.scheduledAt
      ? new Date(r.scheduledAt as Date).toISOString()
      : "",
    locationId: r.locationId,
    locationName: r.locationName ?? "Unnamed Location",
    customerName: r.customerName ?? null,
    jobRef:
      r.visitNumber != null
        ? `Job #${r.jobNumber} · visit ${r.visitNumber}`
        : `Job #${r.jobNumber}`,
  }));
}

// ---------------------------------------------------------------------------
// Reusable per-metric query lambdas. Each takes a window and returns one
// scalar. Used by BOTH the Snapshot and Financial aggregators so the two
// tabs cannot disagree on the underlying definition of a metric.
// ---------------------------------------------------------------------------

export const sharedQueries = {
  /** Cash-basis revenue: sum of payments received in window. Excludes
   *  refunds/reversals via `paymentType='payment'`. Also excludes
   *  payments tied to voided invoices (per 2026-05-03 audit fix —
   *  voiding an invoice should remove its payments from revenue,
   *  even when the original `paymentType='payment'` row persists). */
  revenue: (companyId: string) => async (w: Window): Promise<number> => {
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
          gte(payments.receivedAt, w.from),
          lt(payments.receivedAt, w.to),
        ),
      );
    return parseFloat(rows[0]?.total ?? "0");
  },

  /** Average payment amount in window — `SUM(amount) / COUNT(*)` over
   *  cash-basis payments. Drives the Revenue deep-report's
   *  "Avg payment amount" KPI; also exposed in case other surfaces
   *  want a per-window average without re-deriving it. Excludes
   *  voided invoices (matches `revenue` filter set so AVG=SUM/COUNT
   *  reconciles). */
  avgPaymentAmount: (companyId: string) => async (w: Window): Promise<number> => {
    const rows = await db
      .select({
        avg: sql<string>`COALESCE(AVG(CAST(${payments.amount} AS numeric)), 0)::text`,
      })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .where(
        and(
          eq(invoices.companyId, companyId),
          eq(payments.paymentType, "payment"),
          ne(invoices.status, "voided"),
          gte(payments.receivedAt, w.from),
          lt(payments.receivedAt, w.to),
        ),
      );
    return parseFloat(rows[0]?.avg ?? "0");
  },

  /** Count of payment events received in window. Number — NOT dollars.
   *  Used for the "Payments collected" KPI alongside revenue. Excludes
   *  voided invoices so the count matches the dollar SUM. */
  paymentsCollected: (companyId: string) => async (w: Window): Promise<number> => {
    const rows = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .where(
        and(
          eq(invoices.companyId, companyId),
          eq(payments.paymentType, "payment"),
          ne(invoices.status, "voided"),
          gte(payments.receivedAt, w.from),
          lt(payments.receivedAt, w.to),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  },

  /** Average days from invoice issue → final payment, for invoices that
   *  reached `paid` status with a payment recorded in the window. */
  avgPaymentDays: (companyId: string) => async (w: Window): Promise<number> => {
    const rows = await db
      .select({
        avgDays: sql<string>`COALESCE(AVG(EXTRACT(EPOCH FROM (last_paid_at - issued_anchor)) / 86400.0), 0)::text`,
      })
      .from(
        sql`(
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
          HAVING MAX(${payments.receivedAt}) >= ${w.from}
             AND MAX(${payments.receivedAt}) <  ${w.to}
        ) AS paid_invoices`,
      );
    return parseFloat(rows[0]?.avgDays ?? "0");
  },

  /** Outstanding balance summed across invoices > 30 days overdue AS OF
   *  the window END. Matches the AR Aging report's bucket math. */
  ar30PlusAtPoint: (companyId: string) => async (w: Window): Promise<number> => {
    const rows = await db
      .select({
        total: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)), 0)::text`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          inArray(invoices.status, UNPAID_INVOICE_STATUSES),
          sql`CAST(${invoices.balance} AS numeric) > 0`,
          isNotNull(invoices.dueDate),
          sql`(${w.to}::date - ${invoices.dueDate}::date) > 30`,
        ),
      );
    return parseFloat(rows[0]?.total ?? "0");
  },

  /** Count of completed-status transitions inside the window. Reads
   *  `job_status_events` so re-completions and reverts are reflected
   *  accurately — the canonical "Jobs completed" definition shared by
   *  the Snapshot tab's Jobs & Operations metric and the Operations
   *  tab's KPI strip + completion trend. */
  jobsCompleted: (companyId: string) => async (w: Window): Promise<number> => {
    const rows = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(jobStatusEvents)
      .where(
        and(
          eq(jobStatusEvents.companyId, companyId),
          eq(jobStatusEvents.toStatus, "completed"),
          gte(jobStatusEvents.changedAt, w.from),
          lt(jobStatusEvents.changedAt, w.to),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  },

  /** Average value PER JOB for invoices ISSUED in the window. Computed
   *  as `SUM(invoices.total) / COUNT(DISTINCT invoices.jobId)` so a
   *  multi-invoice job (e.g. progress billing) contributes ONE row to
   *  the denominator — the metric tracks dollars per job, not dollars
   *  per invoice. Shared between the Snapshot tab's Jobs & Operations
   *  section and the Operations tab's KPI strip + Avg Job Value Trend
   *  so the two surfaces cannot disagree on the definition.
   *
   *  2026-05-03 audit fix: previously `AVG(total)` (per-invoice average)
   *  which inflated the denominator on multi-invoice jobs. */
  avgJobInvoiceValue: (companyId: string) => async (w: Window): Promise<number> => {
    const rows = await db
      .select({
        avg: sql<string>`COALESCE(SUM(CAST(${invoices.total} AS numeric)) / NULLIF(COUNT(DISTINCT ${invoices.jobId}), 0), 0)::text`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          isNotNull(invoices.jobId),
          gte(sql`${invoices.issueDate}::timestamp`, w.from),
          lt(sql`${invoices.issueDate}::timestamp`, w.to),
        ),
      );
    return parseFloat(rows[0]?.avg ?? "0");
  },

  /** Total hours worked over the window — sum of all
   *  `time_entries.durationMinutes / 60` regardless of billable
   *  flag. Drives the Team report's "Total hours" KPI. Excludes
   *  entries with null `durationMinutes` (in-flight rows). */
  totalHoursWorked: (companyId: string) => async (w: Window): Promise<number> => {
    const rows = await db
      .select({
        hours: sql<string>`COALESCE(SUM(${timeEntries.durationMinutes}::numeric) / 60.0, 0)::text`,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          isNotNull(timeEntries.durationMinutes),
          gte(timeEntries.startAt, w.from),
          lt(timeEntries.startAt, w.to),
        ),
      );
    return parseFloat(rows[0]?.hours ?? "0");
  },

  /** Billable hours over the window — same as `totalHoursWorked` but
   *  filtered to `billable = true`. Drives the Team report's
   *  "Billable hours" KPI. */
  totalBillableHours: (companyId: string) => async (w: Window): Promise<number> => {
    const rows = await db
      .select({
        hours: sql<string>`COALESCE(SUM(${timeEntries.durationMinutes}::numeric) / 60.0, 0)::text`,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          eq(timeEntries.billable, true),
          isNotNull(timeEntries.durationMinutes),
          gte(timeEntries.startAt, w.from),
          lt(timeEntries.startAt, w.to),
        ),
      );
    return parseFloat(rows[0]?.hours ?? "0");
  },

  /** Unbillable hours over the window — `billable = false`. Distinct
   *  from `unbillableCost` (which multiplies by rate); this is just
   *  the time. Drives the Team report's "Unbillable hours" KPI. */
  totalUnbillableHours: (companyId: string) => async (w: Window): Promise<number> => {
    const rows = await db
      .select({
        hours: sql<string>`COALESCE(SUM(${timeEntries.durationMinutes}::numeric) / 60.0, 0)::text`,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          eq(timeEntries.billable, false),
          isNotNull(timeEntries.durationMinutes),
          gte(timeEntries.startAt, w.from),
          lt(timeEntries.startAt, w.to),
        ),
      );
    return parseFloat(rows[0]?.hours ?? "0");
  },

  /** Sum of (unbillable_minutes / 60 * cost_rate_snapshot) over the
   *  window. Excludes entries with NULL `costRateSnapshot` so we only
   *  ever multiply real rates against real durations — caller flips
   *  hasData=false when there are no rate-bearing entries to compute
   *  against. */
  unbillableCost: (companyId: string) => async (w: Window): Promise<number> => {
    const rows = await db
      .select({
        total: sql<string>`COALESCE(SUM((${timeEntries.durationMinutes}::numeric / 60.0) * CAST(${timeEntries.costRateSnapshot} AS numeric)), 0)::text`,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          eq(timeEntries.billable, false),
          isNotNull(timeEntries.costRateSnapshot),
          isNotNull(timeEntries.durationMinutes),
          gte(timeEntries.startAt, w.from),
          lt(timeEntries.startAt, w.to),
        ),
      );
    return parseFloat(rows[0]?.total ?? "0");
  },

  /** Count of unbillable time_entries that have a cost rate set in
   *  the window. Drives `hasData` for the unbillable-cost metric — if
   *  no entries carry a rate, the cost is unfabricable and the UI
   *  must render a "Not enough data yet" empty state. */
  unbillableEntriesWithCostRate: (companyId: string) => async (w: Window): Promise<number> => {
    const rows = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          eq(timeEntries.billable, false),
          isNotNull(timeEntries.costRateSnapshot),
          isNotNull(timeEntries.durationMinutes),
          gte(timeEntries.startAt, w.from),
          lt(timeEntries.startAt, w.to),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  },

  /** Count of active leads created in window. Excludes soft-deleted
   *  rows (`isActive = false`) so the metric matches the active-leads
   *  list users see in the UI. Shared by Snapshot Sales section and
   *  the Sales drill-down tab. */
  leadsCreated: (companyId: string) => async (w: Window): Promise<number> => {
    const rows = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(leads)
      .where(
        and(
          eq(leads.companyId, companyId),
          eq(leads.isActive, true),
          gte(leads.createdAt, w.from),
          lt(leads.createdAt, w.to),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  },

  /** Count of leads CREATED in window that converted via the canonical
   *  signal (`convertedAt IS NOT NULL OR status='won'`). Used by the
   *  Sales Funnel deep-report's funnel-stage counts and the
   *  lead→quote drop-off KPI. Same predicate as
   *  `leadConversionPercent`. */
  leadsConverted: (companyId: string) => async (w: Window): Promise<number> => {
    const rows = await db
      .select({
        n: sql<number>`COUNT(*) FILTER (WHERE ${leads.convertedAt} IS NOT NULL OR ${leads.status} = 'won')::int`,
      })
      .from(leads)
      .where(
        and(
          eq(leads.companyId, companyId),
          eq(leads.isActive, true),
          gte(leads.createdAt, w.from),
          lt(leads.createdAt, w.to),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  },

  /** Of leads CREATED in window, percent that have any canonical
   *  conversion signal — `convertedAt` timestamp set OR
   *  `status = 'won'`. NOT inferred — these are the same two signals
   *  the rest of the app treats as "this lead converted". The Sales
   *  tab's lead-conversion trend reuses this exact predicate per
   *  daily bucket. */
  leadConversionPercent: (companyId: string) => async (w: Window): Promise<number> => {
    const rows = await db
      .select({
        total: sql<number>`COUNT(*)::int`,
        converted: sql<number>`COUNT(*) FILTER (WHERE ${leads.convertedAt} IS NOT NULL OR ${leads.status} = 'won')::int`,
      })
      .from(leads)
      .where(
        and(
          eq(leads.companyId, companyId),
          eq(leads.isActive, true),
          gte(leads.createdAt, w.from),
          lt(leads.createdAt, w.to),
        ),
      );
    const total = Number(rows[0]?.total ?? 0);
    const converted = Number(rows[0]?.converted ?? 0);
    return total > 0 ? (converted / total) * 100 : 0;
  },

  /** Count of quotes created in window. */
  quotesCreated: (companyId: string) => async (w: Window): Promise<number> => {
    const rows = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(quotes)
      .where(
        and(
          eq(quotes.companyId, companyId),
          gte(quotes.createdAt, w.from),
          lt(quotes.createdAt, w.to),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  },

  /** Count of quotes CREATED in window that converted via the
   *  canonical signal (`convertedAt IS NOT NULL OR status IN
   *  ('converted','approved')`). Same predicate as
   *  `quoteConversionPercent`. */
  quotesConverted: (companyId: string) => async (w: Window): Promise<number> => {
    const rows = await db
      .select({
        n: sql<number>`COUNT(*) FILTER (WHERE ${quotes.convertedAt} IS NOT NULL OR ${quotes.status} = 'converted' OR ${quotes.status} = 'approved')::int`,
      })
      .from(quotes)
      .where(
        and(
          eq(quotes.companyId, companyId),
          gte(quotes.createdAt, w.from),
          lt(quotes.createdAt, w.to),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  },

  /** Of quotes CREATED in window, percent that converted via the
   *  canonical signals — `convertedAt` set OR `status = 'converted'`
   *  OR `status = 'approved'`. The third signal is intentional: an
   *  approved quote is functionally a converted opportunity even if
   *  it hasn't been linked to a job yet. NOT inferred — these match
   *  the canonical "this quote landed" semantics used elsewhere. */
  quoteConversionPercent: (companyId: string) => async (w: Window): Promise<number> => {
    const rows = await db
      .select({
        total: sql<number>`COUNT(*)::int`,
        converted: sql<number>`COUNT(*) FILTER (WHERE ${quotes.convertedAt} IS NOT NULL OR ${quotes.status} = 'converted' OR ${quotes.status} = 'approved')::int`,
      })
      .from(quotes)
      .where(
        and(
          eq(quotes.companyId, companyId),
          gte(quotes.createdAt, w.from),
          lt(quotes.createdAt, w.to),
        ),
      );
    const total = Number(rows[0]?.total ?? 0);
    const converted = Number(rows[0]?.converted ?? 0);
    return total > 0 ? (converted / total) * 100 : 0;
  },

  /** Total OVERDUE AR AS OF the window end — sum of unpaid balances
   *  whose `dueDate` is strictly before the window end. Includes every
   *  bucket past due (1+ days, NOT just 30+ days like `ar30PlusAtPoint`).
   *  Drives the "Total overdue" KPI and the "% overdue" KPI on the AR
   *  deep-report. */
  totalOverdueAtPoint: (companyId: string) => async (w: Window): Promise<number> => {
    const rows = await db
      .select({
        total: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)), 0)::text`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          inArray(invoices.status, UNPAID_INVOICE_STATUSES),
          sql`CAST(${invoices.balance} AS numeric) > 0`,
          isNotNull(invoices.dueDate),
          // Past-due as of window end — strictly less than means at
          // least one full day overdue. Day-precise on the server
          // (no JS timezone drift).
          sql`${invoices.dueDate}::date < ${w.to}::date`,
        ),
      );
    return parseFloat(rows[0]?.total ?? "0");
  },

  /** Count of active (open + non-deleted) jobs AS OF the window end.
   *  Drives the "Active jobs" KPI on the Job Performance deep-report.
   *  Uses `created_at <= w.to` so historical comparisons reflect the
   *  job count at that point in time, not today's snapshot. */
  activeJobsAtPoint: (companyId: string) => async (w: Window): Promise<number> => {
    const rows = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(jobs)
      .where(
        and(
          eq(jobs.companyId, companyId),
          isNull(jobs.deletedAt),
          eq(jobs.status, "open"),
          sql`${jobs.createdAt} <= ${w.to}`,
        ),
      );
    return Number(rows[0]?.n ?? 0);
  },

  /** Total outstanding AR AS OF the window end — sum of unpaid balances
   *  across every unpaid status (current + every overdue bucket). */
  totalOutstandingAtPoint: (companyId: string) => async (w: Window): Promise<number> => {
    // Snapshot of OUTSTANDING balances at the window-end date. Uses
    // CURRENT_DATE-equivalent semantics — invoices created after the
    // window-end can't be outstanding "as of" then, so filter by
    // issueDate <= window-end. (For the trailing-edge windows this also
    // corrects historical comparisons to a point-in-time view.)
    const rows = await db
      .select({
        total: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)), 0)::text`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          inArray(invoices.status, UNPAID_INVOICE_STATUSES),
          sql`CAST(${invoices.balance} AS numeric) > 0`,
          sql`${invoices.issueDate}::date <= ${w.to}::date`,
        ),
      );
    return parseFloat(rows[0]?.total ?? "0");
  },
};
