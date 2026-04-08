/**
 * DispatchVisitBlock — draggable + resizable visit block on the timeline.
 * Positioned absolutely by the parent lane row.
 * Includes unschedule action button and right-edge resize handle.
 */
import { useState, useCallback, useRef, useEffect, memo } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { DispatchVisit, DispatchTask } from "./dispatchPreviewTypes";
import type { DispatchDragData } from "./dispatchDndTypes";
import { useHoverSetter, useIsVisitHovered } from "./dispatchHoverContext";
import {
  priorityIndicator, formatDuration, isCompletedStatus, jobStateColor,
  HOUR_WIDTH_PX, SNAP_MINUTES, MIN_DURATION_MINUTES, PX_PER_MINUTE,
  TIMELINE_START_HOUR, TIMELINE_END_HOUR,
} from "./dispatchPreviewUtils";
import { clampResizeEnd } from "./dispatchOverlapUtils";
import { VisitCardContent } from "./VisitCardContent";
import { X } from "lucide-react";
import { addMinutes } from "date-fns";

type Props = {
  visit: DispatchVisit;
  left: number;
  width: number;
  techColor?: string;
  isSaving?: boolean;
  isSelected?: boolean;
  /** True if this visit overlaps another item on the same technician lane */
  hasConflict?: boolean;
  onSelect?: (visit: DispatchVisit) => void;
  onUnschedule?: (visit: DispatchVisit) => void;
  onResize?: (visit: DispatchVisit, newEndTime: string) => void;
  /** All visits in this lane — used for resize overlap clamping */
  laneVisits?: DispatchVisit[];
  /** All tasks in this lane — used for resize overlap clamping */
  laneTasks?: DispatchTask[];
  /** Lane tech ID for unique DnD IDs when visit appears in multiple lanes */
  laneTechId?: string;
  /** Dynamic timeline end hour for 24h mode resize clamping */
  timelineEndHour?: number;
};

