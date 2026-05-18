/**
 * WeekDispatchBoard — resource-centric weekly dispatch board.
 *
 * DISTINCT from WeekDispatchGrid (time-axis week timeline).
 * This view is capacity-focused, not time-precise:
 *   - Rows = teams (collapsible) → technicians
 *   - Columns = Mon–Sun
 *   - Cells = compact workload summary (job count / hours / utilisation)
 *   - Right rail = unscheduled jobs (reuses DispatchUnscheduledPanel)
 *   - Clicking a cell opens an inline day-detail panel on the right
 *
 * Drag/drop from unscheduled rail into a board cell uses the existing
 * DispatchPreview handleDragEnd week-path (dayKey + technicianId in
 * DispatchDropData → schedules at DEFAULT_SCHEDULE_HOUR via scheduleVisit).
 */
import { useState, useMemo } from "react";
import { format } from "date-fns";
import { X, Clock } from "lucide-react";
import type {
  Technician,
  DispatchVisit,
  DispatchTask,
  NeedsVisitSetupJob,
} from "./dispatchPreviewTypes";
import { buildBoardTeams, formatBoardHours } from "./weekDispatchBoardAdapter";
import type { BoardDayCell } from "./weekDispatchBoardAdapter";
import WeekDispatchBoardGrid from "./WeekDispatchBoardGrid";
import DispatchUnscheduledPanel from "./DispatchUnscheduledPanel";

// ── Cell detail panel ─────────────────────────────────────────────────────────

function formatVisitTime(visit: DispatchVisit): string {
  if (!visit.scheduledStart) return "All day";
  const d = new Date(visit.scheduledStart);
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

type CellDetailPanelProps = {
  techName: string;
  dayKey: string;
  cell: BoardDayCell;
  onClose: () => void;
  onSelectVisit: (v: DispatchVisit) => void;
};

function CellDetailPanel({ techName, dayKey, cell, onClose, onSelectVisit }: CellDetailPanelProps) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dayLabel = format(new Date(y, m - 1, d), "EEEE, MMM d");

  const sortedVisits = useMemo(
    () =>
      [...cell.visits].sort((a, b) => {
        if (!a.scheduledStart) return 1;
        if (!b.scheduledStart) return -1;
        return a.scheduledStart.localeCompare(b.scheduledStart);
      }),
    [cell.visits],
  );

  const totalMinutes = cell.scheduledMinutes;
  const totalItems = cell.jobCount;

  return (
    <div className="flex w-72 flex-shrink-0 flex-col border-l bg-white">
      {/* Header */}
      <div className="flex items-start justify-between border-b px-4 py-3">
        <div>
          <p className="text-[12px] text-foreground">{techName}</p>
          <p className="text-[11px] text-muted-foreground">{dayLabel}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {totalItems} {totalItems === 1 ? "item" : "items"} · {formatBoardHours(totalMinutes)}
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 transition-colors hover:bg-slate-100"
          aria-label="Close detail panel"
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Job list */}
      <div className="flex-1 overflow-y-auto">
        {totalItems === 0 ? (
          <p className="px-4 py-6 text-center text-[11px] text-muted-foreground">
            No scheduled work on this day.
          </p>
        ) : (
          <div className="divide-y">
            {sortedVisits.map((visit) => (
              <button
                key={visit.id}
                className="w-full px-4 py-2.5 text-left transition-colors hover:bg-slate-50"
                onClick={() => onSelectVisit(visit)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] text-foreground">
                      #{visit.jobNumber} · {visit.customerName}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {visit.locationName}
                    </p>
                    {visit.jobType && (
                      <p className="truncate text-[10px] text-muted-foreground">{visit.jobType}</p>
                    )}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{formatVisitTime(visit)}</span>
                  </div>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-muted-foreground">
                  <span>{formatBoardHours(visit.durationMinutes)}</span>
                  {visit.priority === "urgent" && (
                    <span className="rounded bg-red-100 px-1 py-px text-red-700">Urgent</span>
                  )}
                  <span className="capitalize">{visit.status.replace(/_/g, " ")}</span>
                </div>
              </button>
            ))}

            {cell.tasks.map((task) => (
              <div key={task.id} className="px-4 py-2.5">
                <p className="truncate text-[11px] text-blue-800">{task.title}</p>
                <p className="text-[10px] text-muted-foreground">
                  Task · {formatBoardHours(task.durationMinutes)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main board ────────────────────────────────────────────────────────────────

type SelectedCell = { techId: string; dayKey: string };

type Props = {
  technicians: Technician[];
  visitsByTechByDay: Map<string, Map<string, DispatchVisit[]>>;
  tasksByTechByDay: Map<string, Map<string, DispatchTask[]>>;
  weekDays: Date[];
  unscheduledVisits: DispatchVisit[];
  noVisitJobs: NeedsVisitSetupJob[];
  savingIds: Set<string>;
  onSelectVisit: (visit: DispatchVisit) => void;
};

export default function WeekDispatchBoard({
  technicians,
  visitsByTechByDay,
  tasksByTechByDay,
  weekDays,
  unscheduledVisits,
  noVisitJobs,
  savingIds,
  onSelectVisit,
}: Props) {
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);

  const teams = useMemo(
    () => buildBoardTeams(technicians, visitsByTechByDay, tasksByTechByDay, weekDays),
    [technicians, visitsByTechByDay, tasksByTechByDay, weekDays],
  );

  const handleCellClick = (techId: string, dayKey: string) => {
    setSelectedCell((prev) =>
      prev?.techId === techId && prev.dayKey === dayKey ? null : { techId, dayKey },
    );
  };

  const selectedTech = selectedCell
    ? technicians.find((t) => t.id === selectedCell.techId) ?? null
    : null;

  const selectedCellData = useMemo(() => {
    if (!selectedCell) return null;
    for (const team of teams) {
      const row = team.techRows.find((r) => r.tech.id === selectedCell.techId);
      if (row) return row.cells.get(selectedCell.dayKey) ?? null;
    }
    return null;
  }, [selectedCell, teams]);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Board grid */}
      <WeekDispatchBoardGrid
        teams={teams}
        weekDays={weekDays}
        onCellClick={handleCellClick}
        onSelectVisit={onSelectVisit}
      />

      {/* Cell detail panel — slides in on cell click, closes on same cell or X */}
      {selectedCell && selectedTech && selectedCellData && (
        <CellDetailPanel
          techName={selectedTech.name}
          dayKey={selectedCell.dayKey}
          cell={selectedCellData}
          onClose={() => setSelectedCell(null)}
          onSelectVisit={(v) => {
            onSelectVisit(v);
            setSelectedCell(null);
          }}
        />
      )}

      {/* Unscheduled/open jobs rail — reuses DispatchUnscheduledPanel unchanged.
          Dragging from this rail onto a board cell calls scheduleVisit via the
          existing handleDragEnd week-path (dayKey + technicianId → DEFAULT_SCHEDULE_HOUR). */}
      <DispatchUnscheduledPanel
        visits={unscheduledVisits}
        savingIds={savingIds}
        selectedVisitId={null}
        onSelectVisit={onSelectVisit}
        noVisitJobs={noVisitJobs}
      />
    </div>
  );
}
