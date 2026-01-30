/**
 * CalendarEventChip - Readable chip for month view events
 *
 * Jobber-style single-line chips with:
 * - 24px height for readability
 * - Left color stripe (technician color)
 * - Job # + truncated title
 * - Ellipsis overflow
 * - Saving state indicator (reduced opacity + pulse)
 *
 * Uses forwardRef to support HoverCardTrigger wrapping for hover previews.
 */

import * as React from "react";
import { forwardRef, useCallback } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { CheckCircle2, Loader2 } from "lucide-react";
import { DRAG_ENABLED, TechnicianColor } from "./calendarUtils";

interface CalendarEventChipProps extends React.HTMLAttributes<HTMLDivElement> {
  id: string;
  jobNumber?: string | number | null;
  title: string;
  onClick?: () => void;
  isCompleted?: boolean;
  isOverdue?: boolean;
  technicianColor?: TechnicianColor;
  /** Whether this event is currently being saved (disable drag, show indicator) */
  isSaving?: boolean;
}

export const CalendarEventChip = forwardRef<HTMLDivElement, CalendarEventChipProps>(
  function CalendarEventChip(
    {
      id,
      jobNumber,
      title,
      onClick,
      isCompleted,
      isOverdue,
      technicianColor,
      isSaving,
      className: externalClassName,
      style: externalStyle,
      ...restProps // Capture HoverCardTrigger props (onMouseEnter, onMouseLeave, etc.)
    },
    forwardedRef
  ) {
  // Disable dragging while saving to prevent double-mutations
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    disabled: !DRAG_ENABLED || isSaving,
    data: { type: "assignment", assignmentId: id },
  });

  // Merge forwarded ref with draggable ref
  const mergedRef = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      if (typeof forwardedRef === "function") {
        forwardedRef(node);
      } else if (forwardedRef) {
        forwardedRef.current = node;
      }
    },
    [setNodeRef, forwardedRef]
  );

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0.5 : isSaving ? 0.7 : 1,
    touchAction: "none", // Prevent browser gestures from stealing drag
    ...externalStyle, // Merge any external styles
  };

  // Left border color from technician or neutral
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
    ${externalClassName || ""}
  `.trim();

  return (
    <div
      ref={mergedRef}
      style={style}
      {...restProps} // Spread HoverCardTrigger props (onMouseEnter, onMouseLeave, onFocus, onBlur, etc.)
      {...attributes}
      {...(isSaving ? {} : listeners)} // Disable drag listeners while saving
      onClick={(e) => {
        e.stopPropagation();
        if (!isSaving) onClick?.();
      }}
      className={baseClassName}
      data-testid={`event-chip-${id}`}
    >
      {/* Saving spinner indicator */}
      {isSaving && (
        <Loader2 className="h-3 w-3 text-primary animate-spin flex-shrink-0 mr-1" />
      )}

      {/* Completed icon (hide when saving) */}
      {isCompleted && !isSaving && (
        <CheckCircle2 className="h-3 w-3 text-green-600 flex-shrink-0 mr-1" />
      )}

      {/* Title - truncated (job # removed per UX feedback - shown in popover/dialog instead) */}
      <span className="truncate flex-1 min-w-0">
        {title}
      </span>
    </div>
  );
});
