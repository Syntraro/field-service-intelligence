/**
 * MemberPerformanceTab — Performance tab for the Team Member Workspace.
 *
 * Phase 2 additions:
 * - Real efficiency score with grade, component breakdown, strengths, opportunities
 * - Lead conversion funnel (generated → quote → job → revenue)
 * - Lead conversion rate shown only when traceable
 * - Callback rate omitted: no reliable callback designation in schema
 *   (job_visits.isFollowUpNeeded / outcome="needs_followup" are follow-up
 *   intent flags, not defective-work callbacks — see server/lib/efficiencyScore.ts)
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  TrendingDown,
  Clock,
  Briefcase,
  DollarSign,
  Target,
  Star,
  Lightbulb,
  Users,
  ArrowRight,
  Info,
} from "lucide-react";
import { format } from "date-fns";
import type {
  EfficiencyScore,
  LeadConversionMetrics,
  MemberPerformanceResponse,
  MetricsPeriod,
  MonthlyPerformancePoint,
  ScoreComponent,
  WorkloadBreakdown,
  WorkloadWindow,
} from "./types";

const PERIOD_LABELS: Record<MetricsPeriod, string> = {
  last_30_days: "Last 30 days",
  last_90_days: "Last 90 days",
  last_12_months: "Last 12 months",
};

const GRADE_COLOR: Record<string, string> = {
  A: "text-green-600",
  B: "text-emerald-600",
  C: "text-amber-600",
  D: "text-orange-600",
  F: "text-destructive",
};

const GRADE_BG: Record<string, string> = {
  A: "bg-green-50 border-green-200",
  B: "bg-emerald-50 border-emerald-200",
  C: "bg-amber-50 border-amber-200",
  D: "bg-orange-50 border-orange-200",
  F: "bg-red-50 border-red-200",
};

function fmtCurrency(v: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v);
}

function fmtCurrencyDetailed(v: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

function fmtHours(h: number): string {
  if (h === 0) return "0 hrs";
  return `${h.toFixed(1)} hrs`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  if (!y || !m) return month;
  try {
    return format(new Date(Number(y), Number(m) - 1, 1), "MMM");
  } catch {
    return month;
  }
}

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  noData?: boolean;
}

function MetricCard({ icon, label, value, sub, noData }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start gap-3">
          <div className="text-muted-foreground mt-0.5 shrink-0">{icon}</div>
          <div className="min-w-0">
            <p className="text-helper text-muted-foreground">{label}</p>
            {noData ? (
              <p className="text-lg font-semibold text-muted-foreground">—</p>
            ) : (
              <p className="text-lg font-semibold">{value}</p>
            )}
            {sub && <p className="text-helper text-muted-foreground">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Thin horizontal bar showing a score 0-100. */
