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
  Briefcase,
  Clock,
  DollarSign,
  ListChecks,
} from "lucide-react";
import {
  formatMetricValue,
  formatPercentChange,
  trendColorClass,
} from "@/lib/reportsFormatters";
import type {
  JobsResponse,
  MetricCard as MetricCardData,
} from "@shared/reports/jobs";
import type { MetricUnit, MetricPolarity } from "@shared/reports/snapshot";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Reports → Job Performance deep-report (`/reports/jobs`)
// Standalone page (NOT a tab). Renders the Operations tab's drill-
// downs PLUS a completed-jobs activity table. Reuses the SAME backend
// helpers the Operations tab uses (lifted into reportsCommon) — drift
// is structurally impossible.
// ---------------------------------------------------------------------------

type RangeKey = "last_30_days" | "last_quarter" | "last_year";

const RANGE_OPTIONS: Array<{ value: RangeKey; label: string; disabled?: boolean }> = [
  { value: "last_30_days", label: "Last 30 days" },
  { value: "last_quarter", label: "Last quarter (coming soon)", disabled: true },
  { value: "last_year", label: "Last year (coming soon)", disabled: true },
];

// ---------------------------------------------------------------------------
// SectionCard / SectionEmpty — small local copies; same pattern as
// every other deep-report page.
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
// MetricTile — same layout as the rest of Reports
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
// Bar primitives — match the Operations tab visuals
// ---------------------------------------------------------------------------

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
      data-testid={`jobs-completion-bar-${date}`}
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

function AvgValueBar({
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
      data-testid={`jobs-avg-value-bar-${date}`}
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

// ---------------------------------------------------------------------------
// Section cards
// ---------------------------------------------------------------------------

function CompletionTrendCard({
  section,
}: {
  section: JobsResponse["completionTrend"];
}) {
  const max = section.points.reduce((m, p) => Math.max(m, p.count), 0);
  return (
    <SectionCard
      title="Job completion trend"
      icon={BarChart3}
      testId="jobs-section-completion-trend"
    >
      {!section.hasData ? (
        <SectionEmpty testId="jobs-section-completion-trend" />
      ) : (
        <div
          className="flex items-end gap-1 px-1"
          data-testid="jobs-completion-trend-chart"
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
  section: JobsResponse["jobStatus"];
}) {
  return (
    <SectionCard
      title="Jobs by status"
      icon={ListChecks}
      testId="jobs-section-job-status"
    >
      {!section.hasData ? (
        <SectionEmpty testId="jobs-section-job-status" />
      ) : (
        <div className="space-y-2" data-testid="jobs-job-status-list">
          {section.items.map((item) => (
            <div
              key={item.key}
              className="space-y-1"
              data-testid={`jobs-status-${item.key}`}
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

function AvgJobValueTrendCard({
  section,
}: {
  section: JobsResponse["avgJobValueTrend"];
}) {
  const max = section.points.reduce((m, p) => Math.max(m, p.avgValue), 0);
  return (
    <SectionCard
      title="Avg job invoice value trend"
      icon={DollarSign}
      testId="jobs-section-avg-value-trend"
    >
      {!section.hasData ? (
        <SectionEmpty testId="jobs-section-avg-value-trend" />
      ) : (
        <div
          className="flex items-end gap-1 px-1"
          data-testid="jobs-avg-value-trend-chart"
        >
          {section.points.map((p) => (
            <AvgValueBar
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
  section: JobsResponse["unbillableBreakdown"];
}) {
  return (
    <SectionCard
      title="Unbillable time by category"
      icon={Clock}
      testId="jobs-section-unbillable-breakdown"
    >
      {!section.hasData ? (
        <SectionEmpty testId="jobs-section-unbillable-breakdown" />
      ) : (
        <div
          className="space-y-2"
          data-testid="jobs-unbillable-breakdown-list"
        >
          {section.items.map((item) => (
            <div
              key={item.type}
              className="space-y-1"
              data-testid={`jobs-unbillable-type-${item.type}`}
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

// ---------------------------------------------------------------------------
// Completed jobs table — sorted newest first by the server
// ---------------------------------------------------------------------------

function formatCompletedDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function CompletedJobsCard({
  section,
}: {
  section: JobsResponse["completedJobs"];
}) {
  return (
    <SectionCard
      title="Recently completed jobs"
      icon={Briefcase}
      testId="jobs-section-completed"
    >
      {!section.hasData ? (
        <SectionEmpty testId="jobs-section-completed" />
      ) : (
        <Table data-testid="jobs-completed-table">
          <TableHeader>
            <TableRow>
              <TableHead>Job #</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Completed</TableHead>
              <TableHead className="text-right">Invoice total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {section.items.map((row) => (
              <TableRow
                key={row.eventId}
                data-testid={`jobs-completed-row-${row.eventId}`}
              >
                <TableCell className="font-medium tabular-nums text-xs">
                  #{row.jobNumber}
                </TableCell>
                <TableCell className="text-xs">{row.clientName}</TableCell>
                <TableCell className="text-helper text-muted-foreground">
                  {row.locationName ?? "—"}
                </TableCell>
                <TableCell className="text-xs tabular-nums">
                  {formatCompletedDate(row.completedAtISO)}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {row.invoiceTotal == null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className="font-semibold text-emerald-700">
                      {formatMetricValue(row.invoiceTotal, "currency")}
                    </span>
                  )}
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
// Page
// ---------------------------------------------------------------------------

export default function ReportsJobs() {
  const [, setLocation] = useLocation();
  const [range, setRange] = useState<RangeKey>("last_30_days");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const r = params.get("range");
    if (r === "last_30_days") setRange(r);
  }, []);

  const { data, isLoading, isError } = useQuery<JobsResponse>({
    queryKey: ["/api/reports/jobs", range],
    queryFn: () => apiRequest<JobsResponse>(`/api/reports/jobs?range=${range}`),
    staleTime: 60_000,
  });

  return (
    <div className="min-h-screen bg-background" data-testid="reports-jobs-page">
      <main className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Briefcase className="h-7 w-7 text-primary" />
            <div>
              <h1
                className="text-2xl font-semibold"
                data-testid="reports-jobs-title"
              >
                Job Performance
              </h1>
              <p className="text-helper text-muted-foreground">
                Completion volume, status mix, invoice values, unbillable
                time, and a recent-completion log.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/reports")}
              data-testid="jobs-back-to-reports"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Reports
            </Button>
            <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
              <SelectTrigger className="w-44" data-testid="select-jobs-range">
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
                Loading job report…
              </p>
            </CardContent>
          </Card>
        ) : isError || !data ? (
          // Full-page error ONLY on a true API failure. Per-section
          // empty states inline for partial-data tenants.
          <Card data-testid="jobs-error">
            <CardContent className="p-8">
              <p className="text-sm text-muted-foreground text-center">
                We couldn't load the job report. Try refreshing in a moment.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6" data-testid="jobs-body">
            <SectionCard
              title="Job summary"
              icon={Briefcase}
              testId="jobs-section-kpis"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {data.kpis.metrics.map((m) => (
                  <MetricTile key={m.key} metric={m} />
                ))}
              </div>
            </SectionCard>
            <CompletionTrendCard section={data.completionTrend} />
            <JobStatusBreakdownCard section={data.jobStatus} />
            <AvgJobValueTrendCard section={data.avgJobValueTrend} />
            <UnbillableBreakdownCard section={data.unbillableBreakdown} />
            <CompletedJobsCard section={data.completedJobs} />
          </div>
        )}
      </main>
    </div>
  );
}
