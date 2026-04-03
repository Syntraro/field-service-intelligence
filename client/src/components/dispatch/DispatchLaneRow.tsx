/**
 * DispatchLaneRow — a single technician's lane in the timeline grid.
 * Acts as a droppable zone for scheduling/rescheduling visits.
 * Renders hour grid lines, positioned visit blocks, task blocks,
 * drag preview indicator, and outside-window indicators.
 * Goal 2: Strengthened lane boundaries.
 * Goal 3: Occupancy rail for free-gap clarity.
 */
import { memo, useMemo, useCallback, useRef } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { DispatchVisit, DispatchTask, Technician } from "./dispatchPreviewTypes";
import { UNASSIGNED_TECH_ID } from "./dispatchPreviewTypes";
import type { DispatchDropData } from "./dispatchDndTypes";
import { TIMELINE_HOURS, HOUR_WIDTH_PX, LANE_HEIGHT_PX, TIMELINE_START_HOUR, getVisitPosition } from "./dispatchPreviewUtils";
import { getTaskPosition } from "./DispatchTaskBlock";
import { checkOverlap } from "./dispatchOverlapUtils";
import DispatchVisitBlock from "./DispatchVisitBlock";
import DispatchTaskBlock from "./DispatchTaskBlock";

type Props = {
  tech: Technician;
  visits: DispatchVisit[];
  tasks?: DispatchTask[];
  isLast: boolean;
  savingIds: Set<string>;
  selectedVisitId?: string | null;
  selectedTaskId?: string | null;
  onSelectVisit?: (visit: DispatchVisit) => void;
  onSelectTask?: (task: DispatchTask) => void;
  onUnschedule?: (visit: DispatchVisit) => void;
  onResize?: (visit: DispatchVisit, newEndTime: string) => void;
  onResizeTask?: (task: DispatchTask, newEndTime: string) => void;
  /** Drag preview state — only shown when this lane is the active drop target */
  dragPreview?: React.ReactNode;
  /** Whether the drag would cause an overlap */
  hasOverlap?: boolean;
  /** Item 4: Dynamic timeline config for 24h mode */
  timelineHours?: number[];
  timelineStartHour?: number;
  timelineEndHour?: number;
  /** Item 6: Click empty slot handler */
  onEmptySlotClick?: (techId: string, minuteOfDay: number) => void;
};

/** PERF-08: Memoized to skip re-renders for non-active lanes during drag
 * (dragTick increments ~60Hz but only the active drop-target lane receives changed props). */
