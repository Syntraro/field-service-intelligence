import { useState, useRef, useCallback } from "react";
import { DraggableClient } from "./DraggableClient";
import { getAssignmentStartMinutes, TechnicianColor } from "./calendarUtils";

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
}: ResizableJobCardProps) {
  const [isResizing, setIsResizing] = useState(false);
  const [tempDuration, setTempDuration] = useState<number | null>(null);
  const resizeStartRef = useRef<{ y: number; duration: number } | null>(null);

  const startMinutes = getAssignmentStartMinutes(assignment);
  const startOffsetWithinHour = startMinutes % 60;
  const durationMinutes = tempDuration ?? (assignment.durationMinutes || 60);

  // Calculate position and height based on time
  const pixelsPerMinute = rowHeight / 60;
  const topOffset = startOffsetWithinHour * pixelsPerMinute;
  const height = durationMinutes * pixelsPerMinute;

  // Minimum height for visibility (15 minutes)
  const minHeight = 15 * pixelsPerMinute;

  // Calculate width and left position for overlapping jobs
  const widthPercent = 100 / totalLanes;
  const leftPercent = laneIndex * widthPercent;

  const handleResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);
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
      const newDuration = Math.max(15, Math.min(720, resizeStartRef.current.duration + snappedDelta));

      setTempDuration(newDuration);
    },
    [isResizing, pixelsPerMinute]
  );

  const handleResizeEnd = useCallback(
    (e: React.PointerEvent) => {
      if (!isResizing) return;

      setIsResizing(false);
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);

      if (tempDuration !== null && tempDuration !== (assignment.durationMinutes || 60)) {
        onResize(assignment.id, tempDuration);
      }
      setTempDuration(null);
      resizeStartRef.current = null;
    },
    [isResizing, tempDuration, assignment.id, assignment.durationMinutes, onResize]
  );

  const techColor = getTechnicianColor(assignment);

  return (
    <div
      className="absolute z-10"
      style={{
        top: `${topOffset}px`,
        height: `${Math.max(height, minHeight)}px`,
        left: `calc(${leftPercent}% + 1px)`,
        width: `calc(${widthPercent}% - 2px)`,
      }}
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
      />
      {/* Resize handle at bottom */}
      <div
        className={`absolute bottom-0 left-0 right-0 h-2 cursor-row-resize hover:bg-primary/20 transition-colors ${
          isResizing ? "bg-primary/30" : ""
        }`}
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
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
