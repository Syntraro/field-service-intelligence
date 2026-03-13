/**
 * DispatchLaneRow — a single technician's lane in the timeline grid.
 * Acts as a droppable zone for scheduling/rescheduling visits.
 * Renders hour grid lines, positioned visit blocks, task blocks,
 * drag preview indicator, and outside-window indicators.
 * Goal 2: Strengthened lane boundaries.
 * Goal 3: Occupancy rail for free-gap clarity.
 */
import { useMemo, useCallback, useRef } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { DispatchVisit, DispatchTask, Technician } from "./dispatchPreviewTypes";
import { UNASSIGNED_TECH_ID } from "./dispatchPreviewTypes";
import type { DispatchDropData } from "./dispatchDndTypes";
import { TIMELINE_HOURS, HOUR_WIDTH_PX, LANE_HEIGHT_PX, TIMELINE_START_HOUR, getVisitPosition } from "./dispatchPreviewUtils";
import { getTaskPosition } from "./DispatchTaskBlock";
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
  /** Click-to-schedule: preview node to show at hover position */
  clickPreview?: React.ReactNode;
  /** Click-to-schedule: whether this lane is being hovered with a pending placement */
  isClickHoverTarget?: boolean;
  /** Click-to-schedule: commit handler — click on this lane to schedule */
  onClickSchedule?: (techId: string, relativeX: number) => void;
  /** Click-to-schedule: hover handler — mouse move updates preview */
  onClickHover?: (techId: string, relativeX: number) => void;
  /** Click-to-schedule: hover leave handler */
  onClickHoverLeave?: () => void;
  /** Whether click-to-schedule placement is active (a visit is selected for scheduling) */
  isPlacementActive?: boolean;
};

export default function DispatchLaneRow({
  tech, visits, tasks = [], isLast, savingIds,
  selectedVisitId, selectedTaskId, onSelectVisit, onSelectTask,
  onUnschedule, onResize, onResizeTask, dragPreview, hasOverlap,
  timelineHours: hours = TIMELINE_HOURS,
  timelineStartHour: startHour = TIMELINE_START_HOUR,
  timelineEndHour: endHour,
  onEmptySlotClick,
  clickPreview, isClickHoverTarget, onClickSchedule, onClickHover, onClickHoverLeave,
  isPlacementActive,
}: Props) {
  const isUnassigned = tech.id === UNASSIGNED_TECH_ID;
  const dropData: DispatchDropData = { technicianId: tech.id };

  const { setNodeRef, isOver } = useDroppable({
    id: `lane-${tech.id}`,
    data: dropData,
    disabled: isUnassigned,
  });

  const overBg = hasOverlap ? "bg-red-50/60" : "bg-blue-50/60";

  // Item 2: Filter to timed visits only — any-time visits rendered in DispatchTimeline's fixed column
  const timedVisits = useMemo(() => visits.filter(v => !v.isAllDay), [visits]);

  // Goal 3: Compute occupancy rail segments (thin bar at lane bottom showing occupied periods)
  const occupancySegments = useMemo(() => {
    const segments: { left: number; width: number; type: "visit" | "task" }[] = [];
    for (const v of timedVisits) {
      const pos = getVisitPosition(v, startHour);
      if (pos) segments.push({ left: pos.left, width: pos.width, type: "visit" });
    }
    for (const t of tasks) {
      const tPos = getTaskPosition(t, startHour);
      if (tPos) segments.push({ left: tPos.left, width: tPos.width, type: "task" });
    }
    return segments;
  }, [timedVisits, tasks, startHour]);

  const totalWidth = hours.length * HOUR_WIDTH_PX;

  // Guard: suppress quick-create clicks immediately after resize/drag interactions
  const lastBlockInteractionRef = useRef(0);

  // Item 6: Click empty slot — compute time from click position
  // In click-to-schedule mode, this handler is bypassed in favor of onClickSchedule
  const handleLaneClick = useCallback((e: React.MouseEvent) => {
    // Click-to-schedule: commit placement on click
    if (isPlacementActive && onClickSchedule) {
      const target = e.target as HTMLElement;
      if (target.closest("[data-dispatch-block]")) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const relativeX = e.clientX - rect.left;
      onClickSchedule(tech.id, relativeX);
      return;
    }
    if (!onEmptySlotClick) return;
    // Only fire on clicks directly on the lane background (not on blocks)
    const target = e.target as HTMLElement;
    if (target.closest("[data-dispatch-block]")) return;
    // Suppress clicks that fire within 300ms of a resize/drag release
    if (Date.now() - lastBlockInteractionRef.current < 300) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relativeX = e.clientX - rect.left;
    const minutesFromStart = (relativeX / HOUR_WIDTH_PX) * 60;
    const snapped = Math.round(minutesFromStart / 15) * 15;
    const minuteOfDay = startHour * 60 + Math.max(0, snapped);
    onEmptySlotClick(tech.id, minuteOfDay);
  }, [onEmptySlotClick, startHour, tech.id, isPlacementActive, onClickSchedule]);

  // Click-to-schedule: hover tracking for preview
  const handleLaneMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPlacementActive || !onClickHover) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relativeX = e.clientX - rect.left;
    onClickHover(tech.id, relativeX);
  }, [isPlacementActive, onClickHover, tech.id]);

  const handleLaneMouseLeave = useCallback(() => {
    if (!isPlacementActive || !onClickHoverLeave) return;
    onClickHoverLeave();
  }, [isPlacementActive, onClickHoverLeave]);

  // Track pointerup on dispatch blocks to suppress subsequent click events from resize/drag
  const handleLanePointerUp = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-dispatch-block]")) {
      lastBlockInteractionRef.current = Date.now();
    }
  }, []);

  return (
    <div
      ref={setNodeRef}
      onClick={handleLaneClick}
      onPointerUp={handleLanePointerUp}
      onMouseMove={handleLaneMouseMove}
      onMouseLeave={handleLaneMouseLeave}
      className={`group relative flex ${!isLast ? "border-b border-slate-200/80" : ""} ${
        isOver ? overBg : ""
      } ${isClickHoverTarget ? "bg-emerald-50/30" : ""}
      transition-colors ${isPlacementActive ? "cursor-crosshair" : onEmptySlotClick ? "cursor-pointer" : ""}`}
      style={{ height: LANE_HEIGHT_PX, width: totalWidth }}
    >
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
        <div className="pointer-events-none absolute inset-0 border-2 border-dashed border-blue-300 rounded bg-blue-50/30 z-10" />
      )}
      {isOver && hasOverlap && (
        <div className="pointer-events-none absolute inset-0 border-2 border-dashed border-red-300 rounded bg-red-50/30 z-10" />
      )}

      {/* Drag preview indicator */}
      {isOver && dragPreview}

      {/* Click-to-schedule preview indicator */}
      {isClickHoverTarget && clickPreview}

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
            onSelect={onSelectVisit}
            onUnschedule={onUnschedule}
            onResize={onResize}
            laneVisits={timedVisits}
            laneTasks={tasks}
            laneTechId={tech.id}
            timelineEndHour={endHour}
          />
        );
      })}

      {/* Task blocks — pass lane blocks for resize overlap clamping */}
      {tasks.map(t => (
        <DispatchTaskBlock
          key={`task-${t.id}`}
          task={t}
          isSaving={savingIds.has(t.id)}
          isSelected={selectedTaskId === t.id}
          onSelect={onSelectTask}
          onResize={onResizeTask}
          laneVisits={visits}
          laneTasks={tasks}
          timelineStartHour={startHour}
          timelineEndHour={endHour}
        />
      ))}

    </div>
  );
}
