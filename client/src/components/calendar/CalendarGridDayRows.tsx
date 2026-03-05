/**
 * CalendarGridDayRows — Horizontal technician rows day view
 *
 * Polish Pass 2026-03-04: Alternative day layout with time on X-axis
 * and technicians stacked as horizontal rows (Gantt-chart style).
 *
 * Simpler than the column layout — click-to-open only (no drag-resize).
 */
import { memo, useMemo, useRef, useEffect } from "react";
import { format } from "date-fns";
import { useDroppable } from "@dnd-kit/core";
import {
  TECHNICIAN_COLORS,
  DENSITY_STYLES,
  CalendarDensity,
  CalendarEvent,
  getTechnicianColorForAssignment,
  isCalendarEventOverdue,
} from "./calendarUtils";
import type { RegionalSettings } from "@/hooks/useCompanyRegionalSettings";
import { formatHourLabel } from "@/hooks/useCompanyRegionalSettings";
import { findClientByEvent } from "./calendarClientLookup";
import type { BusinessHourDay } from "./CalendarGridDayJobber";

// ============================================================================
// Constants
// ============================================================================

const HOURS_IN_DAY = 24;
const HOUR_WIDTH = 100; // px per hour
const ROW_HEIGHT = 56; // px per technician row
const HEADER_HEIGHT = 32; // px for time header
const TECH_LABEL_WIDTH = 120; // px for technician name column

// ============================================================================
// Types
// ============================================================================

export interface CalendarGridDayRowsProps {
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
  savingJobIds?: Set<string>;
  regional: RegionalSettings;
  businessHours?: BusinessHourDay[];
}

// ============================================================================
// HourDropZone — droppable quarter-hour slot in row layout
// ============================================================================

function RowDropZone({ technicianId, hour, minute, currentDate }: {
  technicianId: string;
  hour: number;
  minute: number;
  currentDate: Date;
}) {
  const dateKey = format(currentDate, "yyyy-MM-dd");
  const droppableId = `${technicianId}|${dateKey}|${hour}:${String(minute).padStart(2, "0")}`;
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });

  return (
    <div
      ref={setNodeRef}
      className={`absolute top-0 h-full pointer-events-auto ${isOver ? 'bg-primary/20 border border-primary z-50' : 'z-20'}`}
      style={{
        width: '25%',
        left: `${(minute / 60) * 100}%`,
      }}
    />
  );
}

// ============================================================================
// EventBlock — horizontal event positioned by time
// ============================================================================

