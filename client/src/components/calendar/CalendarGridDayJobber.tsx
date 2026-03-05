/**
 * CalendarGridDayJobber.tsx
 *
 * Jobber-style day grid view with:
 * - Technician columns (Unassigned + each visible tech)
 * - 24-hour time rail on the left
 * - All-day/Anytime lane under header
 * - Timed jobs as blocks positioned by minutes-from-midnight
 * - Business hours grey-out (visual only)
 * - 15-minute drop zones for drag/drop
 *
 * Created 2026-01-28: Replaces old CalendarGridDay with proper Jobber-style grid layout.
 * Key changes:
 * - Events positioned absolutely by minutesFromMidnight (not grouped by hour)
 * - All-day droppable IDs use '|' delimiter: allday|{techId}|{YYYY-MM-DD}
 * - Tech columns span full day height for proper absolute positioning
 */
import { memo, useMemo, useRef, useEffect, useLayoutEffect, useState, useCallback } from "react";
import { format } from "date-fns";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import { JobCard } from "./JobCard";
import { ResizableJobCard } from "./ResizableJobCard";
import { TechLaneHeader } from "./TechLaneHeader";
import type { TechDaySummary } from "@/hooks/useCalendarDaySummary";
import {
  TECHNICIAN_COLORS,
  DENSITY_STYLES,
  CalendarDensity,
  CalendarEvent,
  getTechnicianColorForAssignment,
  calculateLanes,
  isCalendarEventOverdue,
  isAllDayEvent,
} from "./calendarUtils";
import type { RegionalSettings } from "@/hooks/useCompanyRegionalSettings";
import { formatHourLabel, nowInTimezone } from "@/hooks/useCompanyRegionalSettings";
import { findClientByEvent } from "./calendarClientLookup";

// ============================================================================
// Business Hours Types (shared with parent)
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

