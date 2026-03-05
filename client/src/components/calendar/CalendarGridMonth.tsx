import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { X, ClipboardList } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarEventChip } from "./CalendarEventChip";
import { EventPreviewPopover } from "./EventPreviewPopover";
import {
  CalendarEvent,
  getTechnicianColorForAssignment,
  isCalendarEventOverdue,
} from "./calendarUtils";
import type { RegionalSettings } from "@/hooks/useCompanyRegionalSettings";
import { findClientByEvent } from "./calendarClientLookup";

// ============================================================================
// Types
// ============================================================================

export interface CalendarGridMonthProps {
  year: number;
  month: number;
  daysInMonth: number;
  firstDayOfMonth: number;
  eventsByDayNumber: Record<number, CalendarEvent[]>;
  clients: any[];
  onRemove: (assignmentId: string) => void;
  onClientClick: (client: any, event: CalendarEvent) => void;
  onClearDay: (day: number, events: CalendarEvent[]) => void;
  getTechnicianColor: (assignment: any) => ReturnType<typeof getTechnicianColorForAssignment>;
  densityStyle: string;
  gapStyle: string;
  /** Set of job IDs currently being saved (for visual feedback) */
  savingJobIds?: Set<string>;
  /** List of technicians for hover preview */
  technicians?: any[];
  /** Regional settings (week start day for grid headers) */
  regional: RegionalSettings;
}

interface DroppableDayProps {
  day: number;
  year: number;
  month: number;
  events: CalendarEvent[];
  clients: any[];
  onRemove: (assignmentId: string) => void;
  onClientClick: (client: any, event: CalendarEvent) => void;
  onClearDay: (day: number, events: CalendarEvent[]) => void;
  showParts?: boolean;
  getTechnicianColor?: (assignment: any) => ReturnType<typeof getTechnicianColorForAssignment>;
  densityStyle?: string;
  gapStyle?: string;
  savingJobIds?: Set<string>;
  technicians?: any[];
  timeFormat?: "12h" | "24h";
}

// ============================================================================
// DroppableDay Component
// ============================================================================

