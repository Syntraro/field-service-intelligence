/**
 * WeekDispatchBoardGrid — sticky column headers + team/tech rows.
 * Renders the full resource-centric weekly board grid. Data shaping
 * lives in weekDispatchBoardAdapter; this component is render-only.
 * Column width: TECH_SIDEBAR_WIDTH_PX (200px) — matches Day view sidebar.
 */
import { format } from "date-fns";
import type { BoardTeam } from "./weekDispatchBoardAdapter";
import type { DispatchVisit } from "./dispatchPreviewTypes";
import { TECH_SIDEBAR_WIDTH_PX } from "./dispatchPreviewUtils";
import WeekDispatchBoardTeamRow from "./WeekDispatchBoardTeamRow";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Props = {
  teams: BoardTeam[];
  weekDays: Date[];
  onCellClick: (techId: string, dayKey: string) => void;
  onSelectVisit: (visit: DispatchVisit) => void;
};

export default function WeekDispatchBoardGrid({ teams, weekDays, onCellClick, onSelectVisit }: Props) {
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const colCount = weekDays.length;

  return (
    <div className="flex-1 overflow-auto">
      {/* Sticky column headers */}
      <div
        className="sticky top-0 z-10 grid border-b bg-white shadow-sm"
        style={{ gridTemplateColumns: `${TECH_SIDEBAR_WIDTH_PX}px repeat(${colCount}, 1fr)` }}
      >
        <div className="border-r px-3 py-2 text-label text-muted-foreground">
          Technician
        </div>
        {weekDays.map((day, i) => {
          const dayKey = format(day, "yyyy-MM-dd");
          const isToday = dayKey === todayKey;
          return (
            <div
              key={dayKey}
              className={`border-r px-2 py-2 text-center ${isToday ? "bg-blue-50" : ""}`}
            >
              <p className={`text-label ${isToday ? "text-blue-600" : "text-muted-foreground"}`}>
                {colCount === 7 ? DAY_LABELS[i] : format(day, "EEE")}
              </p>
              <p className={`text-row leading-tight ${isToday ? "text-blue-700" : "text-foreground"}`}>
                {format(day, "d")}
              </p>
            </div>
          );
        })}
      </div>

      {teams.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-row text-muted-foreground">
          No technicians visible.
        </div>
      ) : (
        teams.map((team) => (
          <WeekDispatchBoardTeamRow
            key={team.id}
            team={team}
            weekDays={weekDays}
            todayKey={todayKey}
            onCellClick={onCellClick}
            onSelectVisit={onSelectVisit}
          />
        ))
      )}
    </div>
  );
}
