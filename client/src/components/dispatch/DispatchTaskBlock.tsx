/**
 * DispatchTaskBlock — clickable, draggable, resizable task block on the dispatch timeline.
 * Visually distinct from visits (dashed border, blue color scheme; truck icon for supplier visits).
 * Parity with DispatchVisitBlock: click, drag, resize all supported.
 * Backend: PATCH /api/tasks/:id accepts scheduledStartAt and scheduledEndAt.
 */
import { useState, useCallback, useRef, useEffect } from "react";
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
import { Clock, ClipboardList, Truck, Loader2 } from "lucide-react";

type Props = {
  task: DispatchTask;
  isSaving?: boolean;
  isSelected?: boolean;
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
  SUPPLIER_VISIT: "Supplier Visit",
  supplier_run: "Supplier Run",
  pickup: "Pickup",
  delivery: "Delivery",
  meeting: "Meeting",
  training: "Training",
  vehicle_maintenance: "Vehicle",
};

/** Returns true if this task type should show the Truck icon */
function isSupplierType(type: string): boolean {
  return type === "SUPPLIER_VISIT" || type === "supplier_run";
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

export default function DispatchTaskBlock({ task, isSaving, isSelected, onSelect, onResize, laneVisits = [], laneTasks = [], timelineStartHour: tsHour = TIMELINE_START_HOUR, timelineEndHour: teHour = TIMELINE_END_HOUR }: Props) {
  const pos = getTaskPosition(task, tsHour);
  if (!pos) return null;

  const typeLabel = TASK_TYPE_LABELS[task.type] ?? task.type;
  const wasDraggingRef = useRef(false);
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

    const onPointerMove = (ev: PointerEvent) => {
      setResizeDeltaPx(ev.clientX - resizeStartXRef.current);
    };

    const onPointerUp = (ev: PointerEvent) => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      setIsResizing(false);
      setResizeDeltaPx(0);

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
      className={`group/task absolute top-1 bottom-1 rounded border border-dashed border-blue-300 bg-blue-50/80 text-blue-700 overflow-visible hover:shadow-sm hover:z-10 transition-shadow ${
        isDragging ? "opacity-40 shadow-lg z-30" : ""
      } ${isResizing ? "z-20 shadow-lg" : ""} ${isSelected ? "ring-2 ring-blue-500 ring-offset-1 shadow-md shadow-blue-200/50 z-20" : ""} ${!isResizing ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{ left: pos.left, width: effectiveWidth }}
      title={`${typeLabel}: ${task.title}\n${formatDuration(task.durationMinutes)}`}
    >
      <div className="flex h-full flex-col justify-center px-2 py-1 overflow-hidden">
        {effectiveWidth > 100 ? (
          <>
            <div className="flex items-center gap-1 truncate">
              {isSupplierType(task.type)
                ? <Truck className="h-3 w-3 flex-shrink-0" />
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
            {isSupplierType(task.type)
              ? <Truck className="h-3 w-3 flex-shrink-0" />
              : <ClipboardList className="h-3 w-3 flex-shrink-0" />}
            <span className="truncate text-[10px] font-semibold">{task.title}</span>
          </div>
        )}
      </div>
      {/* Subtle saving indicator — small spinner in top-left, no content replacement */}
      {isSaving && (
        <div className="absolute top-0.5 left-0.5 flex items-center justify-center">
          <Loader2 className="h-2.5 w-2.5 animate-spin text-blue-500/70" />
        </div>
      )}

      {/* Resize handle — right edge (available during saving — mutations serialize safely) */}
      {!isDragging && (
        <div
          onPointerDown={handleResizePointerDown}
          className={`absolute top-0 bottom-0 right-0 w-2 cursor-ew-resize ${
            isResizing ? "bg-blue-400/30" : "hover:bg-blue-400/20"
          } transition-colors`}
          title="Drag to resize"
        >
          <div className={`absolute top-1/2 right-0.5 -translate-y-1/2 w-0.5 h-4 rounded-full ${
            isResizing ? "bg-blue-500" : "bg-slate-400/0 group-hover/task:bg-slate-400/60"
          } transition-colors`} />
        </div>
      )}
    </div>
  );
}
