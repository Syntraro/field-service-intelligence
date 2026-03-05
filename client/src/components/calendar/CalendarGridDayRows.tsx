/**
 * CalendarGridDayRows — Horizontal technician rows day view
 *
 * Polish Pass 2026-03-04: Alternative day layout with time on X-axis
 * and technicians stacked as horizontal rows (Gantt-chart style).
 *
 * 2026-03-05: Added drag/drop + horizontal resize for Day view parity.
 * Events can be dragged to other time slots and resized by dragging
 * the right edge. Uses the same mutations as Day Columns view.
 */
import { memo, useMemo, useRef, useEffect, useState, useCallback } from "react";
import { format } from "date-fns";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import {
  TECHNICIAN_COLORS,
  DENSITY_STYLES,
  CalendarDensity,
  CalendarEvent,
  getTechnicianColorForAssignment,
  isCalendarEventOverdue,
  isAllDayEvent,
} from "./calendarUtils";
import type { RegionalSettings } from "@/hooks/useCompanyRegionalSettings";
import { formatHourLabel } from "@/hooks/useCompanyRegionalSettings";
import { findClientByEvent } from "./calendarClientLookup";
import type { BusinessHourDay } from "./CalendarGridDayJobber";
import { TechLaneHeader } from "./TechLaneHeader";
import type { TechDaySummary } from "@/hooks/useCalendarDaySummary";

// ============================================================================
// Constants
// ============================================================================

const HOURS_IN_DAY = 24;
const HOUR_WIDTH = 100; // px per hour
const ROW_HEIGHT = 56; // px per technician row
const HEADER_HEIGHT = 32; // px for time header
const TECH_LABEL_WIDTH = 120; // px for technician name column
const PX_PER_MINUTE = HOUR_WIDTH / 60;

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
  handleResize: (assignmentId: string, newDurationMinutes: number, assignment?: any) => void;
  savingJobIds?: Set<string>;
  onUnschedule?: (assignmentId: string, version: number) => void;
  regional: RegionalSettings;
  businessHours?: BusinessHourDay[];
  /** Per-technician day summary for lane headers (Calendar Improvement 2026-03-05) */
  techSummaryMap?: Map<string, TechDaySummary>;
  /** Sort lanes by risk level descending */
  riskFirstSort?: boolean;
  /** Only show lanes with active alerts */
  alertsOnly?: boolean;
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
  // Use same format as DayJobber for dnd-kit handler compatibility
  const droppableId = `daily|${technicianId}|${hour}|${minute}|${currentDate.getDate()}|${currentDate.getMonth()}|${currentDate.getFullYear()}`;
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
// DraggableEventBlock — horizontal event with drag + resize
// ============================================================================

