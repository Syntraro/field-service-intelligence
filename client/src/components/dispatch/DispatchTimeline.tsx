/**
 * DispatchTimeline — the scrollable center panel with hour columns + lane rows.
 * Combines the hour header and all technician lane rows.
 * Supports drag preview rendering and overlap detection display.
 * Outside-window indicators are rendered as a non-scrolling overlay.
 */
import { useRef, useEffect, useMemo, useState, useCallback } from "react";
import type { DispatchVisit, DispatchTask, Technician } from "./dispatchPreviewTypes";
import { TIMELINE_HOURS, HOUR_WIDTH_PX, LANE_HEIGHT_PX, DIVIDER_HEIGHT_PX, formatHour, BUSINESS_START_HOUR, TIMELINE_START_HOUR } from "./dispatchPreviewUtils";
import DispatchLaneRow from "./DispatchLaneRow";
import { countItemsBefore, countItemsAfter, EarlyIndicator, LateIndicator } from "./DispatchOutsideWindowIndicators";

// PERF-08: Stable empty-array constants so React.memo on DispatchLaneRow can
// skip re-renders for empty lanes (avoids new [] reference each render).
const EMPTY_VISITS: DispatchVisit[] = [];
const EMPTY_TASKS: DispatchTask[] = [];

/** Any Time column removed — constant kept at 0 for coordinate math compatibility in DispatchPreview */
export const ANY_TIME_COL_WIDTH = 0;

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
      const visits = visitsByTech.get(t.id) ?? EMPTY_VISITS;
      const tasks = tasksByTech?.get(t.id) ?? EMPTY_TASKS;
      const early = countItemsBefore(visits, tasks);
      const late = countItemsAfter(visits, tasks);
      if (early > 0 || late > 0) {
        result.push({ techId: t.id, pixelTop: i * LANE_HEIGHT_PX, earlyCount: early, lateCount: late });
      }
    });
    // Off-shift technicians (offset by divider)
    offShift.forEach((t, i) => {
      const visits = visitsByTech.get(t.id) ?? EMPTY_VISITS;
      const tasks = tasksByTech?.get(t.id) ?? EMPTY_TASKS;
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
                          visits={visitsByTech.get(t.id) ?? EMPTY_VISITS}
                          tasks={tasksByTech?.get(t.id) ?? EMPTY_TASKS}
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
                              visits={visitsByTech.get(t.id) ?? EMPTY_VISITS}
                              tasks={tasksByTech?.get(t.id) ?? EMPTY_TASKS}
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