function DroppableDay({
  day,
  year,
  month,
  events,
  clients,
  onRemove,
  onClientClick,
  onClearDay,
  showParts = false,
  getTechnicianColor,
  densityStyle,
  gapStyle,
  savingJobIds,
  technicians = [],
  timeFormat = "12h",
}: DroppableDayProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${day}` });
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Show max 3 chips, then "+N more" popover trigger
  const MAX_VISIBLE = 3;
  const visibleEvents = events.slice(0, MAX_VISIBLE);
  const hiddenEvents = events.slice(MAX_VISIBLE);
  const hiddenCount = hiddenEvents.length;

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[68px] px-1 py-1 border transition-all flex flex-col ${
        isOver
          ? 'bg-primary/10 border-primary border-2 ring-2 ring-primary/30 shadow-md'
          : 'bg-background'
      }`}
      data-testid={`calendar-day-${day}`}
    >
      {/* Day number */}
      <div className="text-[11px] text-muted-foreground leading-none px-0.5 mb-1 flex items-center justify-between">
        <span className="font-medium">{day}</span>
        {events.length > 0 && (
          <span className="text-[9px] text-muted-foreground/60">{events.length}</span>
        )}
      </div>

      {/* Event chips */}
      <div className="flex-1 flex flex-col gap-[2px]">
        {visibleEvents.map((event) => {
          const client = findClientByEvent(clients, event);
          // Phase 9: Detect task items for distinct visual
          const isTask = (event as any).kind === "task";
          const title = isTask
            ? (event.raw?.title || "Task")
            : (client?.companyName || event.raw?.summary || "Untitled");
          const isSaving = savingJobIds?.has(event.assignmentId) || event.raw?._saving;
          // Phase 9: Task color override
          const taskColor = isTask ? {
            bg: 'bg-violet-50 dark:bg-violet-950/20',
            border: 'border-violet-400',
            borderLeft: 'border-l-violet-400',
            dot: 'bg-violet-400',
            text: 'text-violet-700 dark:text-violet-300',
            label: 'Task',
          } as const : undefined;
          return (
            <div key={event.assignmentId} className="relative group">
              <EventPreviewPopover
                event={event.raw || event}
                client={client}
                technicians={technicians}
                isSaving={isSaving}
                isOverdue={isTask ? false : isCalendarEventOverdue(event)}
                timeFormat={timeFormat}
              >
                <CalendarEventChip
                  id={event.assignmentId}
                  jobNumber={isTask ? null : event.jobNumber}
                  title={isTask ? `📋 ${title}` : title}
                  onClick={() => onClientClick(client, event)}
                  isCompleted={event.completed}
                  isOverdue={isTask ? false : isCalendarEventOverdue(event)}
                  technicianColor={taskColor || getTechnicianColor?.(event.raw)}
                  isSaving={isSaving}
                />
              </EventPreviewPopover>
              {/* Remove button on hover — not shown for tasks */}
              {!isTask && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(event.assignmentId);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-10"
                  data-testid={`remove-assignment-${event.assignmentId}`}
                >
                  <X className="h-2 w-2" />
                </button>
              )}
            </div>
          );
        })}

        {/* +N more popover */}
        {hiddenCount > 0 && (
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className="h-[16px] text-[9px] text-primary hover:text-primary/80 hover:underline flex items-center justify-center"
                data-testid={`show-more-${day}`}
              >
                +{hiddenCount} more
              </button>
            </PopoverTrigger>
            <PopoverContent
              className="w-56 p-2"
              side="right"
              align="start"
              sideOffset={4}
            >
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground mb-2">
                  {month}/{day} — {hiddenCount} more job{hiddenCount > 1 ? 's' : ''}
                </div>
                <div className="max-h-[200px] overflow-y-auto space-y-1">
                  {hiddenEvents.map((event) => {
                    const client = findClientByEvent(clients, event);
                    const isTask = (event as any).kind === "task";
                    const title = isTask
                      ? (event.raw?.title || "Task")
                      : (client?.companyName || event.raw?.summary || "Untitled");
                    const isSaving = savingJobIds?.has(event.assignmentId) || event.raw?._saving;
                    const taskColor = isTask ? {
                      bg: 'bg-violet-50 dark:bg-violet-950/20', border: 'border-violet-400',
                      borderLeft: 'border-l-violet-400', dot: 'bg-violet-400',
                      text: 'text-violet-700 dark:text-violet-300', label: 'Task',
                    } as const : undefined;
                    return (
                      <div key={event.assignmentId} className="relative group">
                        <EventPreviewPopover
                          event={event.raw || event}
                          client={client}
                          technicians={technicians}
                          isSaving={isSaving}
                          isOverdue={isTask ? false : isCalendarEventOverdue(event)}
                          timeFormat={timeFormat}
                        >
                          <CalendarEventChip
                            id={event.assignmentId}
                            jobNumber={isTask ? null : event.jobNumber}
                            title={isTask ? `📋 ${title}` : title}
                            onClick={() => {
                              setPopoverOpen(false);
                              onClientClick(client, event);
                            }}
                            isCompleted={event.completed}
                            isOverdue={isTask ? false : isCalendarEventOverdue(event)}
                            technicianColor={taskColor || getTechnicianColor?.(event.raw)}
                            isSaving={isSaving}
                          />
                        </EventPreviewPopover>
                        {/* Remove button on hover — not shown for tasks */}
                        {!isTask && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemove(event.assignmentId);
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-10"
                            data-testid={`remove-assignment-popover-${event.assignmentId}`}
                          >
                            <X className="h-2 w-2" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// CalendarGridMonth Component
// ============================================================================

export function CalendarGridMonth({
  year,
  month,
  daysInMonth,
  firstDayOfMonth,
  eventsByDayNumber,
  clients,
  onRemove,
  onClientClick,
  onClearDay,
  getTechnicianColor,
  densityStyle,
  gapStyle,
  savingJobIds,
  technicians = [],
  regional,
}: CalendarGridMonthProps) {
  const days = [];
  const totalCells = Math.ceil((daysInMonth + firstDayOfMonth) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    const dayNumber = i - firstDayOfMonth + 1;
    const isValidDay = dayNumber > 0 && dayNumber <= daysInMonth;
    const dayEvents = isValidDay ? (eventsByDayNumber[dayNumber] || []) : [];

    days.push(
      isValidDay ? (
        <DroppableDay
          key={i}
          day={dayNumber}
          year={year}
          month={month}
          events={dayEvents}
          clients={clients}
          onRemove={onRemove}
          onClientClick={onClientClick}
          onClearDay={onClearDay}
          showParts={false}
          getTechnicianColor={getTechnicianColor}
          densityStyle={densityStyle}
          gapStyle={gapStyle}
          savingJobIds={savingJobIds}
          technicians={technicians}
          timeFormat={regional.timeFormat}
        />
      ) : (
        <div key={i} className="min-h-[52px] p-0.5 border bg-muted/10" />
      )
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="grid grid-cols-7">
        {(regional.weekStartsOn === "sunday"
          ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
          : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        ).map((day) => (
          <div key={day} className="text-center font-medium text-xs p-1 border bg-muted/5">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 flex-1" style={{ gridAutoRows: "1fr" }}>
        {days}
      </div>
    </div>
  );
}
