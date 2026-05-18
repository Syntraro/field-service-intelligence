/**
 * WeekDispatchBoardTeamRow — team header + nested technician rows.
 *
 * Collapse behavior is conditional on whether the team is real or a fallback:
 *   - Real team (team.id !== "no_team"): collapsible chevron, click to toggle.
 *   - Fallback group (team.id === "no_team"): static section divider, always
 *     expanded, no chevron, no click. Collapsing the only group would leave
 *     the board empty and provide no value.
 *
 * When real team data is available (Technician gains teamId/teamName), the
 * fallback "no_team" groups will disappear and this branching becomes inert.
 * The adapter/team architecture is preserved intact.
 */
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import type { BoardTeam } from "./weekDispatchBoardAdapter";
import { formatBoardHours } from "./weekDispatchBoardAdapter";
import type { DispatchVisit } from "./dispatchPreviewTypes";
import { TECH_SIDEBAR_WIDTH_PX } from "./dispatchPreviewUtils";
import WeekDispatchBoardTechRow from "./WeekDispatchBoardTechRow";

type Props = {
  team: BoardTeam;
  weekDays: Date[];
  todayKey: string;
  defaultExpanded?: boolean;
  onCellClick: (techId: string, dayKey: string) => void;
  onSelectVisit: (visit: DispatchVisit) => void;
};

export default function WeekDispatchBoardTeamRow({
  team, weekDays, todayKey, defaultExpanded = true, onCellClick, onSelectVisit,
}: Props) {
  const isFallback = team.id === "no_team";
  // Fallback group is always expanded — collapsing it would hide all technicians.
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isExpanded = isFallback ? true : expanded;
  const colCount = weekDays.length;

  return (
    <div className="border-b">
      {/* Team header row */}
      <div
        className={`grid bg-slate-50 ${
          isFallback
            ? "" /* static — no interactive styles */
            : "cursor-pointer select-none hover:bg-slate-100 transition-colors"
        }`}
        style={{ gridTemplateColumns: `${TECH_SIDEBAR_WIDTH_PX}px repeat(${colCount}, 1fr)` }}
        onClick={isFallback ? undefined : () => setExpanded((e) => !e)}
        role={isFallback ? undefined : "button"}
        aria-expanded={isFallback ? undefined : isExpanded}
      >
        {/* Team identity */}
        <div className="flex items-center gap-2 border-r px-3 py-1.5">
          {!isFallback && (
            isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            )
          )}
          <div className="min-w-0">
            <p className="truncate text-label text-slate-500">
              {team.name}
            </p>
            <p className="text-helper leading-none text-muted-foreground">
              {team.techRows.length} {team.techRows.length === 1 ? "tech" : "techs"} ·{" "}
              {team.weekJobCount} {team.weekJobCount === 1 ? "job" : "jobs"}
            </p>
          </div>
        </div>

        {/* Per-day aggregate cells */}
        {weekDays.map((day) => {
          const dayKey = format(day, "yyyy-MM-dd");
          const jobCount = team.dailyJobCounts.get(dayKey) ?? 0;
          const minutes = team.dailyMinutes.get(dayKey) ?? 0;
          const isToday = dayKey === todayKey;
          return (
            <div
              key={dayKey}
              className={`flex min-h-[36px] flex-col items-center justify-center border-r px-1 py-1 ${
                isToday ? "bg-blue-50/60" : ""
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              {jobCount > 0 ? (
                <>
                  <span className="text-xs leading-none text-slate-600">{jobCount}</span>
                  <span className="text-helper leading-none text-muted-foreground">
                    {formatBoardHours(minutes)}
                  </span>
                </>
              ) : (
                <span className="text-helper text-slate-300">—</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Technician rows */}
      {isExpanded &&
        team.techRows.map((row) => (
          <WeekDispatchBoardTechRow
            key={row.tech.id}
            row={row}
            weekDays={weekDays}
            todayKey={todayKey}
            colCount={colCount}
            onCellClick={onCellClick}
            onSelectVisit={onSelectVisit}
          />
        ))}
    </div>
  );
}
