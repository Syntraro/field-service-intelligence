import { memo, useMemo, useRef, useEffect } from "react";
import { format } from "date-fns";
import { useDroppable } from "@dnd-kit/core";
import { DraggableClient } from "./DraggableClient";
import { ResizableJobCard } from "./ResizableJobCard";
import {
  TECHNICIAN_COLORS,
  DENSITY_STYLES,
  CalendarDensity,
  CalendarEvent,
  getTechnicianColorForAssignment,
  calculateLanes,
  isCalendarEventOverdue,
} from "./calendarUtils";
import type { RegionalSettings } from "@/hooks/useCompanyRegionalSettings";
import { formatHourLabel, nowInTimezone } from "@/hooks/useCompanyRegionalSettings";
import { ensureClientsArray, findClientByEvent } from "./calendarClientLookup";

// ============================================================================
// Business Hours Types
// ============================================================================

export interface BusinessHourDay {
  dayOfWeek: number;
  isOpen: boolean;
  startMinutes: number | null;
  endMinutes: number | null;
}

// ============================================================================
// Types
// ============================================================================

export interface CalendarGridDayProps {
  currentDate: Date;
  density: CalendarDensity;
  companySettings: any;
  clients: any[];
  technicians: any[];
  eventIndexes: {
    eventsByDateKey: Map<string, CalendarEvent[]>;
  };
  hiddenTechnicianIds: Set<string>;
  getTechnicianColor: (assignment: any) => ReturnType<typeof getTechnicianColorForAssignment>;
  handleClientClick: (client: any, event: CalendarEvent, focusSchedule?: boolean) => void;
  handleResize: (assignmentId: string, newDurationMinutes: number) => void;
  /** Set of job IDs currently being saved (for visual feedback) */
  savingJobIds?: Set<string>;
  /** Quick action: unschedule */
  onUnschedule?: (assignmentId: string, version: number) => void;
  /** Regional settings (timezone, time format, week start) */
  regional: RegionalSettings;
  /** Business hours for grey-out and auto-scroll (7 days, 0=Sunday) */
  businessHours?: BusinessHourDay[];
}

// ============================================================================
// Drop Zone Components
// ============================================================================

/** Quarter-hour drop zone (15-min increments) */
function QuarterDropZone({ id }: { id: string }) {
  // DEV assertion: daily timed IDs must be exactly 7 segments (daily|{techId}|{HH}|{MM}|{DD}|{MM2}|{YYYY})
  // Note: Uses | delimiter to avoid splitting UUIDs which contain dashes
  if (process.env.NODE_ENV === 'development' && id.startsWith('daily|')) {
    const segments = id.split('|');
    if (segments.length !== 7) {
      console.warn(`Timed droppable id has unexpected format: ${id} (expected 7 segments, got ${segments.length})`);
    }
  }
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`h-1/4 w-full pointer-events-none ${isOver ? 'bg-primary/20 border border-primary' : ''}`}
    />
  );
}

/** Daily View Drop Zone Component with ResizableJobCard support */
function DailyDropZone({
  technicianId,
  hour,
  events,
  laneMap,
  density,
  clients,
  technicians,
  currentDate,
  getTechnicianColor,
  handleResize,
  handleClientClick,
  savingJobIds,
  onUnschedule,
  timeFormat,
  isOutsideBusinessHours,
}: {
  technicianId: string;
  hour: number;
  events: CalendarEvent[];
  laneMap: Map<string, { laneIndex: number; totalLanes: number }>;
  density: CalendarDensity;
  clients: any[];
  technicians?: any[];
  currentDate: Date;
  getTechnicianColor: (assignment: any) => ReturnType<typeof getTechnicianColorForAssignment>;
  handleResize: (assignmentId: string, newDurationMinutes: number) => void;
  handleClientClick: (client: any, event: CalendarEvent, focusSchedule?: boolean) => void;
  savingJobIds?: Set<string>;
  onUnschedule?: (assignmentId: string, version: number) => void;
  timeFormat?: "12h" | "24h";
  /** True if this hour is outside business hours */
  isOutsideBusinessHours?: boolean;
}) {
  const rowHeight = DENSITY_STYLES[density].rowHeight;

  return (
    <div
      className={`border-b border-r relative ${isOutsideBusinessHours ? 'bg-slate-200/70 dark:bg-slate-800/50' : 'bg-background'}`}
      style={{ minHeight: `${rowHeight}px` }}
    >
      <div className="absolute inset-0 flex flex-col pointer-events-none">
        {[0, 15, 30, 45].map((m) => (
          <QuarterDropZone
            key={m}
            id={`daily|${technicianId}|${hour}|${m}|${currentDate.getDate()}|${currentDate.getMonth()}|${currentDate.getFullYear()}`}
          />
        ))}
      </div>

      {events.map((event) => {
        const client = findClientByEvent(clients, event);
        const lane = laneMap.get(event.assignmentId) || { laneIndex: 0, totalLanes: 1 };
        const isSaving = savingJobIds?.has(event.assignmentId) || event.raw?._saving;
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
            onReschedule={() => handleClientClick(client, event, true)}
            isCompleted={event.completed}
            isOverdue={isCalendarEventOverdue(event)}
            laneIndex={lane.laneIndex}
            totalLanes={lane.totalLanes}
            isSaving={isSaving}
            technicians={technicians}
            onUnschedule={onUnschedule}
            timeFormat={timeFormat}
          />
        ) : null;
      })}
    </div>
  );
}