function DraggableEventBlock({ event, client, techColor, onClick, isSaving, timeFormat, onResize, onUnschedule }: {
  event: CalendarEvent;
  client: any;
  techColor: ReturnType<typeof getTechnicianColorForAssignment> | null;
  onClick: () => void;
  isSaving: boolean;
  timeFormat: "12h" | "24h";
  onResize?: (assignmentId: string, newDurationMinutes: number, assignment?: any) => void;
  onUnschedule?: (assignmentId: string, version: number) => void;
}) {
  const startMinutes = event.startMinutes ?? 0;
  const originalDuration = event.durationMinutes ?? 60;
  const isTask = (event as any).kind === "task";
  const isOverdue = isTask ? false : isCalendarEventOverdue(event);
  const isCompleted = event.completed;

  // Drag support
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: event.assignmentId,
    disabled: isSaving || isCompleted || isTask,
    data: { type: "assignment", assignmentId: event.assignmentId, client, event: event.raw },
  });

  // Horizontal resize state
  const [isResizing, setIsResizing] = useState(false);
  const [tempDuration, setTempDuration] = useState<number | null>(null);
  const resizeRef = useRef<{ x: number; duration: number } | null>(null);

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeRef.current = { x: e.clientX, duration: originalDuration };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [originalDuration]);

  const handleResizeMove = useCallback((e: React.PointerEvent) => {
    if (!isResizing || !resizeRef.current) return;
    const deltaX = e.clientX - resizeRef.current.x;
    const deltaMinutes = Math.round(deltaX / PX_PER_MINUTE);
    const snapped = Math.round(deltaMinutes / 15) * 15;
    const maxDuration = Math.max(15, 1440 - startMinutes);
    setTempDuration(Math.max(15, Math.min(maxDuration, resizeRef.current.duration + snapped)));
  }, [isResizing, startMinutes]);

  const handleResizeEnd = useCallback((e: React.PointerEvent) => {
    if (!isResizing) return;
    setIsResizing(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    if (tempDuration !== null && tempDuration !== originalDuration && onResize) {
      onResize(event.assignmentId, tempDuration, event.raw);
    }
    setTempDuration(null);
    resizeRef.current = null;
  }, [isResizing, tempDuration, originalDuration, onResize, event.assignmentId, event.raw]);

  const displayDuration = tempDuration ?? originalDuration;
  const left = (startMinutes / 60) * HOUR_WIDTH;
  const width = Math.max((displayDuration / 60) * HOUR_WIDTH - 2, 30);

  const startHour = Math.floor(startMinutes / 60);
  const startMin = startMinutes % 60;
  const timeLabel = formatHourLabel(startHour, timeFormat) +
    (startMin > 0 ? `:${String(startMin).padStart(2, "0")}` : "");

  const dragStyle = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined;

  return (
    <div
      ref={setDragRef}
      {...attributes}
      {...(isResizing ? {} : listeners)}
      className={`absolute top-1 rounded px-1.5 py-0.5 text-[11px] leading-tight cursor-grab truncate border shadow-sm select-none
        ${isSaving ? 'opacity-50 cursor-wait' : ''}
        ${isDragging ? 'opacity-70 z-50 shadow-lg' : ''}
        ${isCompleted ? 'opacity-60 line-through' : ''}
        ${isOverdue ? 'border-red-400 bg-red-50 dark:bg-red-950/30' : ''}
        ${isTask ? 'border-violet-300 bg-violet-50 dark:bg-violet-950/30' : ''}
        ${!isOverdue && !isTask ? (techColor?.bg || 'bg-blue-50 dark:bg-blue-950/30') + ' border-l-2 ' + (techColor?.border || 'border-blue-400') : ''}
      `}
      style={{
        left,
        width,
        height: ROW_HEIGHT - 10,
        ...dragStyle,
      }}
      onClick={(e) => { if (!isDragging && !isResizing) { e.stopPropagation(); onClick(); } }}
      title={`${client?.companyName || 'Unknown'} — ${timeLabel}`}
    >
      <div className="font-medium truncate">{client?.companyName || (isTask ? event.raw?.title : 'Unknown')}</div>
      <div className="text-muted-foreground truncate">{timeLabel}</div>

      {/* Right-edge resize handle */}
      {!isTask && !isCompleted && !isSaving && onResize && (
        <div
          className={`absolute top-0 right-0 w-2 h-full cursor-col-resize hover:bg-primary/20 ${isResizing ? 'bg-primary/30' : ''}`}
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
        />
      )}

      {/* Duration tooltip during resize */}
      {isResizing && tempDuration !== null && (
        <div className="absolute -top-6 right-0 bg-foreground text-background text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap z-20">
          {Math.floor(tempDuration / 60)}h {tempDuration % 60}m
        </div>
      )}
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
  handleResize,
  savingJobIds,
  onUnschedule,
  timeFormat,
  techSummary,
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
  handleResize?: (assignmentId: string, newDurationMinutes: number, assignment?: any) => void;
  savingJobIds?: Set<string>;
  onUnschedule?: (assignmentId: string, version: number) => void;
  timeFormat: "12h" | "24h";
  /** Day summary for this technician (Calendar Improvement 2026-03-05) */
  techSummary?: TechDaySummary;
}) {
  const timedEvents = events.filter(e => !isAllDayEvent(e));
  const allDayEvents = events.filter(isAllDayEvent);

  return (
    <div className="flex border-b" style={{ minHeight: ROW_HEIGHT }}>
      {/* Tech label — sticky left, enhanced with compact summary (Calendar Improvement 2026-03-05) */}
      <div
        className="sticky left-0 z-20 bg-background border-r flex flex-col justify-center gap-0 px-2 shrink-0"
        style={{ width: TECH_LABEL_WIDTH }}
      >
        <div className="flex items-center gap-1.5">
          {technicianColor && (
            <div className={`w-2 h-2 rounded-full shrink-0 ${technicianColor.dot}`} />
          )}
          <span className="text-xs font-medium truncate">{technicianName}</span>
        </div>
        <TechLaneHeader summary={techSummary} compact />
        {/* All-day / Anytime chips */}
        {allDayEvents.length > 0 && (
          <div className="flex flex-wrap gap-0.5 mt-0.5">
            {allDayEvents.slice(0, 2).map(event => {
              const client = findClientByEvent(clients, event);
              const isTask = (event as any).kind === "task";
              return (
                <div
                  key={event.assignmentId}
                  className={`text-[9px] px-1 rounded truncate cursor-pointer max-w-[110px] ${
                    isTask ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                      : 'bg-primary/10 text-primary'
                  }`}
                  onClick={(e) => { e.stopPropagation(); handleClientClick(client, event); }}
                  title={`Anytime: ${client?.companyName || (isTask ? event.raw?.title : 'Unknown')}`}
                >
                  {client?.companyName || (isTask ? event.raw?.title : 'Anytime')}
                </div>
              );
            })}
            {allDayEvents.length > 2 && (
              <span className="text-[9px] text-muted-foreground">+{allDayEvents.length - 2}</span>
            )}
          </div>
        )}
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

        {/* Events — now draggable + resizable */}
        {timedEvents.map((event) => {
          const client = findClientByEvent(clients, event);
          if (!client) return null;
          const isSaving = savingJobIds?.has(event.assignmentId) || event.raw?._saving;
          const color = getTechnicianColor(event.raw);

          return (
            <DraggableEventBlock
              key={event.assignmentId}
              event={event}
              client={client}
              techColor={color}
              onClick={() => handleClientClick(client, event)}
              isSaving={!!isSaving}
              timeFormat={timeFormat}
              onResize={handleResize}
              onUnschedule={onUnschedule}
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
  handleResize,
  savingJobIds,
  onUnschedule,
  regional,
  businessHours,
  techSummaryMap,
  riskFirstSort,
  alertsOnly,
}: CalendarGridDayRowsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dateKey = format(currentDate, "yyyy-MM-dd");
  const dayEvents = eventIndexes.eventsByDateKey.get(dateKey) || [];

  // Filter visible technicians (with risk sort + alerts filter — Calendar Improvement 2026-03-05)
  const visibleTechnicians = useMemo(() => {
    let filtered = technicians.filter(t => !hiddenTechnicianIds.has(t.id));
    if (alertsOnly && techSummaryMap) {
      filtered = filtered.filter(t => {
        const s = techSummaryMap.get(t.id);
        return s && s.risk !== "ok";
      });
    }
    if (riskFirstSort && techSummaryMap) {
      const riskOrder: Record<string, number> = { high: 0, warn: 1, ok: 2 };
      filtered = [...filtered].sort((a, b) => {
        const ra = techSummaryMap.get(a.id)?.risk ?? "ok";
        const rb = techSummaryMap.get(b.id)?.risk ?? "ok";
        return (riskOrder[ra] ?? 2) - (riskOrder[rb] ?? 2);
      });
    }
    return filtered;
  }, [technicians, hiddenTechnicianIds, techSummaryMap, riskFirstSort, alertsOnly]);
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
            handleResize={handleResize}
            savingJobIds={savingJobIds}
            onUnschedule={onUnschedule}
            timeFormat={regional.timeFormat}
          />
        )}

        {/* Technician rows */}
        {visibleTechnicians.map((tech) => {
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
              handleResize={handleResize}
              savingJobIds={savingJobIds}
              onUnschedule={onUnschedule}
              timeFormat={regional.timeFormat}
              techSummary={techSummaryMap?.get(tech.id)}
            />
          );
        })}
      </div>
    </div>
  );
}
