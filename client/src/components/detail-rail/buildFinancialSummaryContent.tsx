import type { ReactNode } from "react";

export interface FinancialSummaryRow {
  label: string;
  value: string;
  testId?: string;
}

export interface FinancialSummaryContentOptions {
  /** Raw margin percentage (e.g. 42.3 for 42.3%). Used for bar width + display. */
  marginPct: number;
  /** Raw profit dollars — drives isProfit color logic (>= 0 → success, < 0 → danger). */
  profit: number;
  /** True when the underlying data is available; false shows "—" for the margin %. */
  hasData: boolean;
  /** Pre-formatted profit string shown in the profit total row (e.g. "$1,234.56" or "—"). */
  profitValue: string;
  /** Label → value breakdown rows rendered between the bar and the profit total. */
  rows: FinancialSummaryRow[];
  marginTestId?: string;
  marginBarTestId?: string;
  profitTestId?: string;
  /** Defaults to "Profit". */
  profitLabel?: string;
}

/**
 * Shared ReactNode factory for the canonical Financial Summary card extraContent.
 * Renders: Profit Margin KPI hero (text-header) + indicator bar + breakdown rows + profit total.
 * Semantic color tokens: text-success / bg-success for profit >= 0, text-danger / bg-danger otherwise.
 * Used by QuoteDetailPage and InvoiceDetailPage rail Summary tabs.
 */
export function buildFinancialSummaryContent(opts: FinancialSummaryContentOptions): ReactNode {
  const {
    marginPct,
    profit,
    hasData,
    profitValue,
    rows,
    marginTestId,
    marginBarTestId,
    profitTestId,
    profitLabel = "Profit",
  } = opts;

  const isProfit = profit >= 0;
  const barWidth = Math.max(0, Math.min(100, Math.abs(marginPct)));
  const profitColor = isProfit ? "text-success" : "text-danger";
  const barBgColor = isProfit ? "bg-success" : "bg-danger";

  return (
    <div>
      {/* Profit Margin KPI hero — text-header (18px/600) balances
          impact vs rail width; text-label provides the uppercase eyebrow. */}
      <div className="mt-2.5">
        <p className="text-label text-text-muted">Profit Margin</p>
        <p
          className={`text-header tabular-nums leading-none mt-0.5 ${profitColor}`}
          data-testid={marginTestId}
        >
          {hasData ? `${Math.round(marginPct)}%` : "—"}
        </p>
      </div>
      {/* Slim indicator bar — bg-slate-100 track, semantic fill */}
      <div className="h-1 rounded-full bg-slate-100 mt-2 mb-3" data-testid={marginBarTestId}>
        <div
          className={`h-1 rounded-full transition-all ${barBgColor}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      {/* Compact breakdown rows */}
      <div className="space-y-1.5 text-row">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-2">
            <span className="text-text-secondary">{row.label}</span>
            <span className="tabular-nums text-text-primary" data-testid={row.testId}>
              {row.value}
            </span>
          </div>
        ))}
      </div>
      {/* Divider + Profit total — text-emphasis (15px/500) + tonal color */}
      <div
        className={`flex justify-between gap-2 mt-2 pt-2 border-t border-slate-100 text-emphasis ${profitColor}`}
        data-testid={profitTestId}
      >
        <span>{profitLabel}</span>
        <span className="tabular-nums">{profitValue}</span>
      </div>
    </div>
  );
}
