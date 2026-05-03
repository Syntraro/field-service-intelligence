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
  Briefcase,
  Clock,
  PieChart,
  Users,
} from "lucide-react";
import {
  formatMetricValue,
  formatPercentChange,
  trendColorClass,
} from "@/lib/reportsFormatters";
import type {
  TeamResponse,
  MetricCard as MetricCardData,
} from "@shared/reports/team";
import type { MetricUnit, MetricPolarity } from "@shared/reports/snapshot";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Reports → Team Performance deep-report (`/reports/team`)
// Standalone page (NOT a tab). Reuses `sharedQueries.unbillableCost`
// and `sharedQueries.unbillableEntriesWithCostRate` for the global
// KPI; the per-user sections derive from `time_entries.technicianId`
// (FK-clean) + `job_status_events.changedBy` (canonical writer-id).
// ---------------------------------------------------------------------------

type RangeKey = "last_30_days" | "last_quarter" | "last_year";

const RANGE_OPTIONS: Array<{ value: RangeKey; label: string; disabled?: boolean }> = [
  { value: "last_30_days", label: "Last 30 days" },
  { value: "last_quarter", label: "Last quarter (coming soon)", disabled: true },
  { value: "last_year", label: "Last year (coming soon)", disabled: true },
];

// ---------------------------------------------------------------------------
// SectionCard / SectionEmpty — same primitives as the other deep-reports
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
// MetricTile — same layout as the other Reports surfaces
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
    <div className="flex items-center justify-between text-xs text-muted-foreground">
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
      <div className="text-xs uppercase tracking-[0.04em] text-muted-foreground font-medium">
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
// Hours by user — list with billable/unbillable split
// ---------------------------------------------------------------------------

