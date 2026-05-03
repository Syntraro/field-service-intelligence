/**
 * Reports — Insights rule engine.
 *
 * Pure deterministic translator from the existing Snapshot + Parts
 * Forecast response payloads into a flat list of `Insight` cards
 * surfaced at the top of the Snapshot tab.
 *
 * Design rules (locked by tests):
 *   - NO new SQL. NO new API endpoints. Reads only what the existing
 *     `/api/reports/snapshot` and `/api/reports/parts-forecast`
 *     responses already expose.
 *   - Every rule short-circuits on `hasData === false`. Tenants
 *     without underlying data see ZERO insights — never a fabricated
 *     "Revenue is unchanged" or "AR is healthy" placeholder.
 *   - Every rule reports the metric / payload field that triggered
 *     it via `metricKey`, so the UI (and the user) can trace the
 *     insight back to the source number.
 *   - Severity is a pure function of the threshold table below. No
 *     ML, no heuristics, no aggregation across rules.
 *
 * Threshold table (all canonical, sourced from the user's spec):
 *
 *   #1 Revenue trend          — monthChangePercent < -10 → warning
 *                               monthChangePercent < -25 → critical
 *   #2 AR risk                — overdue% > 20 → warning
 *                               overdue% > 35 → critical
 *   #3 Payment slowdown       — Δ days > 5  → warning
 *                               Δ days > 10 → critical
 *   #4 Job value drop         — monthChangePercent < -10 → warning
 *                               monthChangePercent < -20 → critical
 *   #5 Unbillable cost spike  — monthChangePercent > +15 → warning
 *                               monthChangePercent > +30 → critical
 *   #6 Sales conversion drop  — lead OR quote conv pct change < -10
 *                               (warning) / < -20 (critical)
 *   #7 Parts setup issues     — missingPartsData.hasData →
 *                               warning; >50% of upcoming PM visits
 *                               missing → critical
 *
 * Returning an empty array means "no insights to show". The UI
 * hides the section entirely in that case — never renders an
 * empty card or a "you're all caught up" placeholder.
 */

import type {
  ARBucket,
  MetricCard,
  SnapshotResponse,
} from "@shared/reports/snapshot";
import type { PartsForecastResponse } from "@shared/reports/partsForecast";

export type InsightSeverity = "info" | "warning" | "critical";

export interface Insight {
  /** Stable identifier — kebab-cased; used as React key + test id slug. */
  id: string;
  /** Headline string the UI renders prominently. */
  title: string;
  /** Additional one-line context. */
  description: string;
  severity: InsightSeverity;
  /** The source metric / payload key that triggered the insight, so
   *  the user can trace back to the underlying report section. */
  metricKey: string;
}

export interface InsightInputs {
  snapshot: SnapshotResponse;
  /** Optional — when the parts-forecast fetch failed or hasn't
   *  resolved yet, parts-setup insights silently skip. They are
   *  never fabricated from missing data. */
  partsForecast: PartsForecastResponse | null;
}

const findActiveMetric = (
  metrics: MetricCard[],
  key: string,
): MetricCard | undefined =>
  metrics.find((m) => m.key === key && m.hasData);

const fmtCurrency = (n: number | null | undefined): string => {
  if (n == null) return "—";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
};

const fmtPct1 = (n: number): string => `${n.toFixed(1)}%`;

