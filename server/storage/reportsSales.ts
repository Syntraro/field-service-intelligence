/**
 * Reports — Sales tab aggregator.
 *
 * Drill-down for lead + quote performance. Reuses the canonical
 * `sharedQueries` from `reportsCommon.ts` for the KPI strip — Leads
 * created, Lead conversion %, Quotes created, Quote conversion % —
 * so the Snapshot Sales section and the Sales drill-down tab cannot
 * disagree on those numbers.
 *
 * Conversion predicates match the canonical signals already used by
 * the Snapshot tab + the rest of the app:
 *   - lead converted ⇔ `convertedAt IS NOT NULL OR status = 'won'`
 *   - quote converted ⇔ `convertedAt IS NOT NULL OR
 *                        status IN ('converted', 'approved')`
 * No new inferred-conversion signals are introduced here.
 */

import {
  buildComparisonWindows,
  evaluateScalar,
  buildMetric,
  allZero,
  sharedQueries,
  getLeadCreationTrendShared,
  getLeadConversionTrendShared,
  getQuoteCreationTrendShared,
  getQuoteConversionTrendShared,
  getLeadStatusBreakdownShared,
  getQuoteStatusBreakdownShared,
} from "./reportsCommon";
import type { SalesRange, SalesResponse } from "@shared/reports/sales";

// ---------------------------------------------------------------------------
// 2026-05-03: every section helper is now a thin wrapper around
// `reportsCommon.get*Shared`. Sales tab output is byte-for-byte
// unchanged — the queries were lifted so the Sales Funnel
// deep-report at `/reports/sales-funnel` can consume them too.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function getCompanySales(
  companyId: string,
  range: SalesRange,
  now: Date = new Date(),
): Promise<SalesResponse> {
  if (range !== "last_30_days") {
    throw new Error(`Unsupported sales range: ${range}`);
  }
  const windows = buildComparisonWindows(now);
  const { current, prevMonth, prevQuarter, prevYear } = windows;

  const [
    leadsCreated,
    leadConversion,
    quotesCreated,
    quoteConversion,
    leadCreationTrend,
    leadConversionTrend,
    quoteCreationTrend,
    quoteConversionTrend,
    leadStatusBreakdown,
    quoteStatusBreakdown,
  ] = await Promise.all([
    evaluateScalar(windows, sharedQueries.leadsCreated(companyId)),
    evaluateScalar(windows, sharedQueries.leadConversionPercent(companyId)),
    evaluateScalar(windows, sharedQueries.quotesCreated(companyId)),
    evaluateScalar(windows, sharedQueries.quoteConversionPercent(companyId)),
    getLeadCreationTrendShared(companyId, current),
    getLeadConversionTrendShared(companyId, current),
    getQuoteCreationTrendShared(companyId, current),
    getQuoteConversionTrendShared(companyId, current),
    getLeadStatusBreakdownShared(companyId),
    getQuoteStatusBreakdownShared(companyId),
  ]);

  const kpis = {
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
    kpis,
    leadCreationTrend,
    leadConversionTrend,
    quoteCreationTrend,
    quoteConversionTrend,
    leadStatusBreakdown,
    quoteStatusBreakdown,
  };
}
