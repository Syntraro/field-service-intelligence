/**
 * Reports — Sales tab canonical contract.
 *
 * Drill-down for lead and quote performance. The KPI strip mirrors the
 * Snapshot tab's Sales section verbatim (same `MetricCard` shape, same
 * polarity rules) so users see the same headline numbers in both
 * places. The trend + status sections expand on those numbers.
 *
 * Section conventions:
 *   - Every section carries `hasData`. UI MUST render an empty state
 *     when false rather than fabricating placeholder rows.
 *   - Conversion definitions match the canonical predicates already
 *     in use elsewhere in the app — `leads.convertedAt IS NOT NULL OR
 *     leads.status = 'won'` for leads, and `quotes.convertedAt IS NOT
 *     NULL OR quotes.status IN ('converted', 'approved')` for quotes.
 *     We do NOT invent new "inferred conversion" signals here.
 */

import type { MetricCard, SnapshotRange } from "./snapshot";

export type SalesRange = SnapshotRange;

/** Daily count bucket — used by lead-creation + quote-creation trend. */
export interface SalesCountTrendPoint {
  /** Window start of the bucket as a `YYYY-MM-DD` string. */
  date: string;
  count: number;
}

/** Daily conversion bucket — used by lead-conversion + quote-conversion
 *  trend. The percent is "of items CREATED in this bucket, what share
 *  have converted (canonical signals only)". `createdCount` /
 *  `convertedCount` are exposed so the UI can show the underlying
 *  ratio when the percentage alone is misleading on small denominators
 *  (e.g. 100% of 1 lead). */
export interface SalesConversionTrendPoint {
  date: string;
  createdCount: number;
  convertedCount: number;
  /** 0–100, rounded to 1 decimal. */
  conversionPercent: number;
}

export interface SalesCountTrendSection {
  bucket: "daily";
  points: SalesCountTrendPoint[];
  hasData: boolean;
}

export interface SalesConversionTrendSection {
  bucket: "daily";
  points: SalesConversionTrendPoint[];
  hasData: boolean;
}

/** Status keys mirror `leadStatusEnum` in `shared/schema.ts:5728` —
 *  `"new" | "contacted" | "quoted" | "won" | "lost"`. No fabricated
 *  buckets. */
export type LeadStatusKey = "new" | "contacted" | "quoted" | "won" | "lost";

/** Status keys mirror `quoteStatusEnum` in `shared/schema.ts:3832` —
 *  `"draft" | "sent" | "approved" | "declined" | "expired" |
 *  "converted"`. No fabricated buckets. */
export type QuoteStatusKey =
  | "draft"
  | "sent"
  | "approved"
  | "declined"
  | "expired"
  | "converted";

export interface LeadStatusBreakdownItem {
  key: LeadStatusKey;
  label: string;
  count: number;
  /** 0–100, rounded to 1 decimal. */
  percentOfTotal: number;
}

export interface QuoteStatusBreakdownItem {
  key: QuoteStatusKey;
  label: string;
  count: number;
  percentOfTotal: number;
}

export interface LeadStatusBreakdownSection {
  items: LeadStatusBreakdownItem[];
  totalCount: number;
  hasData: boolean;
}

export interface QuoteStatusBreakdownSection {
  items: QuoteStatusBreakdownItem[];
  totalCount: number;
  hasData: boolean;
}

export interface SalesResponse {
  range: SalesRange;
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
   * Top KPI strip — 4 metrics in spec order:
   * Leads created · Lead conversion · Quotes created · Quote conversion.
   * Same definitions as the Snapshot tab's Sales section (the
   * underlying SQL lambdas are imported from `reportsCommon`).
   */
  kpis: { metrics: MetricCard[] };
  leadCreationTrend: SalesCountTrendSection;
  leadConversionTrend: SalesConversionTrendSection;
  quoteCreationTrend: SalesCountTrendSection;
  quoteConversionTrend: SalesConversionTrendSection;
  leadStatusBreakdown: LeadStatusBreakdownSection;
  quoteStatusBreakdown: QuoteStatusBreakdownSection;
}

export type { MetricCard };
