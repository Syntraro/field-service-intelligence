import { useState, useRef, useCallback } from "react";
import { DraggableClient } from "./DraggableClient";
import { EventPreviewPopover } from "./EventPreviewPopover";
import { getAssignmentStartMinutes, TechnicianColor } from "./calendarUtils";
import { useToast } from "@/hooks/use-toast";
import { Calendar as CalendarIcon, RotateCcw } from "lucide-react";

interface ResizableJobCardProps {
  assignment: any;
  client: any;
  rowHeight: number;
  onResize: (assignmentId: string, newDurationMinutes: number) => void;
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
}: ResizableJobCardProps) {
  const { toast } = useToast();
  const [isResizing, setIsResizing] = useState(false);
  const [tempDuration, setTempDuration] = useState<number | null>(null);
  const [hitMidnightLimit, setHitMidnightLimit] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const resizeStartRef = useRef<{ y: number; duration: number } | null>(null);

  const startMinutes = getAssignmentStartMinutes(assignment);
  const startOffsetWithinHour = startMinutes % 60;
  const durationMinutes = tempDuration ?? (assignment.durationMinutes || 60);

  // Calculate position and height based on time
  const pixelsPerMinute = rowHeight / 60;
  const topOffset = startOffsetWithinHour * pixelsPerMinute;
  const height = durationMinutes * pixelsPerMinute;

  // Minimum height for readability (30px ensures Jobber-style readable cards)
  const minHeight = Math.max(30, 15 * pixelsPerMinute);

  // Calculate max duration to stay within same day (midnight = 24*60 = 1440 minutes)
  // startMinutes is absolute minutes from midnight (e.g., 9 AM = 540)
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

      // Clamp: minimum 15 minutes, maximum to stay within same day (prevent midnight crossing)
      const minDuration = 15;
      newDuration = Math.max(minDuration, Math.min(maxDurationSameDay, newDuration));

      // Track if user tried to exceed midnight
      const attemptedDuration = resizeStartRef.current.duration + snappedDelta;
      if (attemptedDuration > maxDurationSameDay && !hitMidnightLimit) {
        setHitMidnightLimit(true);
      }

      setTempDuration(newDuration);
    },
    [isResizing, pixelsPerMinute, maxDurationSameDay, hitMidnightLimit]
  );

  const handleResizeEnd = useCallback(
    (e: React.PointerEvent) => {
      if (!isResizing) return;

      setIsResizing(false);
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);

      // Show toast if user tried to resize past midnight
      if (hitMidnightLimit) {
        toast({
          title: "Can't extend past midnight",
          description: "Jobs can't span multiple days. Move it to the next day instead.",
          variant: "default",
        });
      }

      if (tempDuration !== null && tempDuration !== (assignment.durationMinutes || 60)) {
        onResize(assignment.id, tempDuration);
      }
      setTempDuration(null);
      setHitMidnightLimit(false);
      resizeStartRef.current = null;
    },
    [isResizing, tempDuration, assignment.id, assignment.durationMinutes, onResize, hitMidnightLimit, toast]
  );

  const techColor = getTechnicianColor(assignment);

  // Quick action handler: unschedule
  // TASK 1: No ?? 1 fallback - server must reject VERSION_NOT_INITIALIZED
  const handleUnschedule = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onUnschedule && !isSaving && assignment.version !== undefined) {
      onUnschedule(assignment.id, assignment.version);
    }
  };

  // Show quick actions when hovered (but not while saving or resizing)
  const showQuickActions = isHovered && !isSaving && !isResizing;

  return (
    <EventPreviewPopover
      event={assignment}
      client={client}
      technicians={technicians}
      isDragging={false}
      isSaving={isSaving}
      isOverdue={isOverdue}
      timeFormat={timeFormat}
    >
      <div
        className="absolute z-10 group"
        style={{
          top: `${topOffset}px`,
          height: `${Math.max(height, minHeight)}px`,
          left: `calc(${leftPercent}% + 1px)`,
          width: `calc(${widthPercent}% - 2px)`,
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <DraggableClient
          id={assignment.id}
          client={client}
          inCalendar
          onClick={onClick}
          isCompleted={isCompleted}
          isOverdue={isOverdue}
          assignment={assignment}
          technicianColor={techColor}
          densityStyle={densityStyle}
          cardHeight={Math.max(height, minHeight)}
          isSaving={isSaving}
          timeFormat={timeFormat}
        />

        {/* Quick action icons - top right, visible on hover */}
        {showQuickActions && (
          <div className="absolute top-0.5 right-0.5 flex gap-0.5 z-20">
            {/* Reschedule — pointer guards prevent stealing drag */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (onReschedule) onReschedule();
                else onClick();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="p-0.5 rounded bg-white/90 text-muted-foreground hover:bg-blue-100 hover:text-blue-600 transition-colors"
              title="Reschedule"
            >
              <CalendarIcon className="h-3 w-3" />
            </button>
            {/* Unschedule — pointer guards prevent stealing drag */}
            <button
              onClick={handleUnschedule}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="p-0.5 rounded bg-white/90 text-muted-foreground hover:bg-orange-100 hover:text-orange-600 transition-colors"
              title="Unschedule"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          </div>
        )}

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
    </EventPreviewPopover>
  );
}
