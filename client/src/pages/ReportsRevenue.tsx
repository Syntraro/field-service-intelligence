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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BarChart3,
  CreditCard,
  DollarSign,
  Users,
} from "lucide-react";
import {
  formatMetricValue,
  formatPercentChange,
  trendColorClass,
} from "@/lib/reportsFormatters";
import type {
  RevenueResponse,
  MetricCard as MetricCardData,
} from "@shared/reports/revenue";
import type { MetricUnit, MetricPolarity } from "@shared/reports/snapshot";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Reports → Revenue deep-report (`/reports/revenue`)
// Standalone page (NOT a tab). Renders the full revenue drill-down on
// top of the canonical /api/reports/revenue aggregator. Reuses the
// SAME backend helpers the Financial tab uses for the trend + method
// breakdown sections — drift between the two is structurally
// impossible.
// ---------------------------------------------------------------------------

type RangeKey = "last_30_days" | "last_quarter" | "last_year";

const RANGE_OPTIONS: Array<{ value: RangeKey; label: string; disabled?: boolean }> = [
  { value: "last_30_days", label: "Last 30 days" },
  { value: "last_quarter", label: "Last quarter (coming soon)", disabled: true },
  { value: "last_year", label: "Last year (coming soon)", disabled: true },
];

// ---------------------------------------------------------------------------
// SectionCard / SectionEmpty — small local copies (4 lines each) so the
// page works even if Reports.tsx later refactors these into a shared
// module. Same primitives as the rest of the Reports surface.
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
    <p
      className="text-sm text-muted-foreground"
      data-testid={`${testId}-empty`}
    >
      Not enough data yet
    </p>
  );
}

// ---------------------------------------------------------------------------
// MetricTile — same layout as the other Reports surfaces' KPI cards.
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
// Revenue trend bars (same visual pattern as the Financial tab's bars)
// ---------------------------------------------------------------------------

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
      data-testid={`revenue-trend-bar-${date}`}
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

