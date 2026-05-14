import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Briefcase,
  Clock,
  CreditCard,
  DollarSign,
  FileText,
  HardHat,
  Info,
  Lightbulb,
  ListChecks,
  Receipt,
  Target,
  TriangleAlert,
  Users,
} from "lucide-react";
import type {
  ARBucket,
  MetricCard as MetricCardData,
  MetricUnit,
  MetricPolarity,
  SnapshotResponse,
} from "@shared/reports/snapshot";
import type { FinancialResponse } from "@shared/reports/financial";
import type { OperationsResponse } from "@shared/reports/operations";
import type { SalesResponse } from "@shared/reports/sales";
import type { PartsForecastResponse } from "@shared/reports/partsForecast";
import {
  formatMetricValue,
  formatPercentChange,
  trendColorClass,
} from "@/lib/reportsFormatters";
import { computeInsights, type Insight, type InsightSeverity } from "@/lib/reportsInsights";
import { cn } from "@/lib/utils";

// Re-export so consumers and tests can import either path.
export { formatMetricValue, formatPercentChange, trendColorClass };

// ---------------------------------------------------------------------------
// Reports page (2026-05-02)
//
// Foundation pass: tabs shell + Snapshot tab. Snapshot consumes the canonical
// /api/reports/snapshot endpoint (server is the sole authority for hasData
// flags) and never fabricates values. Detailed Financial / Operations /
// Sales / Team / Equipment tabs render a "Coming soon" library card with
// links to the existing detail routes (timesheets, AR aging) where they
// already exist.
// ---------------------------------------------------------------------------

type ReportsTab = "snapshot" | "financial" | "operations" | "sales" | "team" | "equipment";
type RangeKey = "last_30_days" | "last_quarter" | "last_year";

const RANGE_OPTIONS: Array<{ value: RangeKey; label: string; disabled?: boolean }> = [
  { value: "last_30_days", label: "Last 30 days" },
  // Disabled placeholders — backend only supports last_30_days in this pass.
  // Listed so the user sees the intended option set; they can't render fake
  // numbers because the option is unselectable.
  { value: "last_quarter", label: "Last quarter (coming soon)", disabled: true },
  { value: "last_year", label: "Last year (coming soon)", disabled: true },
];

// 2026-05-02: the Reports library moved to a dedicated page at
// `/reports/library` (component: `client/src/pages/ReportsLibrary.tsx`,
// catalog: `client/src/lib/reportsLibrary.ts`). The "View all reports"
// button now navigates to that route instead of opening an in-page
// sheet, and the Reports page reads `?tab=` + `?section=` query params
// to deep-link the selected section into view.

// ---------------------------------------------------------------------------
// MetricTile — a single card body. Renders empty state when hasData=false.
// ---------------------------------------------------------------------------

function ComparisonRow({
  label,
  value,
  pct,
  unit,
  polarity,
}: {
  label: string;
  value: number | null;
  pct: number | null;
  unit: MetricUnit;
  polarity: MetricPolarity;
}) {
  const colorClass = trendColorClass(pct, polarity);
  const Icon = pct == null || pct === 0 ? null : pct > 0 ? ArrowUp : ArrowDown;
  return (
    <div className="flex items-center justify-between text-helper text-muted-foreground">
      <span>{label}</span>
      <div className="flex items-center gap-1.5 font-medium tabular-nums">
        <span className="text-foreground/80">{formatMetricValue(value, unit)}</span>
        <span className={cn("flex items-center gap-0.5", colorClass)}>
          {Icon && <Icon className="h-3 w-3" />}
          <span>{formatPercentChange(pct)}</span>
        </span>
      </div>
    </div>
  );
}

