/**
 * ResizableJobCard - Timed job card with resize handle
 *
 * Extends JobCard with:
 * - Absolute positioning based on start time within hour
 * - Resize handle at bottom for adjusting duration
 * - Lane-based width for overlapping jobs
 *
 * Uses JobCard for consistent visual styling and interactions.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { useDraggable } from "@dnd-kit/core";
import { JobCard } from "./JobCard";
import { getAssignmentStartMinutes, TechnicianColor } from "./calendarUtils";
import { useToast } from "@/hooks/use-toast";

interface ResizableJobCardProps {
  assignment: any;
  client: any;
  rowHeight: number;
  onResize: (assignmentId: string, newDurationMinutes: number, assignment?: any) => void;
  getTechnicianColor: (assignment: any) => TechnicianColor;
  densityStyle: string;
  onClick: () => void;
  isCompleted: boolean;
  isOverdue: boolean;
  laneIndex?: number;
  totalLanes?: number;
  /** Whether this event is currently being saved (disable drag/resize, show indicator) */
  isSaving?: boolean;
  /** Quick action: unschedule */
  onUnschedule?: (assignmentId: string, version: number) => void;
  /** List of technicians for preview popover */
  technicians?: any[];
  /** Quick action: reschedule (opens dialog focused on schedule section) */
  onReschedule?: () => void;
  /** Time format from regional settings (12h/24h) */
  timeFormat?: "12h" | "24h";
  /** Item kind for visual distinction: "visit" (default) or "task" */
  itemKind?: "visit" | "task";
}

