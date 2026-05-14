import { useEffect, useState } from "react";
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
import { Button } from "@/components/ui/button";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Clock,
  FileText,
  Filter,
  ListChecks,
  Target,
} from "lucide-react";
import {
  formatMetricValue,
  formatPercentChange,
  trendColorClass,
} from "@/lib/reportsFormatters";
import type {
  SalesFunnelResponse,
  MetricCard as MetricCardData,
} from "@shared/reports/salesFunnel";
import type { MetricUnit, MetricPolarity } from "@shared/reports/snapshot";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Reports → Sales Funnel deep-report (`/reports/sales-funnel`)
// Standalone page (NOT a tab). Reuses every Sales tab section helper
// (lifted into reportsCommon) and adds two Funnel-specific views: a
// fixed 4-stage funnel visualization and a conversion-lag card.
// ---------------------------------------------------------------------------

type RangeKey = "last_30_days" | "last_quarter" | "last_year";

const RANGE_OPTIONS: Array<{ value: RangeKey; label: string; disabled?: boolean }> = [
  { value: "last_30_days", label: "Last 30 days" },
  { value: "last_quarter", label: "Last quarter (coming soon)", disabled: true },
  { value: "last_year", label: "Last year (coming soon)", disabled: true },
];

// ---------------------------------------------------------------------------
// SectionCard / SectionEmpty primitives — same as the other deep-reports.
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

function SectionEmpty({ testId }: { testId: string }) {
  return (
    <p className="text-sm text-muted-foreground" data-testid={`${testId}-empty`}>
      Not enough data yet
    </p>
  );
}

// ---------------------------------------------------------------------------
// MetricTile — standard layout
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
// Funnel visualization — 4 stages, each rendered as a horizontal bar
// whose width is the stage's count as a share of the top stage's
// count. Caller renders backend stages verbatim; no client reordering.
// ---------------------------------------------------------------------------

