import { useDroppable } from "@dnd-kit/core";
import { X } from "lucide-react";
import { DraggableClient } from "./DraggableClient";
import {
  CalendarEvent,
  getTechnicianColorForAssignment,
} from "./calendarUtils";

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
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Find a client by CalendarEvent's locationKey */
function findClientByEvent(clients: any[], event: CalendarEvent): any | undefined {
  return clients.find((c: any) => c.id === event.locationKey);
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
}: DroppableDayProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${day}` });

  // Check if day is overdue
  const today = new Date();
  const dayDate = new Date(year, month - 1, day);
  const isOverdue = dayDate < today;

  return (
    <div
      ref={setNodeRef}
      className={`min-h-20 px-1 py-1 border transition-all flex flex-col ${
        isOver
          ? 'bg-primary/10 border-primary border-2 ring-2 ring-primary/30 shadow-md'
          : 'bg-background'
      }`}
      data-testid={`calendar-day-${day}`}
    >
      <div className="text-xs text-muted-foreground mb-0.5 px-0.5">{day}</div>
      <div className={`flex-1 flex flex-col ${gapStyle || 'gap-1'}`}>
        {events.map((event) => {
          const client = findClientByEvent(clients, event);
          return client ? (
            <div key={event.assignmentId} className="relative group">
              <DraggableClient
                id={event.assignmentId}
                client={client}
                inCalendar={true}
                onClick={() => onClientClick(client, event)}
                isCompleted={event.completed}
                isOverdue={!event.completed && isOverdue}
                assignment={event.raw}
                technicianColor={getTechnicianColor?.(event.raw)}
                densityStyle={densityStyle}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(event.assignmentId);
                }}
                className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-10"
                data-testid={`remove-assignment-${event.assignmentId}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : null;
        })}
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
        />
      ) : (
        <div key={i} className="min-h-20 p-1 border bg-muted/10" />
      )
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="grid grid-cols-7">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div key={day} className="text-center font-medium text-sm p-2 border bg-muted/5">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 auto-rows-[minmax(6rem,max-content)] content-start">
        {days}
      </div>
    </div>
  );
}