function RevenueTrendCard({
  section,
}: {
  section: RevenueResponse["revenueTrend"];
}) {
  const max = section.points.reduce((m, p) => Math.max(m, p.amount), 0);
  return (
    <SectionCard
      title="Revenue trend"
      icon={BarChart3}
      testId="revenue-section-trend"
    >
      {!section.hasData ? (
        <SectionEmpty testId="revenue-section-trend" />
      ) : (
        <div
          className="flex items-end gap-1 px-1"
          data-testid="revenue-trend-chart"
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

// ---------------------------------------------------------------------------
// Payment methods — horizontal bars with amount + percentage
// ---------------------------------------------------------------------------

function PaymentMethodsCard({
  section,
}: {
  section: RevenueResponse["paymentMethods"];
}) {
  return (
    <SectionCard
      title="Revenue by payment method"
      icon={CreditCard}
      testId="revenue-section-methods"
    >
      {!section.hasData ? (
        <SectionEmpty testId="revenue-section-methods" />
      ) : (
        <div className="space-y-2" data-testid="revenue-methods-list">
          {section.items.map((item) => (
            <div
              key={item.method}
              className="space-y-1"
              data-testid={`revenue-method-${item.method}`}
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

// ---------------------------------------------------------------------------
// Revenue by client — top 10 list
// ---------------------------------------------------------------------------

function RevenueByClientCard({
  section,
}: {
  section: RevenueResponse["revenueByClient"];
}) {
  return (
    <SectionCard
      title="Revenue by client"
      icon={Users}
      testId="revenue-section-by-client"
    >
      {!section.hasData ? (
        <SectionEmpty testId="revenue-section-by-client" />
      ) : (
        <ul
          className="divide-y divide-[#e2e8f0] dark:divide-gray-700"
          data-testid="revenue-by-client-list"
        >
          {section.items.map((c, idx) => (
            <li
              key={c.clientId}
              className="flex items-center justify-between gap-3 py-2"
              data-testid={`revenue-client-row-${idx}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-helper text-muted-foreground tabular-nums w-5 text-right">
                  {idx + 1}
                </span>
                <span className="text-sm font-medium truncate">{c.name}</span>
              </div>
              <div className="flex items-center gap-3 text-xs whitespace-nowrap">
                <span className="text-muted-foreground tabular-nums">
                  {c.paymentCount} payment{c.paymentCount === 1 ? "" : "s"}
                </span>
                <span className="font-semibold tabular-nums text-emerald-700">
                  {formatMetricValue(c.totalRevenue, "currency")}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Recently received payments — table sorted newest first by the server
// ---------------------------------------------------------------------------

function formatPaymentDate(iso: string): string {
  // Browser-local date rendering is fine here — the activity table is
  // a transactional log, not a calendar-aware report.
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function RecentPaymentsCard({
  section,
}: {
  section: RevenueResponse["recentPayments"];
}) {
  return (
    <SectionCard
      title="Recently received payments"
      icon={DollarSign}
      testId="revenue-section-recent"
    >
      {!section.hasData ? (
        <SectionEmpty testId="revenue-section-recent" />
      ) : (
        <Table data-testid="revenue-recent-payments-table">
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Invoice #</TableHead>
              <TableHead>Method</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {section.items.map((row) => (
              <TableRow
                key={row.id}
                data-testid={`revenue-recent-row-${row.id}`}
              >
                <TableCell className="text-xs tabular-nums">
                  {formatPaymentDate(row.receivedAtISO)}
                </TableCell>
                <TableCell className="text-xs">{row.clientName}</TableCell>
                <TableCell className="text-xs tabular-nums">
                  {row.invoiceNumber ? `#${row.invoiceNumber}` : "—"}
                </TableCell>
                <TableCell className="text-xs">{row.methodLabel}</TableCell>
                <TableCell className="text-right text-xs tabular-nums font-semibold text-emerald-700">
                  {formatMetricValue(row.amount, "currency")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Month-over-month — current vs previous calendar month
// ---------------------------------------------------------------------------

function formatMonthLabel(ymd: string): string {
  const [y, m] = ymd.split("-").map((s) => parseInt(s, 10));
  if (![y, m].every(Number.isFinite)) return ymd;
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

function MonthOverMonthCard({
  section,
}: {
  section: RevenueResponse["monthComparison"];
}) {
  return (
    <SectionCard
      title="Month-over-month comparison"
      icon={BarChart3}
      testId="revenue-section-month-comparison"
    >
      {!section.hasData ? (
        <SectionEmpty testId="revenue-section-month-comparison" />
      ) : (
        <div className="space-y-3" data-testid="revenue-month-comparison-body">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div
              className="rounded-md border border-[#e2e8f0] dark:border-gray-700 bg-white dark:bg-gray-900 p-4"
              data-testid="revenue-mom-current"
            >
              <div className="text-helper uppercase tracking-[0.04em] text-muted-foreground font-medium">
                {formatMonthLabel(section.currentMonthYmd)}
              </div>
              <div className="text-2xl font-semibold tabular-nums text-foreground mt-1">
                {formatMetricValue(section.currentMonthRevenue, "currency")}
              </div>
            </div>
            <div
              className="rounded-md border border-[#e2e8f0] dark:border-gray-700 bg-white dark:bg-gray-900 p-4"
              data-testid="revenue-mom-previous"
            >
              <div className="text-helper uppercase tracking-[0.04em] text-muted-foreground font-medium">
                {formatMonthLabel(section.previousMonthYmd)}
              </div>
              <div className="text-2xl font-semibold tabular-nums text-foreground mt-1">
                {formatMetricValue(section.previousMonthRevenue, "currency")}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between text-helper text-muted-foreground">
            <span>Change vs previous month</span>
            <span
              className={cn(
                "tabular-nums font-medium",
                trendColorClass(section.changePercent, "higher_is_better"),
              )}
              data-testid="revenue-mom-change"
            >
              {formatPercentChange(section.changePercent)}
            </span>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReportsRevenue() {
  const [, setLocation] = useLocation();
  const [range, setRange] = useState<RangeKey>("last_30_days");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const r = params.get("range");
    if (r === "last_30_days") setRange(r);
  }, []);

  const { data, isLoading, isError } = useQuery<RevenueResponse>({
    queryKey: ["/api/reports/revenue", range],
    queryFn: () => apiRequest<RevenueResponse>(`/api/reports/revenue?range=${range}`),
    staleTime: 60_000,
  });

  return (
    <div className="min-h-screen bg-background" data-testid="reports-revenue-page">
      <main className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <DollarSign className="h-7 w-7 text-primary" />
            <div>
              <h1
                className="text-2xl font-semibold"
                data-testid="reports-revenue-title"
              >
                Revenue
              </h1>
              <p className="text-helper text-muted-foreground">
                Cash-basis revenue with payment-method, client, and
                month-over-month breakdowns.
              </p>
              <p
                className="text-[10px] text-muted-foreground/80 mt-0.5"
                data-testid="reports-revenue-cash-basis-note"
              >
                Revenue reflects payment records and excludes voided invoices.
                Refunds and reversals are not included.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/reports")}
              data-testid="revenue-back-to-reports"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Reports
            </Button>
            <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
              <SelectTrigger className="w-44" data-testid="select-revenue-range">
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
                Loading revenue report…
              </p>
            </CardContent>
          </Card>
        ) : isError || !data ? (
          // Full-page error ONLY on a true API failure. Per-section
          // empty states handle partial-data tenants inline.
          <Card data-testid="revenue-error">
            <CardContent className="p-8">
              <p className="text-sm text-muted-foreground text-center">
                We couldn't load the revenue report. Try refreshing in a moment.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6" data-testid="revenue-body">
            <SectionCard
              title="Revenue summary"
              icon={DollarSign}
              testId="revenue-section-kpis"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {data.kpis.metrics.map((m) => (
                  <MetricTile key={m.key} metric={m} />
                ))}
              </div>
            </SectionCard>
            <RevenueTrendCard section={data.revenueTrend} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <PaymentMethodsCard section={data.paymentMethods} />
              <MonthOverMonthCard section={data.monthComparison} />
            </div>
            <RevenueByClientCard section={data.revenueByClient} />
            <RecentPaymentsCard section={data.recentPayments} />
          </div>
        )}
      </main>
    </div>
  );
}
