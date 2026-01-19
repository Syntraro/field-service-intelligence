import { memo, useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { DraggableClient } from "./DraggableClient";
import { ResizableJobCard } from "./ResizableJobCard";
import {
  DENSITY_STYLES,
  ALLDAY_ROW_HEIGHTS,
  CalendarDensity,
  CalendarEvent,
  getTechnicianColorForAssignment,
  calculateLanes,
  getMondayOfWeek,
} from "./calendarUtils";

// ============================================================================
// Types
// ============================================================================

export interface CalendarGridWeekProps {
  currentDate: Date;
  density: CalendarDensity;
  companySettings: any;
  clients: any[];
  eventIndexes: {
    eventsByDateKey: Map<string, CalendarEvent[]>;
  };
  selectedTechnicianId: string | null;
  expandedAllDaySlots: Set<string>;
  setExpandedAllDaySlots: React.Dispatch<React.SetStateAction<Set<string>>>;
  getTechnicianColor: (assignment: any) => ReturnType<typeof getTechnicianColorForAssignment>;
  handleClientClick: (client: any, event: CalendarEvent) => void;
  handleResize: (assignmentId: string, newDurationMinutes: number) => void;
  weeklyScrollContainerRef: React.RefObject<HTMLDivElement>;
  /** Optional: hours to render (defaults to 0-23). Pass subset for business hours. */
  visibleHours?: number[];
  /** Whether showing full 24h day */
  showFullDay?: boolean;
  /** Callback to toggle full day view */
  onToggleFullDay?: () => void;
}

interface WeekDayData {
  date: Date;
  dayNumber: number;
  monthNumber: number;
  yearNumber: number;
  dateKey: string;
  dayEvents: CalendarEvent[];
  dayName: string;
  laneMap: Map<string, { laneIndex: number; totalLanes: number }>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Find a client by CalendarEvent's locationKey */
function findClientByEvent(clients: any[], event: CalendarEvent): any | undefined {
  return clients.find((c: any) => c.id === event.locationKey);
}

// ============================================================================
// Drop Zone Components
// ============================================================================

/** Drop zone component for all-day slots in weekly view */
function AllDayDropZone({ dayName, dayNumber, children }: { dayName: string; dayNumber: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `allday-${dayName}-${dayNumber}` });

  // Full-cell hit area: the droppable rect must match the grid cell height, not just content height.
  return (
    <div className="border-r w-full relative" style={{ minHeight: 64, height: "100%" }}>
      <div
        ref={setNodeRef}
        className={`absolute inset-0 ${isOver ? "bg-primary/20 border-2 border-primary" : "bg-background"}`}
      />
      <div className="relative h-full p-2">
        {children}
      </div>
    </div>
  );
}

/** Quarter-hour drop zone (15-min increments) */
function QuarterDropZone({ id }: { id: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`h-1/4 w-full pointer-events-none ${isOver ? 'bg-primary/20 border border-primary' : ''}`}
    />
  );
}