export function ResizableJobCard({
  assignment,
  client,
  rowHeight,
  onResize,
  getTechnicianColor,
  densityStyle,
  onClick,
  isCompleted,
  isOverdue,
  laneIndex = 0,
  totalLanes = 1,
  isSaving = false,
  onUnschedule,
  technicians = [],
  onReschedule,
  timeFormat = "12h",
  itemKind = "visit",
}: ResizableJobCardProps) {
  const { toast } = useToast();

  // 2026-03-05: Add useDraggable so timed items in Columns view can be dragged
  // to other time slots, all-day lanes, or between technician columns.
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: assignment.id,
    disabled: isSaving || isCompleted,
    data: { type: "assignment", assignmentId: assignment.id, client, event: assignment },
  });

  const [isResizing, setIsResizing] = useState(false);
  const [tempDuration, setTempDuration] = useState<number | null>(null);
  const [hitMidnightLimit, setHitMidnightLimit] = useState(false);
  const resizeStartRef = useRef<{ y: number; duration: number } | null>(null);

  // rAF throttle: store latest computed duration in ref, flush via rAF
  const pendingDurationRef = useRef<number | null>(null);
  const rafIdRef = useRef<number>(0);
  // Suppress click within 250ms of drag/resize end to prevent opening modal
  const lastResizeEndedAtRef = useRef<number>(0);
  // 2026-03-05: Also suppress click after drag release
  const lastDragEndedAtRef = useRef<number>(0);
  const wasDraggingRef = useRef(false);
  useEffect(() => {
    if (isDragging) {
      wasDraggingRef.current = true;
    } else if (wasDraggingRef.current) {
      wasDraggingRef.current = false;
      lastDragEndedAtRef.current = Date.now();
    }
  }, [isDragging]);

  const startMinutes = getAssignmentStartMinutes(assignment);
  const startOffsetWithinHour = startMinutes % 60;
  const durationMinutes = tempDuration ?? (assignment.durationMinutes || 60);

  // Calculate position and height based on time
  const pixelsPerMinute = rowHeight / 60;
  const topOffset = startOffsetWithinHour * pixelsPerMinute;
  const height = durationMinutes * pixelsPerMinute;

  // Minimum height for readability (30px ensures Jobber-style readable cards)
  const minHeight = Math.max(30, 15 * pixelsPerMinute);
  const cardHeight = Math.max(height, minHeight);

  // Calculate max duration to stay within same day (midnight = 24*60 = 1440 minutes)
  const maxDurationSameDay = Math.max(15, 1440 - startMinutes);

  // Calculate width and left position for overlapping jobs
  const widthPercent = 100 / totalLanes;
  const leftPercent = laneIndex * widthPercent;

  const handleResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);
      setHitMidnightLimit(false);
      resizeStartRef.current = { y: e.clientY, duration: assignment.durationMinutes || 60 };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [assignment.durationMinutes]
  );

  const handleResizeMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isResizing || !resizeStartRef.current) return;

      const deltaY = e.clientY - resizeStartRef.current.y;
      const deltaMinutes = Math.round(deltaY / pixelsPerMinute);

      // Snap to 15-minute increments
      const snappedDelta = Math.round(deltaMinutes / 15) * 15;
      let newDuration = resizeStartRef.current.duration + snappedDelta;

      // Clamp: minimum 15 minutes, maximum to stay within same day
      newDuration = Math.max(15, Math.min(maxDurationSameDay, newDuration));

      // Track if user tried to exceed midnight
      if (resizeStartRef.current.duration + snappedDelta > maxDurationSameDay && !hitMidnightLimit) {
        setHitMidnightLimit(true);
      }

      // rAF throttle: only flush state update once per frame
      pendingDurationRef.current = newDuration;
      if (!rafIdRef.current) {
        rafIdRef.current = requestAnimationFrame(() => {
          if (pendingDurationRef.current !== null) {
            setTempDuration(pendingDurationRef.current);
          }
          rafIdRef.current = 0;
        });
      }
    },
    [isResizing, pixelsPerMinute, maxDurationSameDay, hitMidnightLimit]
  );

  // Cancel any pending rAF on unmount
  useEffect(() => {
    return () => { if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current); };
  }, []);

  const handleResizeEnd = useCallback(
    (e: React.PointerEvent) => {
      if (!isResizing) return;

      // Prevent resize-end from bubbling to grid slot click handlers (2026-03-06)
      e.stopPropagation();
      e.preventDefault();

      // Flush any pending rAF
      if (rafIdRef.current) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = 0; }
      if (pendingDurationRef.current !== null) {
        setTempDuration(pendingDurationRef.current);
        pendingDurationRef.current = null;
      }

      setIsResizing(false);
      lastResizeEndedAtRef.current = Date.now();
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);

      if (hitMidnightLimit) {
        toast({
          title: "Can't extend past midnight",
          description: "Jobs can't span multiple days. Move it to the next day instead.",
          variant: "default",
        });
      }

      if (tempDuration !== null && tempDuration !== (assignment.durationMinutes || 60)) {
        onResize(assignment.id, tempDuration, assignment);
      }
      setTempDuration(null);
      setHitMidnightLimit(false);
      resizeStartRef.current = null;
    },
    [isResizing, tempDuration, assignment.id, assignment.durationMinutes, onResize, hitMidnightLimit, toast]
  );

  const techColor = getTechnicianColor(assignment);

  // 2026-03-05: Combine drag transform with absolute positioning
  const dragStyle = transform && !isResizing
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  return (
    <div
      ref={setDragRef}
      {...attributes}
      {...(isResizing ? {} : listeners)}
      className={`absolute z-10 select-none ${isResizing ? 'transition-none' : ''} ${isDragging ? 'opacity-70 z-50 shadow-lg' : ''}`}
      style={{
        top: `${topOffset}px`,
        height: `${cardHeight}px`,
        left: `calc(${leftPercent}% + 1px)`,
        width: `calc(${widthPercent}% - 2px)`,
        ...dragStyle,
      }}
    >
      <JobCard
        id={assignment.id}
        client={client}
        assignment={assignment}
        inCalendar
        onClick={() => {
          if (Date.now() - lastResizeEndedAtRef.current < 250) return;
          if (Date.now() - lastDragEndedAtRef.current < 250) return;
          if (isDragging) return;
          onClick();
        }}
        onReschedule={onReschedule}
        onUnschedule={onUnschedule}
        isCompleted={isCompleted}
        isOverdue={isOverdue}
        isSaving={isSaving}
        technicianColor={techColor}
        densityStyle={densityStyle}
        cardHeight={cardHeight}
        technicians={technicians}
        timeFormat={timeFormat}
        itemKind={itemKind}
      />

      {/* Resize handle at bottom - disabled while saving */}
      <div
        className={`absolute bottom-0 left-0 right-0 h-2 transition-colors ${
          isSaving
            ? "cursor-wait opacity-50"
            : `cursor-row-resize hover:bg-primary/20 ${isResizing ? "bg-primary/30" : ""}`
        }`}
        onPointerDown={isSaving ? undefined : handleResizeStart}
        onPointerMove={isSaving ? undefined : handleResizeMove}
        onPointerUp={isSaving ? undefined : handleResizeEnd}
        onPointerCancel={isSaving ? undefined : handleResizeEnd}
        data-testid={`resize-handle-${assignment.id}`}
      />

      {/* Duration tooltip during resize */}
      {isResizing && tempDuration !== null && (
        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 bg-foreground text-background text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap z-20">
          {Math.floor(tempDuration / 60)}h {tempDuration % 60}m
        </div>
      )}
    </div>
  );
}
