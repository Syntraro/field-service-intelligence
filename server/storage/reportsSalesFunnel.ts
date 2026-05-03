/**
 * Reports — Sales Funnel deep-report aggregator.
 *
 * Backs `GET /api/reports/sales-funnel`. Reuses every Sales section
 * helper that was lifted into `reportsCommon` in this pass (creation
 * trends, conversion trends, status breakdowns) plus the canonical
 * `sharedQueries` lambdas for the funnel-stage scalars.
 *
 * The aggregator is a thin orchestrator — it does not import `db` or
 * any schema table directly. All SQL lives in `reportsCommon`. The
 * only Funnel-specific computation is the funnel-stage assembly +
 * the lead→quote drop-off KPI math, neither of which touches the DB.
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
  getConversionLagShared,
} from "./reportsCommon";
import type {
  ConversionLagSection,
  FunnelSection,
  FunnelStage,
  SalesFunnelRange,
  SalesFunnelResponse,
} from "@shared/reports/salesFunnel";

/** Build the four-stage funnel section from already-evaluated
 *  current-window scalars. The stage order is fixed and the spec
 *  forbids reordering. `percentOfPrevious` is null when the previous
 *  stage's count is 0 (ratio undefined → "—" in the UI). */
function buildFunnel(stages: {
  leadsCreated: number;
  leadsConverted: number;
  quotesCreated: number;
  quotesConverted: number;
}): FunnelSection {
  const ordered: FunnelStage[] = [
    { key: "leads_created", label: "Leads created", count: stages.leadsCreated, percentOfPrevious: stages.leadsCreated > 0 ? 100 : null },
    { key: "leads_converted", label: "Leads converted", count: stages.leadsConverted, percentOfPrevious: percentOfPrev(stages.leadsConverted, stages.leadsCreated) },
    { key: "quotes_created", label: "Quotes created", count: stages.quotesCreated, percentOfPrevious: percentOfPrev(stages.quotesCreated, stages.leadsConverted) },
    { key: "quotes_converted", label: "Quotes converted", count: stages.quotesConverted, percentOfPrevious: percentOfPrev(stages.quotesConverted, stages.quotesCreated) },
  ];
  // The funnel is meaningful when ANY stage has activity. Tenants
  // that create quotes directly (no lead pipeline) still get a useful
  // view via the lower stages; the per-stage `percentOfPrevious` is
  // already null-safe when the upstream stage is zero. Only show the
  // section-level empty state when every stage is structurally zero.
  const hasData =
    stages.leadsCreated > 0 ||
    stages.leadsConverted > 0 ||
    stages.quotesCreated > 0 ||
    stages.quotesConverted > 0;
  return { stages: ordered, hasData };
}

function percentOfPrev(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round((current / previous) * 1000) / 10;
}

/** Lead → quote drop-off ratio: of all leads created in window, what
 *  share did NOT convert. `null` when there were no leads (the ratio
 *  is undefined — UI renders "—"). Used by both the KPI strip and the
 *  funnel section. */
function dropOffPercent(leadsCreated: number, leadsConverted: number): number {
  if (leadsCreated <= 0) return 0;
  const dropped = Math.max(0, leadsCreated - leadsConverted);
  return Math.round((dropped / leadsCreated) * 1000) / 10;
}

