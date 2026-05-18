/**
 * DispatchTaskBlock — clickable, draggable, resizable task block on the dispatch timeline.
 * Visually distinct from visits (dashed border, blue color scheme).
 * Parity with DispatchVisitBlock: click, drag, resize all supported.
 * Backend: PATCH /api/tasks/:id accepts scheduledStartAt and scheduledEndAt.
 */
import { useState, useCallback, useRef, useEffect, memo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { addMinutes } from "date-fns";
import type { DispatchTask } from "./dispatchPreviewTypes";
import type { DispatchDragData } from "./dispatchDndTypes";
import {
  formatDuration, HOUR_WIDTH_PX, TIMELINE_START_HOUR, TIMELINE_END_HOUR,
  SNAP_MINUTES, MIN_DURATION_MINUTES, PX_PER_MINUTE,
} from "./dispatchPreviewUtils";
import type { DispatchVisit } from "./dispatchPreviewTypes";
import { clampResizeEnd } from "./dispatchOverlapUtils";
import { Clock, ClipboardList, FileSearch } from "lucide-react";

type Props = {
  task: DispatchTask;
  isSaving?: boolean;
  isSelected?: boolean;
  /** True if this task overlaps another item on the same technician lane */
  hasConflict?: boolean;
  onSelect?: (task: DispatchTask) => void;
  onResize?: (task: DispatchTask, newEndTime: string) => void;
  /** All visits in this lane — used for resize overlap clamping */
  laneVisits?: DispatchVisit[];
  /** All tasks in this lane — used for resize overlap clamping */
  laneTasks?: DispatchTask[];
  /** Dynamic timeline start/end hours for 24h mode */
  timelineStartHour?: number;
  timelineEndHour?: number;
};

const TASK_TYPE_LABELS: Record<string, string> = {
  GENERAL: "Task",
  QUOTE_ASSESSMENT: "Quote Assessment",
  pickup: "Pickup",
  delivery: "Delivery",
  meeting: "Meeting",
  training: "Training",
  vehicle_maintenance: "Vehicle",
};

/** Returns true if this is a quote assessment task */
function isQuoteAssessment(type: string): boolean {
  return type === "QUOTE_ASSESSMENT";
}

/** Get pixel position for a task block. Accepts optional dynamic startHour for 24h mode. */
export function getTaskPosition(task: DispatchTask, timelineStartHour = TIMELINE_START_HOUR): { left: number; width: number } | null {
  if (!task.scheduledStart) return null;
  const start = new Date(task.scheduledStart);
  const startHour = start.getHours() + start.getMinutes() / 60;
  const offsetHours = startHour - timelineStartHour;
  if (offsetHours < 0) return null;
  const left = offsetHours * HOUR_WIDTH_PX;
  // Fix 4: Default task duration to 60 minutes for timeline visibility
  const width = Math.max(((task.durationMinutes || 60) / 60) * HOUR_WIDTH_PX, 40);
  return { left, width };
}

function DispatchTaskBlockImpl({ task, isSaving, isSelected, hasConflict, onSelect, onResize, laneVisits = [], laneTasks = [], timelineStartHour: tsHour = TIMELINE_START_HOUR, timelineEndHour: teHour = TIMELINE_END_HOUR }: Props) {
  const pos = getTaskPosition(task, tsHour);
  if (!pos) return null;

  const typeLabel = TASK_TYPE_LABELS[task.type] ?? task.type;
  const wasDraggingRef = useRef(false);
  const suppressClickUntilRef = useRef(0);
  const [resizeDeltaPx, setResizeDeltaPx] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);

  const dragData: DispatchDragData = {
    type: "scheduled-task",
    visitId: task.id,
    jobId: task.jobId ?? "",
    jobNumber: 0,
    technicianId: task.assignedToUserId,
    // Dispatcher-polish: match the || 60 fallback used in getTaskPosition for consistency
    durationMinutes: task.durationMinutes || 60,
    version: 0,
  };

  // Allow drag even while saving — chainForVisit serializes mutations safely
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task-${task.id}`,
    data: dragData,
    disabled: isResizing,
  });

  useEffect(() => {
    if (isDragging) wasDraggingRef.current = true;
  }, [isDragging]);

  const handleClick = useCallback(() => {
    if (wasDraggingRef.current) {
      wasDraggingRef.current = false;
      return;
    }
    if (Date.now() < suppressClickUntilRef.current) return;
    onSelect?.(task);
  }, [onSelect, task]);

  // Ref to hold lane data for closure-based pointer handlers
  const laneDataRef = useRef({ laneVisits, laneTasks });
  laneDataRef.current = { laneVisits, laneTasks };

  // Helper: compute overlap-clamped duration from a raw pixel width
  const clampedDurationFromWidth = useCallback((rawWidth: number): number => {
    if (!task.scheduledStart) return MIN_DURATION_MINUTES;
    const start = new Date(task.scheduledStart);
    const startMinuteOfDay = start.getHours() * 60 + start.getMinutes();
    const rawMinutes = rawWidth / PX_PER_MINUTE;
    const snappedMinutes = Math.max(
      Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES,
      MIN_DURATION_MINUTES,
    );
    const proposedEnd = startMinuteOfDay + snappedMinutes;
    const { laneVisits: lv, laneTasks: lt } = laneDataRef.current;
    const clampedEnd = clampResizeEnd(startMinuteOfDay, proposedEnd, lv, lt, task.id, teHour);
    return Math.max(clampedEnd - startMinuteOfDay, MIN_DURATION_MINUTES);
  }, [task.scheduledStart, task.id]);

  // Resize via right-edge drag — overlap-clamped in real time
  const rawResizeWidth = isResizing
    ? Math.max(resizeStartWidthRef.current + resizeDeltaPx, MIN_DURATION_MINUTES * PX_PER_MINUTE)
    : 0;

  const effectiveWidth = isResizing
    ? clampedDurationFromWidth(rawResizeWidth) * PX_PER_MINUTE
    : Math.max(pos.width - 2, 38);

  const previewDuration = isResizing
    ? clampedDurationFromWidth(rawResizeWidth)
    : task.durationMinutes;

  const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = Math.max(pos.width - 2, 38);
    setResizeDeltaPx(0);
    suppressClickUntilRef.current = Date.now() + 2000;

    const onPointerMove = (ev: PointerEvent) => {
      setResizeDeltaPx(ev.clientX - resizeStartXRef.current);
    };

    const onPointerUp = (ev: PointerEvent) => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      setIsResizing(false);
      setResizeDeltaPx(0);
      suppressClickUntilRef.current = Date.now() + 500;

      const finalDelta = ev.clientX - resizeStartXRef.current;
      const finalWidth = Math.max(resizeStartWidthRef.current + finalDelta, MIN_DURATION_MINUTES * PX_PER_MINUTE);

      if (task.scheduledStart) {
        const start = new Date(task.scheduledStart);
        const startMinuteOfDay = start.getHours() * 60 + start.getMinutes();
        const rawMinutes = finalWidth / PX_PER_MINUTE;
        const snappedMinutes = Math.max(
          Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES,
          MIN_DURATION_MINUTES,
        );
        const proposedEnd = startMinuteOfDay + snappedMinutes;
        const { laneVisits: lv, laneTasks: lt } = laneDataRef.current;
        const clampedEnd = clampResizeEnd(startMinuteOfDay, proposedEnd, lv, lt, task.id, teHour);
        const clampedMinutes = Math.max(clampedEnd - startMinuteOfDay, MIN_DURATION_MINUTES);

        if (clampedMinutes !== task.durationMinutes && onResize) {
          onResize(task, addMinutes(start, clampedMinutes).toISOString());
        }
      }
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  }, [pos.width, task, onResize]);

  return (
    <div
      ref={setNodeRef}
      {...(isResizing ? {} : listeners)}
      {...(isResizing ? {} : attributes)}
      onClick={handleClick}
      data-dispatch-block="task"
      data-task-id={task.id}
      className={`group/task absolute top-1 bottom-1 rounded border border-dashed overflow-visible hover:shadow-sm hover:z-10 transition-shadow ${
        isQuoteAssessment(task.type) ? "border-amber-400 bg-amber-50/80 text-amber-800" : "border-blue-300 bg-blue-50/80 text-blue-700"
      } ${
        isDragging ? "opacity-40 shadow-lg z-30" : ""
      } ${isResizing ? "z-20 shadow-lg" : ""} ${isSelected ? "ring-2 ring-[#76B054] ring-offset-1 shadow-md shadow-[rgba(118,176,84,0.3)] z-20" : ""} ${hasConflict && !isSelected ? "ring-2 ring-red-500 ring-offset-1 shadow-md shadow-red-200/50 border-red-400" : ""} ${!isResizing ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{ left: pos.left, width: effectiveWidth }}
      title={`${typeLabel}: ${task.title}\n${formatDuration(task.durationMinutes)}`}
    >
      <div className="flex h-full flex-col justify-center px-2 py-1 overflow-hidden">
        {effectiveWidth > 100 ? (
          <>
            <div className="flex items-center gap-1 truncate">
              {isQuoteAssessment(task.type)
                ? <FileSearch className="h-3 w-3 flex-shrink-0" />
                : <ClipboardList className="h-3 w-3 flex-shrink-0" />}
              <span className="truncate text-[11px] font-semibold">{task.title}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] opacity-80">
              <span className="truncate">{typeLabel}</span>
              <span className="flex items-center gap-0.5 whitespace-nowrap">
                <Clock className="h-2.5 w-2.5" />{formatDuration(isResizing ? previewDuration : task.durationMinutes)}
              </span>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-0.5 truncate">
            {isQuoteAssessment(task.type)
              ? <FileSearch className="h-3 w-3 flex-shrink-0" />
              : <ClipboardList className="h-3 w-3 flex-shrink-0" />}
            <span className="truncate text-[10px] font-semibold">{task.title}</span>
          </div>
        )}
      </div>
      {/* Resize handle — right edge (available during saving — mutations serialize safely) */}
      {!isDragging && (
        <div
          onPointerDown={handleResizePointerDown}
          className={`absolute top-0 bottom-0 right-0 w-2 cursor-ew-resize ${
            isResizing ? "bg-[rgba(118,176,84,0.30)]" : "hover:bg-[rgba(118,176,84,0.20)]"
          } transition-colors`}
          title="Drag to resize"
        >
          <div className={`absolute top-1/2 right-0.5 -translate-y-1/2 w-0.5 h-4 rounded-full ${
            isResizing ? "bg-[#76B054]" : "bg-slate-400/0 group-hover/task:bg-slate-400/60"
          } transition-colors`} />
        </div>
      )}
    </div>
  );
}

const DispatchTaskBlock = memo(DispatchTaskBlockImpl);
export default DispatchTaskBlock;
