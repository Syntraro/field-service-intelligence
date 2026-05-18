// 2026-05-05 Team Hub member-centric restructure.
//
// TeamMemberList — the SINGLE shared sidebar for the Team Hub page.
// Replaces the per-tab member sidebars that used to live inside
// SchedulesTab / CompensationTab / RolesAccessTab.
//
// 2026-05-17 Performance redesign: each member card now shows
// operational metrics (utilization, jobs completed, avg rev/hr,
// leads generated) sourced from GET /api/team/metrics. A period
// selector on the card header controls the metric window.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";
import { resolveTechnicianColor } from "@shared/colors";
import { getMemberDisplayName, getMemberInitials } from "@/lib/displayName";
import type {
  MetricsPeriod,
  Role,
  TeamMemberMetrics,
  TeamMemberRow,
  TeamMetricsResponse,
} from "./types";

interface Props {
  selectedMemberId: string | null;
  onSelect: (id: string) => void;
}

type StatusFilter = "all" | "active" | "inactive";

const PERIOD_LABELS: Record<MetricsPeriod, string> = {
  last_30_days: "30d",
  last_90_days: "90d",
  last_12_months: "12m",
};

export function TeamMemberList({ selectedMemberId, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [period, setPeriod] = useState<MetricsPeriod>("last_30_days");

  const { data: members = [], isLoading } = useQuery<TeamMemberRow[]>({
    queryKey: ["/api/team"],
  });
  const { data: roles = [] } = useQuery<Role[]>({ queryKey: ["/api/roles"] });
  const { data: metricsData } = useQuery<TeamMetricsResponse>({
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

  const metricsMap = useMemo(() => {
    const m = new Map<string, TeamMemberMetrics>();
    for (const row of metricsData?.members ?? []) m.set(row.userId, row);
    return m;
  }, [metricsData]);

  const roleNameToDisplay = useMemo(() => {
    const out = new Map<string, string>();
    for (const r of roles) {
      out.set(r.id, r.displayName);
      out.set(r.name, r.displayName);
    }
    return out;
  }, [roles]);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return members.filter((m) => {
      if (statusFilter === "active" && (m.disabled || m.status === "inactive")) return false;
      if (statusFilter === "inactive" && !m.disabled && m.status !== "inactive") return false;
      if (roleFilter !== "all" && m.roleId !== roleFilter && m.role !== roleFilter) return false;
      if (!s) return true;
      const haystack = `${m.firstName ?? ""} ${m.lastName ?? ""} ${m.fullName ?? ""} ${m.email ?? ""}`.toLowerCase();
      return haystack.includes(s);
    });
  }, [members, search, statusFilter, roleFilter]);

  return (
    <Card className="md:sticky md:top-4 md:self-start" data-testid="team-member-list">
      <CardHeader className="pb-2 space-y-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Team members</CardTitle>
          <Badge variant="secondary" className="text-xs">
            {filtered.length}
          </Badge>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="pl-8 h-8 text-sm"
            data-testid="input-team-list-search"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-team-list-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-team-list-role">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* Period selector for metrics */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground shrink-0">Metrics:</span>
          {(Object.keys(PERIOD_LABELS) as MetricsPeriod[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
                period === p
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`button-metrics-period-${p}`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="px-2 pb-2 max-h-[70vh] overflow-y-auto">
        {isLoading ? (
          <p className="p-3 text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            {search || statusFilter !== "active" || roleFilter !== "all"
              ? "No matches."
              : "No team members yet."}
          </p>
        ) : (
          <ul className="space-y-1">
            {filtered.map((m) => {
              const active = m.id === selectedMemberId;
              const roleLabel =
                roleNameToDisplay.get(m.roleId ?? "") ??
                roleNameToDisplay.get(m.role ?? "") ??
                m.role ??
                "Member";
              const isInactive = m.disabled || m.status === "inactive";
              const mx = metricsMap.get(m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(m.id)}
                    className={`w-full flex items-start gap-2 px-2 py-2.5 rounded-md text-left text-sm transition-colors ${
                      active ? "bg-primary/10 ring-1 ring-primary/20" : "hover:bg-muted"
                    }`}
                    data-testid={`button-team-list-select-${m.id}`}
                    aria-pressed={active}
                  >
                    <Avatar className="h-8 w-8 shrink-0 mt-0.5">
                      <AvatarFallback
                        className="text-[11px] text-white"
                        style={{ backgroundColor: resolveTechnicianColor(m.id, null) }}
                      >
                        {getMemberInitials(m)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="truncate text-foreground font-medium text-[13px]">
                          {getMemberDisplayName(m)}
                        </span>
                        {isInactive && (
                          <Badge variant="secondary" className="text-[10px] py-0 px-1">
                            Inactive
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {roleLabel}
                      </div>
                      {/* Operational metrics */}
                      {mx ? (
                        <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
                          <span className="text-[11px] text-muted-foreground">
                            <span className="font-medium text-foreground">
                              {mx.jobsCompleted}
                            </span>{" "}
                            jobs
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            <span className="font-medium text-foreground">
                              {mx.utilizationPct !== null
                                ? `${mx.utilizationPct.toFixed(0)}%`
                                : "—"}
                            </span>{" "}
                            util
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {mx.avgRevPerHour !== null
                              ? <>
                                  <span className="font-medium text-foreground">
                                    ${mx.avgRevPerHour.toFixed(0)}/hr
                                  </span>{" "}
                                  avg
                                </>
                              : <span className="font-medium text-foreground">—</span>}
                          </span>
                          {mx.leadsGenerated > 0 && (
                            <span className="text-[11px] text-muted-foreground">
                              <span className="font-medium text-foreground">
                                {mx.leadsGenerated}
                              </span>{" "}
                              leads
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          No activity this period
                        </div>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
