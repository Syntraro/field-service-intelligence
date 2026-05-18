/**
 * WeekDispatchBoardCell — technician × day cell for the Week Dispatch Board.
 *
 * Renders actual job cards stacked vertically in chronological order.
 * Not a timeline: no absolute time positioning, no overlap math.
 * Drop target for unscheduled-visit cards (existing handleDragEnd week-path).
 *
 * Layout:
 *   - Compact summary strip at top (secondary: job count · hours · util%)
 *   - Stacked visit + task cards (all items — no truncation)
 *   - "No jobs" for empty cells
 */
import { useDroppable } from "@dnd-kit/core";
import { ClipboardList } from "lucide-react";
import type { BoardDayCell } from "./weekDispatchBoardAdapter";
import { formatBoardHours } from "./weekDispatchBoardAdapter";
import type { DispatchDropData } from "./dispatchDndTypes";
import type { DispatchVisit, DispatchTask } from "./dispatchPreviewTypes";
import { jobStateColor } from "./dispatchPreviewUtils";

// ── Time formatting ───────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}${m > 0 ? `:${String(m).padStart(2, "0")}` : ""} ${period}`;
}

function formatTimeWindow(
  start: string | null,
  end: string | null,
  isAllDay: boolean,
): string {
  if (isAllDay) return "All day";
  if (!start) return "Unscheduled";
  const s = fmtTime(start);
  return end ? `${s} – ${fmtTime(end)}` : s;
}

// ── Visit card ────────────────────────────────────────────────────────────────

function VisitCard({
  visit,
  onSelect,
}: {
  visit: DispatchVisit;
  onSelect: (e: React.MouseEvent) => void;
}) {
  const stateColor = jobStateColor(visit.jobStatus, visit.jobOpenSubStatus);
  const timeWindow = formatTimeWindow(
    visit.scheduledStart,
    visit.scheduledEnd,
    visit.isAllDay,
  );
  const isUrgent = visit.priority === "urgent";

  return (
    <button
      onClick={onSelect}
      data-dispatch-block="board-visit-card"
      className={`w-full rounded border-l-2 px-2 py-1.5 text-left transition-shadow hover:shadow-sm ${stateColor}`}
    >
      <p className="text-helper leading-none text-current opacity-70">{timeWindow}</p>
      <p className="mt-0.5 truncate text-row font-semibold leading-tight">{visit.customerName}</p>
      {visit.summary && (
        <p className="truncate text-helper leading-snug opacity-80">{visit.summary}</p>
      )}
      <div className="mt-0.5 flex items-center gap-1 text-helper leading-none opacity-70">
        <span>{formatBoardHours(visit.durationMinutes)}</span>
        {isUrgent && (
          <span className="rounded bg-red-500 px-0.5 py-px text-[9px] text-white leading-none">
            !!
          </span>
        )}
      </div>
    </button>
  );
}

// ── Task card ─────────────────────────────────────────────────────────────────

function TaskCard({ task }: { task: DispatchTask }) {
  const timeWindow = formatTimeWindow(task.scheduledStart, task.scheduledEnd, task.isAllDay);
  return (
    <div className="rounded border border-dashed border-blue-200 bg-blue-50 px-2 py-1.5 text-blue-800">
      <div className="flex items-center gap-1">
        <ClipboardList className="h-3 w-3 flex-shrink-0 text-blue-500" />
        <span className="truncate text-helper leading-tight font-medium">{task.title}</span>
      </div>
      <p className="mt-0.5 text-helper leading-none opacity-70">
        {timeWindow} · {formatBoardHours(task.durationMinutes)}
      </p>
    </div>
  );
}

// ── Utilization bar color ─────────────────────────────────────────────────────

function utilizationBarColor(pct: number): string {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-amber-400";
  return "bg-emerald-500";
}

// ── Main cell ─────────────────────────────────────────────────────────────────

type Props = {
  cell: BoardDayCell;
  techId: string;
  isToday: boolean;
  onCellClick: (techId: string, dayKey: string) => void;
  onSelectVisit: (visit: DispatchVisit) => void;
};

export default function WeekDispatchBoardCell({
  cell,
  techId,
  isToday,
  onCellClick,
  onSelectVisit,
}: Props) {
  const dropData: DispatchDropData = { dayKey: cell.dayKey, technicianId: techId };
  const { setNodeRef, isOver } = useDroppable({
    id: `board-cell-${techId}-${cell.dayKey}`,
    data: dropData,
  });

  const isEmpty = cell.jobCount === 0;

  // Merge visits + tasks into a single ordered list (visits are already chronological
  // from the adapter; tasks follow after).
  type CardItem = { kind: "visit"; visit: DispatchVisit } | { kind: "task"; task: DispatchTask };
  const allItems: CardItem[] = [
    ...cell.visits.map((v): CardItem => ({ kind: "visit", visit: v })),
    ...cell.tasks.map((t): CardItem => ({ kind: "task", task: t })),
  ];

  const handleCellBgClick = () => onCellClick(techId, cell.dayKey);

  return (
    <div
      ref={setNodeRef}
      onClick={handleCellBgClick}
      className={`relative flex flex-col gap-1 rounded border px-1.5 py-1.5 cursor-pointer transition-colors ${
        isOver
          ? "border-emerald-400 bg-emerald-50 ring-1 ring-emerald-300"
          : isToday
            ? "border-blue-200 bg-blue-50/40 hover:bg-blue-50"
            : isEmpty
              ? "border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50"
              : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      {isEmpty ? (
        <span className="py-3 block text-center text-helper text-muted-foreground">
          No jobs
        </span>
      ) : (
        <>
          {/* Compact summary strip — secondary metadata */}
          <div className="flex items-center gap-1 text-helper text-muted-foreground leading-none">
            <span>{cell.jobCount} {cell.jobCount === 1 ? "job" : "jobs"}</span>
            <span>·</span>
            <span>{formatBoardHours(cell.scheduledMinutes)}</span>
            <span>·</span>
            <span>{cell.utilizationPct}%</span>
          </div>

          {/* Utilization bar */}
          <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${utilizationBarColor(cell.utilizationPct)}`}
              style={{ width: `${Math.min(cell.utilizationPct, 100)}%` }}
            />
          </div>

          {/* Stacked job cards — all items, no truncation */}
          <div className="flex flex-col gap-1">
            {allItems.map((item) =>
              item.kind === "visit" ? (
                <VisitCard
                  key={item.visit.id}
                  visit={item.visit}
                  onSelect={(e) => {
                    e.stopPropagation();
                    onSelectVisit(item.visit);
                  }}
                />
              ) : (
                <TaskCard key={item.task.id + "-task"} task={item.task} />
              ),
            )}
          </div>
        </>
      )}

      {/* Drop-over indicator */}
      {isOver && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded bg-emerald-50/50">
          <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-helper text-white shadow">
            Drop to schedule
          </span>
        </div>
      )}
    </div>
  );
}