// ============================================================================
// CalendarGridDay Component
// ============================================================================

export function CalendarGridDay({
  currentDate,
  density,
  companySettings,
  clients,
  technicians,
  eventIndexes,
  hiddenTechnicianIds,
  getTechnicianColor,
  handleClientClick,
  handleResize,
  savingJobIds,
  onUnschedule,
  regional,
  businessHours,
}: CalendarGridDayProps) {
  // Refs for auto-scroll
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollDoneRef = useRef(false);

  // Get technicians to show as columns (filter by visibility)
  const visibleTechnicians = technicians.filter((t: any) => !hiddenTechnicianIds.has(t.id));
  const showUnassigned = !hiddenTechnicianIds.has('unassigned');

  // Get events for current date using normalized data
  const currentDateKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
  const dayEvents = (eventIndexes.eventsByDateKey.get(currentDateKey) || []).filter((e) => !e.completed);

  // Generate hours (6 AM to 6 PM by default, but use startHour from settings)
  const dailyStartHour = companySettings?.calendarStartHour ?? 7;
  const hours = Array.from({ length: 24 }, (_, i) => {
    return { hour: i, display: formatHourLabel(i, regional.timeFormat) };
  });

  // Calculate current time position (uses company timezone)
  const now = nowInTimezone(regional.timezone);
  const isToday = now.toDateString() === currentDate.toDateString();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTimePosition = currentHour + currentMinute / 60;

  // ============================================================================
  // Business Hours - Grey-out and Auto-scroll
  // ============================================================================
  //
  // Get business hours for the current day of week.
  // dayOfWeek: 0=Sunday, 1=Monday, ..., 6=Saturday
  // Times are in minutes from midnight (0-1440).
  // ============================================================================

  // Get the day of week in company timezone (not browser timezone)
  const dayOfWeekInTz = useMemo(() => {
    // Use the company timezone to determine the day of week
    const dateInTz = nowInTimezone(regional.timezone);
    // Since currentDate is the displayed date, we use its getDay()
    // but we should consider timezone for edge cases
    return currentDate.getDay(); // 0=Sunday, 6=Saturday
  }, [currentDate, regional.timezone]);

  // Get business hours for the current day
  const todayBusinessHours = useMemo(() => {
    if (!businessHours || businessHours.length !== 7) {
      // Default: open 6AM-5PM if no data
      return { isOpen: true, startMinutes: 360, endMinutes: 1020 };
    }
    const dayHours = businessHours.find((d) => d.dayOfWeek === dayOfWeekInTz);
    if (!dayHours) {
      return { isOpen: true, startMinutes: 360, endMinutes: 1020 };
    }
    return dayHours;
  }, [businessHours, dayOfWeekInTz]);

  // Determine if a given hour is outside business hours
  const isHourOutsideBusinessHours = useMemo(() => {
    return (hour: number): boolean => {
      if (!todayBusinessHours.isOpen) {
        // Closed all day
        return true;
      }
      const { startMinutes, endMinutes } = todayBusinessHours;
      if (startMinutes === null || endMinutes === null) {
        return false; // No times set, assume all hours are OK
      }
      const hourStartMinutes = hour * 60;
      const hourEndMinutes = (hour + 1) * 60;
      // Hour is outside if it ends before business start OR starts after business end
      return hourEndMinutes <= startMinutes || hourStartMinutes >= endMinutes;
    };
  }, [todayBusinessHours]);

  // Auto-scroll to business hours start on mount and when date changes
  useEffect(() => {
    // Reset scroll done flag when date changes
    scrollDoneRef.current = false;
  }, [currentDateKey]);

  useEffect(() => {
    if (scrollContainerRef.current && !scrollDoneRef.current && businessHours) {
      // Determine scroll target
      let scrollToHour: number;
      let targetMinutes: number;
      if (todayBusinessHours.isOpen && todayBusinessHours.startMinutes !== null) {
        // Scroll to 30 minutes before business start
        targetMinutes = Math.max(0, todayBusinessHours.startMinutes - 30);
        scrollToHour = targetMinutes / 60;
      } else {
        // If closed, scroll to 8 AM (default)
        targetMinutes = 480;
        scrollToHour = 8;
      }

      const rowHeight = DENSITY_STYLES[density].rowHeight;
      const scrollPosition = scrollToHour * rowHeight;

      // DEV logging for debugging auto-scroll
      if (process.env.NODE_ENV === 'development') {
        console.log('[DAYVIEW SCROLL]', {
          targetMinutes,
          scrollToHour,
          scrollTopPx: scrollPosition,
          rowHeight,
          businessHours: todayBusinessHours,
          dayOfWeek: dayOfWeekInTz,
        });
      }

      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollPosition;
          scrollDoneRef.current = true;
        }
      });
    }
  }, [todayBusinessHours, density, currentDateKey, businessHours, dayOfWeekInTz]);

  // DEV: Format business hours for display badge
  const devBusinessHoursBadge = useMemo(() => {
    if (process.env.NODE_ENV !== 'development') return null;

    const formatMinutes = (mins: number | null): string => {
      if (mins === null) return '--:--';
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    };

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = dayNames[dayOfWeekInTz];

    if (!todayBusinessHours.isOpen) {
      return `BH: CLOSED (${dayName})`;
    }
    return `BH: ${formatMinutes(todayBusinessHours.startMinutes)}–${formatMinutes(todayBusinessHours.endMinutes)} (${dayName})`;
  }, [todayBusinessHours, dayOfWeekInTz]);

  // Build columns: Time + Technicians + Unassigned
  const columnCount = visibleTechnicians.length + (showUnassigned ? 1 : 0) + 1; // +1 for time column
  const gridCols = `grid-cols-[3.5rem_repeat(${columnCount - 1},minmax(0,1fr))]`;

  // Get events by technician and hour
  const getEventsForSlot = (techId: string | null, hour: number): CalendarEvent[] => {
    return dayEvents.filter((e) => {
      const matchesTech = techId === null
        ? e.technicianIds.length === 0
        : e.technicianIds.includes(techId);
      return matchesTech && !e.isAllDay && e.scheduledHour === hour;
    });
  };

  // Get all-day events
  const getAllDayEvents = (techId: string | null): CalendarEvent[] => {
    return dayEvents.filter((e) => {
      const matchesTech = techId === null
        ? e.technicianIds.length === 0
        : e.technicianIds.includes(techId);
      return matchesTech && e.isAllDay;
    });
  };

  // Calculate lane maps per technician for timed events
  const getLaneMapForTechnician = (techId: string | null) => {
    const techTimedEvents = dayEvents.filter((e) => {
      const matchesTech = techId === null
        ? e.technicianIds.length === 0
        : e.technicianIds.includes(techId);
      return matchesTech && !e.isAllDay;
    });
    return calculateLanes(techTimedEvents.map((e) => e.raw));
  };

  return (
    <div ref={scrollContainerRef} className="overflow-y-auto flex-1 min-h-0 max-h-full relative">
      {/* Current time indicator */}
      {isToday && currentTimePosition >= 0 && currentTimePosition < 24 && (
        <div
          className="absolute left-0 right-0 z-40 pointer-events-none"
          style={{
            // In DEV mode: 28px (dev badge) + 41px (header) + 28px (all-day) = 97px
            // In prod: 41px (header) + 28px (all-day) = 69px
            top: `calc(${process.env.NODE_ENV === 'development' ? '97px' : '69px'} + ${currentTimePosition * DENSITY_STYLES[density].rowHeight}px)`
          }}
        >
          <div className="flex items-center">
            <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
            <div className="flex-1 h-[2px] bg-red-500" />
          </div>
        </div>
      )}

      {/* DEV-only Business Hours Badge */}
      {process.env.NODE_ENV === 'development' && devBusinessHoursBadge && (
        <div className="sticky top-0 z-50 bg-yellow-100 border-b border-yellow-300 px-2 py-1 text-xs font-mono text-yellow-800">
          {devBusinessHoursBadge} | Date: {format(currentDate, 'yyyy-MM-dd')} | DOW: {dayOfWeekInTz}
        </div>
      )}

      {/* Header Row - Technician names */}
      <div className={`grid ${gridCols} sticky ${process.env.NODE_ENV === 'development' ? 'top-[28px]' : 'top-0'} bg-background z-30 border-b`}>
        <div className="px-1.5 py-2 border-r flex items-center justify-center text-xs font-medium text-muted-foreground">
          {format(currentDate, 'EEE d')}
        </div>
        {visibleTechnicians.map((tech: any) => {
          const color = TECHNICIAN_COLORS[technicians.findIndex((t: any) => t.id === tech.id) % TECHNICIAN_COLORS.length];
          return (
            <div key={tech.id} className="px-2 py-2 text-center border-r">
              <div className="flex items-center justify-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${color.dot}`} />
                <span className="text-sm font-medium truncate">{tech.firstName} {tech.lastName?.[0]}.</span>
              </div>
            </div>
          );
        })}
        {showUnassigned && (
          <div className="px-2 py-2 text-center border-r">
            <span className="text-sm font-medium text-muted-foreground">Unassigned</span>
          </div>
        )}
      </div>

      {/* All Day Row */}
      <div className={`grid ${gridCols} sticky ${process.env.NODE_ENV === 'development' ? 'top-[69px]' : 'top-[41px]'} bg-background z-20 border-b`}>
        <div className="px-1.5 py-1 text-[10px] font-semibold border-r bg-primary/10 flex items-center h-full">
          All Day
        </div>
        {visibleTechnicians.map((tech: any) => {
          const techAllDayEvents = getAllDayEvents(tech.id);
          return (
            <div key={`allday-${tech.id}`} className="p-1 border-r min-h-[28px]">
              {techAllDayEvents.map((event) => {
                const client = findClientByEvent(clients, event);
                const isSaving = savingJobIds?.has(event.assignmentId) || event.raw?._saving;
                return client ? (
                  <DraggableClient
                    key={event.assignmentId}
                    id={event.assignmentId}
                    client={client}
                    inCalendar
                    onClick={() => handleClientClick(client, event)}
                    isCompleted={event.completed}
                    isOverdue={isCalendarEventOverdue(event)}
                    assignment={event.raw}
                    technicianColor={getTechnicianColor(event.raw)}
                    densityStyle={DENSITY_STYLES[density].card}
                    isSaving={isSaving}
                  />
                ) : null;
              })}
            </div>
          );
        })}
        {showUnassigned && (
          <div className="p-1 border-r min-h-[28px]">
            {getAllDayEvents(null).map((event) => {
              const client = findClientByEvent(clients, event);
              const isSaving = savingJobIds?.has(event.assignmentId) || event.raw?._saving;
              return client ? (
                <DraggableClient
                  key={event.assignmentId}
                  id={event.assignmentId}
                  client={client}
                  inCalendar
                  onClick={() => handleClientClick(client, event)}
                  isCompleted={event.completed}
                  isOverdue={isCalendarEventOverdue(event)}
                  assignment={event.raw}
                  technicianColor={getTechnicianColor(event.raw)}
                  densityStyle={DENSITY_STYLES[density].card}
                  isSaving={isSaving}
                />
              ) : null;
            })}
          </div>
        )}
      </div>

      {/* Hourly Slots */}
      {hours.map((h) => {
        const isOutside = isHourOutsideBusinessHours(h.hour);
        return (
          <div key={h.hour} className={`grid ${gridCols}`}>
            <div className={`px-1.5 py-1 text-[10px] font-medium border-r border-b flex items-center justify-center ${
              h.hour === dailyStartHour
                ? 'bg-primary/30 font-bold'
                : isOutside
                  ? 'bg-slate-200/70 dark:bg-slate-800/50 text-muted-foreground/60'
                  : 'bg-muted/20'
            }`}>
              {h.display}
            </div>
            {visibleTechnicians.map((tech: any) => {
              const slotEvents = getEventsForSlot(tech.id, h.hour);
              const techLaneMap = getLaneMapForTechnician(tech.id);
              return (
                <MemoizedDailyDropZone
                  key={`daily-${tech.id}-${h.hour}`}
                  technicianId={tech.id}
                  hour={h.hour}
                  events={slotEvents}
                  laneMap={techLaneMap}
                  density={density}
                  clients={clients}
                  technicians={technicians}
                  currentDate={currentDate}
                  getTechnicianColor={getTechnicianColor}
                  handleResize={handleResize}
                  handleClientClick={handleClientClick}
                  savingJobIds={savingJobIds}
                  onUnschedule={onUnschedule}
                  timeFormat={regional.timeFormat}
                  isOutsideBusinessHours={isOutside}
                />
              );
            })}
            {showUnassigned && (
              <MemoizedDailyDropZone
                technicianId="unassigned"
                hour={h.hour}
                events={getEventsForSlot(null, h.hour)}
                laneMap={getLaneMapForTechnician(null)}
                density={density}
                clients={clients}
                technicians={technicians}
                currentDate={currentDate}
                getTechnicianColor={getTechnicianColor}
                handleResize={handleResize}
                handleClientClick={handleClientClick}
                savingJobIds={savingJobIds}
                onUnschedule={onUnschedule}
                timeFormat={regional.timeFormat}
                isOutsideBusinessHours={isOutside}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Memoized version of DailyDropZone to reduce rerenders during drag
const MemoizedDailyDropZone = memo(DailyDropZone);

// Export memoized version of CalendarGridDay
export const MemoizedCalendarGridDay = memo(CalendarGridDay);
