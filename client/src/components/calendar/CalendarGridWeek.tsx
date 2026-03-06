import { memo, useMemo, useLayoutEffect } from "react";
import { useDroppable } from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { JobCard } from "./JobCard";
import { ResizableJobCard } from "./ResizableJobCard";
import {
  DENSITY_STYLES,
  ALLDAY_ROW_HEIGHTS,
  CalendarDensity,
  CalendarEvent,
  getTechnicianColorForAssignment,
  calculateLanes,
  getWeekStart,
  getEventOverdue,
  getEventColor,
  getEventClient,
  getEventCapabilities,
} from "./calendarUtils";
import type { RegionalSettings } from "@/hooks/useCompanyRegionalSettings";
import { formatHourLabel, nowInTimezone } from "@/hooks/useCompanyRegionalSettings";
import { ensureClientsArray, findClientByEvent } from "./calendarClientLookup";

// ============================================================================
// Types
// ============================================================================

export interface CalendarGridWeekProps {
  currentDate: Date;
  density: CalendarDensity;
  companySettings: any;
  clients: any[];
  technicians?: any[];
  eventIndexes: {
    eventsByDateKey: Map<string, CalendarEvent[]>;
  };
  /** Technician IDs to hide — events for hidden techs are filtered out */
  hiddenTechnicianIds: Set<string>;
  expandedAllDaySlots: Set<string>;
  setExpandedAllDaySlots: React.Dispatch<React.SetStateAction<Set<string>>>;
  getTechnicianColor: (assignment: any) => ReturnType<typeof getTechnicianColorForAssignment>;
  handleClientClick: (client: any, event: CalendarEvent, focusSchedule?: boolean) => void;
  handleResize: (assignmentId: string, newDurationMinutes: number, assignment?: any) => void;
  weeklyScrollContainerRef: React.RefObject<HTMLDivElement>;
  /** Optional: hours to render (defaults to 0-23). Pass subset for business hours. */
  visibleHours?: number[];
  /** Whether showing full 24h day */
  showFullDay?: boolean;
  /** Callback to toggle full day view */
  onToggleFullDay?: () => void;
  /** Set of job IDs currently being saved (for visual feedback) */
  savingJobIds?: Set<string>;
  /** Quick action: unschedule */
  onUnschedule?: (assignmentId: string, version: number) => void;
  /** Regional settings (timezone, time format, week start) */
  regional: RegionalSettings;
  /** Empty-slot click handler for quick-create (2026-03-06) */
  onEmptySlotClick?: (data: { date: Date; hour: number; minute: number }) => void;
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
// Drop Zone Components
// ============================================================================

/** Drop zone component for all-day slots in weekly view */
function AllDayDropZone({ dateKey, children }: { dateKey: string; children: React.ReactNode }) {
  // 2026-01-30: Use dateKey (YYYY-MM-DD) as authoritative target date
  // Format: allday|week|YYYY-MM-DD (distinguished from daily view: allday|{techId}|YYYY-MM-DD)
  const { setNodeRef, isOver } = useDroppable({ id: `allday|week|${dateKey}` });

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
  // DEV assertion: weekly timed IDs must be exactly 4 segments (weekly|{YYYY-MM-DD}|{HH}|{MM})
  // 2026-01-30: Updated format to include full date for unambiguous month-boundary handling
  if (process.env.NODE_ENV === 'development' && id.startsWith('weekly|')) {
    const segments = id.split('|');
    if (segments.length !== 4) {
      console.warn(`Timed droppable id has unexpected format: ${id} (expected 4 segments, got ${segments.length})`);
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

/** Drop zone component for hourly slots in weekly view */
function HourlyDropZone({
  dateKey,
  hour,
  dayEvents = [],
  laneMap,
  density,
  clients,
  technicians,
  getTechnicianColor,
  handleResize,
  handleClientClick,
  savingJobIds,
  onUnschedule,
  timeFormat,
  onEmptySlotClick,
  dayDate,
}: {
  dateKey: string; // 2026-01-30: Use full date key (YYYY-MM-DD) for unambiguous targeting
  hour: number;
  dayEvents?: CalendarEvent[];
  laneMap?: Map<string, { laneIndex: number; totalLanes: number }>;
  density: CalendarDensity;
  clients: any[];
  technicians?: any[];
  getTechnicianColor: (assignment: any) => ReturnType<typeof getTechnicianColorForAssignment>;
  handleResize: (assignmentId: string, newDurationMinutes: number, assignment?: any) => void;
  handleClientClick: (client: any, event: CalendarEvent, focusSchedule?: boolean) => void;
  savingJobIds?: Set<string>;
  onUnschedule?: (assignmentId: string, version: number) => void;
  timeFormat?: "12h" | "24h";
  /** Empty-slot click for quick-create (2026-03-06) */
  onEmptySlotClick?: (data: { date: Date; hour: number; minute: number }) => void;
  /** Actual Date object for this day column */
  dayDate?: Date;
}) {
  const rowHeight = DENSITY_STYLES[density].rowHeight;

  // Filter events for this specific hour
  const hourlyEvents = dayEvents.filter((e) => !e.isAllDay && e.scheduledHour === hour);

  return (
    <div
      className={`border-r ${DENSITY_STYLES[density].row} bg-background relative`}
      style={{ minHeight: `${rowHeight}px` }}
      onClick={(e) => {
        // Empty-slot click: only fire if clicking background (not an event card)
        if (!onEmptySlotClick || !dayDate) return;
        if ((e.target as HTMLElement).closest('[data-testid^="assigned-client-"]')) return;
        // Calculate minute offset from click position within the cell
        const rect = e.currentTarget.getBoundingClientRect();
        const yRatio = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        const minute = Math.floor(yRatio * 4) * 15; // snap to 15min
        onEmptySlotClick({ date: dayDate, hour, minute });
      }}
    >
      <div className="absolute inset-0 flex flex-col pointer-events-none">
        {[0, 15, 30, 45].map((m) => (
          // 2026-01-30: Format: weekly|{YYYY-MM-DD}|{hour}|{minute}
          <QuarterDropZone key={m} id={`weekly|${dateKey}|${hour}|${m}`} />
        ))}
      </div>

      {hourlyEvents.map((event) => {
        const client = findClientByEvent(clients, event);
        const lane = laneMap?.get(event.assignmentId) || { laneIndex: 0, totalLanes: 1 };
        const isSaving = savingJobIds?.has(event.assignmentId) || event.raw?._saving;
        const caps = getEventCapabilities(event);
        return client ? (
          <ResizableJobCard
            key={event.assignmentId}
            assignment={event.raw}
            client={getEventClient(event, client)}
            rowHeight={rowHeight}
            onResize={caps.resizable ? handleResize : () => {}}
            getTechnicianColor={(raw: any) => getEventColor(event, getTechnicianColor)}
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
          />
        ) : null;
      })}
    </div>
  );
}

// ============================================================================
// All Day Row Component - Handles dynamic height based on content
// ============================================================================
//
// REFACTORING NOTE (2026-01-26):
// Extracted from CalendarGridWeek to fix overlap issue where all-day events
// would overflow the fixed 84px row height and overlap timed slots below.
// Now calculates height dynamically based on content, with min/max bounds.
// See docs/REFACTORING_LOG.md "All-Day Row Overlap Fix".
// ============================================================================

/** Height per event item in all-day row (in px) */
const ALLDAY_EVENT_HEIGHT = 28;
/** Minimum height for all-day row */
const ALLDAY_MIN_HEIGHT = 64;
/** Maximum visible events before capping (when not expanded) */
const ALLDAY_MAX_VISIBLE = 3;
/** Maximum height for all-day row (prevents excessive scrolling) */
const ALLDAY_MAX_HEIGHT = 200;

interface AllDayRowProps {
  gridCols: string;
  density: CalendarDensity;
  weekDaysData: WeekDayData[];
  expandedAllDaySlots: Set<string>;
  setExpandedAllDaySlots: React.Dispatch<React.SetStateAction<Set<string>>>;
  clients: any[];
  technicians?: any[];
  getTechnicianColor: (assignment: any) => ReturnType<typeof getTechnicianColorForAssignment>;
  handleClientClick: (client: any, event: CalendarEvent, focusSchedule?: boolean) => void;
  savingJobIds?: Set<string>;
  timeFormat?: "12h" | "24h";
  onUnschedule?: (assignmentId: string, version: number) => void;
}

function AllDayRow({
  gridCols,
  density,
  weekDaysData,
  expandedAllDaySlots,
  setExpandedAllDaySlots,
  clients,
  technicians,
  getTechnicianColor,
  handleClientClick,
  savingJobIds,
  timeFormat = "12h",
  onUnschedule,
}: AllDayRowProps) {
  // Calculate max all-day events across all days for this week
  const maxAllDayCount = useMemo(() => {
    return Math.max(
      1,
      ...weekDaysData.map(d => d.dayEvents.filter(e => e.isAllDay).length)
    );
  }, [weekDaysData]);

  // Check if any slot is expanded
  const anyExpanded = useMemo(() => {
    return weekDaysData.some(d => {
      const slotKey = `${d.dayName}-${d.dayNumber}`;
      return expandedAllDaySlots.has(slotKey);
    });
  }, [weekDaysData, expandedAllDaySlots]);

  // Calculate dynamic height:
  // - If collapsed: min(maxAllDayCount, ALLDAY_MAX_VISIBLE) events + button space
  // - If expanded: all events up to ALLDAY_MAX_HEIGHT
  const calculatedHeight = useMemo(() => {
    const visibleCount = anyExpanded
      ? maxAllDayCount
      : Math.min(maxAllDayCount, ALLDAY_MAX_VISIBLE);

    // Add extra space for "show more" button if needed
    const buttonSpace = maxAllDayCount > ALLDAY_MAX_VISIBLE ? 24 : 0;
    const contentHeight = visibleCount * ALLDAY_EVENT_HEIGHT + 16 + buttonSpace; // 16px padding

    return Math.max(ALLDAY_MIN_HEIGHT, Math.min(contentHeight, ALLDAY_MAX_HEIGHT));
  }, [maxAllDayCount, anyExpanded]);

  return (
    <div
      className={`grid ${gridCols} sticky top-[41px] bg-background z-20 border-b transition-all duration-200`}
      style={{ minHeight: calculatedHeight }}
    >
      <div className="px-1.5 py-1 text-[10px] font-semibold border-r bg-primary/10 flex items-start">
        All Day
      </div>
      {weekDaysData.map((dayData) => {
        const allDayEvents = dayData.dayEvents.filter((e) => e.isAllDay);
        const slotKey = `${dayData.dayName}-${dayData.dayNumber}`;
        const isExpanded = expandedAllDaySlots.has(slotKey);
        const visibleEvents = isExpanded ? allDayEvents : allDayEvents.slice(0, ALLDAY_MAX_VISIBLE);
        const hiddenCount = Math.max(0, allDayEvents.length - ALLDAY_MAX_VISIBLE);

        return (
          <AllDayDropZone key={`${dayData.dayName}-allday`} dateKey={dayData.dateKey}>
            <div className="p-1 space-y-1">
              {visibleEvents.map((event) => {
                const client = findClientByEvent(clients, event);
                const isSaving = savingJobIds?.has(event.assignmentId) || event.raw?._saving;
                const caps = getEventCapabilities(event);
                return client ? (
                  <JobCard
                    key={event.assignmentId}
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
              {isExpanded && allDayEvents.length > ALLDAY_MAX_VISIBLE && (
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
  technicians = [],
  eventIndexes,
  hiddenTechnicianIds,
  expandedAllDaySlots,
  setExpandedAllDaySlots,
  getTechnicianColor,
  handleClientClick,
  handleResize,
  weeklyScrollContainerRef,
  visibleHours,
  showFullDay,
  onToggleFullDay,
  savingJobIds,
  onUnschedule,
  regional,
  onEmptySlotClick,
}: CalendarGridWeekProps) {
  // Phase C + Phase 2: Debug layout instrumentation — gated behind ?debugLayout=1
  useLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("debugLayout") !== "1") return;
    const el = weeklyScrollContainerRef?.current;
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

    // Walk ancestor chain up to h-screen root
    const chain: ReturnType<typeof snap>[] = [];
    let cursor: HTMLElement | null = el;
    let depth = 0;
    while (cursor && depth < 10) {
      chain.push(snap(cursor, depth === 0 ? "scrollContainer" : `ancestor-${depth}`));
      if (cursor.classList.contains("h-screen")) break;
      cursor = cursor.parentElement;
      depth++;
    }

    console.log("[debugLayout] Week FULL CHAIN (baseline):", {
      windowInnerHeight: window.innerHeight,
      windowInnerWidth: window.innerWidth,
      chain,
    });

    el.style.outline = "2px solid green";
    el.style.outlineOffset = "-2px";
  });

  // Get week dates based on currentDate, respecting weekStartsOn setting
  const currentWeekStart = getWeekStart(currentDate, regional.weekStartsOn);

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

    // Filter out events assigned to hidden technicians
    if (hiddenTechnicianIds.size > 0) {
      dayEvents = dayEvents.filter((e) => {
        // Keep unassigned events (no technician)
        if (e.technicianIds.length === 0) return true;
        // Keep if at least one assigned tech is visible
        return e.technicianIds.some(id => !hiddenTechnicianIds.has(id));
      });
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
      dayName: (regional.weekStartsOn === "sunday"
        ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])[i],
      laneMap
    });
  }

  // Use visibleHours prop if provided, otherwise default to all 24 hours
  const hoursToRender = visibleHours ?? Array.from({ length: 24 }, (_, i) => i);
  const hours = hoursToRender.map((h) => {
    return { hour: h, display: formatHourLabel(h, regional.timeFormat) };
  });

  const gridCols = "grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]";

  // Calculate current time position for "Now" line (uses company timezone)
  const now = nowInTimezone(regional.timezone);
  const todayIndex = weekDaysData.findIndex(d => d.date.toDateString() === now.toDateString());
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const rowHeight = DENSITY_STYLES[density].rowHeight;
  // Find the index of the current hour within visible hours
  const firstVisibleHour = hoursToRender[0] ?? 0;
  const hourIndexInGrid = currentHour - firstVisibleHour;
  // Only show "Now" line if current hour is within visible range
  const isCurrentHourVisible = hoursToRender.includes(currentHour);
  const currentTimePosition = hourIndexInGrid * rowHeight + (currentMinute / 60) * rowHeight;

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
          const isToday = d.date.toDateString() === now.toDateString();
          return (
            <div key={d.dayName} className="px-1 py-2 text-center border-r">
              <span className={`text-sm font-medium ${isToday ? 'bg-primary text-primary-foreground px-2 py-0.5 rounded-full' : ''}`}>
                {d.dayName} {d.date.getDate()}
              </span>
            </div>
          );
        })}
      </div>

      {/* All Day Slot - Sticky below header, height grows with content to prevent overlap */}
      <AllDayRow
        gridCols={gridCols}
        density={density}
        weekDaysData={weekDaysData}
        expandedAllDaySlots={expandedAllDaySlots}
        setExpandedAllDaySlots={setExpandedAllDaySlots}
        clients={clients}
        technicians={technicians}
        getTechnicianColor={getTechnicianColor}
        handleClientClick={handleClientClick}
        savingJobIds={savingJobIds}
        timeFormat={regional.timeFormat}
        onUnschedule={onUnschedule}
      />

      {/* Hourly Slots - wrapped in relative container for "Now" line */}
      <div className="relative">
        {/* Current time "Now" line indicator - positioned relative to hourly grid */}
        {todayIndex >= 0 && isCurrentHourVisible && (
          <div
            className="absolute z-40 pointer-events-none"
            style={{
              top: `${currentTimePosition}px`,
              left: `calc(3.5rem + ${(todayIndex / 7) * 100}% * (1 - 3.5rem / 100%))`,
              width: `calc((100% - 3.5rem) / 7)`,
            }}
          >
            <div className="flex items-center">
              <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
              <div className="flex-1 h-[2px] bg-red-500" />
            </div>
          </div>
        )}
        {hours.map((h) => (
          <div key={h.hour} className={`grid ${gridCols} border-b`}>
            <div className={`px-1.5 py-1 text-[10px] font-medium border-r flex items-center justify-center ${h.hour === startHour ? 'bg-primary/30 font-bold' : 'bg-muted/20'}`}>
              {h.display}
            </div>
            {weekDaysData.map((dayData) => (
              <MemoizedHourlyDropZone
                key={`${dayData.dayName}-${h.hour}`}
                dateKey={dayData.dateKey}
                hour={h.hour}
                dayEvents={dayData.dayEvents}
                laneMap={dayData.laneMap}
                density={density}
                clients={clients}
                technicians={technicians}
                getTechnicianColor={getTechnicianColor}
                handleResize={handleResize}
                handleClientClick={handleClientClick}
                savingJobIds={savingJobIds}
                onUnschedule={onUnschedule}
                timeFormat={regional.timeFormat}
                onEmptySlotClick={onEmptySlotClick}
                dayDate={dayData.date}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// Memoized version of HourlyDropZone to reduce rerenders during drag
const MemoizedHourlyDropZone = memo(HourlyDropZone);

// Export memoized version of CalendarGridWeek
export const MemoizedCalendarGridWeek = memo(CalendarGridWeek);
