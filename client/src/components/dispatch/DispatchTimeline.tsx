/**
 * DispatchTimeline — the scrollable center panel with hour columns + lane rows.
 * Combines the hour header and all technician lane rows.
 * Supports drag preview rendering and overlap detection display.
 * Outside-window indicators are rendered as a non-scrolling overlay.
 */
import { useRef, useEffect, useMemo, useState, useCallback } from "react";
import type { DispatchVisit, DispatchTask, Technician } from "./dispatchPreviewTypes";
import { CalendarDays } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TIMELINE_HOURS, HOUR_WIDTH_PX, LANE_HEIGHT_PX, DIVIDER_HEIGHT_PX, formatHour, BUSINESS_START_HOUR, TIMELINE_START_HOUR } from "./dispatchPreviewUtils";
import DispatchLaneRow from "./DispatchLaneRow";
import { countItemsBefore, countItemsAfter, EarlyIndicator, LateIndicator } from "./DispatchOutsideWindowIndicators";

/** Fixed-width column for any-time visits, pinned left before the scrollable timeline grid */
const ANY_TIME_COL_WIDTH = 80;

type Props = {
  technicians: Technician[];
  visitsByTech: Map<string, DispatchVisit[]>;
  tasksByTech?: Map<string, DispatchTask[]>;
  savingIds: Set<string>;
  selectedVisitId?: string | null;
  selectedTaskId?: string | null;
  onSelectVisit?: (visit: DispatchVisit) => void;
  onSelectTask?: (task: DispatchTask) => void;
  onUnschedule?: (visit: DispatchVisit) => void;
  onResize?: (visit: DispatchVisit, newEndTime: string) => void;
  onResizeTask?: (task: DispatchTask, newEndTime: string) => void;
  /** Ref exposed so DndContext can compute drop positions relative to timeline scroll */
  timelineScrollRef?: React.RefObject<HTMLDivElement>;
  /** Active drop target tech ID (for drag preview) */
  activeDropTechId?: string | null;
  /** Drag preview node to render in the active drop lane */
  dragPreviewNode?: React.ReactNode;
  /** Whether the current drag position causes an overlap */
  dragHasOverlap?: boolean;
  /** Item 4: Dynamic timeline config for 24h mode */
  timelineHours?: number[];
  timelineStartHour?: number;
  timelineEndHour?: number;
  /** Item 6: Click empty slot handler */
  onEmptySlotClick?: (techId: string, minuteOfDay: number) => void;
  /** Click-to-schedule: preview node factory */
  clickPreviewNode?: React.ReactNode;
  /** Click-to-schedule: which tech lane is being hovered */
  clickHoverTechId?: string | null;
  /** Click-to-schedule: commit handler */
  onClickSchedule?: (techId: string, relativeX: number) => void;
  /** Click-to-schedule: hover handler */
  onClickHover?: (techId: string, relativeX: number) => void;
  /** Click-to-schedule: hover leave handler */
  onClickHoverLeave?: () => void;
  /** Whether click-to-schedule placement is active */
  isPlacementActive?: boolean;
};

/** Goal 2: Strengthened red "now" indicator line — wider stroke, subtle glow for visibility on busy boards */
function NowLine({ hours: tlHours = TIMELINE_HOURS }: { hours?: number[] }) {
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  const tlStartHour = tlHours[0];
  const offset = (h - tlStartHour) * HOUR_WIDTH_PX;
  if (offset < 0 || offset > tlHours.length * HOUR_WIDTH_PX) return null;
  return (
    <div className="pointer-events-none absolute top-0 bottom-0 z-20" style={{ left: offset }}>
      <div className="h-2.5 w-2.5 -translate-x-[5px] rounded-full bg-red-500 shadow-sm shadow-red-300" />
      <div className="w-[2px] -translate-x-[0.5px] bg-red-500" style={{ height: "calc(100% - 10px)" }} />
      {/* Subtle glow band for scanability */}
      <div className="absolute top-2.5 -translate-x-[3px] w-[7px] bg-red-400/10" style={{ height: "calc(100% - 10px)" }} />
    </div>
  );
}

const HEADER_H = 32; // hour header row height

