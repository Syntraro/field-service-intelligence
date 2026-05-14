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
  Clock,
  Receipt,
  Users,
} from "lucide-react";
import {
  formatMetricValue,
  formatPercentChange,
  trendColorClass,
} from "@/lib/reportsFormatters";
import type {
  ARReportResponse,
  MetricCard as MetricCardData,
} from "@shared/reports/ar";
import type {
  MetricUnit,
  MetricPolarity,
} from "@shared/reports/snapshot";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Reports → Accounts Receivable deep-report (`/reports/ar`)
//
// Standalone page (NOT a tab). Renders the full AR drill-down on top
// of the canonical `/api/reports/ar` aggregator. Reuses the same
// formatter helpers and section layout primitives the Reports tabs
// use, so the look is consistent.
//
// No backend logic in this file — every value comes from the API
// response. Sections short-circuit on `!hasData` and render a
// section-level empty state.
// ---------------------------------------------------------------------------

type RangeKey = "last_30_days" | "last_quarter" | "last_year";

const RANGE_OPTIONS: Array<{ value: RangeKey; label: string; disabled?: boolean }> = [
  { value: "last_30_days", label: "Last 30 days" },
  { value: "last_quarter", label: "Last quarter (coming soon)", disabled: true },
  { value: "last_year", label: "Last year (coming soon)", disabled: true },
];

// ---------------------------------------------------------------------------
// SectionCard / SectionEmpty — local copies of the same primitives the
// Reports page uses. We don't import them from Reports.tsx because that
// page exports its default component, not these helpers. Duplication is
// minimal (4 lines each) and lets the AR page render even if Reports.tsx
// is later refactored to extract them into a shared module.
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
// MetricTile — same layout as the Reports tabs' KPI cards. Renders the
// current value + three comparison rows. Empty state when hasData=false.
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
// Aging buckets — 4-up grid matching the Financial tab's AR layout
// ---------------------------------------------------------------------------

