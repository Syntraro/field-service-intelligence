import { memo, useMemo } from "react";
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
}

// ============================================================================
// Drop Zone Components
// ============================================================================

/** Quarter-hour drop zone (15-min increments) */
function QuarterDropZone({ id }: { id: string }) {
  // DEV assertion: daily timed IDs must be exactly 7 segments (daily-{techId}-{HH}-{MM}-{DD}-{MM2}-{YYYY})
  if (process.env.NODE_ENV === 'development' && id.startsWith('daily-')) {
    const segments = id.split('-');
    if (segments.length !== 7) {
      throw new Error(`Timed droppable id missing minutes: ${id} (expected 7 segments, got ${segments.length})`);
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
}) {
  const rowHeight = DENSITY_STYLES[density].rowHeight;

  return (
    <div
      className={`border-b border-r relative bg-background`}
      style={{ minHeight: `${rowHeight}px` }}
    >
      <div className="absolute inset-0 flex flex-col pointer-events-none">
        {[0, 15, 30, 45].map((m) => (
          <QuarterDropZone
            key={m}
            id={`daily-${technicianId}-${hour}-${m}-${currentDate.getDate()}-${currentDate.getMonth()}-${currentDate.getFullYear()}`}
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
}: CalendarGridDayProps) {
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
    <div className="overflow-y-auto flex-1 min-h-0 max-h-full relative">
      {/* Current time indicator */}
      {isToday && currentTimePosition >= 0 && currentTimePosition < 24 && (
        <div
          className="absolute left-0 right-0 z-40 pointer-events-none"
          style={{ top: `calc(41px + 28px + ${currentTimePosition * DENSITY_STYLES[density].rowHeight}px)` }}
        >
          <div className="flex items-center">
            <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
            <div className="flex-1 h-[2px] bg-red-500" />
          </div>
        </div>
      )}

      {/* Header Row - Technician names */}
      <div className={`grid ${gridCols} sticky top-0 bg-background z-30 border-b`}>
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
      <div className={`grid ${gridCols} sticky top-[41px] bg-background z-20 border-b`}>
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
      {hours.map((h) => (
        <div key={h.hour} className={`grid ${gridCols}`}>
          <div className={`px-1.5 py-1 text-[10px] font-medium border-r border-b flex items-center justify-center ${h.hour === dailyStartHour ? 'bg-primary/30 font-bold' : 'bg-muted/20'}`}>
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
            />
          )}
        </div>
      ))}
    </div>
  );
}

// Memoized version of DailyDropZone to reduce rerenders during drag
const MemoizedDailyDropZone = memo(DailyDropZone);

// Export memoized version of CalendarGridDay
export const MemoizedCalendarGridDay = memo(CalendarGridDay);
