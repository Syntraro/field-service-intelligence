/**
 * Reports — pure formatter / trend-color helpers.
 *
 * Extracted from Reports.tsx so vitest can test these without booting
 * React, lucide-react, or the page's transitive component imports.
 * Reports.tsx re-exports these so the page-level call sites stay
 * unchanged.
 */

import type { MetricPolarity, MetricUnit } from "@shared/reports/snapshot";

export function formatMetricValue(value: number | null, unit: MetricUnit): string {
  if (value == null) return "—";
  switch (unit) {
    case "currency":
      return value.toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      });
    case "percent":
      return `${value.toFixed(1)}%`;
    case "days":
      return `${Math.round(value)}d`;
    case "hours":
      return `${value.toFixed(1)}h`;
    case "count":
    default:
      return value.toLocaleString();
  }
}

export function formatPercentChange(pct: number | null): string {
  if (pct == null) return "—";
  const rounded = Math.abs(pct) >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

/**
 * Decide trend color from the metric's polarity and the change direction.
 * `null` percent change = neutral (gray) — happens when the comparison
 * value was 0 (percent undefined) or the metric reports hasData=false.
 */
export function trendColorClass(
  pct: number | null,
  polarity: MetricPolarity,
): "text-emerald-600" | "text-rose-600" | "text-muted-foreground" {
  if (pct == null || pct === 0) return "text-muted-foreground";
  const isUp = pct > 0;
  const isGood = polarity === "higher_is_better" ? isUp : !isUp;
  return isGood ? "text-emerald-600" : "text-rose-600";
}