function AgingSection({ section }: { section: ARReportResponse["aging"] }) {
  return (
    <SectionCard title="AR aging" icon={Receipt} testId="ar-section-aging">
      {!section.hasData ? (
        <SectionEmpty testId="ar-section-aging" />
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
                  data-testid={`ar-bucket-${b.key}`}
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
          <div className="flex items-center justify-between text-helper text-muted-foreground">
            <span>
              Total outstanding:{" "}
              <span className="font-medium tabular-nums text-foreground">
                {formatMetricValue(section.totalOutstanding, "currency")}
              </span>
            </span>
            <span>
              Total overdue:{" "}
              <span className="font-medium tabular-nums text-rose-600">
                {formatMetricValue(section.totalOverdue, "currency")}
              </span>
            </span>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Overdue invoices table — backend already sorts desc by daysOverdue
// ---------------------------------------------------------------------------

function OverdueInvoicesCard({
  section,
}: {
  section: ARReportResponse["overdueInvoices"];
}) {
  return (
    <SectionCard
      title="Overdue invoices"
      icon={Receipt}
      testId="ar-section-overdue-invoices"
    >
      {!section.hasData ? (
        <SectionEmpty testId="ar-section-overdue-invoices" />
      ) : (
        <Table data-testid="ar-overdue-invoices-table">
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Client</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Due date</TableHead>
              <TableHead className="text-right">Days overdue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {section.items.map((row) => (
              <TableRow
                key={row.id}
                data-testid={`ar-overdue-row-${row.id}`}
              >
                <TableCell className="font-medium tabular-nums text-xs">
                  {row.invoiceNumber ? `#${row.invoiceNumber}` : "—"}
                </TableCell>
                <TableCell className="text-xs">{row.clientName}</TableCell>
                <TableCell className="text-right text-xs tabular-nums font-semibold text-rose-600">
                  {formatMetricValue(row.amount, "currency")}
                </TableCell>
                <TableCell className="text-xs tabular-nums">
                  {row.dueDate ?? "—"}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {row.daysOverdue}
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
// Top outstanding clients — same shape as the Financial tab's section
// ---------------------------------------------------------------------------

function TopOutstandingClientsCard({
  section,
}: {
  section: ARReportResponse["topOutstandingClients"];
}) {
  return (
    <SectionCard
      title="Top outstanding clients"
      icon={Users}
      testId="ar-section-top-clients"
    >
      {!section.hasData ? (
        <SectionEmpty testId="ar-section-top-clients" />
      ) : (
        <ul
          className="divide-y divide-[#e2e8f0] dark:divide-gray-700"
          data-testid="ar-top-clients-list"
        >
          {section.items.map((c, idx) => (
            <li
              key={c.clientId}
              className="flex items-center justify-between gap-3 py-2"
              data-testid={`ar-top-client-row-${idx}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-helper text-muted-foreground tabular-nums w-5 text-right">
                  {idx + 1}
                </span>
                <span className="text-sm font-medium truncate">{c.name}</span>
              </div>
              <div className="flex items-center gap-3 text-xs whitespace-nowrap">
                <span className="text-muted-foreground tabular-nums">
                  {c.invoiceCount} {c.invoiceCount === 1 ? "invoice" : "invoices"}
                </span>
                <span className="font-semibold tabular-nums text-rose-600">
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

// ---------------------------------------------------------------------------
// Avg payment time trend — daily bars
// ---------------------------------------------------------------------------

function PaymentTimeBar({
  date,
  avgDays,
  invoiceCount,
  pctOfMax,
}: {
  date: string;
  avgDays: number;
  invoiceCount: number;
  pctOfMax: number;
}) {
  const heightStyle = { height: `${Math.max(2, pctOfMax)}%` };
  return (
    <div
      className="flex flex-col items-center gap-1 flex-1 min-w-0"
      data-testid={`ar-payment-time-bar-${date}`}
      title={`${date} · ${avgDays} day${avgDays === 1 ? "" : "s"} avg · ${invoiceCount} invoice${invoiceCount === 1 ? "" : "s"} closed`}
    >
      <div className="w-full h-24 flex items-end">
        <div
          className={cn(
            "w-full rounded-sm",
            avgDays > 0 ? "bg-amber-500/70" : "bg-muted",
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

function PaymentTimeTrendCard({
  section,
}: {
  section: ARReportResponse["paymentTimeTrend"];
}) {
  const max = section.points.reduce((m, p) => Math.max(m, p.avgDays), 0);
  return (
    <SectionCard
      title="Avg payment time trend"
      icon={Clock}
      testId="ar-section-payment-time-trend"
    >
      {!section.hasData ? (
        <SectionEmpty testId="ar-section-payment-time-trend" />
      ) : (
        <div
          className="flex items-end gap-1 px-1"
          data-testid="ar-payment-time-trend-chart"
        >
          {section.points.map((p) => (
            <PaymentTimeBar
              key={p.date}
              date={p.date}
              avgDays={p.avgDays}
              invoiceCount={p.invoiceCount}
              pctOfMax={max > 0 ? (p.avgDays / max) * 100 : 0}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReportsAR() {
  const [, setLocation] = useLocation();
  const [range, setRange] = useState<RangeKey>("last_30_days");

  // Read `?range=` from URL on mount (deep-link from the library
  // catalog). Same pattern as the Reports page.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const r = params.get("range");
    if (r === "last_30_days") setRange(r);
  }, []);

  const { data, isLoading, isError } = useQuery<ARReportResponse>({
    queryKey: ["/api/reports/ar", range],
    queryFn: () => apiRequest<ARReportResponse>(`/api/reports/ar?range=${range}`),
    staleTime: 60_000,
  });

  return (
    <div className="min-h-screen bg-background" data-testid="reports-ar-page">
      <main className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Receipt className="h-7 w-7 text-primary" />
            <div>
              <h1
                className="text-2xl font-semibold"
                data-testid="reports-ar-title"
              >
                Accounts Receivable
              </h1>
              <p className="text-helper text-muted-foreground">
                Outstanding balances, overdue invoices, and payment behavior.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/reports")}
              data-testid="ar-back-to-reports"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Reports
            </Button>
            <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
              <SelectTrigger className="w-44" data-testid="select-ar-range">
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
                Loading AR report…
              </p>
            </CardContent>
          </Card>
        ) : isError || !data ? (
          // Full-page error ONLY on a true API failure. Sections handle
          // their own empty states inline so partial-data tenants keep
          // the layout context.
          <Card data-testid="ar-error">
            <CardContent className="p-8">
              <p className="text-sm text-muted-foreground text-center">
                We couldn't load the AR report. Try refreshing in a moment.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6" data-testid="ar-body">
            <SectionCard
              title="AR summary"
              icon={Receipt}
              testId="ar-section-kpis"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {data.kpis.metrics.map((m) => (
                  <MetricTile key={m.key} metric={m} />
                ))}
              </div>
            </SectionCard>
            <AgingSection section={data.aging} />
            <OverdueInvoicesCard section={data.overdueInvoices} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <TopOutstandingClientsCard
                section={data.topOutstandingClients}
              />
              <PaymentTimeTrendCard section={data.paymentTimeTrend} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
