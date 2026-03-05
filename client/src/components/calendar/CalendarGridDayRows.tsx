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
  TechnicianColor,
} from "./calendarUtils";
import { JobCard } from "./JobCard";
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
const ALLDAY_COL_WIDTH = 80; // px for all-day lane column
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

  // 2026-03-05: Use explicit pixel height instead of h-full to guarantee non-zero
  // bounding rect for dnd-kit collision detection (h-full through nested absolute
  // parents can resolve to 0).
  return (
    <div
      ref={setNodeRef}
      className={`absolute top-0 pointer-events-none ${isOver ? 'bg-primary/20 border border-primary z-50' : 'z-10'}`}
      style={{
        width: '25%',
        left: `${(minute / 60) * 100}%`,
        height: ROW_HEIGHT,
      }}
    />
  );
}

// ============================================================================
// RowAllDayDropZone — droppable all-day lane per technician in row layout
// ============================================================================

function RowAllDayDropZone({ technicianId, dateKey, children }: {
  technicianId: string;
  dateKey: string;
  children: React.ReactNode;
}) {
  // Same ID format as DayJobber AllDayDropZone for DnD handler compatibility
  const id = `allday|${technicianId}|${dateKey}`;
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`h-full flex flex-col gap-0.5 ${isOver ? 'bg-primary/20 border border-primary rounded' : ''}`}
    >
      {children}
    </div>
  );
}

// ============================================================================
// DraggableAllDayChip — draggable all-day/anytime item in row layout
// 2026-03-05: Enables drag from all-day lane to timed slots and vice versa
// ============================================================================

function DraggableAllDayChip({ event, client, onClick, isSaving, isTask }: {
  event: CalendarEvent;
  client: any;
  onClick: () => void;
  isSaving: boolean;
  isTask: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: event.assignmentId,
    disabled: isSaving || !!event.completed || isTask,
    data: { type: "assignment", assignmentId: event.assignmentId, client, event: event.raw },
  });

  // Click-after-drag suppression (2026-03-05: fixes modal opening after drag)
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

  const dragStyle = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined;

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...(isSaving ? {} : listeners)}
      className={`text-[9px] px-1 rounded truncate cursor-grab active:cursor-grabbing select-none ${
        isDragging ? 'opacity-50 z-50 shadow-lg' : ''
      } ${
        isTask ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
          : 'bg-primary/10 text-primary'
      }`}
      style={dragStyle}
      onClick={(e) => {
        e.stopPropagation();
        // Suppress click that fires immediately after drag end
        if (isDragging || Date.now() - lastDragEndedAtRef.current < 300) return;
        onClick();
      }}
      title={`Anytime: ${client?.companyName || (isTask ? event.raw?.title : 'Unknown')}`}
    >
      {client?.companyName || (isTask ? event.raw?.title : 'Anytime')}
    </div>
  );
}

// ============================================================================
// DraggableEventBlock — horizontal event with drag + resize
// ============================================================================