function HoursByUserCard({
  section,
}: {
  section: TeamResponse["hoursByUser"];
}) {
  const max = section.items.reduce((m, r) => Math.max(m, r.totalHours), 0);
  return (
    <SectionCard
      title="Hours by team member"
      icon={Clock}
      testId="team-section-hours-by-user"
    >
      {!section.hasData ? (
        <SectionEmpty testId="team-section-hours-by-user" />
      ) : (
        <ul
          className="divide-y divide-[#e2e8f0] dark:divide-gray-700"
          data-testid="team-hours-by-user-list"
        >
          {section.items.map((row, idx) => (
            <li
              key={row.userId}
              className="space-y-1 py-2"
              data-testid={`team-hours-row-${row.userId}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs text-muted-foreground tabular-nums w-5 text-right">
                    {idx + 1}
                  </span>
                  <span className="text-sm font-medium truncate">{row.name}</span>
                </div>
                <span className="text-xs font-semibold tabular-nums">
                  {row.totalHours.toFixed(1)}h
                </span>
              </div>
              <div className="h-1.5 w-full bg-muted rounded overflow-hidden flex">
                <div
                  className="h-full bg-emerald-500/70"
                  style={{
                    width: `${
                      max > 0 ? (row.billableHours / max) * 100 : 0
                    }%`,
                  }}
                />
                <div
                  className="h-full bg-rose-500/70"
                  style={{
                    width: `${
                      max > 0 ? (row.unbillableHours / max) * 100 : 0
                    }%`,
                  }}
                />
              </div>
              <div className="text-[10px] text-muted-foreground tabular-nums">
                {row.billableHours.toFixed(1)}h billable ·{" "}
                {row.unbillableHours.toFixed(1)}h unbillable · {row.entryCount} entr
                {row.entryCount === 1 ? "y" : "ies"}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Unbillable cost by user
// ---------------------------------------------------------------------------

function UnbillableByUserCard({
  section,
}: {
  section: TeamResponse["unbillableByUser"];
}) {
  const maxCost = section.items.reduce((m, r) => Math.max(m, r.cost), 0);
  return (
    <SectionCard
      title="Unbillable cost by team member"
      icon={Clock}
      testId="team-section-unbillable-by-user"
    >
      {!section.hasData ? (
        <SectionEmpty testId="team-section-unbillable-by-user" />
      ) : (
        <ul
          className="divide-y divide-[#e2e8f0] dark:divide-gray-700"
          data-testid="team-unbillable-by-user-list"
        >
          {section.items.map((row, idx) => (
            <li
              key={row.userId}
              className="space-y-1 py-2"
              data-testid={`team-unbillable-row-${row.userId}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs text-muted-foreground tabular-nums w-5 text-right">
                    {idx + 1}
                  </span>
                  <span className="text-sm font-medium truncate">{row.name}</span>
                </div>
                <span className="text-xs font-semibold tabular-nums text-rose-600">
                  {formatMetricValue(row.cost, "currency")}
                </span>
              </div>
              <div className="h-1.5 w-full bg-muted rounded">
                <div
                  className="h-full bg-rose-500/70 rounded"
                  style={{
                    width: `${
                      maxCost > 0 ? (row.cost / maxCost) * 100 : 0
                    }%`,
                  }}
                />
              </div>
              <div className="text-[10px] text-muted-foreground tabular-nums">
                {row.hours.toFixed(1)}h · {row.entryCount} entr
                {row.entryCount === 1 ? "y" : "ies"}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Jobs completed by user (with avg invoice value when available)
// ---------------------------------------------------------------------------

function JobsByUserCard({
  section,
}: {
  section: TeamResponse["jobsByUser"];
}) {
  const max = section.items.reduce((m, r) => Math.max(m, r.completedCount), 0);
  return (
    <SectionCard
      title="Jobs completed by team member"
      icon={Briefcase}
      testId="team-section-jobs-by-user"
    >
      {!section.hasData ? (
        <SectionEmpty testId="team-section-jobs-by-user" />
      ) : (
        <ul
          className="divide-y divide-[#e2e8f0] dark:divide-gray-700"
          data-testid="team-jobs-by-user-list"
        >
          {section.items.map((row, idx) => (
            <li
              key={row.userId}
              className="space-y-1 py-2"
              data-testid={`team-jobs-row-${row.userId}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs text-muted-foreground tabular-nums w-5 text-right">
                    {idx + 1}
                  </span>
                  <span className="text-sm font-medium truncate">{row.name}</span>
                </div>
                <span className="text-xs font-semibold tabular-nums">
                  {row.completedCount.toLocaleString()} job
                  {row.completedCount === 1 ? "" : "s"}
                </span>
              </div>
              <div className="h-1.5 w-full bg-muted rounded">
                <div
                  className="h-full bg-sky-500/70 rounded"
                  style={{
                    width: `${
                      max > 0 ? (row.completedCount / max) * 100 : 0
                    }%`,
                  }}
                />
              </div>
              <div className="text-[10px] text-muted-foreground tabular-nums">
                {row.avgInvoiceTotal == null ? (
                  <>No invoiced jobs in window</>
                ) : (
                  <>
                    Avg invoice {formatMetricValue(row.avgInvoiceTotal, "currency")}{" "}
                    · {row.invoicedCount.toLocaleString()} invoiced
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Time distribution — billable vs unbillable share
// ---------------------------------------------------------------------------

function TimeDistributionCard({
  section,
}: {
  section: TeamResponse["timeDistribution"];
}) {
  return (
    <SectionCard
      title="Billable vs unbillable share"
      icon={PieChart}
      testId="team-section-time-distribution"
    >
      {!section.hasData ? (
        <SectionEmpty testId="team-section-time-distribution" />
      ) : (
        <div
          className="space-y-3"
          data-testid="team-time-distribution-body"
        >
          <div
            className="h-3 w-full bg-muted rounded overflow-hidden flex"
            data-testid="team-time-distribution-bar"
          >
            <div
              className="h-full bg-emerald-500/70"
              style={{
                width: `${Math.min(100, section.billablePercent)}%`,
              }}
            />
            <div
              className="h-full bg-rose-500/70"
              style={{
                width: `${Math.min(100, section.unbillablePercent)}%`,
              }}
            />
          </div>
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-emerald-500/70" />
                Billable {section.billablePercent.toFixed(1)}%
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-rose-500/70" />
                Unbillable {section.unbillablePercent.toFixed(1)}%
              </span>
            </div>
            <span className="text-muted-foreground tabular-nums">
              Total: {section.totalHours.toFixed(1)}h
            </span>
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {section.billableHours.toFixed(1)}h billable ·{" "}
            {section.unbillableHours.toFixed(1)}h unbillable
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReportsTeam() {
  const [, setLocation] = useLocation();
  const [range, setRange] = useState<RangeKey>("last_30_days");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const r = params.get("range");
    if (r === "last_30_days") setRange(r);
  }, []);

  const { data, isLoading, isError } = useQuery<TeamResponse>({
    queryKey: ["/api/reports/team", range],
    queryFn: () => apiRequest<TeamResponse>(`/api/reports/team?range=${range}`),
    staleTime: 60_000,
  });

  return (
    <div className="min-h-screen bg-background" data-testid="reports-team-page">
      <main className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Users className="h-7 w-7 text-primary" />
            <div>
              <h1
                className="text-2xl font-semibold"
                data-testid="reports-team-title"
              >
                Team Performance
              </h1>
              <p className="text-xs text-muted-foreground">
                Per-user hours, unbillable cost, and completed jobs — based on
                FK-clean attribution only.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/reports")}
              data-testid="team-back-to-reports"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Reports
            </Button>
            <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
              <SelectTrigger className="w-44" data-testid="select-team-range">
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
                Loading team report…
              </p>
            </CardContent>
          </Card>
        ) : isError || !data ? (
          // Full-page error ONLY on a true API failure. Per-section
          // empty states inline for partial-data tenants.
          <Card data-testid="team-error">
            <CardContent className="p-8">
              <p className="text-sm text-muted-foreground text-center">
                We couldn't load the team report. Try refreshing in a moment.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6" data-testid="team-body">
            <SectionCard
              title="Team summary"
              icon={Users}
              testId="team-section-kpis"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {data.kpis.metrics.map((m) => (
                  <MetricTile key={m.key} metric={m} />
                ))}
              </div>
            </SectionCard>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <HoursByUserCard section={data.hoursByUser} />
              <UnbillableByUserCard section={data.unbillableByUser} />
            </div>
            <JobsByUserCard section={data.jobsByUser} />
            <TimeDistributionCard section={data.timeDistribution} />
          </div>
        )}
      </main>
    </div>
  );
}