export function computeInsights({
  snapshot,
  partsForecast,
}: InsightInputs): Insight[] {
  const insights: Insight[] = [];

  // ---------------------------------------------------------------------
  // 1. Revenue trend (lower-than-last-month → warning, much lower → critical)
  // ---------------------------------------------------------------------
  const revenue = findActiveMetric(
    snapshot.revenueCashFlow.metrics,
    "revenue",
  );
  if (
    revenue &&
    revenue.monthChangePercent != null &&
    revenue.monthChangePercent < -10
  ) {
    const dropPct = -revenue.monthChangePercent;
    insights.push({
      id: "revenue-down",
      title: `Revenue down ${fmtPct1(dropPct)} vs last month`,
      description: `Current ${fmtCurrency(
        revenue.currentValue,
      )} · last month ${fmtCurrency(revenue.previousMonthValue)}.`,
      severity: dropPct > 25 ? "critical" : "warning",
      metricKey: "revenue",
    });
  }

  // ---------------------------------------------------------------------
  // 2. AR risk — overdue percentage of total outstanding
  // ---------------------------------------------------------------------
  const ar = snapshot.accountsReceivable.buckets;
  const bucketAmount = (key: ARBucket["key"]): number =>
    ar.find((b) => b.key === key)?.amount ?? 0;
  const totalOverdue = bucketAmount("total_overdue");
  const currentAR = bucketAmount("current");
  const totalAR = totalOverdue + currentAR;
  if (totalAR > 0 && totalOverdue > 0) {
    const overduePct = (totalOverdue / totalAR) * 100;
    if (overduePct > 20) {
      insights.push({
        id: "ar-overdue",
        title: `${overduePct.toFixed(0)}% of AR is overdue`,
        description: `${fmtCurrency(totalOverdue)} overdue out of ${fmtCurrency(
          totalAR,
        )} total outstanding.`,
        severity: overduePct > 35 ? "critical" : "warning",
        metricKey: "ar_overdue_pct",
      });
    }
  }

  // ---------------------------------------------------------------------
  // 3. Payment slowdown — absolute delta in DAYS, not percent
  // ---------------------------------------------------------------------
  const paymentDays = findActiveMetric(
    snapshot.revenueCashFlow.metrics,
    "avg_payment_days",
  );
  if (
    paymentDays &&
    paymentDays.currentValue != null &&
    paymentDays.previousMonthValue != null &&
    paymentDays.previousMonthValue > 0
  ) {
    const deltaDays = paymentDays.currentValue - paymentDays.previousMonthValue;
    if (deltaDays > 5) {
      insights.push({
        id: "payment-slowdown",
        title: `Payment time up ${Math.round(deltaDays)} days vs last month`,
        description: `Avg payment time is ${Math.round(
          paymentDays.currentValue,
        )} days (was ${Math.round(paymentDays.previousMonthValue)} days).`,
        severity: deltaDays > 10 ? "critical" : "warning",
        metricKey: "avg_payment_days",
      });
    }
  }

  // ---------------------------------------------------------------------
  // 4. Job value drop
  // ---------------------------------------------------------------------
  const avgJobValue = findActiveMetric(
    snapshot.jobsOperations.metrics,
    "avg_job_value",
  );
  if (
    avgJobValue &&
    avgJobValue.monthChangePercent != null &&
    avgJobValue.monthChangePercent < -10
  ) {
    const dropPct = -avgJobValue.monthChangePercent;
    insights.push({
      id: "job-value-drop",
      title: `Avg job value down ${fmtPct1(dropPct)} vs last month`,
      description: `Per-job invoice average is ${fmtCurrency(
        avgJobValue.currentValue,
      )} · last month ${fmtCurrency(avgJobValue.previousMonthValue)}.`,
      severity: dropPct > 20 ? "critical" : "warning",
      metricKey: "avg_job_value",
    });
  }

  // ---------------------------------------------------------------------
  // 5. Unbillable cost spike
  // ---------------------------------------------------------------------
  const unbillable = findActiveMetric(
    snapshot.jobsOperations.metrics,
    "unbillable_cost",
  );
  if (
    unbillable &&
    unbillable.monthChangePercent != null &&
    unbillable.monthChangePercent > 15
  ) {
    const spikePct = unbillable.monthChangePercent;
    insights.push({
      id: "unbillable-spike",
      title: `Unbillable time cost up ${fmtPct1(spikePct)} vs last month`,
      description: `${fmtCurrency(
        unbillable.currentValue,
      )} unbillable cost · last month ${fmtCurrency(
        unbillable.previousMonthValue,
      )}.`,
      severity: spikePct > 30 ? "critical" : "warning",
      metricKey: "unbillable_cost",
    });
  }

  // ---------------------------------------------------------------------
  // 6. Sales conversion drop — fires for lead OR quote (independent
  //    cards so the user knows which funnel stage regressed).
  // ---------------------------------------------------------------------
  const leadConv = findActiveMetric(
    snapshot.sales.metrics,
    "lead_conversion",
  );
  if (
    leadConv &&
    leadConv.monthChangePercent != null &&
    leadConv.monthChangePercent < -10
  ) {
    const dropPct = -leadConv.monthChangePercent;
    insights.push({
      id: "lead-conversion-drop",
      title: `Lead conversion down ${fmtPct1(dropPct)} vs last month`,
      description: `Conversion rate is ${
        leadConv.currentValue != null ? fmtPct1(leadConv.currentValue) : "—"
      } · last month ${
        leadConv.previousMonthValue != null
          ? fmtPct1(leadConv.previousMonthValue)
          : "—"
      }.`,
      severity: dropPct > 20 ? "critical" : "warning",
      metricKey: "lead_conversion",
    });
  }
  const quoteConv = findActiveMetric(
    snapshot.sales.metrics,
    "quote_conversion",
  );
  if (
    quoteConv &&
    quoteConv.monthChangePercent != null &&
    quoteConv.monthChangePercent < -10
  ) {
    const dropPct = -quoteConv.monthChangePercent;
    insights.push({
      id: "quote-conversion-drop",
      title: `Quote conversion down ${fmtPct1(dropPct)} vs last month`,
      description: `Conversion rate is ${
        quoteConv.currentValue != null ? fmtPct1(quoteConv.currentValue) : "—"
      } · last month ${
        quoteConv.previousMonthValue != null
          ? fmtPct1(quoteConv.previousMonthValue)
          : "—"
      }.`,
      severity: dropPct > 20 ? "critical" : "warning",
      metricKey: "quote_conversion",
    });
  }

  // ---------------------------------------------------------------------
  // 7. Parts setup issues — only fires when the parts-forecast payload
  //    is present AND `missingPartsData.hasData` is true.
  // ---------------------------------------------------------------------
  if (partsForecast && partsForecast.missingPartsData.hasData) {
    const missingCount = partsForecast.missingPartsData.items.length;
    // Total upcoming PM visits in the forecast window:
    //   parts-configured visits   = kpis.pmVisitsRequiringParts
    //   + missing-parts visits    = missingPartsData.items.length
    // Together they cover every scheduled PM visit in window.
    const totalUpcomingVisits =
      partsForecast.kpis.pmVisitsRequiringParts + missingCount;
    const missingPct =
      totalUpcomingVisits > 0
        ? (missingCount / totalUpcomingVisits) * 100
        : 0;
    const visitWord = missingCount === 1 ? "PM visit" : "PM visits";
    const description =
      totalUpcomingVisits > 0
        ? `${missingPct.toFixed(0)}% of upcoming PM visits have no parts configured at the location.`
        : `${missingCount} upcoming ${visitWord} need parts configured.`;
    insights.push({
      id: "parts-missing",
      title: `${missingCount} ${visitWord} missing parts setup`,
      description,
      // "any missing → warning, large % missing → critical". 50% is
      // the threshold for "large" — a strict majority of upcoming PMs
      // missing parts is operationally severe.
      severity: missingPct > 50 ? "critical" : "warning",
      metricKey: "parts_missing_count",
    });
  }

  return insights;
}
