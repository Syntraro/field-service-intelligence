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
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ClipboardList } from "lucide-react";
import type { BoardDayCell } from "./weekDispatchBoardAdapter";
import { formatBoardHours } from "./weekDispatchBoardAdapter";
import type { DispatchDragData, DispatchDropData } from "./dispatchDndTypes";
import type { DispatchVisit, DispatchTask } from "./dispatchPreviewTypes";
import { isCompletedStatus, jobStateColor } from "./dispatchPreviewUtils";

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
  techId,
  onSelect,
}: {
  visit: DispatchVisit;
  techId: string;
  onSelect: (e: React.MouseEvent) => void;
}) {
  const isCompleted = isCompletedStatus(visit.status);
  const dragData: DispatchDragData = {
    type: "scheduled-visit",
    visitId: visit.id,
    jobId: visit.jobId,
    jobNumber: visit.jobNumber,
    technicianId: techId,
    durationMinutes: visit.durationMinutes,
    version: visit.version,
    isMultiTech: visit.technicianIds.length > 1,
    originalStart: visit.scheduledStart,
  };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `board-visit-${visit.id}--${techId}`,
    data: dragData,
    disabled: isCompleted,
  });

  const stateColor = jobStateColor(visit.jobStatus, visit.jobOpenSubStatus);
  const timeWindow = formatTimeWindow(
    visit.scheduledStart,
    visit.scheduledEnd,
    visit.isAllDay,
  );
  const isUrgent = visit.priority === "urgent";

  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onSelect}
      data-dispatch-block="board-visit-card"
      className={`w-full rounded border-l-2 px-2 py-1.5 text-left transition-shadow hover:shadow-sm ${stateColor} ${isDragging ? "opacity-40" : ""}`}
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

// ── Card-level split drop zones ───────────────────────────────────────────────

/**
 * Wraps a visit card with two droppable halves covering the card area:
 *   top 50%    → insertAfterVisitId = prevVisitId  (insert before this card)
 *   bottom 50% → insertAfterVisitId = visit.id     (insert after this card)
 *
 * pointer-events-none on the overlay divs so clicks pass through to the card
 * button. dnd-kit collision detection is geometric (getBoundingClientRect),
 * not pointer-event-based, so this does not affect drop detection.
 */
function CardDropZone({
  visit,
  prevVisitId,
  techId,
  dayKey,
  children,
}: {
  visit: DispatchVisit;
  prevVisitId: string | null;
  techId: string;
  dayKey: string;
  children: React.ReactNode;
}) {
  const { setNodeRef: topRef, isOver: topOver } = useDroppable({
    id: `cdz-top-${visit.id}--${techId}-${dayKey}`,
    data: { technicianId: techId, dayKey, insertAfterVisitId: prevVisitId } as DispatchDropData,
  });
  const { setNodeRef: bottomRef, isOver: bottomOver } = useDroppable({
    id: `cdz-bot-${visit.id}--${techId}-${dayKey}`,
    data: { technicianId: techId, dayKey, insertAfterVisitId: visit.id } as DispatchDropData,
  });

  return (
    <div className="relative">
      {/* Top-half droppable — extends 4px above card for easier targeting */}
      <div ref={topRef} className="pointer-events-none absolute inset-x-0 -top-1 z-10 h-[calc(50%+4px)]" />
      {/* Bottom-half droppable — extends 4px below card for easier targeting */}
      <div ref={bottomRef} className="pointer-events-none absolute inset-x-0 -bottom-1 z-10 h-[calc(50%+4px)]" />
      {/* Insertion indicator — 2px bar with glow for clear visual feedback */}
      {topOver && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 -translate-y-px">
          <div className="h-0.5 rounded-full bg-blue-500 shadow-[0_0_4px_1px_rgba(59,130,246,0.5)]" />
        </div>
      )}
      {bottomOver && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 translate-y-px">
          <div className="h-0.5 rounded-full bg-blue-500 shadow-[0_0_4px_1px_rgba(59,130,246,0.5)]" />
        </div>
      )}
      {children}
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

  // Merge visits + tasks into a single ordered list (visits are already sorted
  // by dispatchOrder then scheduledStart from the adapter; tasks follow after).
  type CardItem = { kind: "visit"; visit: DispatchVisit } | { kind: "task"; task: DispatchTask };
  const allItems: CardItem[] = [
    ...cell.visits.map((v): CardItem => ({ kind: "visit", visit: v })),
    ...cell.tasks.map((t): CardItem => ({ kind: "task", task: t })),
  ];

  // Ordered visit IDs for computing prevVisitId in CardDropZone
  const visitIds = cell.visits.map((v) => v.id);

  const handleCellBgClick = () => onCellClick(techId, cell.dayKey);

  return (
    <div
      ref={setNodeRef}
      onClick={handleCellBgClick}
      className={`relative flex flex-col gap-1 rounded border px-1.5 py-1.5 cursor-pointer transition-colors ${
        isOver
          ? "border-emerald-400 bg-emerald-50 ring-1 ring-emerald-300"
          : isToday
            ? "border-blue-300 bg-white hover:bg-slate-50"
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

          {/* Stacked job cards — visits wrapped in CardDropZone for half-card drop targets */}
          <div className="flex flex-col gap-1">
            {allItems.map((item) => {
              if (item.kind === "task") {
                return <TaskCard key={item.task.id + "-task"} task={item.task} />;
              }
              const visitIdx = visitIds.indexOf(item.visit.id);
              const prevVisitId = visitIdx > 0 ? visitIds[visitIdx - 1] : null;
              return (
                <CardDropZone
                  key={item.visit.id}
                  visit={item.visit}
                  prevVisitId={prevVisitId}
                  techId={techId}
                  dayKey={cell.dayKey}
                >
                  <VisitCard
                    visit={item.visit}
                    techId={techId}
                    onSelect={(e) => {
                      e.stopPropagation();
                      onSelectVisit(item.visit);
                    }}
                  />
                </CardDropZone>
              );
            })}
          </div>
        </>
      )}

      {/* Drop-over indicator — shown when dragging an unscheduled card over the cell */}
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
