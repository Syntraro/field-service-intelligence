/**
 * weekDispatchBoardAdapter — transforms dispatch week data into a board-ready
 * team / technician / day-cell hierarchy.
 *
 * Team grouping design:
 * When a Technician carries `teamId` + `teamName` in the future, change only
 * the two lines marked "Future:" inside buildBoardTeams. The BoardTeam /
 * BoardTechRow / BoardDayCell shape is stable — rendering code is unaffected.
 *
 * Until team data is available every technician falls under the "no_team"
 * fallback group, shown as "All Technicians".
 *
 * Do NOT scatter workload math into JSX. Capacity calculations live here.
 */
import { format } from "date-fns";
import type { Technician, DispatchVisit, DispatchTask } from "./dispatchPreviewTypes";

/** 8-hour shift = 480 min = 100 % utilisation baseline. */
const WORK_BASELINE_MINUTES = 480;

export type BoardDayCell = {
  dayKey: string;
  jobCount: number;
  scheduledMinutes: number;
  urgentCount: number;
  utilizationPct: number;
  visits: DispatchVisit[];
  tasks: DispatchTask[];
};

export type BoardTechRow = {
  tech: Technician;
  cells: Map<string, BoardDayCell>;
  weekJobCount: number;
  weekScheduledMinutes: number;
  weekUrgentCount: number;
};

export type BoardTeam = {
  id: string;
  name: string;
  techRows: BoardTechRow[];
  weekJobCount: number;
  weekScheduledMinutes: number;
  weekUrgentCount: number;
  /** Per-day total job count — shown on collapsed team row. */
  dailyJobCounts: Map<string, number>;
  /** Per-day total scheduled minutes — shown on collapsed team row. */
  dailyMinutes: Map<string, number>;
};

/** Format scheduled minutes as "Xh Ym", "Xh", "Ym", or "—" when zero. */
export function formatBoardHours(minutes: number): string {
  if (minutes === 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function buildDayCell(
  dayKey: string,
  visits: DispatchVisit[],
  tasks: DispatchTask[],
): BoardDayCell {
  // Sort by scheduledStart ascending (primary), dispatchOrder nulls-last (tie-breaker).
  // scheduledStart is the canonical order after smart-reschedule rewrites times.
  const sortedVisits = [...visits].sort((a, b) => {
    if (!a.scheduledStart && !b.scheduledStart) {
      const aOrd = a.dispatchOrder ?? Infinity;
      const bOrd = b.dispatchOrder ?? Infinity;
      return aOrd - bOrd;
    }
    if (!a.scheduledStart) return 1;
    if (!b.scheduledStart) return -1;
    const timeCmp = a.scheduledStart.localeCompare(b.scheduledStart);
    if (timeCmp !== 0) return timeCmp;
    const aOrd = a.dispatchOrder ?? Infinity;
    const bOrd = b.dispatchOrder ?? Infinity;
    return aOrd - bOrd;
  });
  const sortedTasks = [...tasks].sort((a, b) => {
    if (!a.scheduledStart && !b.scheduledStart) return 0;
    if (!a.scheduledStart) return 1;
    if (!b.scheduledStart) return -1;
    return a.scheduledStart.localeCompare(b.scheduledStart);
  });

  const scheduledMinutes =
    sortedVisits.reduce((s, v) => s + v.durationMinutes, 0) +
    sortedTasks.reduce((s, t) => s + t.durationMinutes, 0);
  const urgentCount = sortedVisits.filter(
    (v) => v.priority === "urgent" || v.dispatchQueueBucket === "urgent",
  ).length;
  const utilizationPct = Math.min(
    Math.round((scheduledMinutes / WORK_BASELINE_MINUTES) * 100),
    999,
  );
  return {
    dayKey,
    jobCount: sortedVisits.length + sortedTasks.length,
    scheduledMinutes,
    urgentCount,
    utilizationPct,
    visits: sortedVisits,
    tasks: sortedTasks,
  };
}

/**
 * Build the full board team / tech / day structure from raw dispatch week data.
 *
 * @param technicians  Ordered, filtered technician roster (no UNASSIGNED_TECH).
 * @param visitsByTechByDay  Map<techId, Map<dayKey, DispatchVisit[]>>.
 * @param tasksByTechByDay   Map<techId, Map<dayKey, DispatchTask[]>>.
 * @param weekDays  Ordered Date[] for the visible week (Mon–Sun, or subset).
 */
export function buildBoardTeams(
  technicians: Technician[],
  visitsByTechByDay: Map<string, Map<string, DispatchVisit[]>>,
  tasksByTechByDay: Map<string, Map<string, DispatchTask[]>>,
  weekDays: Date[],
): BoardTeam[] {
  const dayKeys = weekDays.map((d) => format(d, "yyyy-MM-dd"));

  const groupMap = new Map<string, { name: string; techs: Technician[] }>();

  for (const tech of technicians) {
    // Future: const teamId = (tech as any).teamId ?? "no_team";
    // Future: const teamName = (tech as any).teamName ?? "No Team";
    const teamId = "no_team";
    const teamName = "All Technicians";
    if (!groupMap.has(teamId)) groupMap.set(teamId, { name: teamName, techs: [] });
    groupMap.get(teamId)!.techs.push(tech);
  }

  const teams: BoardTeam[] = [];

  for (const [teamId, { name, techs }] of Array.from(groupMap.entries())) {
    const techRows: BoardTechRow[] = techs.map((tech) => {
      const cells = new Map<string, BoardDayCell>();
      for (const dayKey of dayKeys) {
        const visits = visitsByTechByDay.get(tech.id)?.get(dayKey) ?? [];
        const tasks = tasksByTechByDay.get(tech.id)?.get(dayKey) ?? [];
        cells.set(dayKey, buildDayCell(dayKey, visits, tasks));
      }
      return {
        tech,
        cells,
        weekJobCount: Array.from(cells.values()).reduce((s, c) => s + c.jobCount, 0),
        weekScheduledMinutes: Array.from(cells.values()).reduce(
          (s, c) => s + c.scheduledMinutes,
          0,
        ),
        weekUrgentCount: Array.from(cells.values()).reduce(
          (s, c) => s + c.urgentCount,
          0,
        ),
      };
    });

    const dailyJobCounts = new Map<string, number>();
    const dailyMinutes = new Map<string, number>();
    for (const dayKey of dayKeys) {
      dailyJobCounts.set(
        dayKey,
        techRows.reduce((s, r) => s + (r.cells.get(dayKey)?.jobCount ?? 0), 0),
      );
      dailyMinutes.set(
        dayKey,
        techRows.reduce((s, r) => s + (r.cells.get(dayKey)?.scheduledMinutes ?? 0), 0),
      );
    }

    teams.push({
      id: teamId,
      name,
      techRows,
      weekJobCount: techRows.reduce((s, r) => s + r.weekJobCount, 0),
      weekScheduledMinutes: techRows.reduce((s, r) => s + r.weekScheduledMinutes, 0),
      weekUrgentCount: techRows.reduce((s, r) => s + r.weekUrgentCount, 0),
      dailyJobCounts,
      dailyMinutes,
    });
  }

  return teams;
}
