/**
 * CalendarGridWeekTechnicians - Calendar Slice 3
 *
 * Week view calendar with:
 * - Rows = Technicians
 * - Columns = Days (Mon-Sun)
 *
 * Features:
 * - Technician working hours display
 * - Drag/drop job scheduling
 * - Job cards showing scheduled time range
 * - Click to open Schedule modal
 */

import { useMemo } from "react";
import { format } from "date-fns";
import { useDroppable } from "@dnd-kit/core";
import { JobCard } from "./JobCard";
import {
  TECHNICIAN_COLORS,
  DENSITY_STYLES,
  CalendarDensity,
  CalendarEvent,
  getWeekStart,
  isCalendarEventOverdue,
  TechnicianColor,
} from "./calendarUtils";
import type { RegionalSettings } from "@/hooks/useCompanyRegionalSettings";
import { nowInTimezone } from "@/hooks/useCompanyRegionalSettings";
import { Button } from "@/components/ui/button";
import { Plus, User } from "lucide-react";

// ============================================================================
// Types
// ============================================================================

export interface CalendarGridWeekTechniciansProps {
  currentDate: Date;
  density: CalendarDensity;
  technicians: any[];
  eventIndexes: {
    eventsByDateKey: Map<string, CalendarEvent[]>;
  };
  hiddenTechnicianIds: Set<string>;
  onJobClick: (event: CalendarEvent, technician: any) => void;
  onSlotClick: (date: Date, technician: any) => void;
  onScheduleNew: (date: Date, technicianId?: string) => void;
  /** Regional settings (timezone, time format, week start) */
  regional: RegionalSettings;
}

interface WeekDayColumn {
  date: Date;
  dayNumber: number;
  monthNumber: number;
  yearNumber: number;
  dateKey: string;
  dayName: string;
  isToday: boolean;
}

// ============================================================================
// Tech Job Card - Uses shared JobCard for visual consistency
// ============================================================================

interface TechJobCardProps {
  event: CalendarEvent;
  technician: any;
  color: TechnicianColor;
  allTechnicians: any[];
  timeFormat: "12h" | "24h";
  onJobClick: (event: CalendarEvent, technician: any) => void;
}

function TechJobCard({
  event,
  technician,
  color,
  allTechnicians,
  timeFormat,
  onJobClick,
}: TechJobCardProps) {
  // Build client object from event data
  const client = {
    companyName: event.raw?.companyName || event.raw?.summary || "Job",
    location: event.raw?.locationName,
  };

  return (
    <JobCard
      id={event.assignmentId}
      client={client}
      assignment={event.raw}
      inCalendar
      onClick={() => onJobClick(event, technician)}
      isCompleted={event.completed}
      isOverdue={isCalendarEventOverdue(event)}
      technicianColor={color}
      densityStyle="py-1 px-1.5"
      technicians={allTechnicians}
      timeFormat={timeFormat}
      showQuickActions={false}
    />
  );
}

// ============================================================================
// Drop Zone Component
// ============================================================================