function DraggableEventBlock({ event, client, techColor, onClick, isSaving, timeFormat, onResize, onUnschedule, technicians }: {
  event: CalendarEvent;
  client: any;
  techColor: TechnicianColor | null;
  onClick: () => void;
  isSaving: boolean;
  timeFormat: "12h" | "24h";
  onResize?: (assignmentId: string, newDurationMinutes: number, assignment?: any) => void;
  onUnschedule?: (assignmentId: string, version: number) => void;
  technicians?: any[];
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

  // Suppress click after drag release (pointer-up fires click synchronously)
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

  // Horizontal resize state with rAF throttle for smooth performance
  const [isResizing, setIsResizing] = useState(false);
  const [tempDuration, setTempDuration] = useState<number | null>(null);
  const resizeRef = useRef<{ x: number; duration: number } | null>(null);
  const pendingDurationRef = useRef<number | null>(null);
  const rafIdRef = useRef<number>(0);
  const lastResizeEndedAtRef = useRef<number>(0);

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
    const newDuration = Math.max(15, Math.min(maxDuration, resizeRef.current.duration + snapped));
    // rAF throttle: flush state update once per frame for smooth resize
    pendingDurationRef.current = newDuration;
    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(() => {
        if (pendingDurationRef.current !== null) {
          setTempDuration(pendingDurationRef.current);
        }
        rafIdRef.current = 0;
      });
    }
  }, [isResizing, startMinutes]);

  const handleResizeEnd = useCallback((e: React.PointerEvent) => {
    if (!isResizing) return;
    // Flush pending rAF before processing final duration
    if (rafIdRef.current) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = 0; }
    if (pendingDurationRef.current !== null) {
      setTempDuration(pendingDurationRef.current);
      pendingDurationRef.current = null;
    }
    setIsResizing(false);
    lastResizeEndedAtRef.current = Date.now();
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    if (tempDuration !== null && tempDuration !== originalDuration && onResize) {
      onResize(event.assignmentId, tempDuration, event.raw);
    }
    setTempDuration(null);
    resizeRef.current = null;
  }, [isResizing, tempDuration, originalDuration, onResize, event.assignmentId, event.raw]);

  // Cancel pending rAF on unmount
  useEffect(() => {
    return () => { if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current); };
  }, []);

  const displayDuration = tempDuration ?? originalDuration;
  const left = (startMinutes / 60) * HOUR_WIDTH;
  const width = Math.max((displayDuration / 60) * HOUR_WIDTH - 2, 30);
  const cardHeight = ROW_HEIGHT - 10;

  const dragStyle = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined;

  return (
    <div
      ref={setDragRef}
      {...attributes}
      {...(isResizing ? {} : listeners)}
      className={`absolute top-1 select-none ${isResizing ? 'transition-none' : ''} ${isDragging ? 'opacity-70 z-50 shadow-lg' : 'z-30'}`}
      style={{ left, width, height: cardHeight, ...dragStyle }}
      onClick={(e) => {
        if (isDragging || isResizing) return;
        if (Date.now() - lastDragEndedAtRef.current < 250) return;
        if (Date.now() - lastResizeEndedAtRef.current < 250) return;
        e.stopPropagation();
        onClick();
      }}
    >
      {/* Use shared JobCard for consistent visuals across all calendar views */}
      <JobCard
        id={event.assignmentId}
        client={isTask ? { ...client, companyName: event.raw?.title || "Task" } : client}
        assignment={event.raw}
        inCalendar
        onClick={onClick}
        onUnschedule={isTask ? undefined : onUnschedule}
        isCompleted={!!isCompleted}
        isOverdue={isOverdue}
        isSaving={isSaving}
        technicianColor={techColor || undefined}
        cardHeight={cardHeight}
        technicians={technicians}
        timeFormat={timeFormat}
        itemKind={isTask ? "task" : "visit"}
      />

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
      {/* Tech label — sticky left */}
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
      </div>

      {/* All-day cell — sticky left after tech label, droppable for all-day/anytime items */}
      <div
        className="sticky z-20 bg-muted/10 border-r shrink-0 flex flex-col justify-center p-1 overflow-hidden"
        style={{ left: TECH_LABEL_WIDTH, width: ALLDAY_COL_WIDTH }}
      >
        <RowAllDayDropZone technicianId={technicianId} dateKey={format(currentDate, "yyyy-MM-dd")}>
          {/* 2026-03-05: All-day items now use DraggableAllDayChip for DnD between lanes */}
          {allDayEvents.slice(0, 2).map(event => {
            const client = findClientByEvent(clients, event);
            const isTask = (event as any).kind === "task";
            const isSaving = savingJobIds?.has(event.assignmentId) || event.raw?._saving;
            return (
              <DraggableAllDayChip
                key={event.assignmentId}
                event={event}
                client={client}
                onClick={() => handleClientClick(client, event)}
                isSaving={!!isSaving}
                isTask={isTask}
              />
            );
          })}
          {allDayEvents.length > 2 && (
            <span className="text-[9px] text-muted-foreground">+{allDayEvents.length - 2}</span>
          )}
        </RowAllDayDropZone>
      </div>

      {/* Timeline area — explicit height ensures absolute children have non-zero bounds for dnd-kit (2026-03-05) */}
      <div className="relative flex-1" style={{ minWidth: HOURS_IN_DAY * HOUR_WIDTH, height: ROW_HEIGHT }}>
        {/* Hour grid lines */}
        {Array.from({ length: HOURS_IN_DAY }, (_, hour) => (
          <div
            key={hour}
            className="absolute top-0 border-r border-dashed border-muted/40"
            style={{ left: hour * HOUR_WIDTH, width: HOUR_WIDTH, height: ROW_HEIGHT }}
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
              technicians={technicians}
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

  // 2026-03-05: Pre-compute events-by-tech Map for stable references.
  // Replaces plain filter function that created new arrays on every render,
  // defeating MemoizedTechRow memo.
  const eventsByTech = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    map.set("__unassigned__", []);
    for (const e of dayEvents) {
      const ids: string[] = e.technicianIds || (e.technicianId ? [e.technicianId] : []);
      if (ids.length === 0) {
        map.get("__unassigned__")!.push(e);
      } else {
        for (const tid of ids) {
          if (!map.has(tid)) map.set(tid, []);
          map.get(tid)!.push(e);
        }
      }
    }
    return map;
  }, [dayEvents]);

  const getEventsForTech = (techId: string | null): CalendarEvent[] =>
    eventsByTech.get(techId ?? "__unassigned__") || [];

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
    <div className="flex flex-col flex-1 min-h-0">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto bg-muted/5">
        {/* Time header row — sticky top */}
        <div className="sticky top-0 z-30 flex bg-background border-b">
          <div
            className="sticky left-0 z-40 bg-background border-r shrink-0"
            style={{ width: TECH_LABEL_WIDTH, height: HEADER_HEIGHT }}
          />
          {/* All-day header — sticky left after tech label */}
          <div
            className="sticky z-[35] bg-muted/30 border-r shrink-0 flex items-end justify-center pb-1 text-[10px] font-semibold text-muted-foreground"
            style={{ left: TECH_LABEL_WIDTH, width: ALLDAY_COL_WIDTH, height: HEADER_HEIGHT }}
          >
            All Day
          </div>
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