/** Drop zone component for hourly slots in weekly view */
function HourlyDropZone({
  dayName,
  hour,
  dayNumber,
  dayEvents = [],
  laneMap,
  density,
  clients,
  getTechnicianColor,
  handleResize,
  handleClientClick,
}: {
  dayName: string;
  hour: number;
  dayNumber: number;
  dayEvents?: CalendarEvent[];
  laneMap?: Map<string, { laneIndex: number; totalLanes: number }>;
  density: CalendarDensity;
  clients: any[];
  getTechnicianColor: (assignment: any) => ReturnType<typeof getTechnicianColorForAssignment>;
  handleResize: (assignmentId: string, newDurationMinutes: number) => void;
  handleClientClick: (client: any, event: CalendarEvent) => void;
}) {
  const rowHeight = DENSITY_STYLES[density].rowHeight;

  // Filter events for this specific hour
  const hourlyEvents = dayEvents.filter((e) => !e.isAllDay && e.scheduledHour === hour);

  return (
    <div className={`border-r ${DENSITY_STYLES[density].row} bg-background relative`} style={{ minHeight: `${rowHeight}px` }}>
      <div className="absolute inset-0 flex flex-col pointer-events-none">
        {[0, 15, 30, 45].map((m) => (
          <QuarterDropZone key={m} id={`weekly-${dayName}-${hour}-${m}-${dayNumber}`} />
        ))}
      </div>

      {hourlyEvents.map((event) => {
        const client = findClientByEvent(clients, event);
        const lane = laneMap?.get(event.assignmentId) || { laneIndex: 0, totalLanes: 1 };
        return client ? (
          <ResizableJobCard
            key={event.assignmentId}
            assignment={event.raw}
            client={client}
            rowHeight={rowHeight}
            onResize={handleResize}
            getTechnicianColor={getTechnicianColor}
            densityStyle={DENSITY_STYLES[density].card}
            onClick={() => handleClientClick(client, event)}
            isCompleted={event.completed}
            isOverdue={!event.completed && new Date(event.scheduledDate) < new Date()}
            laneIndex={lane.laneIndex}
            totalLanes={lane.totalLanes}
          />
        ) : null;
      })}
    </div>
  );
}

// ============================================================================
// CalendarGridWeek Component
// ============================================================================

