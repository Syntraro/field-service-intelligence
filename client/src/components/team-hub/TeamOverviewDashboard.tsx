/**
 * TeamOverviewDashboard — default workspace shown when no team member is
 * selected. Replaces the "pick a member to get started" empty state with a
 * real team-level performance overview.
 *
 * Shows a period selector, team KPI strip, and a top-performers table so
 * admins get value from the Team page before drilling into any individual.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Users, Clock, Briefcase, TrendingUp, Star, Wrench, AlertTriangle, ShieldCheck, Activity, CalendarClock } from "lucide-react";
import { resolveTechnicianColor } from "@shared/colors";
import { getMemberDisplayName, getMemberInitials } from "@/lib/displayName";
import { cn } from "@/lib/utils";
import type {
  MetricsPeriod,
  TeamMemberMetrics,
  TeamMetricsResponse,
  TeamMemberRow,
  TeamCapacityForecast,
  PmForecast,
} from "./types";

// ── Skill analytics types (mirrors server/storage/assignmentCandidates.ts) ──

interface ExpiringCertification {
  userId: string;
  memberName: string;
  skillName: string;
  certificationName: string | null;
  certificationExpiresAt: string;
  daysUntilExpiry: number;
  isExpired: boolean;
}

interface SkillCoverageRow {
  skillId: string;
  skillName: string;
  category: string | null;
  memberCount: number;
  certifiedCount: number;
}

interface SkillAnalyticsData {
  totalSkillsInLibrary: number;
  activeSkillsInLibrary: number;
  membersWithSkills: number;
  totalSchedulableMembers: number;
  expiringCertifications: ExpiringCertification[];
  skillCoverage: SkillCoverageRow[];
}

const PERIOD_LABELS: Record<MetricsPeriod, string> = {
  last_30_days: "Last 30 days",
  last_90_days: "Last 90 days",
  last_12_months: "Last 12 months",
};

function fmtHours(h: number): string {
  if (h === 0) return "0 hrs";
  return `${h.toFixed(1)} hrs`;
}

function fmtCurrency(v: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v);
}

interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}

function KpiCard({ icon, label, value, sub }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start gap-3">
          <div className="text-muted-foreground mt-0.5">{icon}</div>
          <div>
            <p className="text-helper text-muted-foreground">{label}</p>
            <p className="text-xl font-semibold">{value}</p>
            {sub && <p className="text-helper text-muted-foreground">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkforceCapacityCard({ forecast }: { forecast: TeamCapacityForecast }) {
  const { today } = forecast;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          Workforce Capacity — Today
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-helper text-muted-foreground">Available</p>
            <p className="text-xl font-semibold tabular-nums">{fmtHours(today.availableHours)}</p>
          </div>
          <div>
            <p className="text-helper text-muted-foreground">Scheduled</p>
            <p className="text-xl font-semibold tabular-nums">{fmtHours(today.scheduledHours)}</p>
          </div>
          <div>
            <p className="text-helper text-muted-foreground">Open</p>
            <p className="text-xl font-semibold tabular-nums">{fmtHours(today.openHours)}</p>
          </div>
          <div>
            <p className="text-helper text-muted-foreground">Utilization</p>
            <p className="text-xl font-semibold tabular-nums">
              {today.utilizationPct !== null ? `${Math.round(today.utilizationPct)}%` : "—"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkforceBalanceCard({ forecast }: { forecast: TeamCapacityForecast }) {
  if (forecast.members.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          Workforce Balance
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground text-xs">
                <th className="pl-4 pr-2 py-2 text-left font-medium">Member</th>
                <th className="px-2 py-2 text-right font-medium">Today util.</th>
                <th className="px-2 py-2 text-right font-medium">Worked this wk</th>
                <th className="px-4 py-2 text-right font-medium">Forecasted wk</th>
              </tr>
            </thead>
            <tbody>
              {forecast.members.map((m) => (
                <tr key={m.userId} className="border-b last:border-0">
                  <td className="pl-4 pr-2 py-2 font-medium text-foreground">{m.name}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {m.todayUtilizationPct !== null
                      ? `${Math.round(m.todayUtilizationPct)}%`
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                    {fmtHours(m.workedHoursThisWeek)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {fmtHours(m.forecastedWeekHours)}
                    {m.targetWeeklyHours > 0 && (
                      <span className="text-muted-foreground text-xs ml-1">
                        / {m.targetWeeklyHours}h
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function PmForecastCard({ forecast }: { forecast: PmForecast }) {
  const windows = [
    { label: "This week", data: forecast.thisWeek },
    { label: "Next week", data: forecast.nextWeek },
    { label: "Next 30 days", data: forecast.next30Days },
  ];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          PM Demand Forecast
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4">
          {windows.map(({ label, data }) => (
            <div key={label}>
              <p className="text-helper text-muted-foreground">{label}</p>
              <p className="text-xl font-semibold tabular-nums">{data.pendingInstanceCount}</p>
              <p className="text-helper text-muted-foreground">{fmtHours(data.estimatedTotalHours)} est.</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-3 pt-2 border-t">
          Pending PM instances only. Estimate uses each job template's default duration.
        </p>
      </CardContent>
    </Card>
  );
}

interface Props {
  onSelectMember: (id: string) => void;
}

export function TeamOverviewDashboard({ onSelectMember }: Props) {
  const [period, setPeriod] = useState<MetricsPeriod>("last_30_days");

  const { data: members = [] } = useQuery<TeamMemberRow[]>({
    queryKey: ["/api/team"],
  });

  const { data: metricsData, isLoading } = useQuery<TeamMetricsResponse>({
    queryKey: ["/api/team/metrics", period],
    queryFn: async () => {
      const res = await fetch(`/api/team/metrics?period=${period}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load team metrics");
      return res.json();
    },
    refetchIntervalInBackground: false,
  });

  const memberIndex = useMemo(() => {
    const m = new Map<string, TeamMemberRow>();
    for (const row of members) m.set(row.id, row);
    return m;
  }, [members]);

  const activeMembers = members.filter((m) => !m.disabled && m.status !== "inactive");
  const inactiveMembers = members.filter((m) => m.disabled || m.status === "inactive");

  const metricsMap = useMemo(() => {
    const m = new Map<string, TeamMemberMetrics>();
    for (const row of metricsData?.members ?? []) m.set(row.userId, row);
    return m;
  }, [metricsData]);

  // Aggregate team totals
  const totals = useMemo(() => {
    const rows = metricsData?.members ?? [];
    return {
      totalHours: rows.reduce((a, r) => a + r.hoursWorked, 0),
      totalJobs: rows.reduce((a, r) => a + r.jobsCompleted, 0),
      totalRevenue: rows.reduce((a, r) => a + r.allocatedRevenue, 0),
      totalLeads: rows.reduce((a, r) => a + r.leadsGenerated, 0),
      avgUtilization:
        rows.filter((r) => r.utilizationPct !== null).length > 0
          ? rows.reduce((a, r) => a + (r.utilizationPct ?? 0), 0) /
            rows.filter((r) => r.utilizationPct !== null).length
          : null,
    };
  }, [metricsData]);

  const { data: capacityForecast } = useQuery<TeamCapacityForecast>({
    queryKey: ["/api/team/capacity-forecast"],
    queryFn: async () => {
      const res = await fetch("/api/team/capacity-forecast", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load capacity forecast");
      return res.json();
    },
    staleTime: 60_000,
    refetchIntervalInBackground: false,
  });

  const { data: pmForecast } = useQuery<PmForecast>({
    queryKey: ["/api/team/pm-forecast"],
    queryFn: async () => {
      const res = await fetch("/api/team/pm-forecast", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load PM forecast");
      return res.json();
    },
    staleTime: 60_000,
    refetchIntervalInBackground: false,
  });

  const { data: skillAnalytics } = useQuery<SkillAnalyticsData>({
    queryKey: ["/api/team/skill-analytics"],
    queryFn: async () => {
      const res = await fetch("/api/team/skill-analytics", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load skill analytics");
      return res.json();
    },
    staleTime: 60_000,
    refetchIntervalInBackground: false,
  });

  // Top performers sorted by jobs completed then revenue
  const topPerformers = useMemo(() => {
    return [...(metricsData?.members ?? [])]
      .sort((a, b) => b.jobsCompleted - a.jobsCompleted || b.allocatedRevenue - a.allocatedRevenue)
      .slice(0, 10);
  }, [metricsData]);

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Team Overview</h2>
          <p className="text-helper text-muted-foreground">
            Select a member on the left to view individual performance.
          </p>
        </div>
        <Select value={period} onValueChange={(v) => setPeriod(v as MetricsPeriod)}>
          <SelectTrigger className="w-44 h-8 text-sm" data-testid="select-team-period">
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

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={<Users className="h-4 w-4" />}
          label="Active members"
          value={String(activeMembers.length)}
          sub={inactiveMembers.length > 0 ? `${inactiveMembers.length} inactive` : undefined}
        />
        <KpiCard
          icon={<Clock className="h-4 w-4" />}
          label="Total hours"
          value={fmtHours(totals.totalHours)}
          sub={
            totals.avgUtilization !== null
              ? `${totals.avgUtilization.toFixed(0)}% avg utilization`
              : undefined
          }
        />
        <KpiCard
          icon={<Briefcase className="h-4 w-4" />}
          label="Jobs completed"
          value={String(totals.totalJobs)}
        />
        <KpiCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Total revenue"
          value={fmtCurrency(totals.totalRevenue)}
          sub={totals.totalLeads > 0 ? `${totals.totalLeads} leads generated` : undefined}
        />
      </div>

      {/* Workforce capacity + balance cards */}
      {capacityForecast && (
        <>
          <WorkforceCapacityCard forecast={capacityForecast} />
          <WorkforceBalanceCard forecast={capacityForecast} />
        </>
      )}

      {/* PM demand forecast */}
      {pmForecast && <PmForecastCard forecast={pmForecast} />}

      {/* Top performers table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Top Performers</CardTitle>
            <Badge variant="secondary" className="text-xs ml-auto">
              {PERIOD_LABELS[period]}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {isLoading ? (
            <p className="px-4 py-6 text-sm text-muted-foreground text-center">
              Loading metrics…
            </p>
          ) : topPerformers.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground text-center">
              No activity data for this period yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="pl-4 pr-2 py-2 text-left font-medium">Member</th>
                    <th className="px-2 py-2 text-right font-medium">Jobs</th>
                    <th className="px-2 py-2 text-right font-medium">Hours</th>
                    <th className="px-2 py-2 text-right font-medium">Avg Rev / Hr</th>
                    <th className="px-2 py-2 text-right font-medium">Utilization</th>
                    <th className="px-4 py-2 text-right font-medium">Leads</th>
                  </tr>
                </thead>
                <tbody>
                  {topPerformers.map((m, i) => {
                    const member = memberIndex.get(m.userId);
                    if (!member) return null;
                    const isInactive = member.disabled || member.status === "inactive";
                    return (
                      <tr
                        key={m.userId}
                        className={`border-b last:border-0 hover:bg-muted/40 cursor-pointer transition-colors ${
                          i % 2 === 0 ? "" : ""
                        }`}
                        onClick={() => onSelectMember(m.userId)}
                        data-testid={`row-top-performer-${m.userId}`}
                      >
                        <td className="pl-4 pr-2 py-2.5">
                          <div className="flex items-center gap-2">
                            <Avatar className="h-7 w-7 shrink-0">
                              <AvatarFallback
                                className="text-[10px] text-white"
                                style={{
                                  backgroundColor: resolveTechnicianColor(m.userId, null),
                                }}
                              >
                                {getMemberInitials(member)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <span className="truncate font-medium text-foreground">
                                {getMemberDisplayName(member)}
                              </span>
                              {isInactive && (
                                <Badge variant="secondary" className="ml-1.5 text-[10px] py-0">
                                  Inactive
                                </Badge>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2.5 text-right tabular-nums">
                          {m.jobsCompleted}
                        </td>
                        <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">
                          {fmtHours(m.hoursWorked)}
                        </td>
                        <td className="px-2 py-2.5 text-right tabular-nums">
                          {m.avgRevPerHour !== null
                            ? `$${m.avgRevPerHour.toFixed(2)}/hr`
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-2 py-2.5 text-right tabular-nums">
                          {m.utilizationPct !== null
                            ? `${m.utilizationPct.toFixed(0)}%`
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {m.leadsGenerated > 0 ? m.leadsGenerated : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Skill analytics ─────────────────────────────────────────────── */}
      {skillAnalytics && (
        <>
          {/* Skill coverage */}
          {skillAnalytics.skillCoverage.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-medium">Skill Coverage</CardTitle>
                  <span className="ml-auto text-helper text-muted-foreground">
                    {skillAnalytics.membersWithSkills}/{skillAnalytics.totalSchedulableMembers} members have skills recorded
                  </span>
                </div>
              </CardHeader>
              <CardContent className="px-0 pb-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground text-xs">
                        <th className="pl-4 pr-2 py-2 text-left font-medium">Skill</th>
                        <th className="px-2 py-2 text-left font-medium">Category</th>
                        <th className="px-2 py-2 text-right font-medium">Members</th>
                        <th className="px-4 py-2 text-right font-medium">Certified</th>
                      </tr>
                    </thead>
                    <tbody>
                      {skillAnalytics.skillCoverage.map((row) => {
                        const understaffed = row.memberCount <= 1;
                        return (
                          <tr key={row.skillId} className="border-b last:border-0">
                            <td className="pl-4 pr-2 py-2">
                              <div className="flex items-center gap-1.5">
                                {understaffed && (
                                  <AlertTriangle
                                    className="h-3.5 w-3.5 text-amber-400 shrink-0"
                                    aria-label="Only 1 member qualified"
                                  />
                                )}
                                <span className={cn("font-medium", understaffed ? "text-amber-800" : "text-foreground")}>
                                  {row.skillName}
                                </span>
                              </div>
                            </td>
                            <td className="px-2 py-2 text-muted-foreground text-xs">
                              {row.category ?? "—"}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums">
                              {row.memberCount}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {row.certifiedCount > 0 ? (
                                <span className="flex items-center justify-end gap-1">
                                  <ShieldCheck className="h-3.5 w-3.5 text-green-500" />
                                  {row.certifiedCount}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
