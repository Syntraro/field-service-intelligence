import { useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Info, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { DRAG_ENABLED, getAssignmentStartMinutes, formatTimeFromMinutes, TechnicianColor } from "./calendarUtils";

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
}: DraggableClientProps) {
  // Calendar items: use ONLY useDraggable for unrestricted movement
  // Unscheduled items: use ONLY useSortable for sorting in panel
  const draggableResult = inCalendar
    ? useDraggable({
        id,
        disabled: !DRAG_ENABLED,
        data: { type: "assignment", assignmentId: id },
      })
    : null;

  const sortableResult = !inCalendar ? useSortable({ id, disabled: !DRAG_ENABLED }) : null;

  const { attributes, listeners, setNodeRef, transform, isDragging } = (
    inCalendar ? draggableResult : sortableResult
  )!;

  // useSortable has transition, useDraggable doesn't
  const transition = sortableResult?.transition;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
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
    const leftBorder = technicianColor?.borderLeft || "border-l-muted-foreground/40";
    return `${baseStyle} border-l-4 ${leftBorder} ${completedOpacity}`;
  };

  // When cardHeight is provided, use full height styling
  const heightStyle = cardHeight ? { height: `${cardHeight}px` } : {};

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, ...heightStyle }}
      {...attributes}
      className={`text-xs rounded-md transition-all relative select-none group ${
        cardHeight ? "overflow-hidden" : ""
      } ${densityStyle || "py-1.5 px-2.5"} ${getCardStyle()}`}
      data-testid={inCalendar ? `assigned-client-${id}` : `unscheduled-client-${client.id}`}
    >
      <div
        {...listeners}
        className={inCalendar ? (DRAG_ENABLED ? "cursor-grab active:cursor-grabbing" : "cursor-default") : ""}
      >
        {/* In Calendar: Enhanced layout with job #, client, time, status */}
        {inCalendar ? (
          <div className="space-y-0.5">
            {/* Line 1: Job # + Status indicator */}
            <div className="flex items-center gap-1">
              {assignment?.jobNumber && (
                <span className={`font-mono font-bold text-[11px] ${isCompleted ? "opacity-60" : "text-primary"}`}>
                  #{assignment.jobNumber}
                </span>
              )}
              {/* Status chip */}
              {isCompleted ? (
                <CheckCircle2 className="h-3 w-3 text-green-600 flex-shrink-0" />
              ) : isOverdue ? (
                <AlertCircle className="h-3 w-3 text-amber-500 flex-shrink-0" />
              ) : null}
              {/* Time range inline */}
              {assignment && assignment.scheduledHour !== null && assignment.scheduledHour !== undefined && (
                <div className={`text-[10px] text-muted-foreground flex items-center gap-0.5 ml-auto ${isCompleted ? "opacity-60" : ""}`}>
                  <Clock className="h-2.5 w-2.5" />
                  {(() => {
                    const startM = getAssignmentStartMinutes(assignment);
                    const dur = (assignment.durationMinutes || 60) as number;
                    const endM = startM + dur;
                    return `${formatTimeFromMinutes(startM)}–${formatTimeFromMinutes(endM)}`;
                  })()}
                </div>
              )}
            </div>
            {/* Line 2: Client name */}
            <div
              className={`font-semibold text-[12px] leading-[1.2] truncate ${
                isCompleted ? "line-through opacity-60" : ""
              }`}
            >
              {client.companyName}
            </div>
            {/* Line 3: Location or summary */}
            {(client.location || assignment?.summary) && (
              <div className={`text-[11px] text-muted-foreground leading-[1.2] truncate ${isCompleted ? "opacity-60" : ""}`}>
                {assignment?.summary || client.location}
              </div>
            )}
          </div>
        ) : (
          /* Unscheduled drawer: Stacked 2-line layout - client name and location only */
          <div className="space-y-0.5">
            {/* Line 1: Client name */}
            <div className="flex items-start gap-1">
              <div className="font-semibold text-[12px] leading-[1.2] truncate flex-1 min-w-0">
                {client.companyName}
              </div>
            </div>
            {/* Line 2: Location info */}
            {client.location && (
              <div className="text-[12px] text-muted-foreground leading-[1.2] truncate">{client.location}</div>
            )}
          </div>
        )}
      </div>
      {inCalendar && onClick && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          className="absolute bottom-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity h-4 w-4 flex items-center justify-center hover:bg-primary/20 rounded"
          data-testid={`button-open-client-${id}`}
        >
          <Info className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
