/**
 * WeekDayColumn (WeekDispatchCell) — single day column in the week calendar grid.
 * Positions visit and task blocks vertically by scheduledStart time.
 * Acts as a drop target for DnD rescheduling (dayKey-based, no tech rows).
 * Each visit/task block is draggable for cross-day moves.
 * Supports bottom-edge resize with 15-minute snap, overlap clamping via shared utils.
 *
 * 2026-03-30: Rewritten from tech×day cell to vertical time-positioned column.
 * 2026-03-30: Added resize support, unassigned badge, 15-min snapping, overlap cap.
 */
import { useState, useMemo, useCallback, useRef } from "react";
import { addMinutes } from "date-fns";
import { useDraggable, useDroppable, useDndContext, useDndMonitor } from "@dnd-kit/core";
import type { DispatchVisit, DispatchTask, DispatchLeadVisit } from "./dispatchPreviewTypes";
import type { DispatchDragData, DispatchDropData } from "./dispatchDndTypes";
import { formatDuration, isCompletedStatus, jobStateColor, SNAP_MINUTES, MIN_DURATION_MINUTES } from "./dispatchPreviewUtils";
import { UNASSIGNED_COLOR } from "@shared/colors";
import { clampResizeEnd } from "./dispatchOverlapUtils";
import { VisitCardContent } from "./VisitCardContent";
import { ClipboardList, Truck, User } from "lucide-react";
import { useHoverSetter, useIsVisitHovered } from "./dispatchHoverContext";

type Props = {
  dayKey: string;
  visits: DispatchVisit[];
  tasks: DispatchTask[];
  /** 2026-05-05 Phase 3 correction: per-day lead visits placed in
   *  the same day column. Branch render only — never read jobNumber/
   *  jobStatus/openSubStatus/version/etc. from these. Not draggable,
   *  not resizable, not a drop target. Click → /leads/:leadId. */
  leadVisits: DispatchLeadVisit[];
  startHour: number;
  endHour: number;
  hourHeight: number;
  selectedItemId: string | null;
  savingIds: Set<string>;
  onSelectVisit: (visit: DispatchVisit) => void;
  onSelectTask: (task: DispatchTask) => void;
  /** 2026-05-05 Phase 3 correction: lead-visit click handler — routes
   *  to /leads/:leadId, not a job route. Required when leadVisits is
   *  non-empty. */
  onOpenLead: (leadId: string) => void;
  onResize?: (visit: DispatchVisit, newEndTime: string) => void;
  /** 2026-03-31: techId→color lookup for week-view card coloring */
  techColorMap?: Map<string, string>;
};

const MIN_BLOCK_HEIGHT = 18;
/** Maximum side-by-side overlap columns before compression kicks in */
const MAX_OVERLAP_COLUMNS = 3;

// ── Overlap column assignment ──
// Groups overlapping items and assigns horizontal columns for side-by-side rendering.
// Caps at MAX_OVERLAP_COLUMNS — excess items stack into the last column.
interface LayoutInfo { column: number; totalColumns: number; }