function EventBlock({ event, client, techColor, onClick, isSaving, timeFormat }: {
  event: CalendarEvent;
  client: any;
  techColor: ReturnType<typeof getTechnicianColorForAssignment> | null;
  onClick: () => void;
  isSaving: boolean;
  timeFormat: "12h" | "24h";
}) {
  const startMinutes = event.startMinutes ?? 0;
  const durationMinutes = event.durationMinutes ?? 60;
  const isTask = (event as any).kind === "task";
  const isOverdue = isTask ? false : isCalendarEventOverdue(event);
  const left = (startMinutes / 60) * HOUR_WIDTH;
  const width = Math.max((durationMinutes / 60) * HOUR_WIDTH - 2, 30);

  const startHour = Math.floor(startMinutes / 60);
  const startMin = startMinutes % 60;
  const timeLabel = formatHourLabel(startHour, timeFormat) +
    (startMin > 0 ? `:${String(startMin).padStart(2, "0")}` : "");

  return (
    <div
      className={`absolute top-1 rounded px-1.5 py-0.5 text-[11px] leading-tight cursor-pointer truncate border shadow-sm
        ${isSaving ? 'opacity-50' : ''}
        ${event.completed ? 'opacity-60 line-through' : ''}
        ${isOverdue ? 'border-red-400 bg-red-50 dark:bg-red-950/30' : ''}
        ${isTask ? 'border-violet-300 bg-violet-50 dark:bg-violet-950/30' : ''}
        ${!isOverdue && !isTask ? (techColor?.bg || 'bg-blue-50 dark:bg-blue-950/30') + ' border-l-2 ' + (techColor?.border || 'border-blue-400') : ''}
      `}
      style={{
        left,
        width,
        height: ROW_HEIGHT - 10,
      }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={`${client?.companyName || 'Unknown'} — ${timeLabel}`}
    >
      <div className="font-medium truncate">{client?.companyName || (isTask ? event.raw?.title : 'Unknown')}</div>
      <div className="text-muted-foreground truncate">{timeLabel}</div>
    </div>
  );
}

// ============================================================================
// TechRow — single technician horizontal row
// ============================================================================

const MemoizedTechRow = memo(function TechRow({
  technicianId,
  technicianName,
  technicianColor,
  events,
  currentDate,
  clients,
  technicians,
  getTechnicianColor,
  handleClientClick,
  savingJobIds,
  timeFormat,
}: {
  technicianId: string;
  technicianName: string;
  technicianColor: (typeof TECHNICIAN_COLORS)[number] | null;
  events: CalendarEvent[];
  currentDate: Date;
  clients: any[];
  technicians: any[];
  getTechnicianColor: (assignment: any) => ReturnType<typeof getTechnicianColorForAssignment>;
  handleClientClick: (client: any, event: CalendarEvent, focusSchedule?: boolean) => void;
  savingJobIds?: Set<string>;
  timeFormat: "12h" | "24h";
}) {
  const timedEvents = events.filter(e => !e.isAllDay);

  return (
    <div className="flex border-b" style={{ height: ROW_HEIGHT }}>
      {/* Tech label — sticky left */}
      <div
        className="sticky left-0 z-20 bg-background border-r flex items-center gap-1.5 px-2 shrink-0"
        style={{ width: TECH_LABEL_WIDTH }}
      >
        {technicianColor && (
          <div className={`w-2 h-2 rounded-full shrink-0 ${technicianColor.dot}`} />
        )}
        <span className="text-xs font-medium truncate">{technicianName}</span>
      </div>

      {/* Timeline area */}
      <div className="relative flex-1" style={{ minWidth: HOURS_IN_DAY * HOUR_WIDTH }}>
        {/* Hour grid lines */}
        {Array.from({ length: HOURS_IN_DAY }, (_, hour) => (
          <div
            key={hour}
            className="absolute top-0 h-full border-r border-dashed border-muted/40"
            style={{ left: hour * HOUR_WIDTH, width: HOUR_WIDTH }}
          >
            {/* Quarter-hour drop zones */}
            {[0, 15, 30, 45].map((minute) => (
              <RowDropZone
                key={minute}
                technicianId={technicianId}
                hour={hour}
                minute={minute}
                currentDate={currentDate}
              />
            ))}
          </div>
        ))}

        {/* Events */}
        {timedEvents.map((event) => {
          const client = findClientByEvent(clients, event);
          if (!client) return null;
          const isSaving = savingJobIds?.has(event.assignmentId) || event.raw?._saving;
          const color = getTechnicianColor(event.raw);

          return (
            <EventBlock
              key={event.assignmentId}
              event={event}
              client={client}
              techColor={color}
              onClick={() => handleClientClick(client, event)}
              isSaving={!!isSaving}
              timeFormat={timeFormat}
            />
          );
        })}
      </div>
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

export function CalendarGridDayRows({
  currentDate,
  density,
  clients,
  technicians,
  eventIndexes,
  hiddenTechnicianIds,
  getTechnicianColor,
  handleClientClick,
  savingJobIds,
  regional,
  businessHours,
}: CalendarGridDayRowsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dateKey = format(currentDate, "yyyy-MM-dd");
  const dayEvents = eventIndexes.eventsByDateKey.get(dateKey) || [];

  // Filter visible technicians
  const visibleTechnicians = technicians.filter(t => !hiddenTechnicianIds.has(t.id));
  const showUnassigned = !hiddenTechnicianIds.has("unassigned");

  // Group events by technician
  const getEventsForTech = (techId: string | null) => {
    return dayEvents.filter(e => {
      const ids: string[] = e.technicianIds || (e.technicianId ? [e.technicianId] : []);
      if (techId === null) return ids.length === 0;
      return ids.includes(techId);
    });
  };

  // Auto-scroll to business hours start on mount
  useEffect(() => {
    if (scrollRef.current) {
      const startHour = businessHours?.find(h => h.isOpen)?.startMinutes
        ? Math.floor(businessHours.find(h => h.isOpen)!.startMinutes! / 60)
        : 7;
      scrollRef.current.scrollLeft = Math.max(0, startHour * HOUR_WIDTH - 20);
    }
  }, [dateKey]);

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-auto">
        {/* Time header row — sticky top */}
        <div className="sticky top-0 z-30 flex bg-background border-b">
          <div
            className="sticky left-0 z-40 bg-background border-r shrink-0"
            style={{ width: TECH_LABEL_WIDTH, height: HEADER_HEIGHT }}
          />
          <div className="flex" style={{ minWidth: HOURS_IN_DAY * HOUR_WIDTH }}>
            {Array.from({ length: HOURS_IN_DAY }, (_, hour) => (
              <div
                key={hour}
                className="text-[10px] text-muted-foreground text-center border-r border-dashed border-muted/40 flex items-end justify-center pb-1"
                style={{ width: HOUR_WIDTH, height: HEADER_HEIGHT }}
              >
                {formatHourLabel(hour, regional.timeFormat)}
              </div>
            ))}
          </div>
        </div>

        {/* Unassigned row */}
        {showUnassigned && (
          <MemoizedTechRow
            technicianId="unassigned"
            technicianName="Unassigned"
            technicianColor={null}
            events={getEventsForTech(null)}
            currentDate={currentDate}
            clients={clients}
            technicians={technicians}
            getTechnicianColor={getTechnicianColor}
            handleClientClick={handleClientClick}
            savingJobIds={savingJobIds}
            timeFormat={regional.timeFormat}
          />
        )}

        {/* Technician rows */}
        {visibleTechnicians.map((tech, index) => {
          const techColor = TECHNICIAN_COLORS[technicians.findIndex(t => t.id === tech.id) % TECHNICIAN_COLORS.length];
          const displayName = `${tech.firstName || ''} ${tech.lastName?.[0] || ''}`.trim() || tech.fullName || tech.displayName || 'Tech';

          return (
            <MemoizedTechRow
              key={tech.id}
              technicianId={tech.id}
              technicianName={displayName}
              technicianColor={techColor}
              events={getEventsForTech(tech.id)}
              currentDate={currentDate}
              clients={clients}
              technicians={technicians}
              getTechnicianColor={getTechnicianColor}
              handleClientClick={handleClientClick}
              savingJobIds={savingJobIds}
              timeFormat={regional.timeFormat}
            />
          );
        })}
      </div>
    </div>
  );
}