function ScoreBar({ score, hasData }: { score: number; hasData: boolean }) {
  if (!hasData) return <div className="h-1.5 rounded-full bg-muted" />;
  const color =
    score >= 70
      ? "bg-green-500"
      : score >= 50
        ? "bg-amber-400"
        : "bg-destructive";
  return (
    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${score}%` }}
      />
    </div>
  );
}

function ComponentRow({ c }: { c: ScoreComponent }) {
  const rawDisplay = !c.hasData
    ? "—"
    : c.raw === null
      ? "—"
      : c.unit === "$/hr"
        ? `$${c.raw.toFixed(0)}/hr`
        : c.unit === "%"
          ? `${c.raw.toFixed(0)}%`
          : c.unit === "jobs/wk"
            ? `${c.raw.toFixed(1)} jobs/wk`
            : `${c.raw} ${c.unit}`;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{c.label}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{rawDisplay}</span>
          <span
            className={`font-medium tabular-nums w-7 text-right ${
              !c.hasData
                ? "text-muted-foreground"
                : c.score >= 70
                  ? "text-green-600"
                  : c.score >= 50
                    ? "text-amber-600"
                    : "text-destructive"
            }`}
          >
            {c.hasData ? c.score : "—"}
          </span>
        </div>
      </div>
      <ScoreBar score={c.score} hasData={c.hasData} />
    </div>
  );
}

function EfficiencyScoreCard({ score }: { score: EfficiencyScore }) {
  if (!score.hasData) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Star className="h-4 w-4 text-muted-foreground" />
            Efficiency Score
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-helper text-muted-foreground">
            No activity data available for this period yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Star className="h-4 w-4 text-muted-foreground" />
            Efficiency Score
          </CardTitle>
          <span className="text-[11px] text-muted-foreground">{score.methodNote}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Overall score + grade */}
        <div className={`flex items-center gap-4 p-3 rounded-lg border ${GRADE_BG[score.grade]}`}>
          <div className="text-center min-w-[3rem]">
            <p className={`text-4xl font-bold tabular-nums ${GRADE_COLOR[score.grade]}`}>
              {score.grade}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">grade</p>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl font-semibold tabular-nums">{score.overall}</span>
              <span className="text-muted-foreground text-sm">/ 100</span>
            </div>
            <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
              <div
                className={`h-full rounded-full ${GRADE_COLOR[score.grade].replace("text-", "bg-")}`}
                style={{ width: `${score.overall}%` }}
              />
            </div>
          </div>
        </div>

        {/* Component breakdown */}
        <div className="space-y-3">
          {score.components.map((c) => (
            <ComponentRow key={c.key} c={c} />
          ))}
        </div>

        {/* Tooltip on scoring method */}
        <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground pt-1 border-t">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            Weights: utilization 30% · revenue/hr 35% · throughput 20% · leads 15%.
            Callback rate excluded — no reliable callback designation in system.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function StrengthsOpportunitiesCard({ score }: { score: EfficiencyScore }) {
  const hasStrengths = score.strengths.length > 0;
  const hasOpportunities = score.opportunities.length > 0;

  if (!score.hasData) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Card>
        <CardContent className="py-4 flex items-start gap-3">
          <TrendingUp className="h-4 w-4 mt-0.5 shrink-0 text-green-600" />
          <div className="min-w-0">
            <p className="text-sm font-medium">Strengths</p>
            {hasStrengths ? (
              <ul className="mt-1 space-y-0.5">
                {score.strengths.map((s) => (
                  <li key={s} className="text-helper text-muted-foreground">
                    · {s}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-helper text-muted-foreground mt-1">
                No standout strengths yet — more data will reveal patterns.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4 flex items-start gap-3">
          <Lightbulb className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
          <div className="min-w-0">
            <p className="text-sm font-medium">Opportunities</p>
            {hasOpportunities ? (
              <ul className="mt-1 space-y-0.5">
                {score.opportunities.map((o) => (
                  <li key={o} className="text-helper text-muted-foreground">
                    · {o}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-helper text-muted-foreground mt-1">
                No significant improvement areas flagged for this period.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LeadConversionCard({ lc }: { lc: LeadConversionMetrics }) {
  if (lc.leadsGenerated === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          Lead Generation &amp; Conversion
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Funnel row */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-center">
            <p className="text-xl font-semibold">{lc.leadsGenerated}</p>
            <p className="text-[11px] text-muted-foreground">Generated</p>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="text-center">
            <p className="text-xl font-semibold">{lc.leadsConvertedToQuote}</p>
            <p className="text-[11px] text-muted-foreground">
              Quoted
              {lc.quoteConversionRate !== null && (
                <span className="ml-1 text-muted-foreground">
                  ({lc.quoteConversionRate}%)
                </span>
              )}
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="text-center">
            <p className="text-xl font-semibold">{lc.leadsConvertedToJob}</p>
            <p className="text-[11px] text-muted-foreground">
              Converted to job
              {lc.jobConversionRate !== null && (
                <span className="ml-1">
                  ({lc.jobConversionRate}%)
                </span>
              )}
            </p>
          </div>
          {lc.hasTracedRevenue && (
            <>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="text-center">
                <p className="text-xl font-semibold text-green-700">
                  {fmtCurrency(lc.leadRevenue)}
                </p>
                <p className="text-[11px] text-muted-foreground">Revenue</p>
              </div>
            </>
          )}
        </div>

        {/* Attribution note */}
        <p className="text-[11px] text-muted-foreground border-t pt-3">
          Contribution tracking only — quote close rate is not attributed to this member.
          {lc.jobConversionRate !== null && lc.quoteConversionRate !== null && (
            <span>
              {" "}
              Quote conversion handled by office/admin; job conversion reflects full pipeline.
            </span>
          )}
        </p>
      </CardContent>
    </Card>
  );
}

// ── Workload allocation ───────────────────────────────────────────────────────

const WORKLOAD_WINDOW_LABELS: Record<WorkloadWindow, string> = {
  today: "Today",
  this_week: "This week",
  last_30_days: "Last 30 days",
};

const WORKLOAD_COLORS = {
  billable: "#6366f1",
  drive: "#10b981",
  general: "#94a3b8",
};

function WorkloadAllocationCard({ memberId }: { memberId: string }) {
  const [window, setWindow] = useState<WorkloadWindow>("last_30_days");

  const { data, isLoading } = useQuery<WorkloadBreakdown>({
    queryKey: [`/api/team/${memberId}/workload-breakdown`, window],
    queryFn: async () => {
      const res = await fetch(`/api/team/${memberId}/workload-breakdown?window=${window}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load workload data");
      return res.json();
    },
    enabled: !!memberId,
    staleTime: 60_000,
    refetchIntervalInBackground: false,
  });

  const pieData = data && data.totalHours > 0
    ? [
        { name: "Billable", value: data.billable.hours, pct: data.billable.pct, color: WORKLOAD_COLORS.billable },
        { name: "Drive", value: data.drive.hours, pct: data.drive.pct, color: WORKLOAD_COLORS.drive },
        { name: "General", value: data.general.hours, pct: data.general.pct, color: WORKLOAD_COLORS.general },
      ].filter((d) => d.value > 0)
    : [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Workload Allocation
          </CardTitle>
          <Select value={window} onValueChange={(v) => setWindow(v as WorkloadWindow)}>
            <SelectTrigger className="w-36 h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(WORKLOAD_WINDOW_LABELS) as WorkloadWindow[]).map((w) => (
                <SelectItem key={w} value={w}>{WORKLOAD_WINDOW_LABELS[w]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-helper text-muted-foreground">Loading…</p>
        ) : !data || data.totalHours === 0 ? (
          <p className="text-helper text-muted-foreground">No time entries recorded for this period.</p>
        ) : (
          <div className="flex items-center gap-6">
            {/* Donut chart */}
            <div className="shrink-0">
              <PieChart width={100} height={100}>
                <Pie
                  data={pieData}
                  cx={46}
                  cy={46}
                  innerRadius={28}
                  outerRadius={46}
                  dataKey="value"
                  strokeWidth={1}
                >
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </div>
            {/* Legend + values */}
            <div className="flex-1 space-y-2">
              {[
                { label: "Billable", cat: data.billable, color: WORKLOAD_COLORS.billable },
                { label: "Drive", cat: data.drive, color: WORKLOAD_COLORS.drive },
                { label: "General", cat: data.general, color: WORKLOAD_COLORS.general },
              ].map(({ label, cat, color }) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-helper text-muted-foreground flex-1">{label}</span>
                  <span className="text-helper font-medium tabular-nums">{fmtHours(cat.hours)}</span>
                  <span className="text-helper text-muted-foreground tabular-nums w-8 text-right">{cat.pct}%</span>
                </div>
              ))}
              <div className="border-t pt-1.5 flex justify-between text-helper">
                <span className="text-muted-foreground">Total</span>
                <span className="font-medium tabular-nums">{fmtHours(data.totalHours)}</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface Props {
  selectedMemberId: string;
}

export function MemberPerformanceTab({ selectedMemberId }: Props) {
  const [period, setPeriod] = useState<MetricsPeriod>("last_30_days");

  const { data, isLoading } = useQuery<MemberPerformanceResponse>({
    queryKey: [`/api/team/${selectedMemberId}/performance`, period],
    queryFn: async () => {
      const res = await fetch(
        `/api/team/${selectedMemberId}/performance?period=${period}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load performance data");
      return res.json();
    },
    enabled: !!selectedMemberId,
    refetchIntervalInBackground: false,
  });

  const metrics = data?.metrics;
  const monthlyTrend = data?.monthlyTrend ?? [];
  const efficiencyScore = data?.efficiencyScore;
  const leadConversion = data?.leadConversion;

  const chartData = monthlyTrend.map((pt: MonthlyPerformancePoint) => ({
    month: monthLabel(pt.month),
    "Jobs Completed": pt.jobsCompleted,
    "Avg Rev/Hr": pt.avgRevPerHour ?? 0,
    _revenue: pt.allocatedRevenue,
    _hours: pt.hoursWorked,
  }));

  const hasChartData = monthlyTrend.some((pt) => pt.jobsCompleted > 0 || pt.hoursWorked > 0);

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <p className="text-helper text-muted-foreground">
          Performance metrics for selected period
        </p>
        <Select value={period} onValueChange={(v) => setPeriod(v as MetricsPeriod)}>
          <SelectTrigger className="w-44 h-8 text-sm" data-testid="select-perf-period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PERIOD_LABELS) as MetricsPeriod[]).map((p) => (
              <SelectItem key={p} value={p}>
                {PERIOD_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Performance Summary chart — always last 12 months */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            Performance Summary — Last 12 Months
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">
              Loading…
            </div>
          ) : !hasChartData ? (
            <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">
              No time or job data recorded yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart
                data={chartData}
                margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorJobs" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="jobs"
                  orientation="left"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                  allowDecimals={false}
                />
                <YAxis
                  yAxisId="rev"
                  orientation="right"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tickFormatter={(v) => `$${v}`}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                  }}
                  formatter={(value: unknown, name: unknown) => {
                    const v = Number(value);
                    if (name === "Avg Rev/Hr") return [`$${v.toFixed(2)}`, String(name)];
                    return [v, String(name ?? "")];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Area
                  yAxisId="jobs"
                  type="monotone"
                  dataKey="Jobs Completed"
                  stroke="#6366f1"
                  strokeWidth={1.5}
                  fill="url(#colorJobs)"
                  dot={false}
                />
                <Area
                  yAxisId="rev"
                  type="monotone"
                  dataKey="Avg Rev/Hr"
                  stroke="#10b981"
                  strokeWidth={1.5}
                  fill="url(#colorRev)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Metric cards grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <MetricCard
          icon={<DollarSign className="h-4 w-4" />}
          label="Revenue from jobs"
          value={fmtCurrency(metrics?.allocatedRevenue ?? 0)}
          noData={!metrics || (metrics.allocatedRevenue === 0 && metrics.jobsCompleted === 0)}
        />
        <MetricCard
          icon={<Briefcase className="h-4 w-4" />}
          label="Jobs completed"
          value={String(metrics?.jobsCompleted ?? 0)}
          noData={!metrics}
        />
        <MetricCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Avg Rev / Hr"
          value={
            metrics?.avgRevPerHour != null
              ? `${fmtCurrencyDetailed(metrics.avgRevPerHour)}/hr`
              : "—"
          }
          noData={!metrics || metrics.avgRevPerHour === null}
        />
        <MetricCard
          icon={<Clock className="h-4 w-4" />}
          label="Total hours worked"
          value={fmtHours(metrics?.hoursWorked ?? 0)}
          noData={!metrics}
        />
        <MetricCard
          icon={<Target className="h-4 w-4" />}
          label="Utilization"
          value={
            metrics?.utilizationPct != null
              ? `${metrics.utilizationPct.toFixed(0)}%`
              : "—"
          }
          sub={
            metrics?.scheduledHoursInPeriod
              ? `of ${fmtHours(metrics.scheduledHoursInPeriod)} scheduled`
              : undefined
          }
          noData={!metrics || metrics.utilizationPct === null}
        />
        <MetricCard
          icon={<Users className="h-4 w-4" />}
          label="Leads generated"
          value={String(metrics?.leadsGenerated ?? 0)}
          noData={!metrics}
        />
      </div>

      {/* Workload allocation donut */}
      <WorkloadAllocationCard memberId={selectedMemberId} />

      {/* Lead conversion funnel */}
      {leadConversion && <LeadConversionCard lc={leadConversion} />}

      {/* Efficiency score */}
      {efficiencyScore && <EfficiencyScoreCard score={efficiencyScore} />}

      {/* Strengths / Opportunities */}
      {efficiencyScore && <StrengthsOpportunitiesCard score={efficiencyScore} />}
    </div>
  );
}
