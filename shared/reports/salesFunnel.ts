/**
 * Reports — Sales Funnel deep-report canonical contract.
 *
 * One source of truth for the GET /api/reports/sales-funnel response
 * shape. Both server and client import from here.
 *
 * Sections (in spec order):
 *   1. KPI strip — Leads created · Lead conversion % · Quotes created
 *      · Quote conversion % · Lead → quote drop-off %.
 *   2. Funnel — 4 fixed stages (Leads created · Leads converted ·
 *      Quotes created · Quotes converted) with per-stage count + %
 *      from previous stage.
 *   3. Lead creation trend (reuses Sales helper).
 *   4. Lead conversion trend (reuses Sales helper).
 *   5. Quote creation trend (reuses Sales helper).
 *   6. Quote conversion trend (reuses Sales helper).
 *   7. Lead status breakdown (reuses Sales helper).
 *   8. Quote status breakdown (reuses Sales helper).
 *   9. Conversion lag (NEW — avg days created → converted; falls back
 *      to hasData=false when timestamps are missing).
 *
 * Every section carries `hasData`. UI MUST render an empty state when
 * false. The contract reuses the Sales response section types so the
 * two surfaces consume identical shapes.
 */

import type {
  LeadStatusBreakdownSection,
  QuoteStatusBreakdownSection,
  SalesConversionTrendSection,
  SalesCountTrendSection,
} from "./sales";
import type { MetricCard, SnapshotRange } from "./snapshot";

export type SalesFunnelRange = SnapshotRange;

/** A single funnel stage. The order is fixed and the contract enforces
 *  no reordering (per spec: "do not reorder stages"). */
export type FunnelStageKey =
  | "leads_created"
  | "leads_converted"
  | "quotes_created"
  | "quotes_converted";

export interface FunnelStage {
  key: FunnelStageKey;
  label: string;
  count: number;
  /**
   * Share of the previous stage's count, 0–100, rounded to 1 decimal.
   * Always 100.0 for the first stage by definition. Null when the
   * previous stage's count is 0 (the ratio is undefined; UI must
   * render "—" instead of fabricating "Infinity%").
   */
  percentOfPrevious: number | null;
}

export interface FunnelSection {
  /** Always exactly four stages in spec order. */
  stages: FunnelStage[];
  hasData: boolean;
}

export interface ConversionLagPoint {
  /** Average days from `createdAt` → `convertedAt`. */
  avgDays: number;
  /** Number of conversions that drove the average — same as the
   *  count of converted records WITH a `convertedAt` timestamp. */
  count: number;
  /** 2026-05-03 audit fix: share of total converted records (per the
   *  canonical conversion predicate — `convertedAt` set OR
   *  status=won/converted/approved) that have a `convertedAt`
   *  timestamp. The lag `avgDays` is computed only over the
   *  timestamped subset; this field tells the user what fraction of
   *  conversions the average actually represents. `null` when the
   *  total-converted population is zero (no denominator). Range
   *  0–100, rounded to 1 decimal. */
  coveragePercent: number | null;
}

export interface ConversionLagSection {
  /** Lead lag — `AVG(leads.convertedAt - leads.createdAt)` over leads
   *  with `convertedAt` set in the current window. */
  leads: ConversionLagPoint;
  /** Quote lag — same shape, with `quotes.convertedAt`. */
  quotes: ConversionLagPoint;
  /**
   * False when neither leads nor quotes have any timestamped
   * conversion in the current window. Per spec: "If timestamps
   * missing: hasData=false."
   */
  hasData: boolean;
}

export interface SalesFunnelResponse {
  range: SalesFunnelRange;
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
   * 5 KPIs in spec order:
   *   - Leads created          (`higher_is_better`)
   *   - Lead conversion %      (`higher_is_better`)
   *   - Quotes created         (`higher_is_better`)
   *   - Quote conversion %     (`higher_is_better`)
   *   - Lead → quote drop-off %  (`lower_is_better` — drop-off is
   *                                 leakage, less is better)
   */
  kpis: { metrics: MetricCard[] };
  funnel: FunnelSection;
  leadCreationTrend: SalesCountTrendSection;
  leadConversionTrend: SalesConversionTrendSection;
  quoteCreationTrend: SalesCountTrendSection;
  quoteConversionTrend: SalesConversionTrendSection;
  leadStatus: LeadStatusBreakdownSection;
  quoteStatus: QuoteStatusBreakdownSection;
  conversionLag: ConversionLagSection;
}

export type {
  LeadStatusBreakdownSection,
  MetricCard,
  QuoteStatusBreakdownSection,
  SalesConversionTrendSection,
  SalesCountTrendSection,
};
