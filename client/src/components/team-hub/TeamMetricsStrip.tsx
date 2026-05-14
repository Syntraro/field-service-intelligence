// 2026-04-20 Phase 4: compact operational metrics.
// All values derive from canonical queries already fetched by the hub —
// nothing calls a new backend route. This is NOT a dashboard: five tiles,
// one row, no charts, no vanity metrics.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, UserCheck, UserX, Clock, Calendar } from "lucide-react";
import type { TeamMemberRow, TeamTechnicianRow } from "./types";

interface WorkingHoursFeed {
  technicianSchedules: Array<{
    technicianId: string;
    source: "custom" | "company";
  }>;
}

interface Tile {
  label: string;
  value: number | string;
  icon: typeof Users;
  tone?: "default" | "warn" | "muted";
  hint?: string;
}

export function TeamMetricsStrip() {
  // Reuses the exact queries the hub tabs already subscribe to — so this strip
  // is free from a caching standpoint (TanStack dedupes by key).
  const { data: members = [] } = useQuery<TeamMemberRow[]>({ queryKey: ["/api/team"] });
  const { data: technicians = [] } = useQuery<TeamTechnicianRow[]>({
    queryKey: ["/api/team/technicians"],
  });
  const { data: hoursFeed } = useQuery<WorkingHoursFeed>({
    queryKey: ["/api/team/technicians/working-hours"],
  });

  const tiles: Tile[] = useMemo(() => {
    const activeMembers = members.filter(
      (m) => !m.disabled && m.status !== "deactivated"
    ).length;
    const inactiveMembers = members.filter(
      (m) => m.disabled || m.status === "deactivated"
    ).length;
    // /api/team/technicians already applies filterSchedulableTechnicians server-side.
    const schedulableTechs = technicians.length;
    const customSchedules =
      hoursFeed?.technicianSchedules.filter((s) => s.source === "custom").length ?? 0;
    const inheritingCompany =
      hoursFeed?.technicianSchedules.filter((s) => s.source === "company").length ?? 0;

    return [
      {
        label: "Active",
        value: activeMembers,
        icon: UserCheck,
        hint: `${members.length} total`,
      },
      {
        label: "Inactive",
        value: inactiveMembers,
        icon: UserX,
        tone: inactiveMembers > 0 ? "muted" : "default",
      },
      {
        label: "On calendar",
        value: schedulableTechs,
        icon: Users,
        hint: "Shown on dispatch",
      },
      {
        label: "Company hours",
        value: inheritingCompany,
        icon: Calendar,
        hint: "Using defaults",
      },
      {
        label: "Custom schedules",
        value: customSchedules,
        icon: Clock,
        hint: "Overridden",
      },
    ];
  }, [members, technicians, hoursFeed]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <div
            key={t.label}
            className="rounded-md border bg-card px-3 py-2.5"
            data-testid={`metric-${t.label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            <div className="flex items-center gap-2">
              <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-helper text-muted-foreground truncate">{t.label}</span>
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-semibold leading-none">{t.value}</span>
              {t.hint && (
                <span className="text-[10px] text-muted-foreground truncate">{t.hint}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