function TechnicianDayDropZone({
  technicianId,
  dateKey,
  dayNumber,
  monthNumber,
  yearNumber,
  events,
  onJobClick,
  onSlotClick,
  technician,
  density,
  techIndex,
  allTechnicians,
  timeFormat,
}: {
  technicianId: string;
  dateKey: string;
  dayNumber: number;
  monthNumber: number;
  yearNumber: number;
  events: CalendarEvent[];
  onJobClick: (event: CalendarEvent, technician: any) => void;
  onSlotClick: (date: Date, technician: any) => void;
  technician: any;
  density: CalendarDensity;
  techIndex: number;
  allTechnicians: any[];
  timeFormat: "12h" | "24h";
}) {
  // Note: Uses | delimiter to avoid splitting UUIDs which contain dashes
  const dropId = `techweek|${technicianId}|${dateKey}`;
  const { setNodeRef, isOver } = useDroppable({ id: dropId });

  // DEV-only: log when tech week drop zone becomes active (2026-01-29)
  if (process.env.NODE_ENV === 'development' && isOver) {
    console.log('[TechWeekDropZone] isOver=true:', { dropId, technicianId, dateKey });
  }

  const color = TECHNICIAN_COLORS[techIndex % TECHNICIAN_COLORS.length];

  // Sort events by start time
  const sortedEvents = useMemo(
    () =>
      [...events].sort((a, b) => {
        const aTime = a.scheduledHour ?? 0;
        const bTime = b.scheduledHour ?? 0;
        return aTime - bTime;
      }),
    [events]
  );

  const handleSlotClick = () => {
    const clickDate = new Date(yearNumber, monthNumber - 1, dayNumber);
    onSlotClick(clickDate, technician);
  };

  return (
    <div
      ref={setNodeRef}
      onClick={handleSlotClick}
      className={`
        relative p-1 min-h-[100px] border-r border-b cursor-pointer
        transition-colors duration-150
        ${isOver ? "bg-primary/20 ring-2 ring-primary ring-inset" : "hover:bg-muted/50"}
      `}
    >
      {/* Events */}
      <div className="space-y-1">
        {sortedEvents.map((event) => (
          <TechJobCard
            key={event.assignmentId}
            event={event}
            technician={technician}
            color={color}
            allTechnicians={allTechnicians}
            timeFormat={timeFormat}
            onJobClick={onJobClick}
          />
        ))}
      </div>

      {/* Empty state - show plus when hovering */}
      {sortedEvents.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
          <Plus className="h-6 w-6 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Unassigned Row Drop Zone
// ============================================================================

function UnassignedDayDropZone({
  dateKey,
  dayNumber,
  monthNumber,
  yearNumber,
  events,
  onJobClick,
  onSlotClick,
  density,
  allTechnicians,
  timeFormat,
}: {
  dateKey: string;
  dayNumber: number;
  monthNumber: number;
  yearNumber: number;
  events: CalendarEvent[];
  onJobClick: (event: CalendarEvent, technician: any) => void;
  onSlotClick: (date: Date, technician: any) => void;
  density: CalendarDensity;
  allTechnicians: any[];
  timeFormat: "12h" | "24h";
}) {
  // Note: Uses | delimiter for consistency with technician drop zones
  const dropId = `techweek|unassigned|${dateKey}`;
  const { setNodeRef, isOver } = useDroppable({ id: dropId });

  // DEV-only: log when unassigned drop zone becomes active (2026-01-29)
  if (process.env.NODE_ENV === 'development' && isOver) {
    console.log('[UnassignedDayDropZone] isOver=true:', { dropId, dateKey });
  }

  const sortedEvents = useMemo(
    () =>
      [...events].sort((a, b) => {
        const aTime = a.scheduledHour ?? 0;
        const bTime = b.scheduledHour ?? 0;
        return aTime - bTime;
      }),
    [events]
  );

  const handleSlotClick = () => {
    const clickDate = new Date(yearNumber, monthNumber - 1, dayNumber);
    onSlotClick(clickDate, null);
  };

  return (
    <div
      ref={setNodeRef}
      onClick={handleSlotClick}
      className={`
        relative p-1 min-h-[100px] border-r border-b cursor-pointer
        transition-colors duration-150 bg-muted/20
        ${isOver ? "bg-primary/20 ring-2 ring-primary ring-inset" : "hover:bg-muted/50"}
      `}
    >
      <div className="space-y-1">
        {sortedEvents.map((event) => (
          <TechJobCard
            key={event.assignmentId}
            event={event}
            technician={null}
            color={{ bg: "bg-muted/50", border: "border-muted-foreground/30", dot: "bg-muted-foreground/30", borderLeft: "border-l-muted-foreground/30", text: "text-muted-foreground", label: "Unassigned" }}
            allTechnicians={allTechnicians}
            timeFormat={timeFormat}
            onJobClick={onJobClick}
          />
        ))}
      </div>

      {sortedEvents.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
          <Plus className="h-6 w-6 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function CalendarGridWeekTechnicians({
  currentDate,
  density,
  technicians,
  eventIndexes,
  hiddenTechnicianIds,
  onJobClick,
  onSlotClick,
  onScheduleNew,
  regional,
}: CalendarGridWeekTechniciansProps) {
  // Get week dates, respecting weekStartsOn setting
  const weekStart = getWeekStart(currentDate, regional.weekStartsOn);
  const today = nowInTimezone(regional.timezone);

  const weekDays: WeekDayColumn[] = useMemo(() => {
    const days: WeekDayColumn[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      const dayNumber = date.getDate();
      const monthNumber = date.getMonth() + 1;
      const yearNumber = date.getFullYear();
      const dateKey = `${yearNumber}-${String(monthNumber).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`;

      days.push({
        date,
        dayNumber,
        monthNumber,
        yearNumber,
        dateKey,
        dayName: (regional.weekStartsOn === "sunday"
          ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
          : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])[i],
        isToday: date.toDateString() === today.toDateString(),
      });
    }
    return days;
  }, [weekStart]);

  // Filter visible technicians
  const visibleTechnicians = useMemo(
    () => technicians.filter((t) => !hiddenTechnicianIds.has(t.id)),
    [technicians, hiddenTechnicianIds]
  );

  const showUnassigned = !hiddenTechnicianIds.has("unassigned");

  // Get events for a specific day and technician
  const getEventsForCell = (dateKey: string, technicianId: string | null): CalendarEvent[] => {
    const dayEvents = eventIndexes.eventsByDateKey.get(dateKey) || [];
    return dayEvents.filter((e) => {
      if (technicianId === null) {
        return e.technicianIds.length === 0;
      }
      return e.technicianIds.includes(technicianId);
    });
  };

  const gridCols = `grid-cols-[180px_repeat(7,minmax(0,1fr))]`;

  return (
    <div className="overflow-auto flex-1 min-h-0">
      {/* Header Row - Days */}
      <div className={`grid ${gridCols} sticky top-0 bg-background z-30 border-b`}>
        <div className="px-3 py-2 border-r flex items-center">
          <span className="text-sm font-medium text-muted-foreground">Technician</span>
        </div>
        {weekDays.map((day) => (
          <div
            key={day.dateKey}
            className={`px-2 py-2 text-center border-r ${day.isToday ? "bg-primary/10" : ""}`}
          >
            <span
              className={`text-sm font-medium ${day.isToday ? "bg-primary text-primary-foreground px-2 py-0.5 rounded-full" : ""}`}
            >
              {day.dayName} {day.dayNumber}
            </span>
            <div className="text-xs text-muted-foreground">
              {format(day.date, "MMM")}
            </div>
          </div>
        ))}
      </div>

      {/* Technician Rows */}
      {visibleTechnicians.map((tech, techIndex) => {
        const color = TECHNICIAN_COLORS[techIndex % TECHNICIAN_COLORS.length];
        return (
          <div key={tech.id} className={`grid ${gridCols}`}>
            {/* Technician Name Cell */}
            <div className="px-3 py-2 border-r border-b flex items-center gap-2 bg-muted/30">
              <div className={`w-3 h-3 rounded-full ${color.dot}`} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">
                  {tech.fullName || `${tech.firstName} ${tech.lastName}`}
                </div>
                {tech.workingHours && (
                  <div className="text-[10px] text-muted-foreground truncate">
                    {tech.workingHours}
                  </div>
                )}
              </div>
            </div>

            {/* Day Cells */}
            {weekDays.map((day) => (
              <TechnicianDayDropZone
                key={`${tech.id}-${day.dateKey}`}
                technicianId={tech.id}
                dateKey={day.dateKey}
                dayNumber={day.dayNumber}
                monthNumber={day.monthNumber}
                yearNumber={day.yearNumber}
                events={getEventsForCell(day.dateKey, tech.id)}
                onJobClick={onJobClick}
                onSlotClick={onSlotClick}
                technician={tech}
                density={density}
                techIndex={techIndex}
                allTechnicians={technicians}
                timeFormat={regional.timeFormat}
              />
            ))}
          </div>
        );
      })}

      {/* Unassigned Row */}
      {showUnassigned && (
        <div className={`grid ${gridCols}`}>
          <div className="px-3 py-2 border-r border-b flex items-center gap-2 bg-muted/50">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">Unassigned</span>
          </div>
          {weekDays.map((day) => (
            <UnassignedDayDropZone
              key={`unassigned-${day.dateKey}`}
              dateKey={day.dateKey}
              dayNumber={day.dayNumber}
              monthNumber={day.monthNumber}
              yearNumber={day.yearNumber}
              events={getEventsForCell(day.dateKey, null)}
              onJobClick={onJobClick}
              onSlotClick={onSlotClick}
              density={density}
              allTechnicians={technicians}
              timeFormat={regional.timeFormat}
            />
          ))}
        </div>
      )}

      {/* Empty state if no technicians */}
      {visibleTechnicians.length === 0 && !showUnassigned && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <User className="h-12 w-12 mb-4 opacity-50" />
          <p className="text-lg font-medium">No technicians visible</p>
          <p className="text-sm">Use the filter to show technicians</p>
        </div>
      )}
    </div>
  );
}