export async function getCompanySalesFunnel(
  companyId: string,
  range: SalesFunnelRange,
  now: Date = new Date(),
): Promise<SalesFunnelResponse> {
  if (range !== "last_30_days") {
    throw new Error(`Unsupported sales-funnel range: ${range}`);
  }
  const windows = buildComparisonWindows(now);
  const { current, prevMonth, prevQuarter, prevYear } = windows;

  const [
    leadsCreated,
    leadsConverted,
    leadConversionPercent,
    quotesCreated,
    quotesConverted,
    quoteConversionPercent,
    leadCreationTrend,
    leadConversionTrend,
    quoteCreationTrend,
    quoteConversionTrend,
    leadStatus,
    quoteStatus,
    lag,
  ] = await Promise.all([
    evaluateScalar(windows, sharedQueries.leadsCreated(companyId)),
    evaluateScalar(windows, sharedQueries.leadsConverted(companyId)),
    evaluateScalar(windows, sharedQueries.leadConversionPercent(companyId)),
    evaluateScalar(windows, sharedQueries.quotesCreated(companyId)),
    evaluateScalar(windows, sharedQueries.quotesConverted(companyId)),
    evaluateScalar(windows, sharedQueries.quoteConversionPercent(companyId)),
    getLeadCreationTrendShared(companyId, current),
    getLeadConversionTrendShared(companyId, current),
    getQuoteCreationTrendShared(companyId, current),
    getQuoteConversionTrendShared(companyId, current),
    getLeadStatusBreakdownShared(companyId),
    getQuoteStatusBreakdownShared(companyId),
    getConversionLagShared(companyId, current),
  ]);

  const funnel = buildFunnel({
    leadsCreated: leadsCreated.current,
    leadsConverted: leadsConverted.current,
    quotesCreated: quotesCreated.current,
    quotesConverted: quotesConverted.current,
  });

  // Lead → quote drop-off as a windowed scalar so the KPI gets the
  // same prevMonth / prevQuarter / prevYear comparisons every other
  // metric does. Computed from the already-evaluated lead scalars —
  // no extra DB hit.
  const dropOff = {
    current: dropOffPercent(leadsCreated.current, leadsConverted.current),
    prevMonth: dropOffPercent(leadsCreated.prevMonth, leadsConverted.prevMonth),
    prevQuarter: dropOffPercent(leadsCreated.prevQuarter, leadsConverted.prevQuarter),
    prevYear: dropOffPercent(leadsCreated.prevYear, leadsConverted.prevYear),
  };

  // Conversion-lag section's hasData rule: at least one lead OR quote
  // has a timestamped conversion in the current window. Per spec:
  // "If timestamps missing: hasData=false."
  const conversionLag: ConversionLagSection = {
    leads: lag.leads,
    quotes: lag.quotes,
    hasData: lag.leads.count > 0 || lag.quotes.count > 0,
  };

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
          current: Math.round(leadConversionPercent.current * 10) / 10,
          prevMonth: Math.round(leadConversionPercent.prevMonth * 10) / 10,
          prevQuarter: Math.round(leadConversionPercent.prevQuarter * 10) / 10,
          prevYear: Math.round(leadConversionPercent.prevYear * 10) / 10,
        },
        // Conversion is only meaningful when there were leads.
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
          current: Math.round(quoteConversionPercent.current * 10) / 10,
          prevMonth: Math.round(quoteConversionPercent.prevMonth * 10) / 10,
          prevQuarter: Math.round(quoteConversionPercent.prevQuarter * 10) / 10,
          prevYear: Math.round(quoteConversionPercent.prevYear * 10) / 10,
        },
        hasData: !allZero(quotesCreated),
      }),
      buildMetric({
        key: "lead_to_quote_dropoff",
        label: "Lead → quote drop-off",
        unit: "percent",
        // Drop-off is leakage. Less is better.
        polarity: "lower_is_better",
        scalars: {
          current: dropOff.current,
          prevMonth: dropOff.prevMonth,
          prevQuarter: dropOff.prevQuarter,
          prevYear: dropOff.prevYear,
        },
        // Spec: "Only compute if both exist" — there must be at least
        // some lead signal in the windows for the drop-off ratio to
        // be meaningful. When `leadsCreated` is all-zero across every
        // window, hasData=false and the UI shows the empty state.
        hasData: !allZero(leadsCreated),
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
    funnel,
    leadCreationTrend,
    leadConversionTrend,
    quoteCreationTrend,
    quoteConversionTrend,
    leadStatus,
    quoteStatus,
    conversionLag,
  };
}