function computeOverlapLayout(items: Array<{ id: string; startMin: number; endMin: number }>): Map<string, LayoutInfo> {
  const layouts = new Map<string, LayoutInfo>();
  if (items.length === 0) return layouts;

  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  // Greedy column assignment: each item takes the first column that doesn't overlap
  const columns: Array<{ endMin: number }>[] = [];
  const itemCols = new Map<string, number>();

  for (const item of sorted) {
    let placed = false;
    for (let col = 0; col < columns.length; col++) {
      const colItems = columns[col];
      const lastEnd = colItems[colItems.length - 1].endMin;
      if (item.startMin >= lastEnd) {
        colItems.push(item);
        itemCols.set(item.id, col);
        placed = true;
        break;
      }
    }
    if (!placed) {
      columns.push([item]);
      itemCols.set(item.id, columns.length - 1);
    }
  }

  // Determine max columns per overlap group (connected set of overlapping items)
  const groups: string[][] = [];
  let currentGroup: typeof sorted = [];
  let groupEnd = 0;

  for (const item of sorted) {
    if (currentGroup.length === 0 || item.startMin < groupEnd) {
      currentGroup.push(item);
      groupEnd = Math.max(groupEnd, item.endMin);
    } else {
      groups.push(currentGroup.map(i => i.id));
      currentGroup = [item];
      groupEnd = item.endMin;
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup.map(i => i.id));

  for (const group of groups) {
    const usedCols = new Set(group.map(id => itemCols.get(id)!));
    // Cap visual columns at MAX_OVERLAP_COLUMNS for readability
    const rawTotal = usedCols.size;
    const totalColumns = Math.min(rawTotal, MAX_OVERLAP_COLUMNS);
    for (const id of group) {
      const colsArray = Array.from(usedCols).sort((a, b) => a - b);
      const rawCol = colsArray.indexOf(itemCols.get(id)!);
      // Items beyond MAX_OVERLAP_COLUMNS share the last column
      const column = Math.min(rawCol, MAX_OVERLAP_COLUMNS - 1);
      layouts.set(id, { column, totalColumns });
    }
  }

  return layouts;
}

/** Format minutes-since-midnight as "h:mm AM/PM" for ghost preview label */
function formatMinuteTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

/** Convert a scheduled item to time range (minutes from midnight) */
function toTimeRange(scheduledStart: string | null, durationMinutes: number): { startMin: number; endMin: number } | null {
  if (!scheduledStart) return null;
  const s = new Date(scheduledStart);
  const startMin = s.getHours() * 60 + s.getMinutes();
  return { startMin, endMin: startMin + durationMinutes };
}

// ── Draggable + resizable visit block ──
function WeekCalendarVisitBlock({ visit, top, height, left, width, isSelected, isSaving, onSelect, onResize, dayKey, hourHeight, startHour, endHour, laneVisits, laneTasks, techColor }: {
  visit: DispatchVisit;
  top: number;
  height: number;
  left: string;
  width: string;
  isSelected: boolean;
  isSaving: boolean;
  onSelect: (v: DispatchVisit) => void;
  onResize?: (v: DispatchVisit, newEndTime: string) => void;
  dayKey: string;
  hourHeight: number;
  startHour: number;
  endHour: number;
  laneVisits: DispatchVisit[];
  laneTasks: DispatchTask[];
  /** 2026-03-31: Assigned technician color for left accent */
  techColor?: string;
}) {
  // Per-id hover subscription: this cell only re-renders when ITS hover state flips.
  const setHoveredVisitId = useHoverSetter();
  const isMapHovered = useIsVisitHovered(visit.id);
  const isCompleted = isCompletedStatus(visit.status);
  // 2026-04-19: unassigned and source-tech derive from canonical crew array.
  const primaryTechId = visit.technicianIds[0] ?? null;
  const isUnassigned = visit.technicianIds.length === 0;
  const dragData: DispatchDragData = {
    type: "scheduled-visit",
    visitId: visit.id,
    jobId: visit.jobId,
    jobNumber: visit.jobNumber,
    technicianId: primaryTechId,
    durationMinutes: visit.durationMinutes,
    version: visit.version,
    isMultiTech: visit.technicianIds.length > 1,
    originalStart: visit.scheduledStart,
  };

  const [isResizing, setIsResizing] = useState(false);
  const [resizeDeltaY, setResizeDeltaY] = useState(0);
  const resizeStartYRef = useRef(0);
  const resizeStartHeightRef = useRef(0);
  const suppressClickUntilRef = useRef(0);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `week-cal-visit-${visit.id}--${dayKey}`,
    data: dragData,
    disabled: isSaving || isCompleted || isResizing,
  });

  const stateColor = jobStateColor(visit.jobStatus, visit.jobOpenSubStatus);

  // Scope resize clamp candidates to same-technician only (mirrors Day view per-lane behavior).
  // Week view merges all techs visually, but resize must not clamp against other techs' items.
  const sameTechVisits = useMemo(() => {
    if (isUnassigned) {
      return laneVisits.filter(v => v.technicianIds.length === 0);
    }
    return laneVisits.filter(v => v.technicianIds.includes(primaryTechId!));
  }, [laneVisits, primaryTechId, isUnassigned]);

  const sameTechTasks = useMemo(() => {
    if (isUnassigned) {
      return laneTasks.filter(t => !t.assignedToUserId);
    }
    return laneTasks.filter(t => t.assignedToUserId === primaryTechId);
  }, [laneTasks, primaryTechId, isUnassigned]);

  // Compute clamped duration from a raw pixel height during resize
  const clampedDurationFromHeight = useCallback((rawHeight: number): number => {
    if (!visit.scheduledStart) return MIN_DURATION_MINUTES;
    const start = new Date(visit.scheduledStart);
    const startMinuteOfDay = start.getHours() * 60 + start.getMinutes();
    const rawMinutes = (rawHeight / hourHeight) * 60;
    const snappedMinutes = Math.max(
      Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES,
      MIN_DURATION_MINUTES,
    );
    const proposedEnd = startMinuteOfDay + snappedMinutes;
    // Clamp against same-tech items + timeline end using shared overlap util
    const clampedEnd = clampResizeEnd(startMinuteOfDay, proposedEnd, sameTechVisits, sameTechTasks, visit.id, endHour);
    return Math.max(clampedEnd - startMinuteOfDay, MIN_DURATION_MINUTES);
  }, [visit.scheduledStart, visit.id, hourHeight, endHour, sameTechVisits, sameTechTasks]);

  // Effective height during resize
  const rawResizeHeight = isResizing
    ? Math.max(resizeStartHeightRef.current + resizeDeltaY, (MIN_DURATION_MINUTES / 60) * hourHeight)
    : 0;
  const effectiveHeight = isResizing
    ? (clampedDurationFromHeight(rawResizeHeight) / 60) * hourHeight
    : Math.max(height, MIN_BLOCK_HEIGHT);
  const previewDuration = isResizing
    ? clampedDurationFromHeight(rawResizeHeight)
    : visit.durationMinutes;

  const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);
    resizeStartYRef.current = e.clientY;
    resizeStartHeightRef.current = Math.max(height, MIN_BLOCK_HEIGHT);
    setResizeDeltaY(0);
    suppressClickUntilRef.current = Date.now() + 2000;

    const onPointerMove = (ev: PointerEvent) => {
      setResizeDeltaY(ev.clientY - resizeStartYRef.current);
    };

    const onPointerUp = (ev: PointerEvent) => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      setIsResizing(false);
      setResizeDeltaY(0);
      suppressClickUntilRef.current = Date.now() + 500;

      const finalDelta = ev.clientY - resizeStartYRef.current;
      const finalHeight = Math.max(resizeStartHeightRef.current + finalDelta, (MIN_DURATION_MINUTES / 60) * hourHeight);

      if (visit.scheduledStart && onResize) {
        const start = new Date(visit.scheduledStart);
        const startMinuteOfDay = start.getHours() * 60 + start.getMinutes();
        const rawMinutes = (finalHeight / hourHeight) * 60;
        const snappedMinutes = Math.max(
          Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES,
          MIN_DURATION_MINUTES,
        );
        const proposedEnd = startMinuteOfDay + snappedMinutes;
        const clampedEnd = clampResizeEnd(startMinuteOfDay, proposedEnd, sameTechVisits, sameTechTasks, visit.id, endHour);
        const clampedMinutes = Math.max(clampedEnd - startMinuteOfDay, MIN_DURATION_MINUTES);

        if (clampedMinutes !== visit.durationMinutes) {
          onResize(visit, addMinutes(start, clampedMinutes).toISOString());
        }
      }
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  }, [height, visit, onResize, hourHeight, sameTechVisits, sameTechTasks, endHour]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (Date.now() < suppressClickUntilRef.current) return;
    onSelect(visit);
  }, [visit, onSelect]);

  return (
    <div
      ref={setNodeRef}
      {...(isResizing ? {} : listeners)}
      {...(isResizing ? {} : attributes)}
      data-dispatch-block="week-cal-visit"
      data-visit-id={visit.id}
      onClick={handleClick}
      onMouseEnter={() => setHoveredVisitId(visit.id)}
      onMouseLeave={() => setHoveredVisitId(null)}
      className={`group/visit absolute rounded border px-1 py-0.5 text-left transition-shadow ${techColor ? "" : stateColor} ${
        isResizing ? "overflow-visible z-20 shadow-lg" : "overflow-hidden"
      } ${isSelected ? "ring-2 ring-emerald-500 z-10" : "z-[1]"
      } ${isDragging ? "opacity-40 shadow-lg z-30" : "hover:shadow-sm"} ${isMapHovered && !isSelected ? "ring-2 ring-emerald-400 shadow-md z-10" : ""} ${isCompleted ? "opacity-50" : ""} ${isSaving ? "pointer-events-none opacity-60" : ""} ${!isResizing ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{ top, height: effectiveHeight, left, width, ...(techColor ? { backgroundColor: `${techColor}25`, borderColor: `${techColor}66`, borderLeftWidth: 3, borderLeftColor: techColor } : {}) }}
    >
      {/* Unassigned indicator */}
      {isUnassigned && (
        <div className="absolute top-0.5 right-0.5 flex items-center gap-px rounded bg-slate-200/80 px-1 py-px z-[2]">
          <User className="h-2 w-2 text-slate-500" />
          <span className="text-[7px] font-medium text-slate-500 leading-none">–</span>
        </div>
      )}

      <VisitCardContent visit={visit} variant="week-calendar" displayDuration={isResizing ? previewDuration : undefined} />

      {/* Resize duration tooltip during resize */}
      {isResizing && (
        <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold text-white whitespace-nowrap shadow z-30">
          {formatDuration(previewDuration)}
        </div>
      )}

      {/* Bottom resize handle — visible on hover, not for completed visits */}
      {!isCompleted && !isSaving && onResize && (
        <div
          className="absolute bottom-0 left-0 right-0 h-2 cursor-s-resize opacity-0 hover:opacity-100 group-hover/visit:opacity-60 transition-opacity z-[3]"
          onPointerDown={handleResizePointerDown}
        >
          <div className="mx-auto w-6 h-[3px] rounded-full bg-slate-400 mt-0.5" />
        </div>
      )}
    </div>
  );
}

// ── Draggable task block ──
function WeekCalendarTaskBlock({ task, top, height, left, width, isSelected, isSaving, onSelect, dayKey }: {
  task: DispatchTask;
  top: number;
  height: number;
  left: string;
  width: string;
  isSelected: boolean;
  isSaving: boolean;
  onSelect: (t: DispatchTask) => void;
  dayKey: string;
}) {
  const dragData: DispatchDragData = {
    type: "scheduled-task",
    visitId: task.id,
    jobId: task.jobId ?? "",
    jobNumber: 0,
    technicianId: task.assignedToUserId,
    durationMinutes: task.durationMinutes || 60,
    version: 0,
    originalStart: task.scheduledStart,
  };

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `week-cal-task-${task.id}--${dayKey}`,
    data: dragData,
  });

  const isQuoteAssessment = task.type === "QUOTE_ASSESSMENT";

  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-dispatch-block="week-cal-task"
      data-task-id={task.id}
      onClick={(e) => { e.stopPropagation(); onSelect(task); }}
      className={`absolute rounded border border-dashed px-1 py-0.5 text-left overflow-hidden cursor-grab active:cursor-grabbing transition-shadow ${
        isQuoteAssessment ? "border-amber-300 bg-amber-50" : "border-blue-200 bg-blue-50"
      } ${isSelected ? "ring-1 ring-blue-500 z-10" : "z-[1]"} ${isDragging ? "opacity-40 shadow-lg" : "hover:shadow-sm"} ${isSaving ? "pointer-events-none opacity-60" : ""}`}
      style={{ top, height: Math.max(height, MIN_BLOCK_HEIGHT), left, width }}
    >
      <div className="flex items-center gap-1 overflow-hidden leading-tight">
        {task.type === "SUPPLIER_VISIT" || task.type === "supplier_run"
          ? <Truck className="h-2.5 w-2.5 flex-shrink-0 text-blue-500" />
          : <ClipboardList className="h-2.5 w-2.5 flex-shrink-0 text-blue-500" />}
        <span className="truncate text-[10px] font-medium text-blue-800">{task.title}</span>
      </div>
      {height > 24 && (
        <p className="text-[9px] text-blue-500">{formatDuration(task.durationMinutes)}</p>
      )}
    </button>
  );
}

/**
 * Lead-visit block — amber pill, "Lead" badge, no jobNumber/jobStatus.
 * NOT draggable, NOT resizable, NOT a drop target. Branch render only.
 * Click → onOpenLead(leadId). Uses the same vertical positioning math
 * as job-visit blocks so it sits in the right time slot, but never
 * shares any DnD or color-by-tech logic with them.
 */
function WeekCalendarLeadVisitBlock({
  leadVisit, top, height, left, width, onOpenLead,
}: {
  leadVisit: DispatchLeadVisit;
  top: number;
  height: number;
  left: string;
  width: string;
  onOpenLead: (leadId: string) => void;
}) {
  const time = leadVisit.scheduledStart && !leadVisit.isAllDay
    ? new Date(leadVisit.scheduledStart)
    : null;
  const timeLabel = time
    ? `${time.getHours() === 0 ? 12 : time.getHours() > 12 ? time.getHours() - 12 : time.getHours()}:${String(time.getMinutes()).padStart(2, "0")} ${time.getHours() >= 12 ? "PM" : "AM"}`
    : (leadVisit.isAllDay ? "All day" : "");
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onOpenLead(leadVisit.leadId); }}
      data-dispatch-block="week-cal-lead-visit"
      data-lead-visit-id={leadVisit.id}
      data-testid={`week-lead-visit-${leadVisit.id}`}
      className="absolute rounded border border-amber-300 bg-amber-50 hover:bg-amber-100 px-1 py-0.5 text-left overflow-hidden transition-colors z-[1]"
      style={{ top, height: Math.max(height, MIN_BLOCK_HEIGHT), left, width, borderLeftWidth: 3, borderLeftColor: "#f59e0b" }}
      title={`Lead visit · ${leadVisit.leadTitle}${timeLabel ? ` · ${timeLabel}` : ""}`}
    >
      <div className="flex items-center gap-1 leading-tight min-w-0">
        <span className="rounded bg-amber-500 text-white text-[8px] font-bold px-1 py-px leading-none uppercase tracking-wide shrink-0">
          Lead
        </span>
        {timeLabel && (
          <span className="text-[10px] font-medium text-amber-900 leading-none shrink-0">
            {timeLabel}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[10px] text-amber-900 leading-tight truncate">
        {leadVisit.leadTitle}
      </p>
      {height > 38 && leadVisit.locationCity && (
        <p className="text-[9px] text-amber-700 leading-tight truncate">
          {leadVisit.locationCity}
        </p>
      )}
    </button>
  );
}

// ── Main day column component ──
export default function WeekDayColumn({
  dayKey, visits, tasks, leadVisits, startHour, endHour, hourHeight,
  selectedItemId, savingIds, onSelectVisit, onSelectTask, onOpenLead, onResize, techColorMap,
}: Props) {
  // Register as drop target — calendar-style: dayKey only, no technicianId
  const dropData: DispatchDropData = { dayKey };
  const { setNodeRef, isOver } = useDroppable({
    id: `week-day-${dayKey}`,
    data: dropData,
  });

  // Ref to column DOM node for pointer-relative ghost positioning
  const columnElRef = useRef<HTMLDivElement | null>(null);
  const mergedRef = useCallback((node: HTMLDivElement | null) => {
    setNodeRef(node);
    columnElRef.current = node;
  }, [setNodeRef]);

  // Ghost preview: snapped start minute during drag-over
  const { active } = useDndContext();
  const [ghostStartMin, setGhostStartMin] = useState<number | null>(null);
  const droppableId = `week-day-${dayKey}`;

  useDndMonitor({
    onDragMove(event) {
      if (!columnElRef.current) return;
      // Only compute ghost when hovering this specific column
      if (event.over?.id !== droppableId) {
        if (ghostStartMin !== null) setGhostStartMin(null);
        return;
      }
      const activator = event.activatorEvent as PointerEvent;
      const currentY = activator.clientY + event.delta.y;
      const rect = columnElRef.current.getBoundingClientRect();
      const relativeY = currentY - rect.top;
      const minuteOffset = (relativeY / hourHeight) * 60;
      const absoluteMinute = startHour * 60 + minuteOffset;
      // Snap to 15-minute grid, clamp to visible range
      const snapped = Math.round(absoluteMinute / SNAP_MINUTES) * SNAP_MINUTES;
      const clamped = Math.max(startHour * 60, Math.min(snapped, endHour * 60 - SNAP_MINUTES));
      setGhostStartMin(clamped);
    },
    onDragEnd() { setGhostStartMin(null); },
    onDragCancel() { setGhostStartMin(null); },
  });

  const totalHeight = (endHour - startHour) * hourHeight;

  // Compute vertical positions and overlap layouts.
  // 2026-05-05 Phase 3 correction: lead visits join the SAME overlap
  // layout as jobs/tasks so they don't visually collide — they get a
  // side-by-side column when their timeslot overlaps. They keep a
  // separate position map so the render path stays type-discriminated;
  // we never read jobNumber/jobStatus/etc. from them.
  const { visitPositions, taskPositions, leadVisitPositions } = useMemo(() => {
    const allRanges: Array<{ id: string; startMin: number; endMin: number; kind: "visit" | "task" | "lead" }> = [];

    for (const v of visits) {
      const range = toTimeRange(v.scheduledStart, v.durationMinutes);
      if (range) allRanges.push({ id: v.id, ...range, kind: "visit" });
    }
    for (const t of tasks) {
      const range = toTimeRange(t.scheduledStart, t.durationMinutes);
      if (range) allRanges.push({ id: t.id, ...range, kind: "task" });
    }
    for (const lv of leadVisits) {
      const range = toTimeRange(lv.scheduledStart, lv.durationMinutes ?? 60);
      if (range) allRanges.push({ id: lv.id, ...range, kind: "lead" });
    }

    const layouts = computeOverlapLayout(allRanges);
    const startMinOffset = startHour * 60;

    const vPos = new Map<string, { top: number; height: number; left: string; width: string }>();
    const tPos = new Map<string, { top: number; height: number; left: string; width: string }>();
    const lPos = new Map<string, { top: number; height: number; left: string; width: string }>();

    for (const item of allRanges) {
      const layout = layouts.get(item.id) ?? { column: 0, totalColumns: 1 };
      const top = ((item.startMin - startMinOffset) / 60) * hourHeight;
      const height = Math.max(((item.endMin - item.startMin) / 60) * hourHeight, MIN_BLOCK_HEIGHT);
      const colWidth = 100 / layout.totalColumns;
      const left = `${layout.column * colWidth}%`;
      const width = `${colWidth - 1}%`;

      const pos = { top, height, left, width };
      if (item.kind === "visit") vPos.set(item.id, pos);
      else if (item.kind === "task") tPos.set(item.id, pos);
      else lPos.set(item.id, pos);
    }

    return { visitPositions: vPos, taskPositions: tPos, leadVisitPositions: lPos };
  }, [visits, tasks, leadVisits, startHour, hourHeight]);

  return (
    <div ref={mergedRef} data-week-day={dayKey} className="absolute inset-0" style={{ height: totalHeight }}>
      {/* Visit blocks */}
      {visits.map(v => {
        const pos = visitPositions.get(v.id);
        if (!pos) return null;
        return (
          <WeekCalendarVisitBlock
            key={v.id}
            visit={v}
            top={pos.top}
            height={pos.height}
            left={pos.left}
            width={pos.width}
            isSelected={selectedItemId === v.id}
            isSaving={savingIds.has(v.id)}
            onSelect={onSelectVisit}
            onResize={onResize}
            dayKey={dayKey}
            hourHeight={hourHeight}
            startHour={startHour}
            endHour={endHour}
            laneVisits={visits}
            laneTasks={tasks}
            techColor={(v.technicianIds[0] ?? null) ? techColorMap?.get(v.technicianIds[0]) : UNASSIGNED_COLOR}
          />
        );
      })}

      {/* Task blocks */}
      {tasks.map(t => {
        const pos = taskPositions.get(t.id);
        if (!pos) return null;
        return (
          <WeekCalendarTaskBlock
            key={t.id}
            task={t}
            top={pos.top}
            height={pos.height}
            left={pos.left}
            width={pos.width}
            isSelected={selectedItemId === t.id}
            isSaving={savingIds.has(t.id)}
            onSelect={onSelectTask}
            dayKey={dayKey}
          />
        );
      })}

      {/* 2026-05-05 Phase 3 correction: lead-visit blocks. Branch render
          rule: only items where `type === "lead_visit"` flow through this
          path. Job-shaped fields (jobNumber, jobStatus, openSubStatus,
          version, durationMinutes resize) are NOT touched here. */}
      {leadVisits.map(lv => {
        if (lv.type !== "lead_visit") return null;
        const pos = leadVisitPositions.get(lv.id);
        if (!pos) return null;
        return (
          <WeekCalendarLeadVisitBlock
            key={lv.id}
            leadVisit={lv}
            top={pos.top}
            height={pos.height}
            left={pos.left}
            width={pos.width}
            onOpenLead={onOpenLead}
          />
        );
      })}

      {/* Ghost preview — snapped to 15-min slot under cursor during drag-over */}
      {isOver && ghostStartMin !== null && active?.data?.current && (
        <div
          className="absolute left-0 right-0 rounded border-2 border-dashed border-emerald-400 bg-emerald-50/40 pointer-events-none z-20"
          style={{
            top: ((ghostStartMin - startHour * 60) / 60) * hourHeight,
            height: Math.max(
              ((active.data.current.durationMinutes ?? 60) / 60) * hourHeight,
              MIN_BLOCK_HEIGHT,
            ),
          }}
        >
          <span className="text-[10px] font-medium text-emerald-600 px-1 leading-tight">
            {formatMinuteTime(ghostStartMin)} · {formatDuration(active.data.current.durationMinutes ?? 60)}
          </span>
        </div>
      )}
    </div>
  );
}
