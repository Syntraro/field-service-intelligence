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
  isAllDayEvent,
  getEventOverdue,
  getEventColor,
  getEventClient,
  getEventCapabilities,
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
  /** Empty-slot click handler for quick-create (2026-03-06) */
  onEmptySlotClick?: (data: { date: Date; hour: number; minute: number; technicianId?: string }) => void;
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
  /** Fix 1: Ref callback for measuring sticky header height */
  stickyHeaderRef?: (node: HTMLDivElement | null) => void;
  /** Fix 1: Uniform header height (max across all columns) applied as minHeight */
  uniformHeaderPx?: number;
  /** Empty-slot click handler for quick-create (2026-03-06) */
  onEmptySlotClick?: (data: { date: Date; hour: number; minute: number; technicianId?: string }) => void;
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
  uniformHeaderPx,
  onEmptySlotClick,
}: TechColumnProps) {
  const rowHeight = DENSITY_STYLES[density].rowHeight;

  return (
    <div className="flex flex-col border-r flex-shrink-0" style={{ minWidth: MIN_TECH_COLUMN_WIDTH }}>
      {/* 2026-03-05: Merged header + all-day strip into a single sticky header.
          Removes the old sticky all-day lane that overlapped timed grid drop zones,
          eliminating the source of timed<->all-day DnD collision ambiguity. */}
      <div
        ref={stickyHeaderRef}
        className="sticky top-0 z-30 bg-background border-b px-2 py-1.5 flex flex-col items-center justify-start"
        style={{ minHeight: uniformHeaderPx ?? HEADER_HEIGHT }}
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
              const caps = getEventCapabilities(event);
              return client ? (
                <DraggableAllDayCard
                  key={event.assignmentId}
                  event={event}
                  client={client}
                  isSaving={!!isSaving}
                  isTask={event.kind === "task"}
                  assignmentId={event.assignmentId}
                  raw={event.raw}
                >
                  <JobCard
                    id={event.assignmentId}
                    client={getEventClient(event, client)}
                    assignment={event.raw}
                    inCalendar
                    onClick={() => handleClientClick(client, event)}
                    onReschedule={caps.reschedulable ? () => handleClientClick(client, event, true) : undefined}
                    onUnschedule={caps.removable ? onUnschedule : undefined}
                    isCompleted={event.completed}
                    isOverdue={getEventOverdue(event)}
                    isSaving={isSaving}
                    technicianColor={getEventColor(event, getTechnicianColor)}
                    densityStyle={DENSITY_STYLES[density].card}
                    technicians={technicians}
                    timeFormat={timeFormat}
                    itemKind={event.kind}
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
              onClick={(e) => {
                // Empty-slot click for quick-create (2026-03-06)
                if (!onEmptySlotClick) return;
                const target = e.target as HTMLElement;
                if (target.closest('[data-testid^="assigned-client-"]') || target.closest('[data-testid^="resize-handle-"]')) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const yRatio = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
                const minute = Math.floor(yRatio * 4) * 15;
                onEmptySlotClick({ date: currentDate, hour, minute, technicianId });
              }}
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
                const caps = getEventCapabilities(event);

                return (
                  <ResizableJobCard
                    key={event.assignmentId}
                    assignment={event.raw}
                    client={getEventClient(event, client)}
                    rowHeight={rowHeight}
                    onResize={caps.resizable ? handleResize : () => {}}
                    getTechnicianColor={getTechnicianColor}
                    densityStyle={DENSITY_STYLES[density].card}
                    onClick={() => handleClientClick(client, event)}
                    onReschedule={caps.reschedulable ? () => handleClientClick(client, event, true) : undefined}
                    isCompleted={event.completed}
                    isOverdue={getEventOverdue(event)}
                    laneIndex={lane.laneIndex}
                    totalLanes={lane.totalLanes}
                    isSaving={isSaving}
                    technicians={technicians}
                    onUnschedule={caps.removable ? onUnschedule : undefined}
                    timeFormat={timeFormat}
                    itemKind={event.kind}
                    draggable={caps.draggable}
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
  /** Business hours bounds for off-hours shading (2026-03-06) */
  businessOpen?: boolean;
  businessStartMinutes?: number | null;
  businessEndMinutes?: number | null;
}

function TimeRail({ density, timeFormat, startHour, headerHeight, businessOpen = true, businessStartMinutes, businessEndMinutes }: TimeRailProps) {
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

      {/* Hour labels — off-hours shading matches tech columns (2026-03-06) */}
      {Array.from({ length: HOURS_IN_DAY }, (_, hour) => {
        const hourStart = hour * 60;
        const hourEnd = (hour + 1) * 60;
        const isOffHours = !businessOpen ||
          (businessStartMinutes != null && businessEndMinutes != null &&
            (hourEnd <= businessStartMinutes || hourStart >= businessEndMinutes));
        return (
        <div
          key={hour}
          className={`border-b flex items-center justify-center text-[10px] font-medium ${
            hour === startHour ? 'bg-primary/30 font-bold'
            : isOffHours ? 'bg-slate-200/50 dark:bg-slate-800/40 text-muted-foreground/60'
            : 'bg-muted/20'
          }`}
          style={{ height: rowHeight }}
        >
          {formatHourLabel(hour, timeFormat)}
        </div>
        );
      })}
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
  onEmptySlotClick,
}: CalendarGridDayJobberProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollDoneRef = useRef(false);

  // Fix 1: Uniform header height across ALL tech columns.
  // Each column's sticky header can vary (all-day events, TechLaneHeader badges).
  // We measure every column header and enforce the MAX height as minHeight on all,
  // so the timed grid starts at the same Y offset everywhere — fixing droppable rect misalignment.
  const [uniformHeaderPx, setUniformHeaderPx] = useState(HEADER_HEIGHT);
  const headerNodesRef = useRef(new Map<string, HTMLDivElement>());
  const headerHeightsRef = useRef(new Map<string, number>());
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // Single shared ResizeObserver for all column headers
  if (!resizeObserverRef.current) {
    resizeObserverRef.current = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const el = entry.target as HTMLDivElement;
        const key = el.dataset.techKey;
        if (!key) continue;
        const h = Math.round(el.scrollHeight);
        if (h > 0 && headerHeightsRef.current.get(key) !== h) {
          headerHeightsRef.current.set(key, h);
          changed = true;
        }
      }
      if (changed) {
        let max = HEADER_HEIGHT;
        headerHeightsRef.current.forEach((h) => { if (h > max) max = h; });
        setUniformHeaderPx((prev) => prev === max ? prev : max);
      }
    });
  }

  // Callback ref factory: registers each column header for measurement.
  // Cached per techKey to avoid breaking MemoizedTechColumn memo.
  const headerRefCacheRef = useRef(new Map<string, (node: HTMLDivElement | null) => void>());
  const makeHeaderRef = useCallback((techKey: string) => {
    const cache = headerRefCacheRef.current;
    if (cache.has(techKey)) return cache.get(techKey)!;
    const refCallback = (node: HTMLDivElement | null) => {
      const observer = resizeObserverRef.current;
      if (!observer) return;
      const prev = headerNodesRef.current.get(techKey);
      if (prev && prev !== node) {
        observer.unobserve(prev);
        headerNodesRef.current.delete(techKey);
        headerHeightsRef.current.delete(techKey);
      }
      if (node) {
        node.dataset.techKey = techKey;
        headerNodesRef.current.set(techKey, node);
        const h = Math.round(node.scrollHeight);
        if (h > 0) headerHeightsRef.current.set(techKey, h);
        observer.observe(node);
      }
      // Recompute max
      let max = HEADER_HEIGHT;
      headerHeightsRef.current.forEach((h) => { if (h > max) max = h; });
      setUniformHeaderPx((prev) => prev === max ? prev : max);
    };
    cache.set(techKey, refCallback);
    return refCallback;
  }, []);

  // Cleanup observer on unmount
  useEffect(() => {
    return () => { resizeObserverRef.current?.disconnect(); };
  }, []);

  // Phase C + Phase 2: Debug layout instrumentation — gated behind ?debugLayout=1
  useLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("debugLayout") !== "1") return;
    const el = scrollContainerRef.current;
    if (!el) return;

    // Helper: snapshot a DOM node's layout metrics
    const snap = (node: HTMLElement, label: string) => {
      const r = node.getBoundingClientRect();
      const cs = getComputedStyle(node);
      return {
        label,
        tag: node.tagName,
        className: node.className?.slice(0, 80),
        rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), width: Math.round(r.width) },
        overflowX: cs.overflowX,
        overflowY: cs.overflowY,
        computedHeight: cs.height,
        computedMaxHeight: cs.maxHeight,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
      };
    };

    // Walk ancestor chain up to h-screen root (max 10 levels)
    const chain: ReturnType<typeof snap>[] = [];
    let cursor: HTMLElement | null = el;
    let depth = 0;
    while (cursor && depth < 10) {
      chain.push(snap(cursor, depth === 0 ? "scrollContainer" : `ancestor-${depth}`));
      if (cursor.classList.contains("h-screen")) break;
      cursor = cursor.parentElement;
      depth++;
    }

    // Per-column header height audit (Task D)
    const columnHeaders = el.querySelectorAll<HTMLElement>('[class*="sticky"][class*="top-0"][class*="z-30"]');
    const headerHeights: { idx: number; offsetHeight: number; top: number; bottom: number }[] = [];
    columnHeaders.forEach((hdr, idx) => {
      const hr = hdr.getBoundingClientRect();
      headerHeights.push({ idx, offsetHeight: hdr.offsetHeight, top: Math.round(hr.top), bottom: Math.round(hr.bottom) });
    });

    // Droppable rect spot-check: pick hour 8 across ALL tech columns to prove alignment
    const techColumns = el.querySelectorAll<HTMLElement>(':scope .flex > .flex.flex-col.border-r');
    const droppableAlignmentCheck: { colIdx: number; techKey: string; hour8Top: number; hour8Bottom: number }[] = [];
    techColumns.forEach((col, colIdx) => {
      const techKey = col.querySelector<HTMLElement>('[data-tech-key]')?.dataset.techKey ?? `col-${colIdx}`;
      const hourSlots = col.querySelectorAll<HTMLElement>(':scope > div:last-child > div.relative.border-b');
      if (hourSlots[8]) {
        const hr = hourSlots[8].getBoundingClientRect();
        droppableAlignmentCheck.push({ colIdx, techKey, hour8Top: Math.round(hr.top), hour8Bottom: Math.round(hr.bottom) });
      }
    });

    // Compute max spread of hour-8 rect.top across columns (should be 0-2px with fix)
    const hour8Tops = droppableAlignmentCheck.map(d => d.hour8Top);
    const hour8TopSpread = hour8Tops.length > 1
      ? Math.max(...hour8Tops) - Math.min(...hour8Tops)
      : 0;

    console.log("[debugLayout] DayJobber FULL CHAIN:", {
      windowInnerHeight: window.innerHeight,
      windowInnerWidth: window.innerWidth,
      chain,
      uniformHeaderPx,
      perColumnHeaders: headerHeights,
      headerHeightVariance: headerHeights.length > 1
        ? Math.max(...headerHeights.map(h => h.offsetHeight)) - Math.min(...headerHeights.map(h => h.offsetHeight))
        : 0,
      droppableAlignmentCheck,
      hour8TopSpread,
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

      // Fix 1: Use uniform header height (max across all columns) for scroll offset
      const scrollPosition = (scrollToMinutes / 60) * rowHeight + uniformHeaderPx;

      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollPosition;
          scrollDoneRef.current = true;
        }
      });
    }
  }, [todayBusinessHours, density, dateKey, businessHours, uniformHeaderPx]);

  // Current time indicator position
  const now = nowInTimezone(regional.timezone);
  const isToday = now.toDateString() === currentDate.toDateString();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const rowHeight = DENSITY_STYLES[density].rowHeight;
  const pxPerMinute = rowHeight / 60;
  // Fix 1: Use uniform header height for now-line positioning
  const nowLineTop = uniformHeaderPx + currentMinutes * pxPerMinute;

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
              headerHeight={uniformHeaderPx}
              businessOpen={todayBusinessHours.isOpen}
              businessStartMinutes={todayBusinessHours.startMinutes}
              businessEndMinutes={todayBusinessHours.endMinutes}
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
                stickyHeaderRef={makeHeaderRef("unassigned")}
                uniformHeaderPx={uniformHeaderPx}
                onEmptySlotClick={onEmptySlotClick}
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
                stickyHeaderRef={makeHeaderRef(tech.id)}
                uniformHeaderPx={uniformHeaderPx}
                onEmptySlotClick={onEmptySlotClick}
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