export default function DispatchTimeline({
  technicians, visitsByTech, tasksByTech, savingIds,
  selectedVisitId, selectedTaskId, onSelectVisit, onSelectTask,
  onUnschedule, onResize, onResizeTask, timelineScrollRef,
  activeDropTechId, dragPreviewNode, dragHasOverlap,
  timelineHours: hours = TIMELINE_HOURS,
  timelineStartHour: startHour = TIMELINE_START_HOUR,
  timelineEndHour: endHour,
  onEmptySlotClick,
  clickPreviewNode, clickHoverTechId, onClickSchedule, onClickHover, onClickHoverLeave,
  isPlacementActive,
}: Props) {
  const localRef = useRef<HTMLDivElement>(null);
  const scrollRef = timelineScrollRef ?? localRef;

  // Track scroll position and container height for indicator overlay positioning
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(800);
  const handleScroll = useCallback((e: Event) => {
    const el = e.target as HTMLElement;
    setScrollTop(el.scrollTop);
    setContainerHeight(el.clientHeight);
  }, []);

  useEffect(() => {
    const el = (scrollRef as React.RefObject<HTMLDivElement>).current;
    if (!el) return;
    // Item 3: Auto-scroll to current time on mount, or business hours start if before
    const now = new Date();
    const currentHour = now.getHours();
    // Scroll to whichever is earlier: 1 hour before current time, or business hours start
    const scrollToHour = Math.min(currentHour, BUSINESS_START_HOUR);
    const offset = Math.max(0, (scrollToHour - startHour) * HOUR_WIDTH_PX);
    el.scrollLeft = offset;

    // Dispatcher-polish: capture initial container height for dynamic viewport clipping
    setContainerHeight(el.clientHeight);
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  const totalWidth = hours.length * HOUR_WIDTH_PX;

  // Compute outside-window counts per tech for sticky indicators
  // Account for the off-shift divider row offset when computing vertical position
  const outsideWindowData = useMemo(() => {
    const working = technicians.filter(t => t.isWorking !== false);
    const offShift = technicians.filter(t => t.isWorking === false);
    const hasDivider = offShift.length > 0;

    const result: { techId: string; pixelTop: number; earlyCount: number; lateCount: number }[] = [];
    // Working technicians
    working.forEach((t, i) => {
      const visits = visitsByTech.get(t.id) || [];
      const tasks = tasksByTech?.get(t.id) || [];
      const early = countItemsBefore(visits, tasks);
      const late = countItemsAfter(visits, tasks);
      if (early > 0 || late > 0) {
        result.push({ techId: t.id, pixelTop: i * LANE_HEIGHT_PX, earlyCount: early, lateCount: late });
      }
    });
    // Off-shift technicians (offset by divider)
    offShift.forEach((t, i) => {
      const visits = visitsByTech.get(t.id) || [];
      const tasks = tasksByTech?.get(t.id) || [];
      const early = countItemsBefore(visits, tasks);
      const late = countItemsAfter(visits, tasks);
      if (early > 0 || late > 0) {
        const top = working.length * LANE_HEIGHT_PX + (hasDivider ? DIVIDER_HEIGHT_PX : 0) + i * LANE_HEIGHT_PX;
        result.push({ techId: t.id, pixelTop: top, earlyCount: early, lateCount: late });
      }
    });
    return result;
  }, [technicians, visitsByTech, tasksByTech]);

  return (
    <div className="relative flex-1 overflow-hidden">
      {/* Scrollable content */}
      <div ref={scrollRef as React.RefObject<HTMLDivElement>} className="h-full overflow-x-auto overflow-y-auto bg-white">
        <div className="flex" style={{ minWidth: ANY_TIME_COL_WIDTH + totalWidth }}>
          {/* ── Fixed "Any Time" column — sticky left, scrolls vertically with lanes ── */}
          <div className="sticky left-0 z-20 flex-shrink-0 bg-white border-r border-slate-200" style={{ width: ANY_TIME_COL_WIDTH }}>
            {/* Header cell — matches sidebar h-8 and hour header row */}
            <div className="sticky top-0 z-10 flex items-center justify-center h-8 border-b bg-amber-50/60 text-[10px] font-semibold text-amber-700 uppercase tracking-wide">
              Any Time
            </div>
            {/* Per-tech any-time cells — mirrors sidebar and lane row splitting */}
            {technicians.length > 0 ? (
              (() => {
                const working = technicians.filter(t => t.isWorking !== false);
                const offShift = technicians.filter(t => t.isWorking === false);
                return (
                  <>
                    {working.map((t, i) => (
                      <AnyTimeCell
                        key={t.id}
                        techId={t.id}
                        visits={(visitsByTech.get(t.id) || []).filter(v => v.isAllDay)}
                        savingIds={savingIds}
                        selectedVisitId={selectedVisitId}
                        onSelectVisit={onSelectVisit}
                        isLast={i === working.length - 1 && offShift.length === 0}
                      />
                    ))}
                    {offShift.length > 0 && (
                      <>
                        {/* Off-shift divider — matches sidebar OffShiftDivider and timeline divider height (DIVIDER_HEIGHT_PX) */}
                        <div className="flex items-center border-b bg-slate-50/80" style={{ height: DIVIDER_HEIGHT_PX }}>
                          <div className="flex-1 h-px bg-slate-200 mx-1" />
                        </div>
                        {offShift.map((t, i) => (
                          <AnyTimeCell
                            key={t.id}
                            techId={t.id}
                            visits={(visitsByTech.get(t.id) || []).filter(v => v.isAllDay)}
                            savingIds={savingIds}
                            selectedVisitId={selectedVisitId}
                            onSelectVisit={onSelectVisit}
                            isLast={i === offShift.length - 1}
                          />
                        ))}
                      </>
                    )}
                  </>
                );
              })()
            ) : (
              <div style={{ height: LANE_HEIGHT_PX }} />
            )}
          </div>

          {/* ── Timeline grid (hour columns + lanes) ── */}
          <div style={{ minWidth: totalWidth }}>
            {/* Hour header row */}
            <div className="sticky top-0 z-10 flex h-8 border-b bg-slate-50">
              {hours.map(h => (
                <div key={h} className="flex items-center border-r px-2 text-[11px] font-medium text-muted-foreground"
                  style={{ width: HOUR_WIDTH_PX }}>
                  {formatHour(h)}
                </div>
              ))}
            </div>

            {/* Lanes — split into working and off-shift groups */}
            <div className="relative">
              <NowLine hours={hours} />
              {technicians.length > 0 ? (
                (() => {
                  const working = technicians.filter(t => t.isWorking !== false);
                  const offShift = technicians.filter(t => t.isWorking === false);
                  return (
                    <>
                      {working.map((t, i) => (
                        <DispatchLaneRow
                          key={t.id}
                          tech={t}
                          visits={visitsByTech.get(t.id) || []}
                          tasks={tasksByTech?.get(t.id) || []}
                          isLast={i === working.length - 1 && offShift.length === 0}
                          savingIds={savingIds}
                          selectedVisitId={selectedVisitId}
                          selectedTaskId={selectedTaskId}
                          onSelectVisit={onSelectVisit}
                          onSelectTask={onSelectTask}
                          onUnschedule={onUnschedule}
                          onResize={onResize}
                          onResizeTask={onResizeTask}
                          dragPreview={activeDropTechId === t.id ? dragPreviewNode : undefined}
                          hasOverlap={activeDropTechId === t.id ? dragHasOverlap : false}
                          timelineHours={hours}
                          timelineStartHour={startHour}
                          timelineEndHour={endHour}
                          onEmptySlotClick={onEmptySlotClick}
                          clickPreview={clickHoverTechId === t.id ? clickPreviewNode : undefined}
                          isClickHoverTarget={clickHoverTechId === t.id}
                          onClickSchedule={onClickSchedule}
                          onClickHover={onClickHover}
                          onClickHoverLeave={onClickHoverLeave}
                          isPlacementActive={isPlacementActive}
                        />
                      ))}
                      {offShift.length > 0 && (
                        <>
                          {/* Off-shift divider aligned with sidebar — explicit shared height */}
                          <div className="flex items-center border-b bg-slate-50/80 px-3" style={{ width: totalWidth, height: DIVIDER_HEIGHT_PX }}>
                            <div className="flex-1 h-px bg-slate-200" />
                            <span className="text-[9px] font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap mx-2">Off shift</span>
                            <div className="flex-1 h-px bg-slate-200" />
                          </div>
                          {offShift.map((t, i) => (
                            <DispatchLaneRow
                              key={t.id}
                              tech={t}
                              visits={visitsByTech.get(t.id) || []}
                              tasks={tasksByTech?.get(t.id) || []}
                              isLast={i === offShift.length - 1}
                              savingIds={savingIds}
                              selectedVisitId={selectedVisitId}
                              selectedTaskId={selectedTaskId}
                              onSelectVisit={onSelectVisit}
                              onSelectTask={onSelectTask}
                              onUnschedule={onUnschedule}
                              onResize={onResize}
                              onResizeTask={onResizeTask}
                              dragPreview={activeDropTechId === t.id ? dragPreviewNode : undefined}
                              hasOverlap={activeDropTechId === t.id ? dragHasOverlap : false}
                              timelineHours={hours}
                              timelineStartHour={startHour}
                              timelineEndHour={endHour}
                              onEmptySlotClick={onEmptySlotClick}
                              clickPreview={clickHoverTechId === t.id ? clickPreviewNode : undefined}
                              isClickHoverTarget={clickHoverTechId === t.id}
                              onClickSchedule={onClickSchedule}
                              onClickHover={onClickHover}
                              onClickHoverLeave={onClickHoverLeave}
                              isPlacementActive={isPlacementActive}
                            />
                          ))}
                        </>
                      )}
                    </>
                  );
                })()
              ) : (
                <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                  No schedulable technicians found
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Non-scrolling outside-window indicator overlay */}
      {outsideWindowData.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
          {outsideWindowData.map(({ techId, pixelTop, earlyCount, lateCount }) => {
            const topOffset = HEADER_H + pixelTop + (LANE_HEIGHT_PX - 24) / 2 - scrollTop;
            // Dispatcher-polish: use dynamic container height instead of hard-coded 800
            if (topOffset < HEADER_H - 12 || topOffset > containerHeight) return null;
            return (
              <div key={`indicators-${techId}`}>
                {earlyCount > 0 && (
                  <div className="pointer-events-auto absolute left-0" style={{ top: topOffset }}>
                    <EarlyIndicator count={earlyCount} />
                  </div>
                )}
                {lateCount > 0 && (
                  <div className="pointer-events-auto absolute right-0" style={{ top: topOffset }}>
                    <LateIndicator count={lateCount} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * AnyTimeCell — a single tech's cell in the fixed Any Time column.
 * Shows compact chips for any-time (allDay) visits assigned to this tech.
 */
/** Max visible Any Time chips per cell — overflow rendered as clickable +N */
const ANY_TIME_VISIBLE_CAP = 3;

function AnyTimeCell({
  techId, visits, savingIds, selectedVisitId, onSelectVisit, isLast,
}: {
  techId: string;
  visits: DispatchVisit[];
  savingIds: Set<string>;
  selectedVisitId?: string | null;
  onSelectVisit?: (visit: DispatchVisit) => void;
  isLast: boolean;
}) {
  // Stable sort: by visit id (creation order) to prevent jumping
  const sorted = useMemo(() => [...visits].sort((a, b) => a.id.localeCompare(b.id)), [visits]);
  const visible = sorted.slice(0, ANY_TIME_VISIBLE_CAP);
  const overflow = sorted.slice(ANY_TIME_VISIBLE_CAP);

  const chipClasses = (v: DispatchVisit) =>
    `flex items-center gap-0.5 rounded-full border border-amber-300/70 bg-amber-50 px-1.5 py-px text-[9px] font-medium text-amber-800 hover:bg-amber-100 transition-colors truncate max-w-full ${
      selectedVisitId === v.id ? "ring-2 ring-blue-500 bg-amber-100" : ""
    } ${savingIds.has(v.id) ? "opacity-60" : ""}`;

  return (
    <div
      className={`flex flex-col items-center justify-center gap-0.5 overflow-hidden px-1 ${
        !isLast ? "border-b border-slate-200/80" : ""
      }`}
      style={{ height: LANE_HEIGHT_PX, width: ANY_TIME_COL_WIDTH }}
    >
      {sorted.length === 0 ? (
        <span className="text-[9px] text-slate-300">—</span>
      ) : (
        visible.map(v => (
          <button
            key={`at-${v.id}`}
            onClick={() => onSelectVisit?.(v)}
            data-dispatch-block="anytime"
            className={chipClasses(v)}
            title={`${v.customerName} — ${v.summary}`}
          >
            <CalendarDays className="h-2 w-2 text-amber-600 flex-shrink-0" />
            <span className="truncate">{v.customerName?.split(" ")[0] || "Visit"}</span>
          </button>
        ))
      )}
      {overflow.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              data-dispatch-block="anytime"
              className="text-[8px] text-amber-600 font-medium hover:text-amber-800 hover:underline cursor-pointer"
              title={`${overflow.length} more Any Time visits`}
            >
              +{overflow.length}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1 z-[9999]" align="start" side="right">
            <p className="text-[10px] font-semibold text-muted-foreground px-1.5 py-1">
              +{overflow.length} more
            </p>
            {overflow.map(v => (
              <button
                key={`at-overflow-${v.id}`}
                onClick={() => onSelectVisit?.(v)}
                className={chipClasses(v) + " w-full mb-0.5"}
                title={`${v.customerName} — ${v.summary}`}
              >
                <CalendarDays className="h-2 w-2 text-amber-600 flex-shrink-0" />
                <span className="truncate">{v.customerName?.split(" ")[0] || "Visit"}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