function DispatchVisitBlockImpl({ visit, left, width, techColor, isSaving, isSelected, hasConflict, onSelect, onUnschedule, onResize, laneVisits = [], laneTasks = [], laneTechId, timelineEndHour: teHour = TIMELINE_END_HOUR }: Props) {
  // Per-id hover subscription: this block only re-renders when ITS hover state flips,
  // not when any sibling visit is hovered. setHoveredVisitId is a stable module-level fn.
  const setHoveredVisitId = useHoverSetter();
  const isMapHovered = useIsVisitHovered(visit.id);
  const isTeamVisit = visit.technicianIds.length > 1;
  const isCompleted = isCompletedStatus(visit.status);
  const dragData: DispatchDragData = {
    type: "scheduled-visit",
    visitId: visit.id,
    jobId: visit.jobId,
    jobNumber: visit.jobNumber,
    technicianId: visit.technicianId,
    durationMinutes: visit.durationMinutes,
    version: visit.version,
    isMultiTech: isTeamVisit,
    originalStart: visit.scheduledStart,
  };

  const [resizeDeltaPx, setResizeDeltaPx] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);
  const wasDraggingRef = useRef(false);
  const suppressClickUntilRef = useRef(0);

  // Multi-tech visits need unique DnD IDs per lane to avoid dnd-kit collisions
  const draggableId = laneTechId ? `scheduled-${visit.id}--${laneTechId}` : `scheduled-${visit.id}`;
  // Allow drag even while saving — chainForVisit serializes mutations safely.
  // 2026-03-24: Completed visits are non-draggable to prevent accidental reschedule.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: draggableId,
    data: dragData,
    disabled: isResizing || isCompleted,
  });

  // Suppress click after drag: track when isDragging transitions false
  useEffect(() => {
    if (isDragging) wasDraggingRef.current = true;
  }, [isDragging]);

  const handleClick = useCallback(() => {
    if (wasDraggingRef.current) {
      wasDraggingRef.current = false;
      return;
    }
    if (Date.now() < suppressClickUntilRef.current) return;
    // 2026-03-24: Block click while visit is in saving state (schedule mutation in-flight).
    // Prevents opening modal against unstable/incomplete data.
    if (isSaving) return;
    onSelect?.(visit);
  }, [onSelect, visit, isSaving]);

  const stateCls = jobStateColor(visit.jobStatus, visit.jobOpenSubStatus);
  const priorityCls = priorityIndicator(visit.priority);

  // Ref to hold lane data for closure-based pointer handlers
  const laneDataRef = useRef({ laneVisits, laneTasks });
  laneDataRef.current = { laneVisits, laneTasks };

  // Helper: compute overlap-clamped duration from a raw pixel width
  const clampedDurationFromWidth = useCallback((rawWidth: number): number => {
    if (!visit.scheduledStart) return MIN_DURATION_MINUTES;
    const start = new Date(visit.scheduledStart);
    const startMinuteOfDay = start.getHours() * 60 + start.getMinutes();
    const rawMinutes = rawWidth / PX_PER_MINUTE;
    const snappedMinutes = Math.max(
      Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES,
      MIN_DURATION_MINUTES,
    );
    const proposedEnd = startMinuteOfDay + snappedMinutes;
    // Clamp against overlap + timeline end using shared overlap util
    const { laneVisits: lv, laneTasks: lt } = laneDataRef.current;
    const clampedEnd = clampResizeEnd(startMinuteOfDay, proposedEnd, lv, lt, visit.id, teHour);
    return Math.max(clampedEnd - startMinuteOfDay, MIN_DURATION_MINUTES);
  }, [visit.scheduledStart, visit.id]);

  // Compute effective width during resize — clamped against overlaps in real time
  const rawResizeWidth = isResizing
    ? Math.max(resizeStartWidthRef.current + resizeDeltaPx, MIN_DURATION_MINUTES * PX_PER_MINUTE)
    : 0;

  const effectiveWidth = isResizing
    ? clampedDurationFromWidth(rawResizeWidth) * PX_PER_MINUTE
    : Math.max(width - 2, 38);

  const isNarrow = effectiveWidth < 100;

  // Compute preview duration for display during resize
  const previewDuration = isResizing
    ? clampedDurationFromWidth(rawResizeWidth)
    : visit.durationMinutes;

  const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = Math.max(width - 2, 38);
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

      if (visit.scheduledStart) {
        const start = new Date(visit.scheduledStart);
        const startMinuteOfDay = start.getHours() * 60 + start.getMinutes();
        const rawMinutes = finalWidth / PX_PER_MINUTE;
        const snappedMinutes = Math.max(
          Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES,
          MIN_DURATION_MINUTES,
        );
        const proposedEnd = startMinuteOfDay + snappedMinutes;
        // Clamp against overlap + timeline end
        const { laneVisits: lv, laneTasks: lt } = laneDataRef.current;
        const clampedEnd = clampResizeEnd(startMinuteOfDay, proposedEnd, lv, lt, visit.id, teHour);
        const clampedMinutes = Math.max(clampedEnd - startMinuteOfDay, MIN_DURATION_MINUTES);

        if (clampedMinutes !== visit.durationMinutes && onResize) {
          onResize(visit, addMinutes(start, clampedMinutes).toISOString());
        }
      }
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  }, [width, visit, onResize]);

  return (
    <div
      ref={setNodeRef}
      {...(isResizing ? {} : listeners)}
      {...(isResizing ? {} : attributes)}
      onClick={handleClick}
      onMouseEnter={() => setHoveredVisitId(visit.id)}
      onMouseLeave={() => setHoveredVisitId(null)}
      data-dispatch-block="visit"
      data-visit-id={visit.id}
      className={`group/visit absolute top-1 bottom-1 rounded border ${techColor ? "" : stateCls} ${!techColor && priorityCls ? `border-l-[3px] ${priorityCls}` : ""} overflow-visible transition-shadow hover:shadow-md hover:z-10 ${
        isDragging ? "opacity-40 shadow-lg z-30" : ""
      } ${isResizing ? "z-20 shadow-lg" : ""} ${isSelected ? "ring-2 ring-emerald-500 ring-offset-1 shadow-md shadow-emerald-200/50 z-20" : ""} ${hasConflict && !isSelected ? "ring-2 ring-red-500 ring-offset-1 shadow-md shadow-red-200/50 border-red-400" : ""} ${isMapHovered && !isSelected ? "ring-2 ring-emerald-400 shadow-md shadow-emerald-200/40 z-15" : ""} ${!isResizing ? "cursor-grab active:cursor-grabbing" : ""} ${isCompleted ? "opacity-55" : ""}`}
      style={{ left, width: effectiveWidth, ...(techColor ? { backgroundColor: `${techColor}25`, borderColor: `${techColor}66`, borderLeftWidth: 3, borderLeftColor: techColor } : {}) }}
      title={`${visit.customerName}\n${visit.summary}\n${visit.locationName}\n#${visit.jobNumber} · ${formatDuration(visit.durationMinutes)}`}
    >
      <div className="flex h-full flex-col justify-start px-2 py-1 overflow-hidden">
        <VisitCardContent
          visit={visit}
          variant={isNarrow ? "timeline-narrow" : "timeline-wide"}
          displayDuration={isResizing ? previewDuration : undefined}
        />
      </div>
      {/* Unschedule button — top-right, visible on hover of this block.
          2026-03-24: Hidden for completed/terminal visits to prevent accidental unschedule/reopen. */}
      {onUnschedule && !isSaving && !isDragging && !isResizing && !isCompleted && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onUnschedule(visit);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-0.5 right-0.5 hidden group-hover/visit:flex h-4 w-4 items-center justify-center rounded bg-white/80 hover:bg-red-100 text-muted-foreground hover:text-red-600 transition-colors"
          title="Unschedule"
        >
          <X className="h-3 w-3" />
        </button>
      )}

      {/* Resize handle — right edge (available during saving — chainForVisit serializes mutations) */}
      {!isDragging && (
        <div
          onPointerDown={handleResizePointerDown}
          className={`absolute top-0 bottom-0 right-0 w-2 cursor-ew-resize ${
            isResizing ? "bg-emerald-400/30" : "hover:bg-emerald-400/20"
          } transition-colors`}
          title="Drag to resize"
        >
          <div className={`absolute top-1/2 right-0.5 -translate-y-1/2 w-0.5 h-4 rounded-full ${
            isResizing ? "bg-emerald-500" : "bg-slate-400/0 group-hover/visit:bg-slate-400/60"
          } transition-colors`} />
        </div>
      )}
    </div>
  );
}

const DispatchVisitBlock = memo(DispatchVisitBlockImpl);
export default DispatchVisitBlock;
