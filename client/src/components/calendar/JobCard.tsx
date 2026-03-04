/**
 * JobCard - Unified job card component for all calendar contexts
 *
 * Provides consistent UI across:
 * - Scheduled timed jobs (via ResizableJobCard wrapper)
 * - All-day jobs in the all-day lane
 * - Unscheduled jobs in the sidebar
 *
 * Features:
 * - Hover preview popover (EventPreviewPopover)
 * - Quick action buttons (reschedule, unschedule) - configurable
 * - Consistent visual styling via DraggableClient
 *
 * Created 2026-01-29: Unified component for visual consistency across all job cards.
 */

import { useState } from "react";
import { Calendar as CalendarIcon, RotateCcw, ClipboardList } from "lucide-react";
import { DraggableClient } from "./DraggableClient";
import { EventPreviewPopover } from "./EventPreviewPopover";
import { TechnicianColor } from "./calendarUtils";

export interface JobCardProps {
  /** Unique ID for the job/assignment (used for drag) */
  id: string;
  /** Client data for display */
  client: {
    companyName: string;
    location?: string;
    id?: string;
  };
  /** Raw assignment/job data */
  assignment?: any;
  /** Whether this is a calendar card (true) or unscheduled sidebar card (false) */
  inCalendar?: boolean;
  /** Click handler - typically opens job detail dialog */
  onClick?: () => void;
  /** Reschedule click handler - opens dialog focused on schedule section */
  onReschedule?: () => void;
  /** Unschedule handler - requires assignment ID and version */
  onUnschedule?: (assignmentId: string, version: number) => void;
  /** Whether the job is completed */
  isCompleted?: boolean;
  /** Whether the job is overdue */
  isOverdue?: boolean;
  /** Whether the job is currently being saved */
  isSaving?: boolean;
  /** Technician color for left border stripe */
  technicianColor?: TechnicianColor;
  /** Density style class for the card */
  densityStyle?: string;
  /** Card height in pixels (for calendar cards) */
  cardHeight?: number;
  /** List of technicians for preview popover name lookup */
  technicians?: any[];
  /** Time format from regional settings */
  timeFormat?: "12h" | "24h";
  /** Job summary text (for unscheduled cards) */
  summary?: string;
  /** Month label (for unscheduled cards) */
  monthLabel?: string | null;
  /** Whether job is from a different month (for unscheduled cards) */
  isOffMonth?: boolean;
  /** Whether job is from a past month (for unscheduled cards) */
  isPastMonth?: boolean;
  /** Raw item from API for diagnostics (for unscheduled cards) */
  rawItem?: any;
  /** Whether to show quick action buttons on hover (default: true for calendar, false for unscheduled) */
  showQuickActions?: boolean;
  /** Item kind for visual distinction: "visit" (default) or "task" (Phase 9 of calendar rewrite) */
  itemKind?: "visit" | "task";
}

/**
 * Unified job card component used across all calendar contexts.
 * Wraps DraggableClient with EventPreviewPopover and optional quick actions.
 */
export function JobCard({
  id,
  client,
  assignment,
  inCalendar = false,
  onClick,
  onReschedule,
  onUnschedule,
  isCompleted = false,
  isOverdue = false,
  isSaving = false,
  technicianColor,
  densityStyle,
  cardHeight,
  technicians = [],
  timeFormat = "12h",
  summary,
  monthLabel,
  isOffMonth,
  isPastMonth,
  rawItem,
  showQuickActions,
  itemKind = "visit",
}: JobCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  // Default: show quick actions for calendar cards, hide for unscheduled
  const shouldShowQuickActions = showQuickActions ?? inCalendar;
  const quickActionsVisible = isHovered && !isSaving && shouldShowQuickActions;

  // Build event data for preview popover
  const eventData = assignment || rawItem || {
    summary,
    jobNumber: assignment?.jobNumber,
  };

  // Handle unschedule click
  const handleUnschedule = (e: React.MouseEvent) => {
    e.stopPropagation();
    const version = assignment?.version ?? rawItem?.version;
    if (onUnschedule && !isSaving && version !== undefined) {
      onUnschedule(id, version);
    }
  };

  // Handle reschedule click
  const handleReschedule = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onReschedule) {
      onReschedule();
    } else if (onClick) {
      onClick();
    }
  };

  // Phase 9: Task items get distinct styling
  const isTask = itemKind === "task";
  const taskOverrideColor = isTask ? {
    bg: 'bg-violet-50 dark:bg-violet-950/20',
    border: 'border-violet-400',
    borderLeft: 'border-l-violet-400',
    dot: 'bg-violet-400',
    text: 'text-violet-700 dark:text-violet-300',
    label: 'Task',
  } as const : undefined;

  return (
    <EventPreviewPopover
      event={eventData}
      client={client}
      technicians={technicians}
      isSaving={isSaving}
      isOverdue={isOverdue}
      timeFormat={timeFormat}
    >
      <div
        className="relative group"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Phase 9: Task icon badge */}
        {isTask && inCalendar && (
          <div className="absolute top-0.5 left-0.5 z-10">
            <ClipboardList className="h-3 w-3 text-violet-500" />
          </div>
        )}
        <DraggableClient
          id={id}
          client={client}
          inCalendar={inCalendar}
          onClick={onClick}
          isCompleted={isCompleted}
          isOverdue={isOverdue}
          assignment={assignment}
          technicianColor={taskOverrideColor || technicianColor}
          densityStyle={densityStyle}
          cardHeight={cardHeight}
          isSaving={isSaving}
          summary={summary}
          monthLabel={monthLabel}
          isOffMonth={isOffMonth}
          isPastMonth={isPastMonth}
          rawItem={rawItem}
          timeFormat={timeFormat}
          draggable={!isTask}
        />

        {/* Quick action icons - visible on hover */}
        {quickActionsVisible && (
          <div className="absolute top-0.5 right-0.5 flex gap-0.5 z-20">
            {/* Reschedule */}
            <button
              onClick={handleReschedule}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="p-0.5 rounded bg-white/90 text-muted-foreground hover:bg-[rgba(47,125,50,0.12)] hover:text-[#2F7D32] transition-colors"
              title="Reschedule"
            >
              <CalendarIcon className="h-3 w-3" />
            </button>
            {/* Unschedule */}
            {onUnschedule && (
              <button
                onClick={handleUnschedule}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className="p-0.5 rounded bg-white/90 text-muted-foreground hover:bg-orange-100 hover:text-orange-600 transition-colors"
                title="Unschedule"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>
    </EventPreviewPopover>
  );
}