export function CalendarGridWeek({
  currentDate,
  density,
  companySettings,
  clients,
  eventIndexes,
  selectedTechnicianId,
  expandedAllDaySlots,
  setExpandedAllDaySlots,
  getTechnicianColor,
  handleClientClick,
  handleResize,
  weeklyScrollContainerRef,
  visibleHours,
  showFullDay,
  onToggleFullDay,
}: CalendarGridWeekProps) {
  // Get week dates based on currentDate (Monday to Sunday)
  const currentWeekStart = getMondayOfWeek(currentDate);

  const startHour = companySettings?.calendarStartHour || 8;
  const weekDaysData: WeekDayData[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(currentWeekStart);
    date.setDate(currentWeekStart.getDate() + i);
    const dayNumber = date.getDate();
    const monthNumber = date.getMonth() + 1;
    const yearNumber = date.getFullYear();
    const dateKey = `${yearNumber}-${String(monthNumber).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;

    // Get events for this specific day from normalized events
    let dayEvents = eventIndexes.eventsByDateKey.get(dateKey) || [];

    // Filter by selected technician
    if (selectedTechnicianId === "unassigned") {
      dayEvents = dayEvents.filter((e) => e.technicianIds.length === 0);
    } else if (selectedTechnicianId && selectedTechnicianId !== "all") {
      dayEvents = dayEvents.filter((e) => e.technicianIds.includes(selectedTechnicianId));
    }

    // Calculate lanes for timed events (not all-day) - pass raw for calculateLanes compatibility
    const timedEvents = dayEvents.filter((e) => !e.isAllDay);
    const laneMap = calculateLanes(timedEvents.map((e) => e.raw));

    weekDaysData.push({
      date,
      dayNumber,
      monthNumber,
      yearNumber,
      dateKey,
      dayEvents,
      dayName: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i],
      laneMap
    });
  }

  // Use visibleHours prop if provided, otherwise default to all 24 hours
  const hoursToRender = visibleHours ?? Array.from({ length: 24 }, (_, i) => i);
  const hours = hoursToRender.map((h) => {
    const ampm = h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
    return { hour: h, display: ampm };
  });

  const gridCols = "grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]";

  return (
    <div ref={weeklyScrollContainerRef} className="overflow-y-auto flex-1 min-h-0 max-h-full">
      {/* Header Row - Sticky at top */}
      <div className={`grid ${gridCols} sticky top-0 bg-background z-30 border-b`}>
        <div className="px-1.5 py-2 border-r flex items-center justify-center">
          {onToggleFullDay && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[10px]"
              onClick={onToggleFullDay}
              title={showFullDay ? "Show business hours only" : "Show full 24h day"}
            >
              {showFullDay ? "6-20" : "24h"}
            </Button>
          )}
        </div>
        {weekDaysData.map((d) => {
          const isToday = d.date.toDateString() === new Date().toDateString();
          return (
            <div key={d.dayName} className="px-1 py-2 text-center border-r">
              <span className={`text-sm font-medium ${isToday ? 'bg-primary text-primary-foreground px-2 py-0.5 rounded-full' : ''}`}>
                {d.dayName} {d.date.getDate()}
              </span>
            </div>
          );
        })}
      </div>

      {/* All Day Slot - Sticky below header */}
      <div
        className={`grid ${gridCols} sticky top-[41px] bg-background z-20 border-b`}
        style={{ height: ALLDAY_ROW_HEIGHTS[density] ?? 84 }}
      >
        <div className="px-1.5 py-1 text-[10px] font-semibold border-r bg-primary/10 flex items-center h-full">
          All Day
        </div>
        {weekDaysData.map((dayData) => {
          const allDayEvents = dayData.dayEvents.filter((e) => e.isAllDay);
          const slotKey = `${dayData.dayName}-${dayData.dayNumber}`;
          const isExpanded = expandedAllDaySlots.has(slotKey);
          const visibleEvents = isExpanded ? allDayEvents : allDayEvents.slice(0, 3);
          const hiddenCount = Math.max(0, allDayEvents.length - 3);

          return (
            <AllDayDropZone key={`${dayData.dayName}-allday`} dayName={dayData.dayName} dayNumber={dayData.dayNumber}>
              <div className="p-1">
                {visibleEvents.map((event) => {
                  const client = findClientByEvent(clients, event);
                  return client ? (
                    <DraggableClient
                      key={event.assignmentId}
                      id={event.assignmentId}
                      client={client}
                      inCalendar
                      onClick={() => handleClientClick(client, event)}
                      isCompleted={event.completed}
                      isOverdue={!event.completed && new Date(event.scheduledDate) < new Date()}
                      assignment={event.raw}
                      technicianColor={getTechnicianColor(event.raw)}
                      densityStyle={DENSITY_STYLES[density].card}
                    />
                  ) : null;
                })}
                {hiddenCount > 0 && !isExpanded && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1 text-[10px] w-full"
                    onClick={() => {
                      setExpandedAllDaySlots(prev => new Set(prev).add(slotKey));
                    }}
                    data-testid={`button-view-all-${dayData.dayName}`}
                  >
                    +{hiddenCount} more
                  </Button>
                )}
                {isExpanded && allDayEvents.length > 3 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1 text-[10px] w-full"
                    onClick={() => {
                      setExpandedAllDaySlots(prev => {
                        const next = new Set(prev);
                        next.delete(slotKey);
                        return next;
                      });
                    }}
                    data-testid={`button-collapse-${dayData.dayName}`}
                  >
                    Show less
                  </Button>
                )}
              </div>
            </AllDayDropZone>
          );
        })}
      </div>

      {/* Hourly Slots */}
      {hours.map((h) => (
        <div key={h.hour} className={`grid ${gridCols} border-b`}>
          <div className={`px-1.5 py-1 text-[10px] font-medium border-r flex items-center justify-center ${h.hour === startHour ? 'bg-primary/30 font-bold' : 'bg-muted/20'}`}>
            {h.display}
          </div>
          {weekDaysData.map((dayData) => (
            <MemoizedHourlyDropZone
              key={`${dayData.dayName}-${h.hour}`}
              dayName={dayData.dayName}
              hour={h.hour}
              dayNumber={dayData.dayNumber}
              dayEvents={dayData.dayEvents}
              laneMap={dayData.laneMap}
              density={density}
              clients={clients}
              getTechnicianColor={getTechnicianColor}
              handleResize={handleResize}
              handleClientClick={handleClientClick}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// Memoized version of HourlyDropZone to reduce rerenders during drag
const MemoizedHourlyDropZone = memo(HourlyDropZone);

// Export memoized version of CalendarGridWeek
export const MemoizedCalendarGridWeek = memo(CalendarGridWeek);
