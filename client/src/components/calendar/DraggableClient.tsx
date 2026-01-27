import { useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CheckCircle2, Loader2, AlertTriangle } from "lucide-react";
import { DRAG_ENABLED, getAssignmentStartMinutes, formatTimeFromMinutes, TechnicianColor } from "./calendarUtils";
import { logClick, logHover, isDiagnosticsEnabled } from "@/lib/calendarDiagnostics";

interface DraggableClientProps {
  id: string;
  client: any;
  inCalendar?: boolean;
  onClick?: () => void;
  isCompleted?: boolean;
  isOverdue?: boolean;
  assignment?: any;
  onAssignTechnician?: (assignmentId: string, technicianId: string | null) => void;
  monthLabel?: string | null;
  isOffMonth?: boolean;
  isPastMonth?: boolean;
  technicianColor?: TechnicianColor;
  densityStyle?: string;
  cardHeight?: number;
  /** Whether this event is currently being saved (disable drag, show indicator) */
  isSaving?: boolean;
  /** Job summary for unscheduled sidebar display */
  summary?: string;
}

export function DraggableClient({
  id,
  client,
  inCalendar,
  onClick,
  isCompleted,
  isOverdue,
  assignment,
  onAssignTechnician,
  monthLabel,
  isOffMonth,
  isPastMonth,
  technicianColor,
  densityStyle,
  cardHeight,
  isSaving,
  summary,
}: DraggableClientProps) {
  // Calendar items: use ONLY useDraggable for unrestricted movement
  // Unscheduled items: use ONLY useSortable for sorting in panel
  // Disable dragging while saving to prevent double-mutations
  const draggableResult = inCalendar
    ? useDraggable({
        id,
        disabled: !DRAG_ENABLED || isSaving,
        data: { type: "assignment", assignmentId: id },
      })
    : null;

  const sortableResult = !inCalendar ? useSortable({ id, disabled: !DRAG_ENABLED || isSaving }) : null;

  const { attributes, listeners, setNodeRef, transform, isDragging } = (
    inCalendar ? draggableResult : sortableResult
  )!;

  // useSortable has transition, useDraggable doesn't
  const transition = sortableResult?.transition;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : isSaving ? 0.7 : 1,
  };

  // Card styling: left border for technician color ONLY (not overdue status)
  const getCardStyle = () => {
    const baseStyle = "bg-card border border-border shadow-sm hover:shadow-md";
    if (!inCalendar) {
      // Unscheduled drawer: neutral border
      return `${baseStyle} border-l-4 border-l-muted-foreground/40`;
    }
    // Calendar items: technician color on left border
    const completedOpacity = isCompleted ? "opacity-60" : "";
    const savingStyle = isSaving ? "animate-pulse" : "";
    const leftBorder = technicianColor?.borderLeft || "border-l-muted-foreground/40";
    return `${baseStyle} border-l-4 ${leftBorder} ${completedOpacity} ${savingStyle}`;
  };

  // When cardHeight is provided, use full height styling
  const heightStyle = cardHeight ? { height: `${cardHeight}px` } : {};

  // Determine cursor style
  const getCursorStyle = () => {
    if (isSaving) return "cursor-wait";
    if (DRAG_ENABLED) return "cursor-grab active:cursor-grabbing";
    return "cursor-default";
  };

  // Hover logging handlers
  const handleMouseEnter = () => {
    if (isDiagnosticsEnabled()) {
      logHover('enter', {
        jobId: assignment?.jobId || id,
        assignmentId: id,
        context: inCalendar ? 'week-timed' : 'unscheduled',
        clientName: client?.companyName,
      });
    }
  };

  const handleMouseLeave = () => {
    if (isDiagnosticsEnabled()) {
      logHover('leave', {
        jobId: assignment?.jobId || id,
        assignmentId: id,
        context: inCalendar ? 'week-timed' : 'unscheduled',
        clientName: client?.companyName,
      });
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, ...heightStyle, touchAction: "none" }}
      {...attributes}
      {...(isSaving ? {} : listeners)} // Drag listeners on ROOT for reliable pointer capture
      onClick={(e) => {
        // Make entire card clickable for opening job detail modal
        // dnd-kit only starts drag on pointer move, so quick clicks work
        const clickAllowed = !!(inCalendar && onClick && !isSaving && !isDragging);

        // Diagnostics: log click event
        if (isDiagnosticsEnabled()) {
          logClick({
            jobId: assignment?.jobId || id,
            assignmentId: id,
            context: inCalendar ? 'calendar-card' : 'unscheduled-card',
            isDragging: isDragging || false,
            isSaving: isSaving || false,
            inCalendar: inCalendar || false,
            clickAllowed,
          });
        }

        if (clickAllowed) {
          e.stopPropagation();
          onClick();
        }
      }}
      className={`text-xs rounded transition-all relative select-none group ${
        cardHeight ? "overflow-hidden" : ""
      } ${densityStyle || (inCalendar ? "py-0.5 px-1.5" : "py-1.5 px-2.5")} ${getCardStyle()} ${inCalendar ? getCursorStyle() : ""}`}
      data-testid={inCalendar ? `assigned-client-${id}` : `unscheduled-client-${client.id}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div>
        {/* In Calendar: Jobber-style readable layout for week/day view */}
        {inCalendar ? (
          <div className="flex flex-col min-h-0 overflow-hidden">
            {/* Line 1: Client name (job # removed per UX feedback - shown in popover/dialog instead) */}
            <div className="flex items-center gap-1 min-w-0">
              {/* Saving spinner */}
              {isSaving && (
                <Loader2 className="h-3 w-3 text-primary animate-spin flex-shrink-0" />
              )}
              {/* Completed icon only (overdue icon removed - shown in popover/dialog instead) */}
              {!isSaving && isCompleted && (
                <CheckCircle2 className="h-3 w-3 text-green-600 flex-shrink-0" />
              )}
              {/* Hidden technician warning - job assigned to non-schedulable tech */}
              {!isSaving && assignment?.hasHiddenTechnician && (
                <span title="Assigned to hidden/non-schedulable technician">
                  <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0" />
                </span>
              )}
              {/* Client name - fills remaining space */}
              <span
                className={`font-medium text-[12px] leading-tight truncate min-w-0 flex-1 ${
                  isCompleted ? "line-through opacity-60" : "text-foreground"
                }`}
              >
                {client.companyName}
              </span>
            </div>
            {/* Line 2: Time range + location/summary - only if tall enough */}
            {cardHeight && cardHeight > 28 && (
              <div className={`text-[11px] leading-tight text-muted-foreground truncate mt-0.5 ${isCompleted ? "opacity-60" : ""}`}>
                {assignment && assignment.scheduledHour !== null && assignment.scheduledHour !== undefined ? (
                  (() => {
                    const startM = getAssignmentStartMinutes(assignment);
                    const dur = (assignment.durationMinutes || 60) as number;
                    const endM = startM + dur;
                    const timeStr = `${formatTimeFromMinutes(startM)}–${formatTimeFromMinutes(endM)}`;
                    const location = client.location || assignment?.summary || "";
                    return location ? `${timeStr} · ${location}` : timeStr;
                  })()
                ) : (
                  assignment?.summary || client.location || ""
                )}
              </div>
            )}
          </div>
        ) : (
          /* Unscheduled drawer: Stacked layout - client name, summary, location */
          <div className="space-y-0.5">
            {/* Line 1: Client name */}
            <div className="flex items-start gap-1">
              <div className="font-semibold text-[12px] leading-[1.2] truncate flex-1 min-w-0">
                {client.companyName}
              </div>
            </div>
            {/* Line 2: Job summary (parity with scheduled card content) */}
            {summary && (
              <div className="text-[11px] text-muted-foreground/80 leading-[1.2] truncate">{summary}</div>
            )}
            {/* Line 3: Location info */}
            {client.location && (
              <div className="text-[12px] text-muted-foreground leading-[1.2] truncate">{client.location}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