function MetricTile({ metric }: { metric: MetricCardData }) {
  const testIdSuffix = metric.key.replace(/_/g, "-");

  return (
    <div
      className="rounded-md border border-[#e2e8f0] dark:border-gray-700 bg-white dark:bg-gray-900 p-4 flex flex-col gap-2 min-h-[140px]"
      data-testid={`metric-card-${testIdSuffix}`}
    >
      <div className="text-helper uppercase tracking-[0.04em] text-muted-foreground font-medium">
        {metric.label}
      </div>
      {metric.hasData ? (
        <>
          <div
            className="text-2xl font-semibold tabular-nums text-foreground"
            data-testid={`metric-value-${testIdSuffix}`}
          >
            {formatMetricValue(metric.currentValue, metric.unit)}
          </div>
          <div className="mt-auto space-y-1 pt-2 border-t border-[#e2e8f0]/60 dark:border-gray-700/60">
            <ComparisonRow
              label="Last month"
              value={metric.previousMonthValue}
              pct={metric.monthChangePercent}
              unit={metric.unit}
              polarity={metric.polarity}
            />
            <ComparisonRow
              label="Last quarter"
              value={metric.previousQuarterValue}
              pct={metric.quarterChangePercent}
              unit={metric.unit}
              polarity={metric.polarity}
            />
            <ComparisonRow
              label="Last year"
              value={metric.previousYearValue}
              pct={metric.yearChangePercent}
              unit={metric.unit}
              polarity={metric.polarity}
            />
          </div>
        </>
      ) : (
        <div
          className="flex-1 flex items-center"
          data-testid={`metric-empty-${testIdSuffix}`}
        >
          <p className="text-sm text-muted-foreground">Not enough data yet</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SectionCard — wraps a group of metrics with a header.
// ---------------------------------------------------------------------------

function SectionCard({
  title,
  icon: Icon,
  testId,
  children,
}: {
  title: string;
  icon: React.ElementType;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden" data-testid={testId}>
      <CardHeader className="px-4 py-2.5 border-b">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// AR section — current state, dollar values per bucket.
// ---------------------------------------------------------------------------

function ARBucketTile({ bucket }: { bucket: ARBucket }) {
  const testIdSuffix = bucket.key.replace(/_/g, "-");
  // All AR buckets are dollar values; 30+ and Total overdue use red,
  // Current uses neutral foreground. This is layout-level color, NOT
  // a trend judgment — there's no comparison period for AR.
  const accent =
    bucket.key === "current"
      ? "text-foreground"
      : bucket.amount > 0
        ? "text-rose-600"
        : "text-foreground";
  return (
    <div
      className="rounded-md border border-[#e2e8f0] dark:border-gray-700 bg-white dark:bg-gray-900 p-4 flex flex-col gap-1"
      data-testid={`ar-bucket-${testIdSuffix}`}
    >
      <div className="text-helper uppercase tracking-[0.04em] text-muted-foreground font-medium">
        {bucket.label}
      </div>
      <div
        className={cn("text-2xl font-semibold tabular-nums", accent)}
        data-testid={`ar-amount-${testIdSuffix}`}
      >
        {formatMetricValue(bucket.amount, "currency")}
      </div>
      <div className="text-helper text-muted-foreground">
        {bucket.invoiceCount === 0
          ? "No invoices"
          : `${bucket.invoiceCount} ${bucket.invoiceCount === 1 ? "invoice" : "invoices"}`}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Snapshot tab body
// ---------------------------------------------------------------------------

function ComingSoonTab({ label }: { label: string }) {
  return (
    <Card data-testid={`tab-coming-${label.toLowerCase()}`}>
      <CardContent className="p-8">
        <p className="text-sm text-muted-foreground text-center">
          Detailed {label.toLowerCase()} reports are coming soon. In the meantime, the Snapshot tab
          surfaces the headline {label.toLowerCase()} metrics for the selected period.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Section-level empty copy — used when EVERY metric in a section
 * reports `hasData: false` (or the section ships zero metrics, which
 * the contract doesn't currently allow but we guard against). The
 * user-facing wording matches the per-tile empty state so the page
 * speaks one voice. Per-tile empty states still render when a section
 * is PARTIALLY populated.
 */
function SectionEmpty({ testId }: { testId: string }) {
  return (
    <p
      className="text-sm text-muted-foreground"
      data-testid={`${testId}-empty`}
    >
      Not enough data yet
    </p>
  );
}

function MetricsSection({
  title,
  icon,
  testId,
  metrics,
  gridClassName,
}: {
  title: string;
  icon: React.ElementType;
  testId: string;
  metrics: MetricCardData[];
  gridClassName: string;
}) {
  const allEmpty = metrics.length === 0 || metrics.every((m) => !m.hasData);
  return (
    <SectionCard title={title} icon={icon} testId={testId}>
      {allEmpty ? (
        <SectionEmpty testId={testId} />
      ) : (
        <div className={gridClassName}>
          {metrics.map((m) => (
            <MetricTile key={m.key} metric={m} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function ARSection({ buckets }: { buckets: ARBucket[] }) {
  // AR is empty when no bucket has dollars or invoices in it. We keep
  // the bucket cards visible for partial-empty cases so the user can
  // still see "Current AR: $0 · No invoices" — that's meaningful state.
  // Section-level empty only fires when every bucket is structurally 0.
  const allEmpty =
    buckets.length === 0 ||
    buckets.every((b) => b.amount === 0 && b.invoiceCount === 0);
  return (
    <SectionCard title="Accounts Receivable" icon={Receipt} testId="snapshot-section-ar">
      {allEmpty ? (
        <SectionEmpty testId="snapshot-section-ar" />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {buckets.map((b) => (
            <ARBucketTile key={b.key} bucket={b} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Insights — surfaces deterministic warnings/criticals derived from the
// existing Snapshot + Parts Forecast payloads. NO new SQL: rules are pure
// thresholds applied to already-computed metrics. The whole section hides
// when no insight triggers — never renders a "you're all caught up" card,
// because that would be fabricated reassurance the data may not support.
// ---------------------------------------------------------------------------

const INSIGHT_SEVERITY_STYLES: Record<
  InsightSeverity,
  { border: string; bg: string; iconColor: string; Icon: React.ElementType }
> = {
  info: {
    border: "border-l-sky-500",
    bg: "bg-sky-50/60 dark:bg-sky-900/10",
    iconColor: "text-sky-600",
    Icon: Info,
  },
  warning: {
    border: "border-l-amber-500",
    bg: "bg-amber-50/60 dark:bg-amber-900/10",
    iconColor: "text-amber-600",
    Icon: TriangleAlert,
  },
  critical: {
    border: "border-l-rose-500",
    bg: "bg-rose-50/60 dark:bg-rose-900/10",
    iconColor: "text-rose-600",
    Icon: AlertTriangle,
  },
};

function InsightsSection({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null;
  return (
    <SectionCard
      title="Insights"
      icon={Lightbulb}
      testId="snapshot-section-insights"
    >
      <ul className="space-y-2" data-testid="snapshot-insights-list">
        {insights.map((i) => {
          const style = INSIGHT_SEVERITY_STYLES[i.severity];
          const SeverityIcon = style.Icon;
          return (
            <li
              key={i.id}
              data-testid={`insight-${i.id}`}
              data-severity={i.severity}
              className={cn(
                "rounded-md border-l-4 px-3 py-2",
                style.border,
                style.bg,
              )}
            >
              <div className="flex items-start gap-2">
                <SeverityIcon
                  className={cn("h-4 w-4 mt-0.5 flex-shrink-0", style.iconColor)}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">
                    {i.title}
                  </div>
                  <p className="text-helper text-muted-foreground mt-0.5">
                    {i.description}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

function SnapshotBody({ range }: { range: RangeKey }) {
  const { data, isLoading, isError } = useQuery<SnapshotResponse>({
    queryKey: ["/api/reports/snapshot", range],
    queryFn: () => apiRequest<SnapshotResponse>(`/api/reports/snapshot?range=${range}`),
    staleTime: 60_000,
  });

  // Parts Forecast feeds rule #7 (parts-setup issues). Fetched in parallel
  // — failure of this query MUST NOT block the Snapshot from rendering;
  // the insights rule engine treats `null` as "skip parts insight".
  const { data: partsForecast } = useQuery<PartsForecastResponse>({
    queryKey: ["/api/reports/parts-forecast", "next_30_days"],
    queryFn: () =>
      apiRequest<PartsForecastResponse>(
        `/api/reports/parts-forecast?range=next_30_days`,
      ),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8">
          <p className="text-sm text-muted-foreground text-center">Loading snapshot…</p>
        </CardContent>
      </Card>
    );
  }
  // Full-page error ONLY when the API truly failed. Partial / all-empty
  // payloads still render the section structure with per-section empty
  // states inside, so the user keeps the layout context.
  if (isError || !data) {
    return (
      <Card data-testid="snapshot-error">
        <CardContent className="p-8">
          <p className="text-sm text-muted-foreground text-center">
            We couldn't load the snapshot. Try refreshing in a moment.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Insights derive from the already-fetched payloads — no new query.
  // When parts-forecast hasn't loaded yet (or failed), pass `null` so
  // the parts-setup rule silently skips. Other rules don't depend on
  // it. `useMemo` keeps the rule engine deterministic across re-renders.
  const insights = useMemo(
    () => computeInsights({ snapshot: data, partsForecast: partsForecast ?? null }),
    [data, partsForecast],
  );

  return (
    <div className="space-y-6" data-testid="snapshot-body">
      <InsightsSection insights={insights} />
      <MetricsSection
        title="Revenue & Cash Flow"
        icon={DollarSign}
        testId="snapshot-section-revenue"
        metrics={data.revenueCashFlow.metrics}
        gridClassName="grid grid-cols-1 md:grid-cols-3 gap-3"
      />
      <p
        className="text-[10px] text-muted-foreground/80 -mt-3"
        data-testid="snapshot-cash-basis-note"
      >
        Revenue reflects payment records and excludes voided invoices.
        Refunds and reversals are not included.
      </p>
      <MetricsSection
        title="Jobs & Operations"
        icon={Briefcase}
        testId="snapshot-section-jobs"
        metrics={data.jobsOperations.metrics}
        // 3 metrics this pass: jobs completed · avg job invoice value · unbillable time.
        // Reads as "output + value + efficiency loss"; capped at 3 columns.
        gridClassName="grid grid-cols-1 md:grid-cols-3 gap-3"
      />
      <MetricsSection
        title="Sales (Leads & Quotes)"
        icon={Target}
        testId="snapshot-section-sales"
        metrics={data.sales.metrics}
        gridClassName="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3"
      />
      <ARSection buckets={data.accountsReceivable.buckets} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Financial tab body (2026-05-02 — drill-down for money)
// ---------------------------------------------------------------------------

/** Compact bar — used by the Revenue trend section. The whole row is
 *  a `<div>` track with an inner `<div>` filled to the relative height,
 *  expressed as a percentage of the section max. No third-party chart
 *  library — keeps bundle weight off this surface and matches the
 *  app's existing dashboard aesthetic. */
function TrendBar({
  date,
  amount,
  count,
  pctOfMax,
}: {
  date: string;
  amount: number;
  count: number;
  pctOfMax: number;
}) {
  const heightStyle = { height: `${Math.max(2, pctOfMax)}%` };
  return (
    <div
      className="flex flex-col items-center gap-1 flex-1 min-w-0"
      data-testid={`trend-bar-${date}`}
      title={`${date} · ${formatMetricValue(amount, "currency")} · ${count} payment${count === 1 ? "" : "s"}`}
    >
      <div className="w-full h-24 flex items-end">
        <div
          className={cn(
            "w-full rounded-sm",
            amount > 0 ? "bg-emerald-500/70" : "bg-muted",
          )}
          style={heightStyle}
        />
      </div>
      <div className="text-[10px] text-muted-foreground tabular-nums">
        {date.slice(5)}
      </div>
    </div>
  );
}

function RevenueTrendCard({ section }: { section: FinancialResponse["revenueTrend"] }) {
  const max = section.points.reduce((m, p) => Math.max(m, p.amount), 0);
  return (
    <SectionCard title="Revenue trend" icon={BarChart3} testId="financial-section-revenue-trend">
      {!section.hasData ? (
        <SectionEmpty testId="financial-section-revenue-trend" />
      ) : (
        <div
          className="flex items-end gap-1 px-1"
          data-testid="financial-revenue-trend-chart"
        >
          {section.points.map((p) => (
            <TrendBar
              key={p.date}
              date={p.date}
              amount={p.amount}
              count={p.count}
              pctOfMax={max > 0 ? (p.amount / max) * 100 : 0}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function PaymentBreakdownCard({
  section,
}: {
  section: FinancialResponse["paymentBreakdown"];
}) {
  return (
    <SectionCard
      title="Payments by method"
      icon={CreditCard}
      testId="financial-section-payment-breakdown"
    >
      {!section.hasData ? (
        <SectionEmpty testId="financial-section-payment-breakdown" />
      ) : (
        <div className="space-y-2" data-testid="financial-payment-breakdown-list">
          {section.items.map((item) => (
            <div
              key={item.method}
              className="space-y-1"
              data-testid={`payment-method-${item.method}`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">{item.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatMetricValue(item.totalAmount, "currency")} ·{" "}
                  {item.percentOfTotal.toFixed(1)}%
                </span>
              </div>
              <div className="h-1.5 w-full bg-muted rounded">
                <div
                  className="h-full bg-primary/70 rounded"
                  style={{ width: `${Math.min(100, item.percentOfTotal)}%` }}
                />
              </div>
            </div>
          ))}
          <div className="text-helper text-muted-foreground pt-2 border-t">
            Total: {formatMetricValue(section.totalAmount, "currency")} ·{" "}
            {section.totalCount} payment{section.totalCount === 1 ? "" : "s"}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function FinancialARSection({ section }: { section: FinancialResponse["arAging"] }) {
  return (
    <SectionCard
      title="Accounts Receivable"
      icon={Receipt}
      testId="financial-section-ar"
    >
      {!section.hasData ? (
        <SectionEmpty testId="financial-section-ar" />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {section.buckets.map((b) => {
              const accent =
                b.key === "current"
                  ? "text-foreground"
                  : b.amount > 0
                    ? "text-rose-600"
                    : "text-foreground";
              return (
                <div
                  key={b.key}
                  className="rounded-md border border-[#e2e8f0] dark:border-gray-700 bg-white dark:bg-gray-900 p-4 flex flex-col gap-1"
                  data-testid={`financial-ar-bucket-${b.key}`}
                >
                  <div className="text-helper uppercase tracking-[0.04em] text-muted-foreground font-medium">
                    {b.label}
                  </div>
                  <div className={cn("text-2xl font-semibold tabular-nums", accent)}>
                    {formatMetricValue(b.amount, "currency")}
                  </div>
                  <div className="text-helper text-muted-foreground">
                    {b.invoiceCount === 0
                      ? "No invoices"
                      : `${b.invoiceCount} ${b.invoiceCount === 1 ? "invoice" : "invoices"}`}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-helper text-muted-foreground">
            Total outstanding:{" "}
            <span className="font-medium tabular-nums text-foreground">
              {formatMetricValue(section.totalOutstanding, "currency")}
            </span>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function InvoiceStatusCard({
  section,
}: {
  section: FinancialResponse["invoiceStatus"];
}) {
  return (
    <SectionCard
      title="Invoices by status"
      icon={FileText}
      testId="financial-section-invoice-status"
    >
      {!section.hasData ? (
        <SectionEmpty testId="financial-section-invoice-status" />
      ) : (
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"
          data-testid="financial-invoice-status-list"
        >
          {section.items.map((item) => (
            <div
              key={item.key}
              className="rounded-md border border-[#e2e8f0] dark:border-gray-700 bg-white dark:bg-gray-900 p-3"
              data-testid={`invoice-status-${item.key}`}
            >
              <div className="text-helper uppercase tracking-[0.04em] text-muted-foreground font-medium">
                {item.label}
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-xl font-semibold tabular-nums">{item.count}</span>
                <span className="text-helper text-muted-foreground tabular-nums">
                  {formatMetricValue(item.totalAmount, "currency")}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function PaymentTimeCard({ metric }: { metric: MetricCardData }) {
  return (
    <SectionCard
      title="Invoice payment time"
      icon={Clock}
      testId="financial-section-payment-time"
    >
      {!metric.hasData ? (
        <SectionEmpty testId="financial-section-payment-time" />
      ) : (
        // Reuse MetricTile so the comparison rows render identically to
        // the Snapshot tab's KPI cards. Single-tile layout — payment time
        // is the only metric in this section.
        <div className="max-w-sm">
          <MetricTile metric={metric} />
        </div>
      )}
    </SectionCard>
  );
}

function TopOutstandingClientsCard({
  section,
}: {
  section: FinancialResponse["topOutstandingClients"];
}) {
  return (
    <SectionCard
      title="Top outstanding clients"
      icon={Users}
      testId="financial-section-top-clients"
    >
      {!section.hasData ? (
        <SectionEmpty testId="financial-section-top-clients" />
      ) : (
        <ul className="divide-y divide-[#e2e8f0] dark:divide-gray-700" data-testid="financial-top-clients-list">
          {section.items.map((c, idx) => (
            <li
              key={c.clientId}
              className="flex items-center justify-between gap-3 py-2"
              data-testid={`top-client-row-${idx}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-helper text-muted-foreground tabular-nums w-5 text-right">
                  {idx + 1}
                </span>
                <span className="text-sm font-medium truncate" data-testid={`top-client-name-${idx}`}>
                  {c.name}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs whitespace-nowrap">
                <span className="text-muted-foreground tabular-nums">
                  {c.invoiceCount} {c.invoiceCount === 1 ? "invoice" : "invoices"}
                </span>
                <span
                  className="font-semibold tabular-nums text-rose-600"
                  data-testid={`top-client-amount-${idx}`}
                >
                  {formatMetricValue(c.totalOutstanding, "currency")}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function FinancialBody({ range }: { range: RangeKey }) {
  const { data, isLoading, isError } = useQuery<FinancialResponse>({
    queryKey: ["/api/reports/financial", range],
    queryFn: () =>
      apiRequest<FinancialResponse>(`/api/reports/financial?range=${range}`),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8">
          <p className="text-sm text-muted-foreground text-center">
            Loading financial report…
          </p>
        </CardContent>
      </Card>
    );
  }
  // Full-page error ONLY on a true API failure. Sections handle their
  // own empty states inline so partial-data tenants keep the layout.
  if (isError || !data) {
    return (
      <Card data-testid="financial-error">
        <CardContent className="p-8">
          <p className="text-sm text-muted-foreground text-center">
            We couldn't load the financial report. Try refreshing in a moment.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="financial-body">
      <MetricsSection
        title="Financial summary"
        icon={DollarSign}
        testId="financial-section-kpis"
        metrics={data.kpis.metrics}
        // 5 KPIs: revenue · payments collected · outstanding AR · overdue AR · payment time.
        gridClassName="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3"
      />
      <p
        className="text-[10px] text-muted-foreground/80 -mt-3"
        data-testid="financial-cash-basis-note"
      >
        Revenue reflects payment records and excludes voided invoices.
        Refunds and reversals are not included.
      </p>
      <RevenueTrendCard section={data.revenueTrend} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PaymentBreakdownCard section={data.paymentBreakdown} />
        <PaymentTimeCard metric={data.paymentTime} />
      </div>
      <FinancialARSection section={data.arAging} />
      <InvoiceStatusCard section={data.invoiceStatus} />
      <TopOutstandingClientsCard section={data.topOutstandingClients} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Operations tab body (2026-05-02 — drill-down for jobs + efficiency)
// ---------------------------------------------------------------------------

/** Daily count bar — same TrendBar pattern, sized to count instead of
 *  amount. Used by the Job Completion Trend card. */
function CountBar({
  date,
  count,
  pctOfMax,
}: {
  date: string;
  count: number;
  pctOfMax: number;
}) {
  const heightStyle = { height: `${Math.max(2, pctOfMax)}%` };
  return (
    <div
      className="flex flex-col items-center gap-1 flex-1 min-w-0"
      data-testid={`completion-bar-${date}`}
      title={`${date} · ${count} job${count === 1 ? "" : "s"} completed`}
    >
      <div className="w-full h-24 flex items-end">
        <div
          className={cn(
            "w-full rounded-sm",
            count > 0 ? "bg-sky-500/70" : "bg-muted",
          )}
          style={heightStyle}
        />
      </div>
      <div className="text-[10px] text-muted-foreground tabular-nums">
        {date.slice(5)}
      </div>
    </div>
  );
}

function JobCompletionTrendCard({
  section,
}: {
  section: OperationsResponse["completionTrend"];
}) {
  const max = section.points.reduce((m, p) => Math.max(m, p.count), 0);
  return (
    <SectionCard
      title="Job completion trend"
      icon={BarChart3}
      testId="operations-section-completion-trend"
    >
      {!section.hasData ? (
        <SectionEmpty testId="operations-section-completion-trend" />
      ) : (
        <div
          className="flex items-end gap-1 px-1"
          data-testid="operations-completion-trend-chart"
        >
          {section.points.map((p) => (
            <CountBar
              key={p.date}
              date={p.date}
              count={p.count}
              pctOfMax={max > 0 ? (p.count / max) * 100 : 0}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function JobStatusBreakdownCard({
  section,
}: {
  section: OperationsResponse["jobStatus"];
}) {
  return (
    <SectionCard
      title="Jobs by status"
      icon={ListChecks}
      testId="operations-section-job-status"
    >
      {!section.hasData ? (
        <SectionEmpty testId="operations-section-job-status" />
      ) : (
        <div className="space-y-2" data-testid="operations-job-status-list">
          {section.items.map((item) => (
            <div
              key={item.key}
              className="space-y-1"
              data-testid={`job-status-${item.key}`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">{item.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {item.count.toLocaleString()} · {item.percentOfTotal.toFixed(1)}%
                </span>
              </div>
              <div className="h-1.5 w-full bg-muted rounded">
                <div
                  className="h-full bg-primary/70 rounded"
                  style={{ width: `${Math.min(100, item.percentOfTotal)}%` }}
                />
              </div>
            </div>
          ))}
          <div className="text-helper text-muted-foreground pt-2 border-t">
            Total: {section.totalCount.toLocaleString()} job
            {section.totalCount === 1 ? "" : "s"}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function AvgJobValueBar({
  date,
  avgValue,
  invoiceCount,
  pctOfMax,
}: {
  date: string;
  avgValue: number;
  invoiceCount: number;
  pctOfMax: number;
}) {
  const heightStyle = { height: `${Math.max(2, pctOfMax)}%` };
  return (
    <div
      className="flex flex-col items-center gap-1 flex-1 min-w-0"
      data-testid={`avg-value-bar-${date}`}
      title={`${date} · ${formatMetricValue(avgValue, "currency")} avg · ${invoiceCount} invoice${invoiceCount === 1 ? "" : "s"}`}
    >
      <div className="w-full h-24 flex items-end">
        <div
          className={cn(
            "w-full rounded-sm",
            avgValue > 0 ? "bg-emerald-500/70" : "bg-muted",
          )}
          style={heightStyle}
        />
      </div>
      <div className="text-[10px] text-muted-foreground tabular-nums">
        {date.slice(5)}
      </div>
    </div>
  );
}

function AvgJobValueTrendCard({
  section,
}: {
  section: OperationsResponse["avgJobValueTrend"];
}) {
  const max = section.points.reduce((m, p) => Math.max(m, p.avgValue), 0);
  return (
    <SectionCard
      title="Avg job invoice value trend"
      icon={DollarSign}
      testId="operations-section-avg-value-trend"
    >
      {!section.hasData ? (
        <SectionEmpty testId="operations-section-avg-value-trend" />
      ) : (
        <div
          className="flex items-end gap-1 px-1"
          data-testid="operations-avg-value-trend-chart"
        >
          {section.points.map((p) => (
            <AvgJobValueBar
              key={p.date}
              date={p.date}
              avgValue={p.avgValue}
              invoiceCount={p.invoiceCount}
              pctOfMax={max > 0 ? (p.avgValue / max) * 100 : 0}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function UnbillableBreakdownCard({
  section,
}: {
  section: OperationsResponse["unbillableBreakdown"];
}) {
  return (
    <SectionCard
      title="Unbillable time by category"
      icon={Clock}
      testId="operations-section-unbillable-breakdown"
    >
      {!section.hasData ? (
        <SectionEmpty testId="operations-section-unbillable-breakdown" />
      ) : (
        <div
          className="space-y-2"
          data-testid="operations-unbillable-breakdown-list"
        >
          {section.items.map((item) => (
            <div
              key={item.type}
              className="space-y-1"
              data-testid={`unbillable-type-${item.type}`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">{item.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatMetricValue(item.cost, "currency")} ·{" "}
                  {item.percentOfTotal.toFixed(1)}%
                </span>
              </div>
              <div className="h-1.5 w-full bg-muted rounded">
                <div
                  className="h-full bg-rose-500/70 rounded"
                  style={{ width: `${Math.min(100, item.percentOfTotal)}%` }}
                />
              </div>
              <div className="text-[10px] text-muted-foreground tabular-nums">
                {item.hours.toFixed(1)}h · {item.count} entr
                {item.count === 1 ? "y" : "ies"}
              </div>
            </div>
          ))}
          <div className="text-helper text-muted-foreground pt-2 border-t">
            Total: {formatMetricValue(section.totalCost, "currency")} ·{" "}
            {section.totalHours.toFixed(1)}h · {section.totalCount} entr
            {section.totalCount === 1 ? "y" : "ies"}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function OperationsBody({ range }: { range: RangeKey }) {
  const { data, isLoading, isError } = useQuery<OperationsResponse>({
    queryKey: ["/api/reports/operations", range],
    queryFn: () =>
      apiRequest<OperationsResponse>(`/api/reports/operations?range=${range}`),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8">
          <p className="text-sm text-muted-foreground text-center">
            Loading operations report…
          </p>
        </CardContent>
      </Card>
    );
  }
  if (isError || !data) {
    return (
      <Card data-testid="operations-error">
        <CardContent className="p-8">
          <p className="text-sm text-muted-foreground text-center">
            We couldn't load the operations report. Try refreshing in a moment.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="operations-body">
      <MetricsSection
        title="Operations summary"
        icon={Briefcase}
        testId="operations-section-kpis"
        metrics={data.kpis.metrics}
        // 3 KPIs: jobs completed · avg job invoice value · unbillable cost.
        // Same metrics + polarity rules as the Snapshot tab's Jobs &
        // Operations section.
        gridClassName="grid grid-cols-1 md:grid-cols-3 gap-3"
      />
      <JobCompletionTrendCard section={data.completionTrend} />
      <JobStatusBreakdownCard section={data.jobStatus} />
      <AvgJobValueTrendCard section={data.avgJobValueTrend} />
      <UnbillableBreakdownCard section={data.unbillableBreakdown} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sales tab body (2026-05-02 — drill-down for leads + quotes)
// ---------------------------------------------------------------------------

/** Lead/quote count bar. Reuses the CountBar visual pattern but is a
 *  separate component because the test ids and tooltip wording differ
 *  between the leads and quotes contexts. */
function SalesCountBar({
  date,
  count,
  pctOfMax,
  testIdPrefix,
  noun,
  accent,
}: {
  date: string;
  count: number;
  pctOfMax: number;
  testIdPrefix: string;
  noun: string;
  accent: string;
}) {
  const heightStyle = { height: `${Math.max(2, pctOfMax)}%` };
  return (
    <div
      className="flex flex-col items-center gap-1 flex-1 min-w-0"
      data-testid={`${testIdPrefix}-${date}`}
      title={`${date} · ${count} ${noun}${count === 1 ? "" : "s"}`}
    >
      <div className="w-full h-24 flex items-end">
        <div
          className={cn(
            "w-full rounded-sm",
            count > 0 ? accent : "bg-muted",
          )}
          style={heightStyle}
        />
      </div>
      <div className="text-[10px] text-muted-foreground tabular-nums">
        {date.slice(5)}
      </div>
    </div>
  );
}

function SalesConversionBar({
  date,
  conversionPercent,
  createdCount,
  convertedCount,
  testIdPrefix,
  noun,
}: {
  date: string;
  conversionPercent: number;
  createdCount: number;
  convertedCount: number;
  testIdPrefix: string;
  noun: string;
}) {
  // Conversion bars are scaled to 0–100 directly — no per-section max
  // needed, the ceiling is fixed.
  const heightStyle = { height: `${Math.max(2, conversionPercent)}%` };
  return (
    <div
      className="flex flex-col items-center gap-1 flex-1 min-w-0"
      data-testid={`${testIdPrefix}-${date}`}
      title={`${date} · ${conversionPercent.toFixed(1)}% (${convertedCount}/${createdCount} ${noun}${createdCount === 1 ? "" : "s"})`}
    >
      <div className="w-full h-24 flex items-end">
        <div
          className={cn(
            "w-full rounded-sm",
            createdCount > 0 ? "bg-amber-500/70" : "bg-muted",
          )}
          style={heightStyle}
        />
      </div>
      <div className="text-[10px] text-muted-foreground tabular-nums">
        {date.slice(5)}
      </div>
    </div>
  );
}

function LeadCreationTrendCard({
  section,
}: {
  section: SalesResponse["leadCreationTrend"];
}) {
  const max = section.points.reduce((m, p) => Math.max(m, p.count), 0);
  return (
    <SectionCard
      title="Lead creation trend"
      icon={Target}
      testId="sales-section-lead-creation"
    >
      {!section.hasData ? (
        <SectionEmpty testId="sales-section-lead-creation" />
      ) : (
        <div
          className="flex items-end gap-1 px-1"
          data-testid="sales-lead-creation-chart"
        >
          {section.points.map((p) => (
            <SalesCountBar
              key={p.date}
              date={p.date}
              count={p.count}
              pctOfMax={max > 0 ? (p.count / max) * 100 : 0}
              testIdPrefix="lead-creation-bar"
              noun="lead"
              accent="bg-sky-500/70"
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function LeadConversionTrendCard({
  section,
}: {
  section: SalesResponse["leadConversionTrend"];
}) {
  return (
    <SectionCard
      title="Lead conversion trend"
      icon={Target}
      testId="sales-section-lead-conversion"
    >
      {!section.hasData ? (
        <SectionEmpty testId="sales-section-lead-conversion" />
      ) : (
        <div
          className="flex items-end gap-1 px-1"
          data-testid="sales-lead-conversion-chart"
        >
          {section.points.map((p) => (
            <SalesConversionBar
              key={p.date}
              date={p.date}
              conversionPercent={p.conversionPercent}
              createdCount={p.createdCount}
              convertedCount={p.convertedCount}
              testIdPrefix="lead-conversion-bar"
              noun="lead"
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function QuoteCreationTrendCard({
  section,
}: {
  section: SalesResponse["quoteCreationTrend"];
}) {
  const max = section.points.reduce((m, p) => Math.max(m, p.count), 0);
  return (
    <SectionCard
      title="Quote creation trend"
      icon={FileText}
      testId="sales-section-quote-creation"
    >
      {!section.hasData ? (
        <SectionEmpty testId="sales-section-quote-creation" />
      ) : (
        <div
          className="flex items-end gap-1 px-1"
          data-testid="sales-quote-creation-chart"
        >
          {section.points.map((p) => (
            <SalesCountBar
              key={p.date}
              date={p.date}
              count={p.count}
              pctOfMax={max > 0 ? (p.count / max) * 100 : 0}
              testIdPrefix="quote-creation-bar"
              noun="quote"
              accent="bg-emerald-500/70"
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function QuoteConversionTrendCard({
  section,
}: {
  section: SalesResponse["quoteConversionTrend"];
}) {
  return (
    <SectionCard
      title="Quote conversion trend"
      icon={FileText}
      testId="sales-section-quote-conversion"
    >
      {!section.hasData ? (
        <SectionEmpty testId="sales-section-quote-conversion" />
      ) : (
        <div
          className="flex items-end gap-1 px-1"
          data-testid="sales-quote-conversion-chart"
        >
          {section.points.map((p) => (
            <SalesConversionBar
              key={p.date}
              date={p.date}
              conversionPercent={p.conversionPercent}
              createdCount={p.createdCount}
              convertedCount={p.convertedCount}
              testIdPrefix="quote-conversion-bar"
              noun="quote"
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function StatusBreakdownList({
  items,
  totalCount,
  noun,
  testIdPrefix,
}: {
  items: Array<{ key: string; label: string; count: number; percentOfTotal: number }>;
  totalCount: number;
  noun: string;
  testIdPrefix: string;
}) {
  return (
    <div className="space-y-2" data-testid={`${testIdPrefix}-list`}>
      {items.map((item) => (
        <div
          key={item.key}
          className="space-y-1"
          data-testid={`${testIdPrefix}-${item.key}`}
        >
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">{item.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {item.count.toLocaleString()} · {item.percentOfTotal.toFixed(1)}%
            </span>
          </div>
          <div className="h-1.5 w-full bg-muted rounded">
            <div
              className="h-full bg-primary/70 rounded"
              style={{ width: `${Math.min(100, item.percentOfTotal)}%` }}
            />
          </div>
        </div>
      ))}
      <div className="text-helper text-muted-foreground pt-2 border-t">
        Total: {totalCount.toLocaleString()} {noun}
        {totalCount === 1 ? "" : "s"}
      </div>
    </div>
  );
}

function LeadStatusBreakdownCard({
  section,
}: {
  section: SalesResponse["leadStatusBreakdown"];
}) {
  return (
    <SectionCard
      title="Leads by status"
      icon={ListChecks}
      testId="sales-section-lead-status"
    >
      {!section.hasData ? (
        <SectionEmpty testId="sales-section-lead-status" />
      ) : (
        <StatusBreakdownList
          items={section.items}
          totalCount={section.totalCount}
          noun="lead"
          testIdPrefix="lead-status"
        />
      )}
    </SectionCard>
  );
}

function QuoteStatusBreakdownCard({
  section,
}: {
  section: SalesResponse["quoteStatusBreakdown"];
}) {
  return (
    <SectionCard
      title="Quotes by status"
      icon={ListChecks}
      testId="sales-section-quote-status"
    >
      {!section.hasData ? (
        <SectionEmpty testId="sales-section-quote-status" />
      ) : (
        <StatusBreakdownList
          items={section.items}
          totalCount={section.totalCount}
          noun="quote"
          testIdPrefix="quote-status"
        />
      )}
    </SectionCard>
  );
}

function SalesBody({ range }: { range: RangeKey }) {
  const { data, isLoading, isError } = useQuery<SalesResponse>({
    queryKey: ["/api/reports/sales", range],
    queryFn: () => apiRequest<SalesResponse>(`/api/reports/sales?range=${range}`),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8">
          <p className="text-sm text-muted-foreground text-center">
            Loading sales report…
          </p>
        </CardContent>
      </Card>
    );
  }
  // Full-page error ONLY on a true API failure. Per-section empty
  // states handle partial payloads inside the layout.
  if (isError || !data) {
    return (
      <Card data-testid="sales-error">
        <CardContent className="p-8">
          <p className="text-sm text-muted-foreground text-center">
            We couldn't load the sales report. Try refreshing in a moment.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="sales-body">
      <MetricsSection
        title="Sales summary"
        icon={Target}
        testId="sales-section-kpis"
        metrics={data.kpis.metrics}
        // 4 KPIs in spec order: leads created · lead conversion ·
        // quotes created · quote conversion. Same metrics + polarity
        // rules as the Snapshot tab's Sales section.
        gridClassName="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3"
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LeadCreationTrendCard section={data.leadCreationTrend} />
        <LeadConversionTrendCard section={data.leadConversionTrend} />
        <QuoteCreationTrendCard section={data.quoteCreationTrend} />
        <QuoteConversionTrendCard section={data.quoteConversionTrend} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LeadStatusBreakdownCard section={data.leadStatusBreakdown} />
        <QuoteStatusBreakdownCard section={data.quoteStatusBreakdown} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Reports() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<ReportsTab>("snapshot");
  const [range, setRange] = useState<RangeKey>("last_30_days");

  // 2026-05-02: deep-link support for the Reports Library page.
  // `/reports?tab=<x>&section=<testId>` opens the requested tab and
  // scrolls the section card into view. Read once on mount + on
  // subsequent location changes (e.g. when the library page navigates
  // back here with new params).
  const [searchTick, setSearchTick] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setSearchTick((n) => n + 1);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    const sectionParam = params.get("section");
    const validTabs: ReportsTab[] = [
      "snapshot",
      "financial",
      "operations",
      "sales",
      "team",
      "equipment",
    ];
    if (tabParam && (validTabs as string[]).includes(tabParam)) {
      setActiveTab(tabParam as ReportsTab);
    }
    if (sectionParam) {
      // Defer the scroll until after the tab content mounts. Two RAFs
      // covers React's commit + the children's first paint without
      // resorting to a fixed timeout.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = document.querySelector<HTMLElement>(
            `[data-testid="${sectionParam}"]`,
          );
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
    }
  }, [searchTick]);

  const tabIcons = useMemo(
    () => ({
      snapshot: BarChart3,
      financial: DollarSign,
      operations: Briefcase,
      sales: Target,
      team: Users,
      equipment: HardHat,
    }),
    [],
  );

  return (
    <div className="min-h-screen bg-background" data-testid="reports-page">
      <main className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <FileText className="h-7 w-7 text-primary" />
            <h1 className="text-title font-semibold" data-testid="reports-title">
              Reports
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/reports/library")}
              data-testid="button-view-all-reports"
            >
              <ListChecks className="h-4 w-4 mr-2" />
              View all reports
            </Button>
            <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
              <SelectTrigger className="w-44" data-testid="select-reports-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    disabled={opt.disabled}
                  >
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as ReportsTab)}
          className="space-y-6"
        >
          <TabsList data-testid="tabs-reports">
            <TabsTrigger value="snapshot" data-testid="tab-snapshot">
              <tabIcons.snapshot className="h-4 w-4 mr-2" />
              Snapshot
            </TabsTrigger>
            <TabsTrigger value="financial" data-testid="tab-financial">
              <tabIcons.financial className="h-4 w-4 mr-2" />
              Financial
            </TabsTrigger>
            <TabsTrigger value="operations" data-testid="tab-operations">
              <tabIcons.operations className="h-4 w-4 mr-2" />
              Operations
            </TabsTrigger>
            <TabsTrigger value="sales" data-testid="tab-sales">
              <tabIcons.sales className="h-4 w-4 mr-2" />
              Sales
            </TabsTrigger>
            <TabsTrigger value="team" data-testid="tab-team">
              <tabIcons.team className="h-4 w-4 mr-2" />
              Team
            </TabsTrigger>
            <TabsTrigger value="equipment" data-testid="tab-equipment">
              <tabIcons.equipment className="h-4 w-4 mr-2" />
              Equipment
            </TabsTrigger>
          </TabsList>

          <TabsContent value="snapshot">
            <SnapshotBody range={range} />
          </TabsContent>
          <TabsContent value="financial">
            <FinancialBody range={range} />
          </TabsContent>
          <TabsContent value="operations">
            <OperationsBody range={range} />
          </TabsContent>
          <TabsContent value="sales">
            <SalesBody range={range} />
          </TabsContent>
          <TabsContent value="team">
            <ComingSoonTab label="Team" />
          </TabsContent>
          <TabsContent value="equipment">
            <ComingSoonTab label="Equipment" />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
