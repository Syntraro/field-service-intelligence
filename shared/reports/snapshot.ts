/**
 * Reports — Company Snapshot canonical contract.
 *
 * One source of truth for the GET /api/reports/snapshot response shape.
 * Both server and client import from here so the JSON shape and metric
 * keys stay in lockstep.
 *
 * Design notes:
 *   - Every metric carries a `hasData` flag. When false, the UI MUST
 *     render an empty state ("Not enough data yet"), not zero. This
 *     prevents fake-looking 0 values from rendering when the underlying
 *     data simply doesn't exist (e.g. unbillable cost when no
 *     time_entries carry a cost rate).
 *   - Percent-change fields are nullable. A null change means the
 *     comparison period had a zero baseline — the percent is undefined.
 *     The UI MUST render "—" in that case, not "Infinity%" or "100%".
 *   - `polarity` declares the metric's direction-of-good. The UI uses
 *     it (NOT a hardcoded list of metric names) to colour trend
 *     indicators green/red. Adding a new metric is one place to update.
 *   - Currency values are emitted as numbers (cents-precise via
 *     server-side rounding). Hour values are emitted as numbers in
 *     hours. `unit` is metadata for the renderer.
 */

export type SnapshotRange = "last_30_days";

export type MetricUnit = "currency" | "count" | "days" | "percent" | "hours";

/**
 * Direction of "good" for trend coloring.
 *   - higher_is_better → ▲ green / ▼ red
 *   - lower_is_better  → ▲ red   / ▼ green
 *
 * Per the spec: revenue/jobs/leads/quotes/conversion are higher_is_better;
 * payment time / AR / overdue / unbillable cost are lower_is_better.
 */
export type MetricPolarity = "higher_is_better" | "lower_is_better";

export interface MetricCard {
  /** Stable identifier — kebab-cased; used for test ids and React keys. */
  key: string;
  /** Human label for the card title. Server-emitted so copy stays canonical. */
  label: string;
  /** Display unit hint for the renderer. */
  unit: MetricUnit;
  /** Color rule for trend arrows. */
  polarity: MetricPolarity;
  /** Selected-period value. May be 0 when hasData=true (real zero) or
   *  null when the metric is structurally missing (e.g. no cost rates). */
  currentValue: number | null;
  previousMonthValue: number | null;
  previousQuarterValue: number | null;
  previousYearValue: number | null;
  /** Percent change from each comparison period to current. Null when
   *  the comparison value is 0 (percent undefined) or hasData=false. */
  monthChangePercent: number | null;
  quarterChangePercent: number | null;
  yearChangePercent: number | null;
  /**
   * False = render the "Not enough data yet" empty state. True = render
   * the value (even if it's a real zero). Server is the sole authority
   * for this flag; client never infers it from the value alone.
   */
  hasData: boolean;
}

/** AR is a snapshot of CURRENT state, not a period comparison. */
export interface ARBucket {
  key: "current" | "d30" | "d60_plus" | "total_overdue";
  label: string;
  amount: number;
  invoiceCount: number;
}

export interface SnapshotResponse {
  range: SnapshotRange;
  /** Canonical absolute window the server actually evaluated. ISO instants. */
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
  revenueCashFlow: {
    metrics: MetricCard[];
  };
  jobsOperations: {
    metrics: MetricCard[];
  };
  sales: {
    metrics: MetricCard[];
  };
  accountsReceivable: {
    /** Current AR snapshot — no period comparisons by design. */
    asOfISO: string;
    buckets: ARBucket[];
  };
}
