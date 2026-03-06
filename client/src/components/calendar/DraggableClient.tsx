import { memo, useRef, useEffect } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useLocation } from "wouter";
import { CheckCircle2, Loader2, AlertTriangle, History, Package, RotateCcw } from "lucide-react";
import { DRAG_ENABLED, getAssignmentStartMinutes, formatTimeFromMinutes, TechnicianColor } from "./calendarUtils";
import { logClick, isDiagnosticsEnabled } from "@/lib/calendarDiagnostics";

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
  /** Raw item from API — passed through for DEV diagnostic logging */
  rawItem?: any;
  /** Time format from regional settings (12h/24h) */
  timeFormat?: "12h" | "24h";
  /** Whether this item is draggable (default: true). Tasks are click-to-schedule, not draggable. */
  draggable?: boolean;
}

/**
 * DraggableClient - Memoized draggable card component
 *
 * OPTIMIZED: 2026-01-30 - Wrapped with React.memo to prevent rerenders during drag
 * Custom comparison function only checks props that actually affect rendering.
 */
export const DraggableClient = memo(function DraggableClient({
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
  rawItem,
  timeFormat = "12h",
  draggable = true,
}: DraggableClientProps) {
  // Track if we've logged for this card (prevents spam during drag)
  const hasLoggedRef = useRef(false);

  // Navigation for deep link to job visits section
  const [, setLocation] = useLocation();

  // ---------------------------------------------------------------------------
  // Drag disabled computation — Model A rules:
  //   Draggable UNLESS:  DRAG_ENABLED is false  OR  isSaving is true
  //   No legacy overdue/assigned/status checks — server rejects invalid drops.
  // ---------------------------------------------------------------------------
  // Terminal jobs (completed/invoiced/archived) and tasks are non-draggable
  const dragDisabled = !DRAG_ENABLED || !!isSaving || !!isCompleted || !draggable;

  // ---------------------------------------------------------------------------
  // Single useDraggable hook for ALL items (calendar + unscheduled).
  // Previous code used useSortable for unscheduled items inside a
  // SortableContext, but useSortable registers both a draggable AND a
  // droppable, and its internal SortableContext lookup silently fails for
  // items whose IDs don't match the context array (e.g. after optimistic
  // dedup or id mutation), leaving specific cards with inert listeners.
  // Using useDraggable directly is simpler and fully reliable.
  // ---------------------------------------------------------------------------
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id,
    disabled: dragDisabled,
    data: {
      type: inCalendar ? "assignment" : "unscheduled",
      assignmentId: id,
    },
  });

  // Suppress click after drag release: track when drag ends, ignore clicks within 250ms
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

  const style = {
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0.5 : isSaving ? 0.7 : 1,
  };

  // OPTIMIZED: 2026-01-30 - Throttled DEV logging (only log once per card mount)
  // This prevents 50+ log spam during drag operations
  if (process.env.NODE_ENV === 'development' && !inCalendar && !hasLoggedRef.current) {
    hasLoggedRef.current = true;
    // Uncomment below for debugging drag issues:
    // const r = rawItem || {};
    // console.log('[UNSCHED-DRAG]', { jobId: id, clientName: client?.companyName, disabled: dragDisabled });
  }

  // Card styling: left border for technician color ONLY (not overdue status)
  const getCardStyle = () => {
    const baseStyle = "bg-card border border-border shadow-sm hover:shadow-md";
    if (!inCalendar) {
      return `${baseStyle} border-l-4 border-l-muted-foreground/40`;
    }
    const completedOpacity = isCompleted ? "opacity-60" : "";
    const savingStyle = isSaving ? "animate-pulse" : "";
    const leftBorder = technicianColor?.borderLeft || "border-l-muted-foreground/40";
    return `${baseStyle} border-l-4 ${leftBorder} ${completedOpacity} ${savingStyle}`;
  };

  const heightStyle = cardHeight ? { height: `${cardHeight}px` } : {};

  // Cursor style — applied to ALL cards (calendar + unscheduled)
  const getCursorStyle = () => {
    if (isSaving) return "cursor-wait";
    if (DRAG_ENABLED) return "cursor-grab active:cursor-grabbing";
    return "cursor-default";
  };

  // DEV-only: log pointerdown on unscheduled cards to confirm event reaches root
  const handlePointerDownCapture = !inCalendar && process.env.NODE_ENV === 'development'
    ? (e: React.PointerEvent) => {
        const target = e.target as HTMLElement;
        console.log('[UNSCHEDULED pointerdown root]', {
          jobId: id,
          disabled: dragDisabled,
          reason: !DRAG_ENABLED ? 'DRAG_ENABLED=false' : isSaving ? 'isSaving' : 'none',
          targetTag: target.tagName,
          targetClass: target.className?.slice?.(0, 80),
          hasListeners: !!listeners,
          listenersKeys: listeners ? Object.keys(listeners) : [],
        });
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, ...heightStyle, touchAction: "none" }}
      {...attributes}
      {...(isSaving ? {} : listeners)}
      onPointerDownCapture={handlePointerDownCapture}
      onClick={(e) => {
        if (isSaving || isDragging) return;
        // Suppress click within 250ms after drag ends (pointer-up fires click)
        if (Date.now() - lastDragEndedAtRef.current < 250) return;
        if (onClick) {
          e.stopPropagation();
          onClick();
        }

        if (isDiagnosticsEnabled()) {
          logClick({
            jobId: assignment?.jobId || id,
            assignmentId: id,
            context: inCalendar ? 'calendar-card' : 'unscheduled-card',
            isDragging: isDragging || false,
            isSaving: isSaving || false,
            inCalendar: inCalendar || false,
            clickAllowed: !!(onClick && !isSaving && !isDragging),
          });
        }
      }}
      className={`text-xs rounded transition-all relative select-none group ${
        cardHeight ? "overflow-hidden" : ""
      } ${densityStyle || (inCalendar ? "py-0.5 px-1.5" : "py-1.5 px-2.5")} ${getCardStyle()} ${getCursorStyle()}`}
      data-testid={inCalendar ? `assigned-client-${id}` : `unscheduled-client-${id}`}
    >
      <div>
        {/* In Calendar: Jobber-style readable layout for week/day view */}
        {inCalendar ? (
          <div className="flex flex-col min-h-0 overflow-hidden">
            <div className="flex items-center gap-1 min-w-0">
              {isSaving && (
                <Loader2 className="h-3 w-3 text-primary animate-spin flex-shrink-0" />
              )}
              {!isSaving && isCompleted && (
                <CheckCircle2 className="h-3 w-3 text-green-600 flex-shrink-0" />
              )}
              {!isSaving && assignment?.hasHiddenTechnician && (
                <span
                  title="Assigned to hidden/non-schedulable technician"
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0" />
                </span>
              )}
              <span
                className={`font-medium text-[12px] leading-tight truncate min-w-0 flex-1 ${
                  isCompleted ? "line-through opacity-60" : "text-foreground"
                }`}
              >
                {client.companyName}
              </span>
            </div>
            {/* Show second line (time + visit #) unless card is too short */}
            {(cardHeight === undefined || cardHeight > 28) && (
              <div className={`flex items-center gap-1 text-[11px] leading-tight text-muted-foreground mt-0.5 ${isCompleted ? "opacity-60" : ""}`}>
                <span className="truncate min-w-0 flex-1">
                  {assignment && assignment.scheduledHour !== null && assignment.scheduledHour !== undefined ? (
                    (() => {
                      const startM = getAssignmentStartMinutes(assignment);
                      const dur = (assignment.durationMinutes || 60) as number;
                      const endM = startM + dur;
                      const timeStr = `${formatTimeFromMinutes(startM, timeFormat)}–${formatTimeFromMinutes(endM, timeFormat)}`;
                      const location = client.location || assignment?.summary || "";
                      return location ? `${timeStr} · ${location}` : timeStr;
                    })()
                  ) : (
                    assignment?.summary || client.location || ""
                  )}
                </span>
                {/* Job # + Visit # badge + history icon for deep link to job visits section */}
                {assignment?.jobNumber != null && (
                  <span className="text-[10px] font-medium text-muted-foreground/60 shrink-0">
                    #{assignment.jobNumber}
                  </span>
                )}
                {assignment?.visitNumber != null && (
                  <>
                    <span className="text-[10px] font-medium text-muted-foreground/80 shrink-0">
                      V{assignment.visitNumber}
                    </span>
                    {/* Outcome indicator for completed visits needing follow-up */}
                    {assignment?.visitOutcome === "needs_parts" && (
                      <span title="Needs parts"><Package className="h-3 w-3 text-amber-500 shrink-0" /></span>
                    )}
                    {assignment?.visitOutcome === "needs_followup" && (
                      <span title="Needs follow-up"><RotateCcw className="h-3 w-3 text-amber-500 shrink-0" /></span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const jobId = assignment?.jobId || id;
                        setLocation(`/jobs/${jobId}?section=visits`);
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="p-0.5 rounded hover:bg-muted/60 transition-colors shrink-0"
                      title="View all visits for this job"
                    >
                      <History className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Unscheduled dispatch tray: Job # + company + context */
          <div className="flex flex-col min-h-0 overflow-hidden">
            <div className="flex items-center gap-1 min-w-0">
              {isSaving && (
                <Loader2 className="h-3 w-3 text-primary animate-spin flex-shrink-0" />
              )}
              {/* Job number badge for dispatch identification */}
              {assignment?.jobNumber != null && (
                <span className="text-[10px] font-semibold text-muted-foreground bg-muted/60 px-1 rounded shrink-0">
                  #{assignment.jobNumber}
                </span>
              )}
              <span className="font-medium text-[12px] leading-tight truncate min-w-0 flex-1 text-foreground">
                {client.companyName}
              </span>
            </div>
            {/* Secondary line: summary or location */}
            {(summary || client.location) && (
              <div className="text-[11px] leading-tight text-muted-foreground truncate mt-0.5">
                {summary || client.location}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // OPTIMIZED: 2026-01-30 - Custom comparison to prevent unnecessary rerenders
  // Only re-render if these specific props change
  return (
    prevProps.id === nextProps.id &&
    prevProps.isSaving === nextProps.isSaving &&
    prevProps.isCompleted === nextProps.isCompleted &&
    prevProps.inCalendar === nextProps.inCalendar &&
    prevProps.cardHeight === nextProps.cardHeight &&
    prevProps.client?.companyName === nextProps.client?.companyName &&
    prevProps.summary === nextProps.summary &&
    prevProps.assignment?.version === nextProps.assignment?.version &&
    prevProps.assignment?.jobNumber === nextProps.assignment?.jobNumber &&
    prevProps.assignment?.visitNumber === nextProps.assignment?.visitNumber &&
    prevProps.technicianColor?.borderLeft === nextProps.technicianColor?.borderLeft &&
    prevProps.draggable === nextProps.draggable
  );
});
