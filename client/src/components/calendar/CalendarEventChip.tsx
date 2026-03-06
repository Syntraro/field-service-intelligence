/**
 * CalendarEventChip - Readable chip for month view events
 *
 * Jobber-style single-line chips with:
 * - 24px height for readability
 * - Left color stripe (technician color)
 * - Truncated title
 * - Saving state indicator (reduced opacity + pulse)
 * - Click to open detail modal (no hover preview)
 */

import * as React from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { CheckCircle2, Loader2 } from "lucide-react";
import { DRAG_ENABLED, TechnicianColor } from "./calendarUtils";

interface CalendarEventChipProps {
  id: string;
  jobNumber?: string | number | null;
  title: string;
  onClick?: () => void;
  isCompleted?: boolean;
  isOverdue?: boolean;
  technicianColor?: TechnicianColor;
  /** Whether this event is currently being saved (disable drag, show indicator) */
  isSaving?: boolean;
  /** Whether this chip is draggable (default: true). Set false for tasks. */
  draggable?: boolean;
}

export function CalendarEventChip({
  id,
  jobNumber,
  title,
  onClick,
  isCompleted,
  isOverdue,
  technicianColor,
  isSaving,
  draggable = true,
}: CalendarEventChipProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    disabled: !DRAG_ENABLED || isSaving || isCompleted || !draggable,
    data: { type: "assignment", assignmentId: id },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0.5 : isSaving ? 0.7 : 1,
    touchAction: "none",
  };

  const leftBorder = technicianColor?.borderLeft || "border-l-muted-foreground/40";

  const baseClassName = `
    h-[24px] min-h-[24px] max-h-[24px]
    flex items-center
    px-1.5 rounded-sm
    text-[11px] leading-tight
    select-none
    border-l-2 ${leftBorder}
    ${isCompleted
      ? "bg-muted/30 text-muted-foreground line-through opacity-60"
      : "bg-card text-foreground hover:bg-accent/50"
    }
    ${isSaving ? "animate-pulse cursor-wait" : "cursor-pointer"}
    transition-colors
    overflow-hidden
    ${DRAG_ENABLED && !isSaving ? "cursor-grab active:cursor-grabbing" : ""}
  `.trim();

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(isSaving ? {} : listeners)}
      onClick={(e) => {
        e.stopPropagation();
        if (!isSaving) onClick?.();
      }}
      className={baseClassName}
      data-testid={`event-chip-${id}`}
    >
      {isSaving && (
        <Loader2 className="h-3 w-3 text-primary animate-spin flex-shrink-0 mr-1" />
      )}

      {isCompleted && !isSaving && (
        <CheckCircle2 className="h-3 w-3 text-green-600 flex-shrink-0 mr-1" />
      )}

      <span className="truncate flex-1 min-w-0">
        {title}
      </span>
    </div>
  );
}