export interface CalendarGridDayJobberProps {
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
// Constants
// ============================================================================

/** Number of hours in a day */
const HOURS_IN_DAY = 24;

/** Minimum column width for technician columns (px) */
const MIN_TECH_COLUMN_WIDTH = 140;

/** Time rail width (px) */
const TIME_RAIL_WIDTH = 56;

/** All-day lane height (px) */
const ALLDAY_LANE_HEIGHT = 48;

/** Header height (px) */
const HEADER_HEIGHT = 44;

// ============================================================================
// Drop Zone Components
// ============================================================================

/**
 * All-day drop zone for a technician column.
 * ID format: allday|{techIdOrUnassigned}|{YYYY-MM-DD}
 * Uses '|' delimiter to avoid UUID splitting issues.
 */
function AllDayDropZone({
  technicianId,
  dateKey,
  children,
}: {
  technicianId: string;
  dateKey: string;
  children: React.ReactNode;
}) {
  // Format: allday|{techId}|{YYYY-MM-DD}
  const id = `allday|${technicianId}|${dateKey}`;

  // DEV assertion: verify ID format
  if (process.env.NODE_ENV === 'development') {
    const segments = id.split('|');
    if (segments.length !== 3) {
      console.warn(`AllDay droppable id has unexpected format: ${id} (expected 3 segments)`);
    }
  }

  const { setNodeRef, isOver } = useDroppable({ id });

  // DEV-only: log when all-day drop zone becomes active (2026-01-29)
  if (process.env.NODE_ENV === 'development' && isOver) {
    console.log('[AllDayDropZone] isOver=true:', { id, technicianId, dateKey });
  }

  return (
    <div
      ref={setNodeRef}
      className={`relative h-full p-1 ${isOver ? 'bg-primary/20 border-2 border-primary' : 'bg-background'}`}
    >
      {children}
    </div>
  );
}

/**
 * Quarter-hour (15-min) drop zone for timed slots.
 * ID format: daily|{techIdOrUnassigned}|{hour}|{minute}|{day}|{month0}|{year}
 * Uses '|' delimiter to avoid UUID splitting issues.
 */
function QuarterDropZone({
  technicianId,
  hour,
  minute,
  currentDate,
}: {
  technicianId: string;
  hour: number;
  minute: number;
  currentDate: Date;
}) {
  // Format: daily|{techId}|{HH}|{MM}|{DD}|{month0}|{YYYY}
  const id = `daily|${technicianId}|${hour}|${minute}|${currentDate.getDate()}|${currentDate.getMonth()}|${currentDate.getFullYear()}`;

  // DEV assertion: verify 7 segments
  if (process.env.NODE_ENV === 'development') {
    const segments = id.split('|');
    if (segments.length !== 7) {
      console.warn(`Timed droppable id has unexpected format: ${id} (expected 7 segments, got ${segments.length})`);
    }
  }

  const { setNodeRef, isOver, node } = useDroppable({ id });

  // DEV-only: log when drop zone becomes active (isOver changes) (2026-01-29)
  if (process.env.NODE_ENV === 'development' && isOver) {
    console.log('[QuarterDropZone] isOver=true:', { id, technicianId, hour, minute });
  }

  // 2026-01-29: Use pointer-events-none to allow clicks to pass through to cards beneath.
  // dnd-kit uses getBoundingClientRect for collision detection, not pointer events.
  // The isOver state still works via dnd-kit's internal collision calculation.
  return (
    <div
      ref={setNodeRef}
      className={`absolute w-full pointer-events-none ${isOver ? 'bg-primary/20 border border-primary z-50' : 'z-20'}`}
      style={{
        height: '25%', // 1/4 of hour slot
        top: `${(minute / 60) * 100}%`,
      }}
    />
  );
}

// ============================================================================
// DraggableAllDayCard — wraps JobCard with useDraggable for all-day items
// 2026-03-05: Enables dragging all-day items to timed slots or other columns
// ============================================================================

function DraggableAllDayCard({ event, client, isSaving, isTask, children, assignmentId, raw }: {
  event: CalendarEvent;
  client: any;
  isSaving: boolean;
  isTask: boolean;
  children: React.ReactNode;
  assignmentId: string;
  raw: any;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: assignmentId,
    disabled: isSaving || !!event.completed || isTask,
    data: { type: "assignment", assignmentId, client, event: raw },
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
      className={`select-none ${isDragging ? 'opacity-50 z-50 shadow-lg' : ''}`}
      style={dragStyle}
      onClickCapture={(e) => {
        // Suppress click events that fire immediately after drag end
        if (isDragging || Date.now() - lastDragEndedAtRef.current < 300) {
          e.stopPropagation();
          e.preventDefault();
        }
      }}
    >
      {children}
    </div>
  );
}

// ============================================================================
// Technician Column Component
// ============================================================================

interface TechColumnProps {
  technicianId: string;
  technicianName: string;
  technicianColor: typeof TECHNICIAN_COLORS[0] | null;
  events: CalendarEvent[];
  allDayEvents: CalendarEvent[];
  timedEvents: CalendarEvent[];
  laneMap: Map<string, { laneIndex: number; totalLanes: number }>;
  currentDate: Date;
  dateKey: string;
  density: CalendarDensity;
  clients: any[];
  technicians: any[];
  getTechnicianColor: (assignment: any) => ReturnType<typeof getTechnicianColorForAssignment>;
  handleClientClick: (client: any, event: CalendarEvent, focusSchedule?: boolean) => void;
  handleResize: (assignmentId: string, newDurationMinutes: number, assignment?: any) => void;
  savingJobIds?: Set<string>;
  onUnschedule?: (assignmentId: string, version: number) => void;
  timeFormat: "12h" | "24h";
  businessHoursStart: number | null;
  businessHoursEnd: number | null;
  isBusinessOpen: boolean;
  /** Day summary for this technician (Calendar Improvement 2026-03-05) */
  techSummary?: TechDaySummary;
  /** RC-2: Optional ref callback for measuring sticky header height */
  stickyHeaderRef?: (node: HTMLDivElement | null) => void;
}

function TechColumn({
  technicianId,
  technicianName,
  technicianColor,
  events,
  allDayEvents,
  timedEvents,
  laneMap,
  currentDate,
  dateKey,
  density,
  clients,
  technicians,
  getTechnicianColor,
  handleClientClick,
  handleResize,
  savingJobIds,
  onUnschedule,
  timeFormat,
  businessHoursStart,
  businessHoursEnd,
  isBusinessOpen,
  techSummary,
  stickyHeaderRef,
}: TechColumnProps) {
  const rowHeight = DENSITY_STYLES[density].rowHeight;

  return (
    <div className="flex flex-col border-r flex-shrink-0" style={{ minWidth: MIN_TECH_COLUMN_WIDTH }}>
      {/* 2026-03-05: Merged header + all-day strip into a single sticky header.
          Removes the old sticky all-day lane that overlapped timed grid drop zones,
          eliminating the source of timed<->all-day DnD collision ambiguity. */}
      <div
        ref={stickyHeaderRef}
        className="sticky top-0 z-30 bg-background border-b px-2 py-1.5 flex flex-col items-center"
        style={{ minHeight: HEADER_HEIGHT }}
      >
        <div className="flex items-center justify-center gap-1.5">
          {technicianColor && (
            <div className={`w-2 h-2 rounded-full ${technicianColor.dot}`} />
          )}
          <span className="text-sm font-medium truncate max-w-[100px]">{technicianName}</span>
        </div>
        <TechLaneHeader summary={techSummary} />
        {/* All-day assignment strip — inline in header, droppable */}
        <AllDayDropZone technicianId={technicianId} dateKey={dateKey}>
          <div className="flex flex-wrap gap-1 overflow-hidden w-full max-h-[48px]">
            {allDayEvents.slice(0, 3).map((event) => {
              const client = findClientByEvent(clients, event);
              const isSaving = savingJobIds?.has(event.assignmentId) || event.raw?._saving;
              const isTask = (event as any).kind === "task";
              return client ? (
                <DraggableAllDayCard
                  key={event.assignmentId}
                  event={event}
                  client={client}
                  isSaving={!!isSaving}
                  isTask={isTask}
                  assignmentId={event.assignmentId}
                  raw={event.raw}
                >
                  <JobCard
                    id={event.assignmentId}
                    client={isTask ? { ...client, companyName: event.raw?.title || "Task" } : client}
                    assignment={event.raw}
                    inCalendar
                    onClick={() => handleClientClick(client, event)}
                    onReschedule={isTask ? undefined : () => handleClientClick(client, event, true)}
                    onUnschedule={isTask ? undefined : onUnschedule}
                    isCompleted={event.completed}
                    isOverdue={isTask ? false : isCalendarEventOverdue(event)}
                    isSaving={isSaving}
                    technicianColor={getTechnicianColor(event.raw)}
                    densityStyle={DENSITY_STYLES[density].card}
                    technicians={technicians}
                    timeFormat={timeFormat}
                    itemKind={isTask ? "task" : "visit"}
                  />
                </DraggableAllDayCard>
              ) : null;
            })}
            {allDayEvents.length > 3 && (
              <span className="text-[10px] text-muted-foreground self-center">+{allDayEvents.length - 3} more</span>
            )}
          </div>
        </AllDayDropZone>
      </div>

      {/* Timed grid - hour slots like CalendarGridWeek for proper ResizableJobCard positioning */}
      <div className="flex flex-col">
        {Array.from({ length: HOURS_IN_DAY }, (_, hour) => {
          const hourStartMinutes = hour * 60;
          const hourEndMinutes = (hour + 1) * 60;
          const isOutsideBusinessHours = !isBusinessOpen ||
            (businessHoursStart !== null && businessHoursEnd !== null &&
              (hourEndMinutes <= businessHoursStart || hourStartMinutes >= businessHoursEnd));

          // Events that START in this hour
          const hourEvents = timedEvents.filter(e => {
            const startHour = Math.floor((e.startMinutes ?? 0) / 60);
            return startHour === hour;
          });

          return (
            <div
              key={hour}
              className={`relative border-b ${isOutsideBusinessHours ? 'bg-slate-200/70 dark:bg-slate-800/50' : 'bg-background'}`}
              style={{ minHeight: rowHeight }}
            >
              {/* Quarter-hour drop zones (absolute overlay, 2026-01-29: removed flex to fix bounding rect) */}
              <div className="absolute inset-0 pointer-events-none">
                {[0, 15, 30, 45].map((minute) => (
                  <QuarterDropZone
                    key={minute}
                    technicianId={technicianId}
                    hour={hour}
                    minute={minute}
                    currentDate={currentDate}
                  />
                ))}
              </div>

              {/* Events starting in this hour - ResizableJobCard handles internal positioning */}
              {hourEvents.map((event) => {
                const client = findClientByEvent(clients, event);
                if (!client) return null;

                const lane = laneMap.get(event.assignmentId) || { laneIndex: 0, totalLanes: 1 };
                const isSaving = savingJobIds?.has(event.assignmentId) || event.raw?._saving;

                return (
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
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Memoized TechColumn
const MemoizedTechColumn = memo(TechColumn);

// ============================================================================
// Time Rail Component
// ============================================================================

interface TimeRailProps {
  density: CalendarDensity;
  timeFormat: "12h" | "24h";
  startHour: number;
  /** RC-2: Measured header height from tech columns (keeps TimeRail header in sync) */
  headerHeight?: number;
}

function TimeRail({ density, timeFormat, startHour, headerHeight }: TimeRailProps) {
  const rowHeight = DENSITY_STYLES[density].rowHeight;

  return (
    <div className="flex flex-col border-r bg-muted/20" style={{ width: TIME_RAIL_WIDTH }}>
      {/* RC-2: Use measured header height so TimeRail aligns with tech column grids */}
      <div
        className="sticky top-0 z-30 bg-background border-b flex items-center justify-center text-xs font-medium text-muted-foreground"
        style={{ minHeight: headerHeight ?? HEADER_HEIGHT }}
      >
        Time
      </div>

      {/* Hour labels */}
      {Array.from({ length: HOURS_IN_DAY }, (_, hour) => (
        <div
          key={hour}
          className={`border-b flex items-center justify-center text-[10px] font-medium ${
            hour === startHour ? 'bg-primary/30 font-bold' : 'bg-muted/20'
          }`}
          style={{ height: rowHeight }}
        >
          {formatHourLabel(hour, timeFormat)}
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function CalendarGridDayJobber({
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
  techSummaryMap,
  riskFirstSort,
  alertsOnly,
}: CalendarGridDayJobberProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollDoneRef = useRef(false);
  // RC-2: Measure actual sticky header height dynamically (all-day strip makes it variable)
  const [headerPx, setHeaderPx] = useState(HEADER_HEIGHT);
  const headerObserverRef = useRef<ResizeObserver | null>(null);
  const headerRef = useCallback((node: HTMLDivElement | null) => {
    if (headerObserverRef.current) {
      headerObserverRef.current.disconnect();
      headerObserverRef.current = null;
    }
    if (!node) return;
    const measure = (el: Element) => {
      const h = Math.round((el as HTMLElement).offsetHeight);
      if (h > 0) setHeaderPx((prev) => prev === h ? prev : h);
    };
    measure(node);
    headerObserverRef.current = new ResizeObserver((entries) => {
      for (const entry of entries) measure(entry.target);
    });
    headerObserverRef.current.observe(node);
  }, []);
  useEffect(() => {
    return () => { headerObserverRef.current?.disconnect(); };
  }, []);

  // Phase C: Debug layout instrumentation — gated behind ?debugLayout=1
  useLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("debugLayout") !== "1") return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    console.log("[debugLayout] DayJobber scroll container:", {
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      overflow: getComputedStyle(el).overflow,
      parentRect: el.parentElement?.getBoundingClientRect(),
    });
    el.style.outline = "2px solid red";
    el.style.outlineOffset = "-2px";
  });

  // Visible technicians (filter by visibility, with risk sort + alerts filter — Calendar Improvement 2026-03-05)
  const visibleTechnicians = useMemo(() => {
    let filtered = technicians.filter((t: any) => !hiddenTechnicianIds.has(t.id));
    if (alertsOnly && techSummaryMap) {
      filtered = filtered.filter((t: any) => {
        const s = techSummaryMap.get(t.id);
        return s && s.risk !== "ok";
      });
    }
    if (riskFirstSort && techSummaryMap) {
      const riskOrder: Record<string, number> = { high: 0, warn: 1, ok: 2 };
      filtered = [...filtered].sort((a: any, b: any) => {
        const ra = techSummaryMap.get(a.id)?.risk ?? "ok";
        const rb = techSummaryMap.get(b.id)?.risk ?? "ok";
        return (riskOrder[ra] ?? 2) - (riskOrder[rb] ?? 2);
      });
    }
    return filtered;
  }, [technicians, hiddenTechnicianIds, techSummaryMap, riskFirstSort, alertsOnly]);
  const showUnassigned = !hiddenTechnicianIds.has('unassigned');

  // Build date key for current date
  const dateKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;

  // Get all events for current date
  const dayEvents = (eventIndexes.eventsByDateKey.get(dateKey) || []).filter(e => !e.completed);

  // Get day of week for business hours lookup (0=Sunday)
  const dayOfWeek = currentDate.getDay();

  // Get business hours for current day
  const todayBusinessHours = useMemo(() => {
    if (!businessHours || businessHours.length !== 7) {
      return { isOpen: true, startMinutes: 360, endMinutes: 1020 }; // Default: 6AM-5PM
    }
    const dayHours = businessHours.find(d => d.dayOfWeek === dayOfWeek);
    return dayHours || { isOpen: true, startMinutes: 360, endMinutes: 1020 };
  }, [businessHours, dayOfWeek]);

  // Calendar start hour setting
  const startHour = companySettings?.calendarStartHour ?? 7;

  // Auto-scroll to business hours start on mount and date change
  useEffect(() => {
    scrollDoneRef.current = false;
  }, [dateKey]);

  useEffect(() => {
    if (scrollContainerRef.current && !scrollDoneRef.current && businessHours) {
      const rowHeight = DENSITY_STYLES[density].rowHeight;
      let scrollToMinutes: number;

      if (todayBusinessHours.isOpen && todayBusinessHours.startMinutes !== null) {
        scrollToMinutes = Math.max(0, todayBusinessHours.startMinutes - 30);
      } else {
        scrollToMinutes = 480; // 8 AM default
      }

      // RC-2: Use measured header height (dynamic due to all-day strip) instead of fixed constant
      const scrollPosition = (scrollToMinutes / 60) * rowHeight + headerPx;

      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollPosition;
          scrollDoneRef.current = true;
        }
      });
    }
  }, [todayBusinessHours, density, dateKey, businessHours, headerPx]);

  // Current time indicator position
  const now = nowInTimezone(regional.timezone);
  const isToday = now.toDateString() === currentDate.toDateString();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const rowHeight = DENSITY_STYLES[density].rowHeight;
  const pxPerMinute = rowHeight / 60;
  // RC-2: Use measured header height for now-line (dynamic due to all-day strip in header)
  const nowLineTop = headerPx + currentMinutes * pxPerMinute;

  // DEV badge for business hours
  const devBusinessHoursBadge = useMemo(() => {
    if (process.env.NODE_ENV !== 'development') return null;
    const formatMinutes = (mins: number | null): string => {
      if (mins === null) return '--:--';
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    };
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = dayNames[dayOfWeek];
    if (!todayBusinessHours.isOpen) {
      return `BH: CLOSED (${dayName}) | Date: ${format(currentDate, 'yyyy-MM-dd')} | DOW: ${dayOfWeek}`;
    }
    return `BH: ${formatMinutes(todayBusinessHours.startMinutes)}–${formatMinutes(todayBusinessHours.endMinutes)} (${dayName}) | Date: ${format(currentDate, 'yyyy-MM-dd')} | DOW: ${dayOfWeek}`;
  }, [todayBusinessHours, dayOfWeek, currentDate]);

  // 2026-03-05: Pre-compute events-by-tech Map with stable allDay/timed splits.
  // Previous inline .filter() on every render created new array refs, defeating
  // MemoizedTechColumn memo. Now all arrays are stable between renders.
  interface TechEventSplit { all: CalendarEvent[]; allDay: CalendarEvent[]; timed: CalendarEvent[] }
  const eventsByTech = useMemo(() => {
    const map = new Map<string, TechEventSplit>();
    const ensure = (key: string) => {
      if (!map.has(key)) map.set(key, { all: [], allDay: [], timed: [] });
      return map.get(key)!;
    };
    ensure("__unassigned__");
    for (const e of dayEvents) {
      const isAD = isAllDayEvent(e);
      if (e.technicianIds.length === 0) {
        const bucket = ensure("__unassigned__");
        bucket.all.push(e);
        (isAD ? bucket.allDay : bucket.timed).push(e);
      } else {
        for (const tid of e.technicianIds) {
          const bucket = ensure(tid);
          bucket.all.push(e);
          (isAD ? bucket.allDay : bucket.timed).push(e);
        }
      }
    }
    return map;
  }, [dayEvents]);

  const EMPTY_SPLIT: TechEventSplit = { all: [], allDay: [], timed: [] };
  const getEventsForTech = (techId: string | null): TechEventSplit =>
    eventsByTech.get(techId ?? "__unassigned__") || EMPTY_SPLIT;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* DEV-only business hours badge */}
      {process.env.NODE_ENV === 'development' && devBusinessHoursBadge && (
        <div className="bg-yellow-100 border-b border-yellow-300 px-2 py-1 text-xs font-mono text-yellow-800 shrink-0">
          {devBusinessHoursBadge}
        </div>
      )}

      {/* Main grid with horizontal scroll for many techs */}
      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 max-h-full overflow-auto relative"
      >
        {/* Current time indicator */}
        {isToday && (
          <div
            className="absolute left-0 right-0 z-40 pointer-events-none"
            style={{ top: nowLineTop }}
          >
            <div className="flex items-center">
              <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
              <div className="flex-1 h-[2px] bg-red-500" />
            </div>
          </div>
        )}

        {/* Columns container */}
        <div className="flex">
          {/* Time Rail - sticky left */}
          <div className="sticky left-0 z-40 bg-background">
            <TimeRail
              density={density}
              timeFormat={regional.timeFormat}
              startHour={startHour}
              headerHeight={headerPx}
            />
          </div>

          {/* Unassigned column — uses pre-split stable refs (2026-03-05) */}
          {showUnassigned && (() => {
            const { all: uEvents, allDay: uAllDay, timed: uTimed } = getEventsForTech(null);
            return (
              <MemoizedTechColumn
                technicianId="unassigned"
                technicianName="Unassigned"
                technicianColor={null}
                events={uEvents}
                allDayEvents={uAllDay}
                timedEvents={uTimed}
                laneMap={calculateLanes(uTimed.map(e => e.raw))}
                currentDate={currentDate}
                dateKey={dateKey}
                density={density}
                clients={clients}
                technicians={technicians}
                getTechnicianColor={getTechnicianColor}
                handleClientClick={handleClientClick}
                handleResize={handleResize}
                savingJobIds={savingJobIds}
                onUnschedule={onUnschedule}
                timeFormat={regional.timeFormat}
                businessHoursStart={todayBusinessHours.startMinutes}
                businessHoursEnd={todayBusinessHours.endMinutes}
                isBusinessOpen={todayBusinessHours.isOpen}
                stickyHeaderRef={headerRef}
              />
            );
          })()}

          {/* Technician columns — uses pre-split stable refs (2026-03-05) */}
          {visibleTechnicians.map((tech: any, idx: number) => {
            const { all: techEvents, allDay, timed } = getEventsForTech(tech.id);
            const techColor = TECHNICIAN_COLORS[technicians.findIndex((t: any) => t.id === tech.id) % TECHNICIAN_COLORS.length];
            const displayName = `${tech.firstName || ''} ${tech.lastName?.[0] || ''}`.trim() || tech.fullName || tech.displayName || 'Tech';

            return (
              <MemoizedTechColumn
                key={tech.id}
                technicianId={tech.id}
                technicianName={displayName}
                technicianColor={techColor}
                events={techEvents}
                allDayEvents={allDay}
                timedEvents={timed}
                laneMap={calculateLanes(timed.map(e => e.raw))}
                currentDate={currentDate}
                dateKey={dateKey}
                density={density}
                clients={clients}
                technicians={technicians}
                getTechnicianColor={getTechnicianColor}
                handleClientClick={handleClientClick}
                handleResize={handleResize}
                savingJobIds={savingJobIds}
                onUnschedule={onUnschedule}
                timeFormat={regional.timeFormat}
                businessHoursStart={todayBusinessHours.startMinutes}
                businessHoursEnd={todayBusinessHours.endMinutes}
                isBusinessOpen={todayBusinessHours.isOpen}
                techSummary={techSummaryMap?.get(tech.id)}
                stickyHeaderRef={!showUnassigned && idx === 0 ? headerRef : undefined}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Memoized export
export const MemoizedCalendarGridDayJobber = memo(CalendarGridDayJobber);