function FunnelCard({
  section,
}: {
  section: SalesFunnelResponse["funnel"];
}) {
  // The top stage drives the bar width. When the top stage is 0 (rare:
  // tenants that book quotes directly), fall back to the largest
  // non-zero stage so the bars still render proportionally.
  const max = section.stages.reduce((m, s) => Math.max(m, s.count), 0);
  return (
    <SectionCard
      title="Sales funnel"
      icon={Filter}
      testId="sales-funnel-section-funnel"
    >
      {!section.hasData ? (
        <SectionEmpty testId="sales-funnel-section-funnel" />
      ) : (
        <div className="space-y-2" data-testid="sales-funnel-stages">
          {section.stages.map((stage) => (
            <div
              key={stage.key}
              className="space-y-1"
              data-testid={`sales-funnel-stage-${stage.key}`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">{stage.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {stage.count.toLocaleString()}
                  {stage.percentOfPrevious != null
                    ? ` · ${stage.percentOfPrevious.toFixed(1)}% of previous`
                    : ""}
                </span>
              </div>
              <div className="h-3 w-full bg-muted rounded">
                <div
                  className="h-full bg-primary/70 rounded"
                  style={{
                    width: `${
                      max > 0 ? Math.min(100, (stage.count / max) * 100) : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Trend bars (count + conversion)
// ---------------------------------------------------------------------------

function CountBar({
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

function ConversionBar({
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
  section: SalesFunnelResponse["leadCreationTrend"];
}) {
  const max = section.points.reduce((m, p) => Math.max(m, p.count), 0);
  return (
    <SectionCard
      title="Lead creation trend"
      icon={Target}
      testId="sales-funnel-section-lead-creation"
    >
      {!section.hasData ? (
        <SectionEmpty testId="sales-funnel-section-lead-creation" />
      ) : (
        <div
          className="flex items-end gap-1 px-1"
          data-testid="sales-funnel-lead-creation-chart"
        >
          {section.points.map((p) => (
            <CountBar
              key={p.date}
              date={p.date}
              count={p.count}
              pctOfMax={max > 0 ? (p.count / max) * 100 : 0}
              testIdPrefix="sales-funnel-lead-creation-bar"
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
  section: SalesFunnelResponse["leadConversionTrend"];
}) {
  return (
    <SectionCard
      title="Lead conversion trend"
      icon={Target}
      testId="sales-funnel-section-lead-conversion"
    >
      {!section.hasData ? (
        <SectionEmpty testId="sales-funnel-section-lead-conversion" />
      ) : (
        <div
          className="flex items-end gap-1 px-1"
          data-testid="sales-funnel-lead-conversion-chart"
        >
          {section.points.map((p) => (
            <ConversionBar
              key={p.date}
              date={p.date}
              conversionPercent={p.conversionPercent}
              createdCount={p.createdCount}
              convertedCount={p.convertedCount}
              testIdPrefix="sales-funnel-lead-conversion-bar"
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
  section: SalesFunnelResponse["quoteCreationTrend"];
}) {
  const max = section.points.reduce((m, p) => Math.max(m, p.count), 0);
  return (
    <SectionCard
      title="Quote creation trend"
      icon={FileText}
      testId="sales-funnel-section-quote-creation"
    >
      {!section.hasData ? (
        <SectionEmpty testId="sales-funnel-section-quote-creation" />
      ) : (
        <div
          className="flex items-end gap-1 px-1"
          data-testid="sales-funnel-quote-creation-chart"
        >
          {section.points.map((p) => (
            <CountBar
              key={p.date}
              date={p.date}
              count={p.count}
              pctOfMax={max > 0 ? (p.count / max) * 100 : 0}
              testIdPrefix="sales-funnel-quote-creation-bar"
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
  section: SalesFunnelResponse["quoteConversionTrend"];
}) {
  return (
    <SectionCard
      title="Quote conversion trend"
      icon={FileText}
      testId="sales-funnel-section-quote-conversion"
    >
      {!section.hasData ? (
        <SectionEmpty testId="sales-funnel-section-quote-conversion" />
      ) : (
        <div
          className="flex items-end gap-1 px-1"
          data-testid="sales-funnel-quote-conversion-chart"
        >
          {section.points.map((p) => (
            <ConversionBar
              key={p.date}
              date={p.date}
              conversionPercent={p.conversionPercent}
              createdCount={p.createdCount}
              convertedCount={p.convertedCount}
              testIdPrefix="sales-funnel-quote-conversion-bar"
              noun="quote"
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Status breakdown lists
// ---------------------------------------------------------------------------

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
  section: SalesFunnelResponse["leadStatus"];
}) {
  return (
    <SectionCard
      title="Leads by status"
      icon={ListChecks}
      testId="sales-funnel-section-lead-status"
    >
      {!section.hasData ? (
        <SectionEmpty testId="sales-funnel-section-lead-status" />
      ) : (
        <StatusBreakdownList
          items={section.items}
          totalCount={section.totalCount}
          noun="lead"
          testIdPrefix="sales-funnel-lead-status"
        />
      )}
    </SectionCard>
  );
}

function QuoteStatusBreakdownCard({
  section,
}: {
  section: SalesFunnelResponse["quoteStatus"];
}) {
  return (
    <SectionCard
      title="Quotes by status"
      icon={ListChecks}
      testId="sales-funnel-section-quote-status"
    >
      {!section.hasData ? (
        <SectionEmpty testId="sales-funnel-section-quote-status" />
      ) : (
        <StatusBreakdownList
          items={section.items}
          totalCount={section.totalCount}
          noun="quote"
          testIdPrefix="sales-funnel-quote-status"
        />
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Conversion lag — average days created → converted
// ---------------------------------------------------------------------------

function ConversionLagCard({
  section,
}: {
  section: SalesFunnelResponse["conversionLag"];
}) {
  return (
    <SectionCard
      title="Conversion lag"
      icon={Clock}
      testId="sales-funnel-section-conversion-lag"
    >
      {!section.hasData ? (
        <SectionEmpty testId="sales-funnel-section-conversion-lag" />
      ) : (
        <div
          className="grid grid-cols-1 md:grid-cols-2 gap-3"
          data-testid="sales-funnel-conversion-lag-body"
        >
          <div
            className="rounded-md border border-[#e2e8f0] dark:border-gray-700 bg-white dark:bg-gray-900 p-4"
            data-testid="sales-funnel-conversion-lag-leads"
          >
            <div className="text-helper uppercase tracking-[0.04em] text-muted-foreground font-medium">
              Lead → conversion
            </div>
            <div className="text-2xl font-semibold tabular-nums text-foreground mt-1">
              {section.leads.count > 0
                ? `${section.leads.avgDays.toFixed(1)}d`
                : "—"}
            </div>
            <div className="text-helper text-muted-foreground">
              {section.leads.count.toLocaleString()} converted lead
              {section.leads.count === 1 ? "" : "s"} in window
            </div>
            <div
              className="text-[10px] text-muted-foreground mt-1"
              data-testid="sales-funnel-conversion-lag-leads-coverage"
            >
              {section.leads.coveragePercent == null
                ? "Coverage —"
                : `Coverage ${section.leads.coveragePercent.toFixed(1)}%`}
            </div>
          </div>
          <div
            className="rounded-md border border-[#e2e8f0] dark:border-gray-700 bg-white dark:bg-gray-900 p-4"
            data-testid="sales-funnel-conversion-lag-quotes"
          >
            <div className="text-helper uppercase tracking-[0.04em] text-muted-foreground font-medium">
              Quote → conversion
            </div>
            <div className="text-2xl font-semibold tabular-nums text-foreground mt-1">
              {section.quotes.count > 0
                ? `${section.quotes.avgDays.toFixed(1)}d`
                : "—"}
            </div>
            <div className="text-helper text-muted-foreground">
              {section.quotes.count.toLocaleString()} converted quote
              {section.quotes.count === 1 ? "" : "s"} in window
            </div>
            <div
              className="text-[10px] text-muted-foreground mt-1"
              data-testid="sales-funnel-conversion-lag-quotes-coverage"
            >
              {section.quotes.coveragePercent == null
                ? "Coverage —"
                : `Coverage ${section.quotes.coveragePercent.toFixed(1)}%`}
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReportsSalesFunnel() {
  const [, setLocation] = useLocation();
  const [range, setRange] = useState<RangeKey>("last_30_days");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const r = params.get("range");
    if (r === "last_30_days") setRange(r);
  }, []);

  const { data, isLoading, isError } = useQuery<SalesFunnelResponse>({
    queryKey: ["/api/reports/sales-funnel", range],
    queryFn: () =>
      apiRequest<SalesFunnelResponse>(`/api/reports/sales-funnel?range=${range}`),
    staleTime: 60_000,
  });

  return (
    <div
      className="min-h-screen bg-background"
      data-testid="reports-sales-funnel-page"
    >
      <main className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Filter className="h-7 w-7 text-primary" />
            <div>
              <h1
                className="text-2xl font-semibold"
                data-testid="reports-sales-funnel-title"
              >
                Sales Funnel
              </h1>
              <p className="text-helper text-muted-foreground">
                Lead and quote progression — creation, conversion, drop-off,
                status mix, and time-to-conversion.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/reports")}
              data-testid="sales-funnel-back-to-reports"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Reports
            </Button>
            <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
              <SelectTrigger
                className="w-44"
                data-testid="select-sales-funnel-range"
              >
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

        {isLoading ? (
          <Card>
            <CardContent className="p-8">
              <p className="text-sm text-muted-foreground text-center">
                Loading sales funnel report…
              </p>
            </CardContent>
          </Card>
        ) : isError || !data ? (
          // Full-page error ONLY on a true API failure. Per-section
          // empty states inline for partial-data tenants.
          <Card data-testid="sales-funnel-error">
            <CardContent className="p-8">
              <p className="text-sm text-muted-foreground text-center">
                We couldn't load the sales funnel report. Try refreshing in a moment.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6" data-testid="sales-funnel-body">
            <SectionCard
              title="Funnel summary"
              icon={Filter}
              testId="sales-funnel-section-kpis"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
                {data.kpis.metrics.map((m) => (
                  <MetricTile key={m.key} metric={m} />
                ))}
              </div>
            </SectionCard>
            <FunnelCard section={data.funnel} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <LeadCreationTrendCard section={data.leadCreationTrend} />
              <LeadConversionTrendCard section={data.leadConversionTrend} />
              <QuoteCreationTrendCard section={data.quoteCreationTrend} />
              <QuoteConversionTrendCard section={data.quoteConversionTrend} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <LeadStatusBreakdownCard section={data.leadStatus} />
              <QuoteStatusBreakdownCard section={data.quoteStatus} />
            </div>
            <ConversionLagCard section={data.conversionLag} />
          </div>
        )}
      </main>
    </div>
  );
}