export default memo(function DispatchLaneRow({
  tech, visits, tasks = [], isLast, savingIds,
  selectedVisitId, selectedTaskId, onSelectVisit, onSelectTask,
  onUnschedule, onResize, onResizeTask, dragPreview, hasOverlap,
  timelineHours: hours = TIMELINE_HOURS,
  timelineStartHour: startHour = TIMELINE_START_HOUR,
  timelineEndHour: endHour,
  onEmptySlotClick,
}: Props) {
  const dropData: DispatchDropData = { technicianId: tech.id };

  // 2026-03-26: Unassigned lane is now a valid drop target (clears tech assignment)
  const { setNodeRef, isOver } = useDroppable({
    id: `lane-${tech.id}`,
    data: dropData,
  });

  const overBg = hasOverlap ? "bg-red-50/60" : "bg-[rgba(118,176,84,0.08)]";

  // Exclude allDay items from timeline — allDay scheduling removed from product UX
  const timedVisits = useMemo(() => visits.filter(v => !v.isAllDay), [visits]);
  const timedTasks = useMemo(() => tasks.filter(t => !t.isAllDay), [tasks]);

  // Compute set of IDs that overlap another item in this lane
  const conflictIds = useMemo(() => {
    const ids = new Set<string>();
    const allItems = [...timedVisits, ...timedTasks];
    for (const item of allItems) {
      if (!item.scheduledStart) continue;
      const s = new Date(item.scheduledStart);
      const startMin = s.getHours() * 60 + s.getMinutes();
      const endMin = startMin + item.durationMinutes;
      // Check this item against all other items (exclude self)
      if (checkOverlap(startMin, endMin, timedVisits, item.id, timedTasks)) {
        ids.add(item.id);
      }
    }
    return ids;
  }, [timedVisits, timedTasks]);

  // Goal 3: Compute occupancy rail segments (thin bar at lane bottom showing occupied periods)
  const occupancySegments = useMemo(() => {
    const segments: { left: number; width: number; type: "visit" | "task" }[] = [];
    for (const v of timedVisits) {
      const pos = getVisitPosition(v, startHour);
      if (pos) segments.push({ left: pos.left, width: pos.width, type: "visit" });
    }
    for (const t of timedTasks) {
      const tPos = getTaskPosition(t, startHour);
      if (tPos) segments.push({ left: tPos.left, width: tPos.width, type: "task" });
    }
    return segments;
  }, [timedVisits, timedTasks, startHour]);

  const totalWidth = hours.length * HOUR_WIDTH_PX;

  // Guard: suppress quick-create clicks immediately after resize/drag interactions
  const lastBlockInteractionRef = useRef(0);

  // Item 6: Click empty slot — compute time from click position
  const handleLaneClick = useCallback((e: React.MouseEvent) => {
    if (!onEmptySlotClick) return;
    // Only fire on clicks directly on the lane background (not on blocks)
    const target = e.target as HTMLElement;
    if (target.closest("[data-dispatch-block]")) return;
    // Suppress clicks that fire within 300ms of a resize/drag release
    if (Date.now() - lastBlockInteractionRef.current < 1500) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relativeX = e.clientX - rect.left;
    const minutesFromStart = (relativeX / HOUR_WIDTH_PX) * 60;
    const snapped = Math.round(minutesFromStart / 15) * 15;
    const minuteOfDay = startHour * 60 + Math.max(0, snapped);
    onEmptySlotClick(tech.id, minuteOfDay);
  }, [onEmptySlotClick, startHour, tech.id]);

  // Track pointerdown on dispatch blocks to suppress subsequent click events from resize/drag
  const handleLanePointerDown = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-dispatch-block]")) {
      lastBlockInteractionRef.current = Date.now();
    }
  }, []);

  const isUnassignedLane = tech.id === UNASSIGNED_TECH_ID;

  return (
    <div
      ref={setNodeRef}
      onClick={handleLaneClick}
      onPointerDownCapture={handleLanePointerDown}
      className={`group relative flex ${!isLast && !isUnassignedLane ? "border-b border-slate-200/80" : ""} ${
        isOver ? overBg : ""
      } transition-colors ${onEmptySlotClick ? "cursor-pointer" : ""}`}
      style={{ height: LANE_HEIGHT_PX, width: totalWidth }}
    >
      {/* 2026-03-27: Double-divider for Unassigned lane — matches sidebar */}
      {isUnassignedLane && (
        <div className="absolute bottom-0 left-0 right-0 h-[3px] pointer-events-none z-[5]"
          style={{ background: "linear-gradient(to bottom, rgba(100,116,139,0.25) 0px, rgba(100,116,139,0.25) 1px, transparent 1px, transparent 2px, rgba(100,116,139,0.18) 2px, rgba(100,116,139,0.18) 3px)" }} />
      )}
      {/* Goal 2: Hour cell grid lines — alternating subtle fill for half-day rhythm */}
      {hours.map((h, idx) => (
        <div
          key={h}
          className={`border-r border-dashed border-slate-150 ${idx % 2 === 0 ? "bg-slate-50/40" : ""}`}
          style={{ width: HOUR_WIDTH_PX, height: LANE_HEIGHT_PX }}
        />
      ))}

      {/* Goal 3 / Item 5: Occupancy rail — 1px bar, visible on lane hover only to reduce visual noise */}
      <div className="pointer-events-none absolute bottom-0 left-0 h-px opacity-0 group-hover:opacity-100 transition-opacity" style={{ width: totalWidth }}>
        {occupancySegments.map((seg, i) => (
          <div
            key={i}
            className={`absolute top-0 h-full ${seg.type === "visit" ? "bg-emerald-400/50" : "bg-blue-400/40"}`}
            style={{ left: seg.left, width: Math.max(seg.width, 2) }}
          />
        ))}
      </div>

      {/* Drop target highlight overlay */}
      {isOver && !hasOverlap && (
        <div className="pointer-events-none absolute inset-0 border-2 border-dashed border-[#76B054] rounded bg-[rgba(118,176,84,0.06)] z-10" />
      )}
      {isOver && hasOverlap && (
        <div className="pointer-events-none absolute inset-0 border-2 border-dashed border-red-300 rounded bg-red-50/30 z-10" />
      )}

      {/* Drag preview indicator */}
      {isOver && dragPreview}

      {/* Timed visit blocks — pass lane blocks for resize overlap clamping */}
      {timedVisits.map(v => {
        const pos = getVisitPosition(v, startHour);
        if (!pos) return null;
        return (
          <DispatchVisitBlock
            key={`${v.id}--${tech.id}`}
            visit={v}
            left={pos.left}
            width={pos.width}
            techColor={tech.color}
            isSaving={savingIds.has(v.id)}
            isSelected={selectedVisitId === v.id}
            hasConflict={conflictIds.has(v.id)}
            onSelect={onSelectVisit}
            onUnschedule={onUnschedule}
            onResize={onResize}
            laneVisits={timedVisits}
            laneTasks={timedTasks}
            laneTechId={tech.id}
            timelineEndHour={endHour}
          />
        );
      })}

      {/* Task blocks — pass lane blocks for resize overlap clamping */}
      {timedTasks.map(t => (
        <DispatchTaskBlock
          key={`task-${t.id}`}
          task={t}
          isSaving={savingIds.has(t.id)}
          isSelected={selectedTaskId === t.id}
          hasConflict={conflictIds.has(t.id)}
          onSelect={onSelectTask}
          onResize={onResizeTask}
          laneVisits={timedVisits}
          laneTasks={timedTasks}
          timelineStartHour={startHour}
          timelineEndHour={endHour}
        />
      ))}

    </div>
  );
});
